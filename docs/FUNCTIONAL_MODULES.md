# Memo Otter 功能模块拆解

这份文档把 PRD 和 MVP 范围拆成可以进入设计和开发的功能模块。它不展开具体技术实现细节，而是明确每个模块要解决什么问题、包含哪些功能点、依赖什么输入、产出什么结果，以及完成到什么程度可以验收。

MVP 主链路：

```text
保存记忆 -> 生成 embedding -> 写入 D1 和 Vectorize -> 搜索召回 -> 通过 REST API / Codex Skill 给 AI 工作流使用 -> 在 Web UI 中检查和修正
```

## 1. 模块总览

MVP 拆成 10 个功能模块：

1. Memory 数据模型
2. Memory 基础管理
3. Embedding 与索引
4. 语义搜索
5. AI 入口
6. REST API
7. Web UI
8. 认证与访问控制
9. 数据导出与备份
10. 部署、配置与调试

模块依赖关系：

```text
Memory 数据模型
  -> Memory 基础管理
  -> Embedding 与索引
  -> 语义搜索
  -> REST API / Web UI / AI 入口
  -> 数据导出与备份
  -> 部署、配置与调试
```

## 2. Memory 数据模型

### 2.1 模块目标

定义 Memo Otter 最核心的数据结构，让记忆可以被保存、编辑、搜索、归档、导出和重新索引。

### 2.2 功能点

- 定义 `memories` 表。
- 定义 `memory_embeddings` 表。
- 定义轻量 `memory_events` 表。
- 定义 memory 生命周期枚举。
- 定义用户可自定义的 memory 类型规则。
- 定义 memory 状态枚举。
- 定义 embedding 索引状态。
- 定义基础字段校验规则。
- 定义创建、更新、归档时的时间字段变化。

### 2.3 核心字段

`memories`：

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

`memory_embeddings`：

- `id`
- `memory_id`
- `chunk_index`
- `content_hash`
- `embedding_model`
- `vector_id`
- `created_at`

`memory_events`：

- `id`
- `memory_id`
- `event_type`
- `before_json`
- `after_json`
- `source`
- `created_at`

### 2.4 设计注意点

- D1 是源数据，Vectorize 只是可重建索引。
- `tags` 在 API 和 UI 中使用数组，在 D1 中可以先用 JSON 保存。
- `project` 在 MVP 中是自由文本，不做独立项目实体。
- `archived` 记忆默认不参与搜索。
- 第一版不实现 `deprecated`、`supersedes` 和复杂版本关系。

### 2.5 验收要点

- 可以通过 migration 创建所有 MVP 表。
- Memory 生命周期只允许 `long_term`、`short_term`。
- Memory 类型允许用户自定义，但必须是非空短字符串。
- Memory 状态只允许 `draft`、`active`、`canonical`、`archived`。
- 创建 memory 时自动生成 `id`、`created_at`、`updated_at`。
- 编辑 memory 时更新 `updated_at`。
- 归档 memory 时写入 `archived_at`。

## 3. Memory 基础管理

实现状态：已完成第一版工程实现。

落地内容：

- Hono routes：`GET /memories`、`POST /memories`、`GET /memories/:id`、`PATCH /memories/:id`、`POST /memories/:id/archive`。
- Service 层：`MemoryService`、`EmbeddingService`、`EventService`。
- Repository 层：`MemoryRepository`、`EmbeddingRepository`、`EventRepository`。
- Schema 层：Zod create/update/list/archive 校验。
- 本地和远端 D1 migration 已应用。
- 本地测试覆盖创建、列表、详情、编辑、归档、认证和索引失败降级。

当前限制：

- Workers AI 在本地 HTTP 冒烟中返回过 internal error，memory 会保留且 `embedding_status = failed`，符合失败降级设计。
- 远端 Worker 已部署，但本机访问 workers.dev URL 出现超时，远端 HTTP 冒烟需要稍后复测。

### 3.1 模块目标

让用户可以创建、查看、编辑和归档记忆。这是后续搜索、REST API、Skill 和 Web UI 的基础。

### 3.2 功能点

- 创建 memory。
- 查看 memory 列表。
- 查看 memory 详情。
- 编辑 memory。
- 归档 memory。
- 记录轻量 memory event。
- 返回适合 UI、REST API 和 Skill 使用的结构化结果。

### 3.3 创建 memory

输入字段：

- `title`
- `content`
- `project`
- `scope`
- `type`
- `status`
- `tags`
- `source`
- `metadata`

处理规则：

- `content` 必填。
- `title` 可选；如果为空，可以从内容前若干字生成默认标题。
- `scope` 默认为 `long_term`。
- `type` 默认为 `note`，但允许用户自定义。
- `status` 默认为 `active`。
- `tags` 默认为空数组。
- 创建成功后触发 embedding 和索引流程。

输出结果：

- memory 基础信息。
- embedding/index 状态。
- 疑似重复或冲突提示。

### 3.4 查看列表

支持参数：

- `project`
- `scope`
- `type`
- `status`
- `tags`
- `include_archived`
- `limit`
- `cursor` 或 `offset`

展示字段：

- `id`
- `title`
- `project`
- `type`
- `status`
- `tags`
- `source`
- `created_at`
- `updated_at`

### 3.5 查看详情

详情需要返回：

- memory 全量字段。
- 最近的 memory events。
- embedding/index 状态。

### 3.6 编辑 memory

允许编辑：

- `title`
- `content`
- `project`
- `type`
- `status`
- `tags`
- `metadata`

处理规则：

- 如果 `content` 变化，需要重新生成 embedding 并更新 Vectorize。
- 如果只有元数据变化，可以不重新生成 embedding。
- 编辑成功后记录 `update` event。

### 3.7 归档 memory

处理规则：

- 将 `status` 设为 `archived`。
- 写入 `archived_at`。
- 记录 `archive` event。
- 归档后的 memory 默认不参与搜索和项目上下文召回。

### 3.8 验收要点

- 可以创建一条 memory，并在列表中看到。
- 可以打开详情看到完整内容。
- 可以编辑内容和标签。
- 内容编辑后会触发重新索引。
- 可以归档 memory。
- 归档后默认列表和搜索不显示，除非显式包含 archived。

## 4. Embedding 与索引

### 4.1 模块目标

把 memory 内容转成向量并写入 Vectorize，让自然语言搜索可以召回相关记忆。

### 4.2 功能点

- 调用 Workers AI 生成 embedding。
- 记录 embedding 模型名称。
- 生成稳定 vector id。
- 写入 Vectorize。
- 保存 `memory_embeddings` 记录。
- 标记 `embedding_status`。
- 内容变化时重新索引。
- 处理 embedding 或 Vectorize 写入失败。

### 4.3 索引状态

建议状态：

- `pending`
- `indexed`
- `failed`
- `stale`

状态含义：

- `pending`：memory 已保存，等待生成 embedding。
- `indexed`：embedding 和 Vectorize 写入成功。
- `failed`：embedding 或 Vectorize 写入失败。
- `stale`：内容已更新，但新索引尚未完成。

### 4.4 处理规则

- 创建 memory 后，将 `embedding_status` 设为 `pending`。
- embedding 成功并写入 Vectorize 后，设为 `indexed`。
- 失败时保留 D1 源数据，设为 `failed`，并返回可读错误。
- 内容更新后，将旧索引视为 `stale`，新索引成功后恢复 `indexed`。
- MVP 可以先按整条 memory 生成一个 embedding；长文本分块可延后或保留简单实现。

### 4.5 验收要点

- 创建 memory 后可以生成 embedding。
- Vectorize 中有对应向量。
- `memory_embeddings` 中保存 vector id 和 embedding model。
- Vectorize 失败时 D1 数据不丢失。
- 搜索不会因为个别未索引 memory 失败而整体失败。

## 5. 语义搜索

### 5.1 模块目标

让用户和 AI 可以用自然语言搜索已有记忆，并获得可解释、可过滤、可继续追踪的结果。

### 5.2 功能点

- 接收自然语言 query。
- 为 query 生成 embedding。
- 查询 Vectorize。
- 根据 vector id 回查 D1 memory。
- 支持 project、type、status、tags 过滤。
- 默认排除 archived。
- 返回分数、摘要片段和元数据。
- 对结果做轻量排序。

### 5.3 输入参数

- `query`
- `project`
- `type`
- `status`
- `tags`
- `limit`
- `include_archived`

### 5.4 输出字段

- `id`
- `title`
- `snippet`
- `project`
- `type`
- `status`
- `tags`
- `score`
- `source`
- `created_at`
- `updated_at`

### 5.5 排序规则

MVP 排序建议：

1. Vectorize 相似度分数。
2. 状态权重：`canonical` > `active` > `draft`。
3. 类型权重：`decision`、`preference` 优先于普通 `note`。
4. 轻量 recency tie-breaker。

### 5.6 疑似重复和冲突提示

创建 memory 时可以复用搜索能力：

- 如果相似度很高，返回疑似重复提示。
- 如果同 project、同 type 已有 canonical 记忆且语义相近，返回可能冲突提示。
- MVP 只提示，不自动合并、不自动覆盖。

### 5.7 验收要点

- 保存一条 memory 后，可以用自然语言搜到它。
- project 过滤生效。
- type 过滤生效。
- status 过滤生效。
- tags 过滤生效。
- archived 默认不返回。
- 搜索结果包含 score 和可读片段。

## 6. AI 入口

### 6.1 模块目标

让 Codex 中的 Agent 可以根据 Skill 说明调用 Memo Otter 的记忆能力。MVP 不实现 MCP endpoint；MCP 延后到 MVP+，用于未来跨工具互操作。

### 6.2 MVP 能力

MVP 通过 REST API 和 Codex Skill 提供：

- `save_memory`
- `search_memory`
- `get_project_context`

### 6.3 `save_memory`

用途：让 AI 在用户明确要求时，通过 REST API 保存一条记忆。

输入：

- `title`
- `content`
- `project`
- `type`
- `status`
- `tags`
- `source`

输出：

- memory id。
- 保存结果。
- embedding/index 状态。
- 疑似重复或冲突提示。

验收：

- Codex Skill 能指导 Agent 成功调用保存接口。
- 保存后的 memory 可以在 Web UI 和搜索中看到。
- 未认证请求不能保存。

### 6.4 `search_memory`

用途：让 AI 在回答前通过 REST API 查询相关记忆。

输入：

- `query`
- `project`
- `type`
- `status`
- `tags`
- `limit`

输出：

- 搜索结果列表。
- 每条结果包含内容片段和元数据。

验收：

- Codex Skill 能指导 Agent 用自然语言查到已保存记忆。
- 返回结果不包含 archived memory，除非显式允许。

### 6.5 `get_project_context`

用途：在一次 AI 编程会话开始时召回某个项目的关键上下文。

输入：

- `project`
- `limit`

输出：

- canonical decisions。
- active preferences。
- active context。
- recent notes。

验收：

- 可以返回某个 project 下的关键记忆。
- 结果按类型分组。
- canonical 和 active 优先。

### 6.6 非 MVP AI 入口

以下能力延后：

- `delete_memory`
- `deprecate_memory`
- `merge_memories`
- `replace_canonical_memory`
- `import_memories`

原因：这些能力会破坏或重写用户数据，第一版先不把高风险操作交给 AI。

## 7. REST API

### 7.1 模块目标

为 Web UI、调试脚本和未来集成提供稳定 API。

### 7.2 MVP Endpoint

- `GET /health`
- `GET /memories`
- `POST /memories`
- `GET /memories/:id`
- `PATCH /memories/:id`
- `POST /memories/:id/archive`
- `POST /search`
- `GET /export`
- `GET /context/:project`

### 7.3 Endpoint 拆解

`GET /health`

- 检查 Worker 是否在线。
- 检查 D1 binding 是否可用。
- 检查 Vectorize binding 是否可用。
- 检查 Workers AI binding 是否可用。

`GET /memories`

- 返回 memory 列表。
- 支持筛选和分页。

`POST /memories`

- 创建 memory。
- 触发 embedding 和索引。
- 返回保存结果和提示。

`GET /memories/:id`

- 返回 memory 详情。

`PATCH /memories/:id`

- 更新 memory。
- 内容变化时触发重新索引。

`POST /memories/:id/archive`

- 归档 memory。
- 默认从搜索和项目上下文中排除。

`POST /search`

- 执行语义搜索。
- 返回可解释结果。

`GET /export`

- 导出用户数据。

`GET /context/:project`

- 返回某个 project 的关键上下文，供 Skill 或 Web UI 使用。

### 7.4 验收要点

- 所有私有 endpoint 都需要认证。
- API 返回结构稳定。
- 错误响应包含清晰 message。
- 保存、搜索、编辑、归档、导出都可以通过 API 完成。

## 8. Web UI

### 8.1 模块目标

提供一个安静、实用的开发者工具界面，让用户可以检查和修正自己的记忆。

### 8.2 页面与功能

#### Memory 列表页

功能点：

- 展示 memory 列表。
- 展示 title、project、type、status、tags、更新时间。
- 支持 project、type、status、tags 筛选。
- 支持进入详情。
- 支持创建新 memory。

#### 搜索页或搜索区域

功能点：

- 输入自然语言 query。
- 展示搜索结果。
- 展示 score 和片段。
- 支持点击进入详情。

#### Memory 详情页

功能点：

- 展示完整内容。
- 展示元数据。
- 展示 embedding/index 状态。
- 展示最近 events。
- 提供编辑入口。
- 提供归档操作。

#### 新增和编辑表单

功能点：

- 编辑 title。
- 编辑 content。
- 编辑 project。
- 选择 type。
- 选择 status。
- 编辑 tags。
- 保存后显示结果和提示。

#### Skill 使用说明页

功能点：

- 展示 REST API endpoint。
- 展示 token 配置方式。
- 展示 Codex Skill 的使用边界。
- 展示保存、搜索、项目上下文召回示例。

### 8.3 UI 非目标

MVP 不做：

- 营销 landing page。
- 复杂 dashboard。
- 知识图谱。
- 时间线视图。
- 富文本编辑器。
- 独立冲突处理面板。

### 8.4 验收要点

- 用户可以在 UI 中创建 memory。
- 用户可以搜索并打开结果。
- 用户可以编辑 memory。
- 用户可以归档 memory。
- 用户可以看到 Skill 使用说明。
- UI 中关键状态不依赖用户猜测。

## 9. 认证与访问控制

### 9.1 模块目标

保护个人记忆数据，确保私有 API、Web UI 操作和 Skill 调用不会被未授权访问。

### 9.2 功能点

- 配置 `AUTH_TOKEN`。
- 校验 bearer token。
- 保护 REST API。
- 保护 Skill 会调用的 REST API。
- 明确 `/health` 是否公开。
- 为 Web UI 提供 token 输入或配置方式。
- 返回统一认证错误。

### 9.3 设计注意点

- MVP 是单用户个人服务，不做账号系统。
- 不做团队权限。
- 不做 OAuth。
- Token 泄露后的处理方式需要写入部署文档。

### 9.4 验收要点

- 未认证请求不能读取或写入 memory。
- 认证失败返回清晰错误。
- Codex Skill 可以指导 Agent 通过 token 访问。
- Web UI 可以完成认证后的操作。

## 10. 数据导出与备份

### 10.1 模块目标

确保用户拥有自己的数据，并能在需要时导出可读 JSON。

### 10.2 功能点

- 导出 memories。
- 导出 memory events。
- 导出 embedding 元数据。
- 不导出向量本身。
- 生成清晰 JSON 结构。

### 10.3 导出内容

建议包含：

- `exported_at`
- `schema_version`
- `memories`
- `memory_events`
- `memory_embeddings`

### 10.4 非目标

MVP 不做 JSON import。

### 10.5 验收要点

- 用户可以下载或复制 JSON。
- JSON 能被人读懂。
- JSON 包含全部 memories。
- JSON 不包含敏感 token。

## 11. 部署、配置与调试

### 11.1 模块目标

让项目可以从空仓库部署到用户自己的 Cloudflare 账户，并能快速验证主链路。

### 11.2 功能点

- 初始化 Wrangler 配置。
- 配置 D1 database。
- 配置 Vectorize index。
- 配置 Workers AI binding。
- 配置 `AUTH_TOKEN` secret。
- 提供本地开发命令。
- 提供 D1 migration 命令。
- 提供部署命令。
- 提供冒烟测试步骤。
- 提供 Codex Skill 使用说明。

### 11.3 调试能力

- `/health` 检查 bindings。
- REST API 返回清晰错误。
- 记录关键请求日志。
- 提供最小测试数据。

### 11.4 验收要点

- `wrangler deploy` 可以成功。
- D1 migration 可以执行。
- 部署后 `/health` 返回正常。
- 部署后能保存一条 memory。
- 部署后能搜索刚保存的 memory。
- Codex Skill 能在真实会话中指导 Agent 调用保存和搜索能力。

## 12. 推荐开发顺序

1. Memory 数据模型
2. REST API 基础框架
3. Memory 创建、列表、详情、编辑、归档
4. Workers AI embedding
5. Vectorize 写入和搜索
6. 语义搜索 API
7. REST `save_memory`
8. REST `search_memory`
9. REST `get_project_context`
10. Web UI 列表、详情、编辑、搜索
11. JSON export
12. 认证与访问控制完善
13. Codex Skill 使用说明
14. 部署文档和冒烟测试

## 13. 后续产物

基于这份模块拆解，下一步可以继续产出：

- `docs/TECHNICAL_DESIGN.md`：技术方案、架构、数据流、接口细节。
- `docs/API_DESIGN.md`：REST API 和 Skill 调用能力的详细输入输出。
- `docs/UI_DESIGN.md`：页面结构、状态、交互流程。
- `docs/TASKS.md`：可执行开发任务清单。
