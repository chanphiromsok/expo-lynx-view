const sessionCookieName = 'lynx_console_session';
const passwordIterations = 100_000;
const encoder = new TextEncoder();
const usernamePattern = /^[A-Za-z0-9][A-Za-z0-9._-]{1,63}$/;

export interface AuthEnv {
  DB: D1Database;
  AUTH_SESSION_SECRET: string;
  INITIAL_ADMIN_API_KEY?: string;
  INITIAL_ADMIN_PASSWORD?: string;
  INITIAL_ADMIN_USERNAME?: string;
}

export type AuthUser = {
  id: string;
  username: string;
};

type SessionPayload = AuthUser & {
  expiresAt: number;
  version: 1;
};

export async function ensureInitialAdmin(environment: AuthEnv): Promise<void> {
  const username = environment.INITIAL_ADMIN_USERNAME?.trim();
  const password = environment.INITIAL_ADMIN_PASSWORD;
  const apiKey = environment.INITIAL_ADMIN_API_KEY?.trim();
  const database = createDeliveryDatabase(environment.DB);
  const [existing] = await database.select({ id: users.id }).from(users).limit(1);
  if (existing) return;
  if (!username && !password && !apiKey) {
    throw new Error('No console user exists. Configure INITIAL_ADMIN_USERNAME, INITIAL_ADMIN_PASSWORD, and INITIAL_ADMIN_API_KEY once.');
  }
  if (!username || !password || !apiKey) {
    throw new Error('Initial admin setup requires INITIAL_ADMIN_USERNAME, INITIAL_ADMIN_PASSWORD, and INITIAL_ADMIN_API_KEY.');
  }
  if (!usernamePattern.test(username)) {
    throw new Error('INITIAL_ADMIN_USERNAME must contain 2-64 letters, numbers, dots, dashes, or underscores.');
  }
  if (password.length < 12) throw new Error('INITIAL_ADMIN_PASSWORD must be at least 12 characters.');
  if (apiKey.length < 24) throw new Error('INITIAL_ADMIN_API_KEY must be at least 24 characters.');

  const id = crypto.randomUUID();
  await database.insert(users).values(
    {
      id,
      username,
      passwordHash: await hashPassword(password),
      apiKeyHash: await sha256Hex(apiKey),
      enabled: true,
      createdAt: new Date().toISOString(),
    },
  );
}

export async function authenticatePassword(
  environment: AuthEnv,
  username: string,
  password: string,
): Promise<AuthUser | null> {
  await ensureInitialAdmin(environment);
  const database = createDeliveryDatabase(environment.DB);
  const [user] = await database.select().from(users).where(eq(users.username, username)).limit(1);
  if (!user || !user.enabled || !(await verifyPassword(password, user.passwordHash))) return null;
  return { id: user.id, username: user.username };
}

export async function authenticateApiKey(environment: AuthEnv, request: Request): Promise<AuthUser | null> {
  await ensureInitialAdmin(environment);
  const authorization = request.headers.get('Authorization');
  if (!authorization?.startsWith('Bearer ')) return null;
  const key = authorization.slice('Bearer '.length).trim();
  if (!key) return null;
  const database = createDeliveryDatabase(environment.DB);
  const [user] = await database.select().from(users).where(eq(users.apiKeyHash, await sha256Hex(key))).limit(1);
  if (!user || !user.enabled) return null;
  return { id: user.id, username: user.username };
}

export async function authenticateSession(environment: AuthEnv, request: Request): Promise<AuthUser | null> {
  await ensureInitialAdmin(environment);
  const token = readCookie(request.headers.get('Cookie'), sessionCookieName);
  if (!token) return null;
  const payload = await readSession(environment.AUTH_SESSION_SECRET, token);
  if (!payload) return null;
  const database = createDeliveryDatabase(environment.DB);
  const [user] = await database.select({ id: users.id, username: users.username, enabled: users.enabled })
    .from(users)
    .where(eq(users.id, payload.id))
    .limit(1);
  if (!user || !user.enabled || user.username !== payload.username) return null;
  return { id: user.id, username: user.username };
}

export async function createSessionCookie(environment: AuthEnv, user: AuthUser, secure: boolean): Promise<string> {
  const secret = environment.AUTH_SESSION_SECRET?.trim();
  if (!secret) throw new Error('AUTH_SESSION_SECRET is required for console login.');
  const expiresAt = Date.now() + 7 * 24 * 60 * 60 * 1000;
  const payload: SessionPayload = { ...user, expiresAt, version: 1 };
  const encoded = base64UrlEncode(JSON.stringify(payload));
  const signature = await sign(secret, encoded);
  return serializeCookie(`${encoded}.${signature}`, secure, 7 * 24 * 60 * 60);
}

export function clearSessionCookie(secure: boolean): string {
  return `${sessionCookieName}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure ? '; Secure' : ''}`;
}

function serializeCookie(value: string, secure: boolean, maxAge: number): string {
  return `${sessionCookieName}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
}

async function readSession(secret: string, token: string): Promise<SessionPayload | null> {
  if (!secret?.trim()) return null;
  const separator = token.lastIndexOf('.');
  if (separator < 1) return null;
  const encoded = token.slice(0, separator);
  const signature = token.slice(separator + 1);
  if (!(await constantTimeEqual(signature, await sign(secret, encoded)))) return null;
  try {
    const value = JSON.parse(base64UrlDecode(encoded)) as Partial<SessionPayload>;
    const expiresAt = value.expiresAt;
    if (
      value.version !== 1 || typeof value.id !== 'string' || typeof value.username !== 'string' ||
      typeof expiresAt !== 'number' || !Number.isSafeInteger(expiresAt) || expiresAt <= Date.now()
    ) return null;
    return value as SessionPayload;
  } catch {
    return null;
  }
}

async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derivePassword(password, salt, passwordIterations);
  return `pbkdf2-sha256:${passwordIterations}:${base64UrlEncodeBytes(salt)}:${base64UrlEncodeBytes(hash)}`;
}

async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algorithm, iterations, encodedSalt, encodedHash] = stored.split(':');
  const count = Number(iterations);
  if (algorithm !== 'pbkdf2-sha256' || !Number.isSafeInteger(count) || count < 100_000 || !encodedSalt || !encodedHash) return false;
  try {
    return constantTimeEqualBytes(
      base64UrlDecodeBytes(encodedHash),
      await derivePassword(password, base64UrlDecodeBytes(encodedSalt), count),
    );
  } catch {
    return false;
  }
}

async function derivePassword(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    key,
    256,
  ));
}

async function sha256Hex(value: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value)));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function sign(secret: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return base64UrlEncodeBytes(new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(value))));
}

function readCookie(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const [key, ...value] = part.trim().split('=');
    if (key === name) return value.join('=') || null;
  }
  return null;
}

function base64UrlEncode(value: string): string {
  return base64UrlEncodeBytes(encoder.encode(value));
}

function base64UrlEncodeBytes(value: Uint8Array): string {
  let binary = '';
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function base64UrlDecode(value: string): string {
  return new TextDecoder().decode(base64UrlDecodeBytes(value));
}

function base64UrlDecodeBytes(value: string): Uint8Array {
  const padded = value.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - value.length % 4) % 4);
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
}

async function constantTimeEqual(left: string, right: string): Promise<boolean> {
  return constantTimeEqualBytes(encoder.encode(left), encoder.encode(right));
}

function constantTimeEqualBytes(left: Uint8Array, right: Uint8Array): boolean {
  let difference = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  return difference === 0;
}
import { eq } from 'drizzle-orm';

import { createDeliveryDatabase } from './db/client.ts';
import { users } from './db/schema.ts';
