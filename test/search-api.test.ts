import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { createFakeEnv } from './fakes';

describe('Search API', () => {
  it('requires auth and validates the request body', async () => {
    const app = createApp();
    const env = createFakeEnv();

    const unauthorized = await app.request('/search', { method: 'POST' }, env);
    expect(unauthorized.status).toBe(401);

    for (const body of [
      { query: '' },
      { query: 'valid', unknown: true },
      { query: 'valid', limit: 0 },
      { query: 'valid', limit: 51 },
      { query: 'valid', status: 'deleted' }
    ]) {
      const response = await app.request(
        '/search',
        {
          method: 'POST',
          headers: {
            Authorization: 'Bearer test-token',
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(body)
        },
        env
      );
      expect(response.status).toBe(400);
    }
  });

  it('returns semantic search results without full content', async () => {
    const app = createApp();
    const env = createFakeEnv();

    const create = await app.request(
      '/memories',
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer test-token',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          content: 'Search API should return a readable snippet and metadata.',
          project: 'memo-otter',
          type: 'decision',
          tags: ['api']
        })
      },
      env
    );
    expect(create.status).toBe(201);

    const response = await app.request(
      '/search',
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer test-token',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          query: 'readable snippet',
          project: 'memo-otter',
          type: 'decision',
          tags: ['api'],
          limit: 10
        })
      },
      env
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      query: string;
      results: Array<Record<string, unknown>>;
      meta: Record<string, unknown>;
    };
    expect(body.query).toBe('readable snippet');
    expect(body.meta.returned_count).toBe(1);
    expect(body.results).toHaveLength(1);
    expect(body.results[0]).toMatchObject({
      title: 'Search API should return a readable snippet and metadata.',
      project: 'memo-otter',
      type: 'decision',
      status: 'active',
      tags: ['api']
    });
    expect(body.results[0]?.score).toEqual(expect.any(Number));
    expect(body.results[0]?.snippet).toEqual(expect.any(String));
    expect(body.results[0]).toHaveProperty('created_at');
    expect(body.results[0]).toHaveProperty('updated_at');
    expect(body.results[0]).not.toHaveProperty('content');
  });
});
