import { FastifyRequest, FastifyReply } from 'fastify';
import { verifyToken, JWTPayload } from '../utils/jwt.js';

declare module 'fastify' {
  interface FastifyRequest {
    user?: JWTPayload;
  }
}

export async function authenticate(request: FastifyRequest, reply: FastifyReply) {
  try {
    let token = request.cookies['auth_token'];

    // Fallback: check Authorization Bearer header
    if (!token && request.headers.authorization) {
      const authHeader = request.headers.authorization;
      if (authHeader.startsWith('Bearer ')) {
        token = authHeader.substring(7).trim();
      }
    }

    if (!token) {
      return reply.status(401).send({ error: 'Unauthorized', message: 'No session found' });
    }

    const payload = await verifyToken(token);
    request.user = payload;
  } catch {
    return reply.status(401).send({ error: 'Unauthorized', message: 'Invalid or expired session' });
  }
}
