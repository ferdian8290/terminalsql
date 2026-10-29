import { FastifyInstance } from 'fastify';
import { and, eq } from 'drizzle-orm';
import SftpClient from 'ssh2-sftp-client';
import { getDb } from '../../db/index.js';
import { connections } from '../../db/schema.js';
import { authenticate } from '../../middleware/auth.js';
import { decrypt } from '../../utils/crypto.js';
import { pipeline } from 'stream/promises';

async function getSftpClient(conn: any, creds: any): Promise<SftpClient> {
  const sftp = new SftpClient();
  await sftp.connect({
    host: conn.host,
    port: conn.port,
    username: conn.username,
    password: creds.password,
    privateKey: creds.privateKey,
    passphrase: creds.passphrase,
    readyTimeout: 15000,
  });
  return sftp;
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
    const sftp = await getSftpClient(conn, creds);

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
      await sftp.end();
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
    const sftp = await getSftpClient(conn, creds);

    try {
      const stat = await sftp.stat(path);
      const filename = path.split('/').pop() || 'download';

      reply.header('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
      reply.header('Content-Length', stat.size.toString());
      reply.header('Content-Type', 'application/octet-stream');

      const readStream = sftp.createReadStream(path);
      await pipeline(readStream as any, reply.raw);
    } finally {
      await sftp.end();
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
    const sftp = await getSftpClient(conn, creds);

    try {
      const data = await request.file();
      if (!data) return reply.status(400).send({ error: 'No file provided' });

      const remotePath = path.endsWith('/') ? `${path}${data.filename}` : path;
      const writeStream = sftp.createWriteStream(remotePath);

      await pipeline(data.file as any, writeStream as any);

      return reply.send({ message: 'File uploaded successfully', path: remotePath });
    } finally {
      await sftp.end();
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
    const sftp = await getSftpClient(conn, creds);

    try {
      if (type === 'directory') {
        await sftp.rmdir(path, true); // recursive
      } else {
        await sftp.delete(path);
      }
      return reply.send({ message: 'Deleted successfully' });
    } finally {
      await sftp.end();
    }
  });

  // POST /api/sftp/mkdir
  app.post('/mkdir', async (request, reply) => {
    const db = getDb();
    const { connectionId, path } = request.body as { connectionId: string; path: string };

    const conn = await getVerifiedConnection(db, connectionId, request.user!.sub);
    if (!conn) return reply.status(404).send({ error: 'Connection not found' });

    const creds = JSON.parse(decrypt(conn.encryptedCredentials));
    const sftp = await getSftpClient(conn, creds);

    try {
      await sftp.mkdir(path, true);
      return reply.send({ message: 'Directory created' });
    } finally {
      await sftp.end();
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
    const sftp = await getSftpClient(conn, creds);

    try {
      await sftp.rename(oldPath, newPath);
      return reply.send({ message: 'Renamed successfully' });
    } finally {
      await sftp.end();
    }
  });
}
