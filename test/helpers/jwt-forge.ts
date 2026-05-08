import { SignJWT } from 'jose';

const ACCESS_SECRET = () =>
  new TextEncoder().encode(process.env.JWT_ACCESS_SECRET);

export async function forgeExpiredAccess(userId: string): Promise<string> {
  return await new SignJWT({ userId, sessionId: 'x' })
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime(Math.floor(Date.now() / 1000) - 60)
    .sign(ACCESS_SECRET());
}

export async function forgeAlgNone(userId: string): Promise<string> {
  const header = Buffer.from(
    JSON.stringify({ alg: 'none', typ: 'JWT' })
  ).toString('base64url');
  const payload = Buffer.from(
    JSON.stringify({
      userId,
      sessionId: 'x',
      exp: Math.floor(Date.now() / 1000) + 3600
    })
  ).toString('base64url');
  return `${header}.${payload}.`;
}

export function tamperSignature(jwt: string): string {
  const parts = jwt.split('.');
  if (parts.length < 3) return jwt + '.tampered';
  const sig = parts[2];
  const tampered =
    sig.length > 0
      ? sig.slice(0, -1) + (sig.slice(-1) === 'A' ? 'B' : 'A')
      : 'AA';
  return `${parts[0]}.${parts[1]}.${tampered}`;
}
