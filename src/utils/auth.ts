import { createMiddleware } from 'hono/factory';
import type { RuntimeEnv } from '../types';
import { unauthorized } from './errors';

const encoder = new TextEncoder();

async function digestToken(value: string): Promise<Uint8Array> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(value));
  return new Uint8Array(digest);
}

async function timingSafeTokenEqual(actual: string, expected: string): Promise<boolean> {
  const [actualDigest, expectedDigest] = await Promise.all([digestToken(actual), digestToken(expected)]);
  let diff = actual.length === expected.length ? 0 : 1;
  for (let index = 0; index < actualDigest.length; index += 1) {
    diff |= actualDigest[index]! ^ expectedDigest[index]!;
  }
  return diff === 0;
}

export const authMiddleware = createMiddleware<{ Bindings: RuntimeEnv }>(async (c, next) => {
  const expected = c.env.AUTH_TOKEN;
  if (!expected) {
    throw unauthorized('AUTH_TOKEN is not configured');
  }

  const authorization = c.req.header('Authorization') ?? '';
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    throw unauthorized();
  }

  // 使用摘要后的常量时间比较，避免把 token 直接用普通字符串比较。
  const ok = await timingSafeTokenEqual(match[1]!, expected);
  if (!ok) {
    throw unauthorized();
  }

  await next();
});
