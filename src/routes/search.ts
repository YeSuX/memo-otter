import { Hono } from 'hono';
import { z } from 'zod';
import { MemoryRepository } from '../repositories/memory-repository';
import type { RuntimeEnv } from '../types';
import { authMiddleware } from '../utils/auth';
import { toJsonErrorResponse, zodToAppError } from '../utils/errors';

const searchSchema = z
  .object({
    query: z.string().trim().min(1),
    project: z.string().trim().optional(),
    include_archived: z.boolean().optional().default(false),
    limit: z.number().int().min(1).max(50).optional().default(10)
  })
  .strict();

export const searchRoutes = new Hono<{ Bindings: RuntimeEnv }>();

searchRoutes.use('/search', authMiddleware);

searchRoutes.post('/search', async (c) => {
  try {
    const body = await c.req.json();
    const parsed = searchSchema.safeParse(body);
    if (!parsed.success) throw zodToAppError(parsed.error);

    const repo = new MemoryRepository(c.env.DB);
    const listed = await repo.listMemories({
      project: parsed.data.project ?? null,
      includeArchived: parsed.data.include_archived,
      limit: 100,
      offset: 0
    });
    const q = parsed.data.query.toLowerCase();
    const results = listed.items
      .filter((item) => item.title.toLowerCase().includes(q) || item.tags.some((tag) => tag.includes(q)))
      .slice(0, parsed.data.limit)
      .map((item) => ({ ...item, score: 0 }));

    return c.json({ results });
  } catch (error) {
    return toJsonErrorResponse(error);
  }
});
