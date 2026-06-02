# Embedding 与索引实现计划

更新时间：2026-06-03

本文结合 `docs/architecture/FUNCTIONAL_MODULES.md`、`docs/architecture/MEMORY_DATA_MODEL.md`、`docs/architecture/MEMORY_BASIC_MANAGEMENT.md`、`docs/reviews/PROJECT_DEEP_DIVE_REPORT.md` 和当前源码，说明 Memo Otter 如何实现并加固 Embedding 与索引能力。

这份计划的目标不是重新设计一个新模块，而是在现有工程基础上把索引链路做扎实：创建 memory 后生成 embedding、写入 Vectorize、记录索引元数据、维护 `embedding_status`，并确保失败时 D1 源数据不丢失。

## 1. 当前状态摘要

当前仓库已经具备 Embedding 与索引的第一版实现：

- `src/services/embedding-service.ts` 已实现 Workers AI embedding、Vectorize upsert、`memory_embeddings` 记录、`embedding_status` 更新和失败降级。
- `src/services/memory-service.ts` 已在创建 memory 后同步调用 `indexMemory`。
- `src/services/memory-service.ts` 已在内容更新后先标记 `stale`，再重新调用 `indexMemory`。
- `migrations/0001_create_memory_tables.sql` 已包含 `embedding_status` 枚举约束和 `memory_embeddings` 表。
- `test/memory-service.test.ts` 已覆盖创建后 indexed、索引失败后 memory 保留、metadata-only 编辑不重新索引。

仍需要补齐和加固：

- 明确索引链路的分层边界，避免后续搜索实现时把 Vectorize 查询和索引写入混在一起。
- 使用项目生成的 Worker 类型，减少手写 binding 类型。
- 更精确地区分 Workers AI、Vectorize、D1 metadata 三个失败阶段。
- 处理重复 reindex 时 `INSERT OR IGNORE` 可能掩盖 metadata 写入的问题。
- 为 Vectorize 写入失败、D1 metadata 写入失败、内容更新 stale 过渡增加测试。
- 为后续语义搜索提供稳定的 vector id 和回查能力。

## 2. 目标与非目标

### 2.1 模块目标

把 memory 内容转成向量并写入 Vectorize，让自然语言搜索可以通过 Vectorize 召回相关 memory。

具体目标：

- 创建 memory 后自动索引。
- 内容变化后重新索引。
- D1 保存源数据和索引元数据。
- Vectorize 只保存可重建向量。
- 任何索引失败都不能导致 memory 源数据丢失。
- API 返回可读的 indexing 状态和 warning。

### 2.2 本模块不做

本计划只覆盖 Embedding 与索引写入，不实现完整语义搜索。

不在本模块内完成：

- `POST /search` 的 Vectorize query。
- 搜索排序、snippet、score 合并。
- Web UI 索引状态展示。
- 批量 reindex endpoint。
- 长文本分块索引。
- 删除或清理旧 Vectorize 向量的后台任务。

这些会依赖本模块产出的 `memory_embeddings.vector_id`、`content_hash` 和 `embedding_model`。

## 3. 关键设计原则

### 3.1 D1 先成功，索引后执行

创建或更新 memory 时，必须先写入 D1 源数据，再执行 embedding 和 Vectorize。

原因：

- D1 是唯一源数据。
- Vectorize 是可重建索引。
- Workers AI 或 Vectorize 失败时，用户保存的 memory 仍然存在。

目标流程：

```text
POST /memories
  -> validate input
  -> INSERT memories embedding_status = pending
  -> record create event
  -> generate embedding
  -> upsert Vectorize
  -> INSERT/UPSERT memory_embeddings
  -> UPDATE memories embedding_status = indexed
  -> record index event
```

失败流程：

```text
POST /memories
  -> INSERT memories embedding_status = pending
  -> embedding/vectorize/metadata failed
  -> UPDATE memories embedding_status = failed
  -> record index_failed event
  -> return memory + indexing failure + warning
```

### 3.2 `embedding_status` 表示当前可用性

`memories.embedding_status` 是当前 memory 的索引状态。

状态语义：

| 状态 | 含义 | 触发时机 |
| --- | --- | --- |
| `pending` | 已保存，等待索引 | 创建 memory 后、索引前 |
| `indexed` | embedding 和 Vectorize 写入成功 | 索引成功后 |
| `failed` | embedding、Vectorize 或 D1 metadata 写入失败 | 索引失败后 |
| `stale` | 内容已更新，但新索引尚未完成 | content patch 写入 D1 后、重新索引前 |

### 3.3 `memory_embeddings` 记录索引事实

`memory_embeddings` 不保存向量值，只保存“D1 memory 与 Vectorize vector 的关系”。

每条记录应该回答：

- 哪个 memory？
- 哪个 chunk？
- 当时索引的 content hash 是什么？
- 用了哪个 embedding model？
- Vectorize 中的 vector id 是什么？
- 什么时候创建的？

### 3.4 vector id 必须稳定且短

Vectorize vector id 应该由 memory id、chunk index、content hash 构成。当前实现已经使用：

```ts
export function buildVectorId(memoryId: string, hash: string, chunkIndex = 0): string {
  const compactMemoryId = memoryId.replace(/^mem_/, '').replace(/-/g, '').slice(0, 32);
  return `m:${compactMemoryId}:c:${chunkIndex}:h:${hash.slice(0, 12)}`;
}
```

这个格式的好处：

- 同一 memory 同一内容会生成同一个 vector id。
- 内容变化会生成新 vector id。
- id 足够短，适合 Vectorize。
- 搜索回查时可以通过 `memory_embeddings.vector_id` 找回 memory。

### 3.5 MVP 按整条 memory 索引

MVP 不做长文本分块，每条 memory 生成一个 embedding：

```text
chunk_index = 0
```

后续如果要做长文本分块，只需要扩展：

- `buildEmbeddableMemoryChunks(memory)`
- `buildVectorId(memory.id, hash, chunkIndex)`
- `memory_embeddings` 多条记录
- 搜索结果按 `memory_id` 去重

## 4. 目标代码结构

继续沿用现有分层：

```text
src/
  services/
    memory-service.ts
    embedding-service.ts
    event-service.ts
  repositories/
    memory-repository.ts
    embedding-repository.ts
    event-repository.ts
  utils/
    memory.ts
  types.ts
```

职责边界：

- `MemoryService`：决定什么时候索引。
- `EmbeddingService`：执行 embedding/indexing 流程。
- `EmbeddingRepository`：保存和查询索引元数据。
- `MemoryRepository`：更新 `embedding_status`。
- `EventService`：记录 `index` 和 `index_failed`。
- `utils/memory.ts`：构造 hash、vector id、可嵌入文本。

不要让 route 层直接调用 Workers AI、Vectorize 或 D1 SQL。

## 5. 数据模型实现

当前 migration 已经满足 MVP：

```sql
CREATE TABLE IF NOT EXISTS memory_embeddings (
  id TEXT PRIMARY KEY,
  memory_id TEXT NOT NULL,
  chunk_index INTEGER NOT NULL DEFAULT 0,
  content_hash TEXT NOT NULL,
  embedding_model TEXT NOT NULL,
  vector_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(memory_id, chunk_index, content_hash),
  UNIQUE(vector_id),
  FOREIGN KEY(memory_id) REFERENCES memories(id) ON DELETE CASCADE
);
```

建议保持该结构，不需要新 migration。

需要注意的是：当前 `EmbeddingRepository.createEmbeddingRecord` 使用 `INSERT OR IGNORE`。这会避免重复索引同内容时报唯一约束错误，但也可能掩盖 metadata 未写入的问题。

建议改成更明确的 upsert 语义：

```ts
async upsertEmbeddingRecord(row: MemoryEmbeddingRow): Promise<MemoryEmbeddingRow> {
  await this.db
    .prepare(
      `INSERT INTO memory_embeddings (
        id, memory_id, chunk_index, content_hash, embedding_model, vector_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(memory_id, chunk_index, content_hash) DO UPDATE SET
        embedding_model = excluded.embedding_model,
        vector_id = excluded.vector_id,
        created_at = excluded.created_at`
    )
    .bind(row.id, row.memory_id, row.chunk_index, row.content_hash, row.embedding_model, row.vector_id, row.created_at)
    .run();
  return row;
}
```

说明：

- 同一 memory、同一 chunk、同一 content hash 被重复索引时，更新元数据而不是静默忽略。
- `vector_id` 仍受唯一约束保护。
- 如果未来同 content hash 但 model 变化，需要考虑把唯一约束升级为 `(memory_id, chunk_index, content_hash, embedding_model)`，但 MVP 暂不做模型迁移。

## 6. EmbeddingService 目标实现

### 6.1 Binding 类型

当前代码手写了 `AiBinding` 和 `VectorizeBinding`。项目已经生成 `worker-configuration.d.ts`，`RuntimeEnv` 里已有：

```ts
export type RuntimeEnv = Env & { AUTH_TOKEN: string };
```

因此可以直接使用：

```ts
private async generateEmbedding(model: string, text: string): Promise<number[]> {
  const result = await this.env.AI.run(model, { text: [text] });
  return extractEmbeddingVectorOrThrow(result);
}
```

Vectorize upsert 可以直接写：

```ts
await this.env.VECTORIZE.upsert([
  {
    id: vectorId,
    values: embedding,
    metadata: {
      memory_id: memory.id,
      project: memory.project ?? '',
      scope: memory.scope,
      type: memory.type,
      status: memory.status,
      chunk_index: 0,
      content_hash: hash
    }
  }
]);
```

注意：本地生成类型里 `VectorizeVectorMetadataValue` 不包含 `null`，所以 metadata 里不要传 `project: null`。建议改成空字符串或干脆省略。

### 6.2 Embeddable text

当前 `buildEmbeddableMemoryText` 已经合理：

```ts
export function buildEmbeddableMemoryText(memory: Memory): string {
  return [
    `Title: ${memory.title}`,
    `Project: ${memory.project ?? ''}`,
    `Scope: ${memory.scope}`,
    `Type: ${memory.type}`,
    `Tags: ${memory.tags.join(', ')}`,
    'Content:',
    memory.content
  ].join('\n');
}
```

建议保留这个格式，因为它把 title、project、type、tags 注入 embedding 输入，能帮助自然语言查询召回相关 memory。

### 6.3 目标 `indexMemory`

建议把失败阶段拆得更明确：

```ts
async indexMemory(memory: Memory, source: string | null): Promise<MemoryIndexState> {
  const model = this.env.EMBEDDING_MODEL || '@cf/baai/bge-base-en-v1.5';
  const hash = await contentHash(memory.content);
  const vectorId = buildVectorId(memory.id, hash);
  const createdAt = nowIso();

  let embedding: number[];

  try {
    embedding = await this.generateEmbedding(model, buildEmbeddableMemoryText(memory));
  } catch (error) {
    return this.failIndex(memory.id, model, hash, source, 'embedding', error);
  }

  try {
    await this.env.VECTORIZE.upsert([
      {
        id: vectorId,
        values: embedding,
        metadata: {
          memory_id: memory.id,
          project: memory.project ?? '',
          scope: memory.scope,
          type: memory.type,
          status: memory.status,
          chunk_index: 0,
          content_hash: hash
        }
      }
    ]);
  } catch (error) {
    return this.failIndex(memory.id, model, hash, source, 'vectorize', error);
  }

  try {
    await this.embeddings.upsertEmbeddingRecord({
      id: createEmbeddingId(),
      memory_id: memory.id,
      chunk_index: 0,
      content_hash: hash,
      embedding_model: model,
      vector_id: vectorId,
      created_at: createdAt
    });
    await this.memories.updateEmbeddingStatus(memory.id, 'indexed');
  } catch (error) {
    return this.failIndex(memory.id, model, hash, source, 'd1_metadata', error);
  }

  const state: MemoryIndexState = {
    status: 'indexed',
    embeddingModel: model,
    vectorId,
    contentHash: hash,
    indexedAt: createdAt,
    failure: null
  };
  await this.events.recordIndexEvent(memory.id, state, source);
  return state;
}
```

### 6.4 目标 `failIndex`

失败处理要统一，保证 D1 源数据保留：

```ts
private async failIndex(
  memoryId: string,
  model: string,
  hash: string,
  source: string | null,
  stage: NonNullable<MemoryIndexState['failure']>['stage'],
  error: unknown
): Promise<MemoryIndexState> {
  const failure = {
    stage,
    message: sanitizeIndexError(error)
  };

  await this.memories.updateEmbeddingStatus(memoryId, 'failed');
  await this.events.recordIndexFailedEvent(memoryId, failure, source);

  return {
    status: 'failed',
    embeddingModel: model,
    vectorId: null,
    contentHash: hash,
    indexedAt: null,
    failure
  };
}
```

错误摘要要避免保存堆栈或控制字符：

```ts
function sanitizeIndexError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 300);
}
```

### 6.5 Embedding 输出解析

Workers AI embedding 结果在当前生成类型中是：

```ts
type AiTextEmbeddingsOutput = {
  shape: number[];
  data: number[][];
};
```

当前代码已经兼容多种返回形态。建议保留兼容逻辑，但把函数改成 throw 版本，调用点更清楚：

```ts
function extractEmbeddingVectorOrThrow(result: unknown): number[] {
  if (Array.isArray(result) && result.every((item) => typeof item === 'number')) {
    return result;
  }

  if (result && typeof result === 'object') {
    const record = result as Record<string, unknown>;
    if (Array.isArray(record.data) && Array.isArray(record.data[0])) {
      const vector = record.data[0];
      if (vector.every((item) => typeof item === 'number')) return vector;
    }
    if (Array.isArray(record.embedding) && record.embedding.every((item) => typeof item === 'number')) {
      return record.embedding;
    }
  }

  throw new Error('Workers AI did not return an embedding vector');
}
```

## 7. MemoryService 集成计划

### 7.1 创建后索引

当前 `createMemory` 已经做了正确事情：

```ts
await this.memories.createMemory(...);
await this.events.recordCreateEvent(memory, source);
const warnings = await this.duplicateWarnings(memory);
const indexing = await this.indexing.indexMemory(memory, source);
const saved = (await this.memories.getMemoryById(memory.id)) ?? memory;
```

建议保留同步索引。MVP 同步索引的优点：

- API 响应能立即返回真实索引状态。
- 便于本地和远端冒烟测试。
- 失败路径更容易调试。

后续如果响应延迟不可接受，再引入 `ctx.waitUntil()` 或队列。但那会影响 API 响应语义，不应在本模块第一轮做。

### 7.2 内容更新后 stale -> indexed

当前逻辑已经符合目标：

```ts
if (input.content !== undefined && input.content.trim() !== existing.content) {
  const nextContent = input.content.trim();
  patch.content = nextContent;
  patch.embedding_status = 'stale';
  before.contentHash = await contentHash(existing.content);
  before.embeddingStatus = existing.embeddingStatus;
  after.contentHash = await contentHash(nextContent);
  after.embeddingStatus = 'stale';
  contentChanged = true;
}
```

更新 D1 后重新索引：

```ts
if (contentChanged) {
  indexing = await this.indexing.indexMemory(updated, source);
  memory = (await this.memories.getMemoryById(id)) ?? updated;
}
```

建议新增测试确认 stale 过渡发生过。因为同步索引很快完成，最终 API 只能看到 `indexed` 或 `failed`，可以通过 update event 的 `after.embeddingStatus = 'stale'` 验证。

### 7.3 归档不删除向量

MVP 归档后不删除 Vectorize 向量。原因：

- D1 仍是源数据。
- 归档默认由搜索回查 D1 后过滤。
- 立即删除向量会增加失败路径。

后续语义搜索实现必须保证：

```text
Vectorize matches -> memory_embeddings -> memories -> filter status != archived
```

## 8. 旧向量处理策略

内容变化后，新的 content hash 会产生新的 vector id。旧 vector 仍留在 Vectorize。

MVP 策略：

- 不主动删除旧 vector。
- 搜索时按 `memory_id` 去重。
- 优先保留与最新 `memory_embeddings` 记录匹配的 vector。
- 如果旧 vector 被召回，D1 回查仍返回最新 memory 内容，不会丢数据。

后续增强可以增加清理：

```ts
async deleteOldVectors(memoryId: string, keepVectorId: string): Promise<void> {
  const embeddings = await this.embeddings.findByMemoryId(memoryId);
  const staleVectorIds = embeddings
    .map((item) => item.vector_id)
    .filter((vectorId) => vectorId !== keepVectorId);

  if (staleVectorIds.length > 0) {
    await this.env.VECTORIZE.deleteByIds(staleVectorIds);
  }
}
```

但第一轮不建议启用，因为 Vectorize delete 失败不应影响主索引成功语义，且需要额外事件记录。

## 9. 失败处理计划

### 9.1 失败分类

失败阶段固定为：

- `embedding`：Workers AI 调用失败或返回格式不符合预期。
- `vectorize`：Vectorize upsert 失败。
- `d1_metadata`：`memory_embeddings` 写入或 `embedding_status` 更新失败。

### 9.2 API 响应

创建或内容更新索引失败时，API 返回：

```json
{
  "memory": {
    "embeddingStatus": "failed"
  },
  "indexing": {
    "status": "failed",
    "embeddingModel": "@cf/baai/bge-base-en-v1.5",
    "vectorId": null,
    "contentHash": "...",
    "indexedAt": null,
    "failure": {
      "stage": "embedding",
      "message": "..."
    }
  },
  "warnings": [
    {
      "type": "index_failed",
      "severity": "warning",
      "message": "..."
    }
  ]
}
```

### 9.3 Event 记录

索引成功：

```ts
await this.events.recordIndexEvent(memory.id, state, source);
```

索引失败：

```ts
await this.events.recordIndexFailedEvent(memory.id, failure, source);
```

Event 写失败不应回滚主流程。当前 `EventService.safeCreate` 已经满足这个要求。

## 10. 测试计划

### 10.1 已有测试保留

保留当前测试：

- creates, lists, updates, and archives a memory
- keeps memory when indexing fails
- does not reindex metadata-only edits

### 10.2 新增 Workers AI 失败测试

当前已有 `failAi`，建议断言 failure stage：

```ts
it('marks memory failed when Workers AI embedding fails', async () => {
  const env = createFakeEnv({ failAi: true });
  const service = new MemoryService(env);

  const result = await service.createMemory({ content: 'AI failure should not delete memory.' });

  expect(result.memory.embeddingStatus).toBe('failed');
  expect(result.indexing.status).toBe('failed');
  expect(result.indexing.failure?.stage).toBe('embedding');

  const detail = await service.getMemory(result.memory.id);
  expect(detail.memory.content).toContain('AI failure');
  expect(detail.events.some((event) => event.eventType === 'index_failed')).toBe(true);
});
```

### 10.3 新增 Vectorize 失败测试

`test/fakes.ts` 已支持 `failVectorize`：

```ts
it('marks memory failed when Vectorize upsert fails', async () => {
  const env = createFakeEnv({ failVectorize: true });
  const service = new MemoryService(env);

  const result = await service.createMemory({ content: 'Vectorize failure should not delete memory.' });

  expect(result.memory.embeddingStatus).toBe('failed');
  expect(result.indexing.failure?.stage).toBe('vectorize');

  const list = await service.listMemories({ includeArchived: false, limit: 20, offset: 0 });
  expect(list.items).toHaveLength(1);
});
```

### 10.4 新增内容更新重新索引测试

断言 content hash 和 vector id 变化：

```ts
it('reindexes when content changes', async () => {
  const env = createFakeEnv();
  const service = new MemoryService(env);

  const created = await service.createMemory({ content: 'Original content.' });
  const updated = await service.updateMemory(created.memory.id, {
    content: 'Updated content for a new embedding.'
  });

  expect(updated.memory.embeddingStatus).toBe('indexed');
  expect(updated.indexing.vectorId).not.toBe(created.indexing.vectorId);
  expect(updated.indexing.contentHash).not.toBe(created.indexing.contentHash);
});
```

### 10.5 新增 D1 metadata 失败测试

可以扩展 fake D1：

```ts
export function createFakeEnv(options: {
  failAi?: boolean;
  failVectorize?: boolean;
  failEmbeddingMetadata?: boolean;
} = {}): RuntimeEnv {
  const db = new InMemoryD1({ failEmbeddingMetadata: options.failEmbeddingMetadata });
  // ...
}
```

在 fake statement 中模拟：

```ts
if (sql.startsWith('insert into memory_embeddings') && this.db.failEmbeddingMetadata) {
  throw new Error('metadata write failed');
}
```

测试：

```ts
it('marks memory failed when embedding metadata write fails', async () => {
  const env = createFakeEnv({ failEmbeddingMetadata: true });
  const service = new MemoryService(env);

  const result = await service.createMemory({ content: 'Metadata write failure.' });

  expect(result.memory.embeddingStatus).toBe('failed');
  expect(result.indexing.failure?.stage).toBe('d1_metadata');
});
```

### 10.6 新增 `getIndexState` 测试

确保详情页能返回最新 embedding 元数据：

```ts
it('returns latest index state in memory detail', async () => {
  const env = createFakeEnv();
  const service = new MemoryService(env);

  const created = await service.createMemory({ content: 'Index state detail.' });
  const detail = await service.getMemory(created.memory.id);

  expect(detail.indexing.status).toBe('indexed');
  expect(detail.indexing.embeddingModel).toBe('@cf/baai/bge-base-en-v1.5');
  expect(detail.indexing.vectorId).toBe(created.indexing.vectorId);
});
```

## 11. 实施步骤

### 第一步：小幅重构 EmbeddingService

目标：

- 移除手写 `AiBinding` 和 `VectorizeBinding`。
- 使用 `this.env.AI` 和 `this.env.VECTORIZE` 的生成类型。
- 把失败阶段从 `classifyIndexFailure` 猜测改成显式 stage。
- metadata 中不再传 `null`。

涉及文件：

- `src/services/embedding-service.ts`

完成标准：

- `pnpm typecheck` 通过。
- 现有测试通过。

### 第二步：改造 EmbeddingRepository 写入语义

目标：

- 把 `createEmbeddingRecord` 改成 `upsertEmbeddingRecord`。
- 或保留原方法名，但内部改成明确 upsert。

涉及文件：

- `src/repositories/embedding-repository.ts`
- `src/services/embedding-service.ts`
- `test/fakes.ts`

完成标准：

- 重复索引同内容不会报错。
- metadata 写入失败可以被测试模拟。

### 第三步：补齐失败测试

目标：

- Workers AI 失败 stage 为 `embedding`。
- Vectorize 失败 stage 为 `vectorize`。
- D1 metadata 失败 stage 为 `d1_metadata`。
- 失败时 D1 memory 仍存在。

涉及文件：

- `test/memory-service.test.ts`
- `test/fakes.ts`

完成标准：

- 新增测试通过。
- 失败 warning 和 event 都能观察到。

### 第四步：补齐重新索引测试

目标：

- content 更新触发新 content hash。
- content 更新触发新 vector id。
- tags/metadata-only 更新不触发新 vector id。

涉及文件：

- `test/memory-service.test.ts`

完成标准：

- 内容更新测试通过。
- 原 metadata-only 测试仍通过。

### 第五步：远端冒烟

目标：

- 真实 Workers AI 能生成 embedding。
- 真实 Vectorize 能 upsert。
- D1 中有 `memory_embeddings` 记录。

建议命令：

```bash
source /Users/suxiong/.zshrc
pnpm typecheck
pnpm test -- --run
pnpm dev
```

本地创建测试：

```bash
curl -sS http://localhost:8787/memories \
  -H 'Authorization: Bearer local-dev-token' \
  -H 'Content-Type: application/json' \
  -d '{
    "content": "Memo Otter embedding smoke test uses Workers AI and Vectorize.",
    "project": "test-memo-otter",
    "type": "note",
    "tags": ["test", "embedding"]
  }'
```

检查 detail：

```bash
curl -sS http://localhost:8787/memories/<memory-id> \
  -H 'Authorization: Bearer local-dev-token'
```

预期：

- `memory.embeddingStatus = indexed`
- `indexing.embeddingModel` 非空
- `indexing.vectorId` 非空
- `indexing.contentHash` 非空
- events 中包含 `create` 和 `index`

## 12. 验收标准

本模块完成后必须满足：

- 创建 memory 后，初始 D1 写入状态为 `pending`。
- 索引成功后，memory 最终状态为 `indexed`。
- Workers AI 被调用并返回 embedding vector。
- Vectorize 中写入对应 vector。
- `memory_embeddings` 中保存 `vector_id`、`embedding_model`、`content_hash`。
- 内容更新后会重新索引，新的 content hash 和 vector id 不同。
- metadata/tags-only 更新不会重新索引。
- Workers AI 失败时，D1 memory 不丢失，状态为 `failed`。
- Vectorize 失败时，D1 memory 不丢失，状态为 `failed`。
- D1 metadata 写入失败时，D1 memory 不丢失，状态为 `failed`。
- 失败响应包含可读 `failure.message` 和 `index_failed` warning。
- Memory detail 能返回最新 indexing 状态。
- `pnpm typecheck` 通过。
- `pnpm test -- --run` 通过。

## 13. 详细 TODO 列表

本 TODO 列表用于跟踪完成 Embedding 与索引计划所需的全部阶段。执行时建议从上到下推进，每完成一个任务后再勾选，避免实现、测试和文档状态脱节。

### 阶段 0：实现前确认

- [ ] 阅读 `docs/reviews/PROJECT_DEEP_DIVE_REPORT.md` 中与 Embedding、索引、搜索差距有关的章节。
- [ ] 阅读 `src/services/embedding-service.ts`，确认当前 Workers AI、Vectorize、D1 metadata 写入流程。
- [ ] 阅读 `src/services/memory-service.ts`，确认创建和内容更新时触发索引的位置。
- [ ] 阅读 `src/repositories/embedding-repository.ts`，确认 `memory_embeddings` 写入和查询能力。
- [ ] 阅读 `migrations/0001_create_memory_tables.sql`，确认无需新增 migration。
- [ ] 检查 `worker-configuration.d.ts` 中 `AI` 和 `VECTORIZE` binding 类型。
- [ ] 确认 `wrangler.jsonc` 中 `EMBEDDING_MODEL`、`AI`、`VECTORIZE` 配置仍符合当前环境。
- [ ] 记录当前基线：运行 `pnpm typecheck`。
- [ ] 记录当前基线：运行 `pnpm test -- --run`。

### 阶段 1：加固 EmbeddingService 类型边界

- [ ] 删除 `src/services/embedding-service.ts` 中手写的 `AiBinding` 类型。
- [ ] 删除 `src/services/embedding-service.ts` 中手写的 `VectorizeBinding` 类型。
- [ ] 改用 `this.env.AI.run(...)` 调 Workers AI。
- [ ] 改用 `this.env.VECTORIZE.upsert(...)` 写 Vectorize。
- [ ] 检查 `RuntimeEnv` 类型是否足以覆盖 `AI`、`VECTORIZE`、`EMBEDDING_MODEL`。
- [ ] 确认 `generateEmbedding` 的输入仍为 `{ text: [text] }`。
- [ ] 确认默认 embedding model 仍为 `@cf/baai/bge-base-en-v1.5`。
- [ ] 保留或增强 `extractEmbeddingVector` 对 `data: number[][]` 的解析。
- [ ] 给 embedding 返回格式异常保留清晰错误：`Workers AI did not return an embedding vector`。
- [ ] 运行 `pnpm typecheck`，确保 Cloudflare binding 类型通过。

### 阶段 2：整理 Vectorize upsert 输入

- [ ] 确认 `buildVectorId(memory.id, hash)` 仍作为唯一 vector id 来源。
- [ ] 确认 `contentHash(memory.content)` 基于原始 memory content，而不是 embeddable text。
- [ ] 确认 `buildEmbeddableMemoryText(memory)` 包含 title、project、scope、type、tags、content。
- [ ] 把 Vectorize metadata 中的 `project: memory.project` 改成非 null 值，例如 `memory.project ?? ''`。
- [ ] 确认 Vectorize metadata 不包含 `null`。
- [ ] 确认 metadata 中保存 `memory_id`。
- [ ] 确认 metadata 中保存 `scope`。
- [ ] 确认 metadata 中保存 `type`。
- [ ] 确认 metadata 中保存 `status`。
- [ ] 确认 metadata 中保存 `chunk_index: 0`。
- [ ] 确认 metadata 中保存 `content_hash`。
- [ ] 不在本阶段加入 tags metadata，避免和 tags_json 源数据产生双写不一致。

### 阶段 3：显式区分失败阶段

- [ ] 将当前基于错误 message 猜测 stage 的 `classifyIndexFailure` 改为显式传入 stage。
- [ ] 为 Workers AI 调用包裹独立 `try/catch`。
- [ ] Workers AI 调用失败时返回 `stage = 'embedding'`。
- [ ] Workers AI 返回格式异常时返回 `stage = 'embedding'`。
- [ ] 为 Vectorize upsert 包裹独立 `try/catch`。
- [ ] Vectorize upsert 失败时返回 `stage = 'vectorize'`。
- [ ] 为 `memory_embeddings` 写入包裹独立 `try/catch`。
- [ ] `memory_embeddings` 写入失败时返回 `stage = 'd1_metadata'`。
- [ ] 为 `memories.embedding_status = indexed` 更新包裹在 D1 metadata 阶段内。
- [ ] `embedding_status = indexed` 更新失败时返回 `stage = 'd1_metadata'`。
- [ ] 抽出 `failIndex(...)` 私有方法统一处理失败状态。
- [ ] 抽出 `sanitizeIndexError(...)`，移除控制字符并限制错误摘要长度。
- [ ] 确认失败时会调用 `memories.updateEmbeddingStatus(memoryId, 'failed')`。
- [ ] 确认失败时会调用 `events.recordIndexFailedEvent(...)`。
- [ ] 确认失败时不会删除 D1 memory。

### 阶段 4：调整 EmbeddingRepository 写入语义

- [ ] 决定保留方法名 `createEmbeddingRecord` 还是改名为 `upsertEmbeddingRecord`。
- [ ] 如果改名，更新 `EmbeddingService` 调用点。
- [ ] 把 `INSERT OR IGNORE` 改成显式 `ON CONFLICT(memory_id, chunk_index, content_hash) DO UPDATE`。
- [ ] 确认重复索引同一 content hash 时不会静默丢失新的 `created_at`。
- [ ] 确认重复索引同一 content hash 时不会静默丢失新的 `embedding_model`。
- [ ] 确认 `UNIQUE(vector_id)` 仍然保护 vector id 冲突。
- [ ] 更新 `test/fakes.ts`，支持新的 SQL 形态。
- [ ] 为 fake D1 的 embedding metadata 写入逻辑保留唯一约束模拟。
- [ ] 运行现有测试，确认 repository SQL 改动没有破坏旧用例。

### 阶段 5：保持 MemoryService 触发规则

- [ ] 确认 `createMemory` 仍先写 D1 memory，再调用 `indexMemory`。
- [ ] 确认创建 memory 初始 `embeddingStatus` 为 `pending`。
- [ ] 确认创建索引成功后重新读取 saved memory，返回 `indexed` 状态。
- [ ] 确认创建索引失败后返回 saved memory，状态为 `failed`。
- [ ] 确认创建索引失败会追加 `index_failed` warning。
- [ ] 确认 `updateMemory` 只有 content 变化时设置 `embedding_status = 'stale'`。
- [ ] 确认 `updateMemory` 只有 content 变化时调用 `indexMemory`。
- [ ] 确认 tags-only 更新不重新索引。
- [ ] 确认 metadata-only 更新不重新索引。
- [ ] 确认 project/type/status 变化暂不重新索引。
- [ ] 确认 archive 不触发重新索引。
- [ ] 确认 canonical 编辑 warning 仍然保留。

### 阶段 6：扩展测试 fake 环境

- [ ] 为 fake AI 保留正常返回 `{ data: [[0.1, 0.2, 0.3]] }`。
- [ ] 为 fake AI 增加返回格式异常选项，例如 `badAiShape`。
- [ ] 保留 `failAi` 模拟 Workers AI 抛错。
- [ ] 保留 `failVectorize` 模拟 Vectorize upsert 抛错。
- [ ] 增加 `failEmbeddingMetadata` 模拟 `memory_embeddings` 写入失败。
- [ ] 如有必要，增加 `failEmbeddingStatusUpdate` 模拟 `embedding_status = indexed` 更新失败。
- [ ] 让 fake Vectorize 记录 upsert 的 vector id，方便测试断言。
- [ ] 让 fake Vectorize 记录 upsert metadata，方便测试 metadata 不含 null。
- [ ] 更新 fake D1 对新 upsert SQL 的识别。
- [ ] 确认 fake D1 查询最新 embedding 仍按 `created_at DESC` 排序。

### 阶段 7：补齐单元与服务测试

- [ ] 新增 Workers AI 抛错时 memory 保留、状态 failed、stage 为 `embedding` 的测试。
- [ ] 新增 Workers AI 返回格式异常时 stage 为 `embedding` 的测试。
- [ ] 新增 Vectorize upsert 失败时 memory 保留、状态 failed、stage 为 `vectorize` 的测试。
- [ ] 新增 D1 embedding metadata 写入失败时 memory 保留、状态 failed、stage 为 `d1_metadata` 的测试。
- [ ] 新增 `embedding_status = indexed` 更新失败时 stage 为 `d1_metadata` 的测试，如 fake 支持。
- [ ] 新增 content 更新后重新索引的测试。
- [ ] 在 content 更新测试中断言新旧 `contentHash` 不同。
- [ ] 在 content 更新测试中断言新旧 `vectorId` 不同。
- [ ] 在 content 更新测试中断言最终 `embeddingStatus = indexed`。
- [ ] 新增 detail 返回最新 indexing state 的测试。
- [ ] 新增 metadata-only 更新不重新索引的断言，保留已有覆盖。
- [ ] 新增 tags-only 更新不重新索引的断言，保留已有覆盖。
- [ ] 新增 Vectorize metadata 不包含 null 的测试。
- [ ] 新增 `index` event 写入成功的测试。
- [ ] 新增 `index_failed` event 写入成功的测试。
- [ ] 新增失败 warning 文案存在且可读的测试。

### 阶段 8：类型检查与自动化验证

- [ ] 运行 `pnpm typecheck`。
- [ ] 修复所有 TypeScript 类型错误。
- [ ] 运行 `pnpm test -- --run`。
- [ ] 修复所有测试失败。
- [ ] 检查测试数量是否覆盖新增失败路径。
- [ ] 检查没有跳过的测试。
- [ ] 检查没有使用 `.only`。
- [ ] 检查没有新增无关快照或临时文件。
- [ ] 运行 `git diff --check`，确认没有尾随空格。

### 阶段 9：本地 Wrangler 冒烟

- [ ] 确认 `.dev.vars` 中有本地 `AUTH_TOKEN`。
- [ ] 确认 `wrangler.jsonc` 中 AI 和 Vectorize binding 可用于本地 remote 调用。
- [ ] 运行 `pnpm dev`。
- [ ] 调用 `GET /health`，确认 `db`、`ai`、`vectorize` binding 存在。
- [ ] 调用 `POST /memories` 创建测试 memory。
- [ ] 确认创建响应中 `indexing.status = indexed`。
- [ ] 确认创建响应中 `indexing.embeddingModel` 非空。
- [ ] 确认创建响应中 `indexing.vectorId` 非空。
- [ ] 确认创建响应中 `indexing.contentHash` 非空。
- [ ] 调用 `GET /memories/:id`。
- [ ] 确认 detail events 包含 `create`。
- [ ] 确认 detail events 包含 `index`。
- [ ] 调用 `PATCH /memories/:id` 更新 content。
- [ ] 确认更新响应中 vector id 改变。
- [ ] 调用 `PATCH /memories/:id` 只更新 tags。
- [ ] 确认 tags-only 更新响应中 vector id 不变。
- [ ] 归档测试 memory，避免污染默认列表。

### 阶段 10：远端 Cloudflare 冒烟

- [ ] 确认远端 `AUTH_TOKEN` secret 已配置。
- [ ] 确认远端 D1 migration 已应用。
- [ ] 确认远端 Vectorize index 维度与 embedding model 输出一致。
- [ ] 运行 `pnpm deploy`。
- [ ] 对远端 Worker 调用 `GET /health`。
- [ ] 对远端 Worker 调用 `POST /memories` 创建测试 memory。
- [ ] 确认远端创建响应中 `embeddingStatus = indexed`。
- [ ] 确认远端 D1 中有对应 `memories` row。
- [ ] 确认远端 D1 中有对应 `memory_embeddings` row。
- [ ] 确认远端 detail events 包含 `index`。
- [ ] 测试完成后归档测试 memory。
- [ ] 在测试记录中写下测试 memory id 和时间。

### 阶段 11：文档同步

- [ ] 更新 `docs/architecture/FUNCTIONAL_MODULES.md` 中 Embedding 与索引的实现状态。
- [ ] 更新 `docs/architecture/MEMORY_BASIC_MANAGEMENT.md` 中涉及索引状态的描述，如有变化。
- [ ] 更新 `docs/testing/TEST_PLAN.md` 中当前测试数量和覆盖范围。
- [ ] 更新 `docs/reviews/PROJECT_DEEP_DIVE_REPORT.md` 或新增后续审阅记录，说明该模块已加固完成。
- [ ] 如 API 响应字段有变化，更新 `src/openapi.ts`。
- [ ] 如 Skill 需要提示 indexing 状态，更新 `src/skill/memo-otter-skill.md`。
- [ ] 更新 README 中已知 MVP 限制，如旧 vector 清理策略有变化。

### 阶段 12：提交前人工检查

- [ ] 确认没有实现语义搜索，避免超出本计划范围。
- [ ] 确认没有新增 migration，除非确实改变了表结构。
- [ ] 确认没有删除旧 Vectorize 向量的强依赖。
- [ ] 确认没有把完整错误堆栈写入 `memory_events`。
- [ ] 确认没有把 token、secret 或敏感环境变量写入日志。
- [ ] 确认 route 层仍然不直接调用 Workers AI 或 Vectorize。
- [ ] 确认 D1 仍是源数据，Vectorize 仍是可重建索引。
- [ ] 确认本模块完成后可以支撑下一阶段语义搜索实现。

## 14. 与语义搜索模块的接口约定

Embedding 与索引模块为后续 `POST /search` 提供以下契约：

- Vectorize match 的 `id` 必须能在 `memory_embeddings.vector_id` 查到。
- `memory_embeddings.memory_id` 必须能回查 `memories.id`。
- 搜索模块必须过滤 `memories.status = 'archived'`，除非显式 `include_archived = true`。
- 搜索模块必须跳过找不到 D1 memory 的 vector match。
- 搜索模块必须按 `memory_id` 去重，避免旧 vector 和新 vector 同时返回。
- 搜索模块不依赖 Vectorize metadata 作为源数据，只把 metadata 当作可选优化。

后续搜索伪代码：

```ts
const queryEmbedding = await embeddingService.generateQueryEmbedding(input.query);
const matches = await env.VECTORIZE.query(queryEmbedding, {
  topK: input.limit * 3,
  returnMetadata: 'indexed'
});

const vectorIds = matches.matches.map((match) => match.id);
const embeddingRows = await embeddingRepository.findByVectorIds(vectorIds);
const memories = await memoryRepository.findByIds(embeddingRows.map((row) => row.memory_id));

return rankAndFilter(matches, embeddingRows, memories, input);
```

这段搜索代码不属于本模块实现内容，但它说明了为什么本模块必须保存稳定的 `vector_id` 和 `memory_embeddings` 记录。

## 15. 建议最终代码检查清单

提交前检查：

- `EmbeddingService.indexMemory` 没有在 D1 create 前执行。
- `EmbeddingService.indexMemory` 没有吞掉失败后仍返回 indexed。
- `Vectorize.upsert` metadata 中没有 `null`。
- `contentHash` 基于原始 memory content，而不是 embeddable text。
- `vectorId` 基于 memory id、chunk index、content hash。
- `memory_embeddings` 写入发生在 Vectorize upsert 成功之后。
- `embedding_status = indexed` 发生在 metadata 写入成功之后。
- `index` event 发生在 indexed 状态成功之后。
- `index_failed` event 不保存完整堆栈。
- 内容更新时先写 `stale`，再重新索引。
- 归档 memory 不触发重新索引。
- 测试覆盖 AI、Vectorize、D1 metadata 三种失败。

## 16. 推荐落地顺序总结

最小可交付顺序：

1. 加固 `EmbeddingService` 的类型和失败阶段。
2. 改 `EmbeddingRepository` 为明确 upsert。
3. 扩展 fake 环境，模拟 D1 metadata 失败。
4. 增加索引失败和内容重索引测试。
5. 运行 typecheck 和测试。
6. 用 Wrangler dev 做本地真实 binding 冒烟。
7. 部署后做远端 create/detail 冒烟。

完成这些后，Embedding 与索引模块就可以作为语义搜索模块的可靠底座。
