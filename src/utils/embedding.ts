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
