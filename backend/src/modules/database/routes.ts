import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { and, eq, desc } from 'drizzle-orm';
import { getDb } from '../../db/index.js';
import { connections, queryHistory, sqlTemplates } from '../../db/schema.js';
import { authenticate } from '../../middleware/auth.js';
import { decrypt } from '../../utils/crypto.js';
import {
  resolveBastionConfig,
  createBastionClient,
  openForwardedStream,
  createBastionHttpAgent,
  createBastionTunnel,
  BastionTunnel
} from '../../utils/bastion.js';
import mysql from 'mysql2/promise';
import { Client as PgClient } from 'pg';

const querySchema = z.object({
  connectionId: z.string().uuid(),
  query: z.string().min(1).max(50000),
  limit: z.number().int().min(1).max(100000).default(100),
  offset: z.number().int().min(0).optional().default(0),
  readOnly: z.boolean().default(false),
  database: z.string().optional(),
});

// MySQL connection pools (keyed by connectionId)
const mysqlPools = new Map<string, mysql.Pool>();

export function closeMysqlPool(connectionId: string) {
  const pool = mysqlPools.get(connectionId);
  if (pool) {
    pool.end().catch(() => {});
    mysqlPools.delete(connectionId);
  }
}

function sanitizeIdentifier(name: string): string {
  return name.replace(/[`"'\\]/g, '');
}

function getMysqlPool(connectionId: string, config: mysql.ConnectionOptions): mysql.Pool {
  if (!mysqlPools.has(connectionId)) {
    const pool = mysql.createPool({ ...config, connectionLimit: 5, queueLimit: 10 });
    mysqlPools.set(connectionId, pool);
  }
  return mysqlPools.get(connectionId)!;
}

function applyQueryLimit(sql: string, limit?: number, offset?: number): string {
  if (!limit) return sql;
  const trimmed = sql.trim().replace(/;+\s*$/, '');
  // If query already explicitly defines LIMIT, respect user's query exactly.
  if (/\bLIMIT\s+\d+/i.test(trimmed)) {
    return `${trimmed};`;
  }
  if (/^(WITH\b|SELECT\b|SHOW\b)/i.test(trimmed)) {
    const offsetClause = offset && offset > 0 ? ` OFFSET ${offset}` : '';
    return `${trimmed} LIMIT ${limit}${offsetClause};`;
  }
  return sql;
}

export async function databaseRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate);

  // POST /api/db/query
  app.post('/query', async (request, reply) => {
    const db = getDb();
    const body = querySchema.safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({ error: 'Validation failed', details: body.error.flatten() });
    }

    const { connectionId, query, limit, offset, readOnly, database } = body.data;
    const hasUserLimit = /\bLIMIT\s+\d+/i.test(query);
    const effectiveQuery = applyQueryLimit(query, limit, offset);

    const conn = db.select()
      .from(connections)
      .where(and(eq(connections.id, connectionId), eq(connections.userId, request.user!.sub)))
      .get();

    if (!conn || conn.type !== 'database') {
      return reply.status(404).send({ error: 'Database connection not found' });
    }

    const creds = JSON.parse(decrypt(conn.encryptedCredentials));
    const startTime = Date.now();
    let bastionClient: any = null;

    try {
      const resolvedBastion = creds.useBastion ? resolveBastionConfig(creds.bastion, conn.userId) : null;
      if (resolvedBastion) {
        bastionClient = await createBastionClient(resolvedBastion);
      }
      let rows: any[] = [];
      let fields: string[] = [];
      let totalRows: number | undefined;

      if (creds.dbType === 'mysql') {
        const targetDb = database || creds.database;
        const pool = getMysqlPool(connectionId, {
          host: conn.host,
          port: conn.port,
          user: conn.username,
          password: creds.dbPassword,
          database: targetDb,
          ssl: creds.ssl ? {} : undefined,
          multipleStatements: false, // Prevent SQL injection via multiple statements
        });

        const connection = await pool.getConnection();
        try {
          if (database) {
            await connection.query(`USE \`${sanitizeIdentifier(database)}\``);
          }
          if (readOnly) await connection.query('SET SESSION TRANSACTION READ ONLY');

          const [rawRows, rawFields] = await connection.query({
            sql: effectiveQuery,
            rowsAsArray: false,
          }) as [any[], mysql.FieldPacket[]];

          if (readOnly) await connection.query('SET SESSION TRANSACTION READ WRITE');

          rows = Array.isArray(rawRows) ? (hasUserLimit ? rawRows : rawRows.slice(0, limit)) : [rawRows];
          fields = rawFields?.map((f: any) => f.name) ?? [];

          if (limit && rows.length >= limit && /^\s*SELECT\b/i.test(query) && !/\bLIMIT\s+\d+/i.test(query)) {
            try {
              const countSql = `SELECT count(*) as total FROM (${query.replace(/;\s*$/, '')}) as _subq`;
              const [countRows] = (await connection.query(countSql)) as [any[], any];
              if (countRows?.[0]) {
                totalRows = Number(countRows[0].total ?? Object.values(countRows[0])[0]);
              }
            } catch {}
          }
        } finally {
          connection.release();
        }
      } else if (creds.dbType === 'postgres') {
        let tunnel: BastionTunnel | null = null;
        let pgHost = conn.host;
        let pgPort = conn.port;

        if (bastionClient) {
          tunnel = await createBastionTunnel(bastionClient, conn.host, conn.port);
          pgHost = '127.0.0.1';
          pgPort = tunnel.localPort;
        }

        const pgClient = new PgClient({
          host: pgHost,
          port: pgPort,
          user: conn.username,
          password: creds.dbPassword,
          database: creds.database,
          ssl: creds.ssl ? { rejectUnauthorized: false } : undefined,
          connectionTimeoutMillis: 15000,
        });

        try {
          await pgClient.connect();
          if (database && database !== 'public') {
            await pgClient.query(`SET search_path TO "${sanitizeIdentifier(database)}", public;`);
          }
          if (readOnly) await pgClient.query('BEGIN TRANSACTION READ ONLY');
          const result = await pgClient.query(effectiveQuery);
          if (readOnly) await pgClient.query('ROLLBACK');

          rows = hasUserLimit ? result.rows : result.rows.slice(0, limit);
          fields = result.fields.map((f) => f.name);

          if (limit && rows.length >= limit && /^\s*SELECT\b/i.test(query) && !/\bLIMIT\s+\d+/i.test(query)) {
            try {
              const countSql = `SELECT count(*) as total FROM (${query.replace(/;\s*$/, '')}) as _subq`;
              const countRes = await pgClient.query(countSql);
              if (countRes.rows?.[0]) {
                totalRows = Number(countRes.rows[0].total ?? Object.values(countRes.rows[0])[0]);
              }
            } catch {}
          }
        } finally {
          await pgClient.end().catch(() => {});
          if (tunnel) {
            await tunnel.close().catch(() => {});
          }
        }
      } else if (creds.dbType === 'sqlite') {
        const Database = (await import('better-sqlite3')).default;
        const filePath = creds.database || conn.host;
        const sqliteDb = new Database(filePath, { readonly: readOnly, fileMustExist: false });
        try {
          const trimmed = query.trim().toUpperCase();
          if (trimmed.startsWith('SELECT') || trimmed.startsWith('PRAGMA') || trimmed.startsWith('WITH') || trimmed.startsWith('EXPLAIN')) {
            const stmt = sqliteDb.prepare(effectiveQuery);
            const rawRows = stmt.all();
            rows = hasUserLimit ? rawRows : rawRows.slice(0, limit);
            if (stmt.columns) {
              fields = stmt.columns().map((c) => c.name);
            } else if (rows.length > 0) {
              fields = Object.keys(rows[0]);
            }

            if (limit && rows.length >= limit && /^\s*SELECT\b/i.test(query) && !/\bLIMIT\s+\d+/i.test(query)) {
              try {
                const countSql = `SELECT count(*) as total FROM (${query.replace(/;\s*$/, '')}) as _subq`;
                const countRow = sqliteDb.prepare(countSql).get() as any;
                if (countRow) {
                  totalRows = Number(countRow.total ?? Object.values(countRow)[0]);
                }
              } catch {}
            }
          } else {
            if (readOnly) {
              throw new Error('Database is in read-only mode');
            }
            const info = sqliteDb.prepare(query).run();
            rows = [{ changes: info.changes, lastInsertRowid: info.lastInsertRowid.toString() }];
            fields = ['changes', 'lastInsertRowid'];
          }
        } finally {
          sqliteDb.close();
        }
      } else if (creds.dbType === 'clickhouse') {
        const { createClient } = await import('@clickhouse/client');
        const https = await import('node:https');
        const isHttps = creds.ssl || conn.port === 8443 || conn.port === 9443 || conn.port === 21426;
        const targetPort = conn.port || (isHttps ? 8443 : 8123);

        let tunnel: BastionTunnel | null = null;
        let url = `${isHttps ? 'https' : 'http'}://${conn.host}:${targetPort}`;
        if (bastionClient) {
          tunnel = await createBastionTunnel(bastionClient, conn.host, targetPort);
          url = `${isHttps ? 'https' : 'http'}://127.0.0.1:${tunnel.localPort}`;
        }

        const targetDb = database || creds.database || 'default';
        const client = createClient({
          url,
          username: conn.username || 'default',
          password: creds.dbPassword || '',
          database: targetDb,
          request_timeout: 30000,
          http_agent: isHttps ? new https.Agent({ rejectUnauthorized: false }) : undefined,
        });
        try {
          const cleanQuery = effectiveQuery.trim().replace(/;+\s*$/, '');
          const resultSet = await client.query({
            query: cleanQuery,
            format: 'JSONEachRow',
            clickhouse_settings: { multiquery: 1 },
          });
          const rawRows = await resultSet.json<any[]>();
          rows = hasUserLimit ? rawRows : rawRows.slice(0, limit);
          if (rows.length > 0) {
            fields = Object.keys(rows[0]);
          } else {
            fields = [];
          }

          if (rawRows.length >= limit && /^\s*SELECT\b/i.test(query) && !/\bLIMIT\s+\d+/i.test(query)) {
            try {
              const countSql = `SELECT count(*) as total FROM (${query.replace(/;\s*$/, '')}) as _subq`;
              const countRes = await client.query({ query: countSql, format: 'JSONEachRow' });
              const countData = (await countRes.json()) as any[];
              const firstRow = countData?.[0] as any;
              if (firstRow) {
                totalRows = Number(firstRow.total ?? firstRow['count()'] ?? Object.values(firstRow)[0]);
              }
            } catch {}
          }
        } finally {
          await client.close();
          if (tunnel) await tunnel.close();
        }
      } else {
        return reply.status(400).send({ error: 'Unsupported database type' });
      }

      const durationMs = Date.now() - startTime;

      // Save to query history
      db.insert(queryHistory).values({
        id: uuidv4(),
        userId: request.user!.sub,
        connectionId,
        query,
        durationMs,
        rowCount: rows.length,
        status: 'success',
        createdAt: new Date(),
      }).run();

      // Prune query_history — keep only last 500 records per user to prevent unbounded growth
      db.run(`
        DELETE FROM query_history
        WHERE user_id = '${request.user!.sub}'
          AND id NOT IN (
            SELECT id FROM query_history
            WHERE user_id = '${request.user!.sub}'
            ORDER BY created_at DESC
            LIMIT 500
          )
      `);

      // Update last used
      db.update(connections).set({ lastUsed: new Date() }).where(eq(connections.id, connectionId)).run();

      const totalLoaded = (offset ?? 0) + rows.length;
      const isTruncated = hasUserLimit
        ? false
        : limit !== undefined && rows.length >= limit && (totalRows !== undefined ? totalRows > totalLoaded : true);

      return reply.send({
        rows,
        fields,
        rowCount: rows.length,
        totalRows,
        offset: offset ?? 0,
        limit,
        durationMs,
        truncated: isTruncated,
      });
    } catch (err: any) {
      const durationMs = Date.now() - startTime;

      db.insert(queryHistory).values({
        id: uuidv4(),
        userId: request.user!.sub,
        connectionId,
        query,
        durationMs,
        rowCount: 0,
        status: 'error',
        createdAt: new Date(),
      }).run();

      return reply.status(400).send({ error: 'Query failed', message: err.message });
    } finally {
      if (bastionClient) {
        try { bastionClient.end(); } catch {}
      }
    }
  });

  // GET /api/db/history
  app.get('/history', async (request, reply) => {
    const db = getDb();
    const { connectionId, page = '1', pageSize = '50' } = request.query as Record<string, string>;

    const conditions = [eq(queryHistory.userId, request.user!.sub)];
    if (connectionId) conditions.push(eq(queryHistory.connectionId, connectionId));

    const history = db.select()
      .from(queryHistory)
      .where(and(...conditions))
      .orderBy(desc(queryHistory.createdAt))
      .limit(parseInt(pageSize))
      .offset((parseInt(page) - 1) * parseInt(pageSize))
      .all();

    return reply.send({ history });
  });

  // GET /api/db/templates (Fetch saved SQL templates)
  app.get('/templates', async (request, reply) => {
    const db = getDb();
    const { dbType } = request.query as Record<string, string>;
    const conditions = [eq(sqlTemplates.userId, request.user!.sub)];
    if (dbType && dbType !== 'all') {
      conditions.push(eq(sqlTemplates.dbType, dbType));
    }

    const templates = db.select()
      .from(sqlTemplates)
      .where(and(...conditions))
      .orderBy(desc(sqlTemplates.updatedAt))
      .all();

    return reply.send({ templates });
  });

  // POST /api/db/templates (Create a new SQL template)
  app.post('/templates', async (request, reply) => {
    const db = getDb();
    const body = z.object({
      name: z.string().min(1).max(100),
      description: z.string().max(500).optional(),
      query: z.string().min(1).max(50000),
      dbType: z.string().optional().default('all'),
      tags: z.array(z.string()).optional().default([]),
    }).safeParse(request.body);

    if (!body.success) {
      return reply.status(400).send({ error: 'Invalid template data', details: body.error.format() });
    }

    const newTemplate = {
      id: uuidv4(),
      userId: request.user!.sub,
      name: body.data.name,
      description: body.data.description || null,
      query: body.data.query,
      dbType: body.data.dbType,
      tags: body.data.tags,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    db.insert(sqlTemplates).values(newTemplate).run();
    return reply.status(201).send({ template: newTemplate });
  });

  // PUT /api/db/templates/:id (Update existing SQL template)
  app.put('/templates/:id', async (request, reply) => {
    const db = getDb();
    const { id } = request.params as { id: string };
    const body = z.object({
      name: z.string().min(1).max(100).optional(),
      description: z.string().max(500).optional(),
      query: z.string().min(1).max(50000).optional(),
      dbType: z.string().optional(),
      tags: z.array(z.string()).optional(),
    }).safeParse(request.body);

    if (!body.success) {
      return reply.status(400).send({ error: 'Invalid template data' });
    }

    const existing = db.select()
      .from(sqlTemplates)
      .where(and(eq(sqlTemplates.id, id), eq(sqlTemplates.userId, request.user!.sub)))
      .get();

    if (!existing) {
      return reply.status(404).send({ error: 'Template not found' });
    }

    const updates: any = { updatedAt: new Date() };
    if (body.data.name !== undefined) updates.name = body.data.name;
    if (body.data.description !== undefined) updates.description = body.data.description;
    if (body.data.query !== undefined) updates.query = body.data.query;
    if (body.data.dbType !== undefined) updates.dbType = body.data.dbType;
    if (body.data.tags !== undefined) updates.tags = body.data.tags;

    db.update(sqlTemplates).set(updates).where(eq(sqlTemplates.id, id)).run();

    const updated = db.select().from(sqlTemplates).where(eq(sqlTemplates.id, id)).get();
    return reply.send({ template: updated });
  });

  // DELETE /api/db/templates/:id (Delete SQL template)
  app.delete('/templates/:id', async (request, reply) => {
    const db = getDb();
    const { id } = request.params as { id: string };

    const existing = db.select()
      .from(sqlTemplates)
      .where(and(eq(sqlTemplates.id, id), eq(sqlTemplates.userId, request.user!.sub)))
      .get();

    if (!existing) {
      return reply.status(404).send({ error: 'Template not found' });
    }

    db.delete(sqlTemplates).where(eq(sqlTemplates.id, id)).run();
    return reply.send({ success: true, message: 'Template deleted' });
  });

  // GET /api/db/schema/:connectionId
  app.get('/schema/:connectionId', async (request, reply) => {
    const db = getDb();
    const { connectionId } = request.params as { connectionId: string };

    const conn = db.select()
      .from(connections)
      .where(and(eq(connections.id, connectionId), eq(connections.userId, request.user!.sub)))
      .get();

    if (!conn || conn.type !== 'database') {
      return reply.status(404).send({ error: 'Database connection not found' });
    }

    const creds = JSON.parse(decrypt(conn.encryptedCredentials));
    let bastionClient: any = null;

    try {
      const resolvedBastion = creds.useBastion ? resolveBastionConfig(creds.bastion, conn.userId) : null;
      if (resolvedBastion) {
        bastionClient = await createBastionClient(resolvedBastion);
      }
      if (creds.dbType === 'mysql') {
        const connection = await mysql.createConnection({
          host: conn.host,
          port: conn.port,
          user: conn.username,
          password: creds.dbPassword,
          database: creds.database,
        });

        let dbNames: string[] = [];
        try {
          const [dbs] = (await connection.query('SHOW DATABASES')) as [any[], any];
          dbNames = dbs
            .map((d: any) => Object.values(d)[0] as string)
            .filter((n) => !['information_schema', 'mysql', 'performance_schema', 'sys'].includes(n));
        } catch {}
        if (dbNames.length === 0 && creds.database) dbNames.push(creds.database);
        if (dbNames.length === 0) dbNames.push('default');

        const [tables] = await connection.query<any[]>(`
          SELECT 
            TABLE_NAME as tableName,
            TABLE_SCHEMA as tableSchema,
            TABLE_ROWS as rowCount,
            TABLE_COMMENT as comment
          FROM information_schema.TABLES
          WHERE TABLE_SCHEMA NOT IN ('information_schema', 'mysql', 'performance_schema', 'sys')
          ORDER BY TABLE_NAME
        `);

        const schema: Record<string, any[]> = {};
        for (const table of (tables as any[]).slice(0, 100)) {
          const [cols] = await connection.query<any[]>(`
            SELECT 
              COLUMN_NAME as name,
              DATA_TYPE as type,
              IS_NULLABLE as nullable,
              COLUMN_KEY as \`key\`,
              COLUMN_DEFAULT as \`default\`,
              EXTRA as extra
            FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
            ORDER BY ORDINAL_POSITION
          `, [table.tableSchema, table.tableName]);
          schema[table.tableName] = cols as any[];
          schema[`${table.tableSchema}.${table.tableName}`] = cols as any[];
        }

        await connection.end();
        const databases = dbNames.map((dbName) => {
          const dbTables = (tables as any[]).filter((t) => t.tableSchema === dbName || dbName === creds.database);
          return {
            name: dbName,
            tables: dbTables.map((t) => ({ name: t.tableName, rowCount: t.rowCount, comment: t.comment })),
          };
        });
        return reply.send({ databases, tables, schema });
      }

      if (creds.dbType === 'postgres') {
        let tunnel: BastionTunnel | null = null;
        let pgHost = conn.host;
        let pgPort = conn.port;

        if (bastionClient) {
          tunnel = await createBastionTunnel(bastionClient, conn.host, conn.port);
          pgHost = '127.0.0.1';
          pgPort = tunnel.localPort;
        }

        const pgClient = new PgClient({
          host: pgHost,
          port: pgPort,
          user: conn.username,
          password: creds.dbPassword,
          database: creds.database,
          ssl: creds.ssl ? { rejectUnauthorized: false } : undefined,
        });

        try {
          await pgClient.connect();

          let schemaNames: string[] = [];
          try {
            const schemasResult = await pgClient.query(`
              SELECT schema_name 
              FROM information_schema.schemata 
              WHERE schema_name NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
              ORDER BY schema_name
            `);
            schemaNames = schemasResult.rows.map((r: any) => r.schema_name);
          } catch {}
          if (schemaNames.length === 0) schemaNames.push('public');

          const tablesResult = await pgClient.query(`
            SELECT 
              c.relname as "tableName",
              n.nspname as "schema",
              CASE c.relkind
                WHEN 'r' THEN 'table'
                WHEN 'p' THEN 'table'
                WHEN 'f' THEN 'foreign_table'
                WHEN 'v' THEN 'view'
                WHEN 'm' THEN 'materialized_view'
                ELSE 'table'
              END as "kind"
            FROM pg_class c
            JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
              AND c.relkind IN ('r', 'v', 'm', 'f', 'p')
            ORDER BY c.relname
          `);

          const schema: Record<string, any[]> = {};
          try {
            const colsResult = await pgClient.query(`
              SELECT
                a.attname AS name,
                pg_catalog.format_type(a.atttypid, a.atttypmod) AS type,
                CASE WHEN a.attnotnull THEN 'NO' ELSE 'YES' END AS nullable,
                pg_get_expr(d.adbin, d.adrelid) AS "default",
                c.relname AS "tableName",
                n.nspname AS "schema"
              FROM pg_attribute a
              JOIN pg_class c ON c.oid = a.attrelid
              JOIN pg_namespace n ON n.oid = c.relnamespace
              LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
              WHERE n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
                AND c.relkind IN ('r', 'v', 'm', 'f', 'p')
                AND a.attnum > 0 
                AND NOT a.attisdropped
              ORDER BY n.nspname, c.relname, a.attnum
              LIMIT 3000
            `);

            for (const col of colsResult.rows) {
              const fullKey = `${col.schema}.${col.tableName}`;
              if (!schema[fullKey]) schema[fullKey] = [];
              schema[fullKey].push({
                name: col.name,
                type: col.type,
                nullable: col.nullable,
                default: col.default,
              });
              if (!schema[col.tableName]) schema[col.tableName] = schema[fullKey];
            }
          } catch {
            // Fallback to information_schema.columns if permissions are restricted
            for (const table of tablesResult.rows.slice(0, 100)) {
              try {
                const colsResult = await pgClient.query(`
                  SELECT 
                    column_name as name,
                    data_type as type,
                    is_nullable as nullable,
                    column_default as "default"
                  FROM information_schema.columns
                  WHERE table_name = $1 AND table_schema = $2
                  ORDER BY ordinal_position
                `, [table.tableName, table.schema]);
                schema[table.tableName] = colsResult.rows;
                schema[`${table.schema}.${table.tableName}`] = colsResult.rows;
              } catch {}
            }
          }

          const databases = schemaNames.map((sName) => {
            const schemaObjects = tablesResult.rows.filter((t: any) => t.schema === sName);
            return {
              name: sName,
              tables: schemaObjects
                .filter((t: any) => t.kind === 'table')
                .map((t: any) => ({ name: t.tableName, kind: 'table' })),
              foreignTables: schemaObjects
                .filter((t: any) => t.kind === 'foreign_table')
                .map((t: any) => ({ name: t.tableName, kind: 'foreign_table' })),
              views: schemaObjects
                .filter((t: any) => t.kind === 'view')
                .map((t: any) => ({ name: t.tableName, kind: 'view' })),
              materializedViews: schemaObjects
                .filter((t: any) => t.kind === 'materialized_view')
                .map((t: any) => ({ name: t.tableName, kind: 'materialized_view' })),
            };
          });
          return reply.send({ databases, tables: tablesResult.rows, schema });
        } finally {
          await pgClient.end().catch(() => {});
          if (tunnel) {
            await tunnel.close().catch(() => {});
          }
        }
      }

      if (creds.dbType === 'sqlite') {
        const Database = (await import('better-sqlite3')).default;
        const filePath = creds.database || conn.host;
        const sqliteDb = new Database(filePath, { readonly: true, fileMustExist: false });
        try {
          const tables = sqliteDb.prepare(`
            SELECT name as tableName, type
            FROM sqlite_master
            WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%'
            ORDER BY name
          `).all();

          const schema: Record<string, any[]> = {};
          for (const table of tables as any[]) {
            const cols = sqliteDb.prepare(`PRAGMA table_info("${table.tableName.replace(/"/g, '""')}")`).all();
            schema[table.tableName] = (cols as any[]).map((c) => ({
              name: c.name,
              type: c.type || 'TEXT',
              nullable: c.notnull === 0 ? 'YES' : 'NO',
              key: c.pk === 1 ? 'PRI' : '',
              default: c.dflt_value,
            }));
          }
          const databases = [{ name: 'main', tables: (tables as any[]).map((t) => ({ name: t.tableName })) }];
          return reply.send({ databases, tables, schema });
        } finally {
          sqliteDb.close();
        }
      }

      if (creds.dbType === 'clickhouse') {
        const { createClient } = await import('@clickhouse/client');
        const https = await import('node:https');
        const isHttps = creds.ssl || conn.port === 8443 || conn.port === 9443 || conn.port === 21426;
        const targetPort = conn.port || (isHttps ? 8443 : 8123);

        let tunnel: BastionTunnel | null = null;
        let url = `${isHttps ? 'https' : 'http'}://${conn.host}:${targetPort}`;
        if (bastionClient) {
          tunnel = await createBastionTunnel(bastionClient, conn.host, targetPort);
          url = `${isHttps ? 'https' : 'http'}://127.0.0.1:${tunnel.localPort}`;
        }

        const client = createClient({
          url,
          username: conn.username || 'default',
          password: creds.dbPassword || '',
          database: creds.database || 'default',
          request_timeout: 15000,
          http_agent: isHttps ? new https.Agent({ rejectUnauthorized: false }) : undefined,
        });
        try {
          // 1. Get all databases (excluding system)
          const dbsResult = await client.query({
            query: `SELECT name FROM system.databases WHERE name NOT IN ('system', 'information_schema', 'INFORMATION_SCHEMA') ORDER BY name`,
            format: 'JSONEachRow',
          });
          const rawDbs = (await dbsResult.json()) as Array<{ name: string }>;
          const dbNames = rawDbs.map((d) => d.name);
          if (dbNames.length === 0) {
            dbNames.push(creds.database || 'default');
          }

          // 2. Get all tables & views across databases
          const tablesResult = await client.query({
            query: `SELECT database, name as tableName, engine, total_rows as rowCount, comment, (engine LIKE '%View%') as isView
                    FROM system.tables 
                    WHERE database NOT IN ('system', 'information_schema', 'INFORMATION_SCHEMA')
                    ORDER BY database, name`,
            format: 'JSONEachRow',
          });
          const allTables = (await tablesResult.json()) as any[];

          // 3. Get columns with scoped limit to avoid timeout on large clusters
          let allCols: any[] = [];
          try {
            const targetDb = creds.database && creds.database !== 'default' ? sanitizeIdentifier(creds.database) : null;
            const colsQuery = targetDb
              ? `SELECT database, table as tableName, name, type, default_expression as default, is_in_primary_key as isPk
                 FROM system.columns
                 WHERE database = '${targetDb}'
                 ORDER BY database, table, position LIMIT 5000`
              : `SELECT database, table as tableName, name, type, default_expression as default, is_in_primary_key as isPk
                 FROM system.columns
                 WHERE database NOT IN ('system', 'information_schema', 'INFORMATION_SCHEMA')
                 ORDER BY database, table, position LIMIT 5000`;

            const colsResult = await client.query({
              query: colsQuery,
              format: 'JSONEachRow',
            });
            allCols = (await colsResult.json()) as any[];
          } catch {}

          const schema: Record<string, any[]> = {};
          for (const col of allCols) {
            const fullKey = `${col.database}.${col.tableName}`;
            if (!schema[fullKey]) schema[fullKey] = [];
            schema[fullKey].push({
              name: col.name,
              type: col.type,
              nullable: col.type.includes('Nullable') ? 'YES' : 'NO',
              key: col.isPk ? 'PRI' : '',
              default: col.default,
            });
            if (!schema[col.tableName]) schema[col.tableName] = schema[fullKey];
          }

          // 4. Construct DBeaver-style database tree
          const databases = dbNames.map((dbName) => {
            const dbTables = allTables.filter((t) => t.database === dbName);
            return {
              name: dbName,
              tables: dbTables.filter((t) => !t.isView).map((t) => ({
                name: t.tableName,
                rowCount: t.rowCount,
                comment: t.comment,
                kind: 'table',
              })),
              foreignTables: [],
              views: dbTables.filter((t) => t.isView && t.engine !== 'MaterializedView').map((t) => ({
                name: t.tableName,
                comment: t.comment,
                kind: 'view',
              })),
              materializedViews: dbTables.filter((t) => t.engine === 'MaterializedView').map((t) => ({
                name: t.tableName,
                comment: t.comment,
                kind: 'materialized_view',
              })),
            };
          });

          const flatTables = allTables.map((t) => ({
            tableName: t.tableName,
            database: t.database,
            rowCount: t.rowCount,
            isView: t.isView,
          }));

          return reply.send({ databases, tables: flatTables, schema });
        } finally {
          await client.close();
          if (tunnel) await tunnel.close();
        }
      }
    } catch (err: any) {
      return reply.status(400).send({ error: 'Failed to fetch schema', message: err.message });
    } finally {
      if (bastionClient) {
        try { bastionClient.end(); } catch {}
      }
    }

    return reply.status(400).send({ error: 'Unsupported database type' });
  });
}
