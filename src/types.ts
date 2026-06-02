export type MemoryScope = 'long_term' | 'short_term';
export type MemoryStatus = 'draft' | 'active' | 'canonical' | 'archived';
export type EmbeddingStatus = 'pending' | 'indexed' | 'failed' | 'stale';
export type MemoryEventType = 'create' | 'update' | 'archive' | 'index' | 'index_failed' | 'export';
export type RuntimeEnv = Env & { AUTH_TOKEN: string };

export type Memory = {
  id: string;
  title: string;
  content: string;
  project: string | null;
  scope: MemoryScope;
  type: string;
  status: MemoryStatus;
  tags: string[];
  source: string | null;
  embeddingStatus: EmbeddingStatus;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
  metadata: Record<string, unknown>;
};

export type MemoryListItem = Omit<Memory, 'content' | 'archivedAt' | 'metadata'>;

export type MemoryEvent = {
  id: string;
  memoryId: string | null;
  eventType: MemoryEventType;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  source: string | null;
  createdAt: string;
};

export type MemoryIndexState = {
  status: EmbeddingStatus;
  embeddingModel: string | null;
  vectorId: string | null;
  contentHash: string | null;
  indexedAt: string | null;
  failure: {
    stage: 'embedding' | 'vectorize' | 'd1_metadata' | null;
    message: string | null;
  } | null;
};

export type MemoryWarning = {
  type: 'possible_duplicate' | 'possible_conflict' | 'canonical_edit' | 'index_failed';
  severity: 'info' | 'warning';
  message: string;
  relatedMemoryIds?: string[];
};

export type MemoryRow = {
  id: string;
  title: string;
  content: string;
  project: string | null;
  scope: MemoryScope;
  type: string;
  status: MemoryStatus;
  tags_json: string;
  source: string | null;
  embedding_status: EmbeddingStatus;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
  metadata_json: string;
};

export type MemoryEmbeddingRow = {
  id: string;
  memory_id: string;
  chunk_index: number;
  content_hash: string;
  embedding_model: string;
  vector_id: string;
  created_at: string;
};

export type MemoryEventRow = {
  id: string;
  memory_id: string | null;
  event_type: MemoryEventType;
  before_json: string | null;
  after_json: string | null;
  source: string | null;
  created_at: string;
};

export type ListMemoriesFilters = {
  project?: string | null | undefined;
  scope?: MemoryScope | undefined;
  type?: string | undefined;
  status?: MemoryStatus | undefined;
  tags?: string[] | undefined;
  includeArchived: boolean;
  limit: number;
  offset: number;
  cursor?: string | undefined;
};

export type CreateMemoryInput = {
  title?: string | undefined;
  content: string;
  project?: string | null | undefined;
  scope?: MemoryScope | undefined;
  type?: string | undefined;
  status?: Exclude<MemoryStatus, 'archived'> | undefined;
  tags?: string[] | undefined;
  source?: string | undefined;
  metadata?: Record<string, unknown> | undefined;
};

export type UpdateMemoryInput = {
  title?: string | undefined;
  content?: string | undefined;
  project?: string | null | undefined;
  scope?: MemoryScope | undefined;
  type?: string | undefined;
  status?: MemoryStatus | undefined;
  tags?: string[] | undefined;
  metadata?: Record<string, unknown> | undefined;
};

export type ArchiveMemoryInput = {
  source?: string | undefined;
  reason?: string | undefined;
};
