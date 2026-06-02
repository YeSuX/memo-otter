import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { createFakeEnv } from './fakes';

describe('API docs', () => {
  it('serves OpenAPI JSON and Scalar docs without auth', async () => {
    const app = createApp();
    const env = createFakeEnv();

    const openapi = await app.request('/openapi.json', {}, env);
    expect(openapi.status).toBe(200);
    const spec = (await openapi.json()) as { openapi: string; paths: Record<string, unknown> };
    expect(spec.openapi).toBe('3.1.0');
    expect(spec.paths['/memories']).toBeTruthy();

    const docs = await app.request('/docs', {}, env);
    expect(docs.status).toBe(200);
    expect(await docs.text()).toContain('Memo Otter API Docs');
  });
});
