# Memo Otter 文档口径基准

更新时间：2026-06-02

这份文档记录当前所有产品、设计、技术和测试文档采用的统一口径。后续新增或修改文档时，应优先与本基准保持一致。

## 1. 当前 MVP 定义

Memo Otter MVP 是一个个人 AI 记忆服务的最小可用闭环：

```text
保存记忆 -> 生成 embedding -> 写入 D1 和 Vectorize -> 搜索召回 -> 通过 REST API / Codex Skill 给 AI 工作流使用 -> 在 Web UI 中检查和修正
```

## 2. 入口策略

MVP 内：

- REST API：核心能力入口。
- Web UI：人工检查、编辑、归档和导出入口。
- Codex Skill：第一版 AI 使用入口，指导 Agent 调用 REST API。

MVP 外：

- MCP：延后到 MVP+，用于跨工具标准接口。
- Hooks：延后到 Post-MVP，用于自动生成候选记忆。

## 3. MVP 内功能

- 创建 memory。
- 查看 memory 列表。
- 查看 memory 详情。
- 编辑 memory。
- 归档 memory。
- 语义搜索 memory。
- 获取 project context。
- 导出 JSON。
- Codex Skill 使用说明。

## 4. MVP 外功能

- MCP endpoint。
- MCP tools。
- Hooks 自动捕捉。
- JSON import。
- deprecated 状态。
- supersedes 关系。
- 自动合并。
- 自动覆盖 canonical memory。
- 浏览器扩展。
- Obsidian 插件。
- 移动端 App。
- 多用户协作。
- 知识图谱。
- 时间线。
- 富文本编辑器。

## 5. 技术口径

- Cloudflare Workers 是运行平台。
- D1 是源数据库。
- Vectorize 是可重建语义索引。
- Workers AI 是 MVP 唯一 embedding provider。
- Web UI 和 REST API 部署在同一个 Worker。
- MVP 使用单一 `AUTH_TOKEN` 保护私有 API。
- MVP 不实现 `/mcp`。
- MVP 使用 `GET /context/:project` 提供项目上下文。

## 6. 数据口径

Memory 生命周期：

- `long_term`
- `short_term`

Memory 内置建议类型：

- `decision`
- `preference`
- `context`
- `note`

`type` 允许用户自定义，D1 中先作为非空字符串保存。

Memory 状态：

- `draft`
- `active`
- `canonical`
- `archived`

Embedding 状态：

- `pending`
- `indexed`
- `failed`
- `stale`

## 7. 设计口径

- 界面是独立开发者工作台，不是营销页。
- 页面入口是 Memories、Search、New Memory、Skill Setup、Export。
- 搜索结果必须展示可检查的来源和元数据。
- archived memory 默认不参与召回。
- 高风险操作不交给 AI 自动执行。

## 8. 测试口径

MVP 必测：

- REST API 主链路。
- Web UI 主流程。
- D1 源数据保存。
- Workers AI embedding。
- Vectorize 写入和搜索。
- `GET /context/:project`。
- Codex Skill 真实会话调用。
- 认证。
- JSON export。
- Cloudflare 部署后冒烟测试。

MVP 不测：

- MCP endpoint。
- Hooks 自动捕捉。
- JSON import。
- 多用户协作。
- 多 provider。

## 9. 文档优先级

如果文档之间出现冲突，按以下顺序校准：

1. `docs/DOCUMENTATION_ALIGNMENT.md`
2. `docs/MVP_SCOPE.md`
3. `docs/PRD.md`
4. `docs/TECHNICAL_DESIGN.md`
5. `docs/FUNCTIONAL_MODULES.md`
6. `docs/INTERACTION_DESIGN.md`
7. `docs/TEST_PLAN.md`
8. `docs/DEFERRED_REQUIREMENTS.md`
9. `docs/OPEN_QUESTIONS.md`
10. `docs/PRD_REVIEW.md`
11. `docs/DEVELOPMENT_PROCESS.md`
