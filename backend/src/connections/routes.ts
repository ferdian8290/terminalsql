import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { eq, and } from 'drizzle-orm';
import { getDb } from '../db/index.js';
import { connections } from '../db/schema.js';
import { authenticate } from '../middleware/auth.js';
import { encrypt, decrypt } from '../utils/crypto.js';
import {
  resolveBastionConfig,
  createBastionClient,
  openForwardedStream,
  createBastionHttpAgent,
  createBastionTunnel,
  BastionTunnel
} from '../utils/bastion.js';
import { closeMysqlPool } from '../modules/database/routes.js';

const connectionSchema = z.object({
  name: z.string().min(1).max(100),
  type: z.enum(['ssh', 'database', 'sftp']),
  host: z.string().default('localhost'),
  port: z.number().int().min(0).max(65535).default(0),
  username: z.string().default(''),
  folder: z.string().optional().nullable(),
  credentials: z.object({
    // SSH / SFTP
    password: z.string().optional(),
    privateKey: z.string().optional(),
    passphrase: z.string().optional(),
    // Database
    dbPassword: z.string().optional(),
    database: z.string().optional(),
    dbType: z.enum(['mysql', 'postgres', 'sqlite', 'clickhouse']).optional(),
    ssl: z.boolean().optional(),
    // Jump Host / Bastion
    useBastion: z.boolean().optional(),
    bastion: z.object({
      reuseConnectionId: z.string().optional(),
      host: z.string().optional(),
      port: z.number().int().optional(),
      username: z.string().optional(),
      authType: z.enum(['password', 'key']).optional(),
      password: z.string().optional(),
      privateKey: z.string().optional(),
      passphrase: z.string().optional(),
    }).optional(),
  }).passthrough(),
  tags: z.array(z.string()).default([]),
  color: z.string().default('#00d4ff'),
});

export async function connectionRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate);

  // GET /api/connections
  app.get('/', async (request, reply) => {
    const db = getDb();
    const rawList = db.select()
      .from(connections)
      .where(eq(connections.userId, request.user!.sub))
      .all();

    const result = rawList.map((c) => {
      let hasBastion = false;
      let dbType: string | undefined = undefined;
      try {
        const creds = JSON.parse(decrypt(c.encryptedCredentials));
        hasBastion = Boolean(creds.useBastion);
        if (c.type === 'database') {
          dbType = creds.dbType;
        }
      } catch {}

      return {
        id: c.id,
        name: c.name,
        type: c.type,
        dbType,
        host: c.host,
        port: c.port,
        username: c.username,
        folder: c.folder,
        tags: c.tags,
        color: c.color,
        hasBastion: hasBastion || (c.tags || []).includes('bastion'),
        createdAt: c.createdAt,
        lastUsed: c.lastUsed,
      };
    });

    return reply.send({ connections: result });
  });

  // GET /api/connections/export
  app.get('/export', async (request, reply) => {
    const db = getDb();
    const { includeCredentials } = request.query as { includeCredentials?: string };
    const shouldInclude = includeCredentials === 'true';

    const rawList = db.select()
      .from(connections)
      .where(eq(connections.userId, request.user!.sub))
      .all();

    const exported = rawList.map((c) => {
      let creds: any = {};
      try {
        if (shouldInclude) {
          creds = JSON.parse(decrypt(c.encryptedCredentials));
        }
      } catch { }

      return {
        name: c.name,
        type: c.type,
        host: c.host,
        port: c.port,
        username: c.username,
        folder: c.folder,
        credentials: creds,
        tags: c.tags,
        color: c.color,
      };
    });

    return reply.send({
      version: '1.0',
      exportedAt: new Date().toISOString(),
      connections: exported,
    });
  });

  // POST /api/connections/import/bulk
  app.post('/import/bulk', async (request, reply) => {
    const db = getDb();
    const body = request.body as {
      connections: any[];
      onDuplicate?: 'replace' | 'keep_both' | 'skip';
    };
    if (!body || !Array.isArray(body.connections) || body.connections.length === 0) {
      return reply.status(400).send({ error: 'No connections provided for import' });
    }

    const onDuplicate = body.onDuplicate || 'replace';

    // Get existing connections for this user to detect duplicates
    const existingList = db.select()
      .from(connections)
      .where(eq(connections.userId, request.user!.sub))
      .all();

    const existingMap = new Map<string, typeof existingList[0]>();
    for (const c of existingList) {
      existingMap.set(`${c.type}:${c.name.trim().toLowerCase()}`, c);
    }

    const inserted: any[] = [];
    let updatedCount = 0;
    let skippedCount = 0;
    const now = new Date();

    for (const item of body.connections) {
      if (!item.name || !item.type) continue;
      const type = ['ssh', 'database', 'sftp'].includes(item.type) ? item.type : 'ssh';
      const name = String(item.name).slice(0, 100);
      const host = String(item.host || 'localhost');
      const port = Number(item.port) || (type === 'database' ? 3306 : 22);
      const username = String(item.username || '');
      const tags = Array.isArray(item.tags) ? item.tags : [];
      const color = item.color || (type === 'ssh' ? '#10b981' : type === 'database' ? '#a855f7' : '#f59e0b');
      const credentials = typeof item.credentials === 'object' && item.credentials !== null ? item.credentials : {};
      const folder = item.folder ? String(item.folder).slice(0, 50) : null;

      const dupKey = `${type}:${name.trim().toLowerCase()}`;
      const existingConn = existingMap.get(dupKey);

      if (existingConn) {
        if (onDuplicate === 'skip') {
          skippedCount++;
          continue;
        }

        if (onDuplicate === 'replace') {
          try {
            const encryptedCredentials = encrypt(JSON.stringify(credentials));
            db.update(connections)
              .set({
                host,
                port,
                username,
                encryptedCredentials,
                tags,
                color,
                folder,
                createdAt: now,
              })
              .where(eq(connections.id, existingConn.id))
              .run();

            updatedCount++;
            inserted.push({
              id: existingConn.id,
              name,
              type,
              host,
              port,
              username,
              tags,
              color,
              folder,
              action: 'updated',
            });
            continue;
          } catch (err: any) {
            request.log.warn({ err, name }, 'Failed to replace existing connection');
          }
        }
      }

      // Default or keep_both: Insert new connection
      try {
        const encryptedCredentials = encrypt(JSON.stringify(credentials));
        const conn = {
          id: uuidv4(),
          userId: request.user!.sub,
          name,
          type,
          host,
          port,
          username,
          encryptedCredentials,
          tags,
          color,
          folder,
          createdAt: now,
        };

        db.insert(connections).values(conn).run();
        inserted.push({
          id: conn.id,
          name: conn.name,
          type: conn.type,
          host: conn.host,
          port: conn.port,
          username: conn.username,
          tags: conn.tags,
          color: conn.color,
          folder: conn.folder,
          action: 'created',
        });
      } catch (err: any) {
        request.log.warn({ err, name: item.name }, 'Failed to import single connection in bulk import');
      }
    }

    return reply.status(201).send({
      success: true,
      count: inserted.length,
      insertedCount: inserted.length - updatedCount,
      updatedCount,
      skippedCount,
      connections: inserted,
    });
  });

  // POST /api/connections
  app.post('/', async (request, reply) => {
    const db = getDb();
    const body = connectionSchema.safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({ error: 'Validation failed', details: body.error.flatten() });
    }

    const { name, type, host, port, username, folder, credentials, tags, color } = body.data;
    const encryptedCredentials = encrypt(JSON.stringify(credentials));

    const conn = {
      id: uuidv4(),
      userId: request.user!.sub,
      name,
      type,
      host,
      port,
      username,
      folder: folder || null,
      encryptedCredentials,
      tags,
      color,
      createdAt: new Date(),
    };

    db.insert(connections).values(conn).run();

    return reply.status(201).send({
      connection: { id: conn.id, name, type, host, port, username, folder: conn.folder, tags, color },
    });
  });

  // GET /api/connections/:id
  app.get('/:id', async (request, reply) => {
    const db = getDb();
    const { id } = request.params as { id: string };

    const existing = db.select()
      .from(connections)
      .where(and(eq(connections.id, id), eq(connections.userId, request.user!.sub)))
      .get();

    if (!existing) return reply.status(404).send({ error: 'Connection not found' });

    let credentials: any = {};
    try {
      credentials = JSON.parse(decrypt(existing.encryptedCredentials));
    } catch {}

    return reply.send({
      connection: {
        id: existing.id,
        name: existing.name,
        type: existing.type,
        host: existing.host,
        port: existing.port,
        username: existing.username,
        folder: existing.folder,
        credentials,
        tags: existing.tags,
        color: existing.color,
      },
    });
  });

  // PATCH /api/connections/:id
  app.patch('/:id', async (request, reply) => {
    const db = getDb();
    const { id } = request.params as { id: string };
    const body = connectionSchema.partial().safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({ error: 'Validation failed', details: body.error.flatten() });
    }

    const existing = db.select()
      .from(connections)
      .where(and(eq(connections.id, id), eq(connections.userId, request.user!.sub)))
      .get();

    if (!existing) return reply.status(404).send({ error: 'Connection not found' });

    const updates: Record<string, any> = { ...body.data };
    if (updates.credentials) {
      updates.encryptedCredentials = encrypt(JSON.stringify(updates.credentials));
      delete updates.credentials;
    }

    db.update(connections).set(updates).where(eq(connections.id, id)).run();
    closeMysqlPool(id);

    const updated = db.select({
      id: connections.id,
      name: connections.name,
      type: connections.type,
      host: connections.host,
      port: connections.port,
      username: connections.username,
      folder: connections.folder,
      tags: connections.tags,
      color: connections.color,
      createdAt: connections.createdAt,
      lastUsed: connections.lastUsed,
    })
      .from(connections)
      .where(eq(connections.id, id))
      .get();

    return reply.send({ message: 'Connection updated', connection: updated });
  });

  // DELETE /api/connections/:id
  app.delete('/:id', async (request, reply) => {
    const db = getDb();
    const { id } = request.params as { id: string };

    const existing = db.select()
      .from(connections)
      .where(and(eq(connections.id, id), eq(connections.userId, request.user!.sub)))
      .get();

    if (!existing) return reply.status(404).send({ error: 'Connection not found' });

    db.delete(connections).where(eq(connections.id, id)).run();
    closeMysqlPool(id);
    return reply.send({ message: 'Connection deleted' });
  });

async function executeConnectionTest(
  type: string,
  host: string,
  port: number,
  username: string,
  creds: any,
  userId?: string
): Promise<{ success: boolean; message: string; durationMs?: number }> {
  const startTime = Date.now();
  let bastionClient: any = null;

  try {
    const resolvedBastion = creds.useBastion ? resolveBastionConfig(creds.bastion, userId) : null;
    let forwardedStream: any = null;

    if (resolvedBastion) {
      bastionClient = await createBastionClient(resolvedBastion);
    }

    if (type === 'ssh' || type === 'sftp') {
      const { Client } = await import('ssh2');
      if (bastionClient) {
        forwardedStream = await openForwardedStream(bastionClient, host, port || 22);
      }
      return await new Promise((resolve) => {
        const client = new Client();
        const timeout = setTimeout(() => {
          client.end();
          resolve({ success: false, message: 'SSH connection timed out after 10s' });
        }, 10000);

        client.on('ready', () => {
          clearTimeout(timeout);
          client.end();
          const bastionMsg = resolvedBastion ? `via Bastion (${resolvedBastion.host}) ` : '';
          resolve({
            success: true,
            message: `SSH connection successful ${bastionMsg}(${Date.now() - startTime}ms)`,
            durationMs: Date.now() - startTime,
          });
        });

        client.on('error', (err) => {
          clearTimeout(timeout);
          resolve({ success: false, message: err.message });
        });

        client.connect({
          sock: forwardedStream || undefined,
          host: forwardedStream ? undefined : host,
          port: forwardedStream ? undefined : (port || 22),
          username,
          password: creds.password,
          privateKey: creds.privateKey,
          passphrase: creds.passphrase,
          readyTimeout: 10000,
        });
      });
    }

    if (type === 'database') {
      const dbType = creds.dbType || 'mysql';

      if (dbType === 'mysql') {
        const mysql = await import('mysql2/promise');
        try {
          if (bastionClient) {
            forwardedStream = await openForwardedStream(bastionClient, host, port || 3306);
          }
          const connection = await mysql.createConnection({
            stream: forwardedStream || undefined,
            host: forwardedStream ? undefined : host,
            port: forwardedStream ? undefined : (port || 3306),
            user: username,
            password: creds.dbPassword,
            database: creds.database,
            ssl: creds.ssl ? { rejectUnauthorized: false } : undefined,
            connectTimeout: 10000,
          });
          await connection.query('SELECT 1');
          await connection.end();
          const bastionMsg = resolvedBastion ? `via Bastion (${resolvedBastion.host}) ` : '';
          return {
            success: true,
            message: `MySQL connection verified ${bastionMsg}(${Date.now() - startTime}ms)`,
            durationMs: Date.now() - startTime,
          };
        } catch (err: any) {
          return { success: false, message: err.message };
        }
      }

      if (dbType === 'postgres') {
        const { Client } = await import('pg');
        let tunnel: BastionTunnel | null = null;
        let pgHost = host;
        let pgPort = port || 5432;

        try {
          if (bastionClient) {
            tunnel = await createBastionTunnel(bastionClient, host, port || 5432);
            pgHost = '127.0.0.1';
            pgPort = tunnel.localPort;
          }
          const client = new Client({
            host: pgHost,
            port: pgPort,
            user: username,
            password: creds.dbPassword,
            database: creds.database,
            ssl: creds.ssl ? { rejectUnauthorized: false } : undefined,
            connectionTimeoutMillis: 10000,
          });
          await client.connect();
          await client.query('SELECT 1');
          await client.end();
          if (tunnel) await tunnel.close().catch(() => {});
          const bastionMsg = resolvedBastion ? `via Bastion (${resolvedBastion.host}) ` : '';
          return {
            success: true,
            message: `PostgreSQL connection successful ${bastionMsg}(${Date.now() - startTime}ms)`,
            durationMs: Date.now() - startTime,
          };
        } catch (err: any) {
          if (tunnel) await tunnel.close().catch(() => {});
          return { success: false, message: err.message };
        }
      }

      if (dbType === 'sqlite') {
        const Database = (await import('better-sqlite3')).default;
        try {
          const filePath = creds.database || host;
          const sqliteDb = new Database(filePath, { readonly: true, fileMustExist: false, timeout: 5000 });
          sqliteDb.prepare('SELECT 1').get();
          sqliteDb.close();
          return { success: true, message: `SQLite database verified (${Date.now() - startTime}ms)`, durationMs: Date.now() - startTime };
        } catch (err: any) {
          return { success: false, message: err.message };
        }
      }

      if (dbType === 'clickhouse') {
        const { createClient } = await import('@clickhouse/client');
        const https = await import('node:https');
        let tunnel: BastionTunnel | null = null;
        try {
          const isHttps = creds.ssl || port === 8443 || port === 9443 || port === 21426;
          const targetPort = port || (isHttps ? 8443 : 8123);
          let url = `${isHttps ? 'https' : 'http'}://${host}:${targetPort}`;

          if (bastionClient) {
            tunnel = await createBastionTunnel(bastionClient, host, targetPort);
            url = `${isHttps ? 'https' : 'http'}://127.0.0.1:${tunnel.localPort}`;
          }

          const client = createClient({
            url,
            username: username || 'default',
            password: creds.dbPassword || '',
            database: creds.database || 'default',
            request_timeout: 10000,
            http_agent: isHttps ? new https.Agent({ rejectUnauthorized: false }) : undefined,
          });

          const queryRes = await client.query({
            query: 'SELECT 1',
            format: 'JSONEachRow',
          });
          await queryRes.json();
          await client.close();
          if (tunnel) {
            await tunnel.close();
            tunnel = null;
          }
          const bastionMsg = resolvedBastion ? `via Bastion (${resolvedBastion.host}) ` : '';
          return {
            success: true,
            message: `ClickHouse connection verified ${bastionMsg}(${Date.now() - startTime}ms)`,
            durationMs: Date.now() - startTime,
          };
        } catch (err: any) {
          if (tunnel) {
            try { await tunnel.close(); } catch {}
          }
          return { success: false, message: err.message };
        }
      }
    }

    return { success: false, message: 'Unsupported connection type' };
  } catch (tunnelErr: any) {
    return { success: false, message: tunnelErr.message || 'Jump Host connection failed' };
  } finally {
    if (bastionClient) {
      try {
        bastionClient.end();
      } catch {}
    }
  }
}

  // POST /api/connections/test-raw (test unsaved credentials from modal)
  app.post('/test-raw', async (request, reply) => {
    const { type, host, port, username, credentials } = request.body as any;
    if (!host) return reply.status(400).send({ success: false, message: 'Host is required' });

    const result = await executeConnectionTest(
      type,
      host,
      Number(port) || 0,
      username || '',
      credentials || {},
      request.user?.sub
    );
    if (!result.success) {
      return reply.status(400).send(result);
    }
    return reply.send(result);
  });

  // POST /api/connections/:id/test
  app.post('/:id/test', async (request, reply) => {
    const db = getDb();
    const { id } = request.params as { id: string };

    const conn = db.select()
      .from(connections)
      .where(and(eq(connections.id, id), eq(connections.userId, request.user!.sub)))
      .get();

    if (!conn) return reply.status(404).send({ error: 'Connection not found' });

    const creds = JSON.parse(decrypt(conn.encryptedCredentials));
    const result = await executeConnectionTest(
      conn.type,
      conn.host,
      conn.port,
      conn.username,
      creds,
      request.user?.sub
    );
    if (!result.success) {
      return reply.status(400).send(result);
    }
    return reply.send(result);
  });
}
