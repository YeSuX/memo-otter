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

## list_memories

Call:

```text
GET /memories
```

Use filters such as `project`, `scope`, `type`, `status`, `tags`, and `include_archived` when the user asks for a subset.

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

## archive_memory

Call:

```text
POST /memories/:id/archive
```

Archiving is a high-impact operation. Ask for clear confirmation unless the user directly requested archiving.
