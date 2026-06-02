import { EventRepository } from '../repositories/event-repository';
import type { Memory, MemoryEvent, MemoryIndexState } from '../types';
import { createEventId, nowIso, stringifyMetadataJson } from '../utils/memory';

export class EventService {
  constructor(private readonly events: EventRepository) {}

  async recordCreateEvent(memory: Memory, source: string | null): Promise<MemoryEvent | null> {
    return this.safeCreate({
      memoryId: memory.id,
      eventType: 'create',
      before: null,
      after: {
        title: memory.title,
        project: memory.project,
        scope: memory.scope,
        type: memory.type,
        status: memory.status,
        tags: memory.tags
      },
      source
    });
  }

  async recordUpdateEvent(
    memoryId: string,
    before: Record<string, unknown>,
    after: Record<string, unknown>,
    source: string | null
  ): Promise<MemoryEvent | null> {
    return this.safeCreate({ memoryId, eventType: 'update', before, after, source });
  }

  async recordArchiveEvent(
    memoryId: string,
    before: Record<string, unknown>,
    after: Record<string, unknown>,
    source: string | null
  ): Promise<MemoryEvent | null> {
    return this.safeCreate({ memoryId, eventType: 'archive', before, after, source });
  }

  async recordIndexEvent(memoryId: string, state: MemoryIndexState, source: string | null): Promise<MemoryEvent | null> {
    return this.safeCreate({
      memoryId,
      eventType: 'index',
      before: null,
      after: {
        embeddingStatus: state.status,
        embeddingModel: state.embeddingModel,
        vectorId: state.vectorId,
        contentHash: state.contentHash
      },
      source
    });
  }

  async recordIndexFailedEvent(
    memoryId: string,
    failure: NonNullable<MemoryIndexState['failure']>,
    source: string | null
  ): Promise<MemoryEvent | null> {
    return this.safeCreate({
      memoryId,
      eventType: 'index_failed',
      before: null,
      after: {
        stage: failure.stage,
        message: failure.message
      },
      source
    });
  }

  async findLatestIndexFailure(memoryId: string): Promise<MemoryEvent | null> {
    return this.events.findLatestIndexFailure(memoryId);
  }

  private async safeCreate(input: {
    memoryId: string;
    eventType: 'create' | 'update' | 'archive' | 'index' | 'index_failed';
    before: Record<string, unknown> | null;
    after: Record<string, unknown> | null;
    source: string | null;
  }): Promise<MemoryEvent | null> {
    try {
      return await this.events.createEvent({
        id: createEventId(),
        memory_id: input.memoryId,
        event_type: input.eventType,
        before_json: input.before ? stringifyMetadataJson(input.before) : null,
        after_json: input.after ? stringifyMetadataJson(input.after) : null,
        source: input.source,
        created_at: nowIso()
      });
    } catch (error) {
      // event 是轻量解释层，写失败不应回滚已经成功的主业务操作。
      console.error(JSON.stringify({ level: 'error', message: 'memory_event_write_failed', error: String(error) }));
      return null;
    }
  }
}
