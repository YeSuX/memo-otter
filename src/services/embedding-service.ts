import { EmbeddingRepository } from '../repositories/embedding-repository';
import { MemoryRepository } from '../repositories/memory-repository';
import type { Memory, MemoryIndexState, RuntimeEnv } from '../types';
import {
  buildEmbeddableMemoryText,
  buildVectorId,
  contentHash,
  createEmbeddingId,
  latestEmbeddingToIndexSource,
  nowIso
} from '../utils/memory';
import { EventService } from './event-service';

type AiBinding = {
  run(model: string, input: Record<string, unknown>): Promise<unknown>;
};

type VectorizeBinding = {
  upsert(
    vectors: Array<{
      id: string;
      values: number[];
      metadata: Record<string, string | number | boolean | null>;
    }>
  ): Promise<unknown>;
};

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

    try {
      const text = buildEmbeddableMemoryText(memory);
      const embedding = await this.generateEmbedding(model, text);

      await (this.env.VECTORIZE as VectorizeBinding).upsert([
        {
          id: vectorId,
          values: embedding,
          metadata: {
            memory_id: memory.id,
            project: memory.project,
            scope: memory.scope,
            type: memory.type,
            status: memory.status,
            chunk_index: 0,
            content_hash: hash
          }
        }
      ]);

      const createdAt = nowIso();
      await this.embeddings.createEmbeddingRecord({
        id: createEmbeddingId(),
        memory_id: memory.id,
        chunk_index: 0,
        content_hash: hash,
        embedding_model: model,
        vector_id: vectorId,
        created_at: createdAt
      });

      await this.memories.updateEmbeddingStatus(memory.id, 'indexed');
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
    } catch (error) {
      const failure = classifyIndexFailure(error);
      await this.memories.updateEmbeddingStatus(memory.id, 'failed');
      await this.events.recordIndexFailedEvent(memory.id, failure, source);
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

  async reindexMemory(memory: Memory, source: string | null): Promise<MemoryIndexState> {
    if (memory.status === 'archived') {
      return this.getIndexState(memory);
    }
    return this.indexMemory(memory, source);
  }

  private async generateEmbedding(model: string, text: string): Promise<number[]> {
    const result = await (this.env.AI as AiBinding).run(model, { text: [text] });
    const vector = extractEmbeddingVector(result);
    if (!vector) {
      throw new Error('Workers AI did not return an embedding vector');
    }
    return vector;
  }

  private async eventsRepositoryFailure(memoryId: string): Promise<MemoryIndexState['failure']> {
    const event = await this.events.findLatestIndexFailure(memoryId);
    if (!event?.after) return null;
    return {
      stage: typeof event.after.stage === 'string' ? (event.after.stage as 'embedding' | 'vectorize' | 'd1_metadata') : null,
      message: typeof event.after.message === 'string' ? event.after.message : null
    };
  }
}

function extractEmbeddingVector(result: unknown): number[] | null {
  if (Array.isArray(result) && result.every((item) => typeof item === 'number')) return result;
  if (!result || typeof result !== 'object') return null;
  const record = result as Record<string, unknown>;
  const data = record.data;
  if (Array.isArray(data) && Array.isArray(data[0])) {
    const vector = data[0];
    return vector.every((item) => typeof item === 'number') ? vector : null;
  }
  if (Array.isArray(data) && data.every((item) => typeof item === 'number')) return data;
  const embedding = record.embedding;
  if (Array.isArray(embedding) && embedding.every((item) => typeof item === 'number')) return embedding;
  return null;
}

function classifyIndexFailure(error: unknown): NonNullable<MemoryIndexState['failure']> {
  const message = error instanceof Error ? error.message : String(error);
  const cleanMessage = message.replace(/[\u0000-\u001f\u007f]/g, ' ');
  const lower = cleanMessage.toLowerCase();
  const stage = lower.includes('vector') ? 'vectorize' : lower.includes('metadata') ? 'd1_metadata' : 'embedding';
  return {
    stage,
    message: cleanMessage.slice(0, 300)
  };
}
