import { describe, expect, it } from 'vitest';
import {
  buildEmbeddableMemoryText,
  buildVectorId,
  contentHash,
  generateTitleFromContent,
  memoryRowToDomain,
  normalizeProject,
  normalizeTags,
  normalizeType
} from '../src/utils/memory';

describe('memory utils', () => {
  it('normalizes basic fields', () => {
    expect(normalizeProject('  memo-otter  ')).toBe('memo-otter');
    expect(normalizeProject('   ')).toBeNull();
    expect(normalizeType(' API Contract ')).toBe('api-contract');
    expect(normalizeTags([' Test ', '', 'test', 'MVP'])).toEqual(['test', 'mvp']);
  });

  it('generates title and content hash', async () => {
    expect(generateTitleFromContent('hello world')).toBe('hello world');
    const hash = await contentHash('hello');
    expect(hash).toHaveLength(64);
    expect(await contentHash('hello')).toBe(hash);
    expect(await contentHash('world')).not.toBe(hash);
  });

  it('builds vector id and embeddable text', () => {
    const vectorId = buildVectorId('mem_1', 'abcdef1234567890');
    expect(vectorId).toBe('mem:mem_1:chunk:0:hash:abcdef123456');

    const text = buildEmbeddableMemoryText({
      id: 'mem_1',
      title: 'Title',
      content: 'Content',
      project: 'memo',
      scope: 'long_term',
      type: 'note',
      status: 'active',
      tags: ['tag'],
      source: 'api',
      embeddingStatus: 'indexed',
      createdAt: '2026-06-02T00:00:00.000Z',
      updatedAt: '2026-06-02T00:00:00.000Z',
      archivedAt: null,
      metadata: {}
    });
    expect(text).toContain('Title: Title');
    expect(text).toContain('Project: memo');
    expect(text).toContain('Content');
  });

  it('degrades broken JSON fields safely', () => {
    const memory = memoryRowToDomain({
      id: 'mem_1',
      title: 'Title',
      content: 'Content',
      project: null,
      scope: 'long_term',
      type: 'note',
      status: 'active',
      tags_json: '{broken',
      source: null,
      embedding_status: 'pending',
      created_at: '2026-06-02T00:00:00.000Z',
      updated_at: '2026-06-02T00:00:00.000Z',
      archived_at: null,
      metadata_json: '{broken'
    });
    expect(memory.tags).toEqual([]);
    expect(memory.metadata).toEqual({});
  });
});
