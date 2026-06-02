# Memo Otter 开放问题

这份清单只保留 MVP 上线前必须回答的问题。已经通过 PRD 评审确定的取舍，不再作为开放问题反复讨论。

## 1. 必须在开发前回答

### 1.1 Codex Skill 使用方式

问题：MVP 的 Codex Skill 应如何指导 Agent 使用 Memo Otter？

需要确认：

- Skill 放在项目仓库内，还是作为本机 Codex skill 安装。
- Skill 调用 REST API 时如何配置 endpoint 和 token。
- 什么时候允许 Agent 保存 memory。
- 什么时候只允许 Agent 生成候选记忆并等待用户确认。

决策影响：

- 影响 onboarding。
- 影响安全边界。
- 影响真实 Codex 会话中的使用体验。

### 1.2 Embedding 模型和 Vectorize 维度

问题：Workers AI 使用哪个 embedding model，Vectorize index 使用多少维？

需要确认：

- 模型名称。
- 输出向量维度。
- Vectorize index 配置。
- 是否需要后续 re-embedding 迁移策略。

决策影响：

- 影响 `wrangler.toml`。
- 影响 migration 和部署文档。
- 影响搜索质量和成本。

### 1.3 认证方式

问题：单一 bearer token 如何保护 REST API、Web UI 和 Skill 调用？

需要确认：

- Web UI 如何输入或保存 token。
- Codex Skill 或 Agent 如何配置 token。
- `/health` 是否需要认证。
- CORS 策略如何处理。

决策影响：

- 影响所有 endpoint。
- 影响 onboarding。
- 影响安全边界。

### 1.4 索引失败处理

问题：D1 写入成功但 Workers AI 或 Vectorize 失败时，memory 处于什么状态？

建议方向：

- D1 保留源数据。
- 增加 `embedding_status` 字段。
- 搜索时跳过未索引内容。
- 提供后续 reindex 命令或 endpoint。

决策影响：

- 影响数据模型。
- 影响错误处理。
- 影响测试用例。

### 1.5 JSON export 内容

问题：MVP 的 JSON export 导出哪些内容？

建议方向：

- 必须导出 memories。
- 可导出 memory_events。
- 不导出向量本身。
- 导出 vector id 和 embedding model 作为索引元数据。

决策影响：

- 影响用户数据可迁移性。
- 影响未来 import 设计。

## 2. 已通过评审确定的决策

- MVP 只使用 Workers AI embedding，不接 OpenAI embedding provider。
- MVP UI 和 REST API 放在同一个 Worker。
- MVP project 使用自由文本，不做独立项目实体。
- MVP 不自动删除、覆盖或合并 canonical 记忆。
- MVP 默认排除 archived memory。
- MVP 不做 Markdown 文件夹同步。
- MVP 不做浏览器扩展、Obsidian 插件、移动端、多用户协作。
- MVP 不实现 MCP endpoint。
- MVP 不实现 Hooks 自动捕捉。

## 3. 延后到 MVP 后的问题

- 是否支持 OpenAI、本地模型或其他 embedding provider。
- 是否引入独立 project 实体。
- 是否支持 deprecated 状态和 supersedes 关系。
- 是否支持 JSON import。
- 是否支持自动冲突判断和手动 merge UI。
- 是否支持 Markdown 文件夹同步。
- 是否支持浏览器 capture。
- 是否支持时间线和知识图谱。
- 是否实现 MCP endpoint 和 MCP tools。
- 是否实现 Hooks 自动生成候选记忆。
