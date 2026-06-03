# Memo Otter 项目深度审阅报告

审阅日期：2026-06-03  
审阅范围：产品文档、架构文档、Cloudflare 配置、D1 migration、TypeScript 源码、OpenAPI 文档、Codex Skill、测试代码。

## 1. 一句话结论

Memo Otter 是一个部署在 Cloudflare Workers 上的个人 AI 记忆服务。它用 D1 保存可读源数据，用 Workers AI 生成 memory embedding，用 Vectorize 保存可重建语义索引，并通过 REST API 和 Codex Skill 让 AI 编程工作流保存、查询和获取项目上下文。

当前工程已经完成 Memory 基础管理、同步索引写入、失败降级、OpenAPI 文档、导出接口、项目上下文接口和测试骨架。主要未完成点是：真正的语义搜索查询尚未接入 Vectorize，Web UI 仍是占位首页，Skill 还只是使用说明而不是已安装/可自动调用的完整入口。

## 2. 项目定位与产品目标

根据 `docs/product/PRD.md`、`docs/product/MVP_SCOPE.md` 和 `docs/process/DOCUMENTATION_ALIGNMENT.md`，Memo Otter 的目标用户是经常使用 Codex、Cursor、Claude、ChatGPT 等 AI 工具的独立开发者。

它要解决的问题是：AI 工具之间、会话之间、日期之间无法自然共享长期上下文。用户经常需要重复解释项目背景、技术栈、个人偏好、架构决策和当前约束。

产品愿景不是做企业知识库或商业 SaaS，而是做一个由用户自己部署和拥有的个人 AI 记忆层。核心闭环是：

```text
保存记忆 -> 生成 embedding -> 写入 D1 和 Vectorize -> 搜索召回
-> 通过 REST API / Codex Skill 给 AI 工作流使用 -> 在 Web UI 中检查和修正
```

MVP 明确进入范围的能力包括：

- 创建、列表、详情、编辑、归档 memory。
- D1 源数据保存。
- Workers AI embedding。
- Vectorize 索引写入。
- REST API。
- `GET /context/:project` 项目上下文。
- JSON export。
- Codex Skill 使用说明。
- 单用户 bearer token 认证。

MVP 明确不进入范围的能力包括 MCP endpoint、Hooks 自动捕捉、多用户协作、自动合并、自动覆盖 canonical memory、浏览器扩展、Obsidian 插件、移动端 App、复杂知识图谱和 JSON import。

## 3. 技术栈与运行方式

项目是一个 Cloudflare Workers TypeScript 服务。

运行时与框架：

- Cloudflare Workers。
- Hono 作为 HTTP 框架。
- Zod 作为输入校验。
- Wrangler 作为本地开发、部署和 D1 migration 工具。
- Vitest 作为测试框架。

Cloudflare bindings：

- `DB`：D1 数据库，源数据存储。
- `VECTORIZE`：Vectorize index，保存 memory vectors。
- `AI`：Workers AI binding，用于 embedding。
- `AUTH_TOKEN`：私有 API bearer token。
- `EMBEDDING_MODEL`：embedding 模型名，默认 `@cf/baai/bge-base-en-v1.5`。

`wrangler.jsonc` 当前配置：

- Worker name：`memo-otter`。
- 入口：`src/index.ts`。
- compatibility date：`2026-06-02`。
- compatibility flags：`nodejs_compat`。
- observability enabled。
- D1 database：`memo-otter-db`。
- Vectorize index：`memo-otter-memory`。
- AI 和 Vectorize 都配置为 remote。

本地命令：

```bash
pnpm dev
pnpm test
pnpm typecheck
pnpm db:migrate:local
pnpm db:migrate:remote
pnpm deploy
```

## 4. 代码结构理解

项目代码分层比较清晰：

```text
src/
  app.ts
  index.ts
  openapi.ts
  routes/
  services/
  repositories/
  schemas/
  skill/
  utils/
  types.ts
```

各层职责如下。

### 4.1 入口层

`src/index.ts` 只导出 `createApp()` 生成的 Hono app。

`src/app.ts` 负责组装路由：

- `/health`
- `/docs`
- `/openapi.json`
- `/memories`
- `/search`
- `/context/:project`
- `/export`
- `/`

根路径 `/` 返回一个极简 HTML 页面，只提示 API 正在运行和 `/docs` 入口。真正的 Web UI 尚未实现。

### 4.2 Route 层

Route 层负责认证、读取请求、Zod 校验、调用 service 或 repository，并返回 JSON。

主要路由：

- `src/routes/memories.ts`
  - `POST /memories`
  - `GET /memories`
  - `GET /memories/:id`
  - `PATCH /memories/:id`
  - `POST /memories/:id/archive`
- `src/routes/search.ts`
  - `POST /search`
- `src/routes/context.ts`
  - `GET /context/:project`
- `src/routes/export.ts`
  - `GET /export`
- `src/routes/health.ts`
  - `GET /health`
- `src/routes/docs.ts`
  - `GET /docs`
  - `GET /openapi.json`

除 `/health`、`/docs`、`/openapi.json` 和 `/` 外，私有 API 都使用 `authMiddleware`。

### 4.3 Service 层

`MemoryService` 是主业务服务，负责 memory 生命周期。

它内部组合：

- `MemoryRepository`
- `EmbeddingRepository`
- `EventRepository`
- `EventService`
- `EmbeddingService`

核心方法：

- `createMemory`
- `listMemories`
- `getMemory`
- `updateMemory`
- `archiveMemory`

`EmbeddingService` 负责：

- 构建 embeddable text。
- 调 Workers AI 生成 embedding。
- 写入 Vectorize。
- 写入 `memory_embeddings`。
- 更新 `memories.embedding_status`。
- 记录 `index` 或 `index_failed` event。
- 返回 `MemoryIndexState`。

`EventService` 负责轻量事件记录。它的设计比较有意识：事件写入失败不会回滚主业务流程，只会写日志。

### 4.4 Repository 层

Repository 层封装 D1 SQL。

`MemoryRepository` 支持：

- 插入 memory。
- 按 id 查询。
- 列表查询。
- 查重标题。
- 动态 patch 更新。
- 更新 embedding status。
- 软归档。

`EmbeddingRepository` 支持：

- 插入 embedding metadata。
- 查询 memory 最新 embedding。
- 按 memory id 查询所有 embedding。
- 按 vector ids 查询 embedding rows。

`EventRepository` 支持：

- 插入 event。
- 查询某条 memory 最近 events。
- 查询最近一次 `index_failed` event。

### 4.5 Schema 与工具函数

`src/schemas/memory.ts` 用 Zod 定义 create、update、list、archive 输入。

关键规则：

- `content` 必填，最长 20,000 字符。
- `title` 最长 160。
- `project` 最长 120，空字符串规范化为 `null`。
- `scope` 只能是 `long_term` 或 `short_term`。
- create 时 `status` 只能是 `draft`、`active`、`canonical`，不能直接创建 archived。
- update schema 允许 `archived`，但 service 会拒绝通过 PATCH 归档，要求使用 archive endpoint。
- `tags` 最多 20 个，每个最长 40。
- `metadata` JSON 序列化后不能超过 16KB。

`src/utils/memory.ts` 负责：

- id 生成。
- 时间生成。
- project/type/tags/source 规范化。
- 从 content 自动生成 title。
- 安全解析 JSON。
- content hash。
- vector id 构造。
- D1 row 和 domain object 互转。

## 5. 数据模型理解

Migration 文件 `migrations/0001_create_memory_tables.sql` 创建 3 张表。

### 5.1 `memories`

这是唯一业务源数据表。

核心字段：

- `id`
- `title`
- `content`
- `project`
- `scope`
- `type`
- `status`
- `tags_json`
- `source`
- `embedding_status`
- `created_at`
- `updated_at`
- `archived_at`
- `metadata_json`

重要约束：

- `content` trim 后必须非空。
- `scope` 只能是 `long_term`、`short_term`。
- `status` 只能是 `draft`、`active`、`canonical`、`archived`。
- `embedding_status` 只能是 `pending`、`indexed`、`failed`、`stale`。
- `status = archived` 时 `archived_at` 必须非空。

### 5.2 `memory_embeddings`

这是 D1 memory 和 Vectorize vector 之间的索引元数据表。

字段：

- `id`
- `memory_id`
- `chunk_index`
- `content_hash`
- `embedding_model`
- `vector_id`
- `created_at`

当前 MVP 每条 memory 只建一个 chunk，`chunk_index = 0`。

### 5.3 `memory_events`

这是轻量事件表，用于解释变化和辅助调试。

事件类型：

- `create`
- `update`
- `archive`
- `index`
- `index_failed`
- `export`

当前实现会写 create、update、archive、index、index_failed。`export` 类型在表约束和文档中存在，但 `GET /export` 当前没有写入 export event。

## 6. Memory 主链路

### 6.1 创建 memory

请求进入 `POST /memories` 后：

1. `authMiddleware` 校验 bearer token。
2. route 读取 JSON body。
3. `createMemorySchema` 校验和规范化输入。
4. `MemoryService.createMemory` 生成 id、时间、默认 title、默认 scope/type/status/tags/source。
5. `MemoryRepository.createMemory` 写入 D1，初始 `embedding_status = pending`。
6. `EventService.recordCreateEvent` 写入 create event。
7. `duplicateWarnings` 按同 project、同 title 做简单重复提示。
8. `EmbeddingService.indexMemory` 同步索引。
9. 如果索引成功，写 Vectorize、写 `memory_embeddings`、更新 memory 为 `indexed`、写 index event。
10. 如果索引失败，memory 保留在 D1，状态改为 `failed`，写 index_failed event，并在 API 响应中返回 warning。

这个流程符合文档中的“先保存源数据，再索引”的原则。

### 6.2 更新 memory

请求进入 `PATCH /memories/:id` 后：

1. 校验认证和 body。
2. 查询 existing memory。
3. 如果请求把 `status` 改成 `archived`，直接返回 409，要求使用 archive endpoint。
4. 如果 existing 是 `canonical`，返回 `canonical_edit` warning。
5. 比较每个可编辑字段，只生成实际变化的 patch。
6. 如果 `content` 变化，先把 `embedding_status` 设置为 `stale`，记录旧/新 content hash。
7. 写入 D1 patch，并记录 update event。
8. 如果 content 变化，同步重新索引。
9. 如果只是 tags/metadata/project/type/status 等变化，不重新索引。

这里有一个重要细节：metadata-only 或 tags-only 编辑不会重新写 Vectorize，因此 Vectorize metadata 里的 tags 不会更新，因为当前 Vectorize metadata 本身也没有保存 tags。

### 6.3 归档 memory

请求进入 `POST /memories/:id/archive` 后：

1. 校验认证和 body。
2. 查询 memory。
3. 如果已经 archived，直接返回现有 memory。
4. 设置 `status = archived`、`archived_at = now`、`updated_at = now`。
5. 记录 archive event。

归档不会删除 D1 数据，也不会删除 Vectorize 向量。搜索或上下文召回应在 D1 回查后过滤 archived。

### 6.4 获取详情

`GET /memories/:id` 返回：

- 完整 memory。
- 最近 20 条 events。
- indexing 状态。

Indexing 状态由 memory 当前 `embeddingStatus`、最新 `memory_embeddings` 记录和最新 `index_failed` event 拼出来。

## 7. 搜索与上下文

### 7.1 当前搜索实现

`POST /search` 当前不是语义搜索。它的实际逻辑是：

1. 校验 `query`、`project`、`include_archived`、`limit`。
2. 用 `MemoryRepository.listMemories` 拉取最多 100 条候选 memory。
3. 把 query 转小写。
4. 只匹配 `title` 或 `tags`。
5. 返回结果并给 `score: 0`。

当前没有：

- 为 query 生成 embedding。
- 调 Vectorize query。
- 根据 vector id 回查 D1。
- 搜索 content。
- 支持 type/status/tags/scope 等完整过滤。
- 返回 snippet。
- 状态权重或 recency tie-breaker。

这与 `docs/architecture/FUNCTIONAL_MODULES.md` 和 `docs/product/MVP_SCOPE.md` 中定义的“语义搜索”目标存在明显差距。

### 7.2 当前 context 实现

`GET /context/:project` 当前逻辑是：

1. 认证。
2. 按 project 查询 memory。
3. 默认排除 archived。
4. 返回最近更新的 20 条 list item。

它不做 semantic ranking，也不区分 canonical/active/draft 优先级。作为第一版项目上下文入口可用，但还不是“最相关上下文”。

### 7.3 当前 export 实现

`GET /export` 当前导出：

- `exportedAt`
- `memories`
- `memory_embeddings`
- `memory_events`

它直接导出 D1 raw rows，字段保持 snake_case。符合“用户拥有源数据”和“导出索引元数据”的方向。

当前未记录 `export` event。

## 8. 认证与错误处理

私有 API 使用 `Authorization: Bearer <AUTH_TOKEN>`。

`authMiddleware` 的实现有几个好的细节：

- 缺少 `AUTH_TOKEN` 时返回 unauthorized。
- 使用 SHA-256 digest 后做常量时间比较，而不是直接字符串比较。
- token 长度不同也参与 diff 标记。

错误处理由 `AppError` 和 `toJsonErrorResponse` 统一输出：

```json
{
  "error": {
    "code": "invalid_request",
    "message": "invalid request",
    "details": {}
  }
}
```

当前 route 中多数 handler 自己 try/catch 并调用 `toJsonErrorResponse`，app 也注册了 `app.onError`。这有一点重复，但行为上没有问题。

## 9. OpenAPI 与文档

`src/openapi.ts` 手写 OpenAPI 3.1 spec，`/docs` 用 Scalar 展示。

优点：

- API 文档无认证即可查看。
- Schema 覆盖 memory、event、indexing、warning、error。
- README 明确列出本地启动和 Cloudflare bindings。

需要注意的地方：

- OpenAPI 中 `MemoryListItem` 使用 `allOf` 引用完整 `Memory`，再用 description 说明运行时省略 `content`、`archivedAt`、`metadata`。这对阅读者有帮助，但对严格客户端生成器不够准确。
- Search schema 文档描述比实际能力更弱，没有承诺语义搜索细节，但产品文档中承诺了语义搜索。

## 10. Codex Skill

`src/skill/memo-otter-skill.md` 是一个简短的使用说明。

它定义了：

- API base 通过 `MEMO_OTTER_BASE_URL` 配置。
- 私有请求必须带 bearer token。
- `save_memory` 对应 `POST /memories`。
- `list_memories` 对应 `GET /memories`。
- `get_memory` 对应 `GET /memories/:id`。
- `update_memory` 对应 `PATCH /memories/:id`。
- `archive_memory` 对应 `POST /memories/:id/archive`。

它没有写 `search_memory` 和 `get_project_context` 的详细调用说明，而这两个能力在 MVP 文档中被列为 AI 入口核心能力。后续需要补齐。

## 11. 测试现状

我在本次审阅中执行了：

```bash
pnpm typecheck
pnpm test -- --run
```

首次审阅时结果：

- TypeScript typecheck 通过。
- Vitest 4 个测试文件通过。
- 共 9 个测试用例通过。

当前测试覆盖：

- API 认证和 memory 生命周期。
- Service 创建、列表、详情、更新、归档。
- 索引失败时 D1 memory 保留且 warning 返回。
- metadata-only 或 tags-only 编辑不重新索引。
- OpenAPI JSON 和 Scalar docs 可访问。
- 工具函数规范化、hash、vector id、坏 JSON 降级。

测试使用 `test/fakes.ts` 中的 in-memory D1、fake AI、fake Vectorize，不依赖真实 Cloudflare 资源。

尚未覆盖：

- D1 migration 结构测试。
- 真实 Workers AI embedding。
- 真实 Vectorize upsert 和 query。
- 语义搜索。
- export API。
- context API。
- OpenAPI schema 与实际 response 的一致性。
- Web UI。
- Codex Skill 真实调用。

## 12. 已实现能力清单

已经实现：

- Cloudflare Worker 项目骨架。
- Hono app 和路由组装。
- 单 token bearer auth。
- Memory create/list/detail/update/archive。
- D1 migration。
- D1 repository。
- Workers AI embedding 调用。
- Vectorize upsert。
- Embedding metadata 保存。
- Indexing 成功/失败状态。
- Content 更新后重新索引。
- Index 失败不丢 D1 源数据。
- 轻量 event 记录。
- Export raw D1 JSON。
- Context by project。
- OpenAPI JSON。
- Scalar API docs。
- Codex Skill 初版说明。
- 单元和 service/API 测试。

## 13. 当前差距与风险

### 13.1 语义搜索尚未实现

这是最大的 MVP 差距。项目已经能生成 memory embedding 并写入 Vectorize，但搜索没有使用这些向量。

影响：

- “保存后自然语言召回”的核心闭环尚未完成。
- `memory_embeddings` 和 Vectorize 写入现在更像索引准备，还没有被读取使用。
- MVP 验收标准中的“自然语言搜索召回刚保存的 memory”尚不成立。

建议优先实现独立 `SearchService`：

- 对 query 调 Workers AI embedding。
- 调 Vectorize query。
- 用 vector id 查 `memory_embeddings`。
- 回查 D1 memories。
- 应用 project/type/status/tags/include_archived 过滤。
- 返回 score、snippet 和 metadata。

### 13.2 Search API 的过滤能力不足

文档要求支持 project、scope、type、status、tags、limit、include_archived。当前 `POST /search` 只支持 query、project、include_archived、limit。

### 13.3 Web UI 尚未实现

根路径只是占位 HTML。MVP 文档中要求 Web UI 能浏览、搜索、新增、编辑、归档、导出和查看 Skill 使用说明。

### 13.4 Export 未记录事件

数据模型允许 `export` event，文档也提到 event 类型，但当前 `GET /export` 没有写 event。这个不是核心阻断，但会让审计/解释链路少一环。

### 13.5 旧 Vectorize 向量未清理

内容更新后会生成新 `vector_id` 并 upsert，但旧向量不会删除。文档接受 MVP 暂不清理 archived vectors，但内容更新后的旧向量如果仍能被 Vectorize 召回，搜索回查 D1 时可能拿到同一个 memory 的旧 vector metadata。

因为 D1 memory 已更新，最终展示内容仍来自 D1，不会丢数据；但排序和重复结果可能受影响。后续实现 search 时需要按 memory id 去重，并优先使用最新 embedding metadata 或最新 content hash。

### 13.6 `INSERT OR IGNORE` 可能掩盖 embedding metadata 写入问题

首次审阅时，`EmbeddingRepository.createEmbeddingRecord` 使用 `INSERT OR IGNORE`。如果因为唯一约束冲突被忽略，service 仍会认为 metadata 写入成功，并把 memory 标记为 indexed。

该风险已在 2026-06-03 的 Embedding 与索引加固中解决：写入逻辑已改为基于 `(memory_id, chunk_index, content_hash)` 的明确 upsert。

### 13.7 Route try/catch 与 app.onError 重复

每个 route 自己捕获错误，同时 `app.onError` 也存在。当前没有明显 bug，但代码风格上可以统一，让 route 更薄。

### 13.8 List tag 过滤分页不精确

tags 暂存在 JSON 字符串，列表时先从 D1 取 `limit * 3 + 1` 条候选再应用层过滤。这个 MVP 可以接受，但当同 project 下数据变多时，可能导致分页不准确或漏掉 offset 后面的匹配 tag。

### 13.9 文档和实现状态有几处时间差

部分文档写于工程初始化早期，例如 `MEMORY_BASIC_MANAGEMENT.md` 中开头还说“尚未看到 src/migrations/wrangler”，但同一份文档后续又记录了实现状态。建议后续维护时把“历史状态”和“当前状态”分开。

## 14. 推荐后续开发顺序

建议下一轮优先做这些事：

1. 实现 `SearchService`，把 `POST /search` 接到 Workers AI + Vectorize query。
2. 为 search 增加测试，包括 fake Vectorize query、archived 过滤、project/type/status/tags 过滤、按 memory id 去重。
3. 补齐 `GET /context/:project` 排序策略，至少 canonical 优先、active 其次、draft 最后。
4. 补齐 `src/skill/memo-otter-skill.md` 中 `search_memory` 和 `get_project_context` 的说明。
5. 实现最小 Web UI，避免首页长期停留在占位状态。
6. 给 `GET /export` 写 export event，或者从数据模型中暂时移除 export event 承诺。
7. 真实 Cloudflare 环境冒烟：create -> indexed -> Vectorize query -> search recall -> archive exclusion。

## 15. 后续实现记录：Embedding 与索引加固

更新日期：2026-06-03

本次在深度审阅后完成了 Embedding 与索引模块的加固：

- `EmbeddingService` 已移除手写 AI/Vectorize binding 类型，改用 `worker-configuration.d.ts` 生成的环境类型。
- 索引失败阶段已从基于错误文案猜测，改为显式区分 `embedding`、`vectorize`、`d1_metadata`。
- Vectorize metadata 已避免写入 `null`。
- `EmbeddingRepository` 已从 `INSERT OR IGNORE` 调整为基于 `(memory_id, chunk_index, content_hash)` 的明确 upsert。
- 错误摘要会清理控制字符和栈片段，降低把完整运行栈写入 D1 event 的风险。
- 测试从 4 个文件 9 个用例扩展到 4 个文件 15 个用例。
- 新增测试覆盖 Workers AI 失败、AI 返回格式异常、Vectorize 失败、D1 metadata 失败、`indexed` 状态更新失败、内容变化重新索引、Vectorize metadata 不写入 `null`。

仍然保留的外部验证限制：

- 本地 Wrangler 使用 remote Workers AI binding 创建 memory 时，Cloudflare 返回 internal error；当前代码按设计保留 D1 memory 并降级为 `failed`。
- 最新 Worker 已成功部署，但本机访问 `workers.dev` `/health` 超时，远端 HTTP 主链路需网络可达后复测。

## 16. 我对项目设计的判断

这个项目的架构方向是健康的。

好的地方：

- D1 作为源数据、Vectorize 作为可重建索引，这个边界非常清楚。
- 写操作先落 D1 再索引，失败降级合理。
- Memory 状态设计足够克制，`draft/active/canonical/archived` 很适合个人 AI 记忆。
- `scope` 和自定义 `type` 的组合比硬编码一堆业务类型更耐用。
- Service/Repository/Route 分层基本干净。
- 事件系统轻量，不把 MVP 拖成审计系统。
- 测试虽然不多，但覆盖了几个真正重要的失败路径。

需要警惕的地方：

- 文档里的 MVP 已经包含 Web UI 和语义搜索，但实现目前还停在 API 基础管理和索引写入阶段。
- 如果继续扩展功能而不先完成搜索读取链路，项目会变成“能保存和建索引，但不能真正召回”的半闭环。
- Skill 目前只是仓库内说明文件，还没有成为真实 Codex 工作流中的稳定入口。

总体判断：Memo Otter 已经有一个可靠的后端底座，下一步最值得投入的是语义搜索和最小 Web UI。这两个完成后，项目才会从“记忆数据服务”变成真正可用的“个人 AI 记忆层”。
