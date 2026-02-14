---
status: pending
---

# 006: Add SPA dashboard frontend

## Summary
Create an inline SPA (no build step, no npm deps) that serves as the browser dashboard for the AI execution server. The SPA is generated as a single HTML string by `generateDashboardHtml()` and served at `/` by the existing router. Follows the same architecture as deep-wiki's SPA: TypeScript functions that return CSS/JS strings, assembled into a complete HTML document.

## Motivation
The `pipeline serve` command needs a browser-based UI for monitoring AI processes across workspaces. The VS Code tree view already provides status icons, grouping, and filtering — this commit replicates that experience in the browser with additional capabilities: real-time WebSocket updates, workspace switching, deep links, and a markdown-rendered detail panel. Keeping everything inline (no CDN, no build step) ensures the dashboard works offline and deploys as a single binary.

## Changes

### Files to Create

#### `packages/pipeline-cli/src/server/spa/index.ts`
Barrel export. Mirrors `packages/deep-wiki/src/server/spa/index.ts`.

```typescript
export { generateDashboardHtml } from './html-template';
export type { DashboardOptions } from './types';
```

#### `packages/pipeline-cli/src/server/spa/types.ts`
Shared type definitions for the SPA generator.

```typescript
export interface DashboardOptions {
    /** Page title (default: "AI Execution Dashboard") */
    title?: string;
    /** Default theme: 'light' | 'dark' | 'auto' */
    theme?: 'light' | 'dark' | 'auto';
    /** WebSocket endpoint path (default: "/ws") */
    wsPath?: string;
    /** API base path (default: "/api") */
    apiBasePath?: string;
}

export interface ScriptOptions {
    defaultTheme: 'light' | 'dark' | 'auto';
    wsPath: string;
    apiBasePath: string;
}
```

#### `packages/pipeline-cli/src/server/spa/helpers.ts`
Utility functions for HTML generation. Same `escapeHtml` as deep-wiki.

```typescript
export function escapeHtml(str: string): string {
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}
```

#### `packages/pipeline-cli/src/server/spa/html-template.ts`
Main HTML generator. Returns a complete `<!DOCTYPE html>` string. Structure:

```typescript
import type { DashboardOptions } from './types';
import { escapeHtml } from './helpers';
import { getDashboardStyles } from './styles';
import { getDashboardScript } from './scripts';

export function generateDashboardHtml(options: DashboardOptions = {}): string {
    const {
        title = 'AI Execution Dashboard',
        theme = 'auto',
        wsPath = '/ws',
        apiBasePath = '/api',
    } = options;
    // Returns full HTML with inlined <style> and <script>
}
```

**HTML body layout** (no external CDN dependencies):

```html
<header class="top-bar">
    <div class="top-bar-left">
        <span class="top-bar-logo">AI Execution Dashboard</span>
    </div>
    <div class="top-bar-right">
        <select id="workspace-select" class="workspace-select">
            <option value="__all">All Workspaces</option>
        </select>
        <button id="theme-toggle" class="top-bar-btn" aria-label="Toggle theme">🌙</button>
    </div>
</header>

<div class="app-layout">
    <aside class="sidebar" id="sidebar">
        <div class="filter-bar">
            <input type="text" id="search-input" placeholder="Search processes..." />
            <select id="status-filter">
                <option value="__all">All Statuses</option>
                <option value="running">🔄 Running</option>
                <option value="queued">⏳ Queued</option>
                <option value="completed">✅ Completed</option>
                <option value="failed">❌ Failed</option>
                <option value="cancelled">🚫 Cancelled</option>
            </select>
            <select id="type-filter">
                <option value="__all">All Types</option>
                <option value="code-review">Code Review</option>
                <option value="code-review-group">CR Group</option>
                <option value="pipeline-execution">Pipeline</option>
                <option value="pipeline-item">Pipeline Item</option>
                <option value="clarification">Clarification</option>
                <option value="discovery">Discovery</option>
            </select>
        </div>
        <nav id="process-list" class="process-list">
            <div class="empty-state" id="empty-state">
                <div class="empty-state-icon">📋</div>
                <div class="empty-state-title">No processes yet</div>
                <div class="empty-state-text">
                    AI processes will appear here when started via the CLI or VS Code extension.
                </div>
            </div>
        </nav>
        <div class="sidebar-footer">
            <button id="clear-completed" class="sidebar-btn">Clear ✅</button>
        </div>
    </aside>

    <main class="detail-panel" id="detail-panel">
        <div class="detail-empty" id="detail-empty">
            <div class="detail-empty-icon">👈</div>
            <div class="detail-empty-text">Select a process to view details</div>
        </div>
        <div class="detail-content hidden" id="detail-content">
            <!-- Populated by detail.js -->
        </div>
    </main>
</div>
```

#### `packages/pipeline-cli/src/server/spa/styles.ts`
Exports `getDashboardStyles(): string`. VS Code-inspired color scheme using CSS custom properties.

**CSS custom properties** (light defaults, dark overrides via `html[data-theme="dark"]`):

| Category | Light | Dark |
|----------|-------|------|
| `--bg-primary` | `#ffffff` | `#1e1e1e` |
| `--bg-secondary` | `#f3f3f3` | `#252526` |
| `--bg-sidebar` | `#f8f8f8` | `#1e1e1e` |
| `--text-primary` | `#1e1e1e` | `#cccccc` |
| `--text-secondary` | `#6e6e6e` | `#858585` |
| `--border-color` | `#e0e0e0` | `#3c3c3c` |
| `--accent` | `#0078d4` | `#0078d4` |
| `--status-running` | `#0078d4` | `#3794ff` |
| `--status-completed` | `#16825d` | `#89d185` |
| `--status-failed` | `#f14c4c` | `#f48771` |
| `--status-cancelled` | `#e8912d` | `#cca700` |
| `--status-queued` | `#848484` | `#848484` |

**Key style blocks:**

- **Top bar**: Fixed header, 48px height, dark background (`#18181b`), flex layout with workspace dropdown and theme toggle.
- **App layout**: `display: grid; grid-template-columns: 320px 1fr;` below the header. Full height minus header.
- **Sidebar**: Fixed-width 320px, scrollable process list, filter bar at top, clear button footer.
- **Process list items**: 
  - Status indicator dot (left border, 3px, color-coded).
  - Process title (truncated), type badge, relative time.
  - Active item highlighted with accent background.
  - Grouped items: parent item expandable (chevron toggle), children indented 24px with thinner left border.
- **Detail panel**: Scrollable, max-width 800px centered. Process title as h1, metadata grid (status, type, workspace, backend, duration), result area with markdown rendering, collapsible prompt section.
- **Status badges**: Pill-shaped, color-coded background with matching text.
- **Collapsible sections**: `<details>` / `<summary>` styling with smooth rotate on chevron.
- **Code blocks**: Monospace, `var(--bg-secondary)` background, rounded corners, horizontal scroll.
- **Responsive**: `@media (max-width: 768px)` — sidebar becomes full-width overlay with hamburger toggle, detail panel takes full width.
- **Transitions**: `transition: background-color 0.15s, border-color 0.15s` on interactive elements. Status changes use subtle fade.
- **Scrollbar**: Custom thin scrollbar matching VS Code style (`::-webkit-scrollbar`).

#### `packages/pipeline-cli/src/server/spa/scripts.ts`
Script assembler. Imports all script modules and concatenates in order.

```typescript
import type { ScriptOptions } from './types';
import { getCoreScript } from './scripts/core';
import { getThemeScript } from './scripts/theme';
import { getSidebarScript } from './scripts/sidebar';
import { getDetailScript } from './scripts/detail';
import { getFiltersScript } from './scripts/filters';
import { getWebSocketScript } from './scripts/websocket';
import { getUtilsScript } from './scripts/utils';

export function getDashboardScript(opts: ScriptOptions): string {
    return getUtilsScript() +
        getCoreScript(opts) +
        getThemeScript() +
        getSidebarScript() +
        getDetailScript() +
        getFiltersScript() +
        getWebSocketScript(opts) + '\n';
}
```

#### `packages/pipeline-cli/src/server/spa/scripts/utils.ts`
Exports `getUtilsScript(): string`. Pure utility functions with no DOM dependencies.

**Functions:**
- `formatDuration(ms)` — Returns human-readable duration: `"2m 34s"`, `"< 1s"`, `"1h 5m"`.
- `formatRelativeTime(dateStr)` — Returns `"just now"`, `"2m ago"`, `"1h ago"`, `"yesterday"`, date string.
- `statusIcon(status)` — Maps status to emoji: `running→🔄`, `completed→✅`, `failed→❌`, `cancelled→🚫`, `queued→⏳`.
- `statusLabel(status)` — Maps status to display label.
- `typeLabel(type)` — Maps process type to display label: `code-review→"Code Review"`, `pipeline-execution→"Pipeline"`, etc.
- `copyToClipboard(text)` — Uses `navigator.clipboard.writeText()` with fallback to `document.execCommand('copy')`.
- `escapeHtml(str)` — Client-side HTML escaping.

#### `packages/pipeline-cli/src/server/spa/scripts/core.ts`
Exports `getCoreScript(opts: ScriptOptions): string`. Application initialization and state management.

**Global state:**
```javascript
var appState = {
    processes: [],           // All processes from API
    selectedId: null,        // Currently selected process ID
    workspace: '__all',      // Current workspace filter
    statusFilter: '__all',   // Current status filter
    typeFilter: '__all',     // Current type filter
    searchQuery: '',         // Current search text
    expandedGroups: {},      // Track expanded parent items { id: true/false }
    liveTimers: {},          // Interval IDs for running process timers
};
```

**Functions:**
- `init()` — Fetches initial data from `GET {apiBasePath}/workspaces` and `GET {apiBasePath}/processes`, populates workspace dropdown, calls `renderProcessList()`, handles deep link from `location.pathname` (pattern: `/process/{id}`).
- `getFilteredProcesses()` — Applies workspace, status, type, and search filters to `appState.processes`. Returns only top-level processes (no `parentProcessId`). Sorts: running first, then queued, then newest `startTime`.
- `fetchApi(path)` — Wrapper around `fetch()` targeting `{apiBasePath}{path}`. Returns parsed JSON. Handles errors gracefully.

**History/routing:**
- `window.addEventListener('popstate', ...)` — Reads state, selects process or clears selection.
- `navigateToProcess(id)` — Calls `history.pushState({ processId: id }, '', '/process/' + id)`, then `selectProcess(id)`.
- `navigateToHome()` — Pushes `'/'`, clears selection.

#### `packages/pipeline-cli/src/server/spa/scripts/theme.ts`
Exports `getThemeScript(): string`. Dark/light theme toggle with system preference detection.

**Functions:**
- `initTheme()` — Reads `localStorage.getItem('ai-dash-theme')`. Falls back to system preference via `matchMedia('(prefers-color-scheme: dark)')`. Applies `data-theme` attribute on `<html>`.
- `toggleTheme()` — Cycles: `auto → dark → light → auto`. Persists to localStorage. Updates toggle button icon (`🌙` / `☀️` / `🌗`).
- `applyTheme(isDark)` — Sets `data-theme` on `<html>`, updates button text.

**Event listeners:**
- `#theme-toggle` click → `toggleTheme()`.
- `matchMedia` change → re-evaluate if current theme is `auto`.

#### `packages/pipeline-cli/src/server/spa/scripts/sidebar.ts`
Exports `getSidebarScript(): string`. Process list rendering with status grouping and expandable groups.

**Functions:**
- `renderProcessList()` — Main render function. Gets filtered processes via `getFilteredProcesses()`. Groups top-level processes by status (order: running, queued, completed, failed, cancelled). For each group, renders a collapsible section header (`statusIcon + statusLabel + count`). Within each group, renders process items. Shows/hides empty state. Manages live timers for running processes.
- `renderProcessItem(process, container)` — Creates a `.process-item` div: status dot (left border color), title (truncated to 40 chars), type badge, relative time. Click handler calls `navigateToProcess(id)`. Active state via `data-id` matching `appState.selectedId`. If process has children (is a group type: `code-review-group` or `pipeline-execution`), renders expand/collapse chevron and child items indented.
- `renderChildProcesses(parentId, container)` — Filters `appState.processes` for `parentProcessId === parentId`. Renders each as indented `.process-item.child-item`.
- `toggleGroup(id)` — Toggles `appState.expandedGroups[id]`, re-renders just that group's children.
- `startLiveTimers()` — For each running process, starts a `setInterval(1000)` that updates the elapsed time display. Clears old timers first.
- `stopLiveTimers()` — Clears all intervals in `appState.liveTimers`.
- `selectProcess(id)` — Sets `appState.selectedId`, updates active class in sidebar, calls `renderDetail(id)`.

**Event listener:**
- `#clear-completed` click → Calls `DELETE {apiBasePath}/processes/completed`, removes completed from `appState.processes`, re-renders.

#### `packages/pipeline-cli/src/server/spa/scripts/detail.ts`
Exports `getDetailScript(): string`. Process detail panel rendering with markdown output.

**Functions:**
- `renderDetail(id)` — Finds process in `appState.processes`. Hides `#detail-empty`, shows `#detail-content`. Populates:
  - **Header**: Process title (h1), status badge with duration.
  - **Metadata grid**: Type, workspace, backend, start/end times.
  - **Result section**: If `result` or `structuredResult` exists, renders via `renderMarkdown()`. Structured results rendered as formatted JSON in a code block.
  - **Prompt section**: Collapsible `<details>` element with `fullPrompt` content. Rendered as preformatted code block.
  - **Error section**: If `error` exists, shown in a red-tinted alert box.
  - **Action buttons**: `📋 Copy Result` (copies result text), `🔗 Copy Link` (copies `/process/{id}` URL).
  - If process is a group, renders child process summary table below metadata.
- `renderMarkdown(text)` — Lightweight markdown-to-HTML converter (no external deps). Supports:
  - `# headers` (h1-h4)
  - `**bold**`, `*italic*`, `` `inline code` ``
  - Fenced code blocks (``` ```lang ... ``` ```) with language class for styling
  - `- ` and `* ` unordered lists
  - `1. ` ordered lists
  - `> ` blockquotes
  - `---` horizontal rules
  - `[text](url)` links
  - Blank lines as paragraph breaks
- `clearDetail()` — Shows `#detail-empty`, hides `#detail-content`.

#### `packages/pipeline-cli/src/server/spa/scripts/filters.ts`
Exports `getFiltersScript(): string`. Filter dropdown and search handlers.

**Event listeners:**
- `#search-input` → `input` event (debounced 200ms). Updates `appState.searchQuery`, calls `renderProcessList()`.
- `#status-filter` → `change` event. Updates `appState.statusFilter`, calls `renderProcessList()`.
- `#type-filter` → `change` event. Updates `appState.typeFilter`, calls `renderProcessList()`.
- `#workspace-select` → `change` event. Updates `appState.workspace`, re-fetches processes for that workspace from `GET {apiBasePath}/processes?workspace={id}` (or all), calls `renderProcessList()` and `clearDetail()`.

**Functions:**
- `populateWorkspaces(workspaces)` — Fills `#workspace-select` with workspace objects `{ id, name, path }`. First option is always "All Workspaces".
- `debounce(fn, ms)` — Standard debounce utility.

#### `packages/pipeline-cli/src/server/spa/scripts/websocket.ts`
Exports `getWebSocketScript(opts: ScriptOptions): string`. WebSocket client with reconnect logic.

**Functions:**
- `connectWebSocket()` — Opens `ws(s)://{host}{wsPath}`. Mirrors deep-wiki's reconnect pattern: exponential backoff from 1s to 30s.
- `handleWsMessage(msg)` — Dispatches on `msg.type` (matches format defined in commit 005):
  - `process-added` — Pushes `msg.process` into `appState.processes`, re-renders sidebar. If it's a child, also updates parent's child list.
  - `process-updated` — Finds existing process by `msg.process.id`, merges updated fields. Re-renders sidebar item and detail panel (if currently selected). Updates live timer if status changed to/from running.
  - `process-removed` — Removes process by `msg.processId` from `appState.processes`. If currently selected, clears detail. Re-renders sidebar.
  - `processes-cleared` — Removes `msg.count` processes from sidebar. Re-renders.
  - `workspace-registered` — Adds workspace to dropdown (server broadcasts on POST /api/workspaces).
- `sendWsPing()` — Sends `{ type: 'ping' }` every 30s to keep connection alive.

**Event listeners:**
- `ws.onopen` — Resets reconnect delay, starts ping interval.
- `ws.onmessage` — Parses JSON, calls `handleWsMessage()`.
- `ws.onclose` — Schedules reconnect with backoff.

**Auto-start:** `connectWebSocket()` called at end of script.

### Files to Modify

#### `packages/pipeline-cli/src/server/router.ts`
Add SPA route. Import `generateDashboardHtml` from `./spa` and serve at `GET /`:

```typescript
import { generateDashboardHtml } from './spa';

// In route registration:
// GET / → returns generateDashboardHtml() with Content-Type: text/html
// GET /process/:id → returns same SPA HTML (client-side routing handles deep links)
```

The SPA HTML is generated once at server start and cached (it's static). Both `/` and `/process/*` return the same HTML — the JS reads `location.pathname` to determine initial view.

## Implementation Notes

### Patterns from deep-wiki SPA to follow
- Each script module is a function returning a template literal string of JavaScript.
- Script functions use `var` (not `let`/`const`) for broadest compatibility in inline scripts.
- Global functions and variables live in the top-level scope (no modules, no IIFE wrapping per module — they share scope).
- Script assembler concatenates modules in dependency order (utils first, core before sidebar/detail).
- CSS uses `:root` for light-mode variables, `html[data-theme="dark"]` for dark overrides.
- HTML template uses `${expression}` interpolation for dynamic content (title, theme class).
- No external CDN dependencies — everything is inline. The lightweight markdown renderer replaces marked.js.

### API contract assumed (from prior commits)
The SPA expects these REST endpoints:
- `GET /api/workspaces` → `[{ id, name, path }]`
- `GET /api/processes` → `[{ id, type, status, promptPreview, fullPrompt, result, structuredResult, startTime, endTime, error, parentProcessId, metadata }]`
- `GET /api/processes?workspace={id}` → filtered list
- `GET /api/processes/:id` → single process
- `DELETE /api/processes/completed` → clears completed processes

WebSocket messages:
- `{ type: 'process:created', data: AIProcess }`
- `{ type: 'process:updated', data: AIProcess }`
- `{ type: 'process:deleted', data: { id: string } }`
- `{ type: 'workspace:registered', data: { id, name, path } }`
- `{ type: 'workspace:unregistered', data: { id: string } }`

### Markdown renderer scope
The inline markdown renderer is intentionally minimal — no tables, no footnotes, no image embedding. It covers the output format of AI responses (headers, lists, code blocks, bold/italic, links, blockquotes). This avoids the 30KB+ weight of marked.js while handling 95% of actual AI output.

### Deep link routing
Both `/` and `/process/:id` serve the same HTML. The JS `init()` function checks `location.pathname`:
- If it matches `/process/{id}`, auto-selects that process after loading.
- Otherwise, shows the default empty detail panel.
`history.pushState` / `popstate` handle in-app navigation without page reloads.

## Tests
- No automated tests in this commit — the SPA is a pure HTML/CSS/JS string generator with no logic requiring unit tests beyond what the integration tests in a later commit will cover.
- **Manual verification**: Start the server (`pipeline serve`), open browser, confirm:
  - Dashboard renders with correct layout.
  - Theme toggle works (dark/light/auto).
  - Workspace dropdown populates.
  - Process list shows grouped by status.
  - Clicking a process shows detail panel.
  - WebSocket reconnects on disconnect.
  - `/process/{id}` deep link loads correctly.
  - Mobile viewport collapses sidebar.

## Acceptance Criteria
- [ ] `packages/pipeline-cli/src/server/spa/index.ts` exports `generateDashboardHtml` and `DashboardOptions`
- [ ] `generateDashboardHtml()` returns valid HTML5 string with no external dependencies
- [ ] CSS uses custom properties with light/dark themes matching VS Code color scheme
- [ ] JS modules follow deep-wiki pattern: each in `scripts/` dir, assembler in `scripts.ts`
- [ ] Sidebar renders processes grouped by status (running → queued → completed → failed → cancelled)
- [ ] Status icons match VS Code tree: 🔄 running, ✅ completed, ❌ failed, 🚫 cancelled, ⏳ queued
- [ ] Detail panel renders process metadata, markdown result, and collapsible prompt
- [ ] Inline markdown renderer handles: headers, bold, italic, code blocks, lists, blockquotes, links
- [ ] WebSocket client connects with exponential backoff reconnect (1s → 30s)
- [ ] WebSocket handles `process:created`, `process:updated`, `process:deleted` events
- [ ] Workspace dropdown filters processes, includes "All Workspaces" option
- [ ] Search input filters by process title (debounced 200ms)
- [ ] Status and type dropdown filters work independently and combine
- [ ] Running processes show live elapsed timer updating every second
- [ ] Deep link `/process/{id}` auto-selects process on page load
- [ ] `router.ts` serves SPA HTML at `GET /` and `GET /process/*`
- [ ] Responsive layout: sidebar collapses to overlay on viewports < 768px
- [ ] "Clear ✅" button removes completed processes via API
- [ ] Group processes (code-review-group, pipeline-execution) are expandable with child items
- [ ] Empty state shown when no processes match current filters

## Dependencies
- Depends on: 005 (REST API routes and WebSocket server in router.ts must exist for the SPA to connect to)
