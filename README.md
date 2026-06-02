# Memo Otter

Memo Otter is a Cloudflare Workers memory service for saving, indexing, listing, editing, and archiving personal AI memories.

## Local Setup

```bash
source /Users/suxiong/.zshrc
pnpm install
cp .dev.vars.example .dev.vars
pnpm db:migrate:local
pnpm dev
```

Open:

```text
http://localhost:8787/health
```

Private API requests require:

```text
Authorization: Bearer <AUTH_TOKEN>
```

## Scripts

```bash
pnpm dev
pnpm test
pnpm typecheck
pnpm db:migrate:local
pnpm db:migrate:remote
pnpm deploy
```

## Cloudflare Bindings

`wrangler.jsonc` expects:

- `DB`: D1 database for source memory data.
- `VECTORIZE`: Vectorize index for memory embeddings.
- `AI`: Workers AI binding for embeddings.
- `AUTH_TOKEN`: secret used by REST API authentication.
- `EMBEDDING_MODEL`: model name used for indexing.

Create resources:

```bash
pnpm wrangler d1 create memo-otter-db
pnpm wrangler vectorize create memo-otter-memory --dimensions=768 --metric=cosine
pnpm wrangler secret put AUTH_TOKEN
```

After creating D1, replace the placeholder `database_id` in `wrangler.jsonc`.

## Memory API

```text
GET    /health
GET    /memories
POST   /memories
GET    /memories/:id
PATCH  /memories/:id
POST   /memories/:id/archive
POST   /search
GET    /context/:project
GET    /export
```

## Known MVP Limits

- Indexing is synchronous for easier debugging.
- Tags are stored as JSON in D1 and filtered in application code.
- Archived memories keep their Vectorize vectors; search and context retrieval filter archived records after D1 lookup.
- `wrangler.jsonc` contains a placeholder D1 id until the real Cloudflare resource is created.
