import type {
  Memory,
  MemoryEmbeddingRow,
  MemoryEvent,
  MemoryEventRow,
  MemoryListItem,
  MemoryRow
} from '../types';

const encoder = new TextEncoder();

export function nowIso(): string {
  return new Date().toISOString();
}

export function createMemoryId(): string {
  return `mem_${crypto.randomUUID()}`;
}

export function createEventId(): string {
  return `evt_${crypto.randomUUID()}`;
}

export function createEmbeddingId(): string {
  return `emb_${crypto.randomUUID()}`;
}

export function normalizeProject(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function normalizeType(value: unknown, fallback = 'note'): string {
  const raw = typeof value === 'string' ? value : fallback;
  const normalized = raw
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return normalized || fallback;
}

export function normalizeTags(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const tag = item.trim().toLowerCase();
    if (!tag || seen.has(tag)) continue;
    seen.add(tag);
    tags.push(tag);
  }
  return tags;
}

export function normalizeSource(value: unknown, fallback = 'api'): string {
  if (typeof value !== 'string') return fallback;
  const normalized = value.trim().toLowerCase().replace(/\s+/g, '-');
  return normalized || fallback;
}

export function generateTitleFromContent(content: string): string {
  const compact = content.trim().replace(/\s+/g, ' ');
  if (compact.length <= 60) return compact;
  return `${compact.slice(0, 57)}...`;
}

export function safeParseTagsJson(value: string | null): string[] {
  try {
    return normalizeTags(JSON.parse(value ?? '[]'));
  } catch {
    // D1 是源数据，但 JSON 损坏时要先保证 API 仍能返回。
    return [];
  }
}

export function safeParseMetadataJson(value: string | null): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(value ?? '{}');
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return {};
  } catch {
    // metadata 损坏不应拖垮详情页，后续可通过事件或日志排查。
    return {};
  }
}

export function stringifyTagsJson(tags: string[]): string {
  return JSON.stringify(normalizeTags(tags));
}

export function stringifyMetadataJson(metadata: Record<string, unknown>): string {
  return JSON.stringify(metadata);
}

export async function contentHash(content: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(content));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function buildVectorId(memoryId: string, hash: string, chunkIndex = 0): string {
  // Vectorize 的 id 上限是 64 bytes；这里压缩 UUID 和字段名，避免长 memory id 导致 upsert 失败。
  const compactMemoryId = memoryId.replace(/^mem_/, '').replace(/-/g, '').slice(0, 32);
  return `m:${compactMemoryId}:c:${chunkIndex}:h:${hash.slice(0, 12)}`;
}

export function buildEmbeddableMemoryText(memory: Memory): string {
  return [
    `Title: ${memory.title}`,
    `Project: ${memory.project ?? ''}`,
    `Scope: ${memory.scope}`,
    `Type: ${memory.type}`,
    `Tags: ${memory.tags.join(', ')}`,
    'Content:',
    memory.content
  ].join('\n');
}

export function memoryRowToDomain(row: MemoryRow): Memory {
  return {
    id: row.id,
    title: row.title,
    content: row.content,
    project: row.project,
    scope: row.scope,
    type: row.type,
    status: row.status,
    tags: safeParseTagsJson(row.tags_json),
    source: row.source,
    embeddingStatus: row.embedding_status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    archivedAt: row.archived_at,
    metadata: safeParseMetadataJson(row.metadata_json)
  };
}

export function memoryToListItem(memory: Memory): MemoryListItem {
  const { content: _content, archivedAt: _archivedAt, metadata: _metadata, ...item } = memory;
  return item;
}

export function eventRowToDomain(row: MemoryEventRow): MemoryEvent {
  return {
    id: row.id,
    memoryId: row.memory_id,
    eventType: row.event_type,
    before: safeParseMetadataJson(row.before_json),
    after: safeParseMetadataJson(row.after_json),
    source: row.source,
    createdAt: row.created_at
  };
}

export function latestEmbeddingToIndexSource(row: MemoryEmbeddingRow | null): {
  embeddingModel: string | null;
  vectorId: string | null;
  contentHash: string | null;
  indexedAt: string | null;
} {
  return {
    embeddingModel: row?.embedding_model ?? null,
    vectorId: row?.vector_id ?? null,
    contentHash: row?.content_hash ?? null,
    indexedAt: row?.created_at ?? null
  };
}
