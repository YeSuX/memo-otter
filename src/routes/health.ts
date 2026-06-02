import { Hono } from 'hono';
import type { RuntimeEnv } from '../types';

export const healthRoutes = new Hono<{ Bindings: RuntimeEnv }>();

healthRoutes.get('/health', (c) =>
  c.json({
    ok: true,
    service: 'memo-otter',
    bindings: {
      db: Boolean(c.env.DB),
      vectorize: Boolean(c.env.VECTORIZE),
      ai: Boolean(c.env.AI)
    }
  })
);
