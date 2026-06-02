# Memo Otter PRD 评审记录

评审日期：2026-06-02

本次评审从产品、技术、设计、测试四个角度检查 PRD，重点确认目标清晰度、MVP 范围、核心场景、功能边界、非目标、冲突需求、技术成本和上线前必须解决的问题。

## 1. 总体结论

Memo Otter 的产品目标清楚：做一个由独立开发者自己拥有、可通过 REST API、Web UI 和 AI 工作流调用的个人记忆服务。问题定义也成立，尤其是“在 AI 编程过程中复用项目上下文、个人偏好和技术决策”这个场景足够具体。

主要风险是 MVP 范围偏大。评审前的原 PRD 同时包含完整 CRUD、语义搜索、状态体系、冲突处理、7 个 MCP 工具、Web UI、统计、JSON export/import、事件日志和部署闭环。对第一版来说，这会让开发重心从“验证记忆服务是否真的有用”转向“搭一个过早完整的平台”。

评审建议：

- 第一版只做个人可用的最小闭环。
- AI 入口从跨工具 MCP 收敛为第一版 Codex Skill，MCP 延后到 MVP+。
- Web UI 从管理后台收敛为基础浏览、搜索、编辑。
- 冲突处理先做提示，不做合并面板。
- JSON export 保留，import 延后。
- 删除优先做软删除或归档，避免第一版处理复杂的物理删除和 Vectorize 同步风险。

## 2. 产品视角

### 2.1 产品目标是否清楚

结论：清楚。

PRD 已经明确 Memo Otter 不是商业 SaaS、不是团队知识库、不是通用笔记工具，而是独立开发者自用的 AI 记忆层。目标用户、问题定义和差异化方向都能支持这个定位。

需要补强：

- 成功标准应更贴近 MVP，例如“在真实 Codex 或 Cursor 会话中成功保存并召回 3 条 Memo Otter 项目记忆”。
- 第一版不要追求 80% 有效召回率，这更像积累一定数据后的质量指标。

### 2.2 MVP 范围是否足够小

结论：当前偏大，需要收紧。

建议第一版 MVP 只包含：

- 保存 memory。
- 搜索 memory。
- 查看最近 memory。
- 编辑 memory。
- 归档 memory。
- 导出 JSON。
- REST API 暴露 `save_memory`、`search_memory`、`get_project_context` 对应能力，并由 Codex Skill 指导调用。
- Web UI 提供列表、搜索、详情、编辑。

建议第一版不包含：

- 手动 merge 工作流。
- 完整冲突处理面板。
- 复杂统计。
- JSON import。
- `deprecate_memory` 和 `delete_memory` 作为 AI 入口工具。
- 浏览器扩展、Obsidian、移动端、多用户协作。

### 2.3 核心用户场景是否完整

结论：核心场景基本完整。

现有 PRD 覆盖了项目上下文召回、决策记忆、个人偏好、学习笔记、冲突提醒和 AI 工具集成。这些场景足以支撑 MVP。

建议第一版主场景排序：

1. AI 编程前召回项目上下文。
2. 开发过程中保存架构决策。
3. 搜索已有决策和偏好。
4. 在 Web UI 中修正记忆。

冲突处理是重要场景，但不应该成为第一版主链路。

### 2.4 功能边界是否明确

结论：大方向明确，MVP 边界需要更硬。

PRD 已经写了非目标，但 MVP 功能列表仍然容易把产品推向“完整记忆管理后台”。需要在 PRD 里明确第一版验收以 REST API、Web UI 和 Codex Skill 可用为核心，而不是以跨工具协议完整度为核心。

## 3. 技术视角

### 3.1 技术方向是否合理

结论：合理。

Cloudflare Workers、D1、Vectorize、Workers AI、REST API 和 Codex Skill 的组合符合产品目标，也符合学习型项目定位。D1 作为源数据库、Vectorize 作为可重建索引的原则是正确的。

### 3.2 技术成本明显偏高的部分

以下内容不建议进入第一版：

- 自动冲突判断和自动合并。
- 多 embedding provider。
- 完整 import 流程。
- 复杂 memory event 审计。
- 手动 merge UI。
- 物理删除并保证 D1 与 Vectorize 完全一致。
- 项目实体管理。

建议第一版保留轻量事件记录，但只记录 create、update、archive、export，避免把事件系统做成主工程。

### 3.3 必须上线前解决的技术问题

- Codex Skill 如何配置 endpoint、token 和调用边界。
- Workers AI embedding 模型和 Vectorize 维度必须匹配。
- 单一 bearer token 如何同时保护 REST API、Web UI 和 Skill 调用。
- D1 migration 如何在本地和远端执行。
- Vectorize 写入失败时，D1 memory 如何标记索引状态。
- 搜索结果如何处理 D1 有记录但向量缺失的情况。
- JSON export 是否包含 events 和 embeddings 元数据。

## 4. 设计视角

### 4.1 Web UI 定位

结论：Web UI 应是开发者工具，不是完整知识库。

第一版 UI 应服务三个动作：

- 找到记忆。
- 看懂记忆。
- 修改记忆。

不建议第一版做复杂 dashboard、图谱、富文本编辑器或大面积统计。PRD 里“简单统计”可以延后，避免界面目标变散。

### 4.2 必备界面

第一版只需要：

- 记忆列表。
- 搜索结果。
- 记忆详情。
- 新增和编辑表单。
- 基础设置或连接说明。

冲突提醒可以先显示在保存结果里，不需要独立冲突处理面板。

### 4.3 信息展示重点

每条记忆必须展示：

- title
- content 摘要或全文
- project
- type
- status
- tags
- source
- created_at
- updated_at

搜索结果必须展示 score 或匹配原因，否则用户会觉得它像黑盒答案。

## 5. 测试视角

### 5.1 可测试性

结论：需要把验收标准写得更可执行。

第一版测试不应覆盖过多智能行为，而应验证主链路可靠：

- 保存后 D1 有记录。
- embedding 成功后 Vectorize 有向量。
- 搜索能召回刚保存的内容。
- Codex Skill 能指导 Agent 调用保存和搜索能力。
- 未认证请求被拒绝。
- 归档后的 memory 默认不参与搜索。
- 导出的 JSON 可以被人读懂。

### 5.2 必须的测试类型

- 单元测试：字段校验、状态转换、搜索参数解析。
- 集成测试：D1 + Vectorize + Workers AI 主链路。
- API 测试：认证、保存、搜索、编辑、归档、导出。
- Skill 手动验收：在至少一个真实 Codex 会话中完成保存和搜索。
- 部署冒烟测试：远端保存一条 memory 并搜索回来。

## 6. 评审决策

- MVP 以 REST API、Web UI、Codex Skill 可用和记忆闭环为中心，Web UI 只做基础管理。
- 第一版 AI 入口使用 Codex Skill，能力缩减为 `save_memory`、`search_memory`、`get_project_context`。
- 第一版使用 Workers AI 作为唯一 embedding provider，只预留接口边界。
- 第一版 UI 和 REST API 放在同一个 Worker。
- 第一版 project 使用自由文本，不做独立项目实体。
- 第一版不做自动合并，不做自动覆盖 canonical 记忆。
- 第一版默认排除 archived，deprecated 状态延后。
- 第一版支持 JSON export，JSON import 延后。

相关输出：

- 明确的 MVP 范围：[MVP 范围](./MVP_SCOPE.md)
- 开放问题清单：[开放问题](./OPEN_QUESTIONS.md)
- 延后需求清单：[延后需求](./DEFERRED_REQUIREMENTS.md)
