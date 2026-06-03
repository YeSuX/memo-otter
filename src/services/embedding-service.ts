import { EmbeddingRepository } from '../repositories/embedding-repository';
import { MemoryRepository } from '../repositories/memory-repository';
import type { Memory, MemoryIndexState, RuntimeEnv } from '../types';
import { extractEmbeddingVectorOrThrow } from '../utils/embedding';
import {
  buildEmbeddableMemoryText,
  buildVectorId,
  contentHash,
  createEmbeddingId,
  latestEmbeddingToIndexSource,
  nowIso
} from '../utils/memory';
import { EventService } from './event-service';

export class EmbeddingService {
  constructor(
    private readonly env: RuntimeEnv,
    private readonly memories: MemoryRepository,
    private readonly embeddings: EmbeddingRepository,
    private readonly events: EventService
  ) {}

  async getIndexState(memory: Memory): Promise<MemoryIndexState> {
    const [latest, failureEvent] = await Promise.all([
      this.embeddings.findLatestByMemoryId(memory.id),
      this.eventsRepositoryFailure(memory.id)
    ]);
    const source = latestEmbeddingToIndexSource(latest);
    return {
      status: memory.embeddingStatus,
      ...source,
      failure: failureEvent
    };
  }

  async indexMemory(memory: Memory, source: string | null): Promise<MemoryIndexState> {
    const model = this.env.EMBEDDING_MODEL || '@cf/baai/bge-base-en-v1.5';
    const hash = await contentHash(memory.content);
    const vectorId = buildVectorId(memory.id, hash);
    const text = buildEmbeddableMemoryText(memory);
    const createdAt = nowIso();
    let embedding: number[];

    try {
      embedding = await this.generateEmbedding(model, text);
    } catch (error) {
      return this.failIndex(memory.id, model, hash, source, 'embedding', error);
    }

    try {
      await this.env.VECTORIZE.upsert([
        {
          id: vectorId,
          values: embedding,
          metadata: {
            memory_id: memory.id,
            project: memory.project ?? '',
            scope: memory.scope,
            type: memory.type,
            status: memory.status,
            chunk_index: 0,
            content_hash: hash
          }
        }
      ]);
    } catch (error) {
      return this.failIndex(memory.id, model, hash, source, 'vectorize', error);
    }

    try {
      await this.embeddings.upsertEmbeddingRecord({
        id: createEmbeddingId(),
        memory_id: memory.id,
        chunk_index: 0,
        content_hash: hash,
        embedding_model: model,
        vector_id: vectorId,
        created_at: createdAt
      });

      await this.memories.updateEmbeddingStatus(memory.id, 'indexed');
    } catch (error) {
      return this.failIndex(memory.id, model, hash, source, 'd1_metadata', error);
    }

    const state: MemoryIndexState = {
      status: 'indexed',
      embeddingModel: model,
      vectorId,
      contentHash: hash,
      indexedAt: createdAt,
      failure: null
    };
    await this.events.recordIndexEvent(memory.id, state, source);
    return state;
  }

  async reindexMemory(memory: Memory, source: string | null): Promise<MemoryIndexState> {
    if (memory.status === 'archived') {
      return this.getIndexState(memory);
    }
    return this.indexMemory(memory, source);
  }

  private async generateEmbedding(model: string, text: string): Promise<number[]> {
    const result = await this.env.AI.run(model, { text: [text] });
    return extractEmbeddingVectorOrThrow(result);
  }

  private async eventsRepositoryFailure(memoryId: string): Promise<MemoryIndexState['failure']> {
    const event = await this.events.findLatestIndexFailure(memoryId);
    if (!event?.after) return null;
    return {
      stage: typeof event.after.stage === 'string' ? (event.after.stage as 'embedding' | 'vectorize' | 'd1_metadata') : null,
      message: typeof event.after.message === 'string' ? event.after.message : null
    };
  }

  private async failIndex(
    memoryId: string,
    model: string,
    hash: string,
    source: string | null,
    stage: NonNullable<MemoryIndexState['failure']>['stage'],
    error: unknown
  ): Promise<MemoryIndexState> {
    const failure = {
      stage,
      // 只保留可读摘要，避免把完整堆栈或控制字符写入 D1 event。
      message: sanitizeIndexError(error)
    };

    await this.memories.updateEmbeddingStatus(memoryId, 'failed');
    await this.events.recordIndexFailedEvent(memoryId, failure, source);

    return {
      status: 'failed',
      embeddingModel: model,
      vectorId: null,
      contentHash: hash,
      indexedAt: null,
      failure
    };
  }
}

function sanitizeIndexError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  // Cloudflare 远端错误有时会把栈片段塞进 message；事件里只保留第一段可读摘要。
  return message
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+at\s+(async\s+)?[\w$.<].*$/u, '')
    .slice(0, 300);
}
