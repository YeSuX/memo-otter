import { Hono } from 'hono';
import { contextRoutes } from './routes/context';
import { docsRoutes } from './routes/docs';
import { exportRoutes } from './routes/export';
import { healthRoutes } from './routes/health';
import { memoriesRoutes } from './routes/memories';
import { searchRoutes } from './routes/search';
import type { RuntimeEnv } from './types';
import { toJsonErrorResponse } from './utils/errors';

export function createApp() {
  const app = new Hono<{ Bindings: RuntimeEnv }>();

  app.onError((error) => toJsonErrorResponse(error));

  app.route('/', healthRoutes);
  app.route('/', docsRoutes);
  app.route('/memories', memoriesRoutes);
  app.route('/', searchRoutes);
  app.route('/', contextRoutes);
  app.route('/', exportRoutes);

  app.get('/', (c) =>
    c.html(`<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Memo Otter</title>
</head>
<body>
  <main>
    <h1>Memo Otter</h1>
    <p>Memory API is running. Use /memories with Authorization: Bearer &lt;AUTH_TOKEN&gt;.</p>
    <p><a href="/docs">Open API Docs</a></p>
  </main>
</body>
</html>`)
  );

  return app;
}
