CREATE TABLE IF NOT EXISTS memories (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  project TEXT,
  scope TEXT NOT NULL DEFAULT 'long_term',
  type TEXT NOT NULL DEFAULT 'note',
  status TEXT NOT NULL DEFAULT 'active',
  tags_json TEXT NOT NULL DEFAULT '[]',
  source TEXT,
  embedding_status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  CHECK (length(trim(content)) > 0),
  CHECK (scope IN ('long_term', 'short_term')),
  CHECK (length(trim(type)) > 0),
  CHECK (status IN ('draft', 'active', 'canonical', 'archived')),
  CHECK (embedding_status IN ('pending', 'indexed', 'failed', 'stale')),
  CHECK (
    (status = 'archived' AND archived_at IS NOT NULL)
    OR (status <> 'archived')
  )
);

CREATE INDEX IF NOT EXISTS idx_memories_project
  ON memories(project);

CREATE INDEX IF NOT EXISTS idx_memories_scope
  ON memories(scope);

CREATE INDEX IF NOT EXISTS idx_memories_type
  ON memories(type);

CREATE INDEX IF NOT EXISTS idx_memories_status
  ON memories(status);

CREATE INDEX IF NOT EXISTS idx_memories_updated_at
  ON memories(updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_memories_project_scope_status
  ON memories(project, scope, status);

CREATE INDEX IF NOT EXISTS idx_memories_project_scope_type_status
  ON memories(project, scope, type, status);

CREATE TABLE IF NOT EXISTS memory_embeddings (
  id TEXT PRIMARY KEY,
  memory_id TEXT NOT NULL,
  chunk_index INTEGER NOT NULL DEFAULT 0,
  content_hash TEXT NOT NULL,
  embedding_model TEXT NOT NULL,
  vector_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(memory_id, chunk_index, content_hash),
  UNIQUE(vector_id),
  FOREIGN KEY(memory_id) REFERENCES memories(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_memory_embeddings_memory_id
  ON memory_embeddings(memory_id);

CREATE INDEX IF NOT EXISTS idx_memory_embeddings_vector_id
  ON memory_embeddings(vector_id);

CREATE INDEX IF NOT EXISTS idx_memory_embeddings_model
  ON memory_embeddings(embedding_model);

CREATE TABLE IF NOT EXISTS memory_events (
  id TEXT PRIMARY KEY,
  memory_id TEXT,
  event_type TEXT NOT NULL,
  before_json TEXT,
  after_json TEXT,
  source TEXT,
  created_at TEXT NOT NULL,
  CHECK (event_type IN ('create', 'update', 'archive', 'index', 'index_failed', 'export')),
  FOREIGN KEY(memory_id) REFERENCES memories(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_memory_events_memory_id
  ON memory_events(memory_id);

CREATE INDEX IF NOT EXISTS idx_memory_events_created_at
  ON memory_events(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_memory_events_type
  ON memory_events(event_type);
