import type {
  EmbeddingStatus,
  ListMemoriesFilters,
  Memory,
  MemoryRow,
  MemoryStatus,
  MemoryListItem
} from '../types';
import { memoryRowToDomain, memoryToListItem, stringifyMetadataJson, stringifyTagsJson } from '../utils/memory';

export type CreateMemoryRow = Omit<MemoryRow, never>;

export type UpdateMemoryPatch = Partial<{
  title: string;
  content: string;
  project: string | null;
  scope: MemoryRow['scope'];
  type: string;
  status: MemoryStatus;
  tags_json: string;
  metadata_json: string;
  embedding_status: EmbeddingStatus;
  updated_at: string;
  archived_at: string | null;
}>;

export class MemoryRepository {
  constructor(private readonly db: D1Database) {}

  async createMemory(row: CreateMemoryRow): Promise<Memory> {
    await this.db
      .prepare(
        `INSERT INTO memories (
          id, title, content, project, scope, type, status, tags_json, source,
          embedding_status, created_at, updated_at, archived_at, metadata_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        row.id,
        row.title,
        row.content,
        row.project,
        row.scope,
        row.type,
        row.status,
        row.tags_json,
        row.source,
        row.embedding_status,
        row.created_at,
        row.updated_at,
        row.archived_at,
        row.metadata_json
      )
      .run();

    return memoryRowToDomain(row);
  }

  async getMemoryById(id: string): Promise<Memory | null> {
    const row = await this.db.prepare('SELECT * FROM memories WHERE id = ?').bind(id).first<MemoryRow>();
    return row ? memoryRowToDomain(row) : null;
  }

  async findByIds(ids: string[]): Promise<Memory[]> {
    if (ids.length === 0) return [];
    const uniqueIds = [...new Set(ids)];
    const placeholders = uniqueIds.map(() => '?').join(', ');
    const result = await this.db
      .prepare(`SELECT * FROM memories WHERE id IN (${placeholders})`)
      .bind(...uniqueIds)
      .all<MemoryRow>();
    return (result.results ?? []).map(memoryRowToDomain);
  }

  async listMemories(filters: ListMemoriesFilters): Promise<{ items: MemoryListItem[]; hasMore: boolean }> {
    const conditions: string[] = [];
    const bindings: unknown[] = [];

    if (filters.project !== undefined && filters.project !== null) {
      conditions.push('project = ?');
      bindings.push(filters.project);
    }
    if (filters.scope) {
      conditions.push('scope = ?');
      bindings.push(filters.scope);
    }
    if (filters.type) {
      conditions.push('type = ?');
      bindings.push(filters.type);
    }
    if (filters.status) {
      conditions.push('status = ?');
      bindings.push(filters.status);
    } else if (!filters.includeArchived) {
      conditions.push("status <> 'archived'");
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const candidateLimit = filters.tags && filters.tags.length > 0 ? filters.limit * 3 + 1 : filters.limit + 1;
    const sql = `SELECT * FROM memories ${where} ORDER BY updated_at DESC LIMIT ? OFFSET ?`;
    const result = await this.db.prepare(sql).bind(...bindings, candidateLimit, filters.offset).all<MemoryRow>();
    const memories = (result.results ?? []).map(memoryRowToDomain);

    // tags_json 暂不建关系表，MVP 先在应用层过滤。
    const filtered = filters.tags?.length
      ? memories.filter((memory) => filters.tags!.some((tag) => memory.tags.includes(tag)))
      : memories;

    return {
      items: filtered.slice(0, filters.limit).map(memoryToListItem),
      hasMore: filtered.length > filters.limit || (result.results?.length ?? 0) > filters.limit
    };
  }

  async findDuplicateTitles(project: string | null, title: string, excludeId: string): Promise<MemoryListItem[]> {
    const projectCondition = project === null ? 'project IS NULL' : 'project = ?';
    const bindings = project === null ? [title, excludeId] : [project, title, excludeId];
    const result = await this.db
      .prepare(`SELECT * FROM memories WHERE ${projectCondition} AND title = ? AND id <> ? AND status <> 'archived'`)
      .bind(...bindings)
      .all<MemoryRow>();
    return (result.results ?? []).map(memoryRowToDomain).map(memoryToListItem);
  }

  async updateMemory(id: string, patch: UpdateMemoryPatch): Promise<Memory | null> {
    const entries = Object.entries(patch).filter(([, value]) => value !== undefined);
    if (entries.length === 0) return this.getMemoryById(id);

    const assignments = entries.map(([field]) => `${field} = ?`).join(', ');
    const values = entries.map(([, value]) => value);
    await this.db.prepare(`UPDATE memories SET ${assignments} WHERE id = ?`).bind(...values, id).run();
    return this.getMemoryById(id);
  }

  async updateEmbeddingStatus(id: string, status: EmbeddingStatus): Promise<Memory | null> {
    await this.db.prepare('UPDATE memories SET embedding_status = ? WHERE id = ?').bind(status, id).run();
    return this.getMemoryById(id);
  }

  async archiveMemory(id: string, archivedAt: string, updatedAt: string): Promise<Memory | null> {
    await this.db
      .prepare("UPDATE memories SET status = 'archived', archived_at = ?, updated_at = ? WHERE id = ?")
      .bind(archivedAt, updatedAt, id)
      .run();
    return this.getMemoryById(id);
  }
}

export function memoryToRow(memory: Memory): MemoryRow {
  return {
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
  };
}
