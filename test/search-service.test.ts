import { describe, expect, it } from 'vitest';
import { MemoryService } from '../src/services/memory-service';
import { SearchService } from '../src/services/search-service';
import type { MemoryEmbeddingRow, MemoryRow } from '../src/types';
import { createEmbeddingId, nowIso } from '../src/utils/memory';
import { createFakeEnv } from './fakes';

type TestVectorize = {
  upserts: Array<{ id: string }>;
  queryResults: Array<{ id: string; score: number }>;
};

type TestD1 = {
  memories: MemoryRow[];
  embeddings: MemoryEmbeddingRow[];
};

function vectorizeOf(env: ReturnType<typeof createFakeEnv>): TestVectorize {
  return env.VECTORIZE as unknown as TestVectorize;
}

function dbOf(env: ReturnType<typeof createFakeEnv>): TestD1 {
  return env.DB as unknown as TestD1;
}

describe('SearchService', () => {
  it('finds a saved memory through Vectorize and returns score and snippet', async () => {
    const env = createFakeEnv();
    const memoryService = new MemoryService(env);
    const created = await memoryService.createMemory({
      content: 'Memo Otter keeps Cloudflare Vectorize indexing decisions searchable.',
      project: 'memo-otter',
      tags: ['cloudflare']
    });

    const result = await new SearchService(env).search({
      query: 'Vectorize indexing decisions',
      includeArchived: false,
      limit: 10
    });

    expect(result.results[0]?.id).toBe(created.memory.id);
    expect(result.results[0]?.score).toBeGreaterThan(0);
    expect(result.results[0]?.snippet).toContain('Vectorize');
  });

  it('applies project, type, status, and tags filters using D1 source data', async () => {
    const env = createFakeEnv();
    const memoryService = new MemoryService(env);
    const target = await memoryService.createMemory({
      content: 'Use D1 as source of truth for semantic search filtering.',
      project: 'memo-otter',
      type: 'decision',
      status: 'canonical',
      tags: ['cloudflare']
    });
    await memoryService.createMemory({
      content: 'Another project uses a different storage policy.',
      project: 'other-project',
      type: 'note',
      status: 'draft',
      tags: ['misc']
    });

    const result = await new SearchService(env).search({
      query: 'storage policy',
      project: 'memo-otter',
      type: 'decision',
      status: 'canonical',
      tags: ['cloudflare'],
      includeArchived: false,
      limit: 10
    });

    expect(result.results.map((item) => item.id)).toEqual([target.memory.id]);
  });

  it('excludes archived memories by default and includes them when requested', async () => {
    const env = createFakeEnv();
    const memoryService = new MemoryService(env);
    const created = await memoryService.createMemory({
      content: 'Archived semantic memories should be hidden by default.',
      project: 'memo-otter'
    });
    await memoryService.archiveMemory(created.memory.id);

    const hidden = await new SearchService(env).search({
      query: 'archived semantic memories',
      includeArchived: false,
      limit: 10
    });
    expect(hidden.results).toHaveLength(0);

    const included = await new SearchService(env).search({
      query: 'archived semantic memories',
      includeArchived: true,
      limit: 10
    });
    expect(included.results.map((item) => item.id)).toEqual([created.memory.id]);
  });

  it('treats status archived as an explicit archived search', async () => {
    const env = createFakeEnv();
    const memoryService = new MemoryService(env);
    const created = await memoryService.createMemory({ content: 'Archived status search target.' });
    await memoryService.archiveMemory(created.memory.id);

    const result = await new SearchService(env).search({
      query: 'archived status',
      status: 'archived',
      includeArchived: true,
      limit: 10
    });

    expect(result.results.map((item) => item.id)).toEqual([created.memory.id]);
  });

  it('skips stale vector matches and deduplicates by memory id', async () => {
    const env = createFakeEnv();
    const memoryService = new MemoryService(env);
    const created = await memoryService.createMemory({ content: 'Deduplicate old and new vectors.' });
    const db = dbOf(env);
    const vectorize = vectorizeOf(env);
    const latestEmbedding = db.embeddings[0]!;
    const staleVectorId = 'stale-vector';
    db.embeddings.push({
      ...latestEmbedding,
      id: createEmbeddingId(),
      vector_id: staleVectorId,
      created_at: nowIso()
    });
    vectorize.queryResults = [
      { id: 'missing-vector', score: 0.99 },
      { id: staleVectorId, score: 0.93 },
      { id: vectorize.upserts[0]!.id, score: 0.91 }
    ];

    const result = await new SearchService(env).search({
      query: 'deduplicate vectors',
      includeArchived: false,
      limit: 10
    });

    expect(result.results).toHaveLength(1);
    expect(result.results[0]?.id).toBe(created.memory.id);
    expect(result.results[0]?.score).toBe(0.93);
  });

  it('ranks by score first and then status, type, and recency when scores are close', async () => {
    const env = createFakeEnv();
    const memoryService = new MemoryService(env);
    const canonical = await memoryService.createMemory({
      content: 'Canonical decision about search ranking.',
      status: 'canonical',
      type: 'decision'
    });
    const active = await memoryService.createMemory({
      content: 'Active note about search ranking.',
      status: 'active',
      type: 'note'
    });
    const recent = await memoryService.createMemory({
      content: 'Recent preference about search ranking.',
      status: 'active',
      type: 'preference'
    });
    const db = dbOf(env);
    db.memories.find((row) => row.id === active.memory.id)!.updated_at = '2026-06-03T01:00:00.000Z';
    db.memories.find((row) => row.id === recent.memory.id)!.updated_at = '2026-06-03T02:00:00.000Z';
    const vectorize = vectorizeOf(env);
    vectorize.queryResults = [
      { id: vectorize.upserts[1]!.id, score: 0.9 },
      { id: vectorize.upserts[0]!.id, score: 0.89 },
      { id: vectorize.upserts[2]!.id, score: 0.885 }
    ];

    const closeScores = await new SearchService(env).search({
      query: 'search ranking',
      includeArchived: false,
      limit: 10
    });
    expect(closeScores.results.map((item) => item.id)).toEqual([
      canonical.memory.id,
      recent.memory.id,
      active.memory.id
    ]);

    vectorize.queryResults = [
      { id: vectorize.upserts[1]!.id, score: 0.95 },
      { id: vectorize.upserts[0]!.id, score: 0.89 }
    ];
    const scoreDominates = await new SearchService(env).search({
      query: 'search ranking',
      includeArchived: false,
      limit: 10
    });
    expect(scoreDominates.results.map((item) => item.id)).toEqual([active.memory.id, canonical.memory.id]);
  });

  it('returns an empty result when Vectorize has no matches', async () => {
    const env = createFakeEnv({ vectorQueryResults: [] });
    vectorizeOf(env).queryResults = [];
    const result = await new SearchService(env).search({
      query: 'nothing',
      includeArchived: false,
      limit: 10
    });
    expect(result.results).toHaveLength(0);
  });

  it('fails when query embedding returns an invalid shape', async () => {
    const env = createFakeEnv({ badAiShape: true });
    await expect(
      new SearchService(env).search({
        query: 'bad embedding',
        includeArchived: false,
        limit: 10
      })
    ).rejects.toThrow('Workers AI did not return an embedding vector');
  });

  it('returns semantic duplicate and conflict warnings for new memories', async () => {
    const env = createFakeEnv();
    const memoryService = new MemoryService(env);
    await memoryService.createMemory({
      content: 'Canonical project memory about API authentication.',
      project: 'memo-otter',
      type: 'decision',
      status: 'canonical'
    });
    vectorizeOf(env).queryResults = [{ id: vectorizeOf(env).upserts[0]!.id, score: 0.9 }];

    const created = await memoryService.createMemory({
      content: 'API authentication should use a bearer token.',
      project: 'memo-otter',
      type: 'decision'
    });

    expect(created.warnings.some((warning) => warning.type === 'possible_duplicate')).toBe(true);
    expect(created.warnings.some((warning) => warning.type === 'possible_conflict')).toBe(true);
  });

  it('does not block memory creation when semantic warning search fails', async () => {
    const env = createFakeEnv({ failVectorizeQuery: true });
    const created = await new MemoryService(env).createMemory({
      content: 'Creation should continue even when duplicate semantic search fails.'
    });

    expect(created.memory.content).toContain('Creation should continue');
    expect(created.indexing.status).toBe('indexed');
  });
});
