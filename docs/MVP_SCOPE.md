# Memo Otter MVP 范围

Memo Otter MVP 的目标是打通个人 AI 记忆服务的最小可用闭环：

```text
保存记忆 -> 生成 embedding -> 写入 D1 和 Vectorize -> 搜索召回 -> 通过 REST API / Codex Skill 给 AI 工作流使用 -> 在 Web UI 中检查和修正
```

第一版不追求完整知识库体验，也不追求复杂自动化记忆治理。它只需要证明一件事：Memo Otter 能在真实 AI 编程会话中保存和召回有用上下文。

MVP 入口策略：

- REST API 是核心能力入口。
- Web UI 是人工检查和修正入口。
- Codex Skill 是第一版 AI 使用入口，用来指导 Agent 何时调用 REST API 保存、搜索和获取项目上下文。
- MCP 作为 MVP+ 的跨工具标准接口延后。
- Hooks 作为 Post-MVP 的自动候选记忆入口延后。

## 1. MVP 目标

- 用户可以把 Memo Otter 部署到自己的 Cloudflare 账户。
- 用户可以通过 Web UI 保存、搜索、编辑和归档记忆。
- 用户可以通过 Codex Skill 指导 Agent 调用 REST API 保存和搜索记忆。
- 用户可以在 AI 编程会话中召回某个项目的关键上下文。
- 用户可以导出自己的记忆数据。

## 2. MVP 内功能

### 2.1 Memory 基础管理

- 创建 memory。
- 查看 memory 列表。
- 查看 memory 详情。
- 编辑 memory。
- 归档 memory。
- 导出 memories JSON。

Memory 字段：

- `id`
- `title`
- `content`
- `project`
- `type`
- `status`
- `tags`
- `source`
- `created_at`
- `updated_at`
- `archived_at`
- `metadata`

### 2.2 Memory 类型

MVP 支持：

- `decision`：影响未来工作的决策。
- `preference`：长期有效的用户偏好。
- `context`：项目或个人背景。
- `note`：一般笔记或学习笔记。

`task` 延后。第一版避免把 Memo Otter 做成任务管理系统。

### 2.3 Memory 状态

MVP 支持：

- `draft`：有价值，但尚未确认。
- `active`：当前有用。
- `canonical`：权威记忆，优先参与召回。
- `archived`：已归档，默认不参与召回。

`deprecated` 延后到记忆演化流程更清楚之后再做。第一版可以先用 `archived` 表示“不再默认召回”。

### 2.4 语义搜索

- 支持自然语言搜索。
- 支持按 project、type、status、tags 过滤。
- 默认排除 archived memory。
- 搜索结果展示 title、content 片段、project、type、status、tags、score。

### 2.5 AI 入口

MVP 提供 Codex Skill 使用说明，指导 Agent 使用 REST API 完成：

- `save_memory`
- `search_memory`
- `get_project_context`

这里的 `save_memory`、`search_memory`、`get_project_context` 是产品能力名，不要求第一版实现为 MCP tools。第一版通过 REST API 和 Skill 工作流完成。

暂不通过 AI 入口暴露删除、废弃、合并类高风险操作。第一版中这些操作只在 Web UI 或 REST API 中处理，并要求明确用户意图。

### 2.6 REST API

MVP REST API：

- `GET /health`
- `GET /memories`
- `POST /memories`
- `GET /memories/:id`
- `PATCH /memories/:id`
- `POST /memories/:id/archive`
- `POST /search`
- `GET /export`
- `GET /context/:project`

### 2.7 Web UI

MVP Web UI：

- Memory 列表。
- 搜索输入框。
- project、type、status、tags 基础筛选。
- Memory 详情。
- 新增和编辑表单。
- 归档按钮。
- Skill 使用说明。

不做独立冲突处理面板，不做复杂统计 dashboard。

### 2.8 数据和索引

- D1 是源数据库。
- Vectorize 是可重建语义索引。
- Workers AI 是唯一默认 embedding provider。
- 保存 embedding model 和 vector id。
- 内容变化后重新生成 embedding。
- Vectorize 写入失败时，memory 仍保留在 D1，并标记索引状态。

## 3. MVP 外功能

以下功能不进入第一版：

- 浏览器扩展。
- Obsidian 插件。
- iOS Shortcuts。
- Markdown 文件夹同步。
- 移动端 App。
- 多用户协作。
- 项目实体管理。
- 复杂权限系统。
- 完整任务管理。
- 自动从聊天记录中提取记忆。
- 自动合并记忆。
- 自动覆盖 canonical 记忆。
- 冲突处理面板。
- 知识图谱。
- 时间线视图。
- 富文本编辑器。
- JSON import。
- 多 embedding provider。
- 本地 embedding model。
- MCP endpoint。
- Hooks 自动捕捉。

## 4. MVP 验收标准

MVP 完成必须满足：

- 可以通过 `wrangler deploy` 部署到 Cloudflare。
- 未认证请求会被拒绝。
- 可以在 Web UI 新增一条 memory。
- 新增 memory 后 D1 中有源数据。
- 新增 memory 后 Vectorize 中有对应向量。
- 可以通过自然语言搜索召回刚保存的 memory。
- 可以通过 REST API 保存 memory。
- 可以通过 REST API 搜索 memory。
- 可以通过 REST API 获取某个项目的上下文。
- 可以通过 Codex Skill 指导 Agent 完成保存、搜索和项目上下文召回。
- archived memory 默认不会出现在搜索结果中。
- 可以导出 JSON 数据。
- README 或部署文档能让用户从空仓库完成部署。

## 5. 第一轮推荐开发顺序

1. 初始化 Cloudflare Worker 项目。
2. 配置 D1 migration。
3. 实现 Memory 数据模型。
4. 实现 REST 创建、列表、详情、编辑、归档。
5. 接入 Workers AI embedding。
6. 接入 Vectorize 写入和搜索。
7. 实现 REST `save_memory`、`search_memory`、`get_project_context` 对应能力。
8. 实现最小 Web UI。
9. 实现 JSON export。
10. 编写 Codex Skill 使用说明并完成真实 Codex 会话冒烟测试。
