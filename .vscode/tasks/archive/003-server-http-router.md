---
status: pending
---

# 003: Add HTTP server foundation to pipeline-cli

## Objective

Create the HTTP server infrastructure for the `pipeline serve` command. This commit adds three new files under `packages/pipeline-cli/src/server/` that together form a minimal, dependency-free HTTP server (raw Node.js `http` module, no Express) following the patterns established by the deep-wiki server (`packages/deep-wiki/src/server/`).

The server exposes a health endpoint, serves a SPA shell, handles CORS, and parses JSON request bodies — providing the skeleton that later commits will extend with execution, SSE streaming, and store endpoints.

---

## Files

### 1. `packages/pipeline-cli/src/server/types.ts` (new)

Shared type definitions for the server module.

```ts
import type * as http from 'http';
import type { ProcessStore } from '@plusplusoneplusplus/pipeline-core';

/** Options accepted by `createExecutionServer()`. */
export interface ExecutionServerOptions {
  /** Injected process store (FileProcessStore from pipeline-core). */
  store: ProcessStore;
  /** TCP port (default `4000`). */
  port?: number;
  /** Bind address (default `'localhost'`). */
  host?: string;
  /** Directory for server state / execution artefacts (default `~/.pipeline-server/`). */
  dataDir?: string;
  /** Open the default browser on start. */
  openBrowser?: boolean;
  /** SPA colour theme. */
  theme?: 'auto' | 'light' | 'dark';
}

/** A running execution server instance. */
export interface ExecutionServer {
  server: http.Server;
  store: ProcessStore;
  port: number;
  host: string;
  url: string;
  /** Gracefully shut the server down. */
  close: () => Promise<void>;
}

/**
 * Route definition for the router table.
 * `pattern` is either an exact string or a RegExp.
 * `method` defaults to `'GET'` when omitted.
 */
export interface Route {
  method?: string;
  pattern: string | RegExp;
  handler: (req: http.IncomingMessage, res: http.ServerResponse, match?: RegExpMatchArray) => void | Promise<void>;
}
```

**Rationale:** Keeping types in a dedicated file mirrors `packages/deep-wiki/src/server/types.ts` and avoids circular imports between `index.ts` ↔ `router.ts`.

`ProcessStore` is imported from `pipeline-core` (commit 001 defines the interface, commit 002 provides the `FileProcessStore` implementation). The server requires a store to be injected via `ExecutionServerOptions.store`.

---

### 2. `packages/pipeline-cli/src/server/router.ts` (new)

HTTP request router + helpers. Mirrors `packages/deep-wiki/src/server/router.ts` structure.

#### Constants

```ts
/** MIME look-up table — same set as deep-wiki router (lines 26-41). */
const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png':  'image/png',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
};
const DEFAULT_MIME = 'application/octet-stream';
```

#### `createRequestHandler(options)`

Factory that returns an `http.RequestListener`. Behaviour per request:

| Step | Condition | Action |
|------|-----------|--------|
| 1 | Every request | Set CORS headers (`Access-Control-Allow-Origin: *`, methods `GET, POST, PATCH, DELETE, OPTIONS`, headers `Content-Type`) |
| 2 | `OPTIONS` preflight | `204 No Content` — return |
| 3 | Path starts with `/api/` | Match against `routes` table (exact string or RegExp). On match → delegate to handler. No match → `404 JSON`. |
| 4 | Path matches a static file in `staticDir` | Serve via `fs.createReadStream().pipe(res)` with correct MIME type and `Cache-Control: public, max-age=3600` (same pattern as deep-wiki `serveStaticFile`, line 142-178). |
| 5 | Anything else | Return `spaHtml` with `200 text/html` (SPA fallback for client-side routing, matching deep-wiki line 129-131). |

```ts
export interface RouterOptions {
  routes: Route[];
  spaHtml: string;
  staticDir?: string;            // optional dir for static assets
  store: ProcessStore;           // injected so /api/health can read count
}

export function createRequestHandler(options: RouterOptions): http.RequestListener;
```

**Pattern reference:** deep-wiki `createRequestHandler` (router.ts line 83-131) — same CORS-first, API-second, static-third, SPA-fallback order.

#### Built-in route: `GET /api/health`

Registered inside `createRequestHandler` (prepended to the route list so it always exists):

```ts
{
  method: 'GET',
  pattern: '/api/health',
  handler: (_req, res) => {
    sendJson(res, {
      status: 'ok',
      uptime: process.uptime(),
      processCount: options.store.count(),
    });
  },
}
```

#### JSON body parser

```ts
/** Read the full request body and parse as JSON. Rejects on invalid JSON. */
export async function readJsonBody<T = unknown>(req: http.IncomingMessage): Promise<T>;
```

Implementation: accumulate chunks → `Buffer.concat` → `JSON.parse`. Mirrors deep-wiki `readBody` (router.ts line 220-227) but adds the JSON parse step.

#### Response helpers

Exact same signatures as deep-wiki (router.ts line 187-215):

```ts
export function sendJson(res: http.ServerResponse, data: unknown, statusCode?: number): void;
export function send404(res: http.ServerResponse, message?: string): void;
export function send400(res: http.ServerResponse, message?: string): void;
export function send500(res: http.ServerResponse, message?: string): void;
```

---

### 3. `packages/pipeline-cli/src/server/index.ts` (new)

Server factory — public entry point. Mirrors `packages/deep-wiki/src/server/index.ts` (`createServer`, lines 92-235).

```ts
import * as http from 'http';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { createRequestHandler } from './router';
import type { ExecutionServerOptions, ExecutionServer, ProcessStore } from './types';

export async function createExecutionServer(options: ExecutionServerOptions = {}): Promise<ExecutionServer> { ... }
```

#### Implementation steps

1. **Resolve defaults:**
   - `port` → `options.port ?? 4000`
   - `host` → `options.host ?? 'localhost'`
   - `dataDir` → `options.dataDir ?? path.join(os.homedir(), '.pipeline-server')`
   - Ensure `dataDir` exists (`fs.mkdirSync(dataDir, { recursive: true })`)

2. **Create a stub `ProcessStore`** (placeholder until the store commit):
   ```ts
   const store: ProcessStore = { count: () => 0 };
   ```

3. **Generate SPA shell** — a minimal HTML page (placeholder):
   ```ts
   const spaHtml = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Pipeline Server</title></head><body><div id="app">Pipeline Execution Server</div></body></html>`;
   ```

4. **Build route list** — empty for now; `createRequestHandler` will prepend `/api/health` automatically.

5. **Create HTTP server** (mirrors deep-wiki lines 131-143):
   ```ts
   const handler = createRequestHandler({ routes: [], spaHtml, store });
   const server = http.createServer(handler);
   ```

6. **Listen** — wrapped in a promise (mirrors deep-wiki lines 197-199):
   ```ts
   await new Promise<void>((resolve, reject) => {
     server.on('error', reject);
     server.listen(port, host, () => resolve());
   });
   ```

7. **Resolve actual port** (mirrors deep-wiki lines 203-205):
   ```ts
   const address = server.address();
   const actualPort = typeof address === 'object' && address ? address.port : port;
   const url = `http://${host}:${actualPort}`;
   ```

8. **Return `ExecutionServer`** with `close()` that calls `server.close()` in a promise (mirrors deep-wiki lines 217-234).

#### Re-exports

```ts
export type { ExecutionServerOptions, ExecutionServer, ProcessStore, Route } from './types';
export { sendJson, send404, send400, send500, readJsonBody, createRequestHandler } from './router';
```

---

## Tests

File: `packages/pipeline-cli/test/server.test.ts`

Use **Vitest** (consistent with existing pipeline-cli tests). All tests create a server on port `0` (OS-assigned) and tear down via `close()`.

| # | Test | Assert |
|---|------|--------|
| 1 | **Server starts and returns health** | `GET /api/health` → `200`, body has `status: 'ok'`, `uptime >= 0`, `processCount === 0` |
| 2 | **CORS headers present** | Any `GET /api/health` response includes `Access-Control-Allow-Origin: *` |
| 3 | **OPTIONS preflight** | `OPTIONS /api/health` → `204`, correct Allow-Methods/Allow-Headers headers |
| 4 | **404 falls back to SPA shell** | `GET /nonexistent/path` → `200 text/html`, body contains `<div id="app">` |
| 5 | **JSON body parsing** | Register a test POST route, send JSON body, handler receives parsed object |
| 6 | **Graceful shutdown** | After `close()`, `server.listening` is `false` |
| 7 | **Custom routes** | Register `GET /api/custom` route, verify it responds correctly |
| 8 | **Regex route matching** | Register route with `pattern: /^\/api\/items\/(\w+)$/`, verify `match[1]` captures param |

### Test helper

```ts
import { createExecutionServer } from '../src/server/index';
import type { ExecutionServer } from '../src/server/types';

async function startTestServer(routes = []): Promise<ExecutionServer> {
  return createExecutionServer({ port: 0, host: 'localhost' });
}
```

HTTP requests made with Node.js built-in `http.request()` or `fetch()` (Node 18+).

---

## Boundaries

### In scope

- `types.ts`, `router.ts`, `index.ts` under `packages/pipeline-cli/src/server/`
- `packages/pipeline-cli/test/server.test.ts`
- No changes to existing files (the `serve` command wiring is a separate commit)

### Out of scope

- Process store implementation (separate commit)
- SSE streaming (separate commit)
- `pipeline serve` CLI command registration (separate commit)
- Real SPA frontend (separate commit)

---

## Commit message

```
feat(pipeline-cli): add HTTP server foundation

- Server factory createExecutionServer() with options for port, host, dataDir
- Router with route table, CORS middleware, JSON body parsing, static file serving
- Health endpoint: GET /api/health → { status, uptime, processCount }
- SPA fallback for client-side routing on unknown paths
- Response helpers: sendJson, send404, send400, send500, readJsonBody
- Shared server types: ExecutionServerOptions, ExecutionServer, ProcessStore, Route
- Vitest tests for health, CORS, SPA fallback, JSON parsing, shutdown, route matching

Follows deep-wiki server patterns (raw http module, no Express).
```
