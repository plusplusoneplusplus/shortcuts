---
status: pending
---

# 006: Dashboard Conversation View

## Summary

Enhance the AI Execution Dashboard SPA to display saved conversation history for completed processes. Add a new REST endpoint to serve persisted conversation output from `rawStdoutFilePath`, render it in the detail panel with markdown formatting, and wire WebSocket process events so the sidebar auto-refreshes in real time.

## Motivation

With process persistence (002) and conversation output persistence (003) in place, every completed AI process has its raw stdout captured to a file referenced by `rawStdoutFilePath` on the `AIProcess` object. However, the dashboard currently only shows the `result` summary field — it never loads or displays the full conversation text. This commit closes that gap by letting users read the complete AI conversation directly in the browser, copy it to clipboard, and see process list changes without manual refresh.

## Changes

### Files to Modify

#### REST API — `packages/coc/src/server/api-handler.ts`

**1. New route: `GET /api/processes/:id/output`**

Register a new route after the existing `GET /api/processes/:id` route:

| Aspect | Detail |
|--------|--------|
| Pattern | `/^\/api\/processes\/([^/]+)\/output$/` |
| Method | `GET` |
| Handler logic | 1. Decode `id` from URL. 2. Look up process via `store.getProcess(id)`. 3. If not found → `sendError(res, 404, 'Process not found')`. 4. Read `process.rawStdoutFilePath`. 5. If falsy or file does not exist → `sendError(res, 404, 'No conversation output saved')`. 6. Read file contents with `fs.promises.readFile(rawStdoutFilePath, 'utf-8')`. 7. Respond `sendJSON(res, 200, { content, format: 'markdown' })`. |
| Import | Add `import * as fs from 'fs';` (already available via Node built-in) |

Place the route **before** the `GET /api/processes/:id` catch-all regex so `/output` is matched first (or use a more specific regex ordering — current `/stream` route already demonstrates this pattern at line 274–282).

#### SPA Detail Panel — `packages/coc/src/server/spa/client/detail.ts`

**2. Fetch and render conversation output for completed processes**

In `renderDetail(id)`, after the existing Result / Structured Result / Prompt sections (~line 101), add a conversation section:

| Aspect | Detail |
|--------|--------|
| Trigger | Only for processes where `process.status` is `'completed'` or `'failed'` (terminal states) |
| Fetch | Call `fetchApi('/processes/' + encodeURIComponent(id) + '/output')` |
| Success (200) | Insert a `<div class="conversation-section">` with `<h2>Conversation</h2>`, a scrollable `<div id="process-conversation" class="conversation-body">` containing the markdown-rendered content via existing `renderMarkdown()`, and a "Copy to clipboard" button |
| 404 / null | Show `<div class="conversation-waiting">No conversation output saved.</div>` |
| Copy button | `<button class="action-btn" onclick="copyConversationOutput('${escapeHtmlClient(id)}')">📋 Copy Conversation</button>` |

**3. New helper: `copyConversationOutput(processId)`**

```typescript
export function copyConversationOutput(processId: string): void {
    fetchApi('/processes/' + encodeURIComponent(processId) + '/output')
        .then(function(data: any) {
            if (data && data.content) {
                copyToClipboard(data.content);
            }
        });
}
```

Register on `window`: `(window as any).copyConversationOutput = copyConversationOutput;`

#### SPA WebSocket — `packages/coc/src/server/spa/client/websocket.ts`

**4. Auto-refresh sidebar on process lifecycle events**

The existing `handleWsMessage()` (line 48–155) already handles `process-added`, `process-updated`, `process-removed`, and `processes-cleared` by calling `renderProcessList()`. Verify that the initial process list load in `core.ts` `init()` doesn't prevent subsequent WebSocket-driven updates — **the current implementation already supports live updates**.

If the sidebar does not update when a new process arrives from another workspace or CLI session, the issue is likely that `fetchApi('/processes')` in `init()` returns a flat array that gets replaced. Ensure `process-added` events correctly append to `appState.processes` even when the process has fields (like `parentProcessId`, `workspaceId`) that might cause it to be filtered out. No code change expected here unless testing reveals a gap — document as a verification item.

#### SPA Styles — `packages/coc/src/server/spa/client/styles.css`

**5. Conversation section styles**

The `.conversation-section` and `.conversation-body` CSS classes already exist (used by the queue task detail view). Verify they apply correctly when reused in the process detail panel. If the existing styles have scoping issues (e.g., nested under a queue-specific parent), extract them to be shared. Expected: **no CSS changes needed** since the class names are global.

### Files NOT Modified

| File | Reason |
|------|--------|
| `sse-handler.ts` | Existing SSE `/stream` endpoint is for real-time output of running processes — unrelated to reading persisted output files |
| `websocket.ts` (server) | WebSocket server already broadcasts `process-added` / `process-updated` / `process-removed` events — no server-side changes needed |
| `html-template.ts` | No new HTML skeleton elements required — the conversation section is injected dynamically by `detail.ts` |
| `sidebar.ts` | Sidebar rendering already responds to `renderProcessList()` calls from WebSocket handler |
| `core.ts` | Init and routing logic unchanged |
| `state.ts` | No new state fields needed |

## Implementation Notes

### Route Ordering

The new `/api/processes/:id/output` route must be registered **before** the catch-all `GET /api/processes/:id` route (line 284–296 in `api-handler.ts`). The existing `/stream` route at line 274 demonstrates the correct placement pattern — insert `/output` immediately after `/stream` and before the single-process detail route.

### File Reading Safety

When reading `rawStdoutFilePath`:
- Validate the path exists before reading (`fs.promises.access` or try/catch around `readFile`)
- Handle `ENOENT` gracefully as a 404
- Handle other errors (permissions, encoding) as 500
- Do not follow symlinks outside the `~/.coc/` directory (optional hardening)

### Response Size Consideration

Conversation output files can be large (multi-MB for long AI sessions). For this initial implementation, return the full content. A future enhancement could add pagination or `Range` header support, but that is out of scope for this commit.

### Markdown Rendering

The SPA already has a `renderMarkdown()` function in `detail.ts` (line 388–490) that handles code blocks, headers, lists, blockquotes, and inline formatting. The conversation output is already markdown-formatted by the AI, so it renders cleanly without additional processing.

### Copy to Clipboard

The `copyToClipboard()` utility already exists in `utils.ts` and handles the `navigator.clipboard` API with fallback. Reuse it directly.

## Tests

### New Test: `/api/processes/:id/output` endpoint

**File:** `packages/coc/test/api-handler.test.ts` (extend existing)

| Test Case | Setup | Expected |
|-----------|-------|----------|
| Returns 200 with content when output file exists | Create process with `rawStdoutFilePath` pointing to a temp file containing markdown text | `{ content: '...markdown...', format: 'markdown' }`, status 200 |
| Returns 404 when process not found | Request with non-existent process ID | `{ error: 'Process not found' }`, status 404 |
| Returns 404 when no rawStdoutFilePath | Create process without `rawStdoutFilePath` set | `{ error: 'No conversation output saved' }`, status 404 |
| Returns 404 when file path set but file missing | Create process with `rawStdoutFilePath` pointing to non-existent path | `{ error: 'No conversation output saved' }`, status 404 |
| Handles large output files | Create process with multi-KB output file | Returns full content, status 200 |

### Existing Test: SPA HTML verification

**File:** `packages/coc/test/spa.test.ts` (extend existing or new test)

| Test Case | Assertion |
|-----------|-----------|
| `copyConversationOutput` is registered on window | Generated HTML script contains `copyConversationOutput` |

### Existing Test: WebSocket process events

**File:** `packages/coc/test/websocket.test.ts` (verify existing)

| Test Case | Assertion |
|-----------|-----------|
| `process-added` triggers `renderProcessList()` | Already covered — verify test exists |
| `process-updated` re-renders detail if selected | Already covered — verify test exists |
| `process-removed` clears detail if selected | Already covered — verify test exists |

## Acceptance Criteria

- [ ] `GET /api/processes/:id/output` returns `{ content, format: 'markdown' }` with status 200 when output file exists
- [ ] `GET /api/processes/:id/output` returns 404 with descriptive error when process not found, no file path, or file missing
- [ ] Dashboard detail panel shows full conversation text for completed processes in a scrollable, markdown-formatted section
- [ ] "No conversation output saved" message shown when 404 received
- [ ] "Copy Conversation" button copies raw conversation text to clipboard
- [ ] Process list in sidebar updates in real time when processes are added, updated, or removed via WebSocket (verify existing behavior)
- [ ] No regressions in existing detail view (Result, Structured Result, Prompt sections still render)
- [ ] All new and existing tests pass: `npm run test:run` in `packages/coc/`

## Dependencies

- Depends on: **003** (conversation output persisted to files via `rawStdoutFilePath`)
- Depends on: **002** (process persistence to `FileProcessStore` so processes survive restart)
