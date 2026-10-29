import { FastifyInstance } from 'fastify';
import argon2 from 'argon2';
import speakeasy from 'speakeasy';
import QRCode from 'qrcode';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { getDb } from '../db/index.js';
import { users } from '../db/schema.js';
import { signToken, setAuthCookie, clearAuthCookie } from '../utils/jwt.js';
import { authenticate } from '../middleware/auth.js';

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  totpCode: z.string().length(6).optional(),
});

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, 'Password must be at least 8 characters'),
});

export async function authRoutes(app: FastifyInstance) {
  // Rate limit auth routes strictly
  const rateLimitConfig = {
    config: {
      rateLimit: {
        max: 5,
        timeWindow: '15 minutes',
        errorResponseBuilder: () => ({
          error: 'Too Many Requests',
          message: 'Too many login attempts. Please wait 15 minutes.',
        }),
      },
    },
  };

  // POST /api/auth/register
  app.post('/register', { ...rateLimitConfig }, async (request, reply) => {
    const db = getDb();
    const body = registerSchema.safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({ error: 'Validation failed', details: body.error.flatten() });
    }

    const { email, password } = body.data;

    const existing = db.select().from(users).where(eq(users.email, email)).get();
    if (existing) {
      return reply.status(409).send({ error: 'Email already registered' });
    }

    const passwordHash = await argon2.hash(password, {
      type: argon2.argon2id,
      memoryCost: 65536,
      timeCost: 3,
      parallelism: 4,
    });

    const newUser = {
      id: uuidv4(),
      email,
      passwordHash,
      createdAt: new Date(),
    };

    db.insert(users).values(newUser).run();

    const token = await signToken({ sub: newUser.id, email });
    setAuthCookie(reply, token);

    return reply.status(201).send({
      message: 'Account created successfully',
      token,
      user: { id: newUser.id, email },
    });
  });

  // POST /api/auth/login
  app.post('/login', { ...rateLimitConfig }, async (request, reply) => {
    const db = getDb();
    const body = loginSchema.safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({ error: 'Validation failed', details: body.error.flatten() });
    }

    const { email, password, totpCode } = body.data;

    const user = db.select().from(users).where(eq(users.email, email)).get();
    if (!user) {
      // Constant time response to prevent user enumeration
      await argon2.hash('dummy-password');
      return reply.status(401).send({ error: 'Invalid credentials' });
    }

    const valid = await argon2.verify(user.passwordHash, password);
    if (!valid) {
      return reply.status(401).send({ error: 'Invalid credentials' });
    }

    // TOTP check
    if (user.totpEnabled && user.totpSecret) {
      if (!totpCode) {
        return reply.status(200).send({ requiresMFA: true });
      }
      const verified = speakeasy.totp.verify({
        secret: user.totpSecret,
        encoding: 'base32',
        token: totpCode,
        window: 1,
      });
      if (!verified) {
        return reply.status(401).send({ error: 'Invalid MFA code' });
      }
    }

    // Update last login
    db.update(users)
      .set({ lastLogin: new Date() })
      .where(eq(users.id, user.id))
      .run();

    const token = await signToken({ sub: user.id, email: user.email });
    setAuthCookie(reply, token);

    return reply.send({
      message: 'Login successful',
      token,
      user: { id: user.id, email: user.email, totpEnabled: user.totpEnabled },
    });
  });

  // POST /api/auth/logout
  app.post('/logout', async (request, reply) => {
    clearAuthCookie(reply);
    return reply.send({ message: 'Logged out successfully' });
  });

  // GET /api/auth/me
  app.get('/me', { preHandler: authenticate }, async (request, reply) => {
    const db = getDb();
    const user = db.select({
      id: users.id,
      email: users.email,
      totpEnabled: users.totpEnabled,
      createdAt: users.createdAt,
      lastLogin: users.lastLogin,
    }).from(users).where(eq(users.id, request.user!.sub)).get();

    if (!user) return reply.status(404).send({ error: 'User not found' });
    return reply.send({ user });
  });

  // POST /api/auth/mfa/setup
  app.post('/mfa/setup', { preHandler: authenticate }, async (request, reply) => {
    const db = getDb();
    const user = db.select().from(users).where(eq(users.id, request.user!.sub)).get();
    if (!user) return reply.status(404).send({ error: 'User not found' });

    const secret = speakeasy.generateSecret({
      name: `TerminalSQL (${user.email})`,
      issuer: 'TerminalSQL',
      length: 20,
    });

    // Save secret temporarily (not enabled yet)
    db.update(users)
      .set({ totpSecret: secret.base32 })
      .where(eq(users.id, user.id))
      .run();

    const qrCodeDataUrl = await QRCode.toDataURL(secret.otpauth_url!);
    return reply.send({ secret: secret.base32, qrCode: qrCodeDataUrl });
  });

  // POST /api/auth/mfa/verify
  app.post('/mfa/verify', { preHandler: authenticate }, async (request, reply) => {
    const db = getDb();
    const { code } = request.body as { code: string };
    const user = db.select().from(users).where(eq(users.id, request.user!.sub)).get();

    if (!user || !user.totpSecret) {
      return reply.status(400).send({ error: 'MFA setup not initiated' });
    }

    const verified = speakeasy.totp.verify({
      secret: user.totpSecret,
      encoding: 'base32',
      token: code,
      window: 1,
    });

    if (!verified) {
      return reply.status(400).send({ error: 'Invalid TOTP code' });
    }

    db.update(users)
      .set({ totpEnabled: true })
      .where(eq(users.id, user.id))
      .run();

    return reply.send({ message: 'MFA enabled successfully' });
  });

  // DELETE /api/auth/mfa
  app.delete('/mfa', { preHandler: authenticate }, async (request, reply) => {
    const db = getDb();
    const { password } = request.body as { password: string };
    const user = db.select().from(users).where(eq(users.id, request.user!.sub)).get();

    if (!user) return reply.status(404).send({ error: 'User not found' });

    const valid = await argon2.verify(user.passwordHash, password);
    if (!valid) return reply.status(401).send({ error: 'Invalid password' });

    db.update(users)
      .set({ totpEnabled: false, totpSecret: null })
      .where(eq(users.id, user.id))
      .run();

    return reply.send({ message: 'MFA disabled' });
  });
}
