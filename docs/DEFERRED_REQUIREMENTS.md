# Memo Otter 延后需求清单

这份清单用于保护 MVP 范围。下面的需求不是否定，而是明确不进入第一版。

## 1. 输入入口类

- 浏览器扩展。
- Bookmarklet。
- Obsidian 插件。
- iOS Shortcuts。
- Markdown 文件夹同步。
- CLI capture 工具。
- 自动从聊天记录中提取记忆。

延后原因：第一版先验证 REST API、Web UI 和 Codex Skill 三个最贴近自用场景的入口，过多入口会分散开发重心。

## 2. 记忆治理类

- 自动重复检测阻止。
- 自动冲突判断。
- 自动合并。
- 自动覆盖 canonical 记忆。
- 手动 merge 工作流。
- 独立冲突处理面板。
- deprecated 状态。
- supersedes 关系。
- 记忆清理视图。

延后原因：这些能力需要足够多真实记忆才能判断交互和规则。第一版只保留用户可见、可编辑、可归档的基础治理。

## 3. 知识库体验类

- 富文本编辑器。
- 文件夹。
- 双链。
- 知识图谱。
- 时间线视图。
- 复杂 dashboard。
- 高级统计。
- 学习总结自动生成。

延后原因：Memo Otter 不是通用笔记软件。第一版应聚焦 AI 可召回上下文。

## 4. 技术扩展类

- 多 embedding provider。
- OpenAI embedding provider。
- 本地 embedding model。
- re-embedding 管理后台。
- Cloudflare 之外的部署目标。
- 独立 Cloudflare Pages UI。
- 项目实体管理。
- 多数据库适配。

延后原因：第一版使用 Cloudflare-first 技术栈，减少可变项，优先完成端到端闭环。

## 5. 协作与商业化类

- 多用户协作。
- 团队空间。
- 邀请成员。
- 复杂权限系统。
- 计费。
- 组织管理。
- 审计后台。

延后原因：产品定位是独立开发者自用基础设施，不进入商业 SaaS 路线。

## 6. 高风险 MCP 工具

- `delete_memory`
- `deprecate_memory`
- `merge_memories`
- `replace_canonical_memory`
- `import_memories`

延后原因：这些工具可能破坏或重写用户数据。MVP 先通过 Web UI 或 REST API 做明确用户操作，未来即使加入 MCP，也不应第一时间暴露这些高风险工具。

## 7. 跨工具协议与自动入口

- MCP endpoint。
- MCP tools。
- Hooks 自动捕捉。
- 会话结束自动总结并保存。
- git commit 后自动保存候选记忆。

延后原因：MVP 先用 Codex Skill 验证真实自用价值。MCP 用于后续跨工具互操作，Hooks 用于后续自动生成候选记忆，二者都不应早于核心记忆闭环。
