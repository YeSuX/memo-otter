# Memo Otter Skill

Use Memo Otter when the user explicitly asks to save, review, update, or archive durable project memory.

## API Base

Set `MEMO_OTTER_BASE_URL` to the deployed Worker URL or local dev URL.

Every private request must include:

```text
Authorization: Bearer <AUTH_TOKEN>
```

## save_memory

Call:

```text
POST /memories
```

Use only when the user clearly asks to save memory or when they approve a proposed memory.

Return the memory id, status, tags, and indexing status to the user.
If indexing failed, tell the user that the memory was saved in D1 but may not be available for semantic recall until re-indexing succeeds.

## list_memories

Call:

```text
GET /memories
```

Use filters such as `project`, `scope`, `type`, `status`, `tags`, and `include_archived` when the user asks for a subset.

## search_memory

Call:

```text
POST /search
```

Use this when the user asks to recall prior project decisions, preferences, context, or notes by meaning rather than by exact title.

Example body:

```json
{
  "query": "natural language question",
  "project": "optional-project",
  "type": "decision",
  "tags": ["optional-tag"],
  "limit": 10
}
```

Read `results[].snippet`, `score`, `status`, and `updated_at` before deciding whether the memory is relevant. Prefer canonical and active memories when scores are close. Do not treat search results as full memory content; call `get_memory` when the exact content is needed.

## get_project_context

Call:

```text
GET /context/:project
```

Use this when the user asks for the current working context of a project. The endpoint defaults to non-archived memories. If the user needs a targeted recall, prefer `search_memory` with a project filter.

## get_memory

Call:

```text
GET /memories/:id
```

Use when the user asks to inspect a memory or when details are needed before editing.

## update_memory

Call:

```text
PATCH /memories/:id
```

Only update memory after explicit user intent. Content changes trigger re-indexing.
After a content update, report whether the new index status is `indexed` or `failed`.

## reindex_memory

Call:

```text
POST /memories/:id/reindex
```

Use this when a memory was saved but `embeddingStatus` is `failed` or `stale`, and the user wants to retry semantic indexing without changing the memory content.

Report the resulting `indexing.status`. If it is still `failed`, explain that the D1 memory is saved but Workers AI or Vectorize still failed.

## archive_memory

Call:

```text
POST /memories/:id/archive
```

Archiving is a high-impact operation. Ask for clear confirmation unless the user directly requested archiving.
