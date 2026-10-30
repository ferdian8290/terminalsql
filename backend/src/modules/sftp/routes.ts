import { FastifyInstance } from 'fastify';
import { and, eq } from 'drizzle-orm';
import SftpClient from 'ssh2-sftp-client';
import { getDb } from '../../db/index.js';
import { connections } from '../../db/schema.js';
import { authenticate } from '../../middleware/auth.js';
import { decrypt } from '../../utils/crypto.js';
import { resolveBastionConfig, createBastionClient, openForwardedStream } from '../../utils/bastion.js';
import { pipeline } from 'stream/promises';
import zlib from 'zlib';
import { readStreamLimited, parseTarEntries, extractTarEntryContent } from './archiveHelper.js';

interface SftpSessionHandle {
  sftp: SftpClient;
  bastionClient?: any;
  cleanup: () => Promise<void>;
}

async function getSftpClient(conn: any, creds: any, userId?: string): Promise<SftpSessionHandle> {
  const sftp = new SftpClient();
  let bastionClient: any;
  let forwardedStream: any;

  if (creds.useBastion && creds.bastion) {
    const resolved = resolveBastionConfig(creds.bastion, userId);
    if (resolved) {
      bastionClient = await createBastionClient(resolved);
      forwardedStream = await openForwardedStream(bastionClient, conn.host, conn.port || 22);
    }
  }

  await sftp.connect({
    sock: forwardedStream || undefined,
    host: forwardedStream ? undefined : conn.host,
    port: forwardedStream ? undefined : conn.port,
    username: conn.username,
    password: creds.password,
    privateKey: creds.privateKey,
    passphrase: creds.passphrase,
    readyTimeout: 15000,
  });

  const cleanup = async () => {
    try { await sftp.end(); } catch {}
    try { bastionClient?.end(); } catch {}
  };

  return { sftp, bastionClient, cleanup };
}

async function getVerifiedConnection(db: any, connectionId: string, userId: string) {
  const conn = db.select()
    .from(connections)
    .where(and(eq(connections.id, connectionId), eq(connections.userId, userId)))
    .get();
  if (!conn || (conn.type !== 'sftp' && conn.type !== 'ssh')) return null;
  return conn;
}

export async function sftpRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate);

  // GET /api/sftp/list?connectionId=&path=
  app.get('/list', async (request, reply) => {
    const db = getDb();
    const { connectionId, path } = request.query as { connectionId: string; path?: string };

    const conn = await getVerifiedConnection(db, connectionId, request.user!.sub);
    if (!conn) return reply.status(404).send({ error: 'Connection not found' });

    const creds = JSON.parse(decrypt(conn.encryptedCredentials));
    const { sftp, cleanup } = await getSftpClient(conn, creds, request.user!.sub);

    try {
      let targetPath = (path || '').trim();
      if (!targetPath || targetPath === '.' || targetPath === '~') {
        try {
          targetPath = await sftp.realPath('.');
        } catch {
          targetPath = '/';
        }
      }

      const list = await sftp.list(targetPath);
      const files = list.map((f) => ({
        name: f.name,
        type: f.type === 'd' ? 'directory' : 'file',
        size: f.size,
        modifiedAt: f.modifyTime,
        permissions: f.rights,
        owner: f.owner,
        group: f.group,
      }));
      return reply.send({ files, path: targetPath });
    } finally {
      await cleanup();
    }
  });

  // GET /api/sftp/download?connectionId=&path=
  app.get('/download', async (request, reply) => {
    const db = getDb();
    const { connectionId, path } = request.query as { connectionId: string; path: string };

    if (!path) return reply.status(400).send({ error: 'Path is required' });

    const conn = await getVerifiedConnection(db, connectionId, request.user!.sub);
    if (!conn) return reply.status(404).send({ error: 'Connection not found' });

    const creds = JSON.parse(decrypt(conn.encryptedCredentials));
    const { sftp, cleanup } = await getSftpClient(conn, creds, request.user!.sub);

    try {
      const stat = await sftp.stat(path);
      const filename = path.split('/').pop() || 'download';

      reply.header('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
      reply.header('Content-Length', stat.size.toString());
      reply.header('Content-Type', 'application/octet-stream');

      const readStream = sftp.createReadStream(path);
      await pipeline(readStream as any, reply.raw);
    } finally {
      await cleanup();
    }
  });

  // POST /api/sftp/upload
  app.post('/upload', async (request, reply) => {
    const db = getDb();
    const { connectionId, path } = request.query as { connectionId: string; path: string };

    if (!path) return reply.status(400).send({ error: 'Upload path is required' });

    const conn = await getVerifiedConnection(db, connectionId, request.user!.sub);
    if (!conn) return reply.status(404).send({ error: 'Connection not found' });

    const creds = JSON.parse(decrypt(conn.encryptedCredentials));
    const { sftp, cleanup } = await getSftpClient(conn, creds, request.user!.sub);

    try {
      const data = await request.file();
      if (!data) return reply.status(400).send({ error: 'No file provided' });

      const remotePath = path.endsWith('/') ? `${path}${data.filename}` : path;
      const writeStream = sftp.createWriteStream(remotePath);

      await pipeline(data.file as any, writeStream as any);

      return reply.send({ message: 'File uploaded successfully', path: remotePath });
    } finally {
      await cleanup();
    }
  });

  // DELETE /api/sftp/delete
  app.delete('/delete', async (request, reply) => {
    const db = getDb();
    const { connectionId, path, type } = request.body as {
      connectionId: string;
      path: string;
      type: 'file' | 'directory';
    };

    const conn = await getVerifiedConnection(db, connectionId, request.user!.sub);
    if (!conn) return reply.status(404).send({ error: 'Connection not found' });

    const creds = JSON.parse(decrypt(conn.encryptedCredentials));
    const { sftp, cleanup } = await getSftpClient(conn, creds, request.user!.sub);

    try {
      if (type === 'directory') {
        await sftp.rmdir(path, true); // recursive
      } else {
        await sftp.delete(path);
      }
      return reply.send({ message: 'Deleted successfully' });
    } finally {
      await cleanup();
    }
  });

  // POST /api/sftp/mkdir
  app.post('/mkdir', async (request, reply) => {
    const db = getDb();
    const { connectionId, path } = request.body as { connectionId: string; path: string };

    const conn = await getVerifiedConnection(db, connectionId, request.user!.sub);
    if (!conn) return reply.status(404).send({ error: 'Connection not found' });

    const creds = JSON.parse(decrypt(conn.encryptedCredentials));
    const { sftp, cleanup } = await getSftpClient(conn, creds, request.user!.sub);

    try {
      await sftp.mkdir(path, true);
      return reply.send({ message: 'Directory created' });
    } finally {
      await cleanup();
    }
  });

  // POST /api/sftp/rename
  app.post('/rename', async (request, reply) => {
    const db = getDb();
    const { connectionId, oldPath, newPath } = request.body as {
      connectionId: string;
      oldPath: string;
      newPath: string;
    };

    const conn = await getVerifiedConnection(db, connectionId, request.user!.sub);
    if (!conn) return reply.status(404).send({ error: 'Connection not found' });

    const creds = JSON.parse(decrypt(conn.encryptedCredentials));
    const { sftp, cleanup } = await getSftpClient(conn, creds, request.user!.sub);

    try {
      await sftp.rename(oldPath, newPath);
      return reply.send({ message: 'Renamed successfully' });
    } finally {
      await cleanup();
    }
  });

  // GET /api/sftp/preview?connectionId=&path=&entry=&maxBytes=
  app.get('/preview', async (request, reply) => {
    const db = getDb();
    const { connectionId, path, entry, maxBytes } = request.query as {
      connectionId: string;
      path: string;
      entry?: string;
      maxBytes?: string;
    };

    if (!path) return reply.status(400).send({ error: 'Path is required' });

    const conn = await getVerifiedConnection(db, connectionId, request.user!.sub);
    if (!conn) return reply.status(404).send({ error: 'Connection not found' });

    const creds = JSON.parse(decrypt(conn.encryptedCredentials));
    const { sftp, cleanup } = await getSftpClient(conn, creds, request.user!.sub);

    const limitBytes = Math.min(parseInt(maxBytes || '', 10) || 2 * 1024 * 1024, 5 * 1024 * 1024);

    try {
      const stat = await sftp.stat(path);
      const filename = path.split('/').pop() || 'file';
      const isTarGz = path.endsWith('.tar.gz') || path.endsWith('.tgz');
      const isTar = path.endsWith('.tar');
      const isGz = path.endsWith('.gz') && !isTarGz;

      // Case 1: Viewing a specific file inside a .tar or .tar.gz archive
      if ((isTarGz || isTar) && entry) {
        let stream: any = sftp.createReadStream(path);
        if (isTarGz) {
          stream = stream.pipe(zlib.createGunzip());
        }
        const extracted = await extractTarEntryContent(stream, entry, limitBytes);
        if (!extracted) {
          return reply.status(404).send({ error: `File "${entry}" not found inside archive` });
        }
        return reply.send({
          name: entry.split('/').pop(),
          entryPath: entry,
          archivePath: path,
          size: extracted.size,
          totalSize: stat.size,
          content: extracted.content,
          isTruncated: extracted.isTruncated,
          isArchiveEntry: true,
        });
      }

      // Case 2: Reading a compressed single file (e.g. data.csv.gz or app.log.gz)
      if (isGz) {
        const rawStream = sftp.createReadStream(path);
        const decompressedStream = rawStream.pipe(zlib.createGunzip());
        const { content, isTruncated, bytesRead } = await readStreamLimited(decompressedStream, limitBytes);
        return reply.send({
          name: filename,
          path,
          size: bytesRead,
          totalSize: stat.size,
          content,
          isTruncated,
          isCompressed: true,
        });
      }

      // Case 3: Plain text / CSV / JSON / code file
      const rawStream = sftp.createReadStream(path);
      const { content, isTruncated, bytesRead } = await readStreamLimited(rawStream, limitBytes);
      return reply.send({
        name: filename,
        path,
        size: bytesRead,
        totalSize: stat.size,
        content,
        isTruncated,
        isCompressed: false,
      });
    } catch (err: any) {
      return reply.status(500).send({ error: `Failed to preview file: ${err.message}` });
    } finally {
      await cleanup();
    }
  });

  // GET /api/sftp/archive-list?connectionId=&path=
  app.get('/archive-list', async (request, reply) => {
    const db = getDb();
    const { connectionId, path } = request.query as { connectionId: string; path: string };

    if (!path) return reply.status(400).send({ error: 'Path is required' });

    const conn = await getVerifiedConnection(db, connectionId, request.user!.sub);
    if (!conn) return reply.status(404).send({ error: 'Connection not found' });

    const creds = JSON.parse(decrypt(conn.encryptedCredentials));
    const { sftp, cleanup } = await getSftpClient(conn, creds, request.user!.sub);

    try {
      const stat = await sftp.stat(path);
      const filename = path.split('/').pop() || 'archive';
      const isTarGz = path.endsWith('.tar.gz') || path.endsWith('.tgz');
      const isTar = path.endsWith('.tar');

      if (!isTarGz && !isTar) {
        return reply.status(400).send({ error: 'Unsupported archive format. Only .tar, .tar.gz, and .tgz are supported for inspection.' });
      }

      let stream: any = sftp.createReadStream(path);
      if (isTarGz) {
        stream = stream.pipe(zlib.createGunzip());
      }

      const entries = await parseTarEntries(stream, 500);
      return reply.send({
        name: filename,
        path,
        totalSize: stat.size,
        entryCount: entries.length,
        entries,
      });
    } catch (err: any) {
      return reply.status(500).send({ error: `Failed to list archive: ${err.message}` });
    } finally {
      await cleanup();
    }
  });
}
