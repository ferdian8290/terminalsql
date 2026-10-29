import { FastifyInstance } from 'fastify';
import { Client, ClientChannel } from 'ssh2';
import { eq } from 'drizzle-orm';
import crypto from 'crypto';
import { getDb } from '../../db/index.js';
import { connections } from '../../db/schema.js';
import { verifyToken } from '../../utils/jwt.js';
import { decrypt } from '../../utils/crypto.js';
import { resolveBastionConfig, createBastionClient, openForwardedStream } from '../../utils/bastion.js';

// Persistent SSH Session Registry with 2-minute (120s) detached grace period on refresh
interface PersistentSession {
  token: string;
  key: string;
  userId: string;
  connectionId: string;
  sshClient: Client;
  bastionClient?: Client;
  stream: any;
  currentSocket?: any;
  httpListeners: Set<(payload: any) => void>;
  outputBuffer: string[];
  totalBufferLength: number;
  disconnectTimer?: NodeJS.Timeout;
  explicitExit: boolean;
}

const persistentSessions = new Map<string, PersistentSession>(); // key -> session
const sessionTokenMap = new Map<string, PersistentSession>();    // token -> session

function cleanSession(session: PersistentSession) {
  if (session.disconnectTimer) {
    clearTimeout(session.disconnectTimer);
    session.disconnectTimer = undefined;
  }
  persistentSessions.delete(session.key);
  sessionTokenMap.delete(session.token);
  try { session.stream?.close(); } catch {}
  try { session.sshClient?.end(); } catch {}
  try { session.bastionClient?.end(); } catch {}
}

async function getOrCreateSshSession(connectionId: string, tabId: string, userId: string): Promise<PersistentSession> {
  const sessionKey = `${userId}:${connectionId}:${tabId}`;

  // 1. Reconnect check
  if (persistentSessions.has(sessionKey)) {
    const existing = persistentSessions.get(sessionKey)!;
    if (existing.stream && existing.stream.writable) {
      if (existing.disconnectTimer) {
        clearTimeout(existing.disconnectTimer);
        existing.disconnectTimer = undefined;
      }
      existing.explicitExit = false;
      return existing;
    }
  }

  // 2. Query connection from SQLite database
  const db = getDb();
  const conn = db.select()
    .from(connections)
    .where(eq(connections.id, connectionId))
    .get();

  if (!conn) {
    throw new Error('SSH connection configuration not found in database');
  }

  let creds: Record<string, any>;
  try {
    creds = JSON.parse(decrypt(conn.encryptedCredentials));
  } catch (err: any) {
    throw new Error(`Failed to decrypt credentials: ${err.message}`);
  }

  const sshClient = new Client();
  const token = crypto.randomUUID();
  let bastionClient: Client | undefined;

  return new Promise<PersistentSession>(async (resolve, reject) => {
    let settled = false;

    sshClient.on('ready', () => {
      sshClient.shell({ term: 'xterm-256color' }, (err, stream) => {
        if (err) {
          if (!settled) { settled = true; reject(err); }
          try { sshClient.end(); } catch {}
          try { bastionClient?.end(); } catch {}
          return;
        }

        const session: PersistentSession = {
          token,
          key: sessionKey,
          userId,
          connectionId,
          sshClient,
          bastionClient,
          stream,
          httpListeners: new Set(),
          outputBuffer: [],
          totalBufferLength: 0,
          explicitExit: false,
        };

        persistentSessions.set(sessionKey, session);
        sessionTokenMap.set(token, session);

        // SSH output -> WebSocket & HTTP Streaming listeners + ring buffer
        const handleData = (chunk: Buffer) => {
          const str = chunk.toString('utf-8');
          session.outputBuffer.push(str);
          session.totalBufferLength += str.length;

          while (session.totalBufferLength > 200000 && session.outputBuffer.length > 10) {
            const removed = session.outputBuffer.shift();
            if (removed) session.totalBufferLength -= removed.length;
          }

          // Broadcast to active WebSocket (if connected)
          if (session.currentSocket?.readyState === 1) {
            session.currentSocket.send(JSON.stringify({ type: 'data', data: str }));
          }

          // Broadcast to active HTTP Stream listeners
          for (const listener of session.httpListeners) {
            try { listener({ type: 'data', data: str }); } catch {}
          }
        };

        stream.on('data', handleData);
        stream.stderr.on('data', handleData);

        stream.on('close', () => {
          if (session.currentSocket?.readyState === 1) {
            try {
              session.currentSocket.send(JSON.stringify({ type: 'status', message: 'Connection closed by remote host' }));
              session.currentSocket.close(1000, 'SSH session ended');
            } catch {}
          }
          for (const listener of session.httpListeners) {
            try { listener({ type: 'status', message: 'Connection closed by remote host' }); } catch {}
          }
          cleanSession(session);
        });

        if (!settled) {
          settled = true;
          resolve(session);
        }
      });
    });

    sshClient.on('error', (err) => {
      if (!settled) {
        settled = true;
        reject(err);
      }
      const sess = persistentSessions.get(sessionKey);
      if (sess) {
        if (sess.currentSocket?.readyState === 1) {
          try { sess.currentSocket.send(JSON.stringify({ type: 'error', message: `SSH Error: ${err.message}` })); } catch {}
        }
        for (const listener of sess.httpListeners) {
          try { listener({ type: 'error', message: `SSH Error: ${err.message}` }); } catch {}
        }
        setTimeout(() => cleanSession(sess), 1500);
      }
    });

    // Start connection (direct or through Jump Host)
    try {
      let forwardedStream: ClientChannel | undefined;
      if (creds.useBastion && creds.bastion) {
        const resolved = resolveBastionConfig(creds.bastion, conn.userId);
        if (resolved) {
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
      if (!settled) { settled = true; reject(err); }
      try { sshClient.end(); } catch {}
      try { bastionClient?.end(); } catch {}
    }
  });
}

export async function sshRoutes(app: FastifyInstance) {
  // -------------------------------------------------------------
  // 1. PRIMARY TRANSPORT: WebSocket (/api/ssh/connect/:connectionId)
  // -------------------------------------------------------------
  app.get('/connect/:connectionId', { websocket: true } as any, async (socket: any, request: any) => {
    const { connectionId } = request.params as { connectionId: string };
    const query = (request.query as any) || {};
    const tabId = query.tabId || `${connectionId}-${Date.now()}`;

    let userId: string = 'default-user';
    try {
      let token = request.cookies['auth_token'] || query.token;
      if (!token && request.headers.authorization?.startsWith('Bearer ')) {
        token = request.headers.authorization.substring(7).trim();
      }
      if (token) {
        const payload = await verifyToken(token);
        if (payload?.sub) userId = payload.sub;
      }
    } catch {}

    try {
      const session = await getOrCreateSshSession(connectionId, tabId, userId);
      session.currentSocket = socket;
      session.explicitExit = false;

      socket.send(JSON.stringify({
        type: 'connected',
        message: 'Connected to SSH shell',
      }));

      // Replay output buffer to restore screen
      if (session.outputBuffer.length > 0) {
        socket.send(JSON.stringify({
          type: 'data',
          data: session.outputBuffer.join(''),
        }));
      }

      socket.on('message', (raw: Buffer | string) => {
        const msg = raw.toString();
        if (msg.length > 4096) return;

        try {
          const parsed = JSON.parse(msg);
          if (parsed.type === 'disconnect') {
            session.explicitExit = true;
            cleanSession(session);
          } else if (parsed.type === 'input') {
            session.stream.write(parsed.data);
          } else if (parsed.type === 'resize') {
            session.stream.setWindow(parsed.rows, parsed.cols, 0, 0);
          }
        } catch {
          session.stream.write(msg);
        }
      });

      socket.on('close', () => {
        if (session.explicitExit) {
          cleanSession(session);
        } else {
          // Unscheduled disconnect (browser refresh): Keep alive for 120 seconds!
          if (!session.disconnectTimer) {
            session.disconnectTimer = setTimeout(() => {
              cleanSession(session);
            }, 120000);
          }
        }
      });
    } catch (err: any) {
      socket.send(JSON.stringify({ type: 'error', message: err.message || 'SSH connection failed' }));
      setTimeout(() => { try { socket.close(1000, err.message); } catch {} }, 1500);
    }
  });

  // -------------------------------------------------------------
  // 2. CORPORATE PROXY FALLBACK TRANSPORT: HTTP Streaming (SSE)
  // Bypasses any firewall or proxy blocking WebSocket (Error 1006)
  // -------------------------------------------------------------

  // POST /api/ssh/http/connect/:connectionId
  app.post('/http/connect/:connectionId', async (request, reply) => {
    const { connectionId } = request.params as { connectionId: string };
    const body = (request.body as any) || {};
    const query = (request.query as any) || {};
    const tabId = body.tabId || query.tabId || `${connectionId}-${Date.now()}`;

    let userId: string = 'default-user';
    try {
      let token = request.cookies['auth_token'] || query.token;
      if (!token && request.headers.authorization?.startsWith('Bearer ')) {
        token = request.headers.authorization.substring(7).trim();
      }
      if (token) {
        const payload = await verifyToken(token);
        if (payload?.sub) userId = payload.sub;
      }
    } catch {}

    try {
      const session = await getOrCreateSshSession(connectionId, tabId, userId);
      return reply.send({
        ok: true,
        sessionToken: session.token,
        connectionId,
        tabId,
      });
    } catch (err: any) {
      return reply.status(500).send({
        ok: false,
        error: err.message || 'SSH connection failed',
      });
    }
  });

  // GET /api/ssh/http/stream/:token
  app.get('/http/stream/:token', async (request, reply) => {
    const { token } = request.params as { token: string };
    const session = sessionTokenMap.get(token);

    if (!session || !session.stream) {
      return reply.status(404).send({ error: 'SSH session not found or expired' });
    }

    if (session.disconnectTimer) {
      clearTimeout(session.disconnectTimer);
      session.disconnectTimer = undefined;
    }

    // Set standard Server-Sent Events headers (passed by all corporate proxies)
    reply.hijack();
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no', // Disable proxy buffering (Nginx, BlueCoat, Fortinet)
    });
    reply.raw.flushHeaders?.();

    // Send 2KB initial comment padding to immediately defeat proxy buffering
    reply.raw.write(`: ${' '.repeat(2048)}\n\n`);

    // Send connected event
    reply.raw.write(`data: ${JSON.stringify({ type: 'connected', message: 'Connected' })}\n\n`);

    // Replay terminal buffer history
    if (session.outputBuffer.length > 0) {
      reply.raw.write(`data: ${JSON.stringify({ type: 'data', data: session.outputBuffer.join('') })}\n\n`);
    }

    // Subscribe to new real-time SSH data
    const listener = (payload: any) => {
      try {
        reply.raw.write(`data: ${JSON.stringify(payload)}\n\n`);
      } catch {}
    };

    session.httpListeners.add(listener);

    // Heartbeat ping every 15s to keep corporate proxy socket open
    const pingTimer = setInterval(() => {
      try {
        reply.raw.write(`: ping\n\n`);
      } catch {
        clearInterval(pingTimer);
      }
    }, 15000);

    request.raw.on('close', () => {
      clearInterval(pingTimer);
      session.httpListeners.delete(listener);

      // Grace period if all listeners disconnected
      if (session.httpListeners.size === 0 && !session.currentSocket) {
        if (!session.disconnectTimer) {
          session.disconnectTimer = setTimeout(() => {
            cleanSession(session);
          }, 120000); // 2 minutes grace period
        }
      }
    });
  });

  // POST /api/ssh/http/input/:token
  app.post('/http/input/:token', async (request, reply) => {
    const { token } = request.params as { token: string };
    const body = (request.body as any) || {};
    const session = sessionTokenMap.get(token);

    if (!session || !session.stream) {
      return reply.status(404).send({ error: 'SSH session not found' });
    }

    const { type, data, cols, rows } = body;

    if (type === 'input' && typeof data === 'string') {
      session.stream.write(data);
    } else if (type === 'resize' && cols && rows) {
      try { session.stream.setWindow(rows, cols, 0, 0); } catch {}
    } else if (type === 'disconnect') {
      session.explicitExit = true;
      cleanSession(session);
    }

    return reply.send({ ok: true });
  });

  // GET /api/ssh/sessions - active sessions count
  app.get('/sessions', async (request, reply) => {
    return reply.send({ activeSessions: persistentSessions.size });
  });
}
