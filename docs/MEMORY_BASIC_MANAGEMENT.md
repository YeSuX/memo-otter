# Memo Otter Memory 基础管理设计计划

更新时间：2026-06-02

这份文档细化 Memo Otter MVP 的 Memory 基础管理模块。它承接 `FUNCTIONAL_MODULES.md` 中的“Memory 基础管理”，并基于 `MEMORY_DATA_MODEL.md` 和 `TECHNICAL_DESIGN.md` 约定的数据表、状态枚举和 Cloudflare 技术栈，为后续 REST API、Web UI、Codex Skill、测试和索引流程提供可执行设计。

## 0. 当前项目状态与设计边界

当前仓库已经进入从文档阶段走向工程初始化的早期状态：

- 已有完整 `docs/` 产品和技术设计文档。
- 已出现 `package.json`、`pnpm-lock.yaml`、`node_modules/`，说明 Node/pnpm 项目初始化已经开始。
- `package.json` 当前已有运行时依赖：`hono`、`zod`。
- 当前尚未看到 `src/`、`migrations/`、`wrangler.jsonc` 等业务实现文件。

因此，本设计计划要服务于下一步实现，但本文件本身不做代码实现。后续实现应以以下技术边界为准：

- 服务端框架：Hono。
- 输入校验：Zod。
- 运行平台：Cloudflare Workers。
- 源数据库：D1。
- 语义索引：Vectorize。
- Embedding provider：Workers AI。
- 认证方式：单用户 `AUTH_TOKEN` bearer token。

本模块只设计 Memory 基础管理，不展开语义搜索排序、Web UI 视觉实现、部署脚本和 Codex Skill 文件细节。相关模块只在本文件中定义接口依赖和数据契约。

## 1. 模块目标

Memory 基础管理负责让用户可以创建、查看、编辑和归档记忆，并把每次关键变化记录为轻量事件。它是后续语义搜索、项目上下文召回、REST API、Skill 和 Web UI 的共同底座。

MVP 的目标不是做复杂知识库治理，而是先打通稳定的最小闭环：

```text
创建 memory
  -> D1 保存源数据
  -> 记录 create event
  -> 触发 embedding / Vectorize 索引
  -> 列表和详情可查看
  -> 编辑内容后重新索引
  -> 归档后默认不再召回
```

本模块需要保证：

- D1 中的 `memories` 是唯一业务源数据。
- Vectorize 只是可重建索引，不承担业务状态。
- 所有入口返回同一种结构化 memory 结果，便于 UI、REST API 和 Skill 复用。
- 所有写操作都记录轻量 `memory_events`，用于详情页解释、调试和导出。
- 归档是软归档，不物理删除 memory。
- 数据结构必须和 `MEMORY_DATA_MODEL.md` 中的 3 张 D1 表保持一致。

## 2. 范围

### 2.1 MVP 内

- 创建 memory。
- 查看 memory 列表。
- 查看 memory 详情。
- 编辑 memory。
- 归档 memory。
- 记录 `create`、`update`、`archive`、`index`、`index_failed` event。
- 返回 embedding/index 状态。
- 返回疑似重复或冲突提示的结构字段。
- 支持 REST API、Web UI、Codex Skill 共用同一服务层。

### 2.2 MVP 外

- 物理删除 memory。
- 批量编辑、批量归档。
- 自动合并重复 memory。
- 自动覆盖 canonical memory。
- 完整审计日志和权限审计。
- Memory 版本历史。
- 独立 project 实体。
- 独立 type 管理后台。
- 已归档 memory 的 Vectorize 向量清理任务。

## 3. 关键设计原则

### 3.1 源数据与索引分离

- `memories` 保存用户可读内容和业务状态。
- `memory_embeddings` 保存索引元数据。
- Vectorize 保存向量，可通过 D1 源数据重建。
- 创建和内容编辑后应触发索引流程。
- 索引失败不能丢失 memory 源数据。

### 3.2 写操作先保存，再索引

创建或编辑 memory 时，先让 D1 源数据成功落库，再执行 embedding 和 Vectorize 写入。

这样即使 Workers AI 或 Vectorize 失败，用户的 memory 仍然存在，并可在详情页看到 `embedding_status = failed`。

### 3.3 归档默认退出召回

归档 memory 后：

- `status = archived`。
- `archived_at` 写入当前时间。
- 列表默认不显示，除非 `include_archived = true`。
- 搜索和项目上下文默认不召回。
- D1 保留完整内容和事件。
- Vectorize 向量可以暂时保留，由搜索回查 D1 后过滤。

### 3.4 统一结构化结果

服务层输出不要只面向某一个入口。REST API、Web UI 和 Skill 都应该能理解同一组字段：

- `memory`
- `events`
- `indexing`
- `warnings`
- `pagination`

Skill 更适合读取简洁字段，但不需要另一套业务模型。

### 3.5 和 Memory 数据模型保持单向依赖

Memory 基础管理依赖 `MEMORY_DATA_MODEL.md` 已定义的数据模型，不在本模块重新定义数据库结构。实现时应遵守：

- `memories` 是业务源表。
- `memory_embeddings` 是索引元数据表。
- `memory_events` 是轻量事件表。
- API/UI 暴露 `tags` 和 `metadata`，D1 保存 `tags_json` 和 `metadata_json`。
- `scope` 只能是 `long_term` 或 `short_term`。
- `type` 是可自定义字符串，不做固定枚举。
- `status` 只能是 `draft`、`active`、`canonical`、`archived`。
- `embedding_status` 只能是 `pending`、`indexed`、`failed`、`stale`。

### 3.6 同步流程优先，异步能力预留

MVP 第一版推荐创建和内容编辑时同步完成 embedding/index，原因是：

- 更容易验证“创建后可搜索”的闭环。
- 更容易在 API 响应中返回真实索引状态。
- 更容易定位 Workers AI 或 Vectorize 失败。

如果后续同步流程影响响应速度，可以把索引放入 `ctx.waitUntil()`。但即使改为后台索引，D1 写入、事件记录、状态字段和响应结构也不应改变。

## 4. 数据结构

### 4.1 Domain 类型

API、UI 和 Skill 统一使用 camelCase 字段：

```ts
type Memory = {
  id: string;
  title: string;
  content: string;
  project: string | null;
  scope: 'long_term' | 'short_term';
  type: string;
  status: 'draft' | 'active' | 'canonical' | 'archived';
  tags: string[];
  source: string | null;
  embeddingStatus: 'pending' | 'indexed' | 'failed' | 'stale';
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
  metadata: Record<string, unknown>;
};
```

这个结构对应 `MEMORY_DATA_MODEL.md` 中的 API/UI Memory 结构。它是服务层的 domain object，不是 D1 row。

### 4.2 D1 Row 与 Domain 映射

D1 row 使用 snake_case 和 JSON 字符串字段，domain object 使用 camelCase 和已解析对象：

| D1 字段 | Domain 字段 | 转换 |
| --- | --- | --- |
| `id` | `id` | 原样 |
| `title` | `title` | 原样 |
| `content` | `content` | 原样 |
| `project` | `project` | 空字符串不入库，统一为 `null` |
| `scope` | `scope` | 枚举校验 |
| `type` | `type` | normalize 后保存 |
| `status` | `status` | 枚举校验 |
| `tags_json` | `tags` | JSON parse/stringify |
| `source` | `source` | 入口默认值 |
| `embedding_status` | `embeddingStatus` | 枚举校验 |
| `created_at` | `createdAt` | ISO 字符串 |
| `updated_at` | `updatedAt` | ISO 字符串 |
| `archived_at` | `archivedAt` | ISO 字符串或 `null` |
| `metadata_json` | `metadata` | JSON parse/stringify |

Repository 层必须集中处理这组映射，Route 层和 UI 不应接触 `tags_json`、`metadata_json`、`embedding_status` 这类 D1 字段名。

### 4.3 Memory 输出结构

列表接口不返回完整 `content`，只返回列表展示字段。

详情接口必须返回完整 `content` 和 `metadata`。

### 4.4 Memory 列表项结构

```ts
type MemoryListItem = {
  id: string;
  title: string;
  project: string | null;
  scope: 'long_term' | 'short_term';
  type: string;
  status: 'draft' | 'active' | 'canonical' | 'archived';
  tags: string[];
  source: string | null;
  embeddingStatus: 'pending' | 'indexed' | 'failed' | 'stale';
  createdAt: string;
  updatedAt: string;
};
```

### 4.5 Event 输出结构

详情页返回最近事件：

```ts
type MemoryEvent = {
  id: string;
  memoryId: string | null;
  eventType: 'create' | 'update' | 'archive' | 'index' | 'index_failed' | 'export';
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  source: string | null;
  createdAt: string;
};
```

### 4.6 Embedding / Index 状态结构

```ts
type MemoryIndexState = {
  status: 'pending' | 'indexed' | 'failed' | 'stale';
  embeddingModel: string | null;
  vectorId: string | null;
  contentHash: string | null;
  indexedAt: string | null;
  failure: {
    stage: 'embedding' | 'vectorize' | 'd1_metadata' | null;
    message: string | null;
  } | null;
};
```

`failure.message` 只保存错误摘要，不保存完整堆栈和敏感信息。

`MemoryIndexState` 的数据来源：

- `status` 来自 `memories.embedding_status`。
- `embeddingModel`、`vectorId`、`contentHash` 主要来自最新一条 `memory_embeddings`。
- `indexedAt` 可以取最新 embedding record 的 `created_at`。
- `failure` 来自最近一条 `index_failed` event 的摘要。

### 4.7 Warning 结构

创建和编辑接口需要预留疑似重复或冲突提示：

```ts
type MemoryWarning = {
  type: 'possible_duplicate' | 'possible_conflict' | 'canonical_edit' | 'index_failed';
  severity: 'info' | 'warning';
  message: string;
  relatedMemoryIds?: string[];
};
```

MVP 可以先只返回空数组或简单启发式结果，不需要实现复杂冲突检测。

### 4.8 输入类型契约

创建输入沿用数据模型文档：

```ts
type CreateMemoryInput = {
  title?: string;
  content: string;
  project?: string;
  scope?: 'long_term' | 'short_term';
  type?: string;
  status?: 'draft' | 'active' | 'canonical';
  tags?: string[];
  source?: string;
  metadata?: Record<string, unknown>;
};
```

更新输入沿用数据模型文档：

```ts
type UpdateMemoryInput = {
  title?: string;
  content?: string;
  project?: string | null;
  scope?: 'long_term' | 'short_term';
  type?: string;
  status?: 'draft' | 'active' | 'canonical' | 'archived';
  tags?: string[];
  metadata?: Record<string, unknown>;
};
```

虽然产品需求的编辑字段没有显式列出 `scope`，但数据模型允许更新 `scope`。实现时可以支持 API 更新 `scope`，Web UI 第一版可选择先不暴露。

## 5. 服务分层

建议实现路径沿用 `TECHNICAL_DESIGN.md` 的目录设计：

```text
src/
  routes/
    memories.ts
  services/
    memory-service.ts
    embedding-service.ts
    event-service.ts
  repositories/
    memory-repository.ts
    embedding-repository.ts
    event-repository.ts
  schemas/
    memory.ts
  utils/
    errors.ts
    json.ts
```

### 5.1 Route 层

职责：

- 认证。
- 读取 path、query、body。
- 调用 Zod schema 校验。
- 调用 service。
- 返回统一 JSON。

Route 层不直接写 SQL，不直接调用 Workers AI，不直接访问 Vectorize。

Hono 路由建议保持薄层：

```text
auth middleware
-> parse request
-> zod validation
-> service call
-> c.json(result, status)
```

Route 层也不负责生成 `id`、时间戳或默认值，这些属于 service/schema 的共同边界。

### 5.2 Service 层

职责：

- 执行业务流程。
- 处理默认值。
- 比较 content 是否变化。
- 决定是否重新索引。
- 写入事件。
- 汇总结构化响应。
- 调用 embedding service。
- 控制事件失败、索引失败和主流程失败之间的边界。

### 5.3 Repository 层

职责：

- 封装 D1 SQL。
- 完成 D1 row 与 API model 映射。
- 处理 `tags_json`、`metadata_json` 序列化和反序列化。
- 提供分页查询、详情查询和条件更新。

Repository 层不做业务判断，例如“不允许创建 archived memory”“content 变化需要重新索引”。这些判断属于 service 层。

### 5.4 Embedding Service

职责：

- 为 memory content 生成 embedding。
- 写入 Vectorize。
- 写入或更新 `memory_embeddings`。
- 更新 `memories.embedding_status`。
- 记录 `index` 或 `index_failed` event。

第一版可以同步执行索引，方便调试。如果接口响应明显变慢，再把索引流程移入 `ctx.waitUntil()`。

### 5.5 Schema 层

由于当前项目已引入 `zod`，后续 schema 应在 `src/schemas/memory.ts` 中集中定义：

- `createMemorySchema`
- `updateMemorySchema`
- `listMemoriesQuerySchema`
- `archiveMemorySchema`

Schema 层负责输入 shape、长度、枚举和 JSON 对象校验。更复杂的业务规则，例如“归档走专用 endpoint”，放在 service 层。

### 5.6 Env 与 bindings

实现时不应手写长期漂移的 binding 类型。建议在 `wrangler.jsonc` 完成后运行 `wrangler types` 生成 Worker 类型。

本模块需要的 bindings：

| Binding | 用途 |
| --- | --- |
| `DB` | D1，保存 memories、memory_embeddings、memory_events |
| `VECTORIZE` | Vectorize，写入和查询向量 |
| `AI` | Workers AI，生成 embedding |
| `AUTH_TOKEN` | Secret，保护私有接口 |
| `EMBEDDING_MODEL` | 可配置变量，记录当前 embedding model |

## 6. 创建 Memory

### 6.1 REST Endpoint

```text
POST /memories
```

请求体：

```json
{
  "title": "Cloudflare deployment decision",
  "content": "Memo Otter MVP will use Cloudflare Workers, D1, Vectorize, and Workers AI.",
  "project": "memo-otter",
  "scope": "long_term",
  "type": "decision",
  "status": "active",
  "tags": ["mvp", "cloudflare"],
  "source": "api",
  "metadata": {
    "from": "planning"
  }
}
```

### 6.2 输入规则

| 字段 | 规则 |
| --- | --- |
| `content` | 必填，trim 后不能为空 |
| `title` | 可选，trim 后为空则自动生成 |
| `project` | 可选，trim 后空字符串转 `null` |
| `scope` | 默认 `long_term`，只允许 `long_term`、`short_term` |
| `type` | 默认 `note`，允许自定义，规范化为小写短横线 |
| `status` | 默认 `active`，创建时建议只允许 `draft`、`active`、`canonical` |
| `tags` | 默认 `[]`，trim、去空、去重 |
| `source` | 可选，由入口补默认值，Web UI 为 `web`，Skill 为 `skill`，普通 REST 为 `api` |
| `metadata` | 默认 `{}`，必须是可 JSON 序列化对象 |

创建时不接受客户端传入：

- `id`
- `embeddingStatus`
- `createdAt`
- `updatedAt`
- `archivedAt`

标题自动生成建议：

- 从 `content` 去掉首尾空白。
- 合并连续空白。
- 取前 40 到 60 个字符。
- 超长时追加 `...`。
- 生成结果仍需满足 `title` 入库非空。

### 6.3 流程

```text
POST /memories
  -> validate input
  -> normalize fields
  -> generate id, created_at, updated_at
  -> build memory row
  -> insert memories with embedding_status = pending
  -> record create event
  -> run duplicate/conflict lightweight check
  -> generate embedding
  -> upsert Vectorize
  -> insert memory_embeddings
  -> update memories.embedding_status = indexed
  -> record index event
  -> return create result
```

推荐创建时写入的 D1 初始字段：

| 字段 | 值 |
| --- | --- |
| `id` | 应用生成，推荐 `crypto.randomUUID()` 或带前缀的 UUID |
| `title` | 用户输入或自动生成 |
| `content` | trim 后正文 |
| `project` | 字符串或 `NULL` |
| `scope` | 默认 `long_term` |
| `type` | 默认 `note` |
| `status` | 默认 `active` |
| `tags_json` | `JSON.stringify(tags)` |
| `source` | `api`、`web`、`skill` 等 |
| `embedding_status` | `pending` |
| `created_at` | now ISO |
| `updated_at` | now ISO |
| `archived_at` | `NULL` |
| `metadata_json` | `JSON.stringify(metadata)` |

### 6.4 索引失败处理

如果 Workers AI 或 Vectorize 失败：

- memory 保留在 D1。
- `embedding_status` 更新为 `failed`。
- 写入 `index_failed` event。
- 响应仍返回 memory。
- `warnings` 中增加 `index_failed`。
- HTTP 状态建议仍为 `201 Created`，因为 memory 创建成功；索引失败体现在响应字段里。

D1 插入 memory 失败时，整个请求失败，不触发索引。

事件写入失败时：

- 不建议回滚已经创建的 memory。
- 应记录结构化日志。
- 响应可以在 `warnings` 中加入轻量提示，但不暴露内部错误堆栈。

### 6.5 创建响应

```json
{
  "memory": {
    "id": "mem_01...",
    "title": "Cloudflare deployment decision",
    "project": "memo-otter",
    "scope": "long_term",
    "type": "decision",
    "status": "active",
    "tags": ["mvp", "cloudflare"],
    "source": "api",
    "embeddingStatus": "indexed",
    "createdAt": "2026-06-02T14:00:00.000Z",
    "updatedAt": "2026-06-02T14:00:00.000Z",
    "archivedAt": null,
    "metadata": {
      "from": "planning"
    }
  },
  "indexing": {
    "status": "indexed",
    "embeddingModel": "@cf/baai/bge-base-en-v1.5",
    "vectorId": "mem:mem_01...:chunk:0:hash:abc123",
    "contentHash": "abc123...",
    "indexedAt": "2026-06-02T14:00:01.000Z",
    "failure": null
  },
  "warnings": []
}
```

## 7. 查看 Memory 列表

### 7.1 REST Endpoint

```text
GET /memories
```

支持 query 参数：

| 参数 | 说明 |
| --- | --- |
| `project` | 按 project 精确过滤 |
| `scope` | 按 `long_term` 或 `short_term` 过滤 |
| `type` | 按 type 过滤 |
| `status` | 按 status 过滤 |
| `tags` | 逗号分隔标签，匹配任一或全部由实现策略决定 |
| `include_archived` | 默认 `false` |
| `limit` | 默认 20，最大 100 |
| `cursor` | 游标分页 |
| `offset` | 偏移分页，MVP 可先支持 offset |

### 7.2 默认行为

- 默认排除 `status = archived`。
- 默认按 `updated_at DESC` 排序。
- 不返回完整 `content`。
- 返回 `embeddingStatus`，方便 UI 标记 pending、failed、stale。
- `limit` 默认 20，最大 100。
- MVP 优先支持 `offset`，保留 `cursor` 字段用于未来切换游标分页。

### 7.3 Tags 过滤策略

D1 中 `tags_json` 是 TEXT，MVP 可以先采用保守实现：

- `tags=a,b` 表示 memory 至少包含其中一个 tag。
- 使用 JSON 解析后在应用层过滤，避免脆弱的字符串匹配。
- 为了避免全表扫描过大，先在 D1 里应用 project、scope、type、status、limit 扩大窗口，再应用 tags 过滤。
- 如果后续数据量变大，再增加 `memory_tags` 表。

如果实现应用层 tags 过滤，分页需要注意：

- 不能先严格取 `limit` 条再过滤，否则可能返回数量明显不足。
- MVP 可以使用 `limit * 3` 作为候选窗口，再过滤到 `limit`。
- 响应中应保守设置 `hasMore`，避免误导 UI。
- 如果 tags 成为核心过滤能力，应尽快迁移到 `memory_tags` 表。

### 7.4 列表响应

```json
{
  "items": [
    {
      "id": "mem_01...",
      "title": "Cloudflare deployment decision",
      "project": "memo-otter",
      "scope": "long_term",
      "type": "decision",
      "status": "active",
      "tags": ["mvp", "cloudflare"],
      "source": "api",
      "embeddingStatus": "indexed",
      "createdAt": "2026-06-02T14:00:00.000Z",
      "updatedAt": "2026-06-02T14:00:00.000Z"
    }
  ],
  "pagination": {
    "limit": 20,
    "offset": 0,
    "nextCursor": null,
    "hasMore": false
  }
}
```

## 8. 查看 Memory 详情

### 8.1 REST Endpoint

```text
GET /memories/:id
```

### 8.2 返回内容

详情页需要返回：

- memory 全量字段。
- 最近的 memory events，默认 20 条。
- embedding/index 状态。

详情接口默认可以返回 archived memory。因为用户通过 id 打开详情时，通常是明确查看这条记录；默认排除 archived 的规则主要适用于列表、搜索和项目上下文召回。

### 8.3 详情响应

```json
{
  "memory": {
    "id": "mem_01...",
    "title": "Cloudflare deployment decision",
    "content": "Memo Otter MVP will use Cloudflare Workers, D1, Vectorize, and Workers AI.",
    "project": "memo-otter",
    "scope": "long_term",
    "type": "decision",
    "status": "active",
    "tags": ["mvp", "cloudflare"],
    "source": "api",
    "embeddingStatus": "indexed",
    "createdAt": "2026-06-02T14:00:00.000Z",
    "updatedAt": "2026-06-02T14:00:00.000Z",
    "archivedAt": null,
    "metadata": {
      "from": "planning"
    }
  },
  "events": [
    {
      "id": "evt_01...",
      "memoryId": "mem_01...",
      "eventType": "create",
      "before": null,
      "after": {
        "title": "Cloudflare deployment decision",
        "status": "active"
      },
      "source": "api",
      "createdAt": "2026-06-02T14:00:00.000Z"
    }
  ],
  "indexing": {
    "status": "indexed",
    "embeddingModel": "@cf/baai/bge-base-en-v1.5",
    "vectorId": "mem:mem_01...:chunk:0:hash:abc123",
    "contentHash": "abc123...",
    "indexedAt": "2026-06-02T14:00:01.000Z",
    "failure": null
  }
}
```

### 8.4 Not Found 行为

如果 memory 不存在：

- 返回 `404 Not Found`。
- 错误体使用统一格式。
- 不暴露 D1 内部错误。

## 9. 编辑 Memory

### 9.1 REST Endpoint

```text
PATCH /memories/:id
```

允许编辑字段：

- `title`
- `content`
- `project`
- `scope`
- `type`
- `status`
- `tags`
- `metadata`

说明：`scope` 在原始功能点中没有列为编辑字段，但 `MEMORY_DATA_MODEL.md` 的 `UpdateMemoryInput` 已允许更新。为了减少 API 与数据模型分裂，REST API 设计支持 `scope` 更新；Web UI 第一版可以先不暴露。

### 9.2 普通编辑规则

- 先读取已有 memory。
- 校验 patch 至少包含一个可编辑字段。
- 对输入字段做 normalize。
- 比较变化字段。
- 没有实际变化时，可以返回当前 memory，并给出空事件或 `warnings`。
- 有变化时更新 D1。
- 刷新 `updated_at`。
- 记录 `update` event。

### 9.3 Content 变化规则

如果 `content` 变化：

- 新 `content` trim 后不能为空。
- 更新 D1 content。
- 设置 `embedding_status = stale`。
- 记录 `update` event，event 只记录变化摘要，不保存完整旧正文。
- 重新生成 embedding。
- upsert Vectorize。
- 写入新的 `memory_embeddings`。
- 设置 `embedding_status = indexed`。
- 记录 `index` event。

如果重新索引失败：

- memory 保留新 content。
- `embedding_status = failed`。
- 记录 `index_failed` event。
- 返回 `warnings`。

推荐顺序是先把新 content 和 `embedding_status = stale` 写入 D1，再执行索引。这样即使索引失败，详情页也能看到最新正文和失败状态。

### 9.4 仅元数据变化规则

如果只更新以下字段，不重新生成 embedding：

- `title`
- `project`
- `scope`
- `type`
- `status`
- `tags`
- `metadata`

原因：

- embedding 基于正文内容。
- tags、type、project、status 属于过滤和展示元数据。
- 避免无意义索引写入。

### 9.5 Status 编辑规则

- 普通 `PATCH` 可以在 `draft`、`active`、`canonical` 之间切换。
- 将 `status` 设为 `archived` 时，应走归档流程，而不是普通更新流程。
- REST API 可以选择对 `PATCH status=archived` 返回 `409 invalid_state_transition`，提示调用 `POST /memories/:id/archive`。
- 从 `archived` 恢复为 `active` 或 `draft` 可作为 MVP+；MVP 不设计恢复入口。

### 9.6 Canonical 编辑提示

如果编辑 `status = canonical` 的 memory：

- 不禁止编辑。
- 响应 `warnings` 增加 `canonical_edit`。
- UI 可以在提交前提示用户该记忆会影响高可信上下文。

### 9.7 Update Event 内容

`update` event 建议只保存变化字段摘要：

```json
{
  "before": {
    "tags": ["mvp"],
    "contentHash": "oldhash",
    "embeddingStatus": "indexed"
  },
  "after": {
    "tags": ["mvp", "cloudflare"],
    "contentHash": "newhash",
    "embeddingStatus": "stale"
  }
}
```

正文内容不要完整写入 event，避免事件表膨胀。详情页需要正文时直接读 `memories.content`。

### 9.8 编辑响应

```json
{
  "memory": {
    "id": "mem_01...",
    "title": "Cloudflare-first MVP decision",
    "content": "Memo Otter MVP will use Cloudflare Workers, D1, Vectorize, and Workers AI.",
    "project": "memo-otter",
    "scope": "long_term",
    "type": "decision",
    "status": "active",
    "tags": ["mvp", "cloudflare"],
    "source": "api",
    "embeddingStatus": "indexed",
    "createdAt": "2026-06-02T14:00:00.000Z",
    "updatedAt": "2026-06-02T14:10:00.000Z",
    "archivedAt": null,
    "metadata": {
      "from": "planning"
    }
  },
  "indexing": {
    "status": "indexed",
    "embeddingModel": "@cf/baai/bge-base-en-v1.5",
    "vectorId": "mem:mem_01...:chunk:0:hash:def456",
    "contentHash": "def456...",
    "indexedAt": "2026-06-02T14:10:01.000Z",
    "failure": null
  },
  "warnings": []
}
```

## 10. 归档 Memory

### 10.1 REST Endpoint

```text
POST /memories/:id/archive
```

请求体可选：

```json
{
  "source": "web",
  "reason": "No longer relevant to MVP"
}
```

`reason` 不需要写入 `memories`，可以进入 `archive` event 的 `after`。

### 10.2 处理规则

- 读取 memory。
- 如果不存在，返回 `404`。
- 如果已经是 `archived`，返回当前 archived memory，避免重复写事件；也可以返回 `409`，但 MVP 推荐幂等成功。
- 设置 `status = archived`。
- 写入 `archived_at = now`。
- 写入 `updated_at = now`。
- 记录 `archive` event。
- 不删除 D1 数据。
- 不要求删除 Vectorize 向量。
- 不改变 `embedding_status`。
- 搜索和项目上下文必须在 D1 回查后排除 archived。

### 10.3 Archive Event 内容

```json
{
  "before": {
    "status": "active",
    "archivedAt": null
  },
  "after": {
    "status": "archived",
    "archivedAt": "2026-06-02T14:20:00.000Z",
    "reason": "No longer relevant to MVP"
  }
}
```

### 10.4 归档响应

```json
{
  "memory": {
    "id": "mem_01...",
    "title": "Cloudflare-first MVP decision",
    "project": "memo-otter",
    "scope": "long_term",
    "type": "decision",
    "status": "archived",
    "tags": ["mvp", "cloudflare"],
    "source": "api",
    "embeddingStatus": "indexed",
    "createdAt": "2026-06-02T14:00:00.000Z",
    "updatedAt": "2026-06-02T14:20:00.000Z",
    "archivedAt": "2026-06-02T14:20:00.000Z",
    "metadata": {
      "from": "planning"
    }
  },
  "warnings": []
}
```

## 11. 轻量重复和冲突提示

创建成功后要求返回“疑似重复或冲突提示”。MVP 不做复杂自动判断，但需要保留接口结构。

### 11.1 第一版启发式

可以按低成本规则实现：

- 同一 project 内非 archived memory 的 title 完全相同：`possible_duplicate`。
- 同一 project、同一 type、tags 高度重合：`possible_duplicate`。
- 编辑 canonical memory：`canonical_edit`。
- 索引失败：`index_failed`。

### 11.2 后续增强

在语义搜索模块完成后，可以增强为：

- 创建前或创建后用新 memory content 搜索 top 5。
- 相似度超过阈值时提示疑似重复。
- 与 canonical memory 高相似但内容明显不同则提示可能冲突。

MVP 中只提示，不自动合并、不自动拒绝、不自动覆盖。

## 12. REST API 汇总

| 方法 | 路径 | 用途 | 默认返回 |
| --- | --- | --- | --- |
| `POST` | `/memories` | 创建 memory | memory、indexing、warnings |
| `GET` | `/memories` | 查看列表 | items、pagination |
| `GET` | `/memories/:id` | 查看详情 | memory、events、indexing |
| `PATCH` | `/memories/:id` | 编辑 memory | memory、indexing、warnings |
| `POST` | `/memories/:id/archive` | 归档 memory | memory、warnings |

所有接口都需要 `Authorization: Bearer <AUTH_TOKEN>`，除非后续明确开放健康检查或静态资源。

### 12.1 Hono 路由组织

建议在 Hono 中把 Memory route 统一挂载到：

```text
app.route('/memories', memoriesRoutes)
```

`memoriesRoutes` 内部负责：

- `GET /`
- `POST /`
- `GET /:id`
- `PATCH /:id`
- `POST /:id/archive`

这样可以让认证 middleware 在 `/memories` 子路由统一生效，也方便后续把 `/search`、`/context`、`/export` 分模块管理。

## 13. 错误响应

统一错误格式：

```json
{
  "error": {
    "code": "invalid_request",
    "message": "content is required",
    "details": {
      "field": "content"
    }
  }
}
```

推荐错误码：

| HTTP | code | 场景 |
| --- | --- | --- |
| `400` | `invalid_request` | body 或 query 格式错误 |
| `401` | `unauthorized` | 缺少或错误 token |
| `404` | `memory_not_found` | memory 不存在 |
| `409` | `invalid_state_transition` | 非法状态转换 |
| `413` | `content_too_large` | content 或 metadata 超长 |
| `500` | `internal_error` | D1 或服务内部错误 |

索引失败不建议直接返回 `500`，因为 memory 写入成功。它应通过 `embeddingStatus`、`indexing.failure` 和 `warnings` 表达。

### 13.1 Zod 校验错误映射

Zod validation error 应统一映射为：

- HTTP `400`
- `code = invalid_request`
- `details.fields` 列出字段级错误

不要把 Zod 原始错误对象完整透出给客户端，避免响应格式不稳定。

### 13.2 事件失败和索引失败的错误边界

| 失败点 | HTTP 行为 | 数据状态 |
| --- | --- | --- |
| 创建 memory D1 insert 失败 | `500` 或更具体错误 | 不创建 memory |
| create event 写入失败 | 创建继续 | memory 保留，日志记录 |
| Workers AI embedding 失败 | 创建或编辑请求仍可成功 | `embedding_status = failed` |
| Vectorize upsert 失败 | 创建或编辑请求仍可成功 | `embedding_status = failed` |
| embedding metadata 写入失败 | 请求返回 warning 或内部错误，按实现取舍 | 需要避免显示为 indexed |
| archive event 写入失败 | 归档继续 | memory archived，日志记录 |

## 14. Web UI 需求映射

### 14.1 列表页

列表页需要：

- 搜索入口可以后续接入 `/search`。
- project、scope、type、status、tags 筛选。
- include archived 开关。
- memory 列表展示 title、project、type、status、tags、source、created_at、updated_at。
- 对 `pending`、`failed`、`stale` 索引状态给出轻量标记。

### 14.2 详情页

详情页需要：

- 展示全量字段。
- 展示 content。
- 展示最近 events。
- 展示 embedding/index 状态。
- 提供编辑入口。
- 提供归档按钮。

### 14.3 创建 / 编辑表单

表单需要：

- content 必填。
- title 可选。
- scope 默认 `long_term`。
- type 默认 `note`，允许输入自定义类型。
- status 默认 `active`。
- tags 支持多标签输入。
- metadata 可以先用 JSON textarea 或高级折叠区。

## 15. Skill 使用映射

Codex Skill 不需要独立业务逻辑，只需要明确何时调用 REST API。

建议 Skill 将能力命名为：

- `save_memory` -> `POST /memories`
- `list_memories` -> `GET /memories`
- `get_memory` -> `GET /memories/:id`
- `update_memory` -> `PATCH /memories/:id`
- `archive_memory` -> `POST /memories/:id/archive`

Skill 入口调用写操作时应遵守：

- 只有用户明确要求保存时才创建 memory。
- 只有用户明确要求修改时才编辑 memory。
- 归档属于高影响操作，需要明确用户意图。
- 写入后把 memory id 和索引状态反馈给用户。

## 16. 测试计划

### 16.1 单元测试

- content 为空时创建失败。
- title 为空时自动生成标题。
- scope 默认 `long_term`。
- type 默认 `note`，自定义 type 可通过。
- status 默认 `active`。
- tags 默认 `[]`，并去空、去重。
- metadata 必须可 JSON 序列化。
- content hash 在同一正文下稳定。
- content 变化能被检测到。
- type 能完成 trim、小写化、空格转短横线。
- project 空字符串会被归一化为 `null`。

### 16.2 Repository 测试

- 可以 insert memory。
- 可以按 id 查询 memory。
- 可以查询列表并默认排除 archived。
- `include_archived = true` 时包含 archived。
- 可以按 project、scope、type、status 过滤。
- tags_json 能正确序列化和反序列化。
- metadata_json 能正确序列化和反序列化。
- archive 更新 status、archived_at、updated_at。
- D1 row 能正确映射为 domain object。
- 损坏的 `tags_json` 能安全降级为 `[]`。
- 损坏的 `metadata_json` 能安全降级为 `{}`。

### 16.3 Service 测试

- 创建 memory 会记录 create event。
- 创建 memory 会触发 embedding/index。
- 索引成功后 `embedding_status = indexed`。
- 索引失败后 `embedding_status = failed`，memory 仍存在。
- 编辑 tags 不触发重新索引。
- 编辑 content 设置 stale 并触发重新索引。
- 编辑成功记录 update event。
- 归档记录 archive event。
- 已归档 memory 默认不出现在列表。
- event 写入失败不破坏主流程。
- 创建时索引失败不会丢失 memory。
- 编辑 content 后索引失败时保留新 content。

### 16.4 REST API 测试

- `POST /memories` 可以创建 memory。
- `GET /memories` 可以看到刚创建的 memory。
- `GET /memories/:id` 返回完整 content、events、indexing。
- `PATCH /memories/:id` 可以编辑 content 和 tags。
- 内容编辑后返回新的 indexing 状态。
- `POST /memories/:id/archive` 可以归档。
- 归档后默认列表不显示。
- `GET /memories?include_archived=true` 可以看到归档 memory。
- 未认证请求被拒绝。

### 16.5 端到端验收

验收步骤：

1. 通过 Web UI 创建一条 memory。
2. 在列表中看到该 memory。
3. 打开详情看到完整 content、events 和索引状态。
4. 修改 content 和 tags。
5. 确认 content 修改后触发重新索引。
6. 归档 memory。
7. 确认默认列表和搜索不显示 archived memory。
8. 显式 include archived 后可以再次看到该 memory。

## 17. 实施顺序

建议按以下顺序实现：

1. 补齐工程骨架：`src/`、`migrations/`、`wrangler.jsonc`、`tsconfig.json` 和 scripts。
2. 根据 `MEMORY_DATA_MODEL.md` 创建 `migrations/0001_create_memory_tables.sql`。
3. 生成或更新 Worker bindings 类型。
4. 实现 `schemas/memory.ts`，完成 create、update、list query、archive body 校验和 normalize。
5. 实现 D1 row/domain 映射工具，集中处理 `tags_json` 和 `metadata_json`。
6. 实现 `memory-repository.ts`，完成 D1 CRUD 和列表过滤。
7. 实现 `event-repository.ts` 和 `event-service.ts`。
8. 实现 `embedding-repository.ts` 的索引元数据写入和读取。
9. 实现 `embedding-service.ts` 的同步索引流程和失败处理。
10. 实现 `memory-service.ts` 的 create、list、get、update、archive。
11. 实现 `routes/memories.ts` 并挂载到 Hono app。
12. 写单元测试和 repository 测试。
13. 写 REST API 测试。
14. 接入 Web UI 表单、列表、详情和归档按钮。
15. 在 Codex Skill 中补充基础管理调用说明。
16. 完成真实 Cloudflare 资源冒烟测试。

## 18. 已实现 TODO 状态

更新时间：2026-06-03

本节记录 Memory 基础管理从设计到实现的任务完成状态。已完成项使用 `[x]`，受外部网络或 Cloudflare 服务状态限制而未完全验收的项目保留 `[ ]` 并附说明。

### 18.1 工程骨架

- [x] 初始化 pnpm 项目依赖。
- [x] 安装运行时依赖：`hono`、`zod`。
- [x] 安装开发依赖：`wrangler`、`typescript`、`vitest`、`@types/node`。
- [x] 创建 `src/`。
- [x] 创建 `src/index.ts`。
- [x] 创建 `src/app.ts`。
- [x] 创建 `src/routes/`。
- [x] 创建 `src/services/`。
- [x] 创建 `src/repositories/`。
- [x] 创建 `src/schemas/`。
- [x] 创建 `src/utils/`。
- [x] 创建 `src/skill/`。
- [x] 创建 `test/`。
- [x] 创建 `migrations/`。
- [x] 创建 `tsconfig.json`。
- [x] 创建 `vitest.config.ts`。
- [x] 创建 `wrangler.jsonc`。
- [x] 创建 `pnpm-workspace.yaml`，批准 `esbuild`、`sharp`、`workerd` 构建脚本。
- [x] 在 `package.json` 中添加 `dev`、`deploy`、`typecheck`、`test`、`db:migrate:local`、`db:migrate:remote` scripts。
- [x] 实现最小 Hono app。
- [x] 实现 `/health`。
- [x] 本地 dev server 启动成功。
- [x] 本地 `/health` 返回 200。

### 18.2 Cloudflare 资源与配置

- [x] 配置 Worker name：`memo-otter`。
- [x] 配置 `main = src/index.ts`。
- [x] 设置 `compatibility_date = 2026-06-02`。
- [x] 启用 `nodejs_compat`。
- [x] 启用 observability。
- [x] 创建远端 D1 database：`memo-otter-db`。
- [x] 写入 D1 database id：`e6933944-d6bc-451a-bc37-e4f191cf3f7a`。
- [x] 配置 D1 binding：`DB`。
- [x] 创建远端 Vectorize index：`memo-otter-memory`。
- [x] 确认 Vectorize dimensions：768。
- [x] 确认 Vectorize metric：cosine。
- [x] 配置 Vectorize binding：`VECTORIZE`。
- [x] 设置 Vectorize local dev `remote: true`。
- [x] 配置 Workers AI binding：`AI`。
- [x] 设置 Workers AI local dev `remote: true`。
- [x] 配置 `EMBEDDING_MODEL = @cf/baai/bge-base-en-v1.5`。
- [x] 创建 `.dev.vars.example`。
- [x] 创建本地 `.dev.vars`，并通过 `.gitignore` 排除。
- [x] 生成随机远端 `AUTH_TOKEN` secret。
- [x] 运行 `wrangler types` 生成 `worker-configuration.d.ts`。
- [x] 移除旧的 `@cloudflare/workers-types`，使用 Wrangler 生成的 runtime types。
- [x] 确认代码不手写长期维护的 Env binding 类型，只补充 `RuntimeEnv` 承载 secret。

### 18.3 D1 Migration

- [x] 创建 `migrations/0001_create_memory_tables.sql`。
- [x] 创建 `memories` 表。
- [x] 创建 `memory_embeddings` 表。
- [x] 创建 `memory_events` 表。
- [x] 添加 `content` 非空约束。
- [x] 添加 `scope` 枚举约束。
- [x] 添加 `type` 非空约束。
- [x] 添加 `status` 枚举约束。
- [x] 添加 `embedding_status` 枚举约束。
- [x] 添加 `archived_at` 归档约束。
- [x] 创建 `memories` 推荐索引。
- [x] 创建 `memory_embeddings` 唯一约束和索引。
- [x] 创建 `memory_events` 事件类型约束和索引。
- [x] 本地 migration 应用成功。
- [x] 远端 migration 应用成功。
- [x] 本地 D1 验证三张表存在。

### 18.4 类型、工具与 Schema

- [x] 定义 `MemoryScope`。
- [x] 定义 `MemoryStatus`。
- [x] 定义 `EmbeddingStatus`。
- [x] 定义 `Memory`。
- [x] 定义 `MemoryListItem`。
- [x] 定义 `MemoryEvent`。
- [x] 定义 `MemoryIndexState`。
- [x] 定义 `MemoryWarning`。
- [x] 定义 D1 row 类型：`MemoryRow`。
- [x] 定义 D1 row 类型：`MemoryEmbeddingRow`。
- [x] 定义 D1 row 类型：`MemoryEventRow`。
- [x] 实现 `nowIso()`。
- [x] 实现 memory/event/embedding id 生成。
- [x] 实现 `normalizeProject()`。
- [x] 实现 `normalizeType()`。
- [x] 实现 `normalizeTags()`。
- [x] 实现 `normalizeSource()`。
- [x] 实现 `generateTitleFromContent()`。
- [x] 实现 JSON 安全解析和序列化。
- [x] 实现 `contentHash()`。
- [x] 实现 `buildVectorId()`。
- [x] 实现 `buildEmbeddableMemoryText()`。
- [x] 实现 D1 row 到 domain object 映射。
- [x] 实现 domain object 到列表项映射。
- [x] 创建 `src/schemas/memory.ts`。
- [x] 定义 create/update/list/archive Zod schemas。
- [x] 实现 Zod error 到统一错误响应映射。

### 18.5 Repository 层

- [x] 创建 `memory-repository.ts`。
- [x] 实现 `createMemory()`。
- [x] 实现 `getMemoryById()`。
- [x] 实现 `listMemories()`。
- [x] 实现 project/scope/type/status 过滤。
- [x] 实现默认排除 archived。
- [x] 实现 `include_archived = true`。
- [x] 实现 `limit` 和 `offset`。
- [x] 实现按 `updated_at DESC` 排序。
- [x] 实现应用层 tags 过滤。
- [x] 实现 `updateMemory()`。
- [x] 实现 `updateEmbeddingStatus()`。
- [x] 实现 `archiveMemory()`。
- [x] 实现重复 title 检查。
- [x] 创建 `embedding-repository.ts`。
- [x] 实现 embedding record 创建与查询。
- [x] 创建 `event-repository.ts`。
- [x] 实现 event 创建与查询。
- [x] 确保 repository 不调用 Workers AI。
- [x] 确保 repository 不调用 Vectorize。

### 18.6 Service 层

- [x] 创建 `event-service.ts`。
- [x] 实现 create/update/archive/index/index_failed event 记录。
- [x] event 写入失败时记录日志，不破坏主流程。
- [x] 创建 `embedding-service.ts`。
- [x] 实现 `indexMemory()`。
- [x] 实现 Workers AI embedding 调用。
- [x] 实现 Vectorize upsert。
- [x] 实现 `memory_embeddings` 写入。
- [x] 索引成功后设置 `embedding_status = indexed`。
- [x] 索引失败后设置 `embedding_status = failed`。
- [x] 索引失败后记录 `index_failed` event。
- [x] 清理错误消息中的控制字符，避免破坏 JSON 响应。
- [x] 创建 `memory-service.ts`。
- [x] 实现 `createMemory()`。
- [x] 实现 `listMemories()`。
- [x] 实现 `getMemory()`。
- [x] 实现 `updateMemory()`。
- [x] 实现 `archiveMemory()`。
- [x] 创建时填充默认值。
- [x] 创建时自动生成标题。
- [x] 创建后触发索引。
- [x] 更新 content 后触发重新索引。
- [x] 仅 metadata/tags 更新不触发重新索引。
- [x] canonical 编辑返回 warning。
- [x] `PATCH status=archived` 要求走归档 endpoint。
- [x] 归档不删除 D1 数据。
- [x] 归档不删除 Vectorize 向量。

### 18.7 REST API 与认证

- [x] 创建 `routes/memories.ts`。
- [x] 实现 `POST /memories`。
- [x] 实现 `GET /memories`。
- [x] 实现 `GET /memories/:id`。
- [x] 实现 `PATCH /memories/:id`。
- [x] 实现 `POST /memories/:id/archive`。
- [x] 挂载 `app.route('/memories', memoriesRoutes)`。
- [x] 创建 `routes/health.ts`。
- [x] 创建 `routes/search.ts`，提供最小搜索占位能力并默认排除 archived。
- [x] 创建 `routes/context.ts`。
- [x] 创建 `routes/export.ts`。
- [x] 创建 `utils/auth.ts`。
- [x] 实现 Bearer token 认证。
- [x] 使用摘要后的常量时间 token 比较。
- [x] 创建 `utils/errors.ts`。
- [x] 实现统一错误响应。
- [x] 添加全局 `app.onError`，覆盖 middleware 错误。
- [x] 确保 route 层不直接写业务 SQL。
- [x] 确保 route 层不直接调用 Workers AI。
- [x] 确保 route 层不直接访问 Vectorize。

### 18.8 测试与验证

- [x] 创建 fake D1、fake AI、fake Vectorize 测试绑定。
- [x] 编写工具函数测试。
- [x] 编写 MemoryService 主链路测试。
- [x] 编写 Memory API 主链路测试。
- [x] 测试未认证请求返回 401。
- [x] 测试创建、列表、详情、编辑、归档。
- [x] 测试索引失败后 memory 仍保留。
- [x] 测试 tags 编辑不重新索引。
- [x] 测试 archived 默认不出现在列表。
- [x] `pnpm typecheck` 通过。
- [x] `pnpm test -- --run` 通过。
- [x] `pnpm wrangler deploy --dry-run` 通过。
- [x] `pnpm wrangler deploy` 成功。
- [x] 本地 HTTP `/health` 冒烟通过。
- [x] 本地 HTTP 创建、列表、详情、编辑、归档主链路完成。
- [x] 本地 HTTP `include_archived=true` 可看到归档 memory。
- [x] 本地 HTTP search 默认不返回 archived memory。
- [x] 内容编辑后触发重新索引流程。
- [x] Workers AI internal error 时，索引状态按设计降级为 `failed`。
- [ ] 远端 workers.dev HTTP 冒烟：Worker 已部署且 `wrangler deployments list` 可看到最新版本，但本机 `curl` 到 `https://memo-otter.suxiong1998.workers.dev/health` 超时，需要后续复测网络可达性。
- [ ] 远端环境重复创建、详情、编辑、归档主链路：依赖上一项远端 HTTP 可达性。

### 18.9 Web UI、Skill 与文档

- [x] 确认列表页需要字段由 `GET /memories` 返回。
- [x] 确认详情页需要字段由 `GET /memories/:id` 返回。
- [x] 确认创建表单字段由 `POST /memories` 支持。
- [x] 确认编辑表单字段由 `PATCH /memories/:id` 支持。
- [x] 确认归档按钮可调用 `POST /memories/:id/archive`。
- [x] API 返回 `pending`、`indexed`、`failed`、`stale` 索引状态。
- [x] API 返回 warnings。
- [x] API 返回最近 events。
- [x] 创建 `src/skill/memo-otter-skill.md`。
- [x] 定义 `save_memory`。
- [x] 定义 `list_memories`。
- [x] 定义 `get_memory`。
- [x] 定义 `update_memory`。
- [x] 定义 `archive_memory`。
- [x] 新增 `README.md`。
- [x] README 记录本地运行命令。
- [x] README 记录 migration 命令。
- [x] README 记录 D1、Vectorize、AI binding 配置。
- [x] README 记录 `AUTH_TOKEN` 配置。
- [x] README 记录已知限制和 MVP+ 候选方向。
- [x] 更新 `TECHNICAL_DESIGN.md` 实现状态。
- [x] 更新 `TEST_PLAN.md` 验证状态。
- [x] 更新 `FUNCTIONAL_MODULES.md` Memory 基础管理实现状态。

## 19. 验收标准

本模块完成时必须满足：

- 可以创建一条 memory，并在列表中看到。
- 创建时 content 必填，默认值按规则生效。
- 创建后返回 memory 基础信息、embedding/index 状态和 warnings。
- 可以打开详情看到完整字段、最近 events 和 embedding/index 状态。
- 可以编辑 content、tags 和其他允许字段。
- 内容编辑后会触发重新索引。
- 仅元数据编辑不会触发重新索引。
- 编辑成功后记录 `update` event。
- 可以归档 memory。
- 归档后写入 `archived_at` 并记录 `archive` event。
- 归档后的 memory 默认列表和搜索不显示。
- 显式 `include_archived = true` 后列表可以显示 archived memory。
- 所有接口返回结构适合 UI、REST API 和 Skill 使用。

## 20. 主要风险与取舍

### 20.1 同步索引可能让创建变慢

MVP 优先同步索引，便于调试和验收。如果响应延迟影响体验，再改为：

- D1 创建后立即返回 `embedding_status = pending`。
- 用 `ctx.waitUntil()` 后台索引。
- UI 轮询详情或列表状态。

### 20.2 Tags 过滤不适合长期全表扫描

MVP 用 JSON 字段可以减少表结构复杂度。数据增长后应考虑：

- 增加 `memory_tags` 表。
- 给 tag 建索引。
- 列表查询先按结构化字段缩小范围。

### 20.3 重复和冲突提示第一版不够智能

MVP 先提供 warning 结构和低成本启发式。语义搜索完成后，再用向量相似度增强重复和冲突提示。

### 20.4 Archived 向量暂不删除

不删除 Vectorize 向量可以降低归档流程复杂度。搜索时必须回查 D1 并过滤 archived，避免已归档内容被默认召回。
