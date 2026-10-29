import { SignJWT, jwtVerify } from 'jose';

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || 'fallback-dev-secret-change-in-production'
);
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '8h';

export interface JWTPayload {
  sub: string;      // user id
  email: string;
  iat?: number;
  exp?: number;
}

export async function signToken(payload: Omit<JWTPayload, 'iat' | 'exp'>): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(JWT_EXPIRES_IN)
    .sign(JWT_SECRET);
}

export async function verifyToken(token: string): Promise<JWTPayload> {
  const { payload } = await jwtVerify(token, JWT_SECRET);
  return payload as unknown as JWTPayload;
}

export function setAuthCookie(reply: any, token: string) {
  // Only enable secure flag if connection is HTTPS or explicitly forced via COOKIE_SECURE
  const req = reply.request;
  const isHttps = req?.protocol === 'https' || req?.headers?.['x-forwarded-proto'] === 'https';
  const forceSecure = process.env.COOKIE_SECURE === 'true';
  const secure = forceSecure || (process.env.NODE_ENV === 'production' && Boolean(isHttps));

  reply.setCookie('auth_token', token, {
    httpOnly: true,
    secure,
    sameSite: 'lax',
    path: '/',
    maxAge: 8 * 60 * 60, // 8 hours in seconds
  });
}

export function clearAuthCookie(reply: any) {
  reply.clearCookie('auth_token', { path: '/' });
}
