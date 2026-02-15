---
status: pending
priority: high
commit: 3 of N
feature: SPA esbuild refactor — Extract pipeline-cli client JavaScript
package: pipeline-cli
depends-on: [001, 002]
---

# Commit 3: Extract pipeline-cli Client JavaScript to Real TypeScript Source Files

Move all 8 client JS modules from string-returning TypeScript functions in `scripts/` into real `.ts` source files in `client/`, plus a config injection module and entry point. This is the largest change — enabling IDE support, type checking, and linting for ~1,500 lines of client code.

---

## Architecture Decisions

### Config Injection Pattern

The old code injects server config via template-literal interpolation (`var API_BASE = '${opts.apiBasePath}'`). The new approach:

1. The HTML template sets `window.__DASHBOARD_CONFIG__` before the bundled script loads
2. `client/config.ts` reads from this global and exports `getApiBase()` / `getWsPath()`
3. All modules that need config import from `config.ts`

### Shared State Module

The original code uses global `var` declarations shared across all modules. Two mutable state objects — `appState` (core) and `queueState` (queue) — are referenced across multiple modules, creating circular dependency chains:

- `core` ↔ `sidebar` ↔ `detail` ↔ `queue`

To break these cycles cleanly, extract shared mutable state into `client/state.ts`:

- `appState` — processes, selected ID, filters, expanded groups, live timers
- `queueState` — queued/running/history arrays, stats, UI toggles

All modules import state from `state.ts` instead of from each other.

### Circular Import Strategy

Even with `state.ts` extracted, some circular imports remain (e.g., `core` calls `renderProcessList` from `sidebar`, `sidebar` calls `navigateToProcess` from `core`). This is safe because:

- All cross-module references occur inside **function bodies**, never at module top-level evaluation time
- esbuild resolves circular imports correctly when references are late-bound (function calls, not top-level variable reads)
- The `index.ts` entry point imports modules in dependency order to ensure correct top-level side effects

### Window Globals for Inline `onclick` Handlers

Functions referenced from HTML string `onclick` attributes **must** be assigned to `window` since esbuild wraps the bundle in an IIFE/module scope. Each module that exports onclick-accessible functions should include `(window as any).fn = fn` assignments at the bottom.

---

## Files to Create

### 1. `packages/pipeline-cli/src/server/spa/client/config.ts`

New module (~20 lines). Reads server config from global injected by HTML template.

```typescript
interface DashboardConfig {
    apiBasePath: string;
    wsPath: string;
}

function getConfig(): DashboardConfig {
    const config = (window as any).__DASHBOARD_CONFIG__;
    if (!config) {
        return { apiBasePath: '/api', wsPath: '/ws' };
    }
    return config;
}

export function getApiBase(): string {
    return getConfig().apiBasePath;
}

export function getWsPath(): string {
    return getConfig().wsPath;
}
```

### 2. `packages/pipeline-cli/src/server/spa/client/state.ts`

New module (~30 lines). Shared mutable state extracted from `core.ts` and `queue.ts`.

```typescript
export interface AppState {
    processes: any[];
    selectedId: string | null;
    workspace: string;
    statusFilter: string;
    typeFilter: string;
    searchQuery: string;
    expandedGroups: Record<string, boolean>;
    liveTimers: Record<string, ReturnType<typeof setInterval>>;
}

export const appState: AppState = {
    processes: [],
    selectedId: null,
    workspace: '__all',
    statusFilter: '__all',
    typeFilter: '__all',
    searchQuery: '',
    expandedGroups: {},
    liveTimers: {},
};

export interface QueueState {
    queued: any[];
    running: any[];
    history: any[];
    stats: {
        queued: number; running: number; completed: number;
        failed: number; cancelled: number; total: number; isPaused: boolean;
    };
    showDialog: boolean;
    showHistory: boolean;
}

export const queueState: QueueState = {
    queued: [],
    running: [],
    history: [],
    stats: { queued: 0, running: 0, completed: 0, failed: 0, cancelled: 0, total: 0, isPaused: false },
    showDialog: false,
    showHistory: false,
};
```

### 3. `packages/pipeline-cli/src/server/spa/client/utils.ts`

Convert from `scripts/utils.ts` → `getUtilsScript()` (~76 lines of JS).

Key conversions:
- `var` → `const`/`let`
- `function fn()` → `export function fn()`
- `\\u{1F504}` → actual unicode escapes `\u{1F504}` (or literal emoji characters)
- `\\u2705` → `\u2705`, etc.

**Exports:** `formatDuration`, `formatRelativeTime`, `statusIcon`, `statusLabel`, `typeLabel`, `copyToClipboard`, `escapeHtmlClient`

**Window globals needed:** `copyToClipboard` (used in onclick in `detail.ts`)

```typescript
// At bottom of file:
(window as any).copyToClipboard = copyToClipboard;
```

### 4. `packages/pipeline-cli/src/server/spa/client/theme.ts`

Convert from `scripts/theme.ts` → `getThemeScript()` (~38 lines of JS).

Key conversions:
- `var currentTheme` → `let currentTheme`
- `\\u{1F317}` → `\u{1F317}`, `\\u{1F319}` → `\u{1F319}`, `\\u2600\\uFE0F` → `\u2600\uFE0F`
- Top-level side effects (media query listener, theme button click listener) remain as top-level code — they execute when the module is imported

**Exports:** `initTheme`, `toggleTheme`, `applyTheme`

**Imports:** nothing (self-contained)

**Window globals needed:** none (no onclick references)

### 5. `packages/pipeline-cli/src/server/spa/client/core.ts`

Convert from `scripts/core.ts` → `getCoreScript(opts)` (~100 lines of JS).

Key conversions:
- Remove `var API_BASE = '${opts.apiBasePath}'` and `var WS_PATH = '${opts.wsPath}'` — replace all usages with imports from `config.ts`
- Remove `var appState = { ... }` — import from `state.ts`
- `var` → `const`/`let`
- Path regex: `\\/` in template literal → `/` in real code (the `\\` was escaping for the template string)

**Imports:**
```typescript
import { getApiBase } from './config';
import { appState } from './state';
import { initTheme } from './theme';
import { populateWorkspaces } from './filters';
import { renderProcessList, selectProcess, updateActiveItem } from './sidebar';
import { clearDetail } from './detail';
```

**Exports:** `init`, `getFilteredProcesses`, `fetchApi`, `navigateToProcess`, `navigateToHome`

**Window globals needed:** `navigateToProcess` (onclick in `detail.ts` child table rows), `appState` (referenced in onclick in `detail.ts` copy-result button)

```typescript
(window as any).navigateToProcess = navigateToProcess;
(window as any).appState = appState;
```

**Top-level side effects:**
- `init()` call — move to `index.ts` entry point (see below)
- `window.addEventListener('popstate', ...)` — keep as top-level

### 6. `packages/pipeline-cli/src/server/spa/client/sidebar.ts`

Convert from `scripts/sidebar.ts` → `getSidebarScript()` (~207 lines of JS).

Key conversions:
- `var STATUS_ORDER` → `const STATUS_ORDER`
- `var` → `const`/`let` throughout
- All function declarations → `export function`

**Imports:**
```typescript
import { appState } from './state';
import { getApiBase } from './config';
import {
    formatDuration, formatRelativeTime, statusIcon, statusLabel,
    typeLabel, escapeHtmlClient,
} from './utils';
import { getFilteredProcesses, fetchApi, navigateToProcess } from './core';
import { renderDetail } from './detail';
```

**Exports:** `renderProcessList`, `selectProcess`, `updateActiveItem`, `startLiveTimers`, `stopLiveTimers`, `renderProcessItem`, `renderChildProcesses`, `toggleGroup`

**Window globals needed:** none (sidebar uses `addEventListener`, not inline onclick)

**Top-level side effects:**
- `clearBtn` click listener — keep as top-level
- `hamburgerBtn` click listener — keep as top-level

Note: `clearBtn` handler uses `API_BASE` — replace with `getApiBase()`:
```typescript
fetch(getApiBase() + '/processes/completed', { method: 'DELETE' })
```

### 7. `packages/pipeline-cli/src/server/spa/client/detail.ts`

Convert from `scripts/detail.ts` → `getDetailScript()` (~497 lines of JS — the largest module).

Key conversions:
- `\\u00B7` → `\u00B7`
- `\\u{1F4CB}` → `\u{1F4CB}`
- `\\u{1F517}` → `\u{1F517}`
- `\\'` inside onclick string attributes → `\'` (JavaScript string escape for single quote)
- `\\n` inside `text.split('\\n')` → `'\n'`
- Code block regex escapes: `` /^\`\`\`/ `` → `` /^```/ ``
- Inline code regex: `` /\`([^\`]+)\`/g `` → `` /`([^`]+)`/g ``
- Bold/italic/link regex: `\\*\\*` → `\*\*`, `\\*` → `\*`, `\\[` → `\[`, `\\]` → `\]`, `\\(` → `\(` etc.
- `var` → `const`/`let`
- `var activeQueueTaskStream = null` → `let activeQueueTaskStream: EventSource | null = null`
- `var queueTaskStreamContent = ''` → `let queueTaskStreamContent = ''`

**Imports:**
```typescript
import { getApiBase } from './config';
import { appState, queueState } from './state';
import {
    formatDuration, formatRelativeTime, statusIcon, statusLabel,
    typeLabel, escapeHtmlClient, copyToClipboard,
} from './utils';
import { navigateToProcess, fetchApi } from './core';
```

**Exports:** `renderDetail`, `clearDetail`, `showQueueTaskDetail`, `renderMarkdown`, `inlineFormat`, `copyQueueTaskResult`, `closeQueueTaskStream`

**Window globals needed:**
```typescript
(window as any).clearDetail = clearDetail;
(window as any).copyQueueTaskResult = copyQueueTaskResult;
(window as any).showQueueTaskDetail = showQueueTaskDetail;
```

Note: `navigateToProcess` and `copyToClipboard` are also used in onclick strings generated by `detail.ts`, but their `window` assignments live in `core.ts` and `utils.ts` respectively.

### 8. `packages/pipeline-cli/src/server/spa/client/filters.ts`

Convert from `scripts/filters.ts` → `getFiltersScript()` (~73 lines of JS).

Key conversions:
- `var timer` → `let timer: ReturnType<typeof setTimeout>`
- `var` → `const`/`let`

**Imports:**
```typescript
import { appState } from './state';
import { fetchApi } from './core';
import { renderProcessList } from './sidebar';
import { clearDetail } from './detail';
```

**Exports:** `populateWorkspaces`, `debounce`

**Window globals needed:** none

**Top-level side effects:**
- `searchInput` input listener
- `statusFilter` change listener
- `typeFilter` change listener
- `wsSelect` change listener

### 9. `packages/pipeline-cli/src/server/spa/client/queue.ts`

Convert from `scripts/queue.ts` → `getQueueScript(opts)` (~369 lines of JS).

Key conversions:
- Remove `var API_BASE` reference — use `getApiBase()` from config
- Remove `var queueState = { ... }` — import from `state.ts`
- `\\u{1F525}` → `\u{1F525}`, `\\u{1F53D}` → `\u{1F53D}`, `\\u{1F504}` → `\u{1F504}`, `\\u23F3` → `\u23F3`
- `\\u2705` → `\u2705`, `\\u274C` → `\u274C`, `\\u{1F6AB}` → `\u{1F6AB}`
- `\\'` in onclick attributes → `\'`
- `var queuePollInterval = null` → `let queuePollInterval: ReturnType<typeof setInterval> | null = null`
- `var` → `const`/`let`

**Imports:**
```typescript
import { getApiBase } from './config';
import { queueState } from './state';
import { fetchApi } from './core';
import { formatDuration, formatRelativeTime, escapeHtmlClient } from './utils';
import { showQueueTaskDetail } from './detail';
```

**Exports:** `fetchQueue`, `renderQueuePanel`, `renderQueueTask`, `renderQueueHistoryTask`, `toggleQueueHistory`, `queuePause`, `queueResume`, `queueClear`, `queueClearHistory`, `queueCancelTask`, `queueMoveToTop`, `queueMoveUp`, `queueMoveDown`, `showEnqueueDialog`, `hideEnqueueDialog`, `submitEnqueueForm`, `startQueuePolling`, `stopQueuePolling`

**Window globals needed (14 functions — highest of any module):**
```typescript
(window as any).showEnqueueDialog = showEnqueueDialog;
(window as any).hideEnqueueDialog = hideEnqueueDialog;
(window as any).queuePause = queuePause;
(window as any).queueResume = queueResume;
(window as any).queueClear = queueClear;
(window as any).queueClearHistory = queueClearHistory;
(window as any).queueCancelTask = queueCancelTask;
(window as any).queueMoveUp = queueMoveUp;
(window as any).queueMoveToTop = queueMoveToTop;
(window as any).toggleQueueHistory = toggleQueueHistory;
(window as any).showQueueTaskDetail = showQueueTaskDetail;
```

Note: `showQueueTaskDetail` is defined in `detail.ts` but used in onclick attributes generated by `queue.ts`. The `window` assignment for it lives in `detail.ts`. However, `queue.ts` also generates onclick attributes with it, so it must be on `window` before any queue HTML is rendered. Since `detail.ts` is imported before `queue.ts` in the dependency chain, this is fine.

**Top-level side effects:**
- `fetchQueue()` call — keep as top-level (initializes queue on load)
- `enqueueForm` submit listener
- `enqueueCancelBtn` click listener
- `enqueueOverlay` click listener

### 10. `packages/pipeline-cli/src/server/spa/client/websocket.ts`

Convert from `scripts/websocket.ts` → `getWebSocketScript(opts)` (~153 lines of JS).

Key conversions:
- Remove `'${opts.wsPath}'` — use `getWsPath()` from config
- `var wsReconnectTimer` → `let wsReconnectTimer: ReturnType<typeof setTimeout> | null`
- `var wsReconnectDelay` → `let wsReconnectDelay`
- `var wsPingInterval` → `let wsPingInterval: ReturnType<typeof setInterval> | null`
- `var` → `const`/`let`

**Imports:**
```typescript
import { getWsPath, getApiBase } from './config';
import { appState, queueState } from './state';
import { fetchApi } from './core';
import { renderProcessList } from './sidebar';
import { renderDetail, clearDetail } from './detail';
import { renderQueuePanel, startQueuePolling, stopQueuePolling } from './queue';
```

**Exports:** `connectWebSocket`, `handleWsMessage`

**Window globals needed:** none

**Top-level side effects:**
- `connectWebSocket()` call — keep as top-level

### 11. `packages/pipeline-cli/src/server/spa/client/index.ts`

New entry point (~20 lines). Imports all modules in dependency order and calls `init()`.

```typescript
// Import order matters: each module's top-level side effects
// (event listeners, init calls) execute in this order.

// 1. Pure utilities and config (no side effects)
import './config';
import './state';
import './utils';

// 2. Theme (registers media-query listener, theme-button click)
import './theme';

// 3. Core (registers popstate listener)
import { init } from './core';

// 4. Sidebar (registers clear-completed, hamburger listeners)
import './sidebar';

// 5. Detail (no top-level side effects beyond variable declarations)
import './detail';

// 6. Filters (registers search, status, type, workspace listeners)
import './filters';

// 7. Queue (calls fetchQueue(), registers enqueue form listeners)
import './queue';

// 8. WebSocket (calls connectWebSocket())
import './websocket';

// Bootstrap the app
init();
```

**Important:** Remove the `init()` call from the top level of `core.ts` itself — it moves here to ensure all modules are fully loaded before `init()` runs.

---

## Files to Modify

### 12. `packages/pipeline-cli/src/server/spa/html-template.ts`

**12a. Add config injection to the HTML template.** Before the `<script>` tag that currently inlines `getDashboardScript(...)`, add a config-injection script block:

```html
<script>
    window.__DASHBOARD_CONFIG__ = {
        apiBasePath: '${escapeHtml(apiBasePath)}',
        wsPath: '${escapeHtml(wsPath)}'
    };
</script>
```

**12b. Replace the inline `<script>` block.** The current code:

```typescript
<script>
${getDashboardScript({ defaultTheme: theme, wsPath, apiBasePath })}
    </script>
```

Will be replaced by a `<script src="...">` tag pointing to the esbuild-bundled output (exact mechanism depends on commit 002's bundling infrastructure — either a data URI, a served static file, or an inline insertion of the bundled output).

> **Note:** The exact `<script>` replacement strategy is defined in commit 002 (esbuild infrastructure). This commit focuses on creating the source files; the wiring into the HTML template is finalized when the build pipeline is ready.

**12c. Remove the `getDashboardScript` import** from `html-template.ts` once the bundled script replaces it.

### 13. `packages/pipeline-cli/src/server/spa/scripts.ts`

This file becomes obsolete once all modules are in `client/`. It can be:
- Deleted entirely, OR
- Kept as a thin wrapper that reads the esbuild bundle output (depending on commit 002 approach)

### 14. `packages/pipeline-cli/src/server/spa/scripts/*.ts` (all 8 files)

These files become obsolete — the string-returning functions are replaced by real source files in `client/`. They can be:
- Deleted if no other code imports them
- Kept temporarily if the migration is incremental

---

## Complete Cross-Module Dependency Map

```
config.ts    ← (no deps)
state.ts     ← (no deps)
utils.ts     ← (no deps)
theme.ts     ← (no deps)
core.ts      ← config, state, theme, filters, sidebar, detail
sidebar.ts   ← config, state, utils, core, detail
detail.ts    ← config, state, utils, core
filters.ts   ← state, core, sidebar, detail
queue.ts     ← config, state, utils, core, detail
websocket.ts ← config, state, core, sidebar, detail, queue
index.ts     ← all modules
```

Circular import pairs (safe — all cross-references are inside function bodies):
- `core` ↔ `sidebar` (core calls renderProcessList/selectProcess/updateActiveItem; sidebar calls getFilteredProcesses/navigateToProcess/fetchApi)
- `core` ↔ `detail` (core calls clearDetail; detail calls navigateToProcess/fetchApi)
- `core` ↔ `filters` (core calls populateWorkspaces; filters calls fetchApi)
- `sidebar` ↔ `detail` (sidebar calls renderDetail; detail doesn't call sidebar)
- `detail` ↔ `queue` (detail reads queueState; queue calls showQueueTaskDetail)

## Complete `window` Global Assignments

Functions referenced from inline `onclick=""` attributes in dynamically-generated HTML strings:

| Function | Defined in | Used in onclick by |
|---|---|---|
| `navigateToProcess` | `core.ts` | `detail.ts` (child table rows) |
| `appState` | `state.ts` | `detail.ts` (copy-result button) |
| `copyToClipboard` | `utils.ts` | `detail.ts` (copy buttons) |
| `clearDetail` | `detail.ts` | `detail.ts` (back button) |
| `copyQueueTaskResult` | `detail.ts` | `detail.ts` (copy result) |
| `showQueueTaskDetail` | `detail.ts` | `queue.ts` (task click) |
| `showEnqueueDialog` | `queue.ts` | `queue.ts` (add button, empty state) |
| `hideEnqueueDialog` | `queue.ts` | `html-template.ts` (cancel button), `queue.ts` |
| `queuePause` | `queue.ts` | `queue.ts` (pause button) |
| `queueResume` | `queue.ts` | `queue.ts` (resume button) |
| `queueClear` | `queue.ts` | `queue.ts` (clear button) |
| `queueClearHistory` | `queue.ts` | `queue.ts` (history clear) |
| `queueCancelTask` | `queue.ts` | `queue.ts` (cancel task) |
| `queueMoveUp` | `queue.ts` | `queue.ts` (move up) |
| `queueMoveToTop` | `queue.ts` | `queue.ts` (move to top) |
| `toggleQueueHistory` | `queue.ts` | `queue.ts` (history toggle) |

**Total: 16 globals** (1 state object + 15 functions)

Each module assigns its own globals at module scope bottom. The `state.ts` module assigns `appState`:
```typescript
(window as any).appState = appState;
```

---

## Escape Character Conversion Reference

When converting from template-literal strings to real TypeScript, these escape sequences change:

| In template literal | In real `.ts` file | Meaning |
|---|---|---|
| `\\u{1F504}` | `\u{1F504}` or `🔄` | Emoji literal |
| `\\u2705` | `\u2705` or `✅` | Unicode escape |
| `\\u274C` | `\u274C` or `❌` | Unicode escape |
| `\\u{1F6AB}` | `\u{1F6AB}` or `🚫` | Emoji literal |
| `\\u23F3` | `\u23F3` or `⏳` | Unicode escape |
| `\\u{1F317}` | `\u{1F317}` or `🌗` | Emoji literal |
| `\\u{1F319}` | `\u{1F319}` or `🌙` | Emoji literal |
| `\\u2600\\uFE0F` | `\u2600\uFE0F` or `☀️` | Emoji with variation selector |
| `\\u00B7` | `\u00B7` or `·` | Middle dot |
| `\\u{1F4CB}` | `\u{1F4CB}` or `📋` | Emoji literal |
| `\\u{1F517}` | `\u{1F517}` or `🔗` | Emoji literal |
| `\\u{1F525}` | `\u{1F525}` or `🔥` | Emoji literal |
| `\\u{1F53D}` | `\u{1F53D}` or `🔽` | Emoji literal |
| `\\'` | `\'` (in string concat) or just `'` | Single quote in JS string |
| `\\n` (in `split('\\n')`) | `'\n'` | Newline character |
| `\\/` (in regex) | `/` | Forward slash (no escape needed in template) |
| `` /^\`\`\`/ `` | `` /^```/ `` | Backtick (no escape outside template) |
| `\\*\\*` (in regex) | `\\*\\*` | Literal asterisks (regex escape, stays same) |
| `\\[`, `\\]`, `\\(` | `\\[`, `\\]`, `\\(` | Regex escapes (stay same) |

**Preferred approach:** Use actual emoji/unicode characters for readability. Use `\u{...}` escapes only when the character might cause encoding issues.

---

## Conversion Checklist Per Module

For each of the 8 modules, apply these steps:

- [ ] Create `client/<name>.ts`
- [ ] Copy the JavaScript body from inside the template literal string
- [ ] Convert `var` → `const`/`let`
- [ ] Add `export` to all functions that other modules import
- [ ] Add `import` statements for cross-module dependencies
- [ ] Replace `API_BASE` references with `getApiBase()` calls
- [ ] Replace `WS_PATH` references with `getWsPath()` calls
- [ ] Replace `appState`/`queueState` references with imports from `state.ts`
- [ ] Fix escape sequences (see table above)
- [ ] Add `(window as any).fn = fn` for onclick-referenced functions
- [ ] Verify top-level side effects are correct (event listeners, init calls)

---

## Acceptance Criteria

- [ ] All 11 new files created in `client/` (config, state, utils, theme, core, sidebar, detail, filters, queue, websocket, index)
- [ ] Each module has correct `import`/`export` statements
- [ ] No `var` declarations remain — all converted to `const`/`let`
- [ ] No escaped unicode sequences (`\\u{...}`) — all converted to real escapes or literal characters
- [ ] All 16 window globals assigned for onclick handlers
- [ ] `init()` call moved from `core.ts` top-level to `index.ts`
- [ ] `html-template.ts` updated with `window.__DASHBOARD_CONFIG__` injection
- [ ] Old `scripts/` files and `scripts.ts` assembler removed (or marked for removal)
- [ ] `client/index.ts` imports modules in correct dependency order
- [ ] TypeScript compiles without errors (`npx tsc --noEmit` on the client files, or esbuild build succeeds)
- [ ] The dashboard SPA functions identically to before (manual browser test)
- [ ] No regressions in existing pipeline-cli tests (`npm run test:run` in `packages/pipeline-cli/`)
