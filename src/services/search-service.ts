import { EmbeddingRepository } from '../repositories/embedding-repository';
import { MemoryRepository } from '../repositories/memory-repository';
import type { Memory, MemoryWarning, RuntimeEnv, SearchInput, SearchResponse, SearchResultItem } from '../types';
import { extractEmbeddingVectorOrThrow } from '../utils/embedding';

type VectorizeMatch = {
  id: string;
  score?: number;
};

type SearchCandidate = {
  memory: Memory;
  score: number;
  vectorId: string;
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
    const embeddingRows = await this.embeddings.findByVectorIds(matches.map((match) => match.id));
    const memories = await this.memories.findByIds(embeddingRows.map((row) => row.memory_id));

    const byVectorId = new Map(embeddingRows.map((row) => [row.vector_id, row]));
    const byMemoryId = new Map(memories.map((memory) => [memory.id, memory]));
    const bestByMemoryId = new Map<string, SearchCandidate>();

    for (const match of matches) {
      const embeddingRow = byVectorId.get(match.id);
      if (!embeddingRow) continue;
      const memory = byMemoryId.get(embeddingRow.memory_id);
      if (!memory || !matchesFilters(memory, input)) continue;

      const score = typeof match.score === 'number' ? match.score : 0;
      const existing = bestByMemoryId.get(memory.id);
      // 内容更新后旧向量可能还在 Vectorize；这里按 memory id 去重并保留最高分。
      if (!existing || score > existing.score) {
        bestByMemoryId.set(memory.id, { memory, score, vectorId: match.id });
      }
    }

    const results = [...bestByMemoryId.values()]
      .sort(compareSearchCandidates)
      .slice(0, input.limit)
      .map(({ memory, score }) => toSearchResultItem(memory, score, input.query));

    return {
      query: input.query,
      results,
      meta: {
        limit: input.limit,
        candidate_count: matches.length,
        returned_count: results.length
      }
    };
  }

  async findRelatedForNewMemory(input: {
    content: string;
    project: string | null;
    type: string;
    excludeId: string;
  }): Promise<MemoryWarning[]> {
    const response = await this.search({
      query: input.content,
      project: input.project,
      tags: [],
      includeArchived: false,
      limit: 10
    });

    const candidates = response.results.filter((item) => item.id !== input.excludeId);
    const duplicateIds = candidates
      .filter((item) => item.project === input.project && item.score >= 0.88)
      .map((item) => item.id);
    const conflictIds = candidates
      .filter(
        (item) =>
          item.project === input.project &&
          item.type === input.type &&
          item.status === 'canonical' &&
          item.score >= 0.82
      )
      .map((item) => item.id);

    const warnings: MemoryWarning[] = [];
    if (duplicateIds.length > 0) {
      warnings.push({
        type: 'possible_duplicate',
        severity: 'info',
        message: 'Similar memories already exist.',
        relatedMemoryIds: duplicateIds
      });
    }
    if (conflictIds.length > 0) {
      warnings.push({
        type: 'possible_conflict',
        severity: 'warning',
        message: 'A similar canonical memory exists in the same project and type.',
        relatedMemoryIds: conflictIds
      });
    }
    return warnings;
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

function normalizeVectorizeMatches(result: unknown): VectorizeMatch[] {
  const matches = result && typeof result === 'object' ? (result as { matches?: unknown }).matches : result;
  if (!Array.isArray(matches)) return [];

  return matches
    .map((match) => {
      if (!match || typeof match !== 'object') return null;
      const record = match as Record<string, unknown>;
      const id = typeof record.id === 'string' ? record.id : null;
      if (!id) return null;
      const normalized: VectorizeMatch = {
        id,
        ...(typeof record.score === 'number' ? { score: record.score } : {})
      };
      return normalized;
    })
    .filter((match): match is VectorizeMatch => match !== null);
}

function matchesFilters(memory: Memory, input: SearchInput): boolean {
  // Vectorize metadata 可能滞后，最终过滤必须以 D1 源数据为准。
  if (!input.includeArchived && memory.status === 'archived') return false;
  if (input.project !== undefined && input.project !== memory.project) return false;
  if (input.type !== undefined && input.type !== memory.type) return false;
  if (input.status !== undefined && input.status !== memory.status) return false;
  if (input.tags?.length && !input.tags.some((tag) => memory.tags.includes(tag))) return false;
  return true;
}

function compareSearchCandidates(a: SearchCandidate, b: SearchCandidate): number {
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
