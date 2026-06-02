import { Hono } from 'hono';
import { z } from 'zod';
import { MemoryService } from '../services/memory-service';
import type { RuntimeEnv } from '../types';
import { authMiddleware } from '../utils/auth';
import { toJsonErrorResponse, zodToAppError } from '../utils/errors';
import { archiveMemorySchema, createMemorySchema, listMemoriesQuerySchema, updateMemorySchema } from '../schemas/memory';

export const memoriesRoutes = new Hono<{ Bindings: RuntimeEnv }>();

memoriesRoutes.use('*', authMiddleware);

memoriesRoutes.post('/', async (c) => {
  try {
    const body = await readJson(c.req.raw);
    const parsed = parseOrThrow(createMemorySchema, body);
    const result = await new MemoryService(c.env).createMemory(parsed, { source: parsed.source });
    return c.json(result, 201);
  } catch (error) {
    return toJsonErrorResponse(error);
  }
});

memoriesRoutes.get('/', async (c) => {
  try {
    const parsed = parseOrThrow(listMemoriesQuerySchema, c.req.query());
    const result = await new MemoryService(c.env).listMemories(parsed);
    return c.json(result);
  } catch (error) {
    return toJsonErrorResponse(error);
  }
});

memoriesRoutes.get('/:id', async (c) => {
  try {
    const result = await new MemoryService(c.env).getMemory(c.req.param('id'));
    return c.json(result);
  } catch (error) {
    return toJsonErrorResponse(error);
  }
});

memoriesRoutes.patch('/:id', async (c) => {
  try {
    const body = await readJson(c.req.raw);
    const parsed = parseOrThrow(updateMemorySchema, body);
    const result = await new MemoryService(c.env).updateMemory(c.req.param('id'), parsed);
    return c.json(result);
  } catch (error) {
    return toJsonErrorResponse(error);
  }
});

memoriesRoutes.post('/:id/archive', async (c) => {
  try {
    const body = await readJson(c.req.raw);
    const parsed = parseOrThrow(archiveMemorySchema, body);
    const result = await new MemoryService(c.env).archiveMemory(c.req.param('id'), parsed, { source: parsed.source });
    return c.json(result);
  } catch (error) {
    return toJsonErrorResponse(error);
  }
});

async function readJson(request: Request): Promise<unknown> {
  if (!request.headers.get('content-type')?.includes('application/json')) {
    return {};
  }
  return request.json();
}

function parseOrThrow<T extends z.ZodType>(schema: T, input: unknown): z.infer<T> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw zodToAppError(parsed.error);
  return parsed.data;
}
