# Memo Otter 原型与交互设计

这份文档定义 Memo Otter MVP 的 Web UI 原型、信息架构和交互流程。它不包含代码实现，重点是帮助后续进入 UI 设计、前端开发和测试验收。

设计读法：

```text
一个给独立开发者长期使用的个人 AI 记忆工作台。
它应该安静、清楚、可信，像开发工具，而不是营销页、企业后台或通用笔记软件。
```

## 1. 设计目标

MVP 的界面只服务五件事：

1. 快速保存一条记忆。
2. 快速搜索已有记忆。
3. 看懂一条记忆为什么重要。
4. 修正记忆内容和元数据。
5. 知道如何让 Codex Skill 使用 Memo Otter。

第一版 UI 不追求视觉惊艳，也不追求完整知识库体验。它要让用户在真实 AI 编程会话中少解释几遍项目背景，这就够了。

## 2. 设计原则

### 2.1 独立开发者风格

- 信息密度适中，允许用户一次看到足够多上下文。
- 操作路径短，不用复杂向导。
- 状态和元数据直接可见。
- 文案偏工具语言，少用营销式表达。
- 页面结构稳定，适合反复使用。
- 优先文本清晰度，而不是装饰性视觉。

### 2.2 记忆像证据，不像魔法答案

搜索结果必须让用户知道：

- 这条记忆是什么。
- 属于哪个项目。
- 当前是什么状态。
- 为什么被召回。
- 是否可以信任。
- 什么时候创建或修改过。

Memo Otter 不应该只返回一个漂亮答案，而应该展示可检查的上下文。

### 2.3 AI 操作需要边界感

MVP 不在 UI 中鼓励高风险自动化。归档、编辑 canonical 记忆、处理疑似冲突时，都要让用户明确知道自己在改变长期上下文。

## 3. 信息架构

MVP Web UI 建议包含 5 个主区域：

1. Memories
2. Search
3. New Memory
4. Skill Setup
5. Export

推荐导航结构：

```text
Memo Otter
├── Memories
│   ├── List
│   ├── Detail
│   └── Edit
├── Search
├── New Memory
├── Skill Setup
└── Export
```

对于 MVP，可以把 `Memories` 和 `Search` 放在同一个主工作台页面里，减少页面跳转。

## 4. 全局布局

### 4.1 桌面端布局

桌面端推荐使用三段式工作台：

```text
┌──────────────┬──────────────────────────────┬──────────────────────┐
│ Sidebar      │ Main Work Area               │ Detail Panel         │
│              │                              │                      │
│ Memories     │ Search / List / Form         │ Selected Memory      │
│ Search       │                              │ Metadata / Events    │
│ New          │                              │ Actions              │
│ Skill Setup  │                              │                      │
│ Export       │                              │                      │
└──────────────┴──────────────────────────────┴──────────────────────┘
```

说明：

- 左侧是稳定导航和项目筛选。
- 中间是主要工作区，用于搜索、列表和表单。
- 右侧是详情面板，用于查看选中 memory。
- 如果没有选中 memory，右侧显示 Skill 使用提示或最近保存结果。

### 4.2 移动端布局

移动端不追求复杂三栏，采用单列：

```text
Top Bar
Search / Filters
Memory List
Memory Detail as full page
```

移动端主要保证能浏览和搜索，不把它作为 MVP 的核心使用场景。

### 4.3 视觉基调

建议风格：

- 浅色为主，支持后续暗色但 MVP 不强求。
- 背景使用中性浅灰或接近白色。
- 文字层级清楚。
- 边框多于阴影。
- 卡片只用于 memory 条目、详情区域和表单，不做装饰性卡片堆叠。
- 圆角克制，整体偏工具感。
- 单一强调色用于当前状态、主按钮和选中项。

不建议：

- 大面积渐变背景。
- AI 紫蓝光效。
- 营销首页式 hero。
- 复杂插画。
- 过度拟物。
- 过多动画。

## 5. 页面原型

## 5.1 Memories 工作台

### 页面目标

让用户看到最近和当前项目相关的记忆，并能快速筛选、打开、编辑或归档。

### 桌面端结构

```text
Sidebar
  Memo Otter
  Project filter
  Nav

Main
  Header: Memories
  Search input
  Filter row
  Memory list

Detail Panel
  Selected memory
  Metadata
  Index status
  Recent events
  Actions
```

### 主区域元素

Header：

- 标题：`Memories`
- 次级信息：当前 project、结果数、是否包含 archived。
- 主操作：`New memory`

搜索输入：

- 占位文案：`Search decisions, preferences, context...`
- 支持回车搜索。
- 搜索后结果替换列表。

筛选行：

- Project
- Type
- Status
- Tags
- Include archived

Memory 列表项：

- title
- content 片段
- project
- type
- status
- tags
- updated_at
- embedding_status

### 交互规则

- 点击列表项，在右侧详情面板打开。
- 搜索框输入后按回车执行搜索。
- 清空搜索后回到最近 memory 列表。
- 筛选变化后立即刷新列表或搜索结果。
- `archived` 默认不显示。
- 如果打开 archived，需要在列表中明确显示 archived 状态。

### 空状态

没有任何 memory：

- 显示一段短文案：`No memories yet. Save the first project decision.`
- 主操作：`New memory`

当前筛选无结果：

- 显示：`No memories match these filters.`
- 操作：`Clear filters`

搜索无结果：

- 显示：`No matching memories. Try a broader query.`
- 操作：`Save this as a new memory`

## 5.2 Memory 详情面板

### 页面目标

让用户快速判断一条 memory 是否可信、是否仍然有效、是否需要修改。

### 信息结构

```text
Title
Status / Type / Project
Content
Tags
Source
Created / Updated
Embedding status
Recent events
Actions
```

### 必显字段

- title
- content
- project
- type
- status
- tags
- source
- created_at
- updated_at
- embedding_status

### 操作

- Edit
- Archive
- Copy content
- Copy as project context

### 状态展示

status：

- `canonical`：最高优先级，应有明确视觉强调。
- `active`：默认正常状态。
- `draft`：弱化展示，提示尚未确认。
- `archived`：灰化，明确默认不参与召回。

embedding_status：

- `indexed`：正常。
- `pending`：显示正在索引。
- `failed`：显示失败原因和重试入口。
- `stale`：提示内容已更新，索引等待刷新。

### 交互规则

- 点击 `Edit` 进入编辑模式，可以在右侧面板内编辑，也可以打开独立编辑页。
- 点击 `Archive` 前需要二次确认。
- 如果 memory 是 `canonical`，编辑前显示轻量提示：`Canonical memories affect project context recall.`
- 如果 embedding 失败，不阻止用户查看或编辑原始内容。

## 5.3 New Memory 页面或面板

### 页面目标

让用户用最少动作保存一条可召回的记忆。

### 表单字段

必填：

- content

建议填写：

- title
- project
- type
- status
- tags

可选：

- source
- metadata

### 默认值

- type：`note`
- status：`active`
- tags：空
- source：`web`

### 表单布局

```text
Content editor
Title
Project
Type
Status
Tags
Source
Save
```

`content` 应该是最突出的字段。Memo Otter 的核心是记忆内容，不是元数据填表。

### 保存后反馈

保存成功后显示：

- memory id
- index status
- 疑似重复提示
- 可能冲突提示
- 操作：`View memory`、`Create another`

### 疑似重复提示

如果发现高相似内容：

```text
Possible duplicate found.
```

展示：

- 相关 memory title
- project
- type
- status
- score
- 操作：`Open existing memory`、`Keep new memory`

MVP 不做自动合并。

### 可能冲突提示

如果同 project、同 type 已有 canonical 记忆且语义相近：

```text
This may conflict with an existing canonical memory.
```

操作：

- `Save as draft`
- `Keep as active`
- `Open existing canonical memory`

MVP 不做自动替换。

## 5.4 Edit Memory 页面或面板

### 页面目标

让用户修正内容和元数据，并清楚知道哪些修改会影响搜索索引。

### 可编辑字段

- title
- content
- project
- type
- status
- tags
- metadata

### 交互规则

- 修改 content 时提示：`Content changes will refresh the semantic index.`
- 只修改 tags、type、status 时不提示重索引。
- 保存后显示 `updated_at` 和新的 indexing 状态。
- 如果保存失败，保留用户未提交内容。

### canonical 编辑提示

如果正在编辑 canonical memory：

```text
This memory is used as trusted project context.
```

操作仍然允许，但需要用户明确保存。

## 5.5 Search 页面

### 页面目标

让用户像问 AI 一样查询自己的记忆，但结果保持可检查。

### 结构

```text
Search input
Filter row
Results list
Selected result detail
```

### 搜索结果项

每条结果展示：

- title
- snippet
- score
- project
- type
- status
- tags
- updated_at

### 交互规则

- 输入 query 后回车搜索。
- 搜索结果按相关性和状态权重排序。
- 点击结果打开详情。
- 搜索结果中的 score 不需要过度精确，可以显示为百分比或 `High / Medium / Low`。
- archived 默认不展示。

### 搜索建议

可以提供 3 个静态示例：

- `What should AI know about memo-otter?`
- `Why did I choose Cloudflare for MVP?`
- `What are my writing preferences?`

示例只在空状态显示，不做复杂推荐系统。

## 5.6 Skill Setup 页面

### 页面目标

让用户知道如何让 Codex Skill 使用 Memo Otter，并理解当前允许 AI 调用哪些低风险能力。

### 页面内容

- REST API endpoint。
- Token 配置说明。
- Codex Skill 使用说明。
- 可用能力列表。
- 最小调用示例说明。
- 冒烟测试步骤。

### 工具说明

`save_memory`：

- 保存一条新记忆。
- 用于用户明确要求 AI 记住某件事。

`search_memory`：

- 搜索已有记忆。
- 用于回答前召回相关上下文。

`get_project_context`：

- 获取某个 project 的关键上下文。
- 用于一次编程会话开始前。

### 交互规则

- Token 默认不明文展示。
- 提供复制 REST API endpoint 的操作。
- 提供复制 Skill 配置片段或说明的操作，但不在 UI 中暴露真实 token。
- 如果 `/health` 检查失败，显示绑定缺失或认证问题。

## 5.7 Export 页面

### 页面目标

让用户确认自己拥有数据，并能导出可读 JSON。

### 页面内容

- 最近导出时间。
- 导出内容说明。
- 导出按钮。
- 数据范围说明。

导出内容：

- memories
- memory_events
- memory_embeddings metadata

不导出：

- AUTH_TOKEN
- 向量本身
- Cloudflare secrets

### 交互规则

- 点击导出后下载 JSON 或展示下载链接。
- 导出失败时显示原因。
- 导出成功后显示 `exported_at`。

## 6. 核心用户流程

## 6.1 第一次使用

```text
打开 Web UI
-> 输入 token
-> 查看空状态
-> 创建第一条 memory
-> 保存成功
-> 搜索刚保存的 memory
-> 打开 Skill Setup
-> 在 Codex 会话中按 Skill 说明调用 Memo Otter
```

验收重点：

- 用户不需要阅读大量说明也能保存第一条 memory。
- 创建、搜索、配置 Skill 三件事路径清楚。

## 6.2 保存一条开发决策

```text
点击 New memory
-> 输入决策内容
-> project 选择或输入 memo-otter
-> type 选择 decision
-> status 选择 canonical
-> 保存
-> 查看保存结果和索引状态
```

保存后：

- 如果索引成功，显示 `indexed`。
- 如果疑似重复，显示相关 memory。
- 如果可能冲突，引导保存为 draft 或打开旧 canonical。

## 6.3 搜索项目上下文

```text
进入 Search
-> 输入 "What should AI know about memo-otter?"
-> 选择 project: memo-otter
-> 查看结果
-> 打开最相关 memory
-> 复制或继续编辑
```

验收重点：

- 搜索结果足够解释来源。
- canonical 和 active 记忆优先。

## 6.4 修正一条记忆

```text
打开 memory 详情
-> 点击 Edit
-> 修改 content 或 tags
-> 保存
-> 查看 updated_at 和 embedding_status
```

验收重点：

- 用户知道内容修改会刷新语义索引。
- 保存失败不会丢掉编辑内容。

## 6.5 归档一条过期记忆

```text
打开 memory 详情
-> 点击 Archive
-> 二次确认
-> 状态变为 archived
-> 默认搜索不再出现
```

验收重点：

- 归档不是删除。
- 用户能通过 include archived 找回。

## 7. 状态设计

### 7.1 全局状态

Loading：

- 首次加载 memories。
- 搜索请求中。
- 保存请求中。
- 索引处理中。

Error：

- 未认证。
- token 无效。
- Cloudflare binding 缺失。
- D1 请求失败。
- Workers AI 请求失败。
- Vectorize 请求失败。

Success：

- 保存成功。
- 编辑成功。
- 归档成功。
- 导出成功。

### 7.2 空状态

全局没有 memory：

```text
No memories yet.
```

建议操作：

- New memory
- Open Skill setup

搜索无结果：

```text
No matching memories.
```

建议操作：

- Clear filters
- Save this query as a memory

筛选无结果：

```text
No memories match these filters.
```

建议操作：

- Clear filters

### 7.3 失败状态

Embedding failed：

- 原始 memory 仍然存在。
- 显示失败原因。
- 提供 retry index。

Vectorize failed：

- 原始 memory 仍然存在。
- 搜索可能暂时召回不到。
- 提供 retry index。

Unauthorized：

- 显示 token 输入入口。
- 不显示 memory 数据。

## 8. 组件与交互规范

### 8.1 导航

导航项：

- Memories
- Search
- New
- Skill Setup
- Export

当前页面高亮要明显，但不夸张。

### 8.2 标签与状态

Type 用小标签展示：

- decision
- preference
- context
- note

Status 用更强的视觉层级：

- canonical：强调
- active：正常
- draft：弱提示
- archived：灰化

Embedding status 不应该和 memory status 混淆，需要单独展示。

### 8.3 表单

表单顺序：

1. content
2. title
3. project
4. type
5. status
6. tags
7. source

输入体验：

- content 支持多行。
- tags 支持逗号分隔或 tag chips。
- project 是自由文本。
- type 和 status 使用下拉或分段控件。

### 8.4 按钮

主按钮：

- Save memory
- Search
- New memory

次按钮：

- Edit
- Copy
- Export

危险或高影响操作：

- Archive

`Archive` 不使用强烈删除语气，因为 MVP 不做物理删除。

### 8.5 反馈

保存后反馈必须包含：

- 是否保存成功。
- 是否索引成功。
- 是否有重复或冲突提示。
- 下一步可以做什么。

搜索后反馈必须包含：

- 结果数量。
- 当前过滤条件。
- 是否排除了 archived。

## 9. 文案原则

文案应该像开发工具：

- 短。
- 准。
- 可操作。
- 不夸张。

推荐文案：

- `Save memory`
- `Search memories`
- `Project context`
- `Indexed`
- `Index failed`
- `Archived memories are hidden by default`
- `Canonical memories are used as trusted project context`

避免文案：

- `Unlock your second brain`
- `Supercharge your AI workflow`
- `Magically remember everything`
- `Your knowledge universe`

## 10. MVP 不做的交互

第一版不做：

- 拖拽排序。
- 知识图谱。
- 时间线。
- 富文本编辑器。
- 多用户协作。
- 批量编辑。
- 自动合并。
- 自动删除。
- 自动覆盖 canonical。
- 独立冲突处理工作台。
- 复杂统计 dashboard。

这些能力可以在有真实使用数据后再评估。

## 11. 设计验收清单

进入前端开发前，原型需要满足：

- 用户能从空状态创建第一条 memory。
- 用户能搜索并打开 memory。
- 用户能编辑 memory。
- 用户能归档 memory。
- 用户能看到 memory 的 type、status、project、tags。
- 用户能看到 embedding/index 状态。
- 用户能理解 canonical 和 archived 的区别。
- 用户能找到 REST API endpoint、Skill 使用说明和可用能力说明。
- 用户能导出 JSON。
- 所有失败状态都有可读反馈。
- 页面没有营销化 hero 或装饰性 dashboard。

## 12. 后续设计产物

下一步可以基于这份文档继续产出：

- 低保真线框图。
- UI 文案表。
- 页面状态表。
- 前端组件清单。
- API 到 UI 的字段映射表。
