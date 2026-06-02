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

  it('keeps memory when indexing fails', async () => {
    const env = createFakeEnv({ failAi: true });
    const service = new MemoryService(env);
    const result = await service.createMemory({ content: 'Indexing can fail safely.' });
    expect(result.memory.embeddingStatus).toBe('failed');
    expect(result.warnings.some((warning) => warning.type === 'index_failed')).toBe(true);
  });

  it('does not reindex metadata-only edits', async () => {
    const env = createFakeEnv();
    const service = new MemoryService(env);
    const created = await service.createMemory({ content: 'Stable content.', tags: ['one'] });
    const updated = await service.updateMemory(created.memory.id, { tags: ['one', 'two'] });
    expect(updated.indexing.vectorId).toBe(created.indexing.vectorId);
  });
});
