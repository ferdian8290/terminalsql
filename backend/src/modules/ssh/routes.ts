import { FastifyInstance } from 'fastify';
import { Client, ClientChannel } from 'ssh2';
import { and, eq } from 'drizzle-orm';
import { getDb } from '../../db/index.js';
import { connections } from '../../db/schema.js';
import { verifyToken } from '../../utils/jwt.js';
import { decrypt } from '../../utils/crypto.js';
import { resolveBastionConfig, createBastionClient, openForwardedStream } from '../../utils/bastion.js';

// Persistent SSH Session Registry with 2-minute (120s) detached grace period on refresh
interface PersistentSession {
  key: string;
  userId: string;
  connectionId: string;
  sshClient: Client;
  bastionClient?: Client;
  stream: any;
  currentSocket?: any;
  outputBuffer: string[];
  totalBufferLength: number;
  disconnectTimer?: NodeJS.Timeout;
  explicitExit: boolean;
}

const persistentSessions = new Map<string, PersistentSession>();

export async function sshRoutes(app: FastifyInstance) {
  // WebSocket: GET /api/ssh/connect/:connectionId
  app.get('/connect/:connectionId', { websocket: true } as any, async (socket: any, request: any) => {
    const db = getDb();
    const { connectionId } = request.params as { connectionId: string };
    const query = (request.query as any) || {};
    const tabId = query.tabId || `${connectionId}-${Date.now()}`;

    let userId: string;
    try {
      let token = request.cookies['auth_token'];
      if (!token && query.token) {
        token = query.token;
      }
      if (!token && request.headers.authorization) {
        const authHeader = request.headers.authorization;
        if (authHeader.startsWith('Bearer ')) {
          token = authHeader.substring(7).trim();
        }
      }
      if (!token) throw new Error('No auth token');
      const payload = await verifyToken(token);
      userId = payload.sub;
    } catch {
      socket.send(JSON.stringify({ type: 'error', message: 'Unauthorized' }));
      socket.close(4001, 'Unauthorized');
      return;
    }

    // Validate Origin header (prevent CSWSH)
    const origin = request.headers.origin;
    const hostHeader = request.headers.host;
    const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'http://localhost:5176,http://localhost:5175,http://localhost:3002').split(',');
    const isSameHost = origin && hostHeader && (origin === `http://${hostHeader}` || origin === `https://${hostHeader}`);
    if (origin && !isSameHost && !allowedOrigins.includes(origin)) {
      socket.send(JSON.stringify({ type: 'error', message: 'Forbidden origin' }));
      socket.close(4003, 'Forbidden');
      return;
    }

    const sessionKey = `${userId}:${connectionId}:${tabId}`;

    // --- RECONNECT CHECK: Does an existing live detached session exist for this tab? ---
    if (persistentSessions.has(sessionKey)) {
      const existing = persistentSessions.get(sessionKey)!;
      if (existing.stream && existing.stream.writable) {
        // Cancel the 2-minute disconnect countdown
        if (existing.disconnectTimer) {
          clearTimeout(existing.disconnectTimer);
          existing.disconnectTimer = undefined;
        }

        existing.currentSocket = socket;
        existing.explicitExit = false;

        socket.send(JSON.stringify({
          type: 'connected',
          message: 'Reconnected to active session (preserved across refresh)',
        }));

        // Replay output buffer to restore terminal screen
        if (existing.outputBuffer.length > 0) {
          socket.send(JSON.stringify({
            type: 'data',
            data: existing.outputBuffer.join(''),
          }));
        }

        // Listen for new browser input
        socket.on('message', (raw: Buffer | string) => {
          const msg = raw.toString();
          if (msg.length > 4096) return;

          try {
            const parsed = JSON.parse(msg);
            if (parsed.type === 'disconnect') {
              existing.explicitExit = true;
              try { existing.stream.close(); } catch {}
              try { existing.sshClient.end(); } catch {}
              try { existing.bastionClient?.end(); } catch {}
              persistentSessions.delete(sessionKey);
            } else if (parsed.type === 'input') {
              existing.stream.write(parsed.data);
            } else if (parsed.type === 'resize') {
              existing.stream.setWindow(parsed.rows, parsed.cols, 0, 0);
            }
          } catch {
            existing.stream.write(msg);
          }
        });

        socket.on('close', () => {
          if (existing.explicitExit) {
            try { existing.stream.close(); } catch {}
            try { existing.sshClient.end(); } catch {}
            try { existing.bastionClient?.end(); } catch {}
            persistentSessions.delete(sessionKey);
          } else {
            // Unexpected close (e.g. refresh F5 again): Start 2-minute grace timer
            if (!existing.disconnectTimer) {
              existing.disconnectTimer = setTimeout(() => {
                try { existing.stream.close(); } catch {}
                try { existing.sshClient.end(); } catch {}
                try { existing.bastionClient?.end(); } catch {}
                persistentSessions.delete(sessionKey);
              }, 120000); // 2 minutes grace period
            }
          }
        });

        return;
      }
    }

    // --- NEW SESSION INITIALIZATION ---
    const conn = db.select()
      .from(connections)
      .where(and(eq(connections.id, connectionId), eq(connections.userId, userId)))
      .get();

    if (!conn) {
      socket.send(JSON.stringify({ type: 'error', message: 'Connection not found' }));
      socket.close(4004, 'Not found');
      return;
    }

    let creds: Record<string, any>;
    try {
      creds = JSON.parse(decrypt(conn.encryptedCredentials));
    } catch {
      socket.send(JSON.stringify({ type: 'error', message: 'Failed to decrypt credentials' }));
      socket.close();
      return;
    }

    const sshClient = new Client();
    let bastionClient: Client | undefined;

    socket.send(JSON.stringify({ type: 'status', message: 'Connecting...' }));

    sshClient.on('ready', () => {
      socket.send(JSON.stringify({ type: 'status', message: 'Connected' }));

      sshClient.shell({ term: 'xterm-256color' }, (err, stream) => {
        if (err) {
          socket.send(JSON.stringify({ type: 'error', message: err.message }));
          sshClient.end();
          bastionClient?.end();
          return;
        }

        const session: PersistentSession = {
          key: sessionKey,
          userId,
          connectionId,
          sshClient,
          bastionClient,
          stream,
          currentSocket: socket,
          outputBuffer: [],
          totalBufferLength: 0,
          explicitExit: false,
        };
        persistentSessions.set(sessionKey, session);

        // SSH output → browser and persistent ring-buffer
        const handleData = (chunk: Buffer) => {
          const str = chunk.toString('utf-8');
          session.outputBuffer.push(str);
          session.totalBufferLength += str.length;

          // Cap ring buffer at ~200KB of terminal history
          while (session.totalBufferLength > 200000 && session.outputBuffer.length > 10) {
            const removed = session.outputBuffer.shift();
            if (removed) session.totalBufferLength -= removed.length;
          }

          if (session.currentSocket?.readyState === 1) { // OPEN
            session.currentSocket.send(JSON.stringify({ type: 'data', data: str }));
          }
        };

        stream.on('data', handleData);
        stream.stderr.on('data', handleData);

        // Browser input → SSH
        socket.on('message', (raw: Buffer | string) => {
          const msg = raw.toString();
          if (msg.length > 4096) return;

          try {
            const parsed = JSON.parse(msg);
            if (parsed.type === 'disconnect') {
              session.explicitExit = true;
              try { stream.close(); } catch {}
              try { sshClient.end(); } catch {}
              try { bastionClient?.end(); } catch {}
              persistentSessions.delete(sessionKey);
            } else if (parsed.type === 'input') {
              stream.write(parsed.data);
            } else if (parsed.type === 'resize') {
              stream.setWindow(parsed.rows, parsed.cols, 0, 0);
            }
          } catch {
            stream.write(msg);
          }
        });

        stream.on('close', () => {
          if (session.currentSocket?.readyState === 1) {
            session.currentSocket.send(JSON.stringify({ type: 'status', message: 'Connection closed by remote host' }));
            session.currentSocket.close(1000, 'SSH session ended');
          }
          if (session.disconnectTimer) clearTimeout(session.disconnectTimer);
          persistentSessions.delete(sessionKey);
          try { sshClient.end(); } catch {}
          try { bastionClient?.end(); } catch {}
        });

        socket.on('close', () => {
          if (session.explicitExit) {
            try { stream.close(); } catch {}
            try { sshClient.end(); } catch {}
            try { bastionClient?.end(); } catch {}
            persistentSessions.delete(sessionKey);
          } else {
            // Unscheduled disconnect (browser refresh): Keep alive for 120 seconds!
            if (!session.disconnectTimer) {
              session.disconnectTimer = setTimeout(() => {
                try { stream.close(); } catch {}
                try { sshClient.end(); } catch {}
                try { bastionClient?.end(); } catch {}
                persistentSessions.delete(sessionKey);
              }, 120000); // 2 minutes grace period
            }
          }
        });
      });
    });

    sshClient.on('error', (err) => {
      socket.send(JSON.stringify({ type: 'error', message: `SSH Error: ${err.message}` }));
      persistentSessions.delete(sessionKey);
      try { bastionClient?.end(); } catch {}
      try { socket.close(); } catch {}
    });

    // Start connection (direct or through Jump Host)
    (async () => {
      try {
        let forwardedStream: ClientChannel | undefined;
        if (creds.useBastion && creds.bastion) {
          const resolved = resolveBastionConfig(creds.bastion, conn.userId);
          if (resolved) {
            socket.send(JSON.stringify({ type: 'status', message: `Tunneling via Jump Host (${resolved.host})...` }));
            bastionClient = await createBastionClient(resolved);
            forwardedStream = await openForwardedStream(bastionClient, conn.host, conn.port || 22);
          }
        }

        sshClient.connect({
          sock: forwardedStream || undefined,
          host: forwardedStream ? undefined : conn.host,
          port: forwardedStream ? undefined : conn.port,
          username: conn.username,
          password: creds.password,
          privateKey: creds.privateKey,
          passphrase: creds.passphrase,
          readyTimeout: 15000,
          keepaliveInterval: 30000,
        });
      } catch (err: any) {
        socket.send(JSON.stringify({ type: 'error', message: `Jump Host error: ${err.message}` }));
        persistentSessions.delete(sessionKey);
        try { bastionClient?.end(); } catch {}
        try { socket.close(); } catch {}
      }
    })();
  });

  // GET /api/ssh/sessions - active sessions count
  app.get('/sessions', async (request, reply) => {
    return reply.send({ activeSessions: persistentSessions.size });
  });
}
