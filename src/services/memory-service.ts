import { EmbeddingRepository } from '../repositories/embedding-repository';
import { EventRepository } from '../repositories/event-repository';
import { MemoryRepository, type UpdateMemoryPatch } from '../repositories/memory-repository';
import type {
  ArchiveMemoryInput,
  CreateMemoryInput,
  ListMemoriesFilters,
  Memory,
  MemoryIndexState,
  MemoryListItem,
  MemoryWarning,
  RuntimeEnv,
  UpdateMemoryInput
} from '../types';
import { invalidStateTransition, memoryNotFound } from '../utils/errors';
import {
  contentHash,
  createMemoryId,
  generateTitleFromContent,
  nowIso,
  normalizeProject,
  normalizeSource,
  normalizeTags,
  normalizeType,
  stringifyMetadataJson,
  stringifyTagsJson
} from '../utils/memory';
import { EmbeddingService } from './embedding-service';
import { EventService } from './event-service';
import { SearchService } from './search-service';

export type ServiceContext = {
  source?: string | undefined;
};

export class MemoryService {
  private readonly memories: MemoryRepository;
  private readonly embeddings: EmbeddingRepository;
  private readonly events: EventService;
  private readonly indexing: EmbeddingService;

  constructor(private readonly env: RuntimeEnv) {
    this.memories = new MemoryRepository(env.DB);
    this.embeddings = new EmbeddingRepository(env.DB);
    this.events = new EventService(new EventRepository(env.DB));
    this.indexing = new EmbeddingService(env, this.memories, this.embeddings, this.events);
  }

  async createMemory(input: CreateMemoryInput, context: ServiceContext = {}): Promise<{
    memory: Memory;
    indexing: MemoryIndexState;
    warnings: MemoryWarning[];
  }> {
    const timestamp = nowIso();
    const source = normalizeSource(input.source ?? context.source, 'api');
    const content = input.content.trim();
    const memory: Memory = {
      id: createMemoryId(),
      title: input.title?.trim() || generateTitleFromContent(content),
      content,
      project: normalizeProject(input.project),
      scope: input.scope ?? 'long_term',
      type: normalizeType(input.type, 'note'),
      status: input.status ?? 'active',
      tags: normalizeTags(input.tags ?? []),
      source,
      embeddingStatus: 'pending',
      createdAt: timestamp,
      updatedAt: timestamp,
      archivedAt: null,
      metadata: input.metadata ?? {}
    };

    await this.memories.createMemory({
      id: memory.id,
      title: memory.title,
      content: memory.content,
      project: memory.project,
      scope: memory.scope,
      type: memory.type,
      status: memory.status,
      tags_json: stringifyTagsJson(memory.tags),
      source: memory.source,
      embedding_status: memory.embeddingStatus,
      created_at: memory.createdAt,
      updated_at: memory.updatedAt,
      archived_at: memory.archivedAt,
      metadata_json: stringifyMetadataJson(memory.metadata)
    });

    await this.events.recordCreateEvent(memory, source);
    const warnings = await this.duplicateWarnings(memory);
    warnings.push(...(await this.semanticDuplicateWarnings(memory)));
    const indexing = await this.indexing.indexMemory(memory, source);
    const saved = (await this.memories.getMemoryById(memory.id)) ?? memory;
    if (indexing.status === 'failed') {
      warnings.push({
        type: 'index_failed',
        severity: 'warning',
        message: indexing.failure?.message ?? 'indexing failed'
      });
    }

    return { memory: saved, indexing, warnings };
  }

  async listMemories(filters: ListMemoriesFilters): Promise<{
    items: MemoryListItem[];
    pagination: { limit: number; offset: number; nextCursor: string | null; hasMore: boolean };
  }> {
    const result = await this.memories.listMemories(filters);
    return {
      items: result.items,
      pagination: {
        limit: filters.limit,
        offset: filters.offset,
        nextCursor: null,
        hasMore: result.hasMore
      }
    };
  }

  async getMemory(id: string): Promise<{
    memory: Memory;
    events: Awaited<ReturnType<EventRepository['listEventsByMemoryId']>>;
    indexing: MemoryIndexState;
  }> {
    const memory = await this.requireMemory(id);
    const [events, indexing] = await Promise.all([
      new EventRepository(this.env.DB).listEventsByMemoryId(id, 20),
      this.indexing.getIndexState(memory)
    ]);
    return { memory, events, indexing };
  }

  async updateMemory(
    id: string,
    input: UpdateMemoryInput,
    context: ServiceContext = {}
  ): Promise<{ memory: Memory; indexing: MemoryIndexState; warnings: MemoryWarning[] }> {
    const existing = await this.requireMemory(id);
    const source = normalizeSource(context.source, existing.source ?? 'api');
    if (input.status === 'archived') {
      throw invalidStateTransition('use POST /memories/:id/archive to archive a memory', { id });
    }

    const warnings: MemoryWarning[] = [];
    if (existing.status === 'canonical') {
      warnings.push({
        type: 'canonical_edit',
        severity: 'warning',
        message: 'editing a canonical memory can affect trusted project context'
      });
    }

    const timestamp = nowIso();
    const patch: UpdateMemoryPatch = {};
    const before: Record<string, unknown> = {};
    const after: Record<string, unknown> = {};
    let contentChanged = false;

    if (input.title !== undefined && input.title.trim() !== existing.title) {
      patch.title = input.title.trim() || generateTitleFromContent(existing.content);
      before.title = existing.title;
      after.title = patch.title;
    }
    if (input.content !== undefined && input.content.trim() !== existing.content) {
      const nextContent = input.content.trim();
      patch.content = nextContent;
      patch.embedding_status = 'stale';
      before.contentHash = await contentHash(existing.content);
      before.embeddingStatus = existing.embeddingStatus;
      after.contentHash = await contentHash(nextContent);
      after.embeddingStatus = 'stale';
      contentChanged = true;
    }
    if (input.project !== undefined) {
      const project = normalizeProject(input.project);
      if (project !== existing.project) {
        patch.project = project;
        before.project = existing.project;
        after.project = project;
      }
    }
    if (input.scope !== undefined && input.scope !== existing.scope) {
      patch.scope = input.scope;
      before.scope = existing.scope;
      after.scope = input.scope;
    }
    if (input.type !== undefined) {
      const type = normalizeType(input.type, existing.type);
      if (type !== existing.type) {
        patch.type = type;
        before.type = existing.type;
        after.type = type;
      }
    }
    if (input.status !== undefined && input.status !== existing.status) {
      patch.status = input.status;
      before.status = existing.status;
      after.status = input.status;
    }
    if (input.tags !== undefined) {
      const tags = normalizeTags(input.tags);
      if (JSON.stringify(tags) !== JSON.stringify(existing.tags)) {
        patch.tags_json = stringifyTagsJson(tags);
        before.tags = existing.tags;
        after.tags = tags;
      }
    }
    if (input.metadata !== undefined && JSON.stringify(input.metadata) !== JSON.stringify(existing.metadata)) {
      patch.metadata_json = stringifyMetadataJson(input.metadata);
      before.metadata = existing.metadata;
      after.metadata = input.metadata;
    }

    if (Object.keys(patch).length === 0) {
      return {
        memory: existing,
        indexing: await this.indexing.getIndexState(existing),
        warnings
      };
    }

    patch.updated_at = timestamp;
    const updated = await this.memories.updateMemory(id, patch);
    if (!updated) throw memoryNotFound(id);
    await this.events.recordUpdateEvent(id, before, after, source);

    let indexing = await this.indexing.getIndexState(updated);
    let memory = updated;
    if (contentChanged) {
      indexing = await this.indexing.indexMemory(updated, source);
      memory = (await this.memories.getMemoryById(id)) ?? updated;
      if (indexing.status === 'failed') {
        warnings.push({
          type: 'index_failed',
          severity: 'warning',
          message: indexing.failure?.message ?? 'indexing failed'
        });
      }
    }

    return { memory, indexing, warnings };
  }

  async archiveMemory(
    id: string,
    input: ArchiveMemoryInput = {},
    context: ServiceContext = {}
  ): Promise<{ memory: Memory; warnings: MemoryWarning[] }> {
    const existing = await this.requireMemory(id);
    if (existing.status === 'archived') {
      return { memory: existing, warnings: [] };
    }

    const source = normalizeSource(input.source ?? context.source, existing.source ?? 'api');
    const timestamp = nowIso();
    const archived = await this.memories.archiveMemory(id, timestamp, timestamp);
    if (!archived) throw memoryNotFound(id);
    await this.events.recordArchiveEvent(
      id,
      { status: existing.status, archivedAt: existing.archivedAt },
      { status: 'archived', archivedAt: timestamp, reason: input.reason },
      source
    );
    return { memory: archived, warnings: [] };
  }

  private async requireMemory(id: string): Promise<Memory> {
    const memory = await this.memories.getMemoryById(id);
    if (!memory) throw memoryNotFound(id);
    return memory;
  }

  private async duplicateWarnings(memory: Memory): Promise<MemoryWarning[]> {
    const duplicates = await this.memories.findDuplicateTitles(memory.project, memory.title, memory.id);
    if (duplicates.length === 0) return [];
    return [
      {
        type: 'possible_duplicate',
        severity: 'info',
        message: 'A memory with the same title already exists in this project.',
        relatedMemoryIds: duplicates.map((item) => item.id)
      }
    ];
  }

  private async semanticDuplicateWarnings(memory: Memory): Promise<MemoryWarning[]> {
    try {
      return await new SearchService(this.env).findRelatedForNewMemory({
        content: memory.content,
        project: memory.project,
        type: memory.type,
        excludeId: memory.id
      });
    } catch (error) {
      // 语义提示只是辅助信息，失败不能影响 memory 创建主链路。
      console.warn('semantic duplicate check failed', error);
      return [];
    }
  }
}
