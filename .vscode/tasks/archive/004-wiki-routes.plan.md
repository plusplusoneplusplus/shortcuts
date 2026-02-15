---
status: done
---

# 004: Move HTTP Handlers and Register Wiki Routes

## Summary
Move ask-handler, explore-handler, admin-handlers, generate-handler to coc/src/server/wiki/ and create registerWikiRoutes() that mounts all wiki endpoints under /api/wikis/:wikiId/*.

## Motivation
This commit integrates wiki functionality into the CoC HTTP server. All deep-wiki API endpoints become available scoped per wikiId, enabling multi-wiki support through the unified server.

## Changes

### Files to Create
- `packages/coc/src/server/wiki/ask-handler.ts` — From deep-wiki, adapted for wikiId scoping
- `packages/coc/src/server/wiki/explore-handler.ts` — From deep-wiki, adapted
- `packages/coc/src/server/wiki/admin-handlers.ts` — From deep-wiki, adapted
- `packages/coc/src/server/wiki/generate-handler.ts` — From deep-wiki, adapted
- `packages/coc/src/server/wiki/wiki-routes.ts` — NEW: registerWikiRoutes() using CoC Route[] pattern
- `packages/coc/src/server/wiki/index.ts` — Barrel export for route registration

### Files to Modify
- `packages/coc/src/server/index.ts` — Call registerWikiRoutes() in createExecutionServer, add to re-exports
- `packages/coc/src/server/types.ts` — Add WikiServerOptions to ExecutionServerOptions

### Files to Delete
- (none — deep-wiki cleanup is a later commit)

## Implementation Notes

### How deep-wiki dispatches today

`api-handlers.ts` defines `handleApiRequest(req, res, pathname, method, context: ApiHandlerContext)` — a single function that receives every `/api/*` request and does manual string/regex matching:

```
GET  /api/graph                        → handleGetGraph(res, wikiData)
GET  /api/themes                       → handleGetThemes(res, wikiData)
GET  /api/themes/:themeId/:slug        → regex /^\/api\/themes\/([^/]+)\/([^/]+)$/
GET  /api/themes/:themeId              → regex /^\/api\/themes\/([^/]+)$/
GET  /api/components                   → handleGetComponents(res, wikiData)
GET  /api/components/:id               → regex /^\/api\/components\/(.+)$/
GET  /api/pages/:key                   → regex /^\/api\/pages\/(.+)$/
POST /api/ask                          → handleAskRequest(req, res, options)
DELETE /api/ask/session/:id            → regex /^\/api\/ask\/session\/(.+)$/
POST /api/explore/:id                  → regex /^\/api\/explore\/(.+)$/
/api/admin/*                           → handleAdminRequest (sub-router):
  GET  /api/admin/seeds                → handleGetSeeds
  PUT  /api/admin/seeds                → handlePutSeeds
  GET  /api/admin/config               → handleGetConfig
  PUT  /api/admin/config               → handlePutConfig
  /api/admin/generate*                 → handleGenerateRequest (sub-router):
    POST /api/admin/generate           → handleStartGenerate (SSE)
    POST /api/admin/generate/cancel    → handleCancelGenerate
    GET  /api/admin/generate/status    → handleGetGenerateStatus
    POST /api/admin/generate/component/:id → regex /^\/api\/admin\/generate\/component\/(.+)$/
```

The `ApiHandlerContext` bundles: `wikiData: WikiData`, `aiEnabled: boolean`, `contextBuilder?: ContextBuilder`, `aiSendMessage?: AskAIFunction`, `aiModel?: string`, `aiWorkingDirectory?: string`, `sessionManager?: ConversationSessionManager`, `wsServer?: WebSocketServer`, `repoPath?: string`.

### How to convert to CoC Route[] pattern

CoC uses `routes.push({ method, pattern, handler })` where `pattern` is either a literal string or a `RegExp`. When `pattern` is a RegExp, the router calls `pathname.match(pattern)` and passes the `RegExpMatchArray` as the third argument to handler. See `packages/coc/src/server/router.ts` lines 106-131.

**Key conversion**: All deep-wiki paths `/api/...` become `/api/wikis/:wikiId/...`. The `wikiId` is extracted from a regex capture group (group 1 in every pattern). Sub-resource IDs shift to group 2+.

### Concrete regex patterns for wiki-routes.ts

Each route gets a `wikiId` prefix. The `registerWikiRoutes()` function receives `routes: Route[]` and a `WikiManager` (from 003).

```typescript
// --- Data endpoints (read from WikiManager → WikiData) ---

// GET /api/wikis/:wikiId/graph
{ method: 'GET', pattern: /^\/api\/wikis\/([^/]+)\/graph$/ }
// match[1] = wikiId

// GET /api/wikis/:wikiId/themes
{ method: 'GET', pattern: /^\/api\/wikis\/([^/]+)\/themes$/ }

// GET /api/wikis/:wikiId/themes/:themeId/:slug
{ method: 'GET', pattern: /^\/api\/wikis\/([^/]+)\/themes\/([^/]+)\/([^/]+)$/ }
// match[1] = wikiId, match[2] = themeId, match[3] = slug

// GET /api/wikis/:wikiId/themes/:themeId
{ method: 'GET', pattern: /^\/api\/wikis\/([^/]+)\/themes\/([^/]+)$/ }
// match[1] = wikiId, match[2] = themeId

// GET /api/wikis/:wikiId/components
{ method: 'GET', pattern: /^\/api\/wikis\/([^/]+)\/components$/ }

// GET /api/wikis/:wikiId/components/:id
{ method: 'GET', pattern: /^\/api\/wikis\/([^/]+)\/components\/(.+)$/ }
// match[1] = wikiId, match[2] = componentId

// GET /api/wikis/:wikiId/pages/:key
{ method: 'GET', pattern: /^\/api\/wikis\/([^/]+)\/pages\/(.+)$/ }
// match[1] = wikiId, match[2] = key

// --- AI endpoints (ask, explore) ---

// POST /api/wikis/:wikiId/ask
{ method: 'POST', pattern: /^\/api\/wikis\/([^/]+)\/ask$/ }

// DELETE /api/wikis/:wikiId/ask/session/:sessionId
{ method: 'DELETE', pattern: /^\/api\/wikis\/([^/]+)\/ask\/session\/(.+)$/ }
// match[1] = wikiId, match[2] = sessionId

// POST /api/wikis/:wikiId/explore/:componentId
{ method: 'POST', pattern: /^\/api\/wikis\/([^/]+)\/explore\/(.+)$/ }
// match[1] = wikiId, match[2] = componentId

// --- Admin endpoints (seeds, config, generate) ---

// GET /api/wikis/:wikiId/admin/seeds
{ method: 'GET', pattern: /^\/api\/wikis\/([^/]+)\/admin\/seeds$/ }

// PUT /api/wikis/:wikiId/admin/seeds
{ method: 'PUT', pattern: /^\/api\/wikis\/([^/]+)\/admin\/seeds$/ }

// GET /api/wikis/:wikiId/admin/config
{ method: 'GET', pattern: /^\/api\/wikis\/([^/]+)\/admin\/config$/ }

// PUT /api/wikis/:wikiId/admin/config
{ method: 'PUT', pattern: /^\/api\/wikis\/([^/]+)\/admin\/config$/ }

// POST /api/wikis/:wikiId/admin/generate
{ method: 'POST', pattern: /^\/api\/wikis\/([^/]+)\/admin\/generate$/ }

// POST /api/wikis/:wikiId/admin/generate/cancel
{ method: 'POST', pattern: /^\/api\/wikis\/([^/]+)\/admin\/generate\/cancel$/ }

// GET /api/wikis/:wikiId/admin/generate/status
{ method: 'GET', pattern: /^\/api\/wikis\/([^/]+)\/admin\/generate\/status$/ }

// POST /api/wikis/:wikiId/admin/generate/component/:componentId
{ method: 'POST', pattern: /^\/api\/wikis\/([^/]+)\/admin\/generate\/component\/(.+)$/ }
// match[1] = wikiId, match[2] = componentId

// --- Wiki CRUD endpoints (not per-wiki — manage the registry) ---

// GET /api/wikis — List all registered wikis
{ method: 'GET', pattern: '/api/wikis' }

// POST /api/wikis — Register a new wiki { id, wikiDir, repoPath? }
{ method: 'POST', pattern: '/api/wikis' }

// GET /api/wikis/:wikiId — Get wiki metadata
{ method: 'GET', pattern: /^\/api\/wikis\/([^/]+)$/ }

// DELETE /api/wikis/:wikiId — Remove a wiki
{ method: 'DELETE', pattern: /^\/api\/wikis\/([^/]+)$/ }

// PATCH /api/wikis/:wikiId — Update wiki metadata
{ method: 'PATCH', pattern: /^\/api\/wikis\/([^/]+)$/ }
```

### How handlers currently receive dependencies — adaptation to WikiManager

**Today:** Handlers receive `WikiData`, `ContextBuilder`, `AskAIFunction` etc. directly via `ApiHandlerContext`.

**After:** Each route handler extracts `wikiId` from `match[1]`, calls `wikiManager.get(wikiId)` to get the `WikiInstance` (which contains `wikiData`, `contextBuilder`, `sessionManager`). If `wikiManager.get(wikiId)` returns `undefined`, the handler responds `404 Wiki not found: {wikiId}`.

The common wikiId-resolution pattern in each handler:

```typescript
handler: async (req, res, match) => {
    const wikiId = decodeURIComponent(match![1]);
    const wiki = wikiManager.get(wikiId);
    if (!wiki) {
        return sendError(res, 404, `Wiki not found: ${wikiId}`);
    }
    // wiki.wikiData, wiki.contextBuilder, wiki.sessionManager available
}
```

This replaces the flat `ApiHandlerContext` — no more single-wiki assumption.

### Handler-specific adaptation notes

**ask-handler.ts:**
- Deep-wiki's `handleAskRequest(req, res, options: AskHandlerOptions)` takes `contextBuilder`, `sendMessage`, `model`, `workingDirectory`, `sessionManager`.
- In CoC version: resolve these from `WikiInstance`. The `AskAIFunction` (sendMessage) is the main thing that must come from outside (from the AI invoker / SDK service). It can live on the `WikiInstance` or be passed to `registerWikiRoutes()` as a shared dependency.
- Keep `buildAskPrompt` and `readBody` helper as-is (pure functions, no dependencies).
- `sendSSE` helper — **share as a module-level export** from `ask-handler.ts`. Both `explore-handler` and `generate-handler` already import it from deep-wiki's ask-handler; same pattern in CoC.

**explore-handler.ts:**
- `handleExploreRequest(req, res, componentId, options: ExploreHandlerOptions)` takes `wikiData`, `sendMessage`, `model`, `workingDirectory`.
- `componentId` is now `match[2]` (after `wikiId` in `match[1]`).
- Imports `sendSSE` from `./ask-handler`.
- `buildExplorePrompt` is a pure function — copy as-is.
- Has its own `readBody` — deduplicate into a shared `readBody` in ask-handler or a utils file.

**admin-handlers.ts:**
- `handleAdminRequest(req, res, pathname, method, context: AdminHandlerContext)` is itself a sub-router with string matching.
- **Flatten into individual routes** in `registerWikiRoutes` instead of keeping the sub-router pattern. Each admin endpoint becomes its own `routes.push(...)` entry.
- The context needs: `wikiDir` (from `wiki.wikiDir`), `repoPath` (from `wiki.repoPath`), `wikiData` (from `wiki.wikiData`), `wsServer`.
- Imports from deep-wiki: `sendJson`, `send404`, `send400`, `send500`, `readBody` from `../router`. In CoC: import from `../router` (CoC already has the same helpers).
- Imports `validateConfig`, `discoverConfigFile` from deep-wiki `config-loader`. These need to be either:
  (a) imported from deep-wiki as a dependency, or
  (b) extracted to pipeline-core, or
  (c) inlined for now with a TODO.
  **Recommendation:** Import from deep-wiki for now (CoC already depends on pipeline-core; add deep-wiki config-loader as a peer or copy the two small functions). Decision should be documented and resolved in a later cleanup commit.
- `getErrorMessage` from `../utils/error-utils` — already exists in CoC or pipeline-core.

**generate-handler.ts:**
- Large file (~500 lines) with phase generation logic.
- Uses module-level mutable state: `let generationState: GenerationState | null = null` — this becomes **per-wiki state**. Move into a `Map<string, GenerationState>` keyed by `wikiId`.
- Dynamically imports heavy deep-wiki modules: `../commands/phases`, `../cache`, `../usage-tracker`, `../ai-invoker`. These are deep-wiki internals.
- **Strategy:** The CoC version should delegate actual generation to deep-wiki's public API (calling it as a library). The handler wraps the call with SSE streaming and cancellation. Don't copy the phase-runner internals.
- Routes: POST generate, POST generate/cancel, GET generate/status, POST generate/component/:id — all become flat regex routes.

### sendSSE helper — shared or duplicated?

**Share it.** Define `sendSSE(res, data)` in `packages/coc/src/server/wiki/ask-handler.ts` and export it. Both `explore-handler.ts` and `generate-handler.ts` import from `./ask-handler` — same pattern as deep-wiki.

The function is trivial (`res.write(\`data: ${JSON.stringify(data)}\n\n\`)`), but sharing avoids drift.

### How to extract wikiId from regex match groups

All wiki-scoped routes use `match![1]` for `wikiId`. Sub-resource IDs (componentId, themeId, sessionId, etc.) shift to `match![2]` and `match![3]`. Example:

```typescript
// GET /api/wikis/:wikiId/themes/:themeId/:slug
// pattern: /^\/api\/wikis\/([^/]+)\/themes\/([^/]+)\/([^/]+)$/
handler: async (_req, res, match) => {
    const wikiId = decodeURIComponent(match![1]);
    const themeId = decodeURIComponent(match![2]);
    const slug = decodeURIComponent(match![3]);
    // ...
}
```

### CORS and error handling

Already handled by the CoC router (`packages/coc/src/server/router.ts` lines 92-101): every request gets `Access-Control-Allow-Origin: *` and OPTIONS returns 204. Unmatched API routes get 404 JSON. Unhandled handler exceptions get 500.

The wiki handlers should NOT set their own CORS headers (the SSE endpoints in ask-handler and explore-handler currently do — remove those redundant headers in the CoC version since the router already sets them).

### Response helpers

Deep-wiki uses `sendJson(res, data, statusCode?)`, `send404(res, msg)`, `send400(res, msg)`, `send500(res, msg)`, `readBody(req)` from its router.
CoC has equivalent functions in `router.ts`: `sendJson`, `send404`, `send400`, `send500`, `readJsonBody`.
CoC's `api-handler.ts` also exports `sendJSON`, `sendError`, `parseBody`.

**Recommendation:** Wiki handlers should import from `../router` (CoC's router) to stay consistent with the rest of the CoC server. The function signatures are compatible.

### Types to add to ExecutionServerOptions

```typescript
// In packages/coc/src/server/types.ts
export interface WikiServerOptions {
    /** Enable wiki API endpoints. */
    enabled?: boolean;
    /** Initial wiki registrations (wikiId → { wikiDir, repoPath? }) */
    wikis?: Record<string, { wikiDir: string; repoPath?: string }>;
    /** Enable AI features (ask, explore, generate) for wikis. */
    aiEnabled?: boolean;
}

// Add to ExecutionServerOptions:
/** Options for the wiki module. */
wiki?: WikiServerOptions;
```

### Integration into createExecutionServer

In `packages/coc/src/server/index.ts`, after existing route registrations:

```typescript
import { registerWikiRoutes } from './wiki';

// ... existing route registrations ...
if (options.wiki?.enabled) {
    registerWikiRoutes(routes, {
        wikis: options.wiki.wikis,
        aiEnabled: options.wiki.aiEnabled,
        wsServer,
    });
}
```

## Tests
- Test each wiki endpoint returns correct data for a registered wiki
- Test 404 for unknown wikiId
- Test CRUD endpoints (GET /api/wikis, POST /api/wikis, DELETE /api/wikis/:id, PATCH /api/wikis/:id)
- Test SSE streaming on POST /api/wikis/:id/ask
- Test all regex route patterns match correctly (unit test each pattern against sample paths)
- Test admin endpoints scoped per wiki (GET/PUT seeds, config)
- Test generate endpoints per wiki (POST generate, cancel, status)
- Test that existing CoC API endpoints (/api/processes, /api/workspaces, etc.) are unaffected
- Test wikiId extraction with URL-encoded IDs

## Acceptance Criteria
- [x] All wiki API endpoints accessible under /api/wikis/:wikiId/*
- [x] Wiki CRUD endpoints (list, register, remove, update) working
- [x] Ask and Explore handlers produce SSE streams
- [x] Admin endpoints (seeds, config, generate) scoped per wiki
- [x] Existing CoC API endpoints unaffected
- [x] CoC build succeeds (`npm run build` in packages/coc)
- [x] sendSSE is shared from ask-handler, not duplicated
- [x] Response helpers use CoC's router.ts (sendJson, send404, etc.)
- [x] CORS headers not duplicated in SSE handlers (router handles it)
- [x] generate-handler uses per-wiki generation state (Map), not module singleton

## Dependencies
- Depends on: 003 (WikiManager — provides get/register/remove/list/update for wiki instances)
