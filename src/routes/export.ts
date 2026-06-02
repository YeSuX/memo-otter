import { Hono } from 'hono';
import type { RuntimeEnv } from '../types';
import { authMiddleware } from '../utils/auth';
import { toJsonErrorResponse } from '../utils/errors';

export const exportRoutes = new Hono<{ Bindings: RuntimeEnv }>();

exportRoutes.use('/export', authMiddleware);

exportRoutes.get('/export', async (c) => {
  try {
    const [memories, embeddings, events] = await Promise.all([
      c.env.DB.prepare('SELECT * FROM memories ORDER BY updated_at DESC').all(),
      c.env.DB.prepare('SELECT * FROM memory_embeddings ORDER BY created_at DESC').all(),
      c.env.DB.prepare('SELECT * FROM memory_events ORDER BY created_at DESC').all()
    ]);
    return c.json({
      exportedAt: new Date().toISOString(),
      memories: memories.results ?? [],
      memory_embeddings: embeddings.results ?? [],
      memory_events: events.results ?? []
    });
  } catch (error) {
    return toJsonErrorResponse(error);
  }
});
