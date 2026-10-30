import { Readable } from 'stream';
import zlib from 'zlib';

export interface ArchiveEntry {
  name: string;
  size: number;
  mtime: number;
  type: 'file' | 'directory';
  previewSnippet?: string;
}

/**
 * Reads a stream up to maxBytes and decodes as UTF-8 string.
 */
export async function readStreamLimited(
  stream: Readable,
  maxBytes = 2 * 1024 * 1024
): Promise<{ content: string; isTruncated: boolean; bytesRead: number }> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let bytesRead = 0;
    let isTruncated = false;

    function cleanup() {
      stream.removeListener('data', onData);
      stream.removeListener('end', onEnd);
      stream.removeListener('error', onError);
    }

    function onData(chunk: Buffer) {
      if (bytesRead + chunk.length > maxBytes) {
        const needed = maxBytes - bytesRead;
        if (needed > 0) {
          chunks.push(chunk.subarray(0, needed));
          bytesRead += needed;
        }
        isTruncated = true;
        cleanup();
        try {
          if (typeof (stream as any).destroy === 'function') {
            (stream as any).destroy();
          }
        } catch {}
        resolve({
          content: Buffer.concat(chunks).toString('utf8'),
          isTruncated,
          bytesRead,
        });
      } else {
        chunks.push(chunk);
        bytesRead += chunk.length;
      }
    }

    function onEnd() {
      cleanup();
      resolve({
        content: Buffer.concat(chunks).toString('utf8'),
        isTruncated,
        bytesRead,
      });
    }

    function onError(err: any) {
      cleanup();
      reject(err);
    }

    stream.on('data', onData);
    stream.on('end', onEnd);
    stream.on('error', onError);
  });
}

/**
 * Parses TAR entries from a stream without writing to disk.
 */
export async function parseTarEntries(
  stream: Readable,
  maxEntries = 500
): Promise<ArchiveEntry[]> {
  return new Promise((resolve, reject) => {
    let buffer = Buffer.alloc(0);
    const entries: ArchiveEntry[] = [];
    let isDone = false;

    function finish() {
      if (isDone) return;
      isDone = true;
      try {
        if (typeof (stream as any).destroy === 'function') {
          (stream as any).destroy();
        }
      } catch {}
      resolve(entries);
    }

    stream.on('data', (chunk: Buffer) => {
      if (isDone) return;
      buffer = Buffer.concat([buffer, chunk]);

      while (buffer.length >= 512) {
        const header = buffer.subarray(0, 512);

        // Check for end-of-archive marker (512 consecutive zero bytes)
        let isZeroBlock = true;
        for (let i = 0; i < 512; i++) {
          if (header[i] !== 0) {
            isZeroBlock = false;
            break;
          }
        }
        if (isZeroBlock) {
          buffer = buffer.subarray(512);
          continue;
        }

        let name = header.toString('utf8', 0, 100).replace(/\0.*$/, '').trim();
        const prefix = header.toString('utf8', 345, 500).replace(/\0.*$/, '').trim();
        if (prefix) name = `${prefix}/${name}`;

        const sizeStr = header.toString('utf8', 124, 136).replace(/\0.*$/, '').trim();
        const size = parseInt(sizeStr, 8) || 0;
        const mtimeStr = header.toString('utf8', 136, 148).replace(/\0.*$/, '').trim();
        const mtime = parseInt(mtimeStr, 8) || 0;
        const typeflag = String.fromCharCode(header[156]);
        const type: 'file' | 'directory' = typeflag === '5' ? 'directory' : 'file';

        const paddedSize = Math.ceil(size / 512) * 512;
        const totalBlockSize = 512 + paddedSize;

        if (buffer.length < totalBlockSize) {
          // Need more data from stream
          break;
        }

        if (name) {
          const previewSnippet =
            type === 'file' && size > 0
              ? buffer.subarray(512, 512 + Math.min(size, 256)).toString('utf8')
              : undefined;

          entries.push({ name, size, mtime, type, previewSnippet });
        }

        buffer = buffer.subarray(totalBlockSize);

        if (entries.length >= maxEntries) {
          finish();
          return;
        }
      }
    });

    stream.on('end', () => finish());
    stream.on('error', (err) => {
      if (!isDone) {
        isDone = true;
        reject(err);
      }
    });
  });
}

/**
 * Extracts a specific entry from a TAR stream up to maxBytes.
 */
export async function extractTarEntryContent(
  stream: Readable,
  targetEntry: string,
  maxBytes = 2 * 1024 * 1024
): Promise<{ content: string; isTruncated: boolean; size: number } | null> {
  return new Promise((resolve, reject) => {
    let buffer = Buffer.alloc(0);
    let isDone = false;

    function finish(result: { content: string; isTruncated: boolean; size: number } | null) {
      if (isDone) return;
      isDone = true;
      try {
        if (typeof (stream as any).destroy === 'function') {
          (stream as any).destroy();
        }
      } catch {}
      resolve(result);
    }

    stream.on('data', (chunk: Buffer) => {
      if (isDone) return;
      buffer = Buffer.concat([buffer, chunk]);

      while (buffer.length >= 512) {
        const header = buffer.subarray(0, 512);

        let isZeroBlock = true;
        for (let i = 0; i < 512; i++) {
          if (header[i] !== 0) {
            isZeroBlock = false;
            break;
          }
        }
        if (isZeroBlock) {
          buffer = buffer.subarray(512);
          continue;
        }

        let name = header.toString('utf8', 0, 100).replace(/\0.*$/, '').trim();
        const prefix = header.toString('utf8', 345, 500).replace(/\0.*$/, '').trim();
        if (prefix) name = `${prefix}/${name}`;

        const sizeStr = header.toString('utf8', 124, 136).replace(/\0.*$/, '').trim();
        const size = parseInt(sizeStr, 8) || 0;
        const paddedSize = Math.ceil(size / 512) * 512;
        const totalBlockSize = 512 + paddedSize;

        if (name === targetEntry || name.endsWith(`/${targetEntry}`) || targetEntry.endsWith(name)) {
          const sliceBytes = Math.min(size, maxBytes);
          if (buffer.length < 512 + sliceBytes) {
            // Need more data for this file
            break;
          }
          const content = buffer.subarray(512, 512 + sliceBytes).toString('utf8');
          finish({
            content,
            isTruncated: size > maxBytes,
            size,
          });
          return;
        }

        if (buffer.length < totalBlockSize) {
          break;
        }

        buffer = buffer.subarray(totalBlockSize);
      }
    });

    stream.on('end', () => finish(null));
    stream.on('error', (err) => {
      if (!isDone) {
        isDone = true;
        reject(err);
      }
    });
  });
}

