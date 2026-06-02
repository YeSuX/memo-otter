# Memo Otter 开发流程

这份文档描述 Memo Otter 在 PRD 梳理完成后的正常软件开发流程。它的目标是把产品需求逐步转化为可设计、可开发、可测试、可上线的任务。

当前阶段建议遵循：

```text
PRD 评审 -> 需求拆解 -> 原型与交互 -> 技术方案 -> 排期与任务 -> 开发 -> 测试 -> 验收 -> 上线与复盘
```

## 1. PRD 评审

PRD 写完后，先做一次需求评审，确认大家对产品目标、功能范围和优先级的理解一致。

评审重点：

- 产品目标是否清楚。
- MVP 范围是否足够小。
- 核心用户场景是否完整。
- 功能边界是否明确。
- 非目标是否被严格遵守。
- 是否存在互相冲突的需求。
- 是否存在技术成本明显过高的需求。
- 是否有必须上线前解决的开放问题。

Memo Otter 当前重点是先完成个人 AI 记忆服务的最小闭环，不要在第一版加入浏览器扩展、Obsidian 插件、移动端、多用户协作等能力。

输出物：

- 更新后的 PRD。
- 明确的 MVP 范围。
- 开放问题清单。
- 延后需求清单。

## 2. 需求拆解

评审完成后，把 PRD 拆成可以进入设计和开发的功能模块。

建议先拆成这些模块：

- Memory 数据模型。
- Memory 写入。
- Memory 搜索。
- Memory 状态管理。
- REST API。
- Codex Skill 使用说明。
- Web UI。
- Cloudflare 部署。
- 数据迁移与初始化。
- 调试与日志。

每个模块继续拆成具体功能点。例如 Memory 写入可以拆成：

- 创建 memory。
- 保存 project、type、status、tags、source 等元数据。
- 生成 embedding。
- 写入 D1。
- 写入 Vectorize。
- 返回可读结果。
- 处理失败和重试。

输出物：

- 功能清单。
- 页面清单。
- API 清单。
- 数据实体清单。
- MVP 任务清单。

## 3. 原型与交互设计

在正式开发 Web UI 前，先明确主要页面和操作路径。Memo Otter 的 UI 不需要复杂，但要让用户能检查、编辑和理解自己的记忆。

MVP 页面建议：

- Memory 列表页。
- Memory 搜索页。
- Memory 详情页。
- Memory 新增和编辑页。
- Skill 使用说明页。
- 部署和连接说明页。

每个页面至少定义：

- 页面目标。
- 核心操作。
- 主要字段。
- 空状态。
- 加载状态。
- 错误状态。
- 成功反馈。

输出物：

- 页面结构图。
- 用户流程图。
- 低保真原型或简单设计稿。
- 关键状态说明。

## 4. 技术方案设计

技术方案需要回答“怎么做”，并提前暴露风险。

Memo Otter 的 MVP 技术方案建议覆盖：

- Cloudflare Worker 项目结构。
- D1 表结构和 migration。
- Vectorize 索引结构。
- Workers AI embedding 调用方式。
- Memory 领域模型。
- REST API 路由设计。
- Codex Skill 使用流程。
- Web UI 技术栈。
- 本地开发和调试方式。
- 部署流程。
- 错误处理和日志策略。
- 后续替换 embedding provider 的接口边界。

建议优先设计这些接口：

- `save_memory`
- `search_memory`
- `list_memories`
- `get_memory`
- `update_memory`
- `delete_memory`

输出物：

- 技术方案文档。
- 数据库 schema 草案。
- API 草案。
- Skill 使用说明草案。
- 风险和取舍说明。

## 5. 工作量评估与排期

技术方案确定后，把功能拆成可执行任务，并排出开发顺序。

建议按照最小闭环优先：

1. 搭建 Cloudflare Worker。
2. 配置 D1、Vectorize、Workers AI。
3. 实现 memory 基础表结构。
4. 实现保存 memory。
5. 实现 embedding 生成和向量写入。
6. 实现搜索 memory。
7. 实现 REST `save_memory`、`search_memory` 和 `get_project_context` 对应能力。
8. 实现最小 Web UI。
9. 部署到 Cloudflare。
10. 在真实 AI 编程会话中验证。

任务拆分原则：

- 每个任务应该能独立完成和验收。
- 每个任务都要有明确完成标准。
- 优先完成能打通主流程的任务。
- 延后锦上添花的功能。
- 风险高的技术点尽早验证。

输出物：

- Issue 或任务列表。
- MVP 里程碑。
- 开发顺序。
- 风险验证任务。

## 6. 测试方案

测试方案要在开发前就想清楚，避免写完后才发现不知道如何验收。

MVP 测试重点：

- Memory 能否正确保存到 D1。
- Embedding 是否能生成。
- Vectorize 是否能写入和搜索。
- REST API 是否返回稳定结构。
- Codex Skill 是否能指导 Agent 调用 REST API。
- Web UI 是否能完成浏览、搜索、编辑。
- 失败时是否有清楚错误信息。
- 部署后环境变量和绑定是否正确。

建议准备的测试类型：

- 单元测试：核心领域逻辑、数据转换、参数校验。
- 集成测试：D1、Vectorize、Workers AI 调用链路。
- 手动测试：真实 Codex 会话中的 Skill 调用。
- 冒烟测试：部署后保存一条 memory 并搜索回来。

输出物：

- 验收标准。
- 测试用例。
- 冒烟测试步骤。
- 已知风险清单。

## 7. 开发实施

开发时建议保持小步提交，先让主链路跑通，再逐步增强。

推荐开发顺序：

1. 初始化项目和 Wrangler 配置。
2. 建立 D1 migration。
3. 实现基础 REST API。
4. 接入 Workers AI embedding。
5. 接入 Vectorize。
6. 编写 Codex Skill 使用说明。
7. 实现 Web UI。
8. 补充错误处理、日志和测试。
9. 部署并验证。

开发原则：

- D1 是源数据，Vectorize 是可重建索引。
- 先保存可读元数据，再优化智能处理。
- 先让用户可检查、可编辑，再考虑自动化合并。
- 避免第一版做过度抽象。
- 对重要决策写入项目文档。

输出物：

- 可运行代码。
- 数据库 migration。
- API 和 Skill 使用说明。
- Web UI。
- 测试和本地运行说明。

## 8. 联调、验收与上线

开发完成后，先做本地联调，再部署到 Cloudflare 做线上验证。

联调检查：

- 本地 Worker 能启动。
- D1 migration 能执行。
- Workers AI binding 可用。
- Vectorize index 可写入。
- REST API 可请求。
- Codex Skill 可在真实会话中使用。
- Web UI 可完成核心操作。

上线前检查：

- 环境变量和 Cloudflare bindings 已配置。
- 数据库 migration 已执行。
- 冒烟测试通过。
- 错误日志可查看。
- 回滚方式明确。
- README 或部署文档可按步骤执行。

输出物：

- 可访问的部署地址。
- 上线检查清单。
- 冒烟测试记录。
- 已知问题清单。

## 9. 复盘与下一轮迭代

MVP 上线后，不急着加功能，先用它记录 Memo Otter 自己的开发过程。

复盘问题：

- 保存 memory 是否足够顺手。
- 搜索结果是否有用。
- Skill 调用流程是否稳定。
- 哪些字段是多余的。
- 哪些状态和标签最常用。
- 哪些错误最影响体验。
- 下一轮最应该补什么。

输出物：

- 复盘记录。
- 下一轮需求清单。
- 技术债清单。
- 文档更新。

## 10. 当前推荐下一步

基于现有 PRD，下一步最适合做三件事：

1. 编写 `docs/product/MVP_SCOPE.md`，明确第一版只做哪些功能。
2. 编写 `docs/architecture/TECHNICAL_DESIGN.md`，确定 Cloudflare、D1、Vectorize、Workers AI、REST API、Codex Skill 和 Web UI 的技术方案。
3. 编写 `docs/process/TASKS.md`，把 MVP 拆成可以逐项开发的任务列表。

完成这三份文档后，再进入代码初始化会更稳。

PRD 到技术方案之间的功能模块拆解见：[功能模块拆解](../architecture/FUNCTIONAL_MODULES.md)。

MVP Web UI 的原型与交互设计见：[原型与交互设计](../design/INTERACTION_DESIGN.md)。

MVP 的技术方案设计见：[技术方案设计](../architecture/TECHNICAL_DESIGN.md)。

MVP 的测试策略、用例和上线验收标准见：[测试方案](../testing/TEST_PLAN.md)。

当前所有文档的统一口径见：[文档口径基准](./DOCUMENTATION_ALIGNMENT.md)。
