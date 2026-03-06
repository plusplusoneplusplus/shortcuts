# Remove Vanilla Wiki SPA from coc-server

## Problem
Two separate SPAs serve wiki content:
- `packages/coc-server/src/wiki/spa/` — Vanilla TS wiki SPA (standalone)
- `packages/coc/src/server/spa/` — React + Tailwind dashboard SPA (includes wiki views)

Since `coc serve` is always the entry point and the React dashboard already has wiki views (WikiView, WikiDetail, WikiAsk, WikiAdmin, WikiGraph), the vanilla SPA is redundant. Nobody outside `coc-server` consumes it.

## Approach
Remove the vanilla wiki SPA and its standalone server factory (`createServer`). Keep all non-SPA wiki infrastructure (WikiData, ContextBuilder, WikiManager, API handlers, routes, etc.) intact — those are actively used by `coc serve` via `registerWikiRoutes`.

## Todos

### 1. ~~delete-spa-directory~~ ✅
Delete `packages/coc-server/src/wiki/spa/` directory (html-template.ts, types.ts, helpers.ts, index.ts, client/*).

### 2. ~~delete-spa-template-barrel~~ ✅
Delete `packages/coc-server/src/wiki/spa-template.ts` (backward-compat re-export barrel).

### 3. ~~delete-create-server~~ ✅
Delete `packages/coc-server/src/wiki/create-server.ts` — standalone wiki server factory that generates SPA HTML. No external consumers.

### 4. ~~remove-spa-exports-from-index~~ ✅
Update `packages/coc-server/src/wiki/index.ts`:
- Remove `export { generateSpaHtml }` and `export type { SpaTemplateOptions }`
- Remove `export { createServer }` and `export type { WikiServerOptions, WikiServer }`

### 5. ~~update-router-remove-spa~~ ✅
Update `packages/coc-server/src/wiki/router.ts`:
- Remove `spaHtml` from `RouterOptions`
- Remove SPA HTML serving (lines 132-134) — the router's SPA fallback is no longer needed since the React dashboard handles all HTML serving
- Keep: API routes, static file serving, CORS, helpers (sendJson, send404, etc.)

### 6. ~~delete-build-client-script~~ ✅
Delete `packages/coc-server/scripts/build-client.mjs` and remove `build:client` from `package.json` scripts. Update `build` script to just `tsc`.

### 7. ~~delete-spa-tests~~ ✅
Delete test files that test the vanilla SPA HTML generation:
- `packages/coc-server/test/git-branches-ui.test.ts`
- `packages/coc-server/test/git-branches-actions-ui.test.ts`

### 8. ~~delete-client-dist~~ ✅
Delete `packages/coc-server/src/wiki/spa/client/dist/` (bundle.js, bundle.css build artifacts).

### 9. ~~build-and-test~~ ✅
Run `npm run build` and `npm run test` to verify nothing breaks.

## Notes
- The router's helper functions (`sendJson`, `send404`, `send400`, `send500`, `readBody`, `createRequestHandler`) are used by API handlers and must be preserved. Only the `spaHtml` parameter and its fallback route need removal.
- `WikiData`, `ContextBuilder`, `ConversationSessionManager`, `FileWatcher`, `WikiManager`, `registerWikiRoutes`, all API/handler files — all stay untouched.
- Features only in the vanilla SPA (git branches UI, floating AI chat widget) will be ported to the React dashboard incrementally in future work.
