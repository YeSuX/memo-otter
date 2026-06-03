import type { MemoryEmbeddingRow, MemoryEventRow, MemoryRow } from '../src/types';
import type { RuntimeEnv } from '../src/types';

type TableName = 'memories' | 'memory_embeddings' | 'memory_events';
type FakeD1Options = {
  failEmbeddingMetadata?: boolean;
  failEmbeddingStatusUpdate?: boolean;
};

type FakeVectorizeRecord = {
  id: string;
  values: number[];
  metadata?: Record<string, unknown>;
};

type FakeVectorizeMatch = {
  id: string;
  score: number;
};

export class InMemoryD1 {
  memories: MemoryRow[] = [];
  embeddings: MemoryEmbeddingRow[] = [];
  events: MemoryEventRow[] = [];

  constructor(private readonly options: FakeD1Options = {}) {}

  prepare(sql: string) {
    return new FakeStatement(this, sql);
  }

  shouldFailEmbeddingMetadata(): boolean {
    return this.options.failEmbeddingMetadata === true;
  }

  shouldFailEmbeddingStatusUpdate(status: unknown): boolean {
    return this.options.failEmbeddingStatusUpdate === true && status === 'indexed';
  }
}

class FakeStatement {
  private bindings: unknown[] = [];

  constructor(
    private readonly db: InMemoryD1,
    private readonly sql: string
  ) {}

  bind(...bindings: unknown[]) {
    this.bindings = bindings;
    return this;
  }

  async run() {
    const sql = normalized(this.sql);
    if (sql.startsWith('insert into memories')) {
      const [
        id,
        title,
        content,
        project,
        scope,
        type,
        status,
        tagsJson,
        source,
        embeddingStatus,
        createdAt,
        updatedAt,
        archivedAt,
        metadataJson
      ] = this.bindings;
      this.db.memories.push({
        id: String(id),
        title: String(title),
        content: String(content),
        project: project === null ? null : String(project),
        scope: scope as MemoryRow['scope'],
        type: String(type),
        status: status as MemoryRow['status'],
        tags_json: String(tagsJson),
        source: source === null ? null : String(source),
        embedding_status: embeddingStatus as MemoryRow['embedding_status'],
        created_at: String(createdAt),
        updated_at: String(updatedAt),
        archived_at: archivedAt === null ? null : String(archivedAt),
        metadata_json: String(metadataJson)
      });
      return { success: true };
    }

    if (sql.startsWith('insert into memory_embeddings')) {
      if (this.db.shouldFailEmbeddingMetadata()) {
        throw new Error('metadata write failed');
      }
      const [id, memoryId, chunkIndex, hash, model, vectorId, createdAt] = this.bindings;
      const existing = this.db.embeddings.find(
        (row) => row.memory_id === memoryId && row.chunk_index === Number(chunkIndex) && row.content_hash === hash
      );
      if (existing) {
        // 模拟 ON CONFLICT DO UPDATE，确保测试能覆盖重复索引同内容的语义。
        existing.embedding_model = String(model);
        existing.vector_id = String(vectorId);
        existing.created_at = String(createdAt);
      } else if (!this.db.embeddings.some((row) => row.vector_id === vectorId)) {
        this.db.embeddings.push({
          id: String(id),
          memory_id: String(memoryId),
          chunk_index: Number(chunkIndex),
          content_hash: String(hash),
          embedding_model: String(model),
          vector_id: String(vectorId),
          created_at: String(createdAt)
        });
      }
      return { success: true };
    }

    if (sql.startsWith('insert into memory_events')) {
      const [id, memoryId, eventType, beforeJson, afterJson, source, createdAt] = this.bindings;
      this.db.events.push({
        id: String(id),
        memory_id: memoryId === null ? null : String(memoryId),
        event_type: eventType as MemoryEventRow['event_type'],
        before_json: beforeJson === null ? null : String(beforeJson),
        after_json: afterJson === null ? null : String(afterJson),
        source: source === null ? null : String(source),
        created_at: String(createdAt)
      });
      return { success: true };
    }

    if (sql.startsWith('update memories set embedding_status')) {
      const [status, id] = this.bindings;
      if (this.db.shouldFailEmbeddingStatusUpdate(status)) {
        throw new Error('embedding status update failed');
      }
      this.updateMemory(String(id), { embedding_status: status as MemoryRow['embedding_status'] });
      return { success: true };
    }

    if (sql.startsWith("update memories set status = 'archived'")) {
      const [archivedAt, updatedAt, id] = this.bindings;
      this.updateMemory(String(id), {
        status: 'archived',
        archived_at: String(archivedAt),
        updated_at: String(updatedAt)
      });
      return { success: true };
    }

    if (sql.startsWith('update memories set')) {
      const id = String(this.bindings[this.bindings.length - 1]);
      const assignments = this.sql.match(/SET\s+(.+)\s+WHERE/i)?.[1]?.split(',').map((part) => part.trim()) ?? [];
      const patch: Partial<MemoryRow> = {};
      assignments.forEach((assignment, index) => {
        const field = assignment.split(' = ')[0] as keyof MemoryRow;
        patch[field] = this.bindings[index] as never;
      });
      this.updateMemory(id, patch);
      return { success: true };
    }

    return { success: true };
  }

  async first<T>() {
    const results = await this.all<T>();
    return (results.results?.[0] as T | undefined) ?? null;
  }

  async all<T>() {
    const sql = normalized(this.sql);
    if (sql.includes('from memories')) {
      return { results: this.queryMemories() as T[] };
    }
    if (sql.includes('from memory_embeddings')) {
      return { results: this.queryEmbeddings() as T[] };
    }
    if (sql.includes('from memory_events')) {
      return { results: this.queryEvents() as T[] };
    }
    return { results: [] as T[] };
  }

  private updateMemory(id: string, patch: Partial<MemoryRow>) {
    const memory = this.db.memories.find((row) => row.id === id);
    if (memory) Object.assign(memory, patch);
  }

  private queryMemories(): MemoryRow[] {
    const sql = normalized(this.sql);
    if (sql === 'select * from memories where id = ?') {
      return this.db.memories.filter((row) => row.id === this.bindings[0]);
    }

    if (sql.includes('where id in')) {
      const ids = new Set(this.bindings.map(String));
      return this.db.memories.filter((row) => ids.has(row.id));
    }

    if (sql.includes('and title = ? and id <> ?')) {
      if (sql.includes('project is null')) {
        const [title, excludeId] = this.bindings;
        return this.db.memories.filter(
          (row) => row.project === null && row.title === title && row.id !== excludeId && row.status !== 'archived'
        );
      }
      const [project, title, excludeId] = this.bindings;
      return this.db.memories.filter(
        (row) => row.project === project && row.title === title && row.id !== excludeId && row.status !== 'archived'
      );
    }

    let rows = [...this.db.memories];
    let index = 0;
    if (sql.includes('project = ?')) rows = rows.filter((row) => row.project === this.bindings[index++]);
    if (sql.includes('scope = ?')) rows = rows.filter((row) => row.scope === this.bindings[index++]);
    if (sql.includes('type = ?')) rows = rows.filter((row) => row.type === this.bindings[index++]);
    if (sql.includes('status = ?')) rows = rows.filter((row) => row.status === this.bindings[index++]);
    if (sql.includes("status <> 'archived'")) rows = rows.filter((row) => row.status !== 'archived');

    const limit = Number(this.bindings[this.bindings.length - 2] ?? rows.length);
    const offset = Number(this.bindings[this.bindings.length - 1] ?? 0);
    return rows.sort((a, b) => b.updated_at.localeCompare(a.updated_at)).slice(offset, offset + limit);
  }

  private queryEmbeddings(): MemoryEmbeddingRow[] {
    const sql = normalized(this.sql);
    if (sql.includes('where memory_id = ?')) {
      return this.db.embeddings
        .filter((row) => row.memory_id === this.bindings[0])
        .sort((a, b) => b.created_at.localeCompare(a.created_at));
    }
    if (sql.includes('where vector_id in')) {
      const ids = new Set(this.bindings.map(String));
      return this.db.embeddings.filter((row) => ids.has(row.vector_id));
    }
    return [...this.db.embeddings];
  }

  private queryEvents(): MemoryEventRow[] {
    const sql = normalized(this.sql);
    let rows = this.db.events.filter((row) => row.memory_id === this.bindings[0]);
    if (sql.includes("event_type = 'index_failed'")) rows = rows.filter((row) => row.event_type === 'index_failed');
    const limit = Number(this.bindings[this.bindings.length - 1] ?? rows.length);
    return rows.sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, limit);
  }
}

function normalized(sql: string): string {
  return sql.replace(/\s+/g, ' ').trim().toLowerCase();
}

export function createFakeEnv(
  options: {
    failAi?: boolean;
    badAiShape?: boolean;
    failVectorize?: boolean;
    failVectorizeQuery?: boolean;
    vectorQueryResults?: FakeVectorizeMatch[];
    failEmbeddingMetadata?: boolean;
    failEmbeddingStatusUpdate?: boolean;
  } = {}
): RuntimeEnv {
  const d1Options: FakeD1Options = {};
  if (options.failEmbeddingMetadata !== undefined) d1Options.failEmbeddingMetadata = options.failEmbeddingMetadata;
  if (options.failEmbeddingStatusUpdate !== undefined) {
    d1Options.failEmbeddingStatusUpdate = options.failEmbeddingStatusUpdate;
  }
  const db = new InMemoryD1(d1Options);
  const vectorize = {
    upserts: [] as FakeVectorizeRecord[],
    queryResults: options.vectorQueryResults ? [...options.vectorQueryResults] : ([] as FakeVectorizeMatch[]),
    async upsert(vectors: FakeVectorizeRecord[]) {
      if (options.failVectorize) throw new Error('vectorize failed');
      this.upserts.push(...vectors);
      return { count: vectors.length };
    },
    async query(_values: number[], queryOptions?: { topK?: number }) {
      if (options.failVectorizeQuery) throw new Error('vectorize query failed');
      const matches = this.queryResults.length
        ? this.queryResults
        : this.upserts.map((vector, index) => ({
            id: vector.id,
            score: 1 - index * 0.01
          }));
      return { matches: matches.slice(0, queryOptions?.topK ?? matches.length) };
    }
  };
  return {
    DB: db as unknown as D1Database,
    AUTH_TOKEN: 'test-token',
    EMBEDDING_MODEL: '@cf/baai/bge-base-en-v1.5',
    AI: {
      async run() {
        if (options.failAi) throw new Error('embedding failed\n    at simulated stack frame');
        if (options.badAiShape) return { data: ['not-a-vector'] };
        return { data: [[0.1, 0.2, 0.3]] };
      }
    },
    VECTORIZE: vectorize
  } as unknown as RuntimeEnv;
}
