---
status: pending
---

# 007: Implement Update Document Flow in CoC SPA

## Summary

Wire up the "Update Document" action in the AI action dropdown. When a user clicks "📄 Update Document" on a task item, a modal dialog appears with a read-only document name, an instruction textarea, and a model selector. On submit, the system fetches the document content, builds a composite AI prompt, and enqueues a `custom` queue task via `POST /api/queue`.

## Motivation

The AI action dropdown shell (commit 005) renders `📄 Update Document` as a `data-ai-action="update-document"` button inside `.ai-action-dropdown`, but the switch case is a stub (`// TODO: commit 007`). This commit provides the actual implementation: a modal dialog that lets users request AI-driven edits to any task document without leaving the dashboard, using the existing queue infrastructure.

## Context: Codebase Patterns (Verified)

### Commit 005 Dropdown Structure (ai-actions.ts)

From the 005 plan, the dropdown is rendered by `showAIActionDropdown(button, wsId, taskPath)` in `ai-actions.ts`. The dropdown contains:

```html
<button class="ai-action-menu-item" data-ai-action="follow-prompt">📝 Follow Prompt</button>
<button class="ai-action-menu-item" data-ai-action="update-document">📄 Update Document</button>
```

The click handler uses `item.getAttribute('data-ai-action')` in a switch:

```typescript
case 'update-document':
    // TODO: commit 007 — open update-document dialog
    break;
```

The `wsId` and `taskPath` are captured in the closure from `showAIActionDropdown(button, wsId, taskPath)`. To call our modal, we also need `taskName` — derived from `taskPath` (e.g., `"feature1/my-task.plan.md"` → `"my-task.plan"`).

### Commit 006 Follow Prompt Structure (ai-actions.ts)

Commit 006 adds to the same `ai-actions.ts` file: `showFollowPromptSubmenu()`, `fetchPromptsAndSkills()`, `enqueueFollowPrompt()`, `showToast()`, discovery cache, and CSS for `.follow-prompt-*` and `.toast-*` classes. The `showToast()` utility will be available in this file.

### Modal Pattern: showRepoAIGenerateDialog (tasks.ts lines 661–798)

- Creates overlay via `document.createElement('div')` with unique ID
- Uses `.enqueue-overlay` for backdrop (CSS lines 724–735: `position:fixed; top:0; background:rgba(0,0,0,0.5); z-index:200; display:flex; align-items:center; justify-content:center`)
- Uses `.enqueue-dialog` for the dialog box (CSS lines 736–743: `background:var(--bg-primary); border-radius:8px; box-shadow:0 8px 32px`)
- Uses `.enqueue-dialog-header`, `.enqueue-close-btn`, `.enqueue-form`, `.enqueue-field`, `.enqueue-actions`, `.enqueue-btn-primary`, `.enqueue-btn-secondary`
- Close on: X button click, Cancel button click, overlay backdrop click
- Appends to `document.body`, removes via `overlay.remove()`

### Modal Pattern: showInputDialog (tasks.ts lines 60–126)

- Same `.enqueue-*` class pattern, dialog width `400px`
- Disabled input inherits `.enqueue-field input` styling (CSS lines 786–797)

### Queue POST — Custom Type (queue-handler.ts line 21, queue.ts lines 274–278)

```typescript
// VALID_TASK_TYPES includes 'custom' (queue-handler.ts:21)
// Custom payload shape (queue.ts:278):
payload: { data: { prompt: string, workingDirectory?: string } }
```

The `generateDisplayName()` in `queue-handler.ts` (line 58) handles custom type: uses `payload.data.prompt` snippet for auto-naming. Our explicit `displayName` overrides this.

### Task Content API (tasks.ts line 529)

```typescript
const data = await fetchApi(`/workspaces/${encodeURIComponent(wsId)}/tasks/content?path=${encodeURIComponent(filePath)}`);
// Response: { content: string } or { error: string }
```

### Model Selector (html-template.ts lines 240–244)

Server-side renders `#enqueue-model` `<select>` with options from `getAllModels()`. This element is always present in the HTML. Client-side code can clone its `<option>` children:

```typescript
const sourceSelect = document.getElementById('enqueue-model') as HTMLSelectElement | null;
```

### fetchQueue / startQueuePolling (queue.ts lines 11, 331)

Both exported. `fetchQueue()` re-renders the queue panel. `startQueuePolling()` starts 3-second interval polling if active tasks exist.

### Error Feedback Pattern

The codebase uses `alert()` for errors in `submitEnqueueForm` (queue.ts line 321) and `createRepoTask` (tasks.ts). Commit 006 introduces `showToast()` in `ai-actions.ts` — this commit should use `showToast()` since it exists in the same file.

## Changes

### Files to Modify

#### 1. `packages/coc/src/server/spa/client/ai-actions.ts`

This file already exists after commits 005 and 006. It contains: `showAIActionDropdown()`, `hideAIActionDropdown()`, `showFollowPromptSubmenu()`, `enqueueFollowPrompt()`, `fetchPromptsAndSkills()`, `showToast()`, and discovery cache.

**Change A — Wire the `update-document` switch case**

In the dropdown click handler's switch statement, replace the stub:

```typescript
// BEFORE (from commit 005):
case 'update-document':
    // TODO: commit 007 — open update-document dialog
    break;

// AFTER:
case 'update-document': {
    const name = taskPath.split('/').pop()?.replace(/\.md$/, '') || taskPath;
    showUpdateDocumentModal(wsId, taskPath, name);
    break;
}
```

The `taskName` is derived from `taskPath` by taking the basename and stripping `.md`. For example:
- `"feature1/my-task.plan.md"` → `"my-task.plan"`
- `"root-task.md"` → `"root-task"`

The `wsId` and `taskPath` variables are already in scope from the `showAIActionDropdown()` closure.

**Change B — Add `showUpdateDocumentModal` function**

Add the following function after the existing `showFollowPromptSubmenu` / `enqueueFollowPrompt` functions:

```typescript
// ================================================================
// Update Document Modal
// ================================================================

export function showUpdateDocumentModal(wsId: string, taskPath: string, taskName: string): void {
    // Remove any existing instance
    const existing = document.getElementById('update-doc-overlay');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'update-doc-overlay';
    overlay.className = 'enqueue-overlay';

    overlay.innerHTML =
        '<div class="enqueue-dialog" style="width:500px">' +
            '<div class="enqueue-dialog-header">' +
                '<h2>Update Document</h2>' +
                '<button class="enqueue-close-btn" id="update-doc-close">&times;</button>' +
            '</div>' +
            '<form id="update-doc-form" class="enqueue-form">' +
                '<div class="enqueue-field">' +
                    '<label>Document</label>' +
                    '<input type="text" value="' + escapeHtmlClient(taskName) + '" disabled />' +
                '</div>' +
                '<div class="enqueue-field">' +
                    '<label for="update-doc-instruction">Instruction</label>' +
                    '<textarea id="update-doc-instruction" rows="4" ' +
                        'placeholder="Describe what changes you want made to this document..." ' +
                        'required style="width:100%;resize:vertical"></textarea>' +
                '</div>' +
                '<div class="enqueue-field">' +
                    '<label for="update-doc-model">Model <span class="enqueue-optional">(optional)</span></label>' +
                    '<select id="update-doc-model">' +
                        '<option value="">Default</option>' +
                    '</select>' +
                '</div>' +
                '<div class="enqueue-actions">' +
                    '<button type="button" class="enqueue-btn-secondary" id="update-doc-cancel">Cancel</button>' +
                    '<button type="submit" class="enqueue-btn-primary" id="update-doc-submit">Update</button>' +
                '</div>' +
            '</form>' +
        '</div>';

    document.body.appendChild(overlay);

    // Populate model options from the server-rendered #enqueue-model select
    const sourceSelect = document.getElementById('enqueue-model') as HTMLSelectElement | null;
    const targetSelect = document.getElementById('update-doc-model') as HTMLSelectElement | null;
    if (sourceSelect && targetSelect) {
        for (const opt of Array.from(sourceSelect.options)) {
            if (opt.value) { // Skip the "Default" option (already in our HTML)
                targetSelect.appendChild(opt.cloneNode(true) as HTMLOptionElement);
            }
        }
    }

    // Focus the instruction textarea
    const instructionEl = document.getElementById('update-doc-instruction') as HTMLTextAreaElement;
    if (instructionEl) instructionEl.focus();

    // Close handlers
    const close = () => overlay.remove();
    document.getElementById('update-doc-close')?.addEventListener('click', close);
    document.getElementById('update-doc-cancel')?.addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

    // Form submission
    document.getElementById('update-doc-form')?.addEventListener('submit', async (e) => {
        e.preventDefault();

        const instruction = (document.getElementById('update-doc-instruction') as HTMLTextAreaElement)?.value.trim();
        if (!instruction) return;

        const model = (document.getElementById('update-doc-model') as HTMLSelectElement)?.value || '';
        const submitBtn = document.getElementById('update-doc-submit') as HTMLButtonElement;
        if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Updating...'; }

        try {
            // 1. Fetch document content
            const data = await fetchApi(
                `/workspaces/${encodeURIComponent(wsId)}/tasks/content?path=${encodeURIComponent(taskPath)}`
            );
            if (!data || data.error) {
                showToast('Failed to load document content: ' + (data?.error || 'Unknown error'), 'error');
                if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Update'; }
                return;
            }

            const content: string = data.content || '';

            // 2. Build prompt
            const prompt =
                'Given this document:\n\n' +
                content +
                '\n\nInstruction: ' + instruction +
                '\n\nReturn the complete updated document.';

            // 3. Enqueue via POST /queue
            const body: any = {
                type: 'custom',
                displayName: 'Update: ' + taskName,
                payload: {
                    data: {
                        prompt,
                        originalTaskPath: taskPath,
                    },
                },
                config: {},
            };
            if (model) {
                body.config.model = model;
            }

            const res = await fetch(getApiBase() + '/queue', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });

            if (!res.ok) {
                const err = await res.json().catch(() => ({ error: 'Failed' }));
                showToast('Failed to enqueue: ' + (err.error || 'Unknown error'), 'error');
                if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Update'; }
                return;
            }

            // 4. Close modal and refresh queue
            overlay.remove();
            showToast('Task enqueued: Update ' + taskName, 'success');
            fetchQueue();
            startQueuePolling();
        } catch (err) {
            showToast('Network error: ' + (err instanceof Error ? err.message : String(err)), 'error');
            if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Update'; }
        }
    });
}
```

**Change C — Add window global export**

At the bottom of the file, alongside existing globals:

```typescript
(window as any).showUpdateDocumentModal = showUpdateDocumentModal;
```

**Change D — Ensure imports**

The file already has these imports (from commits 005/006):
- `import { getApiBase } from './config';`
- `import { fetchApi } from './core';`
- `import { escapeHtmlClient } from './utils';`

Add if not already present (from commit 006's `enqueueFollowPrompt`):
- `import { fetchQueue, startQueuePolling } from './queue';`

The `showToast` function is defined within the same file (added by commit 006).

### Files NOT Modified

- **`index.ts`** — Already imports `'./ai-actions'` (added by commit 005, renumbered by 006). No change needed.
- **`styles.css`** — No new CSS classes. The modal fully reuses existing `.enqueue-*` classes (lines 724–847). The disabled `<input>` inherits `.enqueue-field input` styles (lines 786–797) with browser-default disabled appearance (grayed, no cursor). No dedicated `.update-doc-*` styles needed.
- **`queue-handler.ts`** — No changes. The `custom` type is already validated (line 21). The `originalTaskPath` field in `payload.data` is pass-through data stored on the task and available for future write-back (commit 008).
- **`queue.ts`** — No changes. `fetchQueue` and `startQueuePolling` are already exported.
- **`tasks.ts`** — No changes. Task content API is already implemented.

## Implementation Notes

### Modal HTML Structure — Element Map

| Element | ID | Type | Purpose |
|---|---|---|---|
| Overlay | `update-doc-overlay` | `div.enqueue-overlay` | Full-screen backdrop, flex-centers dialog |
| Dialog | — | `div.enqueue-dialog` | 500px white card with shadow |
| Header | — | `div.enqueue-dialog-header` | "Update Document" + close button |
| Close btn | `update-doc-close` | `button.enqueue-close-btn` | × icon |
| Form | `update-doc-form` | `form.enqueue-form` | Wraps fields + actions |
| Doc name | — | `input[disabled]` | Read-only, shows `taskName` |
| Instruction | `update-doc-instruction` | `textarea` | 4 rows, required, resizable |
| Model | `update-doc-model` | `select` | Default + cloned options |
| Cancel | `update-doc-cancel` | `button.enqueue-btn-secondary` | Closes modal |
| Submit | `update-doc-submit` | `button.enqueue-btn-primary` | "Update" → "Updating..." |

### Why These IDs Are Unique

Existing overlay IDs in the codebase:
- `enqueue-overlay` — static HTML in template (queue dialog)
- `ai-generate-overlay` — `showRepoAIGenerateDialog()` in tasks.ts
- `task-input-dialog-overlay` — `showInputDialog()` in tasks.ts
- `follow-prompt-submenu` — `showFollowPromptSubmenu()` in ai-actions.ts (commit 006)

Our `update-doc-overlay` is guaranteed unique.

### Model Selector Population — Skip Duplicating "Default"

The `#enqueue-model` select in the HTML template has:
```html
<option value="">Default</option>
<option value="model-id-1">Model Label 1</option>
...
```

Our code creates the `Default` option in the innerHTML, then clones only non-empty-value options from `#enqueue-model`:

```typescript
if (opt.value) { // Skip the "Default" option already in our HTML
    targetSelect.appendChild(opt.cloneNode(true) as HTMLOptionElement);
}
```

This avoids a duplicate "Default" entry.

### Prompt Construction

The prompt template is intentionally simple:

```
Given this document:

<full markdown content>

Instruction: <user's instruction text>

Return the complete updated document.
```

The `\n\n` separators ensure clear delineation. "Return the complete updated document." tells the AI to output the full modified document (not a diff), which is needed for write-back in commit 008.

### Payload Shape — originalTaskPath

The `payload.data` object includes `originalTaskPath`:

```json
{
    "data": {
        "prompt": "Given this document:\n\n...\n\nInstruction: ...\n\nReturn the complete updated document.",
        "originalTaskPath": "feature1/my-task.plan.md"
    }
}
```

- `prompt` is consumed by the queue executor's `extractPrompt()` (queue-executor-bridge.ts) which reads `payload.data.prompt` for custom tasks.
- `originalTaskPath` is pass-through metadata. It's stored on the `QueuedTask.payload` and will be used by commit 008 (write-back) to know which file to update with the AI response. The queue handler doesn't validate or act on it.

### taskName Derivation

The `taskName` is computed from `taskPath` at the call site in the dropdown handler:

```typescript
const name = taskPath.split('/').pop()?.replace(/\.md$/, '') || taskPath;
```

Examples:
| `taskPath` | `taskName` |
|---|---|
| `feature1/my-task.plan.md` | `my-task.plan` |
| `root-task.md` | `root-task` |
| `archive/feature1/old-task.md` | `old-task` |

This matches how `tasks.ts` derives display names from file paths (see `renderColumn()` line 424 for doc groups and line 441 for single documents).

### Error Handling Matrix

| Scenario | User Feedback | Modal State | Submit Button |
|---|---|---|---|
| Empty instruction | No action (HTML `required` blocks submit) | Stays open | Enabled |
| `fetchApi` returns null | `showToast('Failed to load document content: Unknown error', 'error')` | Stays open | Re-enabled, text → "Update" |
| `fetchApi` returns `{ error: 'Not found' }` | `showToast('Failed to load document content: Not found', 'error')` | Stays open | Re-enabled |
| `POST /queue` returns 4xx/5xx | `showToast('Failed to enqueue: <error>', 'error')` | Stays open | Re-enabled |
| Network error (fetch throws) | `showToast('Network error: <message>', 'error')` | Stays open | Re-enabled |
| Success | `showToast('Task enqueued: Update <name>', 'success')` | Closes | N/A |

### Close Behavior

Matches `showInputDialog()` (tasks.ts lines 112–116) and `showRepoAIGenerateDialog()` (tasks.ts lines 715–718):

1. Close button (`#update-doc-close`) click → `overlay.remove()`
2. Cancel button (`#update-doc-cancel`) click → `overlay.remove()`
3. Overlay backdrop click (click directly on overlay, not dialog) → `overlay.remove()`
4. Successful form submission → `overlay.remove()`
5. No Escape key handler (not implemented in existing modal dialogs — only the dropdown in commit 005 uses Escape)

### Submit Button State

During async operation:
- `disabled = true` prevents double-submit
- Text changes to `"Updating..."` (matches `showRepoAIGenerateDialog` pattern where submit button state reflects progress, line 733)
- On error: `disabled = false`, text reverts to `"Update"`
- On success: modal is removed, no need to restore

## Event Flow

```
User clicks 🤖 on a task row
  │
  ├─ Event delegation (attachMillerEventListeners in tasks.ts)
  │    └─ Finds [data-action="ai-action"], calls showAIActionDropdown(btn, wsId, taskPath)
  │
  ├─ showAIActionDropdown() (ai-actions.ts — commit 005)
  │    └─ Renders .ai-action-dropdown with two menu items
  │
  ├─ User clicks "📄 Update Document"
  │    └─ dropdown click handler: data-ai-action === 'update-document'
  │         └─ Derive taskName from taskPath: taskPath.split('/').pop()?.replace(/\.md$/, '')
  │         └─ Call showUpdateDocumentModal(wsId, taskPath, taskName)
  │         └─ hideAIActionDropdown() (dropdown closes)
  │
  ├─ showUpdateDocumentModal() (ai-actions.ts — THIS COMMIT)
  │    1. Remove existing #update-doc-overlay if present
  │    2. Create overlay with .enqueue-overlay class
  │    3. Set innerHTML with dialog, form, fields
  │    4. Append to document.body
  │    5. Clone model options from #enqueue-model → #update-doc-model
  │    6. Focus instruction textarea
  │    7. Attach close handlers (X, Cancel, backdrop)
  │    8. Attach form submit handler
  │
  ├─ User fills instruction, optionally selects model, clicks "Update"
  │    └─ Form submit handler:
  │         1. preventDefault, validate instruction not empty
  │         2. Disable submit button, text → "Updating..."
  │         3. GET /api/workspaces/{wsId}/tasks/content?path={taskPath}
  │         4. Build prompt: document content + instruction + "Return complete updated document"
  │         5. POST /api/queue: type='custom', payload.data={prompt, originalTaskPath}, displayName
  │         6. On success: overlay.remove(), showToast(success), fetchQueue(), startQueuePolling()
  │         7. On error: showToast(error), re-enable submit button
  │
  └─ Queue panel updates, new "Update: <taskName>" task appears
```

## Tests

### Unit Tests (Vitest, JSDOM)

Test file: `packages/coc/test/spa-update-document.test.ts`

**DOM Creation:**
- `showUpdateDocumentModal` creates element with id `update-doc-overlay` in document.body
- Overlay has class `enqueue-overlay`
- Dialog has class `enqueue-dialog` with `width:500px` inline style
- Contains disabled input with value matching `taskName` parameter
- Contains textarea with id `update-doc-instruction` and `required` attribute
- Contains select with id `update-doc-model`
- Contains submit button with id `update-doc-submit` and text "Update"
- Contains cancel button with id `update-doc-cancel`

**Model Population:**
- When `#enqueue-model` exists in DOM with options, `#update-doc-model` receives cloned options
- "Default" option (value="") is not duplicated
- When `#enqueue-model` doesn't exist, `#update-doc-model` still has "Default" option

**Close Behavior:**
- Click `#update-doc-close` → overlay removed from DOM
- Click `#update-doc-cancel` → overlay removed from DOM
- Click on overlay background (e.target === overlay) → overlay removed
- Click on dialog content → overlay NOT removed

**Submission (with fetch mocked):**
- Submit fetches from `/workspaces/{wsId}/tasks/content?path={taskPath}` (URL encoding)
- Built prompt contains document content and instruction text
- POST body has `type: 'custom'`, `payload.data.prompt`, `payload.data.originalTaskPath`
- `displayName` is `'Update: ' + taskName`
- When model selected: `config.model` is set
- When model is default (empty): `config.model` not set
- Submit button disabled during async, text → "Updating..."
- On content fetch error: toast shown, modal stays open, button re-enabled
- On POST error: toast shown, modal stays open, button re-enabled
- On success: overlay removed, `fetchQueue()` called, `startQueuePolling()` called

**Window Global:**
- `(window as any).showUpdateDocumentModal` is the exported function

**Idempotency:**
- Calling `showUpdateDocumentModal` twice removes previous overlay before creating new one

## Acceptance Criteria

- [ ] `showUpdateDocumentModal(wsId, taskPath, taskName)` added to `ai-actions.ts`
- [ ] Dropdown `'update-document'` case calls `showUpdateDocumentModal` with derived taskName
- [ ] Modal uses `.enqueue-overlay` + `.enqueue-dialog` + `.enqueue-form` classes (no new CSS)
- [ ] Modal shows: read-only document name, instruction textarea (required), model selector
- [ ] Model selector populated by cloning `#enqueue-model` options (skip duplicate Default)
- [ ] Instruction textarea focused on modal open
- [ ] Submit fetches content via `GET /api/workspaces/:id/tasks/content?path=...`
- [ ] Submit builds prompt: `"Given this document:\n\n${content}\n\nInstruction: ${instruction}\n\nReturn the complete updated document."`
- [ ] Submit POSTs to `/api/queue` with `type:'custom'`, `payload.data.prompt`, `payload.data.originalTaskPath`, `displayName:'Update: <name>'`
- [ ] `config.model` included only when non-default model selected
- [ ] Submit button shows "Updating..." and is disabled during async operation
- [ ] On success: modal closes, `showToast('Task enqueued: Update <name>', 'success')`, `fetchQueue()` + `startQueuePolling()` called
- [ ] On error: `showToast` with error message, modal stays open, button re-enabled
- [ ] Close on: X button, Cancel button, backdrop click
- [ ] `showUpdateDocumentModal` exported on `(window as any)` for global access
- [ ] No new CSS classes added
- [ ] No changes to `index.ts`, `styles.css`, `queue-handler.ts`, `queue.ts`, `tasks.ts`
- [ ] CoC client builds: `cd packages/coc && npm run build:client`
- [ ] All existing CoC tests pass: `cd packages/coc && npm run test:run`

## Dependencies

- Depends on: 005 (AI action dropdown shell — provides `showAIActionDropdown` with `data-ai-action="update-document"` stub)
- Depends on: 006 (Follow Prompt flow — provides `showToast()`, `fetchQueue`/`startQueuePolling` imports in ai-actions.ts)
- Uses: existing `GET /api/workspaces/:id/tasks/content` endpoint (tasks-handler.ts)
- Uses: existing `POST /api/queue` with `custom` type (queue-handler.ts line 21)
