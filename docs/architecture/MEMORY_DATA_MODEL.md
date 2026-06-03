# Memo Otter Memory 数据模型设计计划

更新时间：2026-06-02

这份文档细化 Memo Otter MVP 的 Memory 数据模型。它承接 `FUNCTIONAL_MODULES.md` 中的“Memory 数据模型”模块，并为后续 D1 migration、repository、schema 校验、索引流程、导出和测试提供可执行设计。

## 1. 模块目标

Memory 数据模型要支撑 Memo Otter 的最小闭环：

```text
保存记忆 -> D1 保存源数据 -> Workers AI 生成 embedding -> Vectorize 写入向量 -> 搜索召回 -> 编辑/归档/导出/重新索引
```

MVP 的核心原则：

- D1 是唯一源数据。
- Vectorize 只是可重建索引，不保存不可恢复的业务数据。
- API 和 UI 面向用户暴露 `tags: string[]`、`metadata: object`。
- D1 中暂用 JSON 字符串保存 `tags_json` 和 `metadata_json`。
- `project` 第一版是自由文本，不建立独立项目实体。
- `archived` memory 默认不参与搜索和项目上下文召回。
- 第一版不实现 `deprecated`、`supersedes`、复杂版本关系和自动合并。
- Memory 先按 `scope` 区分长期和短期，再用用户可自定义的 `type` 做具体分类。

## 2. 数据表总览

MVP 需要 3 张 D1 表：

| 表名 | 作用 | 是否源数据 |
| --- | --- | --- |
| `memories` | 保存 memory 的可读业务数据和状态 | 是 |
| `memory_embeddings` | 保存 memory 与 Vectorize 向量的索引元数据 | 是，索引元数据 |
| `memory_events` | 保存轻量事件，方便调试、导出和解释 memory 变化 | 是，事件数据 |

Vectorize 中保存向量本身，向量内容可以通过 `memories` 和 `memory_embeddings` 重新生成。

## 3. 枚举设计

### 3.1 Memory 生命周期

`memories.scope` 只允许：

| 值 | 含义 | 典型内容 |
| --- | --- | --- |
| `long_term` | 长期记忆，默认参与跨会话召回 | 用户偏好、项目原则、稳定上下文、重要决策 |
| `short_term` | 短期记忆，主要服务当前阶段或近期任务 | 临时上下文、阶段性笔记、待确认信息 |

默认值：`long_term`。

设计理由：

- 长期/短期比固定业务类型更接近 memory 的核心生命周期。
- 搜索和项目上下文可以先按 `scope` 做粗粒度召回控制。
- 未来可以给 `short_term` 增加过期、清理或提升为长期记忆的流程。

### 3.2 Memory 类型

`memories.type` 是用户可自定义的具体分类。

MVP 内置建议值：

| 值 | 含义 | 典型内容 |
| --- | --- | --- |
| `decision` | 会影响未来工作的决策 | 技术选型、产品边界、架构决定 |
| `preference` | 用户偏好 | 写作风格、编码偏好、工具偏好 |
| `context` | 背景上下文 | 项目目标、依赖关系、团队约定 |
| `note` | 一般笔记 | 学习记录、临时观察、普通备忘 |

默认值：`note`。

规则：

- `type` 不再做固定枚举约束。
- 用户可以创建自定义类型，例如 `meeting`、`api-contract`、`research`、`temporary-finding`。
- MVP 不需要单独的 `memory_types` 表，先把自定义类型作为字符串保存在 `memories.type`。
- API/UI 可以提供内置建议值，但不阻止用户输入其他合法类型。
- 服务层负责规范化：trim、小写化、空格转短横线，避免同义拼写过多。

不进入 MVP：

- `bug`
- `deprecated`
- 独立类型管理后台
- 类型颜色、图标和排序配置

### 3.3 Memory 状态

`memories.status` 只允许：

| 值 | 含义 | 搜索默认行为 |
| --- | --- | --- |
| `draft` | 有价值但尚未确认 | 参与搜索，但权重低 |
| `active` | 当前有用 | 参与搜索 |
| `canonical` | 权威记忆，优先参与召回 | 参与搜索，权重高 |
| `archived` | 已归档，保留历史 | 默认不参与搜索 |

默认值：`active`。

状态边界：

- `canonical` 不禁止编辑，但 UI 应提示这会影响可信上下文。
- `active` 和 `canonical` 都可以归档。
- 归档只做软归档，不物理删除 D1 数据。
- `archived` 可以通过明确的更新操作恢复为 `active` 或 `draft`，但 MVP UI 可以先不提供“恢复”入口。

### 3.4 Embedding 索引状态

`memories.embedding_status` 只允许：

| 值 | 含义 | 触发场景 |
| --- | --- | --- |
| `pending` | 等待生成 embedding 或写入 Vectorize | 创建 memory 后，索引前 |
| `indexed` | 已成功写入 Vectorize | 索引成功后 |
| `failed` | embedding 或 Vectorize 写入失败 | Workers AI 或 Vectorize 失败 |
| `stale` | 内容已变化，旧索引不再可信 | 编辑 `content` 后，重新索引前 |

默认创建状态：`pending`。

搜索行为：

- 语义搜索只依赖 Vectorize 能召回的向量。
- D1 回查后必须过滤 `status = archived`，除非请求显式设置 `include_archived = true`。
- 如果某条 memory 是 `pending`、`failed` 或 `stale`，它通常不会被 Vectorize 召回；列表和详情仍然展示真实状态。

### 3.5 Memory event 类型

`memory_events.event_type` MVP 建议允许：

| 值 | 含义 |
| --- | --- |
| `create` | 创建 memory |
| `update` | 更新 memory |
| `archive` | 归档 memory |
| `index` | 索引成功 |
| `index_failed` | 索引失败 |
| `export` | 执行导出 |

事件系统只用于轻量解释和调试，不做完整审计后台。事件写入失败不应该让已完成的主业务操作回滚，除非后续明确要实现强审计。

## 4. 表结构设计

### 4.1 `memories`

`memories` 是业务源数据表。

| 字段 | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `id` | `TEXT` | 是 | 应用生成 | Memory 主键 |
| `title` | `TEXT` | 是 | 内容截断生成 | 用户可读标题 |
| `content` | `TEXT` | 是 | 无 | Memory 正文 |
| `project` | `TEXT` | 否 | `NULL` | 自由文本项目名 |
| `scope` | `TEXT` | 是 | `long_term` | Memory 生命周期，长期或短期 |
| `type` | `TEXT` | 是 | `note` | 用户可自定义的 Memory 类型 |
| `status` | `TEXT` | 是 | `active` | Memory 状态 |
| `tags_json` | `TEXT` | 是 | `[]` | JSON string，API/UI 中映射为 `tags` 数组 |
| `source` | `TEXT` | 否 | 入口决定 | 来源，如 `web`、`skill`、`api` |
| `embedding_status` | `TEXT` | 是 | `pending` | 索引状态 |
| `created_at` | `TEXT` | 是 | 应用生成 | ISO 8601 UTC 时间 |
| `updated_at` | `TEXT` | 是 | 应用生成 | ISO 8601 UTC 时间 |
| `archived_at` | `TEXT` | 否 | `NULL` | 归档时间 |
| `metadata_json` | `TEXT` | 否 | `{}` | JSON string，扩展元数据 |

设计说明：

- `title` 在 D1 中保持 `NOT NULL`，避免列表 UI 缺少标题。
- 用户不传 `title` 时，由应用从 `content` 前若干字符生成。
- `scope` 用来表达长期/短期，这是系统级分类，必须受枚举约束。
- `type` 是用户可自定义分类，不做固定业务枚举约束。
- `tags_json` 使用 `TEXT NOT NULL`，默认值是字符串 `[]`。
- `metadata_json` 可以为 `NULL` 或 `{}`，推荐应用层统一写入 `{}`，降低反序列化分支。
- `created_at`、`updated_at`、`archived_at` 使用 ISO 8601 字符串，便于 D1 排序和导出。

推荐索引：

| 索引名 | 字段 | 用途 |
| --- | --- | --- |
| `idx_memories_project` | `project` | project 过滤和项目上下文 |
| `idx_memories_scope` | `scope` | long-term / short-term 过滤 |
| `idx_memories_type` | `type` | type 过滤 |
| `idx_memories_status` | `status` | 默认排除 archived |
| `idx_memories_updated_at` | `updated_at` | 最近更新列表 |
| `idx_memories_project_scope_status` | `project, scope, status` | 项目上下文默认过滤 |
| `idx_memories_project_scope_type_status` | `project, scope, type, status` | 项目上下文按生命周期和类型分组 |

### 4.2 `memory_embeddings`

`memory_embeddings` 保存 D1 memory 与 Vectorize 向量之间的关系。

| 字段 | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `id` | `TEXT` | 是 | 应用生成 | Embedding 记录主键 |
| `memory_id` | `TEXT` | 是 | 无 | 对应 `memories.id` |
| `chunk_index` | `INTEGER` | 是 | `0` | 分块序号，MVP 默认 0 |
| `content_hash` | `TEXT` | 是 | 应用生成 | 用于判断内容是否变化 |
| `embedding_model` | `TEXT` | 是 | 配置读取 | Workers AI embedding 模型名 |
| `vector_id` | `TEXT` | 是 | 应用生成 | Vectorize 中的向量 id |
| `created_at` | `TEXT` | 是 | 应用生成 | 创建时间 |

MVP 分块规则：

- 默认每条 memory 只生成一个 chunk，`chunk_index = 0`。
- 长文本分块延后。
- 如果第一版必须处理超长内容，先在应用层拒绝超长输入或截断用于 embedding，同时 D1 保留完整 `content`。

`vector_id` 推荐格式：

```text
mem:{memory_id}:chunk:{chunk_index}:hash:{short_content_hash}
```

这样可以通过 vector id 追踪来源，也方便内容更新后写入新向量。

推荐约束：

- `UNIQUE(memory_id, chunk_index, content_hash)`：避免同一内容重复写入相同 chunk 元数据。
- `UNIQUE(vector_id)`：避免 Vectorize id 冲突。
- `FOREIGN KEY(memory_id) REFERENCES memories(id) ON DELETE CASCADE`：保留逻辑关联。MVP 不物理删除 memory，因此级联删除主要用于开发和测试环境。

推荐索引：

| 索引名 | 字段 | 用途 |
| --- | --- | --- |
| `idx_memory_embeddings_memory_id` | `memory_id` | 详情页查询索引元数据 |
| `idx_memory_embeddings_vector_id` | `vector_id` | Vectorize 召回后回查 D1 |
| `idx_memory_embeddings_model` | `embedding_model` | 后续 re-embedding 或模型迁移 |

### 4.3 `memory_events`

`memory_events` 保存轻量事件。

| 字段 | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `id` | `TEXT` | 是 | 应用生成 | Event 主键 |
| `memory_id` | `TEXT` | 否 | `NULL` | 对应 memory；导出事件可为空 |
| `event_type` | `TEXT` | 是 | 无 | 事件类型 |
| `before_json` | `TEXT` | 否 | `NULL` | 变更前快照或差异 |
| `after_json` | `TEXT` | 否 | `NULL` | 变更后快照或差异 |
| `source` | `TEXT` | 否 | 入口决定 | 来源，如 `web`、`skill`、`api`、`system` |
| `created_at` | `TEXT` | 是 | 应用生成 | 事件时间 |

事件数据建议：

- `create`：`before_json = NULL`，`after_json` 保存创建后的核心字段。
- `update`：`before_json` 和 `after_json` 保存发生变化的字段，而不是每次保存完整正文。
- `archive`：记录归档前后的 `status`、`archived_at`。
- `index`：记录 `embedding_status`、`embedding_model`、`vector_id`、`content_hash`。
- `index_failed`：记录失败阶段和错误摘要，避免保存完整错误堆栈。
- `export`：`memory_id = NULL`，记录导出范围和条数。

推荐索引：

| 索引名 | 字段 | 用途 |
| --- | --- | --- |
| `idx_memory_events_memory_id` | `memory_id` | Memory 详情页展示最近事件 |
| `idx_memory_events_created_at` | `created_at` | 最近事件和导出 |
| `idx_memory_events_type` | `event_type` | 调试索引失败和导出记录 |

## 5. Migration 草案

第一版 migration 可以命名为：

```text
migrations/0001_create_memory_tables.sql
```

建议 SQL：

```sql
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
```

注意：

- D1 基于 SQLite，表级 `CHECK` 适合表达 MVP 枚举约束。
- JSON 字段的结构校验仍建议放在应用层，避免把 JSON 兼容性问题藏进数据库。
- `archived_at` 的约束要求 `status = archived` 时必须有归档时间，但不强制非 archived 状态清空 `archived_at`。这样未来恢复归档 memory 时可以保留历史归档时间；如果希望恢复时清空，交给服务层处理。

## 6. 应用层数据模型

### 6.1 API/UI Memory 结构

API 和 UI 使用：

```ts
type MemoryScope = 'long_term' | 'short_term';
type MemoryType = string;
type MemoryStatus = 'draft' | 'active' | 'canonical' | 'archived';
type EmbeddingStatus = 'pending' | 'indexed' | 'failed' | 'stale';

type Memory = {
  id: string;
  title: string;
  content: string;
  project: string | null;
  scope: MemoryScope;
  type: MemoryType;
  status: MemoryStatus;
  tags: string[];
  source: string | null;
  embeddingStatus: EmbeddingStatus;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
  metadata: Record<string, unknown>;
};
```

D1 映射：

| API/UI 字段 | D1 字段 |
| --- | --- |
| `scope` | `scope` |
| `type` | `type` |
| `tags` | `tags_json` |
| `metadata` | `metadata_json` |
| `embeddingStatus` | `embedding_status` |
| `createdAt` | `created_at` |
| `updatedAt` | `updated_at` |
| `archivedAt` | `archived_at` |

### 6.2 创建输入

```ts
type CreateMemoryInput = {
  title?: string;
  content: string;
  project?: string;
  scope?: MemoryScope;
  type?: MemoryType;
  status?: Exclude<MemoryStatus, 'archived'>;
  tags?: string[];
  source?: string;
  metadata?: Record<string, unknown>;
};
```

创建规则：

- `content` 必填，trim 后不能为空。
- `title` 可选；为空时从 `content` 自动生成。
- `scope` 默认 `long_term`。
- `type` 默认 `note`。
- `type` 允许用户自定义，但必须能规范化为非空短字符串。
- `status` 默认 `active`，创建时不建议直接传 `archived`。
- `tags` 默认 `[]`。
- `metadata` 默认 `{}`。
- `source` 由入口设置：Web UI 默认 `web`，Skill 默认 `skill`，普通 REST 调用默认 `api`。
- `id`、`created_at`、`updated_at` 由应用生成。
- `created_at` 和 `updated_at` 创建时相同。
- `archived_at` 创建时为 `NULL`。
- `embedding_status` 创建时为 `pending`。

### 6.3 更新输入

```ts
type UpdateMemoryInput = {
  title?: string;
  content?: string;
  project?: string | null;
  scope?: MemoryScope;
  type?: MemoryType;
  status?: MemoryStatus;
  tags?: string[];
  metadata?: Record<string, unknown>;
};
```

更新规则：

- 任何成功更新都必须刷新 `updated_at`。
- 如果 `content` 变化：
  - 先写入新的 `content`。
  - 设置 `embedding_status = stale`。
  - 记录 `update` event。
  - 重新生成 embedding 并写入 Vectorize。
  - 成功后写入 `memory_embeddings` 并设置 `embedding_status = indexed`。
  - 失败后设置 `embedding_status = failed` 并记录 `index_failed` event。
- 如果只更新 `title`、`project`、`scope`、`type`、`status`、`tags`、`metadata`：
  - 不强制重新生成 embedding。
  - 只更新 D1 和 `updated_at`。
- 如果 `status` 被更新为 `archived`，应走归档流程，而不是普通更新流程。

### 6.4 归档输入

归档使用专用 endpoint：

```text
POST /memories/:id/archive
```

归档规则：

- 设置 `status = archived`。
- 写入 `archived_at = now`。
- 写入 `updated_at = now`。
- 记录 `archive` event。
- 不物理删除 D1 数据。
- 不要求立即删除 Vectorize 向量。
- 搜索和项目上下文在 D1 回查后过滤 archived。

## 7. 字段校验规则

### 7.1 基础校验

| 字段 | 规则 |
| --- | --- |
| `id` | 应用生成，不接受客户端覆盖 |
| `title` | trim 后可为空输入，但入库必须非空；自动生成标题后建议限制长度 |
| `content` | trim 后必须非空 |
| `project` | 可为空；trim 后空字符串转为 `NULL` |
| `scope` | 必须属于 `long_term`、`short_term` |
| `type` | 用户可自定义；trim 后必须非空；建议规范化为小写短横线格式 |
| `status` | 必须属于 `draft`、`active`、`canonical`、`archived` |
| `tags` | 必须是字符串数组；元素 trim；去空值；建议去重 |
| `source` | 可为空；建议使用小写短字符串 |
| `metadata` | 必须是可 JSON 序列化对象 |

### 7.2 推荐长度限制

MVP 可以先在应用层约束：

| 字段 | 建议限制 |
| --- | --- |
| `title` | 1 到 160 字符 |
| `content` | 1 到 20,000 字符 |
| `project` | 1 到 120 字符 |
| `type` | 1 到 64 字符 |
| `tag` | 1 到 40 字符 |
| `tags` | 最多 20 个 |
| `source` | 1 到 40 字符 |
| `metadata_json` | 序列化后不超过 16 KB |

这些限制不是产品终局，只是 MVP 防御性边界，避免异常输入拖慢 embedding、列表和导出。

### 7.3 JSON 规则

`tags_json`：

- 入库前必须由数组序列化得到。
- 出库失败时应降级为 `[]`，并在日志中记录。

`metadata_json`：

- 入库前必须由 plain object 序列化得到。
- 出库失败时应降级为 `{}`。
- 不在 `metadata_json` 中保存 vector 本身、密钥或大文件内容。

## 8. 时间字段变化规则

| 操作 | `created_at` | `updated_at` | `archived_at` | `embedding_status` |
| --- | --- | --- | --- | --- |
| 创建 | 设置为 now | 设置为 now | `NULL` | `pending` |
| 索引成功 | 不变 | 可不变 | 不变 | `indexed` |
| 索引失败 | 不变 | 可不变 | 不变 | `failed` |
| 编辑非内容字段 | 不变 | 设置为 now | 通常不变 | 不变 |
| 编辑 `content` | 不变 | 设置为 now | 不变 | 先 `stale`，后 `indexed` 或 `failed` |
| 归档 | 不变 | 设置为 now | 设置为 now | 不变 |

时间生成规则：

- 统一由应用层生成 `new Date().toISOString()`。
- 不依赖数据库默认时间，方便单元测试和多步骤流程复用同一个时间戳。
- 所有时间按 UTC 保存，UI 再做本地显示。

## 9. 与 Vectorize 的关系

D1 与 Vectorize 的职责分离：

```text
memories.content + metadata
  -> build embeddable text
  -> Workers AI embedding
  -> Vectorize upsert(vector_id, values, metadata)
  -> memory_embeddings stores vector_id + content_hash + model
```

Embedding 输入文本建议：

```text
Title: {title}
Project: {project}
Scope: {scope}
Type: {type}
Tags: {tags.join(', ')}
Content:
{content}
```

Vectorize metadata 建议只放可过滤和可排查的轻量字段：

```ts
{
  memory_id: string;
  project?: string;
  scope: MemoryScope;
  type: MemoryType;
  status: MemoryStatus;
  chunk_index: number;
  content_hash: string;
}
```

注意：

- 搜索最终展示必须以 D1 回查为准。
- 即使 Vectorize metadata 中有 `status`，也不能只依赖它判断是否 archived，因为 D1 才是源数据。
- 归档 memory 后可以暂时保留 Vectorize 向量，搜索回查时过滤。
- 后续提供 reindex endpoint 或 CLI 时，应以 D1 的 `memories` 为输入重新生成全部 Vectorize 数据。

## 10. Repository 计划

后续建议实现 3 个 repository：

### 10.1 `memory-repository`

职责：

- `createMemory(row)`
- `listMemories(filters)`
- `getMemoryById(id)`
- `updateMemory(id, patch)`
- `archiveMemory(id, archivedAt)`
- `updateEmbeddingStatus(id, status)`

注意：

- repository 接受和返回 D1 row 或已映射的 domain object，需要项目启动时统一选择一种风格。
- 不在 repository 中调用 Workers AI 或 Vectorize。

### 10.2 `embedding-repository`

职责：

- `upsertEmbeddingRecord(row)`
- `findByMemoryId(memoryId)`
- `findByVectorIds(vectorIds)`
- `deleteByMemoryId(memoryId)`，仅用于测试或未来物理删除。
- `listByModel(model)`，供后续 re-embedding 使用。

### 10.3 `event-repository`

职责：

- `createEvent(row)`
- `listEventsByMemoryId(memoryId, limit)`
- `listRecentEvents(limit)`

注意：

- event 写入失败可以记录日志，但不应该默认破坏主流程。
- 如果未来需要强审计，再重新定义事务边界。

## 11. Service 流程计划

### 11.1 创建 memory

```text
validate input
-> normalize tags/project/metadata
-> generate id and timestamps
-> insert memories row with embedding_status = pending
-> create memory_events(create)
-> build embedding text
-> generate embedding
-> upsert Vectorize
-> insert memory_embeddings row
-> update memories.embedding_status = indexed
-> create memory_events(index)
-> return memory + embedding_status
```

失败处理：

- D1 insert 失败：请求失败，不创建 memory。
- event 写入失败：记录日志，主流程继续。
- Workers AI 失败：保留 memory，设置 `embedding_status = failed`，记录 `index_failed`。
- Vectorize 失败：保留 memory，设置 `embedding_status = failed`，记录 `index_failed`。

### 11.2 更新 memory

```text
load existing memory
-> validate patch
-> compare content_hash input
-> update memories row and updated_at
-> create memory_events(update)
-> if content changed:
     set embedding_status = stale
     regenerate embedding
     upsert Vectorize
     insert new memory_embeddings row
     set embedding_status = indexed
     create memory_events(index)
-> return updated memory
```

### 11.3 归档 memory

```text
load existing memory
-> if not found: return 404
-> if already archived: return existing archived memory
-> update status = archived, archived_at = now, updated_at = now
-> create memory_events(archive)
-> return archived memory
```

### 11.4 重新索引 memory

MVP 可以先不暴露 endpoint，但数据模型要支持：

```text
load memory from D1
-> skip archived unless explicitly requested
-> compute content_hash
-> if existing memory_embeddings has same hash and model: skip
-> generate embedding
-> upsert Vectorize
-> insert memory_embeddings row
-> update embedding_status = indexed
```

## 12. 查询与导出计划

### 12.1 列表查询

默认列表条件：

```sql
WHERE status <> 'archived'
ORDER BY updated_at DESC
LIMIT ?
```

支持过滤：

- `project`
- `scope`
- `type`
- `status`
- `include_archived`
- `limit`
- `offset` 或 cursor

`tags` 过滤：

- MVP 如果只用 JSON 字符串保存 tags，可以先在应用层做简单过滤。
- 如果 tags 过滤成为高频需求，再新增 `memory_tags` 关系表。

### 12.2 搜索回查

```text
query embedding
-> Vectorize query
-> get vector ids
-> query memory_embeddings by vector_id
-> query memories by memory_id
-> filter archived unless include_archived
-> apply project/scope/type/status/tags filters
-> rank and return
```

### 12.3 导出

`GET /export` 应导出：

- `memories`
- `memory_events`
- `memory_embeddings`

不导出：

- Vectorize 向量值。
- Secret、token、Cloudflare resource id。

导出 JSON 推荐结构：

```json
{
  "schema_version": 1,
  "exported_at": "2026-06-02T00:00:00.000Z",
  "memories": [],
  "memory_events": [],
  "memory_embeddings": []
}
```

## 13. 测试计划

### 13.1 Migration 测试

验收点：

- migration 可以创建 `memories`。
- migration 可以创建 `memory_embeddings`。
- migration 可以创建 `memory_events`。
- 非法 `scope` 被 D1 `CHECK` 拒绝。
- 空 `type` 被 D1 `CHECK` 拒绝。
- 非法 `status` 被 D1 `CHECK` 拒绝。
- 非法 `embedding_status` 被 D1 `CHECK` 拒绝。
- `status = archived` 且 `archived_at IS NULL` 被拒绝。

### 13.2 Schema 单元测试

验收点：

- `content` 必填。
- `scope` 只允许 `long_term`、`short_term`。
- `type` 允许自定义类型，但不能为空。
- `status` 只允许 `draft`、`active`、`canonical`、`archived`。
- `tags` 必须能转换为数组。
- `metadata` 必须是可序列化对象。
- 默认 `scope = long_term`。
- 默认 `type = note`。
- 默认 `status = active`。
- 默认 `tags = []`。
- 默认 `metadata = {}`。

### 13.3 Repository 测试

验收点：

- 可以 insert memory。
- 可以 list memories，默认不返回 archived。
- 可以 get memory by id。
- 可以 update memory 并刷新 `updated_at`。
- 可以 archive memory 并写入 `archived_at`。
- 可以按 `vector_id` 找到 embedding metadata。
- 可以按 `memory_id` 找到 events。

### 13.4 Service 测试

验收点：

- 创建 memory 时自动生成 `id`、`created_at`、`updated_at`。
- 创建成功后 `embedding_status` 从 `pending` 变为 `indexed`。
- Workers AI 失败时 memory 不丢失，`embedding_status = failed`。
- Vectorize 失败时 memory 不丢失，`embedding_status = failed`。
- 编辑 `content` 后 `embedding_status` 先变为 `stale`，最终变为 `indexed` 或 `failed`。
- 只编辑 tags/status/project/scope/type 时不强制重新 embedding。
- 归档 memory 时写入 `archived_at`。

## 14. 开发任务拆解

建议实现顺序：

1. 创建 `migrations/0001_create_memory_tables.sql`。
2. 创建 `src/schemas/memory.ts`，定义枚举、输入校验和 D1 row 映射。
3. 创建 `src/repositories/memory-repository.ts`。
4. 创建 `src/repositories/embedding-repository.ts`。
5. 创建 `src/repositories/event-repository.ts`。
6. 创建 `src/services/memory-service.ts`，实现 create/update/archive 主流程。
7. 创建 `src/services/embedding-service.ts`，实现 content hash、embedding text、Vectorize upsert。
8. 为 migration、schema、repository、service 写测试。
9. 在 REST API 中接入 create/list/detail/update/archive。
10. 接入 export，确保 D1 源数据和索引元数据可导出。

## 15. 验收清单

Memory 数据模型模块完成时必须满足：

- 可以通过 migration 创建所有 MVP 表。
- `memories` 表包含 MVP 所需字段。
- `memory_embeddings` 表能追踪 memory、chunk、content hash、embedding model 和 vector id。
- `memory_events` 表能记录 create、update、archive、index、index_failed、export。
- Memory 生命周期只允许 `long_term`、`short_term`。
- Memory 类型允许用户自定义，但必须是非空短字符串。
- Memory 状态只允许 `draft`、`active`、`canonical`、`archived`。
- Embedding 状态只允许 `pending`、`indexed`、`failed`、`stale`。
- 创建 memory 时自动生成 `id`、`created_at`、`updated_at`。
- 编辑 memory 时更新 `updated_at`。
- 编辑 `content` 时能标记索引为 `stale` 并触发重新索引。
- 归档 memory 时写入 `archived_at`。
- archived memory 默认不参与搜索和项目上下文。
- JSON export 可以包含 memories、events 和 embedding metadata。

## 16. 延后事项

以下内容不进入 MVP 第一版：

- 独立 `projects` 表。
- 独立 `tags` 或 `memory_tags` 表。
- Memory 版本图谱。
- `deprecated` 状态。
- `supersedes` / `superseded_by` 关系。
- 自动合并、自动覆盖 canonical。
- 物理删除和 Vectorize 强一致清理。
- 多 embedding provider。
- 长文本复杂分块策略。
- JSON import。
