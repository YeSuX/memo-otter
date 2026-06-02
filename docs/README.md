# Memo Otter 文档索引

这份索引把 `docs/` 下的文档按用途归类，避免产品、架构、流程和测试文档混在同一层。

## 产品与范围

- [PRD](./product/PRD.md)：产品背景、目标用户、核心场景、MVP 边界和长期方向。
- [PRD 评审记录](./product/PRD_REVIEW.md)：PRD 的产品、技术、设计和测试评审结论。
- [MVP 范围](./product/MVP_SCOPE.md)：第一版进入和不进入 MVP 的功能边界。
- [开放问题](./product/OPEN_QUESTIONS.md)：MVP 上线前需要确认的问题。
- [延后需求](./product/DEFERRED_REQUIREMENTS.md)：明确不进入第一版的需求池。

## 架构与模块

- [功能模块拆解](./architecture/FUNCTIONAL_MODULES.md)：从 PRD 到可开发模块的拆解。
- [技术方案设计](./architecture/TECHNICAL_DESIGN.md)：Cloudflare Workers、D1、Vectorize、Workers AI、REST API 和部署方案。
- [Memory 数据模型](./architecture/MEMORY_DATA_MODEL.md)：`memories`、`memory_embeddings`、`memory_events` 的数据模型和 migration 草案。
- [Memory 基础管理设计计划](./architecture/MEMORY_BASIC_MANAGEMENT.md)：Memory 创建、列表、详情、编辑、归档、事件和 TODO 状态。

## 体验设计

- [交互设计](./design/INTERACTION_DESIGN.md)：Web UI 信息架构、页面结构、状态和交互流程。

## 流程与口径

- [开发流程](./process/DEVELOPMENT_PROCESS.md)：从 PRD 到开发、测试、上线和复盘的工作流。
- [文档口径基准](./process/DOCUMENTATION_ALIGNMENT.md)：当前 MVP 定义、技术口径和文档优先级。

## 测试

- [测试方案](./testing/TEST_PLAN.md)：单元、repository、service、REST API、Web UI、部署和 Skill 测试策略。

## 建议阅读顺序

1. [PRD](./product/PRD.md)
2. [MVP 范围](./product/MVP_SCOPE.md)
3. [功能模块拆解](./architecture/FUNCTIONAL_MODULES.md)
4. [技术方案设计](./architecture/TECHNICAL_DESIGN.md)
5. [Memory 数据模型](./architecture/MEMORY_DATA_MODEL.md)
6. [Memory 基础管理设计计划](./architecture/MEMORY_BASIC_MANAGEMENT.md)
7. [测试方案](./testing/TEST_PLAN.md)
