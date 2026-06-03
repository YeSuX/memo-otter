import type { MemoryEmbeddingRow } from '../types';

export class EmbeddingRepository {
  constructor(private readonly db: D1Database) {}

  async upsertEmbeddingRecord(row: MemoryEmbeddingRow): Promise<MemoryEmbeddingRow> {
    await this.db
      .prepare(
        `INSERT INTO memory_embeddings (
          id, memory_id, chunk_index, content_hash, embedding_model, vector_id, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(memory_id, chunk_index, content_hash) DO UPDATE SET
          embedding_model = excluded.embedding_model,
          vector_id = excluded.vector_id,
          created_at = excluded.created_at`
      )
      .bind(row.id, row.memory_id, row.chunk_index, row.content_hash, row.embedding_model, row.vector_id, row.created_at)
      .run();
    return row;
  }

  async findLatestByMemoryId(memoryId: string): Promise<MemoryEmbeddingRow | null> {
    const row = await this.db
      .prepare('SELECT * FROM memory_embeddings WHERE memory_id = ? ORDER BY created_at DESC LIMIT 1')
      .bind(memoryId)
      .first<MemoryEmbeddingRow>();
    return row ?? null;
  }

  async findByMemoryId(memoryId: string): Promise<MemoryEmbeddingRow[]> {
    const result = await this.db
      .prepare('SELECT * FROM memory_embeddings WHERE memory_id = ? ORDER BY chunk_index ASC, created_at DESC')
      .bind(memoryId)
      .all<MemoryEmbeddingRow>();
    return result.results ?? [];
  }

  async findByVectorIds(vectorIds: string[]): Promise<MemoryEmbeddingRow[]> {
    if (vectorIds.length === 0) return [];
    const placeholders = vectorIds.map(() => '?').join(', ');
    const result = await this.db
      .prepare(`SELECT * FROM memory_embeddings WHERE vector_id IN (${placeholders})`)
      .bind(...vectorIds)
      .all<MemoryEmbeddingRow>();
    return result.results ?? [];
  }
}
