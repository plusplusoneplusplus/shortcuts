---
status: pending
---

# 006 — Implement Follow Prompt Flow in CoC SPA

## Summary

Wire up the "Follow Prompt" action in the AI action dropdown (from commit 005) on task items in the CoC SPA dashboard. When a user clicks "Follow Prompt", the SPA fetches available prompts and skills from workspace discovery endpoints (from commit 003), presents a selection submenu, fetches the task document content, and enqueues a `follow-prompt` queue task with the selected prompt/skill and task content as additional context.

## Prerequisites

| Commit | What it provides |
|--------|-----------------|
| **003** | Discovery endpoints: `GET /api/workspaces/:id/prompts` → `{ prompts: Array<{ name, relativePath }> }` and `GET /api/workspaces/:id/skills` → `{ skills: Array<{ name, description?, version? }> }`. Registered in `prompt-handler.ts`. |
| **004** | Executor context support: `queue-executor-bridge.ts` `extractPrompt()` reads `FollowPromptPayload.additionalContext` and `workingDirectory`. |
| **005** | AI action dropdown shell: `ai-actions.ts` renders a `div.ai-action-dropdown` with `data-ai-action="follow-prompt"` and `data-ai-action="update-document"` buttons. Currently stubs — the `case 'follow-prompt'` block at line ~93 is a no-op. |

## Context: Verified Codebase State

### FollowPromptPayload (pipeline-core/src/queue/types.ts:47–60)

```typescript
export interface FollowPromptPayload {
    promptFilePath?: string;   // Path to prompt file
    promptContent?: string;    // Direct prompt content (alternative)
    planFilePath?: string;     // Optional plan file path
    skillName?: string;        // Optional skill name
    additionalContext?: string; // Extra context appended to prompt
    workingDirectory?: string;  // Working directory for execution
}
```

Type guard `isFollowPromptPayload` (types.ts:417–418) checks: `'promptFilePath' in payload || 'promptContent' in payload`.

### Queue Enqueue — POST /api/queue (queue-handler.ts:122–169)

```typescript
// Accepted body shape:
{
    type: 'follow-prompt',          // must be in VALID_TASK_TYPES set
    priority: 'normal',             // 'high' | 'normal' | 'low'
    displayName: 'Follow: X on Y', // optional — auto-generated if omitted
    payload: { /* FollowPromptPayload fields */ },
    config: { model?: string, timeoutMs?: number }
}
```

Auto-display-name logic (queue-handler.ts:46–48): if `payload.promptFilePath` is set, uses `"Follow Prompt: <basename>"`.

### Queue Submission Pattern (queue.ts:257–323)

```typescript
await fetch(getApiBase() + '/queue', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
});
```

After success: `hideEnqueueDialog()`, `fetchQueue()`, `startQueuePolling()`.

### fetchApi Helper (core.ts:68–76)

```typescript
export async function fetchApi(path: string): Promise<any> {
    const res = await fetch(getApiBase() + path);
    if (!res.ok) return null;
    return await res.json();
}
```

Returns `null` on non-2xx responses. `getApiBase()` reads from `window.__DASHBOARD_CONFIG__.apiBasePath` (default `/api`).

### Task Content Endpoint (tasks-handler.ts:69–110)

`GET /api/workspaces/:id/tasks/content?path=<relativePath>` → `{ content: string, path: string }`.

Used in `tasks.ts` `loadPreviewContent()` (line 529):
```typescript
const data = await fetchApi(`/workspaces/${encodeURIComponent(wsId)}/tasks/content?path=${encodeURIComponent(filePath)}`);
```

### Discovery Endpoint Response Shapes (from commit 003 plan)

**Prompts:** `GET /api/workspaces/:id/prompts`
```json
{ "prompts": [{ "name": "fix-lint", "relativePath": "prompts/fix-lint.prompt.md" }] }
```
Note: response has `relativePath` (relative to pipelines folder), **not** `absolutePath`. The SPA needs `relativePath` for display; the server will need the workspace root to reconstruct the absolute path for the enqueue payload.

**Skills:** `GET /api/workspaces/:id/skills`
```json
{ "skills": [{ "name": "impl", "description": "Implementation skill", "version": "1.0" }] }
```
Note: skills response has `name` but **no path field**. Skills are resolved by name at execution time by `resolveSkillWithDetailsSync()` in the executor.

### State (state.ts)

- `taskPanelState.selectedWorkspaceId: string | null` — current workspace in tasks panel.
- `appState.workspaces: any[]` — registered workspaces, each with `{ id, name, rootPath }`.

### Window Global Pattern

All SPA modules expose functions for cross-module onclick access:
```typescript
(window as any).fetchRepoTasks = fetchRepoTasks;  // tasks.ts:804
(window as any).fetchQueue = fetchQueue;            // queue.ts (imported in many places)
```

### Existing ai-actions.ts (from commit 005)

`packages/coc/src/server/spa/client/ai-actions.ts` — currently contains:
- `showAIActionDropdown(button, wsId, taskPath)` — renders dropdown, handles `data-ai-action` clicks
- `hideAIActionDropdown()` — removes dropdown + cleans up listeners
- Dropdown click handler has `switch (aiAction)` with stub cases at lines 92–99
- Imported in `index.ts` between tasks and websocket imports
- **No window globals exported yet** — dropdown is invoked via direct import from `tasks.ts`

## File Changes

### 1. Modify `packages/coc/src/server/spa/client/ai-actions.ts`

This file already exists from commit 005. Add the Follow Prompt flow below the existing code.

#### 1.1 Add Imports

Add to existing imports at the top of the file:

```typescript
import { getApiBase } from './config';
import { fetchApi } from './core';
import { appState, taskPanelState } from './state';
```

The file already imports `escapeHtmlClient` from `./utils`.

#### 1.2 Add Types and Cache (after the existing `hideAIActionDropdown` function)

```typescript
// ================================================================
// Discovery cache
// ================================================================

interface PromptItem {
    name: string;
    relativePath: string;
}

interface SkillItem {
    name: string;
    description?: string;
}

interface DiscoveryCache {
    prompts: PromptItem[];
    skills: SkillItem[];
    fetchedAt: number;
}

const discoveryCache: Record<string, DiscoveryCache> = {};
const CACHE_TTL_MS = 60_000; // 60 seconds
```

**Key difference from prior plan:** `PromptItem` uses `relativePath` (not `absolutePath`) to match the actual endpoint response from commit 003. Skills have no path field — they are resolved by `name` at execution time.

#### 1.3 `fetchPromptsAndSkills(wsId: string)`

```
1. Check discoveryCache[wsId]:
   - If entry exists and (Date.now() - entry.fetchedAt) < CACHE_TTL_MS, return cached.
2. Fetch in parallel using Promise.all:
   - fetchApi(`/workspaces/${encodeURIComponent(wsId)}/prompts`)
   - fetchApi(`/workspaces/${encodeURIComponent(wsId)}/skills`)
3. Extract arrays:
   - prompts = promptData?.prompts || []     (Array<{ name, relativePath }>)
   - skills  = skillData?.skills  || []      (Array<{ name, description? }>)
4. Store in discoveryCache[wsId] = { prompts, skills, fetchedAt: Date.now() }.
5. Return { prompts, skills }.
```

Both `fetchApi()` calls return `null` on error/non-2xx, so the `|| []` fallback handles failures gracefully without needing try/catch.

#### 1.4 `invalidateDiscoveryCache(wsId?: string)`

```typescript
export function invalidateDiscoveryCache(wsId?: string): void {
    if (wsId) {
        delete discoveryCache[wsId];
    } else {
        for (const key of Object.keys(discoveryCache)) {
            delete discoveryCache[key];
        }
    }
}
```

#### 1.5 Wire the stub in `showAIActionDropdown`

Replace the existing `case 'follow-prompt'` stub (line ~93–95) with:

```typescript
case 'follow-prompt': {
    const taskName = taskPath.split('/').pop()?.replace(/\.md$/, '') || taskPath;
    showFollowPromptSubmenu(wsId, taskPath, taskName);
    break;
}
```

`taskPath` is already available from the dropdown's closure (passed into `showAIActionDropdown` from the event delegation). `taskName` is derived from the filename for the display name.

#### 1.6 `showFollowPromptSubmenu(wsId, taskPath, taskName)`

This is the main UI function. It creates a modal overlay (not a positioned dropdown) following the same `enqueue-overlay` + `enqueue-dialog` pattern used by `showInputDialog()` in tasks.ts and `showEnqueueDialog()` in queue.ts.

**Step 1 — Show loading overlay:**

```
1. document.getElementById('follow-prompt-submenu')?.remove()
2. Create overlay div: id="follow-prompt-submenu", class="enqueue-overlay"
3. Inner HTML: enqueue-dialog container with header "Follow Prompt" and loading text
4. Append to document.body
```

**Step 2 — Fetch discovery data:**

```
1. const { prompts, skills } = await fetchPromptsAndSkills(wsId)
2. Check if overlay still exists (user may have closed it during fetch)
3. If prompts.length === 0 && skills.length === 0:
   - Update dialog body to show empty state message:
     "No prompts or skills found in this workspace.
      Create .prompt.md files in .vscode/pipelines/ or skills in .github/skills/"
   - Keep close button functional
   - Return
```

**Step 3 — Render items list:**

```html
<div class="enqueue-dialog-header">
    <h2>Follow Prompt</h2>
    <button class="enqueue-close-btn" id="fp-close">&times;</button>
</div>
<div class="follow-prompt-body">
    <!-- Prompts section (only if prompts.length > 0) -->
    <div class="fp-section">
        <div class="fp-section-label">Prompts</div>
        <div class="fp-item" data-type="prompt" data-name="{name}" data-path="{relativePath}">
            <span class="fp-item-icon">📝</span>
            <span class="fp-item-name">{name}</span>
        </div>
        <!-- ... more prompts -->
    </div>

    <!-- Skills section (only if skills.length > 0) -->
    <div class="fp-section">
        <div class="fp-section-label">Skills</div>
        <div class="fp-item" data-type="skill" data-name="{name}">
            <span class="fp-item-icon">⚡</span>
            <span class="fp-item-name">{name}</span>
            <span class="fp-item-desc">{description}</span>  <!-- if description exists -->
        </div>
        <!-- ... more skills -->
    </div>
</div>
```

All text rendered through `escapeHtmlClient()`.

**Step 4 — Attach event listeners:**

```
1. #fp-close click → overlay.remove()
2. Overlay background click (e.target === overlay) → overlay.remove()
3. Delegated click on .fp-item:
   a. const item = target.closest('.fp-item')
   b. Extract: type = item.dataset.type, name = item.dataset.name, path = item.dataset.path
   c. overlay.remove()
   d. Call enqueueFollowPrompt(wsId, taskPath, taskName, type, name, path)
```

#### 1.7 `enqueueFollowPrompt(wsId, taskPath, taskName, itemType, itemName, itemPath?)`

```
1. Fetch task content (for additionalContext):
   const data = await fetchApi(
       `/workspaces/${encodeURIComponent(wsId)}/tasks/content?path=${encodeURIComponent(taskPath)}`
   );
   const taskContent = data?.content || '';

2. Resolve workspace rootPath for workingDirectory:
   const ws = appState.workspaces.find((w: any) => w.id === wsId);
   const workingDirectory = ws?.rootPath || '';

3. Build payload based on item type:

   For PROMPT selections:
   - promptFilePath needs to be absolute. Construct from ws.rootPath + pipelinesFolder + relativePath:
     const promptFilePath = workingDirectory
         ? workingDirectory + '/.vscode/pipelines/' + itemPath
         : itemPath || '';
   - payload = { promptFilePath, additionalContext: taskContent, workingDirectory }

   For SKILL selections:
   - Skills are resolved by name, no file path needed for type guard satisfaction.
   - Use skillName field so executor can resolve the skill at runtime.
   - Still need promptFilePath or promptContent for isFollowPromptPayload type guard to pass.
   - Use promptContent with a minimal instruction referencing the skill.
   - payload = { skillName: itemName, promptContent: `Use the ${itemName} skill.`,
                  additionalContext: taskContent, workingDirectory }

4. Build full enqueue body:
   const body = {
       type: 'follow-prompt' as const,
       priority: 'normal',
       displayName: `Follow: ${itemName} on ${taskName}`,
       payload,
       config: {},
   };

5. POST to /api/queue:
   try {
       const res = await fetch(getApiBase() + '/queue', {
           method: 'POST',
           headers: { 'Content-Type': 'application/json' },
           body: JSON.stringify(body),
       });
       if (!res.ok) {
           const err = await res.json().catch(() => ({ error: 'Failed' }));
           showToast('Failed to enqueue: ' + (err.error || 'Unknown error'), 'error');
           return;
       }
       showToast('Enqueued: ' + itemName, 'success');
       // Refresh queue panel
       if ((window as any).fetchQueue) {
           (window as any).fetchQueue();
       }
   } catch {
       showToast('Network error enqueuing task', 'error');
   }
```

**Payload validation:** The `isFollowPromptPayload` type guard (types.ts:417) requires either `promptFilePath` or `promptContent` in the payload object. For prompt items, `promptFilePath` satisfies this. For skill items, `promptContent` satisfies this (the executor's `extractPrompt()` prefers `promptContent` over `promptFilePath` at line 188).

#### 1.8 `showToast(message, type)`

Lightweight notification at bottom-right. Follows a simple pattern:

```typescript
function showToast(message: string, type: 'success' | 'error'): void {
    const toast = document.createElement('div');
    toast.className = 'toast toast-' + type;
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => {
        toast.classList.add('toast-fade');
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}
```

Exported for use by future commits (007, 008).

#### 1.9 Window Globals

Add at the bottom of the file:

```typescript
(window as any).showFollowPromptSubmenu = showFollowPromptSubmenu;
(window as any).invalidateDiscoveryCache = invalidateDiscoveryCache;
(window as any).showToast = showToast;
```

### 2. Modify `packages/coc/src/server/spa/client/index.ts`

**No changes needed.** The file already imports `./ai-actions` (added in commit 005, line 37–38 area). The new code is added to the existing `ai-actions.ts` module and will be bundled automatically.

### 3. Modify `packages/coc/src/server/spa/client/styles.css`

Add CSS at the end of the file. Two blocks:

#### Follow Prompt Submenu Styles

```css
/* Follow Prompt submenu */
.follow-prompt-body {
    padding: 8px 0;
    max-height: 50vh;
    overflow-y: auto;
}

.fp-section {
    margin-bottom: 12px;
}

.fp-section-label {
    font-size: 0.75em;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--text-secondary);
    padding: 4px 16px;
    margin-bottom: 4px;
}

.fp-item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 16px;
    cursor: pointer;
    border-radius: 4px;
    transition: background 0.15s;
}

.fp-item:hover {
    background: var(--hover-bg);
}

.fp-item-icon {
    font-size: 1.1em;
    flex-shrink: 0;
}

.fp-item-name {
    font-weight: 500;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

.fp-item-desc {
    font-size: 0.8em;
    color: var(--text-secondary);
    margin-left: auto;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 180px;
}
```

Uses existing CSS variables: `--text-secondary`, `--hover-bg` from `:root` (styles.css:1–18). The dialog container reuses existing `.enqueue-overlay` and `.enqueue-dialog` classes (no new dialog wrapper class needed).

#### Toast Notification Styles

```css
/* Toast notifications */
.toast {
    position: fixed;
    bottom: 20px;
    right: 20px;
    padding: 10px 18px;
    border-radius: 6px;
    font-size: 0.9em;
    color: #fff;
    z-index: 10001;
    animation: toast-in 0.3s ease;
    max-width: 400px;
    word-break: break-word;
    pointer-events: none;
}

.toast-success { background: var(--status-completed); }
.toast-error   { background: var(--status-failed); }
.toast-fade    { opacity: 0; transition: opacity 0.3s ease; }

@keyframes toast-in {
    from { opacity: 0; transform: translateY(10px); }
    to   { opacity: 1; transform: translateY(0); }
}
```

Uses existing theme variables `--status-completed` (#16825d / #89d185) and `--status-failed` (#f14c4c / #f48771) so toasts look correct in both light and dark themes.

## Enqueue Payloads — Exact Format

### When selecting a Prompt

```json
{
    "type": "follow-prompt",
    "priority": "normal",
    "displayName": "Follow: fix-lint on my-feature-task",
    "payload": {
        "promptFilePath": "/Users/dev/myproject/.vscode/pipelines/prompts/fix-lint.prompt.md",
        "additionalContext": "---\nstatus: in-progress\n---\n\n# My Feature Task\n\nImplement the widget...",
        "workingDirectory": "/Users/dev/myproject"
    },
    "config": {}
}
```

Executor flow: `extractPrompt()` (queue-executor-bridge.ts:186–213) detects `promptFilePath`, builds prompt as `"Follow the instruction {path}."` + `additionalContext`. `getWorkingDirectory()` (line 290) returns `payload.workingDirectory`.

### When selecting a Skill

```json
{
    "type": "follow-prompt",
    "priority": "normal",
    "displayName": "Follow: impl on my-feature-task",
    "payload": {
        "skillName": "impl",
        "promptContent": "Use the impl skill.",
        "additionalContext": "---\nstatus: in-progress\n---\n\n# My Feature Task\n\nImplement the widget...",
        "workingDirectory": "/Users/dev/myproject"
    },
    "config": {}
}
```

Executor flow: `extractPrompt()` detects `promptContent` (line 188), builds prompt as `promptContent + "\n\nAdditional context: " + additionalContext`. The `skillName` field is available for future skill-specific routing.

### Type Guard Satisfaction

| Item type | Field present | `isFollowPromptPayload` check |
|-----------|--------------|-------------------------------|
| Prompt | `promptFilePath` | `'promptFilePath' in payload` → ✅ |
| Skill | `promptContent` | `'promptContent' in payload` → ✅ |

## Error Handling

| Scenario | Behavior |
|----------|----------|
| `GET /workspaces/:id/prompts` returns error/null | `fetchApi` returns null → prompts defaults to `[]`; skills-only UI shown |
| `GET /workspaces/:id/skills` returns error/null | `fetchApi` returns null → skills defaults to `[]`; prompts-only UI shown |
| Both discovery fetches return null | Empty state shown in submenu: "No prompts or skills found" |
| `GET /workspaces/:id/tasks/content` fails | `data?.content || ''` → empty `additionalContext`; enqueue proceeds (AI runs without task context) |
| `POST /queue` returns non-2xx | Parse error body → `showToast('Failed to enqueue: <error>', 'error')` |
| Network error on POST | `showToast('Network error enqueuing task', 'error')` |
| User closes submenu during fetch | Check overlay exists after await; if removed, do nothing |

## Event Flow

```
User clicks 🤖 on a task row
  └─ attachMillerEventListeners delegation (tasks.ts)
       └─ case 'ai-action': showAIActionDropdown(btn, wsId, taskPath)
            └─ Dropdown renders with "📝 Follow Prompt" and "📄 Update Document"

User clicks "📝 Follow Prompt"
  └─ dropdown click handler (ai-actions.ts)
       └─ case 'follow-prompt':
            ├─ Derive taskName from taskPath
            ├─ hideAIActionDropdown()
            └─ showFollowPromptSubmenu(wsId, taskPath, taskName)
                 ├─ Show overlay with "Loading..."
                 ├─ await fetchPromptsAndSkills(wsId)
                 │    ├─ Check cache (60s TTL)
                 │    └─ Parallel fetch: GET /prompts + GET /skills
                 └─ Render items list in dialog

User clicks a prompt/skill item
  └─ Delegated click on .fp-item
       ├─ Extract type, name, path from data attributes
       ├─ Remove overlay
       └─ await enqueueFollowPrompt(wsId, taskPath, taskName, type, name, path)
            ├─ GET /tasks/content?path=... → task markdown
            ├─ Look up ws.rootPath from appState.workspaces
            ├─ Build payload (promptFilePath or promptContent + skillName)
            ├─ POST /queue → 201
            ├─ showToast('Enqueued: <name>', 'success')
            └─ fetchQueue() → refresh queue panel
```

## Testing Considerations

- **Manual testing:** `cd packages/coc && npm run build && npm link && coc serve --no-open`. Register a workspace. Add `.prompt.md` files to `.vscode/pipelines/`. Navigate to Repos → select workspace → Tasks → click 🤖 → Follow Prompt → verify submenu loads with items → select → verify queue panel shows new task.
- **Unit tests (Vitest):** Test `fetchPromptsAndSkills()` cache behavior with mocked `fetchApi()`. Test `showToast()` creates and auto-removes DOM elements. Test payload construction in `enqueueFollowPrompt()`.
- **Integration tests:** Extend SPA test files to verify the submenu overlay renders, items display, and POST body matches expected `FollowPromptPayload` shape.

## Files Modified Summary

| File | Action | Description |
|------|--------|-------------|
| `packages/coc/src/server/spa/client/ai-actions.ts` | **Modify** | Add discovery cache, fetchPromptsAndSkills, showFollowPromptSubmenu, enqueueFollowPrompt, showToast, wire follow-prompt case, window globals |
| `packages/coc/src/server/spa/client/styles.css` | **Modify** | Add `.fp-section`, `.fp-item`, `.toast` CSS |
| `packages/coc/src/server/spa/client/index.ts` | **No change** | Already imports `./ai-actions` from commit 005 |

## Dependencies

- Depends on: **003** (discovery REST endpoints — `GET /api/workspaces/:id/prompts` and `GET /api/workspaces/:id/skills`)
- Depends on: **004** (executor context support — `extractPrompt()` reads `additionalContext` and `workingDirectory`)
- Depends on: **005** (AI action dropdown shell — `ai-actions.ts` with `showAIActionDropdown` and stub `case 'follow-prompt'`)
