import { Hono } from 'hono';
import { MemoryRepository } from '../repositories/memory-repository';
import type { RuntimeEnv } from '../types';
import { authMiddleware } from '../utils/auth';
import { toJsonErrorResponse } from '../utils/errors';

export const contextRoutes = new Hono<{ Bindings: RuntimeEnv }>();

contextRoutes.use('/context/*', authMiddleware);

contextRoutes.get('/context/:project', async (c) => {
  try {
    const repo = new MemoryRepository(c.env.DB);
    const result = await repo.listMemories({
      project: c.req.param('project'),
      includeArchived: false,
      limit: 20,
      offset: 0
    });
    return c.json({ project: c.req.param('project'), memories: result.items });
  } catch (error) {
    return toJsonErrorResponse(error);
  }
});
