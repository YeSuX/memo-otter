import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { createFakeEnv } from './fakes';

describe('Memory API', () => {
  it('requires auth and supports the memory lifecycle', async () => {
    const app = createApp();
    const env = createFakeEnv();

    const unauthorized = await app.request('/memories', {}, env);
    expect(unauthorized.status).toBe(401);

    const create = await app.request(
      '/memories',
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer test-token',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ content: 'API created memory.', project: 'memo-otter' })
      },
      env
    );
    expect(create.status).toBe(201);
    const created = (await create.json()) as { memory: { id: string } };

    const list = await app.request('/memories', { headers: { Authorization: 'Bearer test-token' } }, env);
    expect(list.status).toBe(200);
    expect(((await list.json()) as { items: unknown[] }).items).toHaveLength(1);

    const detail = await app.request(`/memories/${created.memory.id}`, { headers: { Authorization: 'Bearer test-token' } }, env);
    expect(detail.status).toBe(200);
    expect(((await detail.json()) as { memory: { content: string } }).memory.content).toContain('API');

    const patch = await app.request(
      `/memories/${created.memory.id}`,
      {
        method: 'PATCH',
        headers: {
          Authorization: 'Bearer test-token',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ tags: ['api'] })
      },
      env
    );
    expect(patch.status).toBe(200);

    const reindex = await app.request(
      `/memories/${created.memory.id}/reindex`,
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer test-token',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ source: 'api' })
      },
      env
    );
    expect(reindex.status).toBe(200);
    expect(((await reindex.json()) as { indexing: { status: string } }).indexing.status).toBe('indexed');

    const archive = await app.request(
      `/memories/${created.memory.id}/archive`,
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer test-token',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ reason: 'test complete' })
      },
      env
    );
    expect(archive.status).toBe(200);

    const hidden = await app.request('/memories', { headers: { Authorization: 'Bearer test-token' } }, env);
    expect(((await hidden.json()) as { items: unknown[] }).items).toHaveLength(0);
  });
});
