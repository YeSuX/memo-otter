import { Scalar } from '@scalar/hono-api-reference';
import { Hono } from 'hono';
import { openApiDocument } from '../openapi';
import type { RuntimeEnv } from '../types';

export const docsRoutes = new Hono<{ Bindings: RuntimeEnv }>();

docsRoutes.get('/openapi.json', (c) => c.json(openApiDocument));

docsRoutes.get(
  '/docs',
  Scalar({
    pageTitle: 'Memo Otter API Docs',
    layout: 'modern',
    theme: 'kepler',
    darkMode: true,
    // Scalar 直接读取同源 OpenAPI JSON，避免在 Worker 内额外打包静态文档。
    url: '/openapi.json'
  })
);
