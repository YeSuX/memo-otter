import { z } from 'zod';
import {
  generateTitleFromContent,
  normalizeProject,
  normalizeSource,
  normalizeTags,
  normalizeType
} from '../utils/memory';

export const memoryScopeSchema = z.enum(['long_term', 'short_term']);
export const memoryStatusSchema = z.enum(['draft', 'active', 'canonical', 'archived']);
export const createMemoryStatusSchema = z.enum(['draft', 'active', 'canonical']);
export const embeddingStatusSchema = z.enum(['pending', 'indexed', 'failed', 'stale']);

export const tagsSchema = z
  .array(z.string().max(40))
  .max(20)
  .optional()
  .transform((value) => normalizeTags(value ?? []));

export const metadataSchema = z
  .record(z.string(), z.unknown())
  .optional()
  .default({})
  .refine((value) => JSON.stringify(value).length <= 16 * 1024, 'metadata is too large');

export const createMemorySchema = z
  .object({
    title: z.string().trim().max(160).optional(),
    content: z.string().trim().min(1).max(20_000),
    project: z
      .string()
      .max(120)
      .nullish()
      .transform((value) => normalizeProject(value)),
    scope: memoryScopeSchema.optional().default('long_term'),
    type: z
      .string()
      .max(64)
      .optional()
      .transform((value) => normalizeType(value, 'note')),
    status: createMemoryStatusSchema.optional().default('active'),
    tags: tagsSchema.default([]),
    source: z
      .string()
      .max(40)
      .optional()
      .transform((value) => normalizeSource(value, 'api')),
    metadata: metadataSchema
  })
  .strict()
  .transform((value) => ({
    ...value,
    title: value.title?.trim() || generateTitleFromContent(value.content)
  }));

export const updateMemorySchema = z
  .object({
    title: z.string().trim().max(160).optional(),
    content: z.string().trim().min(1).max(20_000).optional(),
    project: z
      .string()
      .max(120)
      .nullish()
      .transform((value) => (value === undefined ? undefined : normalizeProject(value))),
    scope: memoryScopeSchema.optional(),
    type: z
      .string()
      .max(64)
      .optional()
      .transform((value) => (value === undefined ? undefined : normalizeType(value, 'note'))),
    status: memoryStatusSchema.optional(),
    tags: tagsSchema,
    metadata: metadataSchema.optional()
  })
  .strict()
  .refine((value) => Object.values(value).some((item) => item !== undefined), {
    message: 'at least one editable field is required'
  });

const booleanQuerySchema = z
  .union([z.boolean(), z.string()])
  .optional()
  .transform((value) => value === true || value === 'true' || value === '1');

const numberQuerySchema = (fallback: number, max: number) =>
  z
    .union([z.number(), z.string()])
    .optional()
    .transform((value) => {
      if (value === undefined || value === '') return fallback;
      const parsed = Number(value);
      if (!Number.isFinite(parsed)) return fallback;
      return Math.min(Math.max(Math.trunc(parsed), 0), max);
    });

export const listMemoriesQuerySchema = z
  .object({
    project: z
      .string()
      .optional()
      .transform((value) => normalizeProject(value)),
    scope: memoryScopeSchema.optional(),
    type: z
      .string()
      .optional()
      .transform((value) => (value === undefined ? undefined : normalizeType(value, 'note'))),
    status: memoryStatusSchema.optional(),
    tags: z
      .string()
      .optional()
      .transform((value) => (value ? normalizeTags(value.split(',')) : [])),
    include_archived: booleanQuerySchema.default(false),
    limit: numberQuerySchema(20, 100),
    offset: numberQuerySchema(0, Number.MAX_SAFE_INTEGER),
    cursor: z.string().optional()
  })
  .strict()
  .transform((value) => ({
    project: value.project,
    scope: value.scope,
    type: value.type,
    status: value.status,
    tags: value.tags,
    includeArchived: value.include_archived,
    limit: value.limit,
    offset: value.offset,
    cursor: value.cursor
  }));

export const archiveMemorySchema = z
  .object({
    source: z
      .string()
      .max(40)
      .optional()
      .transform((value) => (value === undefined ? undefined : normalizeSource(value, 'api'))),
    reason: z.string().trim().max(500).optional()
  })
  .strict();

export const reindexMemorySchema = z
  .object({
    source: z
      .string()
      .max(40)
      .optional()
      .transform((value) => (value === undefined ? undefined : normalizeSource(value, 'api')))
  })
  .strict();
