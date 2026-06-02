# Memo Otter 技术方案设计

更新时间：2026-06-02

这份文档定义 Memo Otter MVP 的技术方案。它基于 PRD、MVP 范围、功能模块拆解和原型交互设计，目标是把产品需求转化为可以进入工程实现的架构、数据模型、接口、部署和测试方案。

## 1. 技术目标

Memo Otter MVP 要打通个人 AI 记忆服务的最小闭环：

```text
保存记忆 -> 生成 embedding -> 写入 D1 和 Vectorize -> 搜索召回 -> 通过 REST API / Codex Skill 给 AI 工作流使用 -> 在 Web UI 中检查和修正
```

技术方案需要满足：

- 部署在用户自己的 Cloudflare 账户。
- D1 保存可读、可导出的源数据。
- Vectorize 只作为可重建语义索引。
- Workers AI 作为 MVP 唯一 embedding provider。
- Codex Skill 指导 Agent 调用安全、低风险的记忆能力。
- Web UI 与 API 共用同一个 Worker。
- 第一版尽量少引入复杂后台任务和分布式组件。

## 2. 技术选型

### 2.1 运行平台

- Cloudflare Workers
- Wrangler
- TypeScript

选择理由：

- 符合 Cloudflare-first 产品定位。
- 部署成本低，适合个人工具。
- Workers 可以通过 bindings 直接访问 D1、Vectorize、Workers AI 等 Cloudflare 资源。
- 单 Worker 足以支撑 MVP 的 REST API 和静态 Web UI。

### 2.2 Web/API 框架

推荐：

- Hono

原因：

- 轻量。
- 适合 Cloudflare Workers。
- 路由、中间件、认证和 JSON 响应组织清楚。
- 比手写 fetch router 更容易维护。

备选：

- 原生 Worker `fetch` handler。

不建议 MVP 使用：

- Next.js 全栈部署。
- 复杂后端框架。
- 多 Worker service 拆分。

### 2.3 前端

推荐：

- Vite + React
- TypeScript
- Worker 托管静态构建产物

原因：

- UI 是开发者工具，不需要复杂 SSR。
- MVP 交互以表单、列表、详情和搜索为主。
- 静态 UI 与 Worker API 同源部署，认证和 CORS 更简单。

### 2.4 数据和 AI 服务

- D1：源数据库。
- Vectorize：语义向量索引。
- Workers AI：生成 embedding。
- Secret `AUTH_TOKEN`：单用户访问控制。

### 2.5 AI 入口

推荐：

- MVP 使用 Codex Skill 作为第一版 AI 入口。
- Skill 通过说明和规则指导 Agent 调用 REST API。
- MCP endpoint 延后到 MVP+，用于未来跨工具互操作。

MVP 能力：

- `save_memory`
- `search_memory`
- `get_project_context`

不进入 MVP：

- MCP endpoint。
- MCP tools。
- `delete_memory`
- `deprecate_memory`
- `merge_memories`
- `replace_canonical_memory`
- `import_memories`

## 3. 总体架构

```text
Codex / Browser
        |
        v
Cloudflare Worker
  ├── Web UI static assets
  ├── REST API routes
  ├── Auth middleware
  ├── Memory service
  ├── Search service
  ├── Embedding service
  └── Export service
        |
        ├── D1
        ├── Vectorize
        └── Workers AI
```

### 3.1 分层设计

建议代码按以下层次组织：

```text
src/
  index.ts
  app.ts
  routes/
    memories.ts
    search.ts
    export.ts
    health.ts
    context.ts
  services/
    memory-service.ts
    embedding-service.ts
    search-service.ts
    export-service.ts
    event-service.ts
  repositories/
    memory-repository.ts
    embedding-repository.ts
    event-repository.ts
  skill/
    memo-otter-skill.md
  schemas/
    memory.ts
    search.ts
  utils/
    auth.ts
    errors.ts
    json.ts
```

职责说明：

- `routes`：只处理 HTTP 输入输出。
- `services`：组织业务流程。
- `repositories`：封装 D1 SQL。
- `skill`：保存 Codex Skill 使用说明和示例。
- `schemas`：输入校验和类型定义。
- `utils`：认证、错误和响应工具。

### 3.2 关键原则

- 不在 route 中直接写复杂 SQL。
- 不把 D1 和 Vectorize 写入混在同一个函数里。
- 不把 request 级状态放在模块全局变量。
- Cloudflare 资源通过 bindings 访问，不从 Worker 内调用 Cloudflare REST API。
- 所有外部副作用要么 `await`，要么交给 `ctx.waitUntil()`。

## 4. Cloudflare 资源设计

### 4.1 Worker

职责：

- 提供 REST API。
- 托管 Web UI 静态资源。
- 访问 D1、Vectorize、Workers AI bindings。

建议配置：

- `compatibility_date` 使用项目创建当天或当前日期。
- 启用 `nodejs_compat`，方便部分 SDK 依赖 Node.js built-ins。
- 启用 observability。

### 4.2 D1

职责：

- 保存 memories。
- 保存 memory embeddings 元数据。
- 保存 memory events。

原则：

- D1 是唯一源数据。
- 导出数据以 D1 为准。
- Vectorize 数据可以通过 D1 重新生成。

### 4.3 Vectorize

职责：

- 保存 memory 内容 embedding。
- 支持 query embedding 相似度查询。

原则：

- 保存 `vector_id` 到 D1。
- 搜索时先查 Vectorize，再回查 D1。
- 归档 memory 不必立即删除向量，搜索结果回查 D1 后过滤即可。
- 内容更新时重新 upsert 新向量，并更新 D1 中的 `content_hash` 和 `vector_id` 元数据。

### 4.4 Workers AI

职责：

- 生成 memory content embedding。
- 生成 query embedding。

MVP 限制：

- 只支持一个 embedding model。
- 模型名称和 Vectorize 维度必须在开发前确定。
- 不做摘要生成、自动冲突判断或自动合并。

## 5. Wrangler 配置方案

推荐使用 `wrangler.jsonc`，因为 Cloudflare Workers 新功能和配置项更适合 JSONC 管理。

需要配置：

- Worker name。
- `main`。
- `compatibility_date`。
- `compatibility_flags`。
- D1 binding。
- Vectorize binding。
- Workers AI binding。
- static assets binding 或 assets 配置。
- observability。

建议 binding 命名：

- `DB`
- `VECTORIZE`
- `AI`

Secret：

- `AUTH_TOKEN`

环境：

- MVP 可以先只有 production。
- 如果后续加入 staging，需要为 D1、Vectorize、secrets 分别配置独立资源，不共用生产数据。

## 6. 数据库设计

## 6.1 `memories`

字段：

- `id TEXT PRIMARY KEY`
- `title TEXT NOT NULL`
- `content TEXT NOT NULL`
- `project TEXT`
- `type TEXT NOT NULL`
- `status TEXT NOT NULL`
- `tags_json TEXT NOT NULL`
- `source TEXT`
- `embedding_status TEXT NOT NULL`
- `metadata_json TEXT`
- `created_at TEXT NOT NULL`
- `updated_at TEXT NOT NULL`
- `archived_at TEXT`

约束：

- `type` 只允许 `decision`、`preference`、`context`、`note`。
- `status` 只允许 `draft`、`active`、`canonical`、`archived`。
- `embedding_status` 只允许 `pending`、`indexed`、`failed`、`stale`。

推荐索引：

- `idx_memories_project`
- `idx_memories_type`
- `idx_memories_status`
- `idx_memories_updated_at`
- `idx_memories_project_status`

## 6.2 `memory_embeddings`

字段：

- `id TEXT PRIMARY KEY`
- `memory_id TEXT NOT NULL`
- `chunk_index INTEGER NOT NULL`
- `content_hash TEXT NOT NULL`
- `embedding_model TEXT NOT NULL`
- `vector_id TEXT NOT NULL`
- `created_at TEXT NOT NULL`

约束：

- `memory_id` 关联 `memories.id`。
- `vector_id` 用于后续重建、清理或排查索引。

MVP 规则：

- 默认每条 memory 只生成一个 chunk。
- 长文本分块延后或只保留非常简单的按长度切分。

## 6.3 `memory_events`

字段：

- `id TEXT PRIMARY KEY`
- `memory_id TEXT`
- `event_type TEXT NOT NULL`
- `before_json TEXT`
- `after_json TEXT`
- `source TEXT`
- `created_at TEXT NOT NULL`

MVP event 类型：

- `create`
- `update`
- `archive`
- `index`
- `index_failed`
- `export`

原则：

- 事件用于调试和可解释，不做完整审计系统。
- 不为了事件系统阻塞主流程。

## 7. 核心数据流

## 7.1 创建 memory

```text
Client
  -> POST /memories
  -> auth
  -> validate input
  -> insert memory into D1 with embedding_status = pending
  -> create memory_event: create
  -> generate embedding with Workers AI
  -> upsert vector into Vectorize
  -> insert memory_embeddings row
  -> update memory embedding_status = indexed
  -> return memory + index status + warnings
```

失败处理：

- D1 写入失败：请求失败，不创建 memory。
- Workers AI 失败：memory 保留，`embedding_status = failed`。
- Vectorize 失败：memory 保留，`embedding_status = failed`。
- 失败时记录 `index_failed` event。

MVP 取舍：

- 第一版可以同步完成 embedding 和 Vectorize 写入，方便调试。
- 如果响应变慢，后续再把索引放入 `ctx.waitUntil()` 或 Queue。

## 7.2 编辑 memory

```text
Client
  -> PATCH /memories/:id
  -> auth
  -> load existing memory
  -> validate patch
  -> update D1
  -> create memory_event: update
  -> if content changed:
       set embedding_status = stale
       regenerate embedding
       upsert Vectorize
       update memory_embeddings
       set embedding_status = indexed
  -> return updated memory
```

规则：

- 只改 tags、type、status、project 时不强制重新 embedding。
- 改 content 时必须重新 embedding。
- 编辑 canonical memory 不禁止，但 UI 要提示影响。

## 7.3 归档 memory

```text
Client
  -> POST /memories/:id/archive
  -> auth
  -> update status = archived
  -> set archived_at
  -> create memory_event: archive
  -> return archived memory
```

规则：

- MVP 不物理删除 D1 数据。
- MVP 不要求立即删除 Vectorize 向量。
- 搜索和项目上下文回查 D1 后过滤 archived。

## 7.4 搜索 memory

```text
Client
  -> POST /search
  -> auth
  -> validate query
  -> generate query embedding with Workers AI
  -> query Vectorize
  -> collect vector_ids
  -> lookup memory_embeddings
  -> lookup memories from D1
  -> apply filters
  -> exclude archived by default
  -> rank and shape result
  -> return results
```

排序：

1. Vectorize similarity score。
2. 状态权重：`canonical` > `active` > `draft`。
3. 类型权重：`decision`、`preference` 优先。
4. `updated_at` 作为轻量 tie-breaker。

## 7.5 Skill 调用

```text
Codex Agent
  -> reads Memo Otter Skill
  -> calls REST API with AUTH_TOKEN
  -> service layer
  -> D1 / Vectorize / Workers AI
  -> REST response
```

原则：

- Skill 不实现独立业务逻辑，只指导 Agent 调用 REST API。
- REST 返回要简洁，但必须包含 memory id、status、project、type 等可追踪信息。
- 高风险写操作不暴露给 AI 入口。

## 8. REST API 设计

## 8.1 认证

所有私有接口都要求：

```text
Authorization: Bearer <AUTH_TOKEN>
```

MVP 私有接口：

- `/memories`
- `/search`
- `/export`
- `/context/:project`

`/health`：

- 可以公开返回基础在线状态。
- 详细 binding 检查建议要求认证。

## 8.2 Endpoint

### `GET /health`

用途：

- 检查 Worker 是否在线。
- 检查 D1、Vectorize、Workers AI binding 是否存在。

响应：

- `ok`
- `version`
- `bindings`

### `GET /memories`

查询参数：

- `project`
- `type`
- `status`
- `tag`
- `include_archived`
- `limit`
- `cursor`

响应：

- `items`
- `next_cursor`

### `POST /memories`

请求：

- `title`
- `content`
- `project`
- `type`
- `status`
- `tags`
- `source`
- `metadata`

响应：

- `memory`
- `embedding_status`
- `warnings`

### `GET /memories/:id`

响应：

- `memory`
- `events`
- `embedding`

### `PATCH /memories/:id`

请求：

- 可编辑字段的 partial object。

响应：

- `memory`
- `embedding_status`

### `POST /memories/:id/archive`

响应：

- `memory`

### `POST /search`

请求：

- `query`
- `project`
- `type`
- `status`
- `tags`
- `limit`
- `include_archived`

响应：

- `query`
- `items`

### `GET /export`

响应：

- `exported_at`
- `schema_version`
- `memories`
- `memory_events`
- `memory_embeddings`

### `GET /context/:project`

用途：

- 返回某个 project 的关键上下文，供 Web UI 和 Codex Skill 使用。

响应：

- `project`
- `decisions`
- `preferences`
- `context`
- `notes`

## 9. AI 入口能力设计

## 9.1 `save_memory`

输入：

- `title`
- `content`
- `project`
- `type`
- `status`
- `tags`
- `source`

默认值：

- `type = note`
- `status = active`
- `source = skill`

行为：

- 通过 REST API 创建 memory。
- 生成 embedding。
- 写入 Vectorize。
- 返回 memory id 和索引状态。
- 返回疑似重复或冲突提示。

## 9.2 `search_memory`

输入：

- `query`
- `project`
- `type`
- `status`
- `tags`
- `limit`

行为：

- 执行语义搜索。
- 默认排除 archived。
- 返回结果片段和元数据。

## 9.3 `get_project_context`

输入：

- `project`
- `limit`

行为：

- 返回该 project 下的关键上下文。
- 优先 canonical。
- 其次 active。
- 按 type 分组：decisions、preferences、context、notes。

## 10. 搜索和索引策略

## 10.1 Embedding 输入

MVP 使用 memory 的组合文本生成 embedding：

```text
Title: <title>
Project: <project>
Type: <type>
Tags: <tags>
Content:
<content>
```

原因：

- project、type、tags 对召回有帮助。
- 仍然保留 content 作为主体。

## 10.2 Vector metadata

向量 metadata 建议包含：

- `memory_id`
- `project`
- `type`
- `status`
- `tags`
- `content_hash`

注意：

- metadata 是辅助过滤和排查，不作为源数据。
- 真实展示仍以 D1 回查结果为准。

## 10.3 疑似重复提示

创建 memory 后可以用同一 embedding 查询相似内容：

- 如果最高相似度超过阈值，返回 `possible_duplicate`。
- 只提示，不阻止保存。

阈值先作为配置值，不在 PRD 阶段过度确定。

## 10.4 可能冲突提示

MVP 只做轻量规则：

- 同 project。
- 同 type。
- 已有 canonical。
- 相似度较高。

返回 `possible_conflict`，不自动合并、不自动覆盖。

## 11. 认证和安全

## 11.1 认证模型

MVP 使用单一 bearer token：

- token 存在 Cloudflare Secret `AUTH_TOKEN`。
- 所有私有 API 校验 token。
- Web UI 需要用户输入 token 或通过部署者本地配置访问。

## 11.2 安全规则

- 不在仓库中保存 token。
- 不在导出 JSON 中包含 token。
- 不在日志中输出完整 Authorization header。
- 认证比较应避免直接字符串短路比较。
- 所有错误响应避免泄露 secret、完整 stack trace 或内部 binding 名称细节。

## 11.3 高风险操作

MVP 不提供物理删除。

归档规则：

- 归档需要明确用户动作。
- archived 默认不参与搜索。
- 可以通过 `include_archived` 找回。

## 12. Web UI 技术结构

## 12.1 页面

- Memories 工作台。
- New Memory。
- Memory Detail/Edit。
- Skill Setup。
- Export。

## 12.2 状态管理

MVP 不需要复杂全局状态库。

建议：

- URL query 保存搜索和筛选条件。
- 组件本地状态处理表单。
- API 请求封装成轻量 client。
- token 存储方案要谨慎，优先让用户明确输入，后续再决定是否持久化。

## 12.3 错误处理

UI 必须区分：

- 未认证。
- 保存失败。
- 索引失败。
- 搜索失败。
- 导出失败。

索引失败不等于保存失败。用户应该能看到 memory 已保存，但暂时无法语义搜索。

## 13. 可观测性和调试

## 13.1 日志

建议记录结构化日志：

- request id。
- route。
- method。
- memory id。
- operation。
- duration。
- result。
- error code。

不记录：

- AUTH_TOKEN。
- 完整 Authorization header。
- 过长 content。

## 13.2 Health check

`GET /health` 返回：

- Worker 在线。
- 版本。
- D1 binding 状态。
- Vectorize binding 状态。
- Workers AI binding 状态。

详细 binding 检查可以要求认证。

## 13.3 本地调试

必须支持：

- 本地启动 Worker。
- 本地执行 D1 migration。
- 远程或本地测试 Workers AI 和 Vectorize。
- 用 REST API 保存和搜索一条测试 memory。
- 在真实 Codex 会话中调试 Skill 调用流程。

## 14. 测试方案

## 14.1 单元测试

覆盖：

- memory schema 校验。
- status/type 校验。
- tags JSON 转换。
- content hash。
- 搜索参数解析。
- 状态权重排序。

## 14.2 集成测试

覆盖：

- D1 repository。
- memory 创建和读取。
- memory 编辑。
- memory 归档。
- event 记录。

## 14.3 端到端冒烟测试

部署后必须验证：

1. 未认证请求被拒绝。
2. `/health` 正常。
3. 创建一条 memory。
4. D1 中能查到源数据。
5. embedding 生成成功。
6. Vectorize 写入成功。
7. 自然语言搜索可以召回它。
8. REST `get_project_context` 能返回项目上下文。
9. Codex Skill 能指导 Agent 保存 memory。
10. Codex Skill 能指导 Agent 搜索 memory。
11. 归档后默认搜索不到。
12. JSON export 可用。

## 15. 部署方案

## 15.1 初始化资源

需要创建：

- Worker。
- D1 database。
- Vectorize index。
- Workers AI binding。
- `AUTH_TOKEN` secret。

## 15.2 Migration

要求：

- 所有 schema 变更写入 migrations。
- README 提供本地和远端 migration 命令。
- 不允许手动在 Dashboard 修改生产 schema 后不回写 migration。

## 15.3 发布

发布流程：

```text
pnpm install
pnpm test
pnpm build
wrangler d1 migrations apply
wrangler deploy
run smoke test
```

## 16. 风险与取舍

## 16.1 AI 入口演进

风险：

- Skill 入口优先服务 Codex，自带跨工具能力不足。

取舍：

- MVP 先验证真实自用价值。
- MCP 延后到 MVP+，等核心服务稳定后再补跨工具协议。

## 16.2 Workers AI 和 Vectorize 本地开发

风险：

- 本地环境可能无法完全模拟远程 AI 和 Vectorize 行为。

取舍：

- 本地开发先用接口抽象和 mock。
- 冒烟测试必须在 Cloudflare 远端完成。

## 16.3 同步索引导致响应变慢

风险：

- 创建 memory 时同步生成 embedding 和写入 Vectorize 可能让响应变慢。

取舍：

- MVP 优先可理解和可调试，先同步实现。
- 后续根据体验改为 `ctx.waitUntil()` 或 Queue。

## 16.4 归档不删除向量

风险：

- Vectorize 中仍存在 archived memory 的向量。

取舍：

- 搜索回查 D1 后过滤 archived。
- 保持数据安全和实现简单。
- 后续补充后台清理或 reindex 工具。

## 16.5 单 token 认证

风险：

- token 泄露会暴露全部个人记忆。

取舍：

- MVP 是单用户个人服务，先用单 token。
- 部署文档必须说明如何 rotate token。
- 后续再考虑 OAuth 或 scoped token。

## 17. MVP 技术验收标准

MVP 技术实现完成必须满足：

- Worker 可以部署到 Cloudflare。
- D1 migration 可以执行。
- `DB`、`VECTORIZE`、`AI` bindings 可用。
- 未认证请求无法访问私有数据。
- Web UI 可以创建、搜索、编辑、归档 memory。
- REST API 可以完成主链路。
- Codex Skill 可以在真实会话中指导 Agent 使用保存、搜索和项目上下文能力。
- 保存 memory 后 D1 有源数据。
- 保存 memory 后 Vectorize 有向量。
- 搜索能召回刚保存的 memory。
- archived memory 默认不参与搜索。
- JSON export 不包含 secret。
- README 能指导用户从零部署。

## 18. 后续演进

MVP 后再考虑：

- JSON import。
- deprecated 状态和 supersedes 关系。
- 手动 merge。
- 自动冲突判断。
- 多 embedding provider。
- Queue 异步索引。
- reindex 命令。
- MCP endpoint 和 MCP tools。
- Hooks 自动生成候选记忆。
- 浏览器 capture。
- Obsidian 插件。
- Markdown 文件夹同步。

## 19. 参考资料

- Cloudflare Workers bindings 文档：https://developers.cloudflare.com/workers/runtime-apis/bindings/
- Cloudflare Vectorize + Workers AI 文档：https://developers.cloudflare.com/vectorize/get-started/embeddings/
- Cloudflare Vectorize Client API：https://developers.cloudflare.com/vectorize/reference/client-api/
- MCP SDK 文档，供 MVP+ 参考：https://modelcontextprotocol.io/docs/sdk
- MCP transports 规范，供 MVP+ 参考：https://modelcontextprotocol.io/specification/2025-06-18/basic/transports
