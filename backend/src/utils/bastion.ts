import { Client, ClientChannel } from 'ssh2';
import { getDb } from '../db';
import { connections } from '../db/schema';
import { eq, and } from 'drizzle-orm';
import { decrypt } from './crypto';
import net from 'node:net';
import tls from 'node:tls';
import http from 'node:http';
import https from 'node:https';

export interface BastionConfig {
  reuseConnectionId?: string;
  host?: string;
  port?: number;
  username?: string;
  authType?: 'password' | 'key';
  password?: string;
  privateKey?: string;
  passphrase?: string;
}

export interface ResolvedBastion {
  host: string;
  port: number;
  username: string;
  password?: string;
  privateKey?: string;
  passphrase?: string;
}

/**
 * Resolves bastion credentials either from inline config or by fetching from a saved connection.
 */
export function resolveBastionConfig(
  bastionConfig?: BastionConfig,
  userId?: string
): ResolvedBastion | null {
  if (!bastionConfig) return null;

  // 1. If user selected an existing saved SSH connection as Jump Host
  if (bastionConfig.reuseConnectionId && userId) {
    const db = getDb();
    const conn = db.select()
      .from(connections)
      .where(and(eq(connections.id, bastionConfig.reuseConnectionId), eq(connections.userId, userId)))
      .get();

    if (conn && (conn.type === 'ssh' || conn.type === 'sftp')) {
      try {
        const creds = JSON.parse(decrypt(conn.encryptedCredentials));
        return {
          host: conn.host,
          port: conn.port || 22,
          username: conn.username,
          password: creds.password,
          privateKey: creds.privateKey,
          passphrase: creds.passphrase,
        };
      } catch {
        // Fallback to inline
      }
    }
  }

  // 2. Inline Bastion Host credentials
  if (bastionConfig.host && bastionConfig.username) {
    return {
      host: bastionConfig.host,
      port: bastionConfig.port || 22,
      username: bastionConfig.username,
      password: bastionConfig.password,
      privateKey: bastionConfig.privateKey,
      passphrase: bastionConfig.passphrase,
    };
  }

  return null;
}

/**
 * Connects to the Jump Host / Bastion server via SSH2.
 */
export function createBastionClient(bastion: ResolvedBastion): Promise<Client> {
  return new Promise((resolve, reject) => {
    const client = new Client();
    const timeout = setTimeout(() => {
      client.end();
      reject(new Error(`Jump Host (${bastion.host}:${bastion.port}) connection timed out after 10s`));
    }, 10000);

    client.on('ready', () => {
      clearTimeout(timeout);
      resolve(client);
    });

    client.on('error', (err) => {
      clearTimeout(timeout);
      reject(new Error(`Jump Host (${bastion.host}) authentication/network error: ${err.message}`));
    });

    client.connect({
      host: bastion.host,
      port: bastion.port,
      username: bastion.username,
      password: bastion.password,
      privateKey: bastion.privateKey,
      passphrase: bastion.passphrase,
      readyTimeout: 10000,
    });
  });
}

/**
 * Requests an outbound TCP forwarded stream through the connected Bastion host.
 */
export function openForwardedStream(
  bastionClient: Client,
  targetHost: string,
  targetPort: number
): Promise<ClientChannel> {
  return new Promise((resolve, reject) => {
    bastionClient.forwardOut(
      '127.0.0.1',
      0,
      targetHost,
      targetPort,
      (err, stream) => {
        if (err) {
          return reject(
            new Error(
              `Jump Host failed to forward traffic to target ${targetHost}:${targetPort} - ${err.message}`
            )
          );
        }
        resolve(stream);
      }
    );
  });
}

export interface BastionTunnel {
  localPort: number;
  close: () => Promise<void>;
}

/**
 * Creates a local TCP tunnel on an ephemeral loopback port that pipes directly
 * through the connected Bastion SSH client via forwardOut.
 * Works seamlessly with any HTTP/HTTPS, ClickHouse, MySQL, or PostgreSQL client.
 */
export function createBastionTunnel(
  bastionClient: Client,
  targetHost: string,
  targetPort: number
): Promise<BastionTunnel> {
  return new Promise((resolve, reject) => {
    const server = net.createServer((socket) => {
      bastionClient.forwardOut('127.0.0.1', 0, targetHost, targetPort, (err, stream) => {
        if (err) {
          socket.destroy();
          return;
        }
        socket.pipe(stream).pipe(socket);
        socket.on('error', () => stream.destroy());
        stream.on('error', () => socket.destroy());
      });
    });

    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as net.AddressInfo;
      resolve({
        localPort: addr.port,
        close: () =>
          new Promise<void>((res) => {
            server.close(() => res());
          }),
      });
    });

    server.on('error', reject);
  });
}

/**
 * Helper to create an HTTP/HTTPS Agent for ClickHouse or HTTP drivers that routes via the Jump Host.
 */
export function createBastionHttpAgent(
  bastionClient: Client,
  targetHost: string,
  targetPort: number,
  isHttps: boolean
): any {
  const isIp = net.isIP(targetHost) !== 0;
  const agentOptions: any = {
    keepAlive: false,
    createConnection: (_options: any, callback: (err: Error | null, stream?: any) => void) => {
      openForwardedStream(bastionClient, targetHost, targetPort)
        .then((stream) => {
          if (isHttps) {
            const tlsSocket = tls.connect(
              {
                socket: stream,
                rejectUnauthorized: false,
                checkServerIdentity: () => undefined,
                ...(isIp ? {} : { servername: targetHost }),
              },
              () => callback(null, tlsSocket)
            );
            tlsSocket.on('error', (err) => callback(err));
          } else {
            callback(null, stream);
          }
        })
        .catch((err) => callback(err));
    },
  };

  if (isHttps) {
    agentOptions.rejectUnauthorized = false;
    return new https.Agent(agentOptions);
  }
  return new http.Agent(agentOptions);
}

