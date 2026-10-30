import { FastifyInstance } from 'fastify';
import { and, eq } from 'drizzle-orm';
import SftpClient from 'ssh2-sftp-client';
import fs from 'fs';
import path from 'path';
import os from 'os';
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

function formatRights(rights: any): string {
  if (!rights) return '—';
  if (typeof rights === 'string') return rights;
  if (typeof rights === 'object' && rights !== null) {
    const u = rights.user || '---';
    const g = rights.group || '---';
    const o = rights.other || '---';
    return `${u}${g}${o}`;
  }
  return String(rights);
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
        permissions: formatRights(f.rights),
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

  // GET /api/sftp/local-list?path=
  // Lists real directory contents of the host local filesystem
  app.get('/local-list', async (request, reply) => {
    const { path: queryPath } = request.query as { path?: string };
    let raw = (queryPath || '').trim();

    // Helper to resolve paths, supporting Windows paths (C:\Users\...) inside WSL (/mnt/c/Users/...)
    function resolveLocalPath(p: string): string {
      if (!p || p === '~') {
        // If in WSL and /mnt/c/Users/KAM-IPS3I-4 exists, default to Windows user profile
        if (fs.existsSync('/mnt/c/Users/KAM-IPS3I-4')) {
          return '/mnt/c/Users/KAM-IPS3I-4';
        }
        return os.homedir();
      }
      // Handle C:\ or C:/ Windows drive letter notation
      if (/^[a-zA-Z]:[\\\/]/.test(p)) {
        const drive = p[0].toLowerCase();
        const sub = p.substring(2).replace(/\\/g, '/');
        const mntPath = `/mnt/${drive}${sub.startsWith('/') ? sub : '/' + sub}`;
        if (fs.existsSync(mntPath)) return mntPath;
      }
      return path.resolve(p);
    }

    let resolvedPath = resolveLocalPath(raw);

    try {
      if (!fs.existsSync(resolvedPath)) {
        return reply.status(404).send({ error: `Directory not found: ${resolvedPath}` });
      }

      const stat = await fs.promises.stat(resolvedPath);
      if (!stat.isDirectory()) {
        resolvedPath = path.dirname(resolvedPath);
      }

      const dirents = await fs.promises.readdir(resolvedPath, { withFileTypes: true });
      let totalBytes = 0;
      let fileCount = 0;
      let dirCount = 0;

      const items = await Promise.all(
        dirents.map(async (d) => {
          const itemPath = path.join(resolvedPath, d.name);
          try {
            const itemStat = await fs.promises.stat(itemPath);
            const isDir = d.isDirectory();
            if (isDir) {
              dirCount++;
            } else {
              fileCount++;
              totalBytes += itemStat.size;
            }
            return {
              name: d.name,
              path: itemPath,
              type: (isDir ? 'directory' : 'file') as 'directory' | 'file',
              size: itemStat.size,
              modifiedAt: Math.floor(itemStat.mtimeMs / 1000),
              permissions: (itemStat.mode & parseInt('777', 8)).toString(8),
              filetype: getLocalFileTypeDescription(d.name, isDir),
            };
          } catch {
            const isDir = d.isDirectory();
            if (isDir) dirCount++; else fileCount++;
            return {
              name: d.name,
              path: itemPath,
              type: (isDir ? 'directory' : 'file') as 'directory' | 'file',
              size: 0,
              modifiedAt: 0,
              permissions: '000',
              filetype: getLocalFileTypeDescription(d.name, isDir),
            };
          }
        })
      );

      // Sort directories first (alphabetical), then files (alphabetical)
      items.sort((a, b) => {
        if (a.type === b.type) {
          return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
        }
        return a.type === 'directory' ? -1 : 1;
      });

      const parentPath = path.dirname(resolvedPath);

      // Pretty display path for Windows WSL users
      function formatDisplayPath(p: string): string {
        const mntMatch = p.match(/^\/mnt\/([a-zA-Z])(\/.*)?$/);
        if (mntMatch) {
          const drive = mntMatch[1].toUpperCase();
          const rest = (mntMatch[2] || '').replace(/\//g, '\\');
          return `${drive}:${rest || '\\'}`;
        }
        return p;
      }

      return reply.send({
        path: formatDisplayPath(resolvedPath),
        rawPath: resolvedPath,
        parentPath: parentPath !== resolvedPath ? formatDisplayPath(parentPath) : null,
        files: items,
        stats: {
          fileCount,
          dirCount,
          totalBytes,
        },
      });
    } catch (err: any) {
      return reply.status(500).send({ error: `Failed to read local directory: ${err.message}` });
    }
  });

  // POST /api/sftp/upload-local-file
  // Uploads a file from host local filesystem directly to remote SFTP
  app.post('/upload-local-file', async (request, reply) => {
    const db = getDb();
    const { connectionId, localPath, remotePath } = request.body as {
      connectionId: string;
      localPath: string;
      remotePath: string;
    };

    if (!localPath || !remotePath) {
      return reply.status(400).send({ error: 'localPath and remotePath are required' });
    }

    const conn = await getVerifiedConnection(db, connectionId, request.user!.sub);
    if (!conn) return reply.status(404).send({ error: 'Connection not found' });

    if (!fs.existsSync(localPath)) {
      return reply.status(404).send({ error: `Local file not found: ${localPath}` });
    }

    const creds = JSON.parse(decrypt(conn.encryptedCredentials));
    const { sftp, cleanup } = await getSftpClient(conn, creds, request.user!.sub);

    try {
      const readStream = fs.createReadStream(localPath);
      await sftp.put(readStream, remotePath);
      return reply.send({ success: true, message: `Uploaded ${path.basename(localPath)} to ${remotePath}` });
    } catch (err: any) {
      return reply.status(500).send({ error: `Failed to upload local file: ${err.message}` });
    } finally {
      await cleanup();
    }
  });

  // POST /api/sftp/download-to-local
  // Downloads a file from remote SFTP directly to host local directory
  app.post('/download-to-local', async (request, reply) => {
    const db = getDb();
    const { connectionId, remotePath, localDir } = request.body as {
      connectionId: string;
      remotePath: string;
      localDir: string;
    };

    if (!remotePath || !localDir) {
      return reply.status(400).send({ error: 'remotePath and localDir are required' });
    }

    const conn = await getVerifiedConnection(db, connectionId, request.user!.sub);
    if (!conn) return reply.status(404).send({ error: 'Connection not found' });

    const creds = JSON.parse(decrypt(conn.encryptedCredentials));
    const { sftp, cleanup } = await getSftpClient(conn, creds, request.user!.sub);

    try {
      if (!fs.existsSync(localDir)) {
        await fs.promises.mkdir(localDir, { recursive: true });
      }

      const filename = path.basename(remotePath);
      const targetLocalFile = path.join(localDir, filename);
      const writeStream = fs.createWriteStream(targetLocalFile);
      const readStream = sftp.createReadStream(remotePath);
      await pipeline(readStream, writeStream);
      return reply.send({ success: true, localPath: targetLocalFile, filename });
    } catch (err: any) {
      return reply.status(500).send({ error: `Failed to download file to local: ${err.message}` });
    } finally {
      await cleanup();
    }
  });

  // POST /api/sftp/local-mkdir
  app.post('/local-mkdir', async (request, reply) => {
    const { path: dirPath } = request.body as { path: string };
    if (!dirPath) return reply.status(400).send({ error: 'Directory path is required' });
    try {
      await fs.promises.mkdir(path.resolve(dirPath), { recursive: true });
      return reply.send({ success: true, path: dirPath });
    } catch (err: any) {
      return reply.status(500).send({ error: `Failed to create local directory: ${err.message}` });
    }
  });

  // GET /api/sftp/local-preview?path=&maxBytes=
  // Reads local file content for live preview
  app.get('/local-preview', async (request, reply) => {
    const { path: filePath, maxBytes } = request.query as { path: string; maxBytes?: string };
    if (!filePath) return reply.status(400).send({ error: 'Path is required' });
    const resolvedPath = path.resolve(filePath);

    try {
      if (!fs.existsSync(resolvedPath)) {
        return reply.status(404).send({ error: 'File not found' });
      }

      const stat = await fs.promises.stat(resolvedPath);
      const filename = path.basename(resolvedPath);
      const limitBytes = Math.min(parseInt(maxBytes || '', 10) || 2 * 1024 * 1024, 5 * 1024 * 1024);
      const isGz = (filename.endsWith('.gz') || filename.endsWith('.tgz')) && !filename.endsWith('.tar.gz');

      if (filename.endsWith('.gz')) {
        const stream = fs.createReadStream(resolvedPath).pipe(zlib.createGunzip());
        const { content, isTruncated, bytesRead } = await readStreamLimited(stream, limitBytes);
        return reply.send({
          name: filename,
          path: resolvedPath,
          size: bytesRead,
          totalSize: stat.size,
          content,
          isTruncated,
          isCompressed: true,
        });
      }

      const stream = fs.createReadStream(resolvedPath);
      const { content, isTruncated, bytesRead } = await readStreamLimited(stream, limitBytes);
      return reply.send({
        name: filename,
        path: resolvedPath,
        size: bytesRead,
        totalSize: stat.size,
        content,
        isTruncated,
        isCompressed: false,
      });
    } catch (err: any) {
      return reply.status(500).send({ error: `Failed to preview local file: ${err.message}` });
    }
  });

  // POST /api/sftp/local-rename
  app.post('/local-rename', async (request, reply) => {
    const { oldPath, newPath } = request.body as { oldPath: string; newPath: string };
    if (!oldPath || !newPath) return reply.status(400).send({ error: 'oldPath and newPath are required' });
    try {
      await fs.promises.rename(path.resolve(oldPath), path.resolve(newPath));
      return reply.send({ success: true, message: 'Renamed successfully' });
    } catch (err: any) {
      return reply.status(500).send({ error: `Failed to rename: ${err.message}` });
    }
  });

  // DELETE /api/sftp/local-delete
  app.delete('/local-delete', async (request, reply) => {
    const { path: itemPath, type } = request.body as { path: string; type?: 'file' | 'directory' };
    if (!itemPath) return reply.status(400).send({ error: 'Path is required' });
    try {
      const resolved = path.resolve(itemPath);
      const stat = await fs.promises.stat(resolved);
      if (stat.isDirectory()) {
        await fs.promises.rm(resolved, { recursive: true, force: true });
      } else {
        await fs.promises.unlink(resolved);
      }
      return reply.send({ success: true, message: 'Deleted successfully' });
    } catch (err: any) {
      return reply.status(500).send({ error: `Failed to delete: ${err.message}` });
    }
  });
}

function getLocalFileTypeDescription(name: string, isDirectory: boolean): string {
  if (isDirectory) return 'File folder';
  const lower = name.toLowerCase();
  if (lower.endsWith('.tar.gz') || lower.endsWith('.tgz')) return 'GZipped TAR Archive';
  if (lower.endsWith('.tar')) return 'TAR Archive';
  if (lower.endsWith('.gz')) return 'GZIP Compressed Archive';
  if (lower.endsWith('.zip')) return 'ZIP Archive';
  if (lower.endsWith('.csv')) return 'Microsoft Excel CSV / Delimited';
  if (lower.endsWith('.tsv')) return 'Tab Delimited File';
  if (lower.endsWith('.json')) return 'JSON Source File';
  if (lower.endsWith('.sql')) return 'SQL Query Script';
  if (lower.endsWith('.log')) return 'Log File';
  if (lower.endsWith('.txt')) return 'Text Document';
  if (lower.endsWith('.sh') || lower.endsWith('.bash')) return 'Shell Script';
  if (lower.endsWith('.png') || lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'Image File';
  if (lower.endsWith('.pdf')) return 'PDF Document';
  if (lower.endsWith('.conf') || lower.endsWith('.cfg') || lower.endsWith('.ini')) return 'Configuration File';
  if (lower.endsWith('.env')) return 'Environment Config';
  if (lower.endsWith('.yml') || lower.endsWith('.yaml')) return 'YAML Document';
  if (lower.endsWith('.xml')) return 'XML Document';
  const ext = name.split('.').pop();
  return ext ? `${ext.toUpperCase()} File` : 'File';
}
