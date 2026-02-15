---
status: pending
---

# 006: Create Serve-Compatible SPA Template for Review Editor

## Summary

Create the HTML template and static-image endpoint that let the Markdown Review Editor run inside the CoC serve dashboard. The template inlines all six CSS files and the bundled `webview.js`, replaces the VS Code CSP with a serve-appropriate CSP, adds a navigation header, and passes runtime config through `window.__REVIEW_CONFIG__`. An image-serving route (`GET /review/images/*`) resolves relative markdown image paths to the filesystem so rendered documents can display embedded images.

## Motivation

The Markdown Review Editor currently renders inside a VS Code webview. Porting it to `coc serve` allows users to review markdown files in a standalone browser — useful for CI review workflows, cross-device access, and non-VS-Code environments. This commit produces the HTML shell; subsequent commits will wire the transport layer (HttpTransport) and the REST API for comment CRUD.

## Background & Constraints

### Current webview HTML — `src/shortcuts/markdown-comments/webview-content.ts`

| Aspect | Detail |
|--------|--------|
| CSS files (6) | `webview.css` (17 KB), `markdown.css` (9 KB), `comments.css` (18 KB), `components.css` (20 KB), `search.css` (4 KB), `shared-context-menu.css` (11 KB) — loaded via `webview.asWebviewUri()` |
| JS bundle | `dist/webview.js` (476 KB) — webpack IIFE from `webview-scripts/main.ts` |
| highlight.js | CDN `<script>` for `https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js` |
| CSP | VS Code nonce-based: `script-src 'nonce-…' ${webview.cspSource} https://cdnjs.cloudflare.com https://cdn.jsdelivr.net` |
| Code-block theme | Dynamic `<style>` from `generateCodeBlockThemeStyle()` |
| Image resolution | `IMG_PATH:…` prefix → extension round-trip via `resolveImagePath` message |
| VS Code API | `acquireVsCodeApi()` called at init; state/messages go through `state.vscode.postMessage()` |

### CoC SPA pattern — `packages/coc/src/server/spa/html-template.ts`

| Aspect | Detail |
|--------|--------|
| CSS/JS loading | Read bundled files at module load (`fs.readFileSync`) and inline into `<style>` / `<script>` blocks |
| Config injection | `window.__DASHBOARD_CONFIG__` JSON block before the main script |
| CSP | None (localhost-only server) |
| No CDN | Everything inlined — no external network requests |

### Webview JS initialisation — `webview-scripts/main.ts`

The entry point calls `acquireVsCodeApi()` (VS Code–only global), stores the API in a `WebviewStateManager` singleton (`state.ts`), and uses it for all postMessage communication via `vscode-bridge.ts`. In serve mode this function will not exist; the init code must detect the environment and provide an alternative transport that talks HTTP/WebSocket instead of `postMessage`.

### Image handling — `webview-scripts/image-handlers.ts`

The markdown renderer prefixes relative image `src` attributes with `IMG_PATH:`. The webview JS strips this prefix and sends a `resolveImagePath` message to the extension, which responds with a webview URI. In serve mode, images must be served directly via an HTTP endpoint so the `IMG_PATH:` prefix can be replaced with a relative URL like `/review/images/<encoded-path>`.

## Changes

### New Files

#### 1. `packages/coc/src/server/review-editor/review-spa-template.ts`

Generates the complete HTML page for the review editor.

**Module-level constants (read at startup):**

```typescript
import * as fs from 'fs';
import * as path from 'path';

// Resolve paths relative to the repo root (two levels up from packages/coc/src/…)
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..', '..');

// Inline all 6 CSS files into a single block
const CSS_FILES = [
    'webview.css',
    'markdown.css',
    'comments.css',
    'components.css',
    'search.css',
    'shared-context-menu.css',
];

const inlinedCss = CSS_FILES
    .map(f => fs.readFileSync(path.join(REPO_ROOT, 'media', 'styles', f), 'utf-8'))
    .join('\n');

// Inline the bundled webview JS (IIFE — runs immediately)
const webviewJs = fs.readFileSync(
    path.join(REPO_ROOT, 'dist', 'webview.js'), 'utf-8'
);
```

> **Build note:** `dist/webview.js` is the existing webpack output (IIFE, 476 KB). The template reads the file at server startup — it does not add a new webpack entry. If a serve-specific slim entry is needed later, it can be added in a follow-up commit.

**Exported function:**

```typescript
export interface ReviewEditorOptions {
    /** File path being reviewed (absolute) */
    filePath: string;
    /** Directory containing the markdown file (for image resolution) */
    fileDir: string;
    /** Workspace root directory */
    workspaceRoot: string;
    /** API base path, e.g. '/api' */
    apiBasePath?: string;
    /** WebSocket path, e.g. '/ws' */
    wsPath?: string;
    /** Code-block theme: 'auto' | 'light' | 'dark' */
    codeBlockTheme?: string;
    /** Dashboard URL to link back to */
    dashboardUrl?: string;
}

export function generateReviewEditorHtml(options: ReviewEditorOptions): string { … }
```

**HTML structure:**

| Section | Detail |
|---------|--------|
| `<head>` | `<meta charset>`, `<meta viewport>`, `<title>Review: {basename}</title>` |
| CSP | `<meta http-equiv="Content-Security-Policy" content="default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self' ws: wss:;">` |
| `<style>` | Inlined CSS block (`inlinedCss`) + code-block theme CSS (import `generateCodeBlockThemeStyle` from the shared `code-block-themes.ts` module — may require extracting it to a location importable by the coc package, or duplicating the small amount of CSS with a `TODO`) |
| Navigation header | `<div class="review-nav-header">` with a "← Dashboard" link (`options.dashboardUrl ?? '/'`) and the file name |
| `<body>` content | Identical to the webview-content.ts body: search bar, toolbar, editor container, floating comment panel, inline edit panel, context menu, predefined preview, custom instruction dialog, follow-prompt dialog, update-document dialog, refresh-plan dialog |
| Config injection | `<script>window.__REVIEW_CONFIG__ = { filePath, fileDir, workspaceRoot, apiBasePath, wsPath, serveMode: true };</script>` |
| highlight.js | Inline or keep as CDN? **Decision: keep CDN `<script>` for now** — it's 50 KB compressed, inlining adds startup cost. Update CSP to allow `https://cdnjs.cloudflare.com`. Mark with `TODO: consider bundling highlight.js` |
| Webview JS | `<script>${webviewJs}</script>` — inlined |

**Serve-mode detection contract:** The webview JS (`main.ts`) will check `window.__REVIEW_CONFIG__?.serveMode`. When truthy, it must skip `acquireVsCodeApi()` and use an `HttpTransport` instead. That transport wiring is **commit 007** scope; this commit only ensures the config is injected and the HTML renders.

**Navigation header CSS (appended to inlined CSS):**

```css
.review-nav-header {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 8px 16px;
    background: var(--vscode-editor-background, #1e1e1e);
    border-bottom: 1px solid var(--vscode-panel-border, #333);
    font-size: 13px;
}
.review-nav-header a {
    color: var(--vscode-textLink-foreground, #3794ff);
    text-decoration: none;
}
.review-nav-header a:hover { text-decoration: underline; }
.review-nav-header .review-filename {
    font-weight: 600;
    color: var(--vscode-foreground, #ccc);
}
```

#### 2. `packages/coc/src/server/review-editor/review-image-handler.ts`

Serves images referenced in markdown files.

**Route:** `GET /review/images/*`

```typescript
import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import type { Route } from '../types';

const IMAGE_MIME: Record<string, string> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.webp': 'image/webp',
    '.bmp': 'image/bmp',
    '.ico': 'image/x-icon',
};

export function createImageRoute(baseDir: string): Route {
    return {
        method: 'GET',
        pattern: /^\/review\/images\/(.+)$/,
        handler: (req, res, match) => { … },
    };
}
```

**Handler logic:**

1. Decode the captured path segment: `decodeURIComponent(match![1])`
2. Resolve against `baseDir` (the markdown file's directory or workspace root): `path.resolve(baseDir, relativePath)`
3. **Security:** Verify the resolved path starts with `baseDir` (prevent directory traversal). If not → 403.
4. Check file exists and is a regular file. If not → 404.
5. Look up MIME from extension. If unknown → `application/octet-stream`.
6. Stream file to response with `Cache-Control: public, max-age=3600`.

**Why a new handler instead of using the existing static file server?**
The router's static file serving is tied to `staticDir` and the `/static/` prefix. Markdown images are relative to the reviewed file's directory, which varies per document. A dedicated route scoped to a known `baseDir` is cleaner and safer.

#### 3. `packages/coc/src/server/review-editor/index.ts`

Barrel export:

```typescript
export { generateReviewEditorHtml } from './review-spa-template';
export type { ReviewEditorOptions } from './review-spa-template';
export { createImageRoute } from './review-image-handler';
```

### Files to Modify

#### 4. `packages/coc/src/server/index.ts`

Add re-exports for the review-editor module so consumers can import from `@plusplusoneplusplus/coc/server`:

```typescript
// Add after existing re-exports (line ~284)
export { generateReviewEditorHtml, createImageRoute } from './review-editor';
export type { ReviewEditorOptions } from './review-editor';
```

**No wiring into `createExecutionServer()` yet** — the review editor route registration and SPA serving happen in a later commit (008) that adds the `GET /review/:fileId` route.

### Files NOT Modified

| File | Reason |
|------|--------|
| `src/shortcuts/markdown-comments/webview-content.ts` | VS Code webview template stays unchanged; the serve template is a parallel implementation |
| `src/shortcuts/markdown-comments/webview-scripts/main.ts` | Serve-mode detection (`window.__REVIEW_CONFIG__`) will be added in commit 007 (HttpTransport) |
| `webpack.config.js` | No new entry needed; we reuse `dist/webview.js` as-is |
| `packages/coc/src/server/router.ts` | No changes; review routes will be registered in commit 008 |
| `media/styles/*.css` | CSS files are read, not modified |

## Design Decisions

### 1. Inline CSS+JS vs. external files

**Decision: Inline everything** (matching `html-template.ts` pattern).

The six CSS files total ~79 KB and the JS bundle is 476 KB. While large, this avoids cache-busting complexity and keeps the serve architecture simple (single HTML response, no static asset routing for the editor). The files are read once at startup, not per-request.

### 2. highlight.js loading

**Decision: Keep CDN for now, update CSP.**

highlight.js is ~50 KB minified. Inlining it would push the HTML past 500 KB. A future optimisation can bundle it into the webview.js webpack output or load it from `/static/`.

### 3. Code-block theme CSS

**Decision: Import `generateCodeBlockThemeStyle` if possible; otherwise duplicate the CSS constants.**

The function is in `src/shortcuts/markdown-comments/code-block-themes.ts` which has no VS Code dependencies — it returns a CSS string. Options:
- **Preferred:** Move to `packages/pipeline-core/` or a shared location and import from both the extension and coc.
- **Fallback:** Copy the small set of CSS colour constants into the review-spa-template. Mark with `TODO: deduplicate with code-block-themes.ts`.

The serve template will default to `'dark'` theme unless overridden in options.

### 4. `window.__REVIEW_CONFIG__` shape

```typescript
interface ReviewConfig {
    filePath: string;      // absolute path to the .md file
    fileDir: string;       // directory of the .md file
    workspaceRoot: string; // workspace root
    apiBasePath: string;   // e.g. '/api'
    wsPath: string;        // e.g. '/ws'
    serveMode: true;       // discriminant for serve vs. webview
}
```

This is the contract between the HTML template and the webview JS. Commit 007 will add the JS-side detection.

### 5. Image URL rewriting

In VS Code mode, images use the `IMG_PATH:relative/path.png` → `resolveImagePath` message → webview URI flow.

In serve mode, the SPA template will need a small JS shim (or the image-handlers.ts will be modified in commit 007) to replace `IMG_PATH:relative/path.png` with `/review/images/relative/path.png`. For this commit, we just ensure the `/review/images/*` endpoint exists and serves files correctly. The client-side rewriting is commit 007 scope.

### 6. Body HTML duplication

The body HTML (toolbar, panels, dialogs) is duplicated from `webview-content.ts`. This is intentional:
- The serve version will diverge (e.g., no "Send to CLI" options that require VS Code, different AI action menus).
- Extracting a shared template would couple the extension build to the coc package.
- The HTML is static markup (~300 lines) that rarely changes.

## Testing

### Manual

1. Build the extension (`npm run compile`) to produce `dist/webview.js`
2. Build coc (`cd packages/coc && npm run build`)
3. Start server (`coc serve --no-open`)
4. The review editor HTML is not yet routed (that's commit 008), but verify:
   - `generateReviewEditorHtml()` can be called without errors (import test)
   - The returned HTML string contains inlined CSS, inlined JS, and the config block
   - `createImageRoute('/tmp/test-dir')` returns a valid Route object

### Unit tests — `packages/coc/test/review-spa-template.test.ts`

| Test | Assertion |
|------|-----------|
| `generates valid HTML` | Contains `<!DOCTYPE html>`, `<html`, `</html>` |
| `inlines all 6 CSS files` | Contains distinctive selectors from each CSS file (e.g., `.floating-comment-panel` from comments.css, `.search-bar` from search.css) |
| `inlines webview JS` | Contains `[Webview] Initializing` (a console.log string from main.ts) |
| `includes review config` | Contains `window.__REVIEW_CONFIG__` with `serveMode: true` |
| `includes navigation header` | Contains `review-nav-header` and the dashboard link |
| `CSP allows self and CDN` | Meta tag contains `script-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com` |
| `image route matches pattern` | Route pattern matches `/review/images/foo/bar.png` |
| `image route rejects traversal` | Request for `/review/images/../../etc/passwd` returns 403 |
| `image route serves existing file` | Write a temp PNG, request it, verify 200 with correct MIME |
| `image route returns 404 for missing` | Request non-existent file → 404 |

### Automated

Run with: `cd packages/coc && npm run test:run`

## Rollback

Delete the `packages/coc/src/server/review-editor/` directory and remove the re-export lines from `packages/coc/src/server/index.ts`. No other files are modified.
