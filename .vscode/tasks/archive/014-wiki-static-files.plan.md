---
status: pending
---

# 014: Wiki Static File Serving and Deep-Linking

## Summary
Add per-wiki static file serving (component-graph.json, images, etc.) and SPA deep-linking for wiki URLs (#wiki/:wikiId/component/:compId).

## Motivation
Wiki directories may contain static assets (images, embedded data, component-graph.json, markdown articles, font files) that need to be served when the CoC dashboard hosts a wiki. Deep-linking allows users to share URLs to specific components within a wiki.

## Changes

### Files to Create
- `packages/coc/src/server/spa/client/wiki.ts` — Handle deep-link navigation on initial page load; export `navigateToWikiComponent(wikiId, componentId)` and `showWikiTab(wikiId)` helpers

### Files to Modify
- `packages/coc/src/server/router.ts` — Add wiki static file route pattern and expand MIME types
- `packages/coc/src/server/spa/client/core.ts` — Add wiki deep-link hash parsing in `handleHashChange()`
- `packages/coc/src/server/spa/client/state.ts` — Add wiki-related fields to `AppState` and `DashboardTab`

### Files to Delete
- (none)

## Implementation Notes

### 1. Static File Route (`router.ts`)

**Route pattern:** `/wiki/:wikiId/static/*` — Regex: `/^\/wiki\/([^/]+)\/static\/(.+)$/`

The router must resolve `wikiId` to a wiki directory on disk (via a wiki registry or store passed in `RouterOptions`), then serve the requested file from that directory.

**Path traversal protection:**
The deep-wiki router at `packages/deep-wiki/src/server/router.ts:126-129` uses `path.join(wikiData.dir, pathname)` with `path.normalize()` but lacks an explicit containment check. The CoC implementation must add an explicit guard:
```typescript
const resolved = path.resolve(wikiDir, relativePath);
if (!resolved.startsWith(path.resolve(wikiDir) + path.sep) && resolved !== path.resolve(wikiDir)) {
    send404(res, 'Invalid path');
    return;
}
```
This prevents `../` escapes (e.g., `/wiki/myWiki/static/../../etc/passwd`).

**Routing insertion point:**
Add the wiki static route block in the request handler between the `/api/` route handling (line 105-137) and the existing `staticDir` serving (line 140-145). Wiki routes take priority because they have a more specific prefix (`/wiki/:wikiId/static/`).

```typescript
// Wiki static files: /wiki/:wikiId/static/*
const wikiStaticMatch = pathname.match(/^\/wiki\/([^/]+)\/static\/(.+)$/);
if (wikiStaticMatch) {
    const wikiId = wikiStaticMatch[1];
    const fileSuffix = wikiStaticMatch[2];
    const wikiDir = wikiRegistry?.getWikiDir(wikiId);
    if (!wikiDir) {
        send404(res, `Wiki not found: ${wikiId}`);
        return;
    }
    const resolved = path.resolve(wikiDir, fileSuffix);
    if (!resolved.startsWith(path.resolve(wikiDir) + path.sep)) {
        send404(res, 'Invalid path');
        return;
    }
    if (serveStaticFile(resolved, res)) {
        return;
    }
    send404(res, `File not found: ${fileSuffix}`);
    return;
}
```

**Additional MIME types to add to `MIME_TYPES` map:**
The deep-wiki router (`packages/deep-wiki/src/server/router.ts:27-42`) includes these types that the CoC router (lines 24-32) is missing:
- `.jpg` → `'image/jpeg'`
- `.jpeg` → `'image/jpeg'`
- `.gif` → `'image/gif'`
- `.woff` → `'font/woff'`
- `.woff2` → `'font/woff2'`
- `.ttf` → `'font/ttf'`
- `.md` → `'text/markdown; charset=utf-8'`

These are needed because wiki directories contain images (from markdown articles), font files (for static website output), and raw markdown sources.

**RouterOptions change:**
Add an optional `wikiRegistry` field to the `RouterOptions` interface (or a simple lookup function `getWikiDir?: (wikiId: string) => string | undefined`) so the router can resolve wiki IDs to filesystem paths without importing wiki-specific types.

### 2. SPA Deep-Link Hash Routing (`core.ts`)

**New hash patterns to handle in `handleHashChange()` (after line 117, before the `#tasks` check):**

```typescript
// #wiki/:wikiId
const wikiMatch = hash.match(/^wiki\/([^/]+)$/);
if (wikiMatch) {
    (window as any).switchTab?.('wiki');
    (window as any).showWikiTab?.(decodeURIComponent(wikiMatch[1]));
    return;
}

// #wiki/:wikiId/component/:componentId
const wikiComponentMatch = hash.match(/^wiki\/([^/]+)\/component\/(.+)$/);
if (wikiComponentMatch) {
    (window as any).switchTab?.('wiki');
    (window as any).navigateToWikiComponent?.(
        decodeURIComponent(wikiComponentMatch[1]),
        decodeURIComponent(wikiComponentMatch[2])
    );
    return;
}
```

**Important:** Check the more-specific `#wiki/:wikiId/component/:compId` pattern *before* the shorter `#wiki/:wikiId` pattern to avoid false matches. Alternatively, use a single regex with optional component group.

**New navigation helpers to export:**
```typescript
export function navigateToWiki(wikiId: string): void {
    location.hash = '#wiki/' + encodeURIComponent(wikiId);
}

export function navigateToWikiComponent(wikiId: string, componentId: string): void {
    location.hash = '#wiki/' + encodeURIComponent(wikiId) + '/component/' + encodeURIComponent(componentId);
}
```

Register on `window` alongside existing `navigateToProcess`, `navigateToSession`, `navigateToHome`.

### 3. State Changes (`state.ts`)

**Extend `DashboardTab` union:**
```typescript
export type DashboardTab = 'processes' | 'repos' | 'reports' | 'tasks' | 'wiki';
```

**Add wiki state to `AppState`:**
```typescript
interface AppState {
    // ... existing fields ...
    selectedWikiId: string | null;
    selectedWikiComponentId: string | null;
}
```

Initialize both as `null` in the `appState` default object.

### 4. Wiki Tab Module (`wiki.ts`)

New file `packages/coc/src/server/spa/client/wiki.ts` handles:

- `showWikiTab(wikiId: string)` — Load wiki index/home for the given wiki, update `appState.selectedWikiId`
- `navigateToWikiComponent(wikiId: string, componentId: string)` — Fetch component data from `/api/wiki/:wikiId/components/:componentId`, render in detail pane, update `appState.selectedWikiComponentId`
- Register `window.showWikiTab` and `window.navigateToWikiComponent` globals (matching the pattern used by `repos.ts` line 648)

The wiki tab fetches data from CoC API endpoints (defined in a separate task), not directly from static files. Static files are only for assets referenced within wiki HTML/markdown content (images, fonts, embedded JS).

### 5. `serveStaticFile` Visibility

The existing `serveStaticFile` function in `router.ts` (line 161) is module-private. It should remain private — the wiki static route logic calls it inline within `createRequestHandler`, not from an external module. No visibility change needed.

## Tests

### Static File Serving Tests
- **Serve existing file:** `GET /wiki/my-wiki/static/component-graph.json` → 200 with `application/json` content type
- **Serve image:** `GET /wiki/my-wiki/static/images/diagram.png` → 200 with `image/png`
- **Serve markdown:** `GET /wiki/my-wiki/static/articles/intro.md` → 200 with `text/markdown`
- **Serve font:** `GET /wiki/my-wiki/static/fonts/custom.woff2` → 200 with `font/woff2`
- **Path traversal blocked:** `GET /wiki/my-wiki/static/../../../etc/passwd` → 404 (resolved path escapes wikiDir)
- **Path traversal via encoded:** `GET /wiki/my-wiki/static/..%2F..%2Fetc%2Fpasswd` → 404 (URL-decoded then checked)
- **Unknown wiki:** `GET /wiki/nonexistent/static/file.json` → 404 with "Wiki not found" message
- **Missing file in valid wiki:** `GET /wiki/my-wiki/static/no-such-file.txt` → 404
- **Directory request (not a file):** `GET /wiki/my-wiki/static/images/` → 404 (stat.isFile() check)
- **Correct Cache-Control header:** Response includes `Cache-Control: public, max-age=3600`

### MIME Type Tests
- Verify all 7 new MIME type entries return correct `Content-Type` headers
- Verify unknown extension falls back to `application/octet-stream`

### Deep-Link Routing Tests
- **Wiki home hash:** `#wiki/my-wiki` → calls `switchTab('wiki')` and `showWikiTab('my-wiki')`
- **Wiki component hash:** `#wiki/my-wiki/component/auth-module` → calls `switchTab('wiki')` and `navigateToWikiComponent('my-wiki', 'auth-module')`
- **Encoded IDs:** `#wiki/my%20wiki/component/my%2Fcomp` → correctly decodes both wikiId and componentId
- **navigateToWiki()** sets `location.hash` to `#wiki/<encoded-id>`
- **navigateToWikiComponent()** sets `location.hash` to `#wiki/<encoded-id>/component/<encoded-id>`
- **Unknown hash falls through:** `#wiki` (no wikiId) → falls through to default `#processes` behavior

### State Tests
- `DashboardTab` type accepts `'wiki'`
- `appState.selectedWikiId` and `appState.selectedWikiComponentId` default to `null`

## Acceptance Criteria
- [x] Wiki static files served at `/wiki/:wikiId/static/*` with correct MIME types
- [x] Path traversal attacks blocked (resolved path must stay within wikiDir)
- [x] MIME types map includes `.jpg`, `.jpeg`, `.gif`, `.woff`, `.woff2`, `.ttf`, `.md`
- [x] Deep-link `#wiki/:wikiId` navigates to wiki home tab
- [x] Deep-link `#wiki/:wikiId/component/:compId` navigates to specific component
- [x] `navigateToWiki()` and `navigateToWikiComponent()` helpers exported and registered on window
- [x] `DashboardTab` type includes `'wiki'`
- [x] `AppState` includes `selectedWikiId` and `selectedWikiComponentId`
- [x] Missing wiki returns 404 JSON with descriptive error
- [x] Missing file in valid wiki returns 404
- [ ] CoC build succeeds (`npm run build` in `packages/coc/`) — pre-existing TS error in index.ts unrelated to this task

## Dependencies
- Depends on: 004 (wiki API routes — provides `/api/wiki/:wikiId/components/:id` endpoint), 006 (wiki tab shell — provides the wiki tab container in the SPA HTML template)
