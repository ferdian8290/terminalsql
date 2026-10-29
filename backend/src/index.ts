import 'dotenv/config';
import Fastify from 'fastify';
import fastifyWebsocket from '@fastify/websocket';
import fastifyCors from '@fastify/cors';
import fastifyCookie from '@fastify/cookie';
import fastifyRateLimit from '@fastify/rate-limit';
import fastifyMultipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import path from 'path';
import fs from 'fs';
import { authRoutes } from './auth/routes.js';
import { connectionRoutes } from './connections/routes.js';
import { sshRoutes } from './modules/ssh/routes.js';
import { databaseRoutes } from './modules/database/routes.js';
import { sftpRoutes } from './modules/sftp/routes.js';
import { initDatabase } from './db/index.js';

const PORT = parseInt(process.env.PORT || '5176');
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || 'http://localhost:5176,http://localhost:5175,http://localhost:3002').split(',');

const app = Fastify({
  logger: {
    level: process.env.NODE_ENV === 'production' ? 'warn' : 'info',
    transport: process.env.NODE_ENV !== 'production' ? {
      target: 'pino-pretty',
      options: { colorize: true }
    } : undefined,
  },
});

async function bootstrap() {
  // Security headers
  app.addHook('onSend', async (request, reply) => {
    reply.header('X-Frame-Options', 'DENY');
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-XSS-Protection', '1; mode=block');
    reply.header('Referrer-Policy', 'strict-origin-when-cross-origin');
    reply.header(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self' data:; img-src 'self' data: blob:;"
    );
  });

  await app.register(fastifyCors, {
    origin: (origin, cb) => {
      // Allow same-origin requests (no Origin header) and requests from ALLOWED_ORIGINS
      if (!origin || ALLOWED_ORIGINS.some((o) => o.trim() === origin)) {
        cb(null, true);
      } else {
        cb(new Error(`CORS: Origin "${origin}" not allowed`), false);
      }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  });

  await app.register(fastifyCookie, {
    secret: process.env.JWT_SECRET || 'fallback-secret',
  });

  await app.register(fastifyRateLimit, {
    global: false,
    max: 100,
    timeWindow: '1 minute',
  });

  await app.register(fastifyWebsocket);

  // Allow empty body for requests with application/json Content-Type
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => {
    try {
      const str = typeof body === 'string' ? body.trim() : '';
      const json = str.length > 0 ? JSON.parse(str) : {};
      done(null, json);
    } catch (err: any) {
      err.statusCode = 400;
      done(err, undefined);
    }
  });
  // Global error handler
  app.setErrorHandler((error, request, reply) => {
    request.log.error(error);
    const statusCode = error.statusCode || 500;
    reply.status(statusCode).send({
      error: error.name || 'Error',
      message: error.message || 'An unexpected error occurred',
    });
  });

  await app.register(fastifyMultipart, {
    limits: {
      fileSize: 500 * 1024 * 1024, // 500MB max file upload
    },
  });

  // Init SQLite database
  await initDatabase();

  // Routes
  await app.register(authRoutes, { prefix: '/api/auth' });
  await app.register(connectionRoutes, { prefix: '/api/connections' });
  await app.register(sshRoutes, { prefix: '/api/ssh' });
  await app.register(databaseRoutes, { prefix: '/api/db' });
  await app.register(sftpRoutes, { prefix: '/api/sftp' });

  // Health check
  app.get('/api/health', async () => ({
    status: 'ok',
    version: '1.3.0',
    timestamp: new Date().toISOString(),
  }));

  // Serve production frontend bundle if built
  const candidateFrontendPaths = [
    path.resolve(process.cwd(), '../frontend/dist'),
    path.resolve(process.cwd(), 'frontend/dist'),
  ];
  const frontendDist = candidateFrontendPaths.find((p) => fs.existsSync(p));

  if (frontendDist) {
    await app.register(fastifyStatic, {
      root: frontendDist,
      prefix: '/',
      wildcard: false,
    });

    app.setNotFoundHandler((req, reply) => {
      if (req.raw.url?.startsWith('/api')) {
        reply.status(404).send({ error: 'Endpoint not found' });
      } else {
        reply.sendFile('index.html');
      }
    });
    console.log(`📦 Serving static frontend from: ${frontendDist}`);
  }

  try {
    await app.listen({ port: PORT, host: '0.0.0.0' });
    console.log(`\n🚀 TerminalSQL Backend running at http://localhost:${PORT}`);
    console.log(`📡 WebSocket ready at ws://localhost:${PORT}`);
    console.log(`🔒 Environment: ${process.env.NODE_ENV || 'development'}\n`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

bootstrap();
