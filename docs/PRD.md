# Memo Otter 产品需求文档

## 1. 产品概述

Memo Otter 是一个部署在 Cloudflare 上的个人 AI 记忆服务，面向经常使用 Codex、Cursor、Claude、ChatGPT 等 AI 工具的独立开发者。

它帮助用户把项目决策、个人偏好、技术上下文、学习笔记、Prompt 模板和想法碎片保存到一个由自己拥有的记忆库里，然后通过 MCP 或 Web UI 在不同 AI 工具中召回这些上下文。

这个项目不以商业盈利为主要目标。它的核心目标是：

- 做出一个自己真的会用的个人 AI 基础设施。
- 学习 MCP、Cloudflare Workers、D1、Vectorize、Workers AI、语义检索、记忆冲突处理等 AI 应用开发能力。
- 形成一个足够小、足够清晰、足够可迭代的开源项目。

## 2. 背景与竞品分析

### 2.1 灵感来源：Second Brain for AI

Second Brain for AI 是一个开源 AI 记忆层，定位是让 Claude、ChatGPT、Cursor 和其他 MCP 客户端共享同一份长期记忆。它的核心卖点是：用户只需要保存一次上下文，之后可以在多个 AI 工具中召回。

公开参考：

- Product Hunt 2026-05-31 日榜：https://www.producthunt.com/leaderboard/daily/2026/5/31
- Product Hunt 产品页：https://www.producthunt.com/products/second-brain-cloudflare
- GitHub 仓库：https://github.com/rahilp/second-brain-cloudflare

### 2.2 Second Brain for AI 做得好的地方

Second Brain for AI 解决的是一个真实问题：AI 工具很多，但上下文不能自然流动。用户在 Claude、ChatGPT、Cursor、终端、浏览器和手机之间切换时，经常需要重复解释自己的项目背景、偏好和决策。

它值得借鉴的地方包括：

- 把记忆当成用户拥有的基础设施，而不是某个平台内部的聊天历史。
- 通过 MCP 暴露记忆能力，让 AI 在对话中直接调用，而不是让用户手动复制笔记。
- 支持语义召回，而不是只做关键词搜索。
- 有多个低摩擦录入入口，包括 CLI、Obsidian、iOS Shortcuts、浏览器扩展、bookmarklet 和 Web UI。
- 把 `remember`、`append`、`update`、`recall`、`forget` 作为一等能力，而不只是简单新增和搜索。
- 做了重复检测、矛盾检测、智能合并、重要性评分和召回次数统计。
- 对长内容进行分块，并保存精确的 vector id，方便后续重建索引和安全删除。

### 2.3 Second Brain for AI 的技术架构观察

Second Brain for AI 的主体是一个 Cloudflare Worker：

- D1 作为源数据库。
- Vectorize 作为语义索引。
- Workers AI 用于 embedding 和部分 LLM 判断。
- `/mcp` 作为 MCP endpoint。
- REST API 支持 capture、append、update、list、count、tags、stats、chat 等能力。
- Worker 同时可以托管静态 Web UI。

它的数据模型比较克制，核心表 `entries` 主要包含：

- `id`
- `content`
- `tags`
- `source`
- `created_at`
- `vector_ids`
- `recall_count`
- `importance_score`

它的 MCP 工具包括：

- `remember`
- `append`
- `update`
- `recall`
- `list_recent`
- `forget`

它的写入流程不是简单插入，而是包含：

- 提取 hashtag。
- 对内容样本生成 embedding。
- 查询相似记忆。
- 对高度重复内容进行阻止。
- 对相似内容打标。
- 使用 LLM 判断是否存在矛盾。
- 使用 LLM 判断应该替换、合并还是保留两条。
- 写入 D1。
- 写入一个或多个 Vectorize 向量。
- 异步计算长期重要性。

它的召回流程包含：

- 解析类似 today、last week 这样的时间表达。
- 对 query 生成 embedding。
- 查询 Vectorize。
- 通过 D1 做标签过滤。
- 按时间衰减和召回频次重新排序。
- 按父记忆去重。
- 增加 recall count。
- 在多条结果时生成简短 insight。
- 在结果足够多时尝试提取 recurring pattern，并保存为 `auto-pattern`。

### 2.4 Memo Otter 的差异化方向

Memo Otter 可以借鉴 Second Brain 的 Cloudflare 架构和 MCP 思路，但不应该一开始就复制它的全部复杂度。

Memo Otter 的第一阶段重点应该是：

- Cloudflare-first：默认部署到用户自己的 Cloudflare 账户。
- 学习友好：每个模块都尽量清楚，适合独立开发者理解和改造。
- 记忆状态明确：第一版区分 draft、active、canonical、archived。
- 冲突处理可解释：第一版只提示疑似重复或冲突，不自动替换。
- 先把核心闭环做好：保存、搜索、MCP 调用、Web UI 管理。

第一版不急着做：

- 浏览器扩展。
- Obsidian 插件。
- iOS Shortcuts。
- 多用户协作。
- 复杂移动端体验。
- 完全自动化的记忆提取。

## 3. 产品愿景

Memo Otter 希望成为独立开发者自己的 AI 记忆层。

它应该像：

- 一个部署在 Cloudflare 上、由用户自己拥有的个人记忆服务。
- 一个面向项目、偏好和决策的语义搜索引擎。
- 一个能被 AI 工具随时调用的 MCP Server。
- 一个学习 AI-native 应用开发的实验场。

它不应该像：

- 企业知识库。
- 商业化 SaaS 平台。
- 通用书签管理器。
- 不可解释的黑盒记忆系统。
- 复杂的团队协作产品。

## 4. 目标用户

### 4.1 主要用户

Memo Otter 的主要用户是独立开发者，通常具备以下特征：

- 经常使用 Codex、Cursor、Claude、ChatGPT 或个人 Agent。
- 同时维护多个小项目或实验项目。
- 经常向 AI 重复解释项目背景、技术栈、决策和偏好。
- 希望通过一个真实项目学习 AI 应用架构。
- 重视用户自有基础设施、低成本自托管和可读数据。
- 不需要团队协作、计费、权限系统和企业功能。

### 4.2 次要用户

Memo Otter 也适合技术写作者、产品爱好者和个人知识管理玩家，用来保存：

- 文章选题。
- 产品分析。
- 阅读笔记。
- Prompt 模板。
- 个人偏好。
- 项目背景。

## 5. 问题定义

AI 工具在单次对话中很强，但跨工具、跨日期、跨项目时容易失去上下文。用户经常需要反复解释：

- 这个项目是做什么的。
- 项目使用什么技术栈。
- 已经做过哪些架构决策。
- 自己偏好什么代码风格或文档风格。
- 当前有哪些约束。
- 哪些想法仍然有效，哪些已经过时。

平台内置记忆通常绑定在单一产品里，不容易检查、导出或版本化。普通笔记软件虽然可读，但 AI 工具无法在需要时自然调用。

Memo Otter 要解决的核心问题是：让个人上下文既能被人编辑，又能被 AI 工具可靠召回。

## 6. 目标与非目标

### 6.1 产品目标

- 提供一个部署在 Cloudflare 上、由用户自己拥有的 AI 记忆服务。
- 通过 MCP 暴露记忆操作能力。
- 提供简单 Web UI，用于浏览、搜索、编辑和检查冲突提示。
- 支持带元数据的语义召回。
- 帮助用户学习 Cloudflare Workers、D1、Vectorize、Workers AI 和 MCP。
- 显式管理记忆状态：MVP 支持 draft、active、canonical、archived。
- 支持安全的记忆演化：MVP 先支持 create、update、archive，append、replace、merge、deprecate、delete 延后。

### 6.2 MVP 非目标

- 团队协作。
- 商业化 SaaS。
- 本地桌面应用作为主要产品形态。
- 浏览器扩展。
- Obsidian 插件。
- 移动端 App。
- 复杂权限系统。
- 多用户同步。
- 自动从每次聊天中后台提取记忆。
- 在用户不可见的情况下自动删除或覆盖记忆。

## 7. 核心使用场景

### 7.1 项目上下文召回

用户开始一次 AI 编程会话，问：

```text
关于 memo-otter，你需要知道什么？
```

Memo Otter 返回：

- 项目目标。
- 当前技术栈。
- 活跃约束。
- 最近的架构决策。
- 相关 todo 或开放问题。

### 7.2 决策记忆

用户做出决策：

```text
MVP 阶段部署到 Cloudflare Workers，D1 作为源数据库，Vectorize 做语义检索，Workers AI 做 embedding。
```

Memo Otter 将它保存为 `memo-otter` 项目下的 canonical decision，并添加 `architecture`、`mvp` 标签。

之后用户问：

```text
为什么 MVP 选择 Cloudflare？
```

Memo Otter 能召回这条决策，并展示创建时间、标签、状态和来源。

### 7.3 个人偏好记忆

用户保存：

```text
我喜欢 PRD 写得具体、贴近实现，不喜欢太企业流程化的套话。
```

Memo Otter 将它标记为 `preference` 类型。

以后 AI 在帮用户写文档时，可以先查询偏好并调整输出风格。

### 7.4 学习笔记

用户学习了 MCP、embedding 或 Vectorize 的某个知识点。

Memo Otter 将它保存为学习笔记，并关联主题标签。

之后用户问：

```text
我之前关于 MCP Server 学过哪些东西？
```

Memo Otter 返回相关笔记，并可以进一步组织成简短学习总结。

### 7.5 记忆冲突

用户保存：

```text
Memo Otter 的 MVP 应该使用本地 SQLite。
```

但已有 canonical 记忆写着：

```text
Memo Otter 的 MVP 使用 Cloudflare D1。
```

Memo Otter 应该提示冲突，并让用户选择：

- 保留两条。
- 将新记忆标记为 draft。
- 暂不处理，先进入 Web UI 人工检查。

用新记忆替换旧记忆、将旧记忆标记为 deprecated、手动 merge 等能力不进入 MVP。

### 7.6 AI 工具集成

在 MCP 兼容客户端中，AI 可以调用：

- `save_memory`
- `search_memory`
- `get_project_context`

删除、废弃、覆盖 canonical 记忆等高风险操作不进入 MVP MCP 工具。第一版优先确保 AI 能保存、搜索和召回项目上下文。

## 8. MVP 范围

经过 PRD 评审后，Memo Otter 的 MVP 收敛为一个最小可用闭环：

```text
保存记忆 -> 生成 embedding -> 写入 D1 和 Vectorize -> 搜索召回 -> 通过 MCP 给 AI 工具使用 -> 在 Web UI 中检查和修正
```

MVP 的完整边界见：[MVP 范围](./MVP_SCOPE.md)。

### 8.1 功能需求

#### 记忆 CRUD

- 创建记忆，字段包括标题、内容、项目、标签、类型、状态、来源。
- 查看记忆详情。
- 编辑记忆标题、内容、标签、类型、项目和状态。
- 归档记忆，并要求确认。
- 查看最近记忆列表。
- 导出 JSON 备份。

#### 记忆类型

MVP 支持以下类型：

- `decision`：影响未来工作的决策。
- `preference`：长期有效的用户偏好。
- `context`：项目或个人背景。
- `note`：一般笔记或学习笔记。

`task` 类型延后，避免第一版变成任务管理系统。

#### 记忆状态

MVP 支持以下状态：

- `draft`：有价值，但尚未确认。
- `active`：当前有用。
- `canonical`：权威记忆，优先级最高。
- `archived`：保留历史，默认不参与召回。

`deprecated`、`supersedes` 和完整记忆演化关系延后到 MVP 后。

#### 语义搜索

- 支持自然语言搜索记忆。
- 返回排序后的结果，包含分数、标题、状态、类型、项目、标签和摘要片段。
- 默认排除 archived 记忆。
- 支持按项目、状态、类型和标签过滤。

#### MCP Server

MVP 暴露以下 MCP 工具：

- `save_memory`
- `search_memory`
- `get_project_context`

删除、废弃、合并、替换 canonical 记忆等高风险能力不进入第一版 MCP 工具。第一版中这些操作应留在 Web UI 或 REST API 中，由用户明确触发。

#### Web UI

MVP Web UI 包含：

- 记忆列表。
- 搜索框。
- 项目筛选。
- 标签筛选。
- 状态筛选。
- 记忆编辑器。
- 归档操作。
- MCP 连接说明。

冲突处理面板、复杂统计和 dashboard 延后。

#### 冲突与重复处理

MVP 做一个简单版本：

- 如果语义相似度很高，标记为疑似重复。
- 如果新记忆和同项目、同类型的 canonical 记忆可能冲突，提示用户。
- MVP 不自动删除或自动替换。
- 用户可以先保存为 draft，再通过编辑或归档手动处理。

手动 merge、废弃旧记忆、替换 canonical 记忆延后。

#### 数据存储

MVP 使用 Cloudflare 托管资源：

- Cloudflare D1 作为源数据库。
- Cloudflare Vectorize 作为语义索引。
- Workers AI 作为默认 embedding provider。
- 保存 vector id，用于安全重建索引和后续归档清理。
- 支持 JSON export，方便备份。

JSON import 延后。

### 8.2 非功能需求

- Cloudflare-first：应用默认部署为 Worker 支撑的个人服务。
- 可检查：数据库 schema 对独立开发者来说应当容易理解。
- 可迁移：用户数据应当可以导出。
- 安全：破坏性操作必须来自明确用户意图。
- 性能：个人规模下，几千条记忆的搜索应当足够快。
- 可测试：记忆生命周期和搜索行为应有聚焦测试。
- 可扩展：未来增加插件和入口时，不需要重写核心记忆模型。

## 9. 技术方向

### 9.1 推荐 MVP 技术栈

因为项目目标是学习和独立开发，推荐采用 Cloudflare 原生 TypeScript 技术栈：

- 运行环境：Cloudflare Workers。
- 包管理器：pnpm。
- MCP：官方 TypeScript MCP SDK。
- API：Worker fetch handler、Hono，或在 MCP 路由需要时考虑 Cloudflare Agents SDK。
- 数据库：Cloudflare D1。
- SQL 层：Drizzle 或直接 SQL。
- Embedding：默认使用 Workers AI，并预留 provider 抽象。
- 语义检索：Cloudflare Vectorize。
- UI：Worker 托管静态资源，或小型 Vite + React 应用随 Worker 部署。
- 鉴权：MVP 使用单一 bearer token。
- 本地开发：使用 Wrangler，并尽量利用本地 D1/Vectorize 开发能力。
- 测试：Vitest。

### 9.2 Cloudflare 部署要求

MVP 应部署到用户自己的 Cloudflare 账户。

所需 Cloudflare 资源：

- Worker：提供 REST API、MCP endpoint，并可选托管静态 UI。
- D1 database：保存记忆、事件、标签和项目元数据。
- Vectorize index：保存 embedding，用于语义召回。
- Workers AI binding：生成 embedding。
- Secret `AUTH_TOKEN`：保护私有 API 和 MCP 访问。

推荐 endpoint：

- `/mcp`：AI 客户端使用的 MCP endpoint。
- `/search`：供 UI 和调试使用的搜索 endpoint。
- `/memories`：记忆列表、创建、查看、更新、归档。
- `/export`：导出 JSON 备份。
- `/health`：部署和 binding 检查。

部署验收标准：

- `wrangler deploy` 可以成功发布 Worker。
- D1 migration 可以通过一条明确命令执行。
- `wrangler.toml` 中记录 Vectorize index 名称和维度。
- 新部署实例可以保存一条记忆、语义搜索到它，并通过 MCP 返回它。
- 私有 endpoint 会拒绝未认证请求。
- 用户不需要进入 Cloudflare Dashboard，也能导出记忆数据。

### 9.3 初始数据模型

`memories`

- `id`
- `title`
- `content`
- `project`
- `type`
- `status`
- `tags_json`
- `source`
- `created_at`
- `updated_at`
- `archived_at`
- `embedding_status`
- `metadata_json`

`memory_embeddings`

- `id`
- `memory_id`
- `chunk_index`
- `content_hash`
- `embedding_model`
- `vector_id`
- `created_at`

`memory_events`

- `id`
- `memory_id`
- `event_type`
- `before_json`
- `after_json`
- `created_at`
- `source`

`memory_events` 很重要。它让记忆变化可审计，也能帮助开发者理解“记忆不是静态笔记，而是会演化的上下文”。

MVP 阶段只需要记录 create、update、archive、export 等轻量事件，不做完整审计后台。

### 9.4 检索策略

MVP 的检索排序结合：

- 语义相似度。
- 状态权重：canonical > active > draft，archived 默认排除。
- 类型权重：preference 和 decision 通常应高于普通 note。
- 项目过滤。
- 轻量 recency tie-breaker。

第一版不建议做太强的时间衰减。决策和偏好可能很旧，但依然重要，不应因为时间久就被埋掉。

### 9.5 MCP 工具设计

`save_memory`

- 输入：title、content、project、type、status、tags、source。
- 行为：保存记忆，生成 embedding，返回 ID 和重复/冲突提醒。

`search_memory`

- 输入：query、project、type、status、tags、limit。
- 行为：返回带元数据和摘要的排序结果。

`get_project_context`

- 输入：project、limit。
- 行为：按类型分组返回 canonical 和 active 记忆。

`list_recent_memories`、`update_memory`、`deprecate_memory`、`delete_memory` 不进入 MVP MCP 工具，延后到用户对高风险操作边界更清楚之后再加入。

## 10. 用户体验原则

- 记忆状态必须可见。
- 优先让用户审阅，而不是让 AI 静默自动处理。
- UI 应安静、实用，偏开发者工具，而不是营销页。
- 搜索结果要像证据，而不是魔法答案。
- 每条记忆都应该容易编辑。
- 即使 MCP 尚未配置，用户也能在 Web UI 中复制项目上下文。
- Onboarding 要短：创建第一条记忆、搜索它、连接 MCP。

## 11. 成功指标

因为项目不以盈利为目标，成功指标应围绕实用性和学习效果：

- 用户可以把 Memo Otter 连接到至少一个 MCP 客户端。
- 用户可以在一分钟内保存并召回项目上下文。
- 用户在至少三次真实编程会话中使用它。
- 用户可以理解 D1 schema 和导出的记忆数据。
- 用户能够解释 MCP tools、Cloudflare Workers、D1、Vectorize、Workers AI、embedding、向量检索和记忆冲突处理。
- MVP 阶段至少能在真实会话中稳定保存和召回 3 条 Memo Otter 项目记忆。
- 当积累足够记忆后，再用常见个人/项目查询的有效召回率作为质量指标。

## 12. 里程碑

### Milestone 0：仓库基础

- 添加 README。
- 添加本 PRD。
- 确认技术栈。
- 添加基础项目结构。
- 添加开发脚本。

### Milestone 1：Cloudflare 记忆核心

- 搭建 Wrangler 项目。
- 设计 D1 schema。
- 实现 create/list/detail/update/archive memory。
- 实现轻量 memory event log。
- 添加用于手动测试的基础 REST endpoint。

### Milestone 2：语义搜索

- 添加轻量 embedding 调用边界。
- 实现文本分块。
- 实现 Vectorize 插入和重新索引。
- 实现带过滤条件的搜索。
- 实现疑似重复检测。

### Milestone 3：MCP Server

- 实现 MCP tools。
- 部署 `/mcp` endpoint。
- 连接一个 MCP 兼容客户端。
- 添加 `save_memory`、`search_memory`、`get_project_context` 示例。

### Milestone 4：Web UI

- 记忆列表。
- 搜索。
- 筛选。
- 编辑器。
- 归档。
- MCP 连接说明。

### Milestone 5：记忆质量

- 状态权重排序。
- 疑似重复提示。
- Export。
- 项目上下文摘要。

### Milestone 6：可选扩展

- 浏览器 capture。
- Markdown 文件夹同步。
- Obsidian 集成。
- 本地 embedding model 支持。
- 本地备份/import helper。
- 时间线和知识图谱视图。

## 13. 主要风险

### 13.1 记忆变成杂物堆

缓解方式：

- 显式区分状态。
- 加入 review 流程。
- 将 canonical 记忆和 draft 记忆区分开。
- 后续增加 memory cleanup 视图。

### 13.2 检索结果不可信

缓解方式：

- 展示 score、project、type、status、tags、source。
- 允许用户检查和编辑召回的记忆。
- 避免隐藏式重写。

### 13.3 范围膨胀成完整笔记软件

缓解方式：

- 聚焦 AI 有用的长期上下文，而不是通用笔记管理。
- 暂缓富文本、文件夹、双链、发布等能力。

### 13.4 MCP 调试困难

缓解方式：

- 增加 debug REST endpoint。
- 在开发环境中记录清晰请求日志。
- 提供示例 tool call。

### 13.5 Embedding provider 锁定

缓解方式：

- 从一开始设计 embedding provider interface。
- 每条 embedding 记录 `embedding_model`。
- 支持后续 re-embedding。

### 13.6 Cloudflare 平台耦合

缓解方式：

- 领域逻辑和 Worker request handler 分离。
- D1 SQL 使用明确 migration 管理。
- 支持导出 memories 和 events 的 JSON。
- 把 Vectorize 视为可替换索引，而不是源数据。

## 14. 开放问题

MVP 上线前必须回答的问题见：[开放问题](./OPEN_QUESTIONS.md)。

已通过 PRD 评审确定：

- 第一版只使用 Workers AI embedding，不接 OpenAI embedding provider。
- UI 和 MCP Server 放在同一个 Worker。
- project 使用自由文本，不做独立管理实体。
- 不自动删除、覆盖或合并 canonical 记忆。
- archived 记忆默认不参与搜索。
- Markdown 文件夹同步延后。
- 浏览器扩展、Obsidian 插件、移动端、多用户协作均不进入第一版。

延后需求清单见：[延后需求](./DEFERRED_REQUIREMENTS.md)。

## 15. 推荐下一步

先做最小可用闭环：

1. 用 Wrangler 搭建 Cloudflare Worker。
2. 在 D1 中保存一条 memory。
3. 用 Workers AI 生成 embedding。
4. 把向量插入 Vectorize，并能搜索回来。
5. 通过 MCP 暴露 `save_memory` 和 `search_memory`。
6. 部署到 Cloudflare，并在一次真实 AI 编程会话中使用。

第一版应该先让 Memo Otter 记住 Memo Otter 自己的开发决策。它不需要一开始记住全世界，先记住自己的来路就够了。

PRD 之后的完整开发流程见：[Memo Otter 开发流程](./DEVELOPMENT_PROCESS.md)。

本轮 PRD 评审记录见：[PRD 评审记录](./PRD_REVIEW.md)。
