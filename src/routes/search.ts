import { Hono } from 'hono';
import { searchSchema } from '../schemas/search';
import { SearchService } from '../services/search-service';
import type { RuntimeEnv } from '../types';
import { authMiddleware } from '../utils/auth';
import { toJsonErrorResponse, zodToAppError } from '../utils/errors';

export const searchRoutes = new Hono<{ Bindings: RuntimeEnv }>();

searchRoutes.use('/search', authMiddleware);

searchRoutes.post('/search', async (c) => {
  try {
    const body = await c.req.json();
    const parsed = searchSchema.safeParse(body);
    if (!parsed.success) throw zodToAppError(parsed.error);

    const service = new SearchService(c.env);
    return c.json(await service.search(parsed.data));
  } catch (error) {
    return toJsonErrorResponse(error);
  }
});
