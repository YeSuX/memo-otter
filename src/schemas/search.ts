import { z } from 'zod';
import { normalizeProject, normalizeTags, normalizeType } from '../utils/memory';
import { memoryStatusSchema } from './memory';

export const searchSchema = z
  .object({
    query: z.string().trim().min(1).max(1000),
    project: z
      .string()
      .max(120)
      .nullish()
      .transform((value) => normalizeProject(value)),
    type: z
      .string()
      .max(64)
      .optional()
      .transform((value) => (value === undefined ? undefined : normalizeType(value, 'note'))),
    status: memoryStatusSchema.optional(),
    tags: z
      .array(z.string().max(40))
      .max(20)
      .optional()
      .transform((value) => normalizeTags(value ?? [])),
    include_archived: z.boolean().optional().default(false),
    limit: z.number().int().min(1).max(50).optional().default(10)
  })
  .strict()
  .transform((value) => ({
    query: value.query,
    project: value.project,
    type: value.type,
    status: value.status,
    tags: value.tags,
    includeArchived: value.include_archived || value.status === 'archived',
    limit: value.limit
  }));
