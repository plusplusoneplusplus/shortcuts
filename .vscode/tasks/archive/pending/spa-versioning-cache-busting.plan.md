# CoC SPA Versioning & Cache-Busting

## Problem

The CoC dashboard SPA (`packages/coc`) inlines `bundle.css` and `bundle.js` directly into the HTML response. When those bundles change (after a rebuild), browsers that cached the previous HTML page will keep serving stale CSS/JS until their cache expires or is manually cleared.

Currently the SPA HTML response has **no cache-related headers** — no `Cache-Control`, no `ETag`, no `Last-Modified`. Browsers may or may not cache it opportunistically depending on their heuristics.

## Proposed Approach

Implement **ETag-based conditional caching** for the SPA HTML response:

- Compute a **content hash** from the bundle files (`bundle.css` + `bundle.js`) whenever they change on disk (reuses the existing mtime-based cache in `html-template.ts`).
- Expose the hash as an `ETag` response header on every SPA HTML response.
- Add `Cache-Control: no-cache` so browsers always **revalidate** with the server before using a cached copy.
- Handle `If-None-Match` conditional requests: return `304 Not Modified` when the ETag matches (no body, fast response).
- Inject the version hash into `window.__DASHBOARD_CONFIG__` so the browser console can show the current build.

This means:
- First load: full HTML response (as today).
- Subsequent loads (same bundles): 304 — instant, no bandwidth used.
- After a rebuild: ETag changes → browser fetches fresh HTML → new CSS/JS rendered.

## Files to Change

| File | Change |
|------|--------|
| `packages/coc/src/server/spa/html-template.ts` | Add `getBundleETag()` export (hash of CSS+JS content); inject `version` into `__DASHBOARD_CONFIG__` |
| `packages/coc-server/src/shared/router.ts` | Add `spaETag?` to `SharedRouterOptions`; set `ETag` + `Cache-Control: no-cache`; handle `If-None-Match` → 304 |
| `packages/coc/src/server/index.ts` | Pass `spaETag: getBundleETag` to `createRequestHandler` |
| `packages/coc/src/server/spa/__tests__/html-template.test.ts` | Tests for `getBundleETag()` |
| `packages/coc-server/src/shared/__tests__/router.test.ts` | Tests for ETag header, 304 response, `If-None-Match` handling |

## Implementation Notes

- Use Node.js built-in `crypto.createHash('sha256')` over `bundle.css + bundle.js` content — no new dependencies.
- The ETag value format: `"<first-16-hex-chars-of-sha256>"` (short, standard, quoted per RFC 7232).
- ETag is cached alongside the CSS/JS content (invalidated when mtime changes) — no per-request hashing.
- `Cache-Control: no-cache` (not `no-store`) — allows cached copy but requires revalidation. This is the correct directive for versioned HTML.
- The `spaETag` option in `SharedRouterOptions` is optional (`?`) and mirrors `spaHtml`: accepts `string | (() => string | undefined)`. When absent, behavior is unchanged.
- Static file serving (`serveStaticFile`) already uses `max-age=3600`; no change needed there since CSS/JS are inlined, not served separately.

## Todos

1. ~~**Add `getBundleETag()` to html-template.ts** — compute + cache SHA-256 hash from bundle content, invalidate with mtime~~
2. ~~**Inject version into `__DASHBOARD_CONFIG__`** — add `version: string` field in the generated HTML~~
3. ~~**Extend `SharedRouterOptions`** — add optional `spaETag?: string | (() => string | undefined)`~~
4. ~~**Update SPA handler in router.ts** — set ETag + Cache-Control headers; return 304 on If-None-Match match~~
5. ~~**Wire `spaETag` in server/index.ts** — import and pass `getBundleETag`~~
6. ~~**Write tests for html-template.ts** — verify ETag is stable when content unchanged, changes when bundles change~~
7. ~~**Write tests for router.ts** — verify 304 on match, 200 on mismatch, correct headers~~
