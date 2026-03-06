---
status: pending
---

# 002: Serve OpenAPI spec and Swagger UI via new routes

## Summary
Add two new route handlers inside `createRequestHandler` in `packages/coc-server/src/router.ts`: `GET /api/openapi.json` (serves the YAML spec as parsed JSON) and `GET /api/docs` (serves a self-contained Swagger UI HTML page). Also add a `postbuild` script to `packages/coc-server/package.json` so that `openapi.yaml` is copied from `src/` to `dist/` after `tsc` compiles.

## Motivation
Separating routing code from the spec keeps commit 001 reviewable as pure documentation. This commit is purely additive — two new route handlers that don't touch any existing routes, plus a one-line build fix. It can be reviewed, reverted, or cherry-picked independently.

## Changes

### Files to Create
- _(none — all changes are additive modifications to existing files)_

### Files to Modify
- `packages/coc-server/src/router.ts` — Add two new routes (`/api/openapi.json` and `/api/docs`) prepended to the internal routes array inside `createRequestHandler`, using the same pattern as the existing `GET /api/health` prepend. Import `js-yaml`, `fs`, and `path` at the top.
- `packages/coc-server/package.json` — Add `"postbuild"` script that copies `src/openapi.yaml` → `dist/openapi.yaml` using a Node.js one-liner (no extra deps).

### Files to Delete
_(none)_

## Implementation Notes

### Route path decision: `/api/docs` not `/api-docs`
The shared router in `packages/coc-server/src/shared/router.ts` only dispatches through the `routes[]` array when the request pathname starts with `/api/`. Paths that don't match `/api/*` fall through to static file handlers and then the SPA fallback. Therefore the Swagger UI route **must** use the path `/api/docs` (not `/api-docs`) to stay within the `/api/*` prefix and be reachable via the `routes[]` matching logic. This is a considered design decision — it keeps both new endpoints consistent and avoids the need to intercept before `baseHandler`.

### Adding routes inside `createRequestHandler`
Follow the exact same pattern used for the existing health-check route: prepend to `options.routes` (or build a local array) before passing to `createRouter`. Do NOT modify any call sites — callers never need to know these routes exist.

```typescript
// Inside createRequestHandler, before calling createRouter:
const internalRoutes: Route[] = [
  {
    method: 'GET',
    path: '/api/openapi.json',
    handler: (_req, res) => {
      const specPath = path.join(__dirname, 'openapi.yaml');
      try {
        const raw = fs.readFileSync(specPath, 'utf8');
        const parsed = yaml.load(raw);
        sendJson(res, parsed);
      } catch {
        send404(res, 'OpenAPI spec not found');
      }
    },
  },
  {
    method: 'GET',
    path: '/api/docs',
    handler: (_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(SWAGGER_UI_HTML);
    },
  },
  // ...health route (already exists)
];
const allRoutes = [...internalRoutes, ...(options.routes ?? [])];
// pass allRoutes to createRouter
```

### `js-yaml` import
`js-yaml` is already listed as a runtime dependency (`"js-yaml": "^4.1.0"`). Import it at the top of `router.ts`:
```typescript
import * as yaml from 'js-yaml';
import * as fs from 'fs';
import * as path from 'path';
```
(Use `import` style consistent with the rest of the file. If the file uses `require`, use `const yaml = require('js-yaml')` etc.)

### `__dirname` and the YAML file location
After `tsc` compiles, `router.ts` → `dist/router.js`. `__dirname` inside `dist/router.js` resolves to `packages/coc-server/dist/`. The `postbuild` script copies `src/openapi.yaml` → `dist/openapi.yaml`, so `path.join(__dirname, 'openapi.yaml')` will resolve correctly at runtime. No environment-specific path logic is needed.

### Swagger UI HTML constant
Define a module-level `const SWAGGER_UI_HTML: string` in `router.ts`. Keep it as a plain template-literal string — no separate file, no build step. Use unpkg CDN for Swagger UI v5:

```typescript
const SWAGGER_UI_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>CoC API Docs</title>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css" />
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
  <script>
    SwaggerUIBundle({
      url: '/api/openapi.json',
      dom_id: '#swagger-ui',
      presets: [SwaggerUIBundle.presets.apis, SwaggerUIBundle.SwaggerUIStandalonePreset],
      layout: 'BaseLayout',
      deepLinking: true,
    });
  </script>
</body>
</html>`;
```

The `url: '/api/openapi.json'` is a relative URL — it works regardless of what hostname/port the server is running on.

### `postbuild` script in `package.json`
Add immediately after the `"build"` script:
```json
"postbuild": "node -e \"require('fs').copyFileSync('src/openapi.yaml', 'dist/openapi.yaml')\""
```
npm automatically runs `postbuild` after `build` completes successfully. This uses only Node.js built-ins — no `cp`, no cross-env, no extra deps.

### Error handling for missing spec
Wrap the `fs.readFileSync` in a try/catch. On any error (file not found, parse error), call `send404(res, 'OpenAPI spec not found')`. This prevents the server from crashing if `dist/openapi.yaml` is absent (e.g., a partial build).

### No feature flags
Both routes are always enabled. There is no debug flag or configuration option — the spec and docs are always available once the server is running.

## Tests
- Unit test: `GET /api/openapi.json` returns 200, `Content-Type: application/json`, and a body whose `.openapi` field is a string (e.g. `'3.1.0'`). Mock `fs.readFileSync` to return a minimal valid YAML string.
- Unit test: `GET /api/openapi.json` returns 404 when `fs.readFileSync` throws (mock it to throw `ENOENT`).
- Unit test: `GET /api/docs` returns 200, `Content-Type` contains `text/html`, and body contains `swagger-ui`.
- Integration test (optional): start the actual server against a temp dir, hit both routes with `http.get`, assert status codes. Can reuse test infrastructure from existing server tests in `packages/coc-server/src/__tests__/`.
- Ensure existing route tests still pass (no regression on `/api/health`, process CRUD, etc.).

## Acceptance Criteria
- [ ] `GET /api/openapi.json` returns HTTP 200 with `Content-Type: application/json` and a valid OpenAPI 3.x JSON object
- [ ] `GET /api/docs` returns HTTP 200 with `Content-Type: text/html` and HTML that includes the Swagger UI bundle script tag
- [ ] Swagger UI page loads in a browser and renders endpoint groups from the spec (manual smoke test)
- [ ] `npm run build` in `packages/coc-server/` completes without error and `dist/openapi.yaml` exists afterwards
- [ ] No existing routes are affected (all prior tests pass)
- [ ] Server starts without errors after the change (`coc serve` or equivalent)
- [ ] `GET /api/openapi.json` returns 404 (not a 500 crash) when `dist/openapi.yaml` is absent

## Dependencies
- Depends on: **001** (which creates `packages/coc-server/src/openapi.yaml` — without it, the `/api/openapi.json` route will always 404)

## Assumed Prior State
- `packages/coc-server/src/openapi.yaml` exists (created in commit 001) and contains a valid OpenAPI 3.x document
- `packages/coc-server/src/router.ts` exports `createRequestHandler(options: RouterOptions)` and imports `sendJson`, `send404`, `createRouter` from `./shared/router`
- `packages/coc-server/src/shared/router.ts` exports `sendJson(res, data, statusCode?)` and `send404(res, message?)`
- `js-yaml` (`^4.1.0`) is already in `dependencies` in `packages/coc-server/package.json`
- The shared router routes `/api/*` paths through the `routes[]` array and falls through to SPA for all other paths
- The `Route` type is `{ method: string; path: string | RegExp; handler: (req, res, match) => void | Promise<void> }`
