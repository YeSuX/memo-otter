# Memo Otter 测试方案

更新时间：2026-06-03

这份文档定义 Memo Otter MVP 的测试策略、测试范围、测试类型、核心用例和上线验收标准。它的目标不是把第一版测试做得很庞大，而是确保个人 AI 记忆服务的最小闭环真实可靠。

当前 Memory 基础管理实现验证状态：

- `pnpm typecheck` 已通过。
- `pnpm test -- --run` 已通过，当前 4 个测试文件、15 个测试用例。
- `pnpm db:migrate:local` 已通过。
- `pnpm db:migrate:remote` 已通过。
- `pnpm wrangler deploy` 已成功部署到 `https://memo-otter.suxiong1998.workers.dev`。
- Embedding 与索引自动化测试已覆盖成功索引、Workers AI 失败、Workers AI 返回格式异常、Vectorize upsert 失败、D1 metadata 写入失败、`indexed` 状态更新失败、内容更新重新索引、tags-only 不重索引、Vectorize metadata 不写入 `null`。
- 本地 HTTP 冒烟完成 health、创建、详情和归档；Workers AI remote binding 返回 internal error 时，memory 保留且索引状态降级为 `failed`，符合失败降级设计。
- `pnpm wrangler deploy` 已成功部署最新版本到 `https://memo-otter.suxiong1998.workers.dev`。
- 远端 HTTP 冒烟在本机 curl 中访问 `/health` 超时，需后续复测网络可达性后再执行远端创建、详情和归档主链路。

MVP 需要验证的主链路：

```text
保存记忆 -> D1 保存源数据 -> Workers AI 生成 embedding -> Vectorize 写入向量 -> 语义搜索召回 -> Web UI 检查和修正 -> AI 入口调用
```

其中 MVP 的 AI 入口是 Codex Skill。MCP 作为 MVP+ 的跨工具接口延后，Hooks 作为 Post-MVP 的自动候选记忆入口延后。

## 1. 测试目标

MVP 测试要证明：

- 用户可以保存一条 memory。
- D1 中保存了可读源数据。
- Workers AI 可以生成 embedding。
- Vectorize 可以写入和查询向量。
- 搜索可以召回刚保存的 memory。
- Web UI 可以完成创建、搜索、查看、编辑、归档、导出。
- 未认证请求无法读取或修改 memory。
- archived memory 默认不参与搜索。
- AI 入口可以调用保存和搜索能力。
- 部署到 Cloudflare 后主链路仍然可用。

## 2. 测试范围

### 2.1 MVP 内测试范围

必须测试：

- Memory 数据模型。
- Memory 创建、列表、详情、编辑、归档。
- Embedding 生成。
- Vectorize 写入和搜索。
- 搜索过滤和排序。
- REST API。
- Web UI。
- 认证。
- JSON export。
- Cloudflare 部署冒烟。
- AI 入口调用。

### 2.2 MVP 外测试范围

第一版不测试：

- JSON import。
- 多用户权限。
- 多 embedding provider。
- 浏览器扩展。
- Obsidian 插件。
- 移动端 App。
- 自动合并。
- 自动覆盖 canonical memory。
- 知识图谱。
- 时间线。
- 富文本编辑器。

这些能力不进入 MVP，因此不写测试用例，避免范围膨胀。

## 3. 测试分层

建议分成 6 层：

1. 单元测试。
2. Repository / 数据库测试。
3. Service 集成测试。
4. REST API 测试。
5. Web UI 测试。
6. 部署后冒烟测试。

AI 入口测试单独作为第 7 层：

7. Skill 入口测试。

## 4. 测试环境

### 4.1 本地环境

用途：

- 单元测试。
- 数据模型测试。
- API 基础测试。
- UI 交互测试。
- mock Workers AI 和 Vectorize。

特点：

- 速度快。
- 适合开发期频繁运行。
- 不要求真实 Cloudflare 资源完全可用。

### 4.2 Cloudflare 远端测试环境

用途：

- Workers AI 真实 embedding。
- Vectorize 真实写入和查询。
- D1 远端 migration。
- Worker 部署冒烟。
- Codex Skill 真实会话验证。

特点：

- 必须用于上线前验收。
- 不依赖本地模拟结果。
- 使用独立测试数据，避免污染真实 memory。

### 4.3 测试数据约定

测试 project 使用：

```text
test-memo-otter
```

测试 memory 内容示例：

```text
Memo Otter MVP uses Cloudflare Workers, D1, Vectorize, and Workers AI.
```

测试标签：

```text
["test", "mvp", "cloudflare"]
```

测试完成后：

- 可以归档测试 memory。
- 不要求物理删除。

## 5. 单元测试

### 5.1 Memory schema

测试点：

- `content` 必填。
- `scope` 只允许 `long_term`、`short_term`。
- `type` 允许用户自定义，但不能为空。
- `status` 只允许 `draft`、`active`、`canonical`、`archived`。
- `tags` 必须能转换为数组。
- `metadata` 必须是可序列化对象。

验收：

- 非法 scope 被拒绝。
- 空 type 被拒绝。
- 非法 status 被拒绝。
- 空 content 被拒绝。
- 合法输入可以通过校验。

### 5.2 默认值

测试点：

- 未传 `scope` 时默认为 `long_term`。
- 未传 `type` 时默认为 `note`。
- 未传 `status` 时默认为 `active`。
- 未传 `tags` 时默认为空数组。
- 未传 `source` 时按入口设置默认值。

验收：

- Web UI 默认 source 是 `web`。
- AI 入口默认 source 是 `skill`。

### 5.3 状态转换

测试点：

- `active` 可以归档为 `archived`。
- `canonical` 可以归档为 `archived`，但需要明确用户动作。
- `archived_at` 在归档时写入。
- 编辑 memory 时更新 `updated_at`。

验收：

- 归档不会删除原始 content。
- 归档后的 memory 可通过 include archived 查询。

### 5.4 搜索排序

测试点：

- 相同 score 下 `canonical` 排在 `active` 前。
- `active` 排在 `draft` 前。
- `decision` 和 `preference` 可优先于普通 `note`。
- archived 默认排除。

验收：

- 排序规则稳定。
- 搜索结果包含 score 和元数据。

### 5.5 工具函数

测试点：

- content hash 稳定。
- tags JSON 序列化和反序列化正确。
- title 自动生成逻辑正确。
- 错误响应格式统一。
- token 校验逻辑正确。

## 6. 数据库测试

### 6.1 Migration

测试点：

- migration 可以创建 `memories`。
- migration 可以创建 `memory_embeddings`。
- migration 可以创建 `memory_events`。
- 索引创建成功。

验收：

- 本地 D1 migration 成功。
- 远端 D1 migration 成功。
- 重复执行不会破坏已有数据。

### 6.2 Memory repository

测试点：

- insert memory。
- list memories。
- get memory by id。
- update memory。
- archive memory。
- filter by project。
- filter by type。
- filter by status。
- filter by tag。
- include archived。

验收：

- 所有查询返回结构稳定。
- archived 默认不出现在普通列表。

### 6.3 Embedding repository

测试点：

- 保存 vector id。
- 保存 embedding model。
- 保存 content hash。
- 通过 memory id 查询 embedding 元数据。
- 内容更新后更新 embedding 元数据。

验收：

- D1 中可以追踪 memory 与 vector id 的关系。

### 6.4 Event repository

测试点：

- 创建 create event。
- 创建 update event。
- 创建 archive event。
- 创建 index event。
- 创建 index_failed event。
- 查询最近 events。

验收：

- Memory 详情可以展示最近事件。
- 事件失败不应破坏主流程。

## 7. Service 集成测试

### 7.1 创建 memory 主链路

用例：

```text
输入合法 memory
-> 写入 D1
-> 生成 embedding
-> 写入 Vectorize
-> 保存 memory_embeddings
-> embedding_status = indexed
```

验收：

- 返回 memory id。
- D1 有源数据。
- embedding 元数据存在。
- 搜索可召回。

### 7.2 Workers AI 失败

用例：

```text
D1 写入成功
-> Workers AI 生成 embedding 失败
```

验收：

- memory 不丢失。
- `embedding_status = failed`。
- 记录 `index_failed` event。
- API 返回可读错误或 warning。

### 7.3 Vectorize 失败

用例：

```text
D1 写入成功
-> embedding 成功
-> Vectorize 写入失败
```

验收：

- memory 不丢失。
- `embedding_status = failed`。
- 搜索不会因为这条 memory 失败而整体失败。

### 7.4 编辑 content

用例：

```text
编辑 memory content
-> embedding_status = stale
-> 重新生成 embedding
-> 更新 Vectorize
-> embedding_status = indexed
```

验收：

- 更新后的内容可以被搜索召回。
- 旧内容不应继续主导搜索结果。

### 7.5 编辑元数据

用例：

```text
只编辑 tags/type/status/project
```

验收：

- 不强制重新生成 embedding。
- 搜索过滤条件更新生效。

### 7.6 归档

用例：

```text
归档 active memory
-> status = archived
-> archived_at 写入
-> 默认搜索排除
```

验收：

- 默认搜索不到。
- include archived 可以查到。

## 8. REST API 测试

### 8.1 认证

测试点：

- 无 token 请求私有 API。
- 错误 token 请求私有 API。
- 正确 token 请求私有 API。

验收：

- 无 token 返回 401。
- 错误 token 返回 401。
- 正确 token 可以访问。
- 错误响应不泄露 secret。

### 8.2 `GET /health`

测试点：

- Worker 在线。
- 基础 health 可访问。
- 认证后可看到 binding 检查。

验收：

- 返回 `ok`。
- 能识别 D1、Vectorize、Workers AI binding 状态。

### 8.3 `POST /memories`

测试点：

- 合法创建。
- 空 content。
- 非法 scope。
- 空 type。
- 非法 status。
- tags 格式错误。

验收：

- 合法请求返回 memory。
- 非法请求返回 400。
- 创建后触发索引。

### 8.4 `GET /memories`

测试点：

- 默认列表。
- project 筛选。
- type 筛选。
- status 筛选。
- tag 筛选。
- include archived。
- limit。

验收：

- 查询结果正确。
- archived 默认排除。

### 8.5 `GET /memories/:id`

测试点：

- 存在的 id。
- 不存在的 id。

验收：

- 存在返回详情、events、embedding 状态。
- 不存在返回 404。

### 8.6 `PATCH /memories/:id`

测试点：

- 编辑 title。
- 编辑 content。
- 编辑 tags。
- 编辑 status。
- 非法字段。

验收：

- 合法更新成功。
- content 更新触发重新索引。
- 非法字段返回 400。

### 8.7 `POST /memories/:id/archive`

测试点：

- 归档 active memory。
- 归档 canonical memory。
- 归档不存在的 memory。
- 重复归档。

验收：

- 归档成功后状态为 archived。
- 重复归档行为稳定。
- 不存在返回 404。

### 8.8 `POST /search`

测试点：

- 正常 query。
- 空 query。
- project 筛选。
- type 筛选。
- status 筛选。
- tags 筛选。
- include archived。

验收：

- 正常 query 返回结果。
- 空 query 返回 400。
- archived 默认排除。
- 结果包含 score、snippet、metadata。

### 8.9 `GET /export`

测试点：

- 导出 memories。
- 导出 events。
- 导出 embedding metadata。
- 不导出 token。
- 不导出向量本身。

验收：

- JSON 可读。
- 包含 `exported_at`。
- 包含 `schema_version`。

### 8.10 `GET /context/:project`

测试点：

- 存在 project。
- 不存在 project。
- canonical memory 优先。
- active memory 参与。
- archived memory 默认排除。
- 按 type 分组。

验收：

- 返回 project 上下文结构。
- 结果包含 decisions、preferences、context、notes。
- 可供 Codex Skill 直接使用。

## 9. Web UI 测试

### 9.1 首次使用

用例：

```text
打开 Web UI
-> 输入 token
-> 看到空状态
-> 创建第一条 memory
-> 保存成功
-> 搜索刚保存的 memory
```

验收：

- 空状态清楚。
- 保存路径顺畅。
- 搜索能找到结果。

### 9.2 Memory 列表

测试点：

- 列表展示 title、project、type、status、tags、updated_at。
- 筛选生效。
- 搜索后列表变为搜索结果。
- 清空搜索恢复默认列表。

验收：

- 用户能快速找到 memory。

### 9.3 Memory 详情

测试点：

- 展示完整 content。
- 展示 metadata。
- 展示 embedding_status。
- 展示 recent events。
- 支持 copy content。

验收：

- 用户能判断 memory 是否可信和可用。

### 9.4 新增和编辑表单

测试点：

- content 必填。
- type/status 可选。
- tags 可编辑。
- 保存中 loading。
- 保存失败保留输入内容。
- content 修改提示重新索引。

验收：

- 用户不会因为失败丢失草稿。

### 9.5 归档交互

测试点：

- 点击 Archive。
- 二次确认。
- 归档后状态变化。
- 默认列表和搜索不显示。
- include archived 后可见。

验收：

- 用户理解归档不是删除。

### 9.6 Skill Setup 页面

- 显示 Skill 使用说明。
- 显示 REST API endpoint。
- 显示 token 配置方式。
- 显示何时保存 memory。
- 显示何时搜索 memory。
- 显示不要自动保存敏感信息的规则。
- 不暴露真实 token。

验收：

- 用户能理解 Codex Skill 如何连接核心服务。

### 9.7 Export 页面

测试点：

- 点击 export。
- 下载或展示 JSON。
- 导出失败反馈。

验收：

- 用户能拿到可读数据。
- JSON 不包含 secret。

## 10. AI 入口测试

### 10.1 Skill 入口测试

适用于 MVP 的 Codex Skill 入口。

测试点：

- Skill 能指导 Agent 先查询 project context。
- 用户明确说“记住这个决策”时，Agent 调用保存接口。
- 用户问历史偏好时，Agent 调用搜索接口。
- Agent 不自动保存敏感信息。
- Agent 不自动覆盖 canonical memory。
- Agent 保存后向用户说明保存了什么。

验收：

- 在真实 Codex 会话中完成：
  - 查询项目上下文。
  - 保存一条开发决策。
  - 搜索刚保存的决策。

### 10.2 Hooks 入口测试

适用于 Post-MVP 后续引入 hooks 的情况。

测试点：

- hook 触发后只生成候选 memory。
- 用户确认前不写入长期记忆。
- 用户拒绝后不保存。
- 用户确认后才调用保存接口。
- hook 不读取或保存敏感信息。

验收：

- Hooks 不绕过用户控制。

## 11. 安全测试

测试点：

- 无 token 访问 memories。
- 错 token 访问 memories。
- 无 token 访问 search。
- 错 token 访问 export。
- token 不出现在日志。
- token 不出现在 export JSON。
- 错误响应不包含 stack trace。
- archived memory 不会默认召回。

验收：

- 私有数据不会被未认证访问。
- 日志和导出不泄露 secret。

## 12. 数据导出测试

测试点：

- 导出包含所有未归档和归档 memory。
- 导出包含 events。
- 导出包含 embedding metadata。
- 导出不包含向量本身。
- 导出不包含 AUTH_TOKEN。
- 导出 JSON 可格式化读取。

验收：

- 用户可以理解导出的数据。
- 导出数据可作为未来 import 的基础。

## 13. 性能与可靠性测试

MVP 不做重型压测，但需要基本可靠性检查。

### 13.1 个人规模数据量

测试数据量：

- 10 条 memories。
- 100 条 memories。
- 1000 条 memories。

测试点：

- 列表响应时间。
- 搜索响应时间。
- Web UI 是否可用。
- export 是否可完成。

验收：

- 个人规模下体验可接受。
- 1000 条 memories 不应导致明显不可用。

### 13.2 失败恢复

测试点：

- Workers AI 临时失败。
- Vectorize 临时失败。
- D1 查询失败。
- 网络中断。

验收：

- UI 给出清楚错误。
- D1 源数据不因索引失败丢失。
- 用户能重试或继续编辑。

## 14. 部署后冒烟测试

每次部署后至少执行：

1. 打开 Web UI。
2. `/health` 返回正常。
3. 未认证访问 `/memories` 被拒绝。
4. 使用正确 token 创建 memory。
5. D1 中可查询到 memory。
6. embedding 生成成功。
7. Vectorize 写入成功。
8. 用自然语言搜索召回 memory。
9. 编辑 memory content。
10. 再次搜索召回新内容。
11. REST `get_project_context` 返回项目上下文。
12. Codex Skill 能指导 Agent 保存或搜索 memory。
13. 归档 memory。
14. 默认搜索不返回 archived memory。
15. include archived 可以返回。
16. JSON export 成功。

冒烟测试通过后，才认为部署可用。

## 15. 回归测试清单

每次改动以下模块后需要跑回归：

Memory schema 改动：

- 创建。
- 编辑。
- 归档。
- 导出。

Embedding 或 Vectorize 改动：

- 保存后索引。
- 搜索召回。
- 内容更新后重索引。
- 索引失败处理。

认证改动：

- REST API。
- Web UI。
- AI 入口。
- export。

Web UI 改动：

- 新增。
- 搜索。
- 详情。
- 编辑。
- 归档。
- export。

AI 入口改动：

- 保存。
- 搜索。
- 项目上下文。
- 用户确认边界。

## 16. 缺陷分级

### P0

- 未认证用户可以读取或写入 memory。
- 保存 memory 后 D1 数据丢失。
- 导出泄露 token。
- 部署后主服务不可用。

### P1

- 保存成功但无法搜索，且没有失败提示。
- archived memory 默认出现在搜索结果中。
- 编辑 content 后索引未更新。
- AI 入口绕过用户确认执行高风险操作。

### P2

- 搜索排序不稳定。
- UI 状态提示不清楚。
- export 缺少 events 或 embedding metadata。
- 筛选条件异常。

### P3

- 文案不够清楚。
- 视觉状态不够明显。
- 非核心浏览器样式问题。

## 17. MVP 上线通过标准

MVP 可以上线试用，需要满足：

- P0 缺陷为 0。
- P1 缺陷为 0。
- 核心 REST API 测试通过。
- Web UI 主流程通过。
- 远端 Cloudflare 冒烟测试通过。
- AI 入口至少一个真实场景通过。
- JSON export 可用且不泄露 secret。
- README 或部署文档包含测试和冒烟步骤。

## 18. 后续测试增强

MVP 后可以增加：

- Playwright E2E 自动化。
- Skill 行为测试脚本。
- Hooks 用户确认流程测试。
- MCP Inspector 自动化测试。
- reindex 测试。
- import/export round-trip 测试。
- 多 provider 搜索质量对比。
- 记忆召回质量评估集。
