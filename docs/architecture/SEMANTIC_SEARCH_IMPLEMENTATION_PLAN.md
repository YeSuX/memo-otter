# 语义搜索实现计划

更新时间：2026-06-03

本文结合 `docs/architecture/FUNCTIONAL_MODULES.md`、`docs/architecture/MEMORY_DATA_MODEL.md`、`docs/architecture/EMBEDDING_INDEXING_IMPLEMENTATION_PLAN.md`、`docs/reviews/PROJECT_DEEP_DIVE_REPORT.md` 和当前源码，说明 Memo Otter 如何实现“语义搜索”模块。

这份计划的目标是把现有占位版 `POST /search` 升级为真正的 Vectorize 语义召回：用户和 AI 用自然语言查询 memory，系统生成 query embedding，查询 Vectorize，再通过 `memory_embeddings.vector_id` 回查 D1 源数据，最后返回可解释、可过滤、可继续追踪的搜索结果。

## 1. 当前状态摘要

当前工程已经完成语义搜索所依赖的写入链路：

- `src/services/embedding-service.ts` 已在 memory 创建或内容更新后生成 embedding。
- `src/services/embedding-service.ts` 已把向量写入 Vectorize。
- `src/repositories/embedding-repository.ts` 已保存 `vector_id -> memory_id` 的索引元数据。
- `src/repositories/embedding-repository.ts` 已提供 `findByVectorIds`，可以支持 Vectorize match 回查 D1。
- `memories.embedding_status` 已能表达 `pending`、`indexed`、`failed`、`stale`。
- `docs/architecture/EMBEDDING_INDEXING_IMPLEMENTATION_PLAN.md` 已明确搜索模块必须按 `memory_id` 去重、默认排除 archived、跳过 D1 已找不到的 vector match。

当前缺口也很明确：

- `src/routes/search.ts` 仍是临时实现，只按 title 和 tags 做字符串过滤。
- `POST /search` 没有为 query 生成 embedding。
- `POST /search` 没有调用 Vectorize query。
- `POST /search` 没有通过 vector id 回查 D1 memory。
- Search schema 只支持 `query`、`project`、`include_archived`、`limit`，缺少 `type`、`status`、`tags`。
- OpenAPI 的 Search schema 也没有描述完整返回字段。
- 创建 memory 时的 duplicate/conflict warning 仍是同 project、同 title 的简单提示，没有复用语义搜索。

## 2. 目标与非目标

### 2.1 模块目标

实现 `POST /search` 的 MVP 语义搜索能力：

- 接收自然语言 `query`。
- 使用 Workers AI 为 query 生成 embedding。
- 使用 query embedding 调用 Vectorize。
- 使用 Vectorize match id 回查 `memory_embeddings`。
- 使用 `memory_embeddings.memory_id` 回查 `memories`。
- 支持 `project`、`type`、`status`、`tags`、`limit`、`include_archived` 过滤。
- 默认排除 `status = archived` 的 memory。
- 返回 `score`、`snippet` 和 memory 元数据。
- 对结果做轻量排序：相似度分数、状态权重、类型权重、recency。
- 为创建 memory 时的疑似重复和冲突提示提供可复用 service 方法。

### 2.2 本模块不做

MVP 暂不做这些能力：

- 不做全文 BM25 或 D1 FTS fallback。
- 不做 Web UI 搜索页面。
- 不做长文本 chunk 合并展示。
- 不清理旧 Vectorize 向量。
- 不自动合并重复 memory。
- 不自动覆盖 canonical memory。
- 不把 Vectorize metadata 当作源数据。
- 不在搜索阶段修改 memory 或写 event。

## 3. 总体设计

搜索读取链路：

```text
POST /search
  -> authMiddleware
  -> validate SearchInput
  -> SearchService.search(input)
  -> Workers AI: query -> embedding
  -> Vectorize.query(embedding)
  -> EmbeddingRepository.findByVectorIds(match ids)
  -> MemoryRepository.findByIds(memory ids)
  -> D1 源数据过滤 archived/project/type/status/tags
  -> memory_id 去重
  -> snippet 生成
  -> lightweight rank
  -> return results
```

关键原则：

- D1 是源数据，最终返回字段全部来自 D1 memory。
- Vectorize match 只提供候选集合和相似度分数。
- `memory_embeddings` 是 Vectorize 和 D1 的唯一可信关联表。
- Vectorize metadata 只能作为调试或未来优化信息，不参与源数据判断。
- 搜索必须跳过已经无法回查到 D1 memory 的 vector match。
- 搜索必须按 `memory_id` 去重，避免同一 memory 的旧 vector 和新 vector 同时出现。
- 搜索默认不返回 archived，哪怕 Vectorize 仍能召回旧向量。

## 4. 目标代码结构

建议新增和调整这些文件：

```text
src/
  routes/
    search.ts              # 只做认证、解析、校验、调用 service
  services/
    search-service.ts      # 新增，承载 query embedding、Vectorize query、回查、过滤、排序
  repositories/
    memory-repository.ts   # 新增 findByIds
  schemas/
    search.ts              # 新增 SearchInput schema，也可先放在 routes/search.ts
  utils/
    search.ts              # 可选，放 snippet/rank helper
  types.ts                 # 新增 SearchInput、SearchResultItem、SearchResponse
test/
  search-service.test.ts   # 新增 service tests
  search-api.test.ts       # 可选，覆盖 route/auth/schema
```

分层边界：

- `routes/search.ts` 不直接调用 AI、Vectorize 或 SQL。
- `SearchService` 可以组合 `EmbeddingRepository` 和 `MemoryRepository`。
- `MemoryRepository` 只暴露 D1 查询能力，不知道 Vectorize match。
- `EmbeddingRepository` 只处理 `memory_embeddings`。
- snippet 和排序 helper 不触碰 Cloudflare binding。

## 5. API 设计

### 5.1 输入

`POST /search`

```json
{
  "query": "Cloudflare Vectorize indexing failure policy",
  "project": "memo-otter",
  "type": "decision",
  "status": "canonical",
  "tags": ["cloudflare", "mvp"],
  "limit": 10,
  "include_archived": false
}
```

字段规则：

| 字段 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `query` | string | 必填 | 自然语言 query，trim 后非空 |
| `project` | string | `undefined` | 使用现有 `normalizeProject` |
| `type` | string | `undefined` | 使用现有 `normalizeType` |
| `status` | `draft`/`active`/`canonical`/`archived` | `undefined` | 指定时只返回该状态 |
| `tags` | string[] | `[]` | 使用现有 `normalizeTags` |
| `limit` | number | `10` | 1 到 50 |
| `include_archived` | boolean | `false` | false 时默认排除 archived |

说明：

- 如果 `status = archived`，应隐式允许 archived 返回，即使 `include_archived` 没传。
- 如果 `status` 不是 `archived` 且 `include_archived = false`，仍按 status 精确过滤。
- tags MVP 使用“任一 tag 命中”语义，与 `listMemories` 当前行为保持一致。

### 5.2 输出

建议响应：

```json
{
  "query": "Cloudflare Vectorize indexing failure policy",
  "results": [
    {
      "id": "mem_...",
      "title": "Memo Otter indexing failure policy",
      "snippet": "Indexing failure must not delete D1 source data...",
      "project": "memo-otter",
      "type": "decision",
      "status": "canonical",
      "tags": ["cloudflare", "mvp"],
      "score": 0.8732,
      "source": "api",
      "created_at": "2026-06-03T08:00:00.000Z",
      "updated_at": "2026-06-03T08:10:00.000Z"
    }
  ],
  "meta": {
    "limit": 10,
    "candidate_count": 30,
    "returned_count": 1
  }
}
```

返回字段与 `FUNCTIONAL_MODULES.md` 对齐：

- `id`
- `title`
- `snippet`
- `project`
- `type`
- `status`
- `tags`
- `score`
- `source`
- `created_at`
- `updated_at`

额外 `meta` 只用于调试和 UI 状态，不影响核心验收。

## 6. TypeScript 类型

在 `src/types.ts` 增加：

```ts
export type SearchInput = {
  query: string;
  project?: string | null | undefined;
  type?: string | undefined;
  status?: MemoryStatus | undefined;
  tags?: string[] | undefined;
  includeArchived: boolean;
  limit: number;
};

export type SearchResultItem = {
  id: string;
  title: string;
  snippet: string;
  project: string | null;
  type: string;
  status: MemoryStatus;
  tags: string[];
  score: number;
  source: string | null;
  created_at: string;
  updated_at: string;
};

export type SearchResponse = {
  query: string;
  results: SearchResultItem[];
  meta: {
    limit: number;
    candidate_count: number;
    returned_count: number;
  };
};
```

命名说明：

- API 输出字段使用 snake_case，与 `FUNCTIONAL_MODULES.md` 和当前 D1 字段命名保持一致。
- 领域对象 `Memory` 仍保持 camelCase，不为了搜索响应改变全局模型。

## 7. Schema 实现

建议新建 `src/schemas/search.ts`：

```ts
import { z } from 'zod';
import { memoryStatusSchema } from './memory';
import { normalizeProject, normalizeTags, normalizeType } from '../utils/memory';

export const searchSchema = z
  .object({
    query: z.string().trim().min(1).max(1000),
    project: z
      .string()
      .max(120)
      .nullish()
      .transform((value) => normalizeProject(value)),
    type: z
      .string()
      .max(64)
      .optional()
      .transform((value) => (value === undefined ? undefined : normalizeType(value, 'note'))),
    status: memoryStatusSchema.optional(),
    tags: z
      .array(z.string().max(40))
      .max(20)
      .optional()
      .transform((value) => normalizeTags(value ?? [])),
    include_archived: z.boolean().optional().default(false),
    limit: z.number().int().min(1).max(50).optional().default(10)
  })
  .strict()
  .transform((value) => ({
    query: value.query,
    project: value.project,
    type: value.type,
    status: value.status,
    tags: value.tags,
    includeArchived: value.include_archived || value.status === 'archived',
    limit: value.limit
  }));
```

如果想减少文件数量，也可以先把 schema 留在 `src/routes/search.ts`。但独立 schema 更方便 route test 和 OpenAPI 对齐。

## 8. MemoryRepository 补充

当前 `MemoryRepository` 缺少批量按 id 查询。建议新增 `findByIds`：

```ts
async findByIds(ids: string[]): Promise<Memory[]> {
  if (ids.length === 0) return [];
  const uniqueIds = [...new Set(ids)];
  const placeholders = uniqueIds.map(() => '?').join(', ');
  const result = await this.db
    .prepare(`SELECT * FROM memories WHERE id IN (${placeholders})`)
    .bind(...uniqueIds)
    .all<MemoryRow>();

  return (result.results ?? []).map(memoryRowToDomain);
}
```

注意：

- D1 `IN (...)` 不保证返回顺序，排序必须在 `SearchService` 里根据 Vectorize matches 重建。
- MVP 每次查询最多取 `limit * 4` 左右候选，参数数量可控。

## 9. SearchService 实现

### 9.1 主类结构

新增 `src/services/search-service.ts`：

```ts
import { EmbeddingRepository } from '../repositories/embedding-repository';
import { MemoryRepository } from '../repositories/memory-repository';
import type { Memory, RuntimeEnv, SearchInput, SearchResponse } from '../types';

type VectorizeMatch = {
  id: string;
  score?: number;
};

export class SearchService {
  private readonly memories: MemoryRepository;
  private readonly embeddings: EmbeddingRepository;

  constructor(private readonly env: RuntimeEnv) {
    this.memories = new MemoryRepository(env.DB);
    this.embeddings = new EmbeddingRepository(env.DB);
  }

  async search(input: SearchInput): Promise<SearchResponse> {
    const queryEmbedding = await this.generateQueryEmbedding(input.query);
    const topK = Math.min(Math.max(input.limit * 4, 20), 100);
    const matches = await this.queryVectorize(queryEmbedding, topK);
    const candidateRows = await this.embeddings.findByVectorIds(matches.map((match) => match.id));
    const memories = await this.memories.findByIds(candidateRows.map((row) => row.memory_id));

    const byVectorId = new Map(candidateRows.map((row) => [row.vector_id, row]));
    const byMemoryId = new Map(memories.map((memory) => [memory.id, memory]));
    const bestByMemoryId = new Map<string, { memory: Memory; score: number; vectorId: string }>();

    for (const match of matches) {
      const embeddingRow = byVectorId.get(match.id);
      if (!embeddingRow) continue;
      const memory = byMemoryId.get(embeddingRow.memory_id);
      if (!memory) continue;
      if (!matchesFilters(memory, input)) continue;

      const score = typeof match.score === 'number' ? match.score : 0;
      const existing = bestByMemoryId.get(memory.id);
      if (!existing || score > existing.score) {
        bestByMemoryId.set(memory.id, { memory, score, vectorId: match.id });
      }
    }

    const ranked = [...bestByMemoryId.values()]
      .sort((a, b) => compareSearchCandidates(a, b))
      .slice(0, input.limit)
      .map(({ memory, score }) => toSearchResultItem(memory, score, input.query));

    return {
      query: input.query,
      results: ranked,
      meta: {
        limit: input.limit,
        candidate_count: matches.length,
        returned_count: ranked.length
      }
    };
  }

  private async generateQueryEmbedding(query: string): Promise<number[]> {
    const model = this.env.EMBEDDING_MODEL || '@cf/baai/bge-base-en-v1.5';
    const result = await this.env.AI.run(model, { text: [query] });
    return extractEmbeddingVectorOrThrow(result);
  }

  private async queryVectorize(values: number[], topK: number): Promise<VectorizeMatch[]> {
    const result = await this.env.VECTORIZE.query(values, {
      topK,
      returnMetadata: 'none'
    });
    return normalizeVectorizeMatches(result);
  }
}
```

### 9.2 Workers AI 返回解析

`EmbeddingService` 里已有 `extractEmbeddingVectorOrThrow`，但它目前是文件内函数。建议把它移到共享 helper，例如 `src/utils/embedding.ts`：

```ts
export function extractEmbeddingVectorOrThrow(result: unknown): number[] {
  if (Array.isArray(result) && result.every((item) => typeof item === 'number')) return result;
  if (result && typeof result === 'object') {
    const record = result as Record<string, unknown>;
    const data = record.data;
    if (Array.isArray(data) && Array.isArray(data[0])) {
      const vector = data[0];
      if (vector.every((item) => typeof item === 'number')) return vector;
    }
    if (Array.isArray(data) && data.every((item) => typeof item === 'number')) return data;
    const embedding = record.embedding;
    if (Array.isArray(embedding) && embedding.every((item) => typeof item === 'number')) return embedding;
  }
  throw new Error('Workers AI did not return an embedding vector');
}
```

然后 `EmbeddingService` 和 `SearchService` 共用它，避免两套解析逻辑漂移。

### 9.3 Vectorize 返回解析

Vectorize 返回结构在测试 fake 和 Cloudflare runtime 之间可能有轻微差异。建议加一个窄 helper，确保 service 主流程不散落类型判断：

```ts
function normalizeVectorizeMatches(result: unknown): VectorizeMatch[] {
  const matches = result && typeof result === 'object' ? (result as { matches?: unknown }).matches : result;
  if (!Array.isArray(matches)) return [];

  return matches
    .map((match) => {
      if (!match || typeof match !== 'object') return null;
      const record = match as Record<string, unknown>;
      const id = typeof record.id === 'string' ? record.id : null;
      if (!id) return null;
      return {
        id,
        score: typeof record.score === 'number' ? record.score : undefined
      };
    })
    .filter((match): match is VectorizeMatch => match !== null);
}
```

### 9.4 D1 过滤规则

过滤必须在回查 D1 后执行：

```ts
function matchesFilters(memory: Memory, input: SearchInput): boolean {
  if (!input.includeArchived && memory.status === 'archived') return false;
  if (input.project !== undefined && input.project !== memory.project) return false;
  if (input.type !== undefined && input.type !== memory.type) return false;
  if (input.status !== undefined && input.status !== memory.status) return false;
  if (input.tags?.length && !input.tags.some((tag) => memory.tags.includes(tag))) return false;
  return true;
}
```

为什么不能只依赖 Vectorize metadata 过滤：

- metadata 不是源数据。
- 归档时当前实现不会删除或更新旧 Vectorize 向量。
- tags/status/project/type 可能被 metadata-only patch 更新，而当前实现不会重新索引。
- D1 回查后过滤才能保证结果与最新 memory 状态一致。

### 9.5 去重规则

内容更新后旧 vector 可能仍在 Vectorize 里。MVP 不清理旧向量，因此搜索必须按 memory id 去重：

```ts
const existing = bestByMemoryId.get(memory.id);
if (!existing || score > existing.score) {
  bestByMemoryId.set(memory.id, { memory, score, vectorId: match.id });
}
```

这个规则保证：

- 同一 memory 最多返回一次。
- 如果旧 vector 和新 vector 都被召回，保留分数更高的那个。
- 最终展示内容仍来自最新 D1 memory。

后续如果要更严格，可以比较 `embeddingRow.content_hash` 与 `contentHash(memory.content)`，优先保留最新 content hash。MVP 为了避免每条结果都算 SHA-256，可以先不做。

## 10. 排序策略

排序以 Vectorize score 为主，其余权重只做轻量 tie-breaker。

推荐实现：

```ts
function compareSearchCandidates(
  a: { memory: Memory; score: number },
  b: { memory: Memory; score: number }
): number {
  const scoreDelta = b.score - a.score;
  if (Math.abs(scoreDelta) > 0.02) return scoreDelta;

  const statusDelta = statusWeight(b.memory.status) - statusWeight(a.memory.status);
  if (statusDelta !== 0) return statusDelta;

  const typeDelta = typeWeight(b.memory.type) - typeWeight(a.memory.type);
  if (typeDelta !== 0) return typeDelta;

  return b.memory.updatedAt.localeCompare(a.memory.updatedAt);
}

function statusWeight(status: Memory['status']): number {
  if (status === 'canonical') return 3;
  if (status === 'active') return 2;
  if (status === 'draft') return 1;
  return 0;
}

function typeWeight(type: string): number {
  if (type === 'decision') return 2;
  if (type === 'preference') return 2;
  if (type === 'context') return 1;
  return 0;
}
```

设计取舍：

- `0.02` 分数窗口用于避免低价值 tie-breaker 反超明显更相似的结果。
- `canonical` 优先于 `active`，`active` 优先于 `draft`。
- `decision` 和 `preference` 优先于普通 `note`。
- recency 只在相似度和业务权重接近时生效。

## 11. Snippet 生成

MVP 不需要复杂摘要模型，使用可解释的本地片段即可。

推荐规则：

- 优先在 content 中寻找 query 的关键词。
- 找不到时返回 content 前 180 字。
- 移除多余空白。
- 长度控制在 180 到 240 字符。

实现示例：

```ts
function buildSnippet(content: string, query: string, maxLength = 220): string {
  const normalized = content.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLength) return normalized;

  const terms = query
    .toLowerCase()
    .split(/\s+/)
    .map((term) => term.replace(/[^\p{L}\p{N}_-]/gu, ''))
    .filter((term) => term.length >= 2);

  const lower = normalized.toLowerCase();
  const firstHit = terms
    .map((term) => lower.indexOf(term))
    .filter((index) => index >= 0)
    .sort((a, b) => a - b)[0];

  const start = firstHit === undefined ? 0 : Math.max(0, firstHit - 60);
  const end = Math.min(normalized.length, start + maxLength);
  const prefix = start > 0 ? '...' : '';
  const suffix = end < normalized.length ? '...' : '';
  return `${prefix}${normalized.slice(start, end)}${suffix}`;
}
```

说明：

- 这里没有高亮标记，避免 API 输出混入展示层 HTML。
- 中文 query 没有空格时，这个关键词查找不一定命中，但仍会返回可读开头片段。
- 后续可以加更好的中英文 tokenization，不影响 SearchService 主流程。

## 12. SearchResult 映射

```ts
function toSearchResultItem(memory: Memory, score: number, query: string): SearchResultItem {
  return {
    id: memory.id,
    title: memory.title,
    snippet: buildSnippet(memory.content, query),
    project: memory.project,
    type: memory.type,
    status: memory.status,
    tags: memory.tags,
    score,
    source: memory.source,
    created_at: memory.createdAt,
    updated_at: memory.updatedAt
  };
}
```

注意：

- 不返回完整 `content`，避免搜索结果过重。
- 如果 UI 需要完整内容，应继续调用 `GET /memories/:id`。
- `score` 保留 Vectorize 原始分数，不把状态/类型权重混入 score，避免误导用户。

## 13. Route 改造

`src/routes/search.ts` 应改为薄 route：

```ts
import { Hono } from 'hono';
import { searchSchema } from '../schemas/search';
import { SearchService } from '../services/search-service';
import type { RuntimeEnv } from '../types';
import { authMiddleware } from '../utils/auth';
import { toJsonErrorResponse, zodToAppError } from '../utils/errors';

export const searchRoutes = new Hono<{ Bindings: RuntimeEnv }>();

searchRoutes.use('/search', authMiddleware);

searchRoutes.post('/search', async (c) => {
  try {
    const body = await c.req.json();
    const parsed = searchSchema.safeParse(body);
    if (!parsed.success) throw zodToAppError(parsed.error);

    const service = new SearchService(c.env);
    return c.json(await service.search(parsed.data));
  } catch (error) {
    return toJsonErrorResponse(error);
  }
});
```

后续可以统一去掉 route-level try/catch，交给 `app.onError`；但这不是语义搜索 MVP 的必要工作。

## 14. 疑似重复和冲突提示

`FUNCTIONAL_MODULES.md` 要求创建 memory 时复用搜索能力：

- 相似度很高时，返回疑似重复提示。
- 同 project、同 type 已有 canonical memory 且语义相近时，返回可能冲突提示。
- MVP 只提示，不自动合并、不自动覆盖。

### 14.1 推荐阈值

初始阈值建议：

| warning | 条件 |
| --- | --- |
| `possible_duplicate` | 同 project 下任意 memory 的 score >= 0.88 |
| `possible_conflict` | 同 project、同 type、status = canonical 的 memory score >= 0.82 |

阈值要通过真实数据微调。Workers AI embedding 模型和 Vectorize metric 会影响 score 分布。

### 14.2 Service 方法

建议给 `SearchService` 增加内部复用方法：

```ts
async findRelatedForNewMemory(input: {
  content: string;
  project: string | null;
  type: string;
  excludeId: string;
}): Promise<{
  duplicates: Array<{ id: string; score: number }>;
  conflicts: Array<{ id: string; score: number }>;
}> {
  const response = await this.search({
    query: input.content,
    project: input.project,
    type: undefined,
    status: undefined,
    tags: [],
    includeArchived: false,
    limit: 10
  });

  const candidates = response.results.filter((item) => item.id !== input.excludeId);
  return {
    duplicates: candidates
      .filter((item) => item.project === input.project && item.score >= 0.88)
      .map((item) => ({ id: item.id, score: item.score })),
    conflicts: candidates
      .filter(
        (item) =>
          item.project === input.project &&
          item.type === input.type &&
          item.status === 'canonical' &&
          item.score >= 0.82
      )
      .map((item) => ({ id: item.id, score: item.score }))
  };
}
```

### 14.3 MemoryService 接入顺序

当前 `MemoryService.createMemory` 的顺序是：

```text
create D1 memory
record create event
duplicateWarnings by title
indexMemory
return
```

如果要用语义搜索提示，新 memory 必须先完成索引，或者用其 content 作为 query 搜历史 memory。推荐 MVP 选择后者：

```text
create D1 memory
record create event
semantic related search using new content as query
index new memory
return warnings
```

原因：

- 不需要等新 memory 的 vector 写入后再搜索。
- 可以通过 `excludeId` 排除刚创建的 D1 memory。
- 即使新 memory 索引失败，仍然可以提示它和已有 memory 的语义关系。

接入示例：

```ts
const warnings = await this.duplicateWarnings(memory);
try {
  const related = await new SearchService(this.env).findRelatedForNewMemory({
    content: memory.content,
    project: memory.project,
    type: memory.type,
    excludeId: memory.id
  });
  warnings.push(...relatedToWarnings(related));
} catch (error) {
  // warning 查询失败不能影响创建 memory 主链路。
  console.warn('semantic duplicate check failed', error);
}
const indexing = await this.indexing.indexMemory(memory, source);
```

`relatedToWarnings` 可以映射到现有 `MemoryWarning`：

```ts
function relatedToWarnings(related: {
  duplicates: Array<{ id: string }>;
  conflicts: Array<{ id: string }>;
}): MemoryWarning[] {
  const warnings: MemoryWarning[] = [];
  if (related.duplicates.length > 0) {
    warnings.push({
      type: 'possible_duplicate',
      severity: 'info',
      message: 'similar memories already exist',
      relatedMemoryIds: related.duplicates.map((item) => item.id)
    });
  }
  if (related.conflicts.length > 0) {
    warnings.push({
      type: 'possible_conflict',
      severity: 'warning',
      message: 'a similar canonical memory exists in the same project and type',
      relatedMemoryIds: related.conflicts.map((item) => item.id)
    });
  }
  return warnings;
}
```

注意：

- 语义 warning 查询失败不应该让 `POST /memories` 失败。
- 第一版可以先只实现 `SearchService.findRelatedForNewMemory` 和测试，最后再替换 `duplicateWarnings`。
- 如果 Cloudflare AI 或 Vectorize 暂时不可用，创建 memory 仍应成功。

## 15. OpenAPI 更新

更新 `src/openapi.ts`：

```ts
SearchInput: {
  type: 'object',
  required: ['query'],
  properties: {
    query: { type: 'string', minLength: 1, maxLength: 1000 },
    project: { type: 'string', nullable: true },
    type: { type: 'string' },
    status: { type: 'string', enum: ['draft', 'active', 'canonical', 'archived'] },
    tags: { type: 'array', items: { type: 'string' } },
    include_archived: { type: 'boolean', default: false },
    limit: { type: 'integer', minimum: 1, maximum: 50, default: 10 }
  },
  additionalProperties: false
},
SearchResultItem: {
  type: 'object',
  required: ['id', 'title', 'snippet', 'type', 'status', 'tags', 'score', 'created_at', 'updated_at'],
  properties: {
    id: { type: 'string' },
    title: { type: 'string' },
    snippet: { type: 'string' },
    project: { type: 'string', nullable: true },
    type: { type: 'string' },
    status: { type: 'string', enum: ['draft', 'active', 'canonical', 'archived'] },
    tags: { type: 'array', items: { type: 'string' } },
    score: { type: 'number' },
    source: { type: 'string', nullable: true },
    created_at: { type: 'string', format: 'date-time' },
    updated_at: { type: 'string', format: 'date-time' }
  }
},
SearchResponse: {
  type: 'object',
  properties: {
    query: { type: 'string' },
    results: { type: 'array', items: { $ref: '#/components/schemas/SearchResultItem' } },
    meta: {
      type: 'object',
      properties: {
        limit: { type: 'integer' },
        candidate_count: { type: 'integer' },
        returned_count: { type: 'integer' }
      }
    }
  }
}
```

## 16. Skill 文档更新

`docs/reviews/PROJECT_DEEP_DIVE_REPORT.md` 指出 `src/skill/memo-otter-skill.md` 缺少 `search_memory` 和 `get_project_context` 的详细调用说明。

语义搜索实现后，应补充：

````md
## search_memory

Use this when the user asks you to recall prior project decisions, preferences, context, or notes.

POST `${MEMO_OTTER_BASE_URL}/search`

Body:

```json
{
  "query": "natural language question",
  "project": "optional-project",
  "type": "decision",
  "tags": ["optional-tag"],
  "limit": 10
}
```

Read `results[].snippet`, `score`, `status`, and `updated_at` before deciding whether the memory is relevant.
````

这个更新不是 Search API 通过验收的必要条件，但属于 MVP AI 入口闭环的一部分。

## 17. Fake 环境和测试准备

当前 `test/fakes.ts` 的 fake Vectorize 只有 `upsert`：

```ts
const vectorize = {
  upserts: [] as FakeVectorizeRecord[],
  async upsert(vectors: FakeVectorizeRecord[]) {
    if (options.failVectorize) throw new Error('vectorize failed');
    this.upserts.push(...vectors);
    return { count: vectors.length };
  }
};
```

需要补充 `query`：

```ts
const vectorize = {
  upserts: [] as FakeVectorizeRecord[],
  queryResults: [] as Array<{ id: string; score: number }>,
  async upsert(vectors: FakeVectorizeRecord[]) {
    if (options.failVectorize) throw new Error('vectorize failed');
    this.upserts.push(...vectors);
    return { count: vectors.length };
  },
  async query(_values: number[], options?: { topK?: number }) {
    const matches = this.queryResults.length
      ? this.queryResults
      : this.upserts.map((vector, index) => ({
          id: vector.id,
          score: 1 - index * 0.01
        }));
    return { matches: matches.slice(0, options?.topK ?? matches.length) };
  }
};
```

为了测试排序，也可以允许 `createFakeEnv({ vectorQueryResults })` 传入固定 matches。

## 18. 测试计划

新增 `test/search-service.test.ts`。

### 18.1 保存后可自然语言搜到

步骤：

1. 使用 `MemoryService.createMemory` 创建 memory。
2. 使用 `SearchService.search({ query: '...', limit: 10 })` 搜索。
3. 断言结果包含该 memory。
4. 断言结果包含 `score` 和 `snippet`。

### 18.2 project 过滤

创建两个 project 的 memory，fake Vectorize 同时返回两个 vector，搜索时传 `project: 'memo-otter'`，断言只返回目标 project。

### 18.3 type 过滤

创建 `decision` 和 `note`，搜索传 `type: 'decision'`，断言只返回 `decision`。

### 18.4 status 过滤

创建 `canonical` 和 `draft`，搜索传 `status: 'canonical'`，断言只返回 `canonical`。

### 18.5 tags 过滤

创建带不同 tags 的 memory，搜索传 `tags: ['cloudflare']`，断言只返回包含该 tag 的结果。

### 18.6 archived 默认不返回

创建 memory 后归档，fake Vectorize 仍返回旧 vector。搜索默认不传 `includeArchived`，断言结果为空；再传 `includeArchived: true`，断言能返回。

### 18.7 按 memory id 去重

模拟同一 memory 有两个 `memory_embeddings` 或两个 vector match，断言结果只返回一条。

### 18.8 排序规则

构造 score 接近的 candidates：

- `canonical` 应排在 `active` 前。
- `decision` 或 `preference` 应排在 `note` 前。
- 其他条件相同时，`updatedAt` 新的排前。

再构造 score 差距超过 `0.02` 的 candidates，断言更高相似度优先。

### 18.9 route schema

新增或扩展 API 测试：

- 无 token 访问 `/search` 返回 401。
- 空 query 返回 400。
- 未知字段返回 400。
- `limit > 50` 返回 400。
- 合法请求返回 `query/results/meta`。

## 19. 实施步骤

建议按以下顺序实现：

1. 新增 Search 类型和 schema。
2. 抽出共享 `extractEmbeddingVectorOrThrow`。
3. 给 `MemoryRepository` 增加 `findByIds`。
4. 新增 `SearchService.search`，实现 query embedding、Vectorize query、回查、过滤、去重、排序和 snippet。
5. 改造 `src/routes/search.ts`，移除 title/tag 占位搜索。
6. 给 fake Vectorize 增加 `query`。
7. 新增 SearchService 测试，覆盖验收要点。
8. 更新 OpenAPI Search schema。
9. 运行 `pnpm typecheck` 和 `pnpm test -- --run`。
10. 可选：接入创建 memory 的语义 duplicate/conflict warning。
11. 可选：补齐 `src/skill/memo-otter-skill.md` 的 `search_memory` 说明。
12. 真实 Cloudflare 环境冒烟：create -> indexed -> search -> archive exclusion。

## 20. 验收清单

与 `FUNCTIONAL_MODULES.md` 5.7 对齐：

- [x] 保存一条 memory 后，可以用自然语言搜到它。
- [x] project 过滤生效。
- [x] type 过滤生效。
- [x] status 过滤生效。
- [x] tags 过滤生效。
- [x] archived 默认不返回。
- [x] `include_archived = true` 时可以返回 archived。
- [x] 搜索结果包含 `score`。
- [x] 搜索结果包含可读 `snippet`。
- [x] 搜索结果包含 `id`、`title`、`project`、`type`、`status`、`tags`、`source`、`created_at`、`updated_at`。
- [x] 同一 memory 不会因为旧 vector 和新 vector 同时召回而重复出现。
- [x] Vectorize match 找不到 D1 memory 时会被跳过。
- [x] TypeScript typecheck 通过。
- [x] Vitest 通过。

## 21. 风险与后续优化

### 21.1 Vectorize score 阈值需要真实数据校准

重复和冲突提示的阈值不能只靠想象。初始阈值可以保守，但上线后应基于真实 memory 搜索结果微调。

### 21.2 tags JSON 过滤仍在应用层

MVP 可以接受。后续如果 tags 查询变慢，可以加 `memory_tags` 关系表或 D1 JSON 查询策略。

### 21.3 metadata-only 更新不会刷新 Vectorize metadata

搜索过滤必须以 D1 为准。后续如果要用 Vectorize metadata pre-filter，需要在 project/type/status/tags 更新时同步更新或重建 vector metadata。

### 21.4 旧向量未清理

按 memory id 去重可以保证 API 不重复返回同一 memory，但旧向量仍会占用 Vectorize 空间。后续可以增加：

- 内容更新后删除旧 vector。
- 定期 reindex/cleanup job。
- 根据 `memory_embeddings` 最新记录判断并删除过期 vector。

### 21.5 Query embedding 失败会导致搜索失败

这和创建 memory 的失败降级不同：搜索没有 D1 写入主流程，AI 失败时应返回错误。可以在错误消息中提示 `embedding failed`，但不需要返回空结果伪装成功。

## 22. 最小可交付范围

如果只做一轮实现，最小可交付范围建议锁定为：

- `SearchService.search`。
- `MemoryRepository.findByIds`。
- `POST /search` 接入 SearchService。
- Search schema 支持 `project/type/status/tags/include_archived/limit`。
- fake Vectorize query。
- 覆盖 5.7 验收要点的测试。
- OpenAPI 更新。

创建 memory 时的语义重复和冲突提示可以作为第二步接入，因为它复用 SearchService，但不是 `POST /search` 基础能力能否成立的前置条件。

## 23. 详细 TODO 列表

本节只列实现任务，不代表现在开始实现。后续执行时建议从上到下推进，每完成一个阶段就运行一次局部测试或 typecheck，避免把错误堆到最后。

### 阶段 0：实现前确认

- [x] 确认 `docs/architecture/FUNCTIONAL_MODULES.md` 中语义搜索输入输出字段没有新的变更。
- [x] 确认 `docs/reviews/PROJECT_DEEP_DIVE_REPORT.md` 中搜索相关风险仍然成立。
- [x] 确认 `docs/architecture/EMBEDDING_INDEXING_IMPLEMENTATION_PLAN.md` 中 `vector_id -> memory_embeddings -> memories` 契约没有变化。
- [x] 确认 `src/routes/search.ts` 仍是占位实现，避免覆盖已经被其他人改过的新逻辑。
- [x] 确认工作区状态，记录任何与搜索相关的未提交改动。

### 阶段 1：类型与 Schema

- [x] 在 `src/types.ts` 新增 `SearchInput` 类型。
- [x] 在 `src/types.ts` 新增 `SearchResultItem` 类型。
- [x] 在 `src/types.ts` 新增 `SearchResponse` 类型。
- [x] 确认搜索响应使用 snake_case 字段：`created_at`、`updated_at`。
- [x] 新建 `src/schemas/search.ts`。
- [x] 在 `src/schemas/search.ts` 引入 `memoryStatusSchema`。
- [x] 在 `src/schemas/search.ts` 复用 `normalizeProject`。
- [x] 在 `src/schemas/search.ts` 复用 `normalizeType`。
- [x] 在 `src/schemas/search.ts` 复用 `normalizeTags`。
- [x] 为 `query` 设置 trim、非空和最大长度限制。
- [x] 为 `project` 设置最大长度和 nullish 规范化。
- [x] 为 `type` 设置最大长度和规范化。
- [x] 为 `status` 使用已有 memory status 枚举。
- [x] 为 `tags` 设置最多 20 个、单项最长 40 个字符。
- [x] 为 `include_archived` 设置默认值 `false`。
- [x] 为 `limit` 设置默认值 `10`、范围 `1..50`。
- [x] 在 transform 中输出 camelCase service 输入：`includeArchived`。
- [x] 在 transform 中处理 `status === 'archived'` 时隐式允许 archived 返回。
- [x] 确认 schema `.strict()`，未知字段应报错。

### 阶段 2：共享 Embedding Helper

- [x] 新建 `src/utils/embedding.ts`。
- [x] 从 `src/services/embedding-service.ts` 抽出 `extractEmbeddingVectorOrThrow`。
- [x] 在 `src/utils/embedding.ts` 导出 `extractEmbeddingVectorOrThrow`。
- [x] 更新 `src/services/embedding-service.ts` 使用共享 helper。
- [x] 确认原有 indexing 测试仍覆盖 Workers AI 返回异常。
- [x] 避免同时改动 `sanitizeIndexError`，它仍留在 `EmbeddingService` 内部即可。

### 阶段 3：Repository 回查能力

- [x] 在 `MemoryRepository` 新增 `findByIds(ids: string[])`。
- [x] 对空数组直接返回 `[]`。
- [x] 对 ids 去重，避免 SQL 参数重复。
- [x] 使用 `SELECT * FROM memories WHERE id IN (...)`。
- [x] 使用 `memoryRowToDomain` 映射为 `Memory[]`。
- [x] 在代码注释或文档中明确 D1 不保证 IN 查询顺序。
- [x] 确认 `findByIds` 不做 archived/project/type/status/tags 过滤，过滤留给 `SearchService`。
- [x] 更新 fake D1，使 `SELECT * FROM memories WHERE id IN (...)` 能返回匹配 rows。

### 阶段 4：SearchService 基础骨架

- [x] 新建 `src/services/search-service.ts`。
- [x] 在 constructor 中初始化 `MemoryRepository`。
- [x] 在 constructor 中初始化 `EmbeddingRepository`。
- [x] 增加内部 `VectorizeMatch` 类型。
- [x] 实现 `generateQueryEmbedding(query)`。
- [x] 在 `generateQueryEmbedding` 中读取 `env.EMBEDDING_MODEL`。
- [x] 在 `generateQueryEmbedding` 中调用 `env.AI.run(model, { text: [query] })`。
- [x] 在 `generateQueryEmbedding` 中使用共享 `extractEmbeddingVectorOrThrow`。
- [x] 实现 `queryVectorize(values, topK)`。
- [x] 在 `queryVectorize` 中调用 `env.VECTORIZE.query`。
- [x] 初版设置 `returnMetadata: 'none'`。
- [x] 实现 `normalizeVectorizeMatches(result)`。
- [x] 确认 match 缺少 id 时跳过。
- [x] 确认 match 缺少 score 时 score 默认为 0。

### 阶段 5：SearchService 主流程

- [x] 实现 `SearchService.search(input)`。
- [x] 计算 `topK = Math.min(Math.max(input.limit * 4, 20), 100)`。
- [x] 使用 query embedding 调 Vectorize。
- [x] 从 matches 提取 vector ids。
- [x] 使用 `EmbeddingRepository.findByVectorIds(vectorIds)` 回查 embedding rows。
- [x] 从 embedding rows 提取 memory ids。
- [x] 使用 `MemoryRepository.findByIds(memoryIds)` 回查 D1 memories。
- [x] 构建 `byVectorId` map。
- [x] 构建 `byMemoryId` map。
- [x] 遍历 matches 时保持 Vectorize 返回顺序。
- [x] 跳过找不到 embedding row 的 match。
- [x] 跳过找不到 D1 memory 的 match。
- [x] 对每条 D1 memory 应用搜索过滤规则。
- [x] 按 `memory.id` 去重。
- [x] 同一 memory 多个 vector match 时保留最高 score。
- [x] 对候选结果执行轻量排序。
- [x] 截取 `input.limit` 条结果。
- [x] 映射为 `SearchResultItem`。
- [x] 返回 `{ query, results, meta }`。
- [x] `meta.limit` 返回请求 limit。
- [x] `meta.candidate_count` 返回 Vectorize matches 数量。
- [x] `meta.returned_count` 返回最终结果数量。

### 阶段 6：过滤规则

- [x] 实现 `matchesFilters(memory, input)`。
- [x] 默认排除 `status = archived`。
- [x] `includeArchived = true` 时允许 archived 进入候选。
- [x] `input.project !== undefined` 时按 project 精确过滤。
- [x] `input.type !== undefined` 时按 type 精确过滤。
- [x] `input.status !== undefined` 时按 status 精确过滤。
- [x] `input.tags.length > 0` 时按任一 tag 命中过滤。
- [x] 确认过滤只使用 D1 memory 字段。
- [x] 不依赖 Vectorize metadata 做最终过滤。

### 阶段 7：排序规则

- [x] 实现 `compareSearchCandidates(a, b)`。
- [x] 相似度分数差距大于 `0.02` 时，score 高的优先。
- [x] score 接近时，`canonical` 优先于 `active`。
- [x] score 接近时，`active` 优先于 `draft`。
- [x] score 接近时，`archived` 权重最低。
- [x] score 和 status 接近时，`decision` 优先。
- [x] score 和 status 接近时，`preference` 优先。
- [x] `context` 权重大于普通 `note`。
- [x] 其他条件相同时，`updatedAt` 新的优先。
- [x] 确认排序不修改返回的原始 `score`。

### 阶段 8：Snippet 与响应映射

- [x] 实现 `buildSnippet(content, query, maxLength)`。
- [x] snippet 应压缩连续空白。
- [x] content 短于 maxLength 时完整返回。
- [x] 优先根据 query term 定位片段。
- [x] 找不到 query term 时返回正文开头。
- [x] 长片段前后用 `...` 表示截断。
- [x] snippet 不包含 HTML 高亮。
- [x] 实现 `toSearchResultItem(memory, score, query)`。
- [x] 映射 `id`。
- [x] 映射 `title`。
- [x] 映射 `snippet`。
- [x] 映射 `project`。
- [x] 映射 `type`。
- [x] 映射 `status`。
- [x] 映射 `tags`。
- [x] 映射 `score`。
- [x] 映射 `source`。
- [x] 映射 `created_at`。
- [x] 映射 `updated_at`。
- [x] 确认搜索响应不返回完整 `content`。

### 阶段 9：Route 改造

- [x] 更新 `src/routes/search.ts`，移除 title/tag 占位搜索逻辑。
- [x] 引入 `searchSchema`。
- [x] 引入 `SearchService`。
- [x] 保留 `authMiddleware`。
- [x] route 中只负责 JSON 读取、schema 校验、service 调用和错误转换。
- [x] 继续使用 `zodToAppError`。
- [x] 继续使用 `toJsonErrorResponse`。
- [x] 返回 `SearchService.search(parsed.data)` 的结果。
- [x] 确认 route 不直接实例化 `MemoryRepository`。
- [x] 确认 route 不直接调用 AI 或 Vectorize。

### 阶段 10：Fake 环境

- [x] 给 `test/fakes.ts` 的 fake Vectorize 增加 `query` 方法。
- [x] fake `query` 默认从 `upserts` 生成 matches。
- [x] fake `query` 支持 `topK` 截断。
- [x] fake `query` 返回 `{ matches }` 结构。
- [x] 为 fake env 增加可选 `vectorQueryResults`。
- [x] 允许测试显式控制返回的 vector ids 和 scores。
- [x] 确认 fake `upsert` 行为不变。
- [x] 确认 `failVectorize` 对 upsert 的现有测试不受影响。
- [x] 如需要，增加单独 `failVectorizeQuery` 选项。
- [x] 更新 fake D1 对 `findByIds` SQL 的支持。

### 阶段 11：Service 测试

- [x] 新增 `test/search-service.test.ts`。
- [x] 测试保存一条 memory 后可以搜索到。
- [x] 断言搜索结果包含 `score`。
- [x] 断言搜索结果包含可读 `snippet`。
- [x] 测试 project 过滤。
- [x] 测试 type 过滤。
- [x] 测试 status 过滤。
- [x] 测试 tags 过滤。
- [x] 测试 archived 默认不返回。
- [x] 测试 `includeArchived = true` 返回 archived。
- [x] 测试 `status = archived` 隐式允许 archived。
- [x] 测试 Vectorize match 找不到 embedding row 时跳过。
- [x] 测试 embedding row 找不到 D1 memory 时跳过。
- [x] 测试同一 memory 多个 vector match 时只返回一次。
- [x] 测试同一 memory 多个 vector match 时保留最高 score。
- [x] 测试 score 差距明显时按 score 排序。
- [x] 测试 score 接近时 canonical 优先。
- [x] 测试 score 接近时 decision/preference 优先。
- [x] 测试其他条件相同时 recency 优先。
- [x] 测试 query embedding 返回坏结构时搜索失败。
- [x] 测试 Vectorize query 返回空 matches 时返回空结果。

### 阶段 12：API 测试

- [x] 新增 `test/search-api.test.ts`，或扩展现有 API 测试文件。
- [x] 测试无 token 访问 `/search` 返回 401。
- [x] 测试空 query 返回 400。
- [x] 测试未知字段返回 400。
- [x] 测试 `limit = 0` 返回 400。
- [x] 测试 `limit > 50` 返回 400。
- [x] 测试非法 status 返回 400。
- [x] 测试合法请求返回 `query`。
- [x] 测试合法请求返回 `results` 数组。
- [x] 测试合法请求返回 `meta`。
- [x] 测试 response item 字段是 snake_case。
- [x] 测试 response item 不包含完整 `content`。

### 阶段 13：OpenAPI 更新

- [x] 更新 `src/openapi.ts` 的 `SearchInput`。
- [x] 为 `SearchInput` 增加 `type`。
- [x] 为 `SearchInput` 增加 `status`。
- [x] 为 `SearchInput` 增加 `tags`。
- [x] 为 `SearchInput` 增加 `additionalProperties: false`。
- [x] 新增 `SearchResultItem` schema。
- [x] 更新 `SearchResponse` schema。
- [x] 在 `SearchResponse` 中增加 `query`。
- [x] 在 `SearchResponse` 中增加 `results`。
- [x] 在 `SearchResponse` 中增加 `meta`。
- [x] 确认 `/search` path response 引用新的 `SearchResponse`。
- [x] 运行 docs API 测试，确认 `/openapi.json` 仍可访问。

### 阶段 14：语义重复和冲突提示

这个阶段可以在基础搜索完成后再做。

- [x] 在 `SearchService` 增加 `findRelatedForNewMemory`。
- [x] 使用新 memory 的 content 作为 query。
- [x] 使用同 project 候选做 duplicate 判断。
- [x] 排除刚创建的 memory id。
- [x] 设置 `possible_duplicate` 初始阈值。
- [x] 设置 `possible_conflict` 初始阈值。
- [x] conflict 只关注同 project、同 type、status 为 canonical 的 memory。
- [x] 增加 `relatedToWarnings` helper。
- [x] 在 `MemoryService.createMemory` 中调用语义相关搜索。
- [x] 保留现有同标题 duplicate warning，或明确替换它。
- [x] 语义 warning 查询失败时只记录日志，不影响创建 memory。
- [x] 为 duplicate warning 增加测试。
- [x] 为 conflict warning 增加测试。
- [x] 为 warning 查询失败不阻断创建 memory 增加测试。

### 阶段 15：Skill 文档更新

这个阶段可以在 Search API 和 OpenAPI 都稳定后做。

- [x] 更新 `src/skill/memo-otter-skill.md`。
- [x] 增加 `search_memory` 说明。
- [x] 增加 `/search` 请求示例。
- [x] 说明读取 `snippet`、`score`、`status`、`updated_at` 判断相关性。
- [x] 增加 project/type/tags 过滤示例。
- [x] 增加 `get_project_context` 说明。
- [x] 确认 Skill 文档不承诺未实现的自动合并能力。

### 阶段 16：验证与质量检查

- [x] 运行 `pnpm typecheck`。
- [x] 运行 `pnpm test -- --run`。
- [x] 如有 search route 测试，确认认证路径通过。
- [x] 检查 `src/routes/search.ts` 没有保留旧 title/tag 占位逻辑。
- [x] 检查 `SearchService` 没有直接信任 Vectorize metadata。
- [x] 检查搜索结果默认不返回 archived。
- [x] 检查 `score` 是 Vectorize 原始分数。
- [x] 检查 snippet 不返回完整超长 content。
- [x] 检查 OpenAPI 和实际响应字段一致。
- [x] 检查新 helper 没有破坏 `EmbeddingService` 原有索引行为。

### 阶段 17：本地或远端冒烟

这个阶段依赖 Cloudflare remote AI 和 Vectorize 可用。

当前状态：阻塞于 Cloudflare Workers AI remote binding。用户在 2026-06-03 手动创建中文 memory 时，D1 保存成功，但 `AI.run` 返回 `Error: internal error; reference = ouqekr0c4qvajebpc10n95p5`，导致 `embeddingStatus = failed`。自动测试已覆盖 fake AI/Vectorize 下的完整搜索闭环，真实远端 indexed 冒烟需 Cloudflare AI 恢复后复测。

- [ ] 运行本地 dev server。
- [x] 创建一条 memory。
- [ ] 确认 create response 的 indexing status 为 `indexed`。
- [ ] 调用 `/search` 查询相关自然语言。
- [ ] 确认能召回刚创建的 memory。
- [ ] 确认返回 `score`。
- [ ] 确认返回可读 `snippet`。
- [ ] 创建不同 project 的 memory。
- [ ] 确认 project 过滤生效。
- [ ] 创建不同 type 的 memory。
- [ ] 确认 type 过滤生效。
- [ ] 创建不同 status 的 memory。
- [ ] 确认 status 过滤生效。
- [ ] 创建不同 tags 的 memory。
- [ ] 确认 tags 过滤生效。
- [ ] 归档一条 memory。
- [ ] 确认默认搜索不返回 archived。
- [ ] 使用 `include_archived = true` 确认可返回 archived。

### 阶段 18：完成标准

- [x] `POST /search` 已接入 Workers AI query embedding。
- [x] `POST /search` 已接入 Vectorize query。
- [x] `POST /search` 已通过 vector id 回查 D1 memory。
- [x] 所有功能过滤都基于 D1 源数据。
- [x] 搜索结果符合 `FUNCTIONAL_MODULES.md` 5.4 字段要求。
- [x] 排序规则符合 5.5 MVP 建议。
- [x] archived 默认排除。
- [x] 测试覆盖 5.7 验收要点。
- [x] OpenAPI 与实现一致。
- [x] 计划中的基础搜索阶段已全部完成。
- [x] 如执行了阶段 14，创建 memory 时已有语义 duplicate/conflict warning。
