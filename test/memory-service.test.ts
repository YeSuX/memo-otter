import { describe, expect, it } from 'vitest';
import { MemoryService } from '../src/services/memory-service';
import { createFakeEnv } from './fakes';

describe('MemoryService', () => {
  it('creates, lists, updates, and archives a memory', async () => {
    const env = createFakeEnv();
    const service = new MemoryService(env);

    const created = await service.createMemory({
      content: 'Memo Otter uses Cloudflare Workers.',
      project: 'memo-otter',
      tags: ['mvp']
    });
    expect(created.memory.embeddingStatus).toBe('indexed');
    expect(created.indexing.status).toBe('indexed');

    const list = await service.listMemories({ includeArchived: false, limit: 20, offset: 0 });
    expect(list.items).toHaveLength(1);
    expect(list.items[0]?.title).toContain('Memo Otter');

    const detail = await service.getMemory(created.memory.id);
    expect(detail.memory.content).toContain('Cloudflare');
    expect(detail.events.some((event) => event.eventType === 'create')).toBe(true);
    expect(detail.events.some((event) => event.eventType === 'index')).toBe(true);
    expect(detail.indexing.embeddingModel).toBe('@cf/baai/bge-base-en-v1.5');
    expect(detail.indexing.vectorId).toBe(created.indexing.vectorId);

    const updated = await service.updateMemory(created.memory.id, {
      content: 'Memo Otter uses Cloudflare Workers, D1, Vectorize, and Workers AI.',
      tags: ['mvp', 'cloudflare']
    });
    expect(updated.memory.embeddingStatus).toBe('indexed');
    expect(updated.indexing.status).toBe('indexed');

    const archived = await service.archiveMemory(created.memory.id);
    expect(archived.memory.status).toBe('archived');
    expect(archived.memory.archivedAt).toBeTruthy();

    const hidden = await service.listMemories({ includeArchived: false, limit: 20, offset: 0 });
    expect(hidden.items).toHaveLength(0);
    const included = await service.listMemories({ includeArchived: true, limit: 20, offset: 0 });
    expect(included.items).toHaveLength(1);
  });

  it('keeps memory when Workers AI embedding fails', async () => {
    const env = createFakeEnv({ failAi: true });
    const service = new MemoryService(env);
    const result = await service.createMemory({ content: 'Indexing can fail safely.' });
    expect(result.memory.embeddingStatus).toBe('failed');
    expect(result.indexing.status).toBe('failed');
    expect(result.indexing.failure?.stage).toBe('embedding');
    expect(result.indexing.failure?.message).toBe('embedding failed');
    expect(result.warnings.some((warning) => warning.type === 'index_failed')).toBe(true);

    const detail = await service.getMemory(result.memory.id);
    expect(detail.memory.content).toContain('Indexing can fail safely');
    expect(detail.events.some((event) => event.eventType === 'index_failed')).toBe(true);
  });

  it('marks indexing failed when Workers AI returns an invalid shape', async () => {
    const env = createFakeEnv({ badAiShape: true });
    const service = new MemoryService(env);
    const result = await service.createMemory({ content: 'Bad embedding shape should be reported.' });

    expect(result.memory.embeddingStatus).toBe('failed');
    expect(result.indexing.failure?.stage).toBe('embedding');
    expect(result.indexing.failure?.message).toContain('Workers AI did not return an embedding vector');
  });

  it('keeps memory when Vectorize upsert fails', async () => {
    const env = createFakeEnv({ failVectorize: true });
    const service = new MemoryService(env);
    const result = await service.createMemory({ content: 'Vectorize failure should not delete memory.' });

    expect(result.memory.embeddingStatus).toBe('failed');
    expect(result.indexing.failure?.stage).toBe('vectorize');

    const list = await service.listMemories({ includeArchived: false, limit: 20, offset: 0 });
    expect(list.items).toHaveLength(1);
  });

  it('keeps memory when embedding metadata write fails', async () => {
    const env = createFakeEnv({ failEmbeddingMetadata: true });
    const service = new MemoryService(env);
    const result = await service.createMemory({ content: 'Metadata write failure should not delete memory.' });

    expect(result.memory.embeddingStatus).toBe('failed');
    expect(result.indexing.failure?.stage).toBe('d1_metadata');
  });

  it('keeps memory when indexed status update fails', async () => {
    const env = createFakeEnv({ failEmbeddingStatusUpdate: true });
    const service = new MemoryService(env);
    const result = await service.createMemory({ content: 'Status update failure should be a metadata failure.' });

    expect(result.memory.embeddingStatus).toBe('failed');
    expect(result.indexing.failure?.stage).toBe('d1_metadata');
  });

  it('reindexes when content changes', async () => {
    const env = createFakeEnv();
    const service = new MemoryService(env);
    const created = await service.createMemory({ content: 'Original content.' });
    const updated = await service.updateMemory(created.memory.id, {
      content: 'Updated content for a new embedding.'
    });

    expect(updated.memory.embeddingStatus).toBe('indexed');
    expect(updated.indexing.vectorId).not.toBe(created.indexing.vectorId);
    expect(updated.indexing.contentHash).not.toBe(created.indexing.contentHash);

    const detail = await service.getMemory(created.memory.id);
    expect(detail.events.some((event) => event.eventType === 'update' && event.after?.embeddingStatus === 'stale')).toBe(
      true
    );
  });

  it('does not reindex metadata-only edits', async () => {
    const env = createFakeEnv();
    const service = new MemoryService(env);
    const created = await service.createMemory({ content: 'Stable content.', tags: ['one'] });
    const updated = await service.updateMemory(created.memory.id, { tags: ['one', 'two'] });
    expect(updated.indexing.vectorId).toBe(created.indexing.vectorId);
  });

  it('does not write null metadata to Vectorize', async () => {
    const env = createFakeEnv();
    const service = new MemoryService(env);
    await service.createMemory({ content: 'Vectorize metadata should avoid null project.' });

    const vectorize = env.VECTORIZE as unknown as { upserts: Array<{ metadata?: Record<string, unknown> }> };
    expect(vectorize.upserts).toHaveLength(1);
    expect(vectorize.upserts[0]?.metadata?.project).toBe('');
    expect(Object.values(vectorize.upserts[0]?.metadata ?? {}).some((value) => value === null)).toBe(false);
  });

  it('reindexes a failed memory without changing content', async () => {
    const env = createFakeEnv({ failAi: true });
    const service = new MemoryService(env);
    const created = await service.createMemory({ content: 'Retry indexing after Workers AI recovers.' });
    expect(created.memory.embeddingStatus).toBe('failed');

    (env.AI as unknown as { fail: boolean }).fail = false;
    const reindexed = await service.reindexMemory(created.memory.id, { source: 'api' });

    expect(reindexed.memory.content).toBe(created.memory.content);
    expect(reindexed.memory.embeddingStatus).toBe('indexed');
    expect(reindexed.indexing.status).toBe('indexed');
    expect(reindexed.warnings).toHaveLength(0);
  });

  it('does not reindex archived memories', async () => {
    const env = createFakeEnv();
    const service = new MemoryService(env);
    const created = await service.createMemory({ content: 'Archived memories should not be reindexed.' });
    await service.archiveMemory(created.memory.id);

    const vectorize = env.VECTORIZE as unknown as { upserts: unknown[] };
    const before = vectorize.upserts.length;
    const reindexed = await service.reindexMemory(created.memory.id);

    expect(reindexed.memory.status).toBe('archived');
    expect(reindexed.indexing.vectorId).toBe(created.indexing.vectorId);
    expect(vectorize.upserts).toHaveLength(before);
  });
});
