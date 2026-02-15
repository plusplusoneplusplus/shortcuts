---
status: pending
---

# 008: Add Write-Back Support for Update Document Results

## Summary

When a queue task originating from "Update Document" (commit 007) completes, show an "Apply Changes" button in the queue task detail panel. Clicking it writes the AI result back to the original task file via a new `PATCH /api/workspaces/:id/tasks/content` endpoint. The mapping between queue task and original file is maintained through `originalTaskPath` and `originalWorkspaceId` fields embedded in the enqueued `CustomTaskPayload.data` (set by commit 007's `showUpdateDocumentModal` in `ai-actions.ts`).

## Motivation

The "Update Document" flow currently ends with the AI result displayed as read-only text in the queue task detail view. The user must manually copy the result and paste it into the original file. This commit closes the loop: one click writes the AI output back to the source file, with a confirmation dialog to prevent accidental overwrites. This is the terminal commit in the AI Action Dropdown feature series.

## Changes

### Files to Create

- (none — all changes extend existing files)

### Files to Modify

1. **`packages/coc/src/server/tasks-handler.ts`** (590 lines) — Add `PATCH /api/workspaces/:id/tasks/content` endpoint inside `registerTaskWriteRoutes()`
2. **`packages/coc/src/server/spa/client/detail.ts`** (551 lines) — Add "Apply Changes" button, `applyWriteBack()` function, and `showToast()` helper in the queue task detail view
3. **`packages/coc/src/server/spa/client/styles.css`** — Add CSS for button states (`action-btn-primary`, `action-btn-success`, `action-btn-error`) and toast notification (`writeback-toast`)
4. **`packages/coc/test/server/tasks-handler.test.ts`** (395 lines) — Add test suite for the new PATCH content endpoint

### Files to Delete

- (none)

## Implementation Notes

### 1. Backend: `packages/coc/src/server/tasks-handler.ts` — New PATCH endpoint

Add a new route inside `registerTaskWriteRoutes()` **after** the existing `PATCH /api/workspaces/:id/tasks` route (line 449) and **before** the `DELETE` route (line 454). The route pattern must be more specific (includes `/content` suffix) so it doesn't collide with the existing PATCH.

#### Route definition

```typescript
// ------------------------------------------------------------------
// PATCH /api/workspaces/:id/tasks/content — Write task file content
// ------------------------------------------------------------------
routes.push({
    method: 'PATCH',
    pattern: /^\/api\/workspaces\/([^/]+)\/tasks\/content$/,
    handler: async (req, res, match) => {
        const id = decodeURIComponent(match![1]);
        const ws = await resolveWorkspace(store, id);
        if (!ws) {
            return sendError(res, 404, 'Workspace not found');
        }

        let body: any;
        try {
            body = await parseBody(req);
        } catch {
            return sendError(res, 400, 'Invalid JSON body');
        }

        const { path: filePath, content } = body || {};
        if (!filePath || typeof filePath !== 'string') {
            return sendError(res, 400, 'Missing required field: path');
        }
        if (typeof content !== 'string') {
            return sendError(res, 400, 'Missing required field: content');
        }

        const tasksFolder = path.resolve(ws.rootPath, DEFAULT_SETTINGS.folderPath);
        const resolvedPath = resolveAndValidatePath(tasksFolder, filePath);
        if (!resolvedPath) {
            return sendError(res, 403, 'Access denied: path is outside tasks folder');
        }

        // File must already exist — no creation via write-back
        try {
            const stat = await fs.promises.stat(resolvedPath);
            if (!stat.isFile()) {
                return sendError(res, 400, 'Path is not a file');
            }
        } catch (err: any) {
            if (err.code === 'ENOENT') {
                return sendError(res, 404, 'File not found');
            }
            return sendError(res, 500, 'Failed to access file');
        }

        try {
            await fs.promises.writeFile(resolvedPath, content, 'utf-8');
            sendJSON(res, 200, { path: filePath, updated: true });
        } catch (err: any) {
            return sendError(res, 500, 'Failed to write file: ' + (err.message || 'Unknown error'));
        }
    },
});
```

#### Design decisions

| Decision | Rationale |
|---|---|
| **Reuse `resolveAndValidatePath()`** (line 178) | Same path-traversal guard as all other write endpoints. Resolved path must start with `tasksFolder + path.sep`. |
| **File must already exist** | Returns 404 for missing files. Prevents accidental file creation; new files go through `POST /api/workspaces/:id/tasks`. |
| **Whole-file write** | The AI result from "Update Document" is a complete document replacement, not a diff. `fs.promises.writeFile()` is the correct semantic. |
| **PATCH method** | Matches the existing pattern: `PATCH /api/workspaces/:id/tasks` for rename/status. The `/content` suffix disambiguates the two PATCH routes. |
| **Registration order** | Must be registered **before** the generic `PATCH /api/workspaces/:id/tasks` because the regex engine tries routes in order and `/tasks/content` is more specific. Alternatively, since both patterns are distinct (`/tasks/content$` vs `/tasks$`), order only matters for the route matching loop in `api-handler.ts` — first match wins. Since `/content$` won't match plain `/tasks$`, order is flexible, but placing it first is cleaner. |

#### What already exists and is reused

- `resolveWorkspace(store, id)` — line 50, resolves workspace from ProcessStore
- `resolveAndValidatePath(tasksFolder, userPath)` — line 178, path traversal guard
- `parseBody(req)` — imported from `api-handler.ts`, JSON body parser
- `sendJSON(res, status, data)` / `sendError(res, status, msg)` — from `api-handler.ts`
- `DEFAULT_SETTINGS.folderPath` — `.vscode/tasks` (line 27)

### 2. Frontend: `packages/coc/src/server/spa/client/detail.ts` — Apply Changes button

#### 2a. Data flow: How `originalTaskPath` reaches the detail view

The data flows through two channels:

**Channel A — Queue state (for running/queued/history tasks):**
The queue handler (`queue-handler.ts` line 74–91, `serializeTask()`) serializes the full `task.payload` to JSON in the REST response and WebSocket broadcasts. The SPA stores this in `queueState.running`, `queueState.queued`, or `queueState.history`. Each history item has `payload: { data: { prompt, originalTaskPath, originalWorkspaceId } }`.

**Channel B — Process store (for completed processes):**
The `CLITaskExecutor` in `queue-executor-bridge.ts` creates an `AIProcess` with `metadata` (line 103–108) containing `type`, `queueTaskId`, `priority`, and `model`. It does **not** currently copy `originalTaskPath` from the payload into metadata. Therefore, for completed processes fetched from the process store, the detail view must extract `originalTaskPath` from the queue history's serialized payload (Channel A), not from `proc.metadata`.

**Implementation strategy:** Look for `originalTaskPath` in the queue state task info (Channel A) first, since it's always available for both running and completed tasks. The process store's `proc.metadata` (Channel B) serves as an optional secondary source if we later propagate these fields.

#### 2b. Extract original task path in `renderQueueTaskConversation()`

After the existing name/status resolution block (line 239), add:

```typescript
// Extract original task path from queue state payload
let originalTaskPath: string | null = null;
let originalWorkspaceId: string | null = null;

// Primary source: queue state (contains full serialized payload)
const allTasks = (queueState.running || []).concat(queueState.queued || []).concat(queueState.history || []);
for (let i = 0; i < allTasks.length; i++) {
    if (allTasks[i].id === taskId) {
        const p = allTasks[i].payload;
        if (p && p.data && typeof p.data.originalTaskPath === 'string') {
            originalTaskPath = p.data.originalTaskPath;
            originalWorkspaceId = typeof p.data.originalWorkspaceId === 'string'
                ? p.data.originalWorkspaceId : null;
        }
        break;
    }
}

// Secondary source: process metadata (if executor propagates these fields)
if (!originalTaskPath && proc && proc.metadata) {
    if (typeof proc.metadata.originalTaskPath === 'string') {
        originalTaskPath = proc.metadata.originalTaskPath;
        originalWorkspaceId = typeof proc.metadata.originalWorkspaceId === 'string'
            ? proc.metadata.originalWorkspaceId : null;
    }
}
```

#### 2c. Render the "Apply Changes" button

In the action buttons section (line 302–307), after the existing "Copy Result" button, add:

```typescript
// Apply Changes button for completed "Update Document" tasks
if (originalTaskPath && originalWorkspaceId && proc && proc.result && !isRunning) {
    html += '<button class="action-btn action-btn-primary" ' +
        'id="apply-changes-btn" ' +
        'data-task-path="' + escapeHtmlClient(originalTaskPath) + '" ' +
        'data-workspace-id="' + escapeHtmlClient(originalWorkspaceId) + '">' +
        '\u{1F4DD} Apply Changes</button>';
}
```

Key conditions:
- `originalTaskPath` is present (only true for "Update Document" tasks from commit 007)
- `originalWorkspaceId` is present (needed to construct the PATCH URL)
- `proc.result` exists (the AI has produced output to write back)
- `!isRunning` (task has completed — don't show for in-progress tasks)
- No need to check `displayName.startsWith('Update:')` — the presence of `originalTaskPath` is the canonical signal

#### 2d. Wire up click handler after innerHTML assignment

After `contentEl.innerHTML = html;` (line 309), add:

```typescript
// Wire up Apply Changes button if present
const applyBtn = document.getElementById('apply-changes-btn');
if (applyBtn) {
    applyBtn.addEventListener('click', function() {
        const taskPath = applyBtn.getAttribute('data-task-path') || '';
        const wsId = applyBtn.getAttribute('data-workspace-id') || '';
        if (taskPath && wsId && proc && proc.result) {
            applyWriteBack(wsId, taskPath, proc.result, applyBtn);
        }
    });
}
```

#### 2e. New function `applyWriteBack()`

Add before the `(window as any)` assignments at the bottom of `detail.ts` (before line 548):

```typescript
/**
 * Write AI result back to the original task file.
 * Shows a confirmation dialog before overwriting.
 */
async function applyWriteBack(
    wsId: string,
    taskPath: string,
    content: string,
    btn: HTMLElement
): Promise<void> {
    const fileName = taskPath.split('/').pop() || taskPath;
    if (!confirm(
        'Apply AI changes to "' + fileName + '"?\n\n' +
        'This will overwrite the current file content with the AI result. ' +
        'This action cannot be undone.'
    )) {
        return;
    }

    // Disable button and show progress
    btn.setAttribute('disabled', 'true');
    btn.textContent = '\u23F3 Applying...';

    try {
        const response = await fetch(
            getApiBase() + '/workspaces/' + encodeURIComponent(wsId) + '/tasks/content',
            {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path: taskPath, content }),
            }
        );

        if (!response.ok) {
            const data = await response.json().catch(function() { return { error: 'Request failed' }; });
            throw new Error(data.error || 'Failed to apply changes');
        }

        // Success: lock button, show toast, refresh task list
        btn.textContent = '\u2705 Applied';
        btn.classList.add('action-btn-success');
        showToast('Changes applied to ' + fileName, 'success');

        // Refresh task tree to reflect updated file content
        if (typeof (window as any).fetchRepoTasks === 'function' && wsId) {
            (window as any).fetchRepoTasks(wsId);
        }
    } catch (err) {
        btn.removeAttribute('disabled');
        btn.textContent = '\u274C Failed \u2014 Retry';
        btn.classList.add('action-btn-error');
        const msg = err instanceof Error ? err.message : 'Unknown error';
        showToast('Failed to apply: ' + msg, 'error');
    }
}
```

#### 2f. New helper `showToast()`

```typescript
function showToast(message: string, type: 'success' | 'error'): void {
    const existing = document.getElementById('writeback-toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.id = 'writeback-toast';
    toast.className = 'writeback-toast writeback-toast-' + type;
    toast.textContent = message;
    document.body.appendChild(toast);

    setTimeout(function() {
        toast.classList.add('writeback-toast-hide');
        setTimeout(function() { toast.remove(); }, 300);
    }, 3000);
}
```

Note: Commit 006 introduces a `showToast()` in `ai-actions.ts`. If 006 is already merged, this toast can be imported from there instead. If not, this local implementation is self-contained. Both use the same `.writeback-toast` / `.toast` CSS class pattern — reconcile during merge.

### 3. Metadata in Enqueued Task Payload — Data Flow

#### How `originalTaskPath` gets into the payload

Commit 007 (`showUpdateDocumentModal` in `ai-actions.ts`) already has access to `wsId` and `taskPath` when the user triggers "Update Document" from the task tree. The enqueue body POSTed to `/api/queue` must include:

```json
{
    "type": "custom",
    "displayName": "Update: my-task.plan.md",
    "payload": {
        "data": {
            "prompt": "Given this document:\n\n<content>\n\nInstruction: <user input>\n\nReturn the complete updated document.",
            "originalTaskPath": "feature1/my-task.plan.md",
            "originalWorkspaceId": "abc123-sha256"
        }
    },
    "config": { "model": "..." }
}
```

**Where these values come from in commit 007's code:**
- `taskPath` — passed to `showUpdateDocumentModal(wsId, taskPath, taskName)` from the dropdown click handler. This is the relative path within `.vscode/tasks/` (e.g., `"feature1/my-task.plan.md"`), matching the format used by `GET /api/workspaces/:id/tasks/content?path=...`.
- `wsId` — the workspace ID from `taskPanelState.selectedWorkspaceId`, passed as the first argument.

**How it travels through the system:**

```
ai-actions.ts                queue-handler.ts              queue-executor-bridge.ts        detail.ts
─────────────                ────────────────              ────────────────────────        ─────────
POST /api/queue         →    CreateTaskInput.payload   →   QueuedTask.payload           →  (serialized in queue state)
  payload.data.               stored in TaskQueueManager    passed to CLITaskExecutor         queueState.history[i].payload
    originalTaskPath          WebSocket broadcasts          process store: proc.metadata       .data.originalTaskPath
    originalWorkspaceId       full payload in serializeTask()  (does NOT copy these fields)
```

The detail view reads `originalTaskPath` from `queueState.history[i].payload.data.originalTaskPath` (Channel A). The `serializeTask()` function in `queue-handler.ts` (line 74–91) includes the full `task.payload` in its serialization, and the WebSocket `queue-updated` message includes `history` (see `websocket.ts` line 107).

**Important:** `CLITaskExecutor` (line 95–108) does **not** propagate `originalTaskPath` into `process.metadata`. The process store only contains `{ type, queueTaskId, priority, model }`. We rely on the queue state for this data. If we need the process store to carry this, a small change to `CLITaskExecutor.execute()` would be required — but it's unnecessary for this commit since the queue history is always available.

#### `CustomTaskPayload.data` — type compatibility

The `CustomTaskPayload` interface (`pipeline-core/src/queue/types.ts` line 123–126):
```typescript
export interface CustomTaskPayload {
    data: Record<string, unknown>;
}
```

`Record<string, unknown>` accepts arbitrary keys. No type changes are needed — `originalTaskPath` and `originalWorkspaceId` are simply additional string values in `data`.

### 4. `packages/coc/src/server/spa/client/styles.css` — Styles

Add after the existing `.action-btn` styles:

```css
/* Apply Changes — primary action variant */
.action-btn-primary {
    background: var(--accent-blue, #2563eb);
    color: #fff;
    border: none;
    font-weight: 600;
}
.action-btn-primary:hover:not([disabled]) {
    background: var(--accent-blue-hover, #1d4ed8);
}
.action-btn-primary[disabled] {
    opacity: 0.7;
    cursor: not-allowed;
}

/* Success state (after successful write-back) */
.action-btn-success {
    background: var(--green, #16a34a) !important;
    color: #fff;
    cursor: default;
    pointer-events: none;
}

/* Error state (retry available) */
.action-btn-error {
    background: var(--red, #dc2626) !important;
    color: #fff;
}

/* Write-back toast notification */
.writeback-toast {
    position: fixed;
    bottom: 24px;
    right: 24px;
    padding: 10px 20px;
    border-radius: 8px;
    font-size: 13px;
    font-weight: 500;
    z-index: 10000;
    opacity: 1;
    transition: opacity 0.3s ease;
    box-shadow: 0 4px 12px rgba(0,0,0,0.15);
}
.writeback-toast-success {
    background: var(--green, #16a34a);
    color: #fff;
}
.writeback-toast-error {
    background: var(--red, #dc2626);
    color: #fff;
}
.writeback-toast-hide {
    opacity: 0;
}
```

### 5. Tests: `packages/coc/test/server/tasks-handler.test.ts`

Add a new `describe` block at the end of the existing test suite (after the `GET /api/workspaces/:id/tasks/settings` tests). Uses the existing test infrastructure: `startServer()`, `registerWorkspace()`, `createTaskFiles()`, `request()`, and a new `patchJSON()` helper.

#### Test helper

```typescript
function patchJSON(url: string, data: unknown) {
    return request(url, {
        method: 'PATCH',
        body: JSON.stringify(data),
        headers: { 'Content-Type': 'application/json' },
    });
}
```

#### Test cases

```typescript
describe('PATCH /api/workspaces/:id/tasks/content — Write content', () => {
    it('should return 404 for unknown workspace', async () => {
        const srv = await startServer();
        const res = await patchJSON(`${srv.url}/api/workspaces/nonexistent/tasks/content`, {
            path: 'test.md', content: 'new'
        });
        expect(res.status).toBe(404);
    });

    it('should return 400 when path field is missing', async () => {
        const srv = await startServer();
        const wsId = await registerWorkspace(srv, workspaceDir);
        const res = await patchJSON(`${srv.url}/api/workspaces/${wsId}/tasks/content`, {
            content: 'new'
        });
        expect(res.status).toBe(400);
        expect(JSON.parse(res.body).error).toContain('path');
    });

    it('should return 400 when content field is missing', async () => {
        const srv = await startServer();
        const wsId = await registerWorkspace(srv, workspaceDir);
        const res = await patchJSON(`${srv.url}/api/workspaces/${wsId}/tasks/content`, {
            path: 'test.md'
        });
        expect(res.status).toBe(400);
        expect(JSON.parse(res.body).error).toContain('content');
    });

    it('should return 404 for nonexistent file', async () => {
        const srv = await startServer();
        const wsId = await registerWorkspace(srv, workspaceDir);
        createTaskFiles({}); // Ensure tasks folder exists but file does not
        const res = await patchJSON(`${srv.url}/api/workspaces/${wsId}/tasks/content`, {
            path: 'nonexistent.md', content: 'new'
        });
        expect(res.status).toBe(404);
    });

    it('should return 403 for path traversal attempts', async () => {
        const srv = await startServer();
        const wsId = await registerWorkspace(srv, workspaceDir);
        createTaskFiles({ 'test.md': '# Test' });
        const res = await patchJSON(`${srv.url}/api/workspaces/${wsId}/tasks/content`, {
            path: '../../../etc/passwd', content: 'hacked'
        });
        expect(res.status).toBe(403);
    });

    it('should write content to an existing file', async () => {
        const srv = await startServer();
        const wsId = await registerWorkspace(srv, workspaceDir);
        createTaskFiles({ 'test.md': '# Original\n\nOld content' });

        const newContent = '# Updated\n\nNew content from AI';
        const res = await patchJSON(`${srv.url}/api/workspaces/${wsId}/tasks/content`, {
            path: 'test.md', content: newContent
        });
        expect(res.status).toBe(200);
        const data = JSON.parse(res.body);
        expect(data.path).toBe('test.md');
        expect(data.updated).toBe(true);

        // Verify file on disk
        const filePath = path.join(workspaceDir, '.vscode/tasks', 'test.md');
        const actual = fs.readFileSync(filePath, 'utf-8');
        expect(actual).toBe(newContent);
    });

    it('should write content to a nested file', async () => {
        const srv = await startServer();
        const wsId = await registerWorkspace(srv, workspaceDir);
        createTaskFiles({ 'feature/sub/task.plan.md': '# Old' });

        const newContent = '# Updated plan';
        const res = await patchJSON(`${srv.url}/api/workspaces/${wsId}/tasks/content`, {
            path: 'feature/sub/task.plan.md', content: newContent
        });
        expect(res.status).toBe(200);

        const filePath = path.join(workspaceDir, '.vscode/tasks/feature/sub', 'task.plan.md');
        expect(fs.readFileSync(filePath, 'utf-8')).toBe(newContent);
    });

    it('should allow writing empty content', async () => {
        const srv = await startServer();
        const wsId = await registerWorkspace(srv, workspaceDir);
        createTaskFiles({ 'test.md': '# Has content' });

        const res = await patchJSON(`${srv.url}/api/workspaces/${wsId}/tasks/content`, {
            path: 'test.md', content: ''
        });
        expect(res.status).toBe(200);

        const filePath = path.join(workspaceDir, '.vscode/tasks', 'test.md');
        expect(fs.readFileSync(filePath, 'utf-8')).toBe('');
    });
});
```

#### Test rationale

| Test | Validates |
|---|---|
| 404 unknown workspace | `resolveWorkspace()` guard |
| 400 missing path | Input validation for `path` field |
| 400 missing content | Input validation for `content` field |
| 404 nonexistent file | File-must-exist precondition |
| 403 path traversal | `resolveAndValidatePath()` security guard |
| 200 write to existing file | Happy path: content written and verified on disk |
| 200 write to nested file | Handles subdirectory paths correctly |
| 200 write empty content | Edge case: empty string is valid content |

## Safety Considerations

1. **Confirmation dialog before overwrite** — `applyWriteBack()` calls `confirm()` with the filename and a clear warning. The user must explicitly click OK.

2. **Path traversal protection** — The backend reuses `resolveAndValidatePath()` (line 178). The resolved absolute path must start with `tasksFolder + path.sep` or equal `tasksFolder`. Any `../` escape attempts → 403.

3. **File must exist** — `fs.promises.stat()` check before write. The endpoint does not create new files. This prevents the write-back flow from accidentally creating files that should go through `POST /api/workspaces/:id/tasks`.

4. **No partial writes** — `fs.promises.writeFile()` replaces the entire file atomically on most platforms. Future improvement: write to `.tmp` then `fs.rename()` for guaranteed atomicity (matching `FileProcessStore` pattern in pipeline-core).

5. **Button state management** — The Apply button transitions through 3 states:
   - **Default**: "📝 Apply Changes" (blue, clickable)
   - **In-progress**: "⏳ Applying..." (disabled, grayed)
   - **Success**: "✅ Applied" (green, `pointer-events: none` — permanently locked)
   - **Error**: "❌ Failed — Retry" (red, re-enabled for retry)

6. **Workspace ID validation** — The embedded `originalWorkspaceId` is validated by `resolveWorkspace()`. If the workspace was deregistered between task completion and apply click → 404.

7. **Empty result guard** — The "Apply Changes" button only renders when `proc.result` is truthy. An empty string result will not show the button.

## Edge Cases

| Scenario | Behavior |
|---|---|
| File deleted between completion and apply | PATCH returns 404 → error toast "File not found" |
| Workspace deregistered | PATCH returns 404 → error toast "Workspace not found" |
| Network error during PATCH | Button shows "Failed — Retry" with error toast |
| User cancels confirm dialog | No action taken, button unchanged |
| Double-click on Apply | Button disabled during request; success state locks it with `pointer-events: none` |
| Queue history cleared before Apply clicked | `originalTaskPath` no longer in queue state; button won't render on re-navigate |
| Very large AI result (>10MB) | `writeFile()` handles arbitrary sizes; no explicit size guard needed |
| Concurrent writes to same file | Last writer wins (standard filesystem behavior); no locking needed for this use case |

## Dependency Chain

```
005 (dropdown shell) → 006 (follow-prompt) → 007 (update-document) → 008 (write-back) ← YOU ARE HERE
                                                     ↑
                                          Sets originalTaskPath
                                          in payload.data
```

This commit depends on:
- **007** — Sets `originalTaskPath` and `originalWorkspaceId` in the `CustomTaskPayload.data` when enqueuing the "Update Document" task
- **006** — Establishes the `ai-actions.ts` module and enqueue pattern; introduces `showToast()` (if merged first)
- **005** — Provides the AI action dropdown UI shell

No commits depend on this one — it is the terminal commit in the feature series.

## Dependencies

- Depends on: 005 (AI action dropdown UI shell)
- Depends on: 006 (Follow Prompt flow — establishes `ai-actions.ts` module and toast pattern)
- Depends on: 007 (Update Document flow — sets `originalTaskPath`/`originalWorkspaceId` in payload)
