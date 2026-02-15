---
commit: "009"
title: Integrate review editor SPA into CoC serve and add navigation
status: pending
---

# 009 — Integrate review editor SPA into CoC serve and add navigation

## Why

Commits 006–008 laid the groundwork: the SPA dashboard (006), the review REST API (007), and the abstract transport layer (003) / HttpTransport concept (008). This commit wires them all together so a user can navigate from the process dashboard to a file browser, select a markdown file, and use the full review editor — all in the browser, no VS Code required.

## Dependencies

- **003** — `EditorTransport` interface and `VscodeTransport` implementation in webview-scripts
- **007** — REST API routes for review files, comments, and images (`review-handler.ts`)
- **001** — Shared interfaces in `packages/pipeline-core/src/editor/` (typed messages, transport interface)
- **005** — `StateStore` / `FileStateStore` for server-side state persistence

## What changes

### End-to-end flow

```
Dashboard (/)
  ↓ click "Review" nav link
File Browser (/review)
  ↓ click a file
Review Editor (/review/path/to/file.md)
  ↓ SPA loads
  ↓ Reads window.__REVIEW_CONFIG__
  ↓ Creates HttpTransport (fetch + WebSocket)
  ↓ GET /api/review/files/:path → file content + comments
  ↓ WebSocket subscribes to file-scoped comment updates
  ↓ User adds/edits/resolves comments
  ↓ HttpTransport → POST/PATCH/DELETE /api/review/files/:path/comments/...
  ↓ Server broadcasts via WebSocket → other connected clients see changes
  ↓ File watcher detects .md changes on disk → WebSocket notifies → SPA re-fetches
```

## Changes

### 1. New file: `packages/coc/src/server/spa/client/review-config.ts`

Config reader for the review editor page, analogous to `config.ts` for the dashboard:

```typescript
export interface ReviewConfig {
    apiBasePath: string;
    wsPath: string;
    filePath: string;       // relative path of the file being reviewed
    projectDir: string;     // server's project root (for display only)
}

export function getReviewConfig(): ReviewConfig | null {
    return (window as any).__REVIEW_CONFIG__ ?? null;
}

export function isReviewMode(): boolean {
    return getReviewConfig() !== null;
}
```

### 2. New file: `packages/coc/src/server/spa/client/http-transport.ts`

`HttpTransport` implements `EditorTransport` (from commit 003) using `fetch` + WebSocket. This is the browser-side counterpart to `VscodeTransport`.

```typescript
import type { EditorTransport } from './transport-types';
// EditorTransport interface: postMessage(msg), onMessage(handler)

export class HttpTransport implements EditorTransport {
    private ws: WebSocket | null = null;
    private handlers: Array<(msg: any) => void> = [];
    private reconnectDelay = 1000;
    private filePath: string;
    private apiBase: string;
    private wsPath: string;

    constructor(options: { apiBase: string; wsPath: string; filePath: string }) {
        this.apiBase = options.apiBase;
        this.wsPath = options.wsPath;
        this.filePath = options.filePath;
    }

    /** Connect WebSocket and subscribe to file-scoped comment events */
    connect(): void { ... }

    /** Send a WebviewMessage to the server via REST API */
    postMessage(message: WebviewToBackendMessage): void {
        // Map message types to REST calls:
        // addComment    → POST /api/review/files/:path/comments
        // editComment   → PATCH /api/review/files/:path/comments/:id
        // deleteComment → DELETE /api/review/files/:path/comments/:id
        // resolveComment→ PATCH /api/review/files/:path/comments/:id {status:'resolved'}
        // reopenComment → PATCH /api/review/files/:path/comments/:id {status:'open'}
        // resolveAll    → POST /api/review/files/:path/comments/resolve-all
        // deleteAll     → DELETE /api/review/files/:path/comments
        // updateContent → POST /api/review/files/:path/content  (new route, see §6)
        // ready         → GET /api/review/files/:path (fetch initial state)
    }

    /** Register handler for BackendToWebviewMessage from WebSocket */
    onMessage(handler: (msg: any) => void): void {
        this.handlers.push(handler);
    }

    private dispatchToHandlers(msg: any): void { ... }
    private reconnect(): void { ... }
}
```

**Key design decisions:**
- Outbound messages (webview → server) use REST because they're request/response (need status codes, error envelopes)
- Inbound messages (server → webview) use WebSocket because they're push notifications (comment changes from other clients, file-change events)
- On `'ready'` message, fetches `GET /api/review/files/:path` and synthesizes an `'update'` BackendToWebviewMessage with `{ content, comments, filePath, settings }`

### 3. New file: `packages/coc/src/server/spa/client/review-browser.ts`

Client-side module for the `/review` file browser page. Renders a list of markdown files fetched from `GET /api/review/files`.

```typescript
export async function initFileBrowser(): void {
    const res = await fetch(getApiBase() + '/review/files');
    const { files } = await res.json();
    renderFileList(files);
}

function renderFileList(files: Array<{ path: string; name: string; commentCount: number }>): void {
    // Renders into #review-browser-content:
    // - Search/filter input
    // - File cards: name, path, comment count badge
    // - Each card links to /review/<encodedPath>
}
```

### 4. New file: `packages/coc/src/server/spa/client/review-editor.ts`

Client-side module for the `/review/:filePath` editor page. Initializes the review editor in serve mode.

```typescript
import { HttpTransport } from './http-transport';
import { getReviewConfig } from './review-config';

export async function initReviewEditor(): void {
    const config = getReviewConfig();
    if (!config) return;

    const transport = new HttpTransport({
        apiBase: config.apiBasePath,
        wsPath: config.wsPath,
        filePath: config.filePath,
    });

    // Set up transport as the messaging layer
    // Re-use existing webview render logic:
    // - transport.onMessage → handle 'update' messages → render markdown + comments
    // - DOM event handlers → transport.postMessage for comment CRUD
    transport.connect();

    // Send 'ready' to trigger initial state fetch
    transport.postMessage({ type: 'ready' });
}
```

**How existing webview code is reused:** The review editor HTML structure (toolbar, editor container, comment panels, context menu) is rendered server-side in the HTML template. The existing `render.ts`, `dom-handlers.ts`, `panel-manager.ts` logic from the webview-scripts is adapted into a serve-mode bundle that imports from `http-transport` instead of `vscode-bridge`. The adaptation strategy is:

1. The transport layer (commit 003's `EditorTransport`) already abstracts away `postMessage` vs HTTP
2. `main.ts` detects `window.__REVIEW_CONFIG__` and picks `HttpTransport` instead of `VscodeTransport`
3. All 28 bridge functions in `vscode-bridge.ts` work unchanged because they call `state.transport.postMessage()`
4. The serve-mode HTML template provides the same DOM structure the scripts expect

### 5. Edit: `packages/coc/src/server/spa/client/core.ts`

Add route detection for `/review` and `/review/:path` in the `init()` function and the `popstate` handler:

```typescript
export async function init(): Promise<void> {
    // ... existing dashboard init ...

    // Review routes
    const reviewMatch = location.pathname.match(/^\/review\/(.+)$/);
    const isFileBrowser = location.pathname === '/review';

    if (isFileBrowser) {
        showPage('review-browser');
        await initFileBrowser();
        return;
    }

    if (reviewMatch) {
        const filePath = decodeURIComponent(reviewMatch[1]);
        showPage('review-editor');
        await initReviewEditor();
        return;
    }

    // Default: dashboard
    showPage('dashboard');
    // ... existing init logic (workspaces, processes, renderProcessList) ...
}
```

Add a `showPage(page: 'dashboard' | 'review-browser' | 'review-editor')` function that toggles visibility of the three page containers.

Update `popstate` handler to re-run routing based on `location.pathname`.

### 6. Edit: `packages/coc/src/server/spa/html-template.ts`

**Add navigation link in the top bar:**

```html
<div class="top-bar-left">
    <button class="hamburger-btn" id="hamburger-btn">&#9776;</button>
    <span class="top-bar-logo">${escapeHtml(title)}</span>
    <nav class="top-bar-nav">
        <a href="/" class="nav-link" data-page="dashboard">Dashboard</a>
        <a href="/review" class="nav-link" data-page="review">Review</a>
    </nav>
</div>
```

**Add page containers to the body:**

Keep the existing `<div class="app-layout">` for the dashboard page and add sibling containers:

```html
<!-- Existing dashboard layout (id="page-dashboard") -->
<div class="app-layout" id="page-dashboard">
    <aside class="sidebar" id="sidebar">...</aside>
    <main class="detail-panel" id="detail-panel">...</main>
</div>

<!-- File browser page (id="page-review-browser") -->
<div class="page-container hidden" id="page-review-browser">
    <div class="review-browser-header">
        <h2>Markdown Files</h2>
        <input type="text" id="review-search" placeholder="Filter files..." />
    </div>
    <div id="review-browser-content" class="review-browser-content"></div>
</div>

<!-- Review editor page (id="page-review-editor") -->
<div class="page-container hidden" id="page-review-editor">
    <div class="review-editor-toolbar" id="review-toolbar">
        <a href="/review" class="back-link">&larr; Files</a>
        <span class="review-file-name" id="review-file-name"></span>
        <div class="review-toolbar-actions">
            <button id="review-resolve-all">Resolve All</button>
            <span class="review-comment-count" id="review-comment-count"></span>
        </div>
    </div>
    <div class="review-editor-layout">
        <div class="review-content" id="review-content"></div>
        <aside class="review-comments-panel" id="review-comments-panel"></aside>
    </div>
</div>
```

**Inject `__REVIEW_CONFIG__` conditionally:**

The `generateDashboardHtml` function gains an optional `reviewFilePath` parameter. When set, the template also injects:

```html
<script>
    window.__REVIEW_CONFIG__ = {
        apiBasePath: '${escapeHtml(apiBasePath)}',
        wsPath: '${escapeHtml(wsPath)}',
        filePath: '${escapeHtml(reviewFilePath)}',
        projectDir: '${escapeHtml(projectDir)}'
    };
</script>
```

Update `DashboardOptions` in `packages/coc/src/server/spa/types.ts`:

```typescript
export interface DashboardOptions {
    title?: string;
    theme?: 'auto' | 'light' | 'dark';
    wsPath?: string;
    apiBasePath?: string;
    reviewFilePath?: string;   // NEW: set when serving /review/:path
    projectDir?: string;       // NEW: server project directory
}
```

### 7. Edit: `packages/coc/src/server/router.ts`

The current SPA fallback always serves the same cached `spaHtml`. For review editor routes, we need to serve HTML with `__REVIEW_CONFIG__` injected. Two approaches:

**Approach A (recommended): Dynamic SPA generation for review routes**

Before the SPA fallback, add a special case for review editor paths:

```typescript
// Review editor — dynamic SPA with file-specific config
const reviewEditorMatch = pathname.match(/^\/review\/(.+)$/);
if (reviewEditorMatch) {
    const filePath = decodeURIComponent(reviewEditorMatch[1]);
    const reviewHtml = options.generateReviewHtml?.(filePath) ?? spaHtml;
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(reviewHtml);
    return;
}

// SPA fallback (dashboard + /review file browser)
res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
res.end(spaHtml);
```

Add `generateReviewHtml?: (filePath: string) => string` to `RouterOptions`.

### 8. Edit: `packages/coc/src/server/index.ts`

Wire the review HTML generator:

```typescript
// After existing `const spaHtml = generateDashboardHtml();`
const projectDir = options.projectDir ?? process.cwd();

const handler = createRequestHandler({
    routes,
    spaHtml,
    store,
    generateReviewHtml: (filePath: string) => {
        return generateDashboardHtml({
            reviewFilePath: filePath,
            projectDir,
        });
    },
});
```

### 9. New WebSocket message types for review events

Extend `ServerMessage` in `packages/coc/src/server/websocket.ts`:

```typescript
export type ServerMessage =
    | { type: 'welcome'; clientId: string; timestamp: number }
    | { type: 'pong' }
    | { type: 'process-added'; process: ProcessSummary }
    | { type: 'process-updated'; process: ProcessSummary }
    | { type: 'process-removed'; processId: string }
    | { type: 'processes-cleared'; count: number }
    | { type: 'queue-updated'; queue: QueueSnapshot }
    // NEW: Review editor events
    | { type: 'review-comment-added'; filePath: string; comment: MarkdownComment }
    | { type: 'review-comment-updated'; filePath: string; comment: MarkdownComment }
    | { type: 'review-comment-deleted'; filePath: string; commentId: string }
    | { type: 'review-file-changed'; filePath: string };

export type ClientMessage =
    | { type: 'ping' }
    | { type: 'subscribe'; workspaceId: string }
    // NEW: subscribe to review file events
    | { type: 'subscribe-review'; filePath: string };
```

Add file-scoped subscription filtering to `broadcastProcessEvent` (or add a separate `broadcastReviewEvent` method):

```typescript
broadcastReviewEvent(message: ServerMessage, filePath: string): void {
    const data = JSON.stringify(message);
    for (const client of this.clients) {
        // Send to clients subscribed to this file, or to all unsubscribed clients
        if (!client.reviewFilePath || client.reviewFilePath === filePath) {
            client.send(data);
        }
    }
}
```

Add `reviewFilePath?: string` to `WSClient`.

### 10. New file: `packages/coc/src/server/review-watcher.ts`

File system watcher for markdown files. Uses `fs.watch` (Node.js built-in) to detect changes and notify connected WebSocket clients.

```typescript
import * as fs from 'fs';
import * as path from 'path';
import type { ProcessWebSocketServer } from './websocket';

export class ReviewFileWatcher {
    private watchers: Map<string, fs.FSWatcher> = new Map();

    constructor(
        private readonly projectDir: string,
        private readonly wsServer: ProcessWebSocketServer,
    ) {}

    /** Watch a specific file for changes */
    watchFile(relativePath: string): void {
        const absPath = path.resolve(this.projectDir, relativePath);
        if (this.watchers.has(relativePath)) return;

        try {
            const watcher = fs.watch(absPath, { persistent: false }, (eventType) => {
                if (eventType === 'change') {
                    this.wsServer.broadcastReviewEvent(
                        { type: 'review-file-changed', filePath: relativePath },
                        relativePath,
                    );
                }
            });
            this.watchers.set(relativePath, watcher);
        } catch {
            // File may not exist yet — ignore
        }
    }

    /** Stop watching a file */
    unwatchFile(relativePath: string): void {
        const watcher = this.watchers.get(relativePath);
        if (watcher) {
            watcher.close();
            this.watchers.delete(relativePath);
        }
    }

    /** Close all watchers */
    closeAll(): void {
        for (const watcher of this.watchers.values()) {
            watcher.close();
        }
        this.watchers.clear();
    }
}
```

Wire into `index.ts` — create `ReviewFileWatcher` and start watching when clients subscribe:

```typescript
const reviewWatcher = new ReviewFileWatcher(projectDir, wsServer);

// In server close handler:
reviewWatcher.closeAll();
```

The watcher is activated lazily: when a WebSocket client sends `{ type: 'subscribe-review', filePath: '...' }`, call `reviewWatcher.watchFile(filePath)`. When the last client for a file disconnects, call `reviewWatcher.unwatchFile(filePath)`.

### 11. Edit: `packages/coc/src/server/spa/client/index.ts`

Add imports for the new review modules:

```typescript
// Existing imports...

// 9. Review modules (no side effects — activated by route detection in core.ts)
import './review-config';
import './review-browser';
import './review-editor';
import './http-transport';
```

### 12. Edit: `packages/coc/src/server/spa/client/styles.css`

Add CSS for the review pages:

- `.top-bar-nav` — horizontal nav links in top bar (flexbox, gap)
- `.nav-link` — link styling with active state indicator
- `.page-container` — full-viewport container for non-dashboard pages
- `.review-browser-header` — header with title + search
- `.review-browser-content` — grid layout for file cards
- `.review-file-card` — card component: file name, path, comment count badge, hover effect
- `.review-editor-toolbar` — top bar with back link, file name, actions
- `.review-editor-layout` — side-by-side content + comments panel
- `.review-content` — markdown content area with comment highlights
- `.review-comments-panel` — scrollable panel for comment list
- `.back-link` — styled back navigation link

Follow the existing design system: use CSS custom properties for theme-aware colors (`var(--bg-primary)`, `var(--text-primary)`, `var(--accent)`, etc.).

### 13. Edit: `packages/coc/src/server/review-handler.ts`

Add a new route for saving file content edits from the editor:

```typescript
// POST /api/review/files/:path/content — Update file content
routes.push({
    method: 'POST',
    pattern: /^\/api\/review\/files\/(.+)\/content$/,
    handler: async (req, res, match) => {
        const filePath = decodeURIComponent(match![1]);
        const absPath = safePath(projectDir, filePath);
        if (!absPath) return sendError(res, 400, 'Invalid path');

        const body = await parseBody(req);
        if (typeof body.content !== 'string') {
            return sendError(res, 400, 'Missing content field');
        }

        fs.writeFileSync(absPath, body.content, 'utf-8');
        sendJSON(res, 200, { ok: true });
    },
});
```

Wire comment change events to WebSocket: after each comment mutation (add/update/delete), broadcast via `wsServer.broadcastReviewEvent(...)`. This requires passing `wsServer` to `registerReviewRoutes`:

```typescript
export function registerReviewRoutes(
    routes: Route[],
    projectDir: string,
    wsServer?: ProcessWebSocketServer,
): void { ... }
```

## Files touched

| File | Action | Est. lines |
|------|--------|------------|
| `packages/coc/src/server/spa/client/review-config.ts` | **Create** | ~25 |
| `packages/coc/src/server/spa/client/http-transport.ts` | **Create** | ~150 |
| `packages/coc/src/server/spa/client/review-browser.ts` | **Create** | ~80 |
| `packages/coc/src/server/spa/client/review-editor.ts` | **Create** | ~60 |
| `packages/coc/src/server/review-watcher.ts` | **Create** | ~60 |
| `packages/coc/src/server/spa/client/core.ts` | **Edit** — page routing | ~40 |
| `packages/coc/src/server/spa/client/index.ts` | **Edit** — import review modules | ~5 |
| `packages/coc/src/server/spa/client/styles.css` | **Edit** — review page styles | ~120 |
| `packages/coc/src/server/spa/html-template.ts` | **Edit** — nav links, page containers, `__REVIEW_CONFIG__` | ~60 |
| `packages/coc/src/server/spa/types.ts` | **Edit** — `DashboardOptions` fields | ~5 |
| `packages/coc/src/server/router.ts` | **Edit** — review route detection, `generateReviewHtml` | ~15 |
| `packages/coc/src/server/index.ts` | **Edit** — wire review HTML gen, watcher, pass wsServer | ~20 |
| `packages/coc/src/server/websocket.ts` | **Edit** — review message types, `broadcastReviewEvent`, file subscriptions | ~40 |
| `packages/coc/src/server/review-handler.ts` | **Edit** — content save route, WebSocket broadcast on mutations | ~40 |
| `packages/coc/src/server/types.ts` | **Edit** — `RouterOptions.generateReviewHtml` | ~3 |

**Estimated total: ~720 lines changed/added**

## Implementation notes

### Config injection strategy

The dashboard uses `window.__DASHBOARD_CONFIG__`. The review editor adds `window.__REVIEW_CONFIG__` on top of it. Both configs are injected by the same HTML template — `__DASHBOARD_CONFIG__` is always present (for nav, theme, etc.), `__REVIEW_CONFIG__` is present only when a specific file path is in the URL. Client code checks `isReviewMode()` to pick the right initialization path.

### HttpTransport message mapping

Not all 34 `WebviewToBackendMessage` types need REST mapping in the first pass. The critical subset for MVP:

| Message type | REST call | Priority |
|---|---|---|
| `ready` | `GET /api/review/files/:path` | P0 |
| `addComment` | `POST /api/review/files/:path/comments` | P0 |
| `editComment` | `PATCH /api/review/files/:path/comments/:id` | P0 |
| `deleteComment` | `DELETE /api/review/files/:path/comments/:id` | P0 |
| `resolveComment` | `PATCH /api/review/files/:path/comments/:id` | P0 |
| `reopenComment` | `PATCH /api/review/files/:path/comments/:id` | P0 |
| `resolveAll` | `POST /api/review/files/:path/comments/resolve-all` | P0 |
| `deleteAll` | `DELETE /api/review/files/:path/comments` | P0 |
| `updateContent` | `POST /api/review/files/:path/content` | P1 |
| `collapsedSectionsChanged` | `POST /api/review/state` (optional) | P2 |

Messages related to AI features (`askAI`, `sendToChat`, `copyPrompt`, `executeWorkPlan`, etc.) are deferred — they can log a "not available in serve mode" warning in the console. The `HttpTransport.postMessage` should handle unknown types gracefully.

### File watcher debouncing

`fs.watch` can fire multiple events for a single save. The `ReviewFileWatcher` should debounce notifications with a 300ms window per file path (simple `setTimeout` + clear pattern).

### SPA HTML caching

The dashboard HTML (`spaHtml`) is generated once and cached. Review editor HTML varies per file path (different `__REVIEW_CONFIG__`), so it's generated on demand via `generateReviewHtml(filePath)`. For performance, consider an LRU cache (Map with max 50 entries) — but this is optional for MVP since HTML generation is fast (string concatenation).

### WebSocket subscription lifecycle

1. Client connects → receives `welcome`
2. Client navigates to `/review/README.md` → sends `{ type: 'subscribe-review', filePath: 'README.md' }`
3. Server starts watching `README.md` via `ReviewFileWatcher`
4. On file change → server broadcasts `review-file-changed` to subscribed clients
5. Client receives → re-fetches `GET /api/review/files/README.md` → re-renders
6. Client navigates away or disconnects → server decrements ref count → unwatches if zero

### esbuild bundling

The new client modules (`review-config.ts`, `http-transport.ts`, `review-browser.ts`, `review-editor.ts`) are TypeScript files in `packages/coc/src/server/spa/client/`. They are imported by `index.ts` and bundled by the existing esbuild step (`npm run build:client`) into `client/dist/bundle.js`. No changes to the build config are needed — esbuild follows the import graph automatically.

### No changes to extension webview-scripts

This commit does **not** modify `src/shortcuts/markdown-comments/webview-scripts/`. The review editor DOM rendering in serve mode is implemented fresh in the CoC client modules, reusing the same visual design but implemented as standalone DOM manipulation (no webpack dependency). The shared contract is the transport interface and message types from commits 001 and 003.

A future commit may extract shared rendering logic into a package, but that's out of scope here.

## Testing

### Unit tests: `packages/coc/test/review-integration.test.ts`

Using Vitest, matching CoC test conventions:

1. **File browser fetch and render** — Mock `/api/review/files` response, call `initFileBrowser()`, verify file cards are rendered with correct names and comment counts
2. **File browser search filter** — Render files, type in search input, verify filtering works
3. **File browser navigation** — Click a file card, verify `location.pathname` changes to `/review/<path>`
4. **Review editor init with config** — Set `window.__REVIEW_CONFIG__`, call `initReviewEditor()`, verify `HttpTransport` is created and `ready` message is sent
5. **Review editor init without config** — Unset `__REVIEW_CONFIG__`, call `initReviewEditor()`, verify it returns early (no crash)

### Unit tests: `packages/coc/test/http-transport.test.ts`

6. **postMessage addComment maps to POST** — Create `HttpTransport`, call `postMessage({ type: 'addComment', ... })`, verify `fetch` was called with `POST /api/review/files/:path/comments`
7. **postMessage resolveComment maps to PATCH** — Verify correct URL and body `{ status: 'resolved' }`
8. **postMessage deleteComment maps to DELETE** — Verify `DELETE` method and correct URL
9. **postMessage ready fetches initial state** — Verify `GET /api/review/files/:path` is called, and `onMessage` handler receives synthesized `update` message
10. **postMessage unknown type logs warning** — Verify console.warn, no fetch call
11. **WebSocket connect and subscribe** — Create transport, call `connect()`, verify WebSocket sends `subscribe-review` message
12. **WebSocket review-comment-added dispatches to handlers** — Simulate incoming WS message, verify handler called with correct shape
13. **WebSocket review-file-changed triggers re-fetch** — Simulate `review-file-changed` WS message, verify `GET /api/review/files/:path` is called and handler receives new `update`

### Unit tests: `packages/coc/test/review-watcher.test.ts`

14. **watchFile starts fs.watch** — Create watcher, call `watchFile('test.md')`, verify `fs.watch` called with correct path
15. **file change broadcasts WebSocket event** — Trigger a file change event, verify `wsServer.broadcastReviewEvent` called with `review-file-changed`
16. **debounce prevents duplicate events** — Trigger 3 rapid change events, verify only 1 broadcast within 300ms window
17. **unwatchFile closes watcher** — Watch then unwatch, verify `FSWatcher.close()` called
18. **closeAll cleans up all watchers** — Watch 3 files, call `closeAll()`, verify all closed

### Integration test: `packages/coc/test/review-navigation.test.ts`

19. **Dashboard nav shows Review link** — Start server, fetch `/`, verify HTML contains `<a href="/review"` nav link
20. **GET /review returns SPA HTML** — Fetch `/review`, verify 200 with HTML containing `review-browser-content`
21. **GET /review/README.md returns SPA with __REVIEW_CONFIG__** — Fetch `/review/README.md`, verify HTML contains `window.__REVIEW_CONFIG__` with correct `filePath`
22. **GET /review/path/to/deep/file.md handles nested paths** — Verify deep paths work with URL encoding
23. **POST /api/review/files/:path/content saves file** — Write content via API, read file from disk, verify match
24. **WebSocket subscribe-review + file change notification** — Connect WS, subscribe to file, modify file on disk, verify `review-file-changed` message received

## Acceptance criteria

- [ ] Dashboard top bar shows "Dashboard" and "Review" navigation links
- [ ] Clicking "Review" navigates to `/review` and shows file browser
- [ ] File browser lists all `.md` files from `projectDir` with comment counts
- [ ] Clicking a file navigates to `/review/<path>` and loads the review editor
- [ ] Review editor displays file content with existing comments highlighted
- [ ] Adding a comment via the editor UI persists via REST API
- [ ] Editing, resolving, reopening, and deleting comments work end-to-end
- [ ] "Resolve All" and "Delete All" bulk operations work
- [ ] WebSocket delivers real-time comment updates to other connected clients
- [ ] Modifying a `.md` file on disk triggers a `review-file-changed` WebSocket event
- [ ] Browser back/forward navigation works between dashboard, file browser, and editor
- [ ] `window.__REVIEW_CONFIG__` is only injected for `/review/:path` routes
- [ ] `window.__DASHBOARD_CONFIG__` is always present for theme and API config
- [ ] AI-related message types degrade gracefully (console warning, no crash)
- [ ] All new client modules are bundled by existing `npm run build:client`
- [ ] `npm run build` succeeds in `packages/coc/`
- [ ] All new tests pass (`npm run test:run` in `packages/coc/`)
- [ ] All existing CoC tests still pass
