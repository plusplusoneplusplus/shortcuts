---
status: pending
---
# Auto-Folder AI Task Generation — CoC Server SPA

## Problem

The VS Code extension's "Create Task with AI" dialog has a **"✨ Auto (AI decides)"** option in its Location dropdown (`AUTO_FOLDER_SENTINEL = '__auto__'`). This lets the AI pick or create the best subfolder under `.vscode/tasks/` based on the task description.

The `coc serve` web dashboard (`GenerateTaskDialog.tsx`) has **no equivalent**. Its folder dropdown only shows explicit folders fetched from the workspace, and when nothing is selected it silently falls back to the tasks root — no AI folder reasoning happens at all.

## Proposed Approach

Port the auto-folder logic from the VS Code extension to the server stack:

1. **SPA** — prepend `✨ Auto (AI decides)` as the first `<option>` in the Generate Task dialog folder dropdown.
2. **Server handler** — when the sentinel `__auto__` is received as `targetFolder`, scan existing subfolders, inject them into the prompt context, and route file scanning from the tasks root.
3. **Shared prompt builder (`pipeline-core`)** — add `autoFolderContext` parameter to `buildCreateTaskPromptWithName` so the same instruction block used by the VS Code extension is also available to the server handler.

---

## Implementation Plan

### Task 1 — Extend `buildCreateTaskPromptWithName` in `pipeline-core`

**File:** `packages/pipeline-core/src/tasks/task-prompt-builder.ts`

**Current signature (line ~113):**
```ts
export function buildCreateTaskPromptWithName(
    name: string | undefined,
    description: string,
    targetPath: string
): string
```

**Change:** Add optional `autoFolderContext` parameter:
```ts
export interface AutoFolderContext {
    tasksRoot: string;
    existingFolders: string[]; // e.g. ["coc", "coc/chat", "deep-wiki"]
}

export function buildCreateTaskPromptWithName(
    name: string | undefined,
    description: string,
    targetPath: string,
    autoFolderContext?: AutoFolderContext
): string
```

When `autoFolderContext` is present, replace the fixed save-path instruction block with:
```
**FOLDER SELECTION (Auto mode)**
Tasks root: <tasksRoot>
Existing feature folders: coc, coc/chat, deep-wiki, ...
- Pick the most relevant existing folder, OR create a new one (kebab-case, max 3 words).
- Create the folder if it does not exist.
- Save the file directly under <tasksRoot>/<chosen-folder>/<filename>.plan.md
```

This mirrors what `ai-task-commands.ts` in the VS Code extension already does locally (line ~1126–1151), but now lives in the shared package so the server can use it.

Also export the constant from this file (or a shared constants file):
```ts
export const AUTO_FOLDER_SENTINEL = '__auto__';
```

**Tests:** `packages/pipeline-core/src/tasks/__tests__/task-prompt-builder.test.ts`
- Add test: `buildCreateTaskPromptWithName` with `autoFolderContext` — verify folder list and folder selection instructions appear, and the fixed-path instruction is absent.
- Add test: with empty `existingFolders` — verify it still instructs the AI to create a new folder.

---

### Task 2 — Update Server Task Generation Handler

**File:** `packages/coc/src/server/task-generation-handler.ts`

**Direct route (`POST /workspaces/:id/tasks/generate`, line ~98–143):**

```ts
// After: const { prompt, targetFolder, name, model, mode, depth } = body || {};

const AUTO_FOLDER_SENTINEL = '__auto__'; // or import from pipeline-core
const isAutoFolder = targetFolder === AUTO_FOLDER_SENTINEL;

const tasksBase = path.resolve(ws.rootPath, '.vscode/tasks');
const resolvedTarget = isAutoFolder
    ? tasksBase                                         // AI decides subfolder
    : (targetFolder ? path.resolve(tasksBase, targetFolder) : tasksBase);

// Build autoFolderContext when needed
let autoFolderContext: AutoFolderContext | undefined;
if (isAutoFolder) {
    const entries = await fs.readdir(tasksBase, { withFileTypes: true });
    const subfolders = entries
        .filter(e => e.isDirectory())
        .map(e => e.name);
    // Also flatten one level deeper (e.g. coc/chat)
    const deepFolders: string[] = [];
    for (const sub of subfolders) {
        const nested = await fs.readdir(path.join(tasksBase, sub), { withFileTypes: true }).catch(() => []);
        for (const n of nested) {
            if (n.isDirectory()) deepFolders.push(`${sub}/${n.name}`);
        }
    }
    autoFolderContext = {
        tasksRoot: tasksBase,
        existingFolders: [...subfolders, ...deepFolders],
    };
}

// Pass autoFolderContext to prompt builder (now accepts it)
const aiPrompt = name
    ? buildCreateTaskPromptWithName(name, prompt, resolvedTarget, autoFolderContext)
    : buildCreateTaskPrompt(prompt, resolvedTarget);
```

**After AI responds — file scanning:**  
When `isAutoFolder`, pass `tasksBase` (not `resolvedTarget`) as the search root to `parseCreatedFilePath` so it finds the file wherever the AI placed it.

**Queue route (`POST /workspaces/:id/queue/generate`, line ~298):**  
Store the sentinel as-is: `payload.targetFolder = targetFolder` (no change needed). The queue executor will call the same handler logic above when the job runs, so auto-folder resolution happens at execution time, not enqueue time. Verify this flow in `task-queue-executor.ts` (or equivalent) — if it resolves `targetFolder` eagerly before calling the handler, add the same sentinel detection there.

---

### Task 3 — Update `GenerateTaskDialog.tsx` SPA Component

**File:** `packages/coc/src/server/spa/client/react/tasks/GenerateTaskDialog.tsx`

**Change 1 — Add "✨ Auto" constant (top of file):**
```ts
const AUTO_FOLDER_SENTINEL = '__auto__';
```

**Change 2 — Initialize `targetFolder` state to sentinel by default:**
```ts
// Current (line ~107): initialFolder prop or ''
const [targetFolder, setTargetFolder] = useState(initialFolder ?? AUTO_FOLDER_SENTINEL);
```
This makes "Auto" the pre-selected choice when the dialog opens without a pre-selected folder (same UX as the VS Code extension).

**Change 3 — Update folder `<select>` (line ~326):**
```tsx
<select value={targetFolder} onChange={e => setTargetFolder(e.target.value)}>
    {/* NEW: Auto option first */}
    <option value={AUTO_FOLDER_SENTINEL}>✨ Auto (AI decides)</option>
    <option value="">Root</option>
    {folders.filter(f => f !== '').map(f => (
        <option key={f} value={f}>{f}</option>
    ))}
</select>
```

**Change 4 — Show contextual hint below dropdown:**
```tsx
{targetFolder === AUTO_FOLDER_SENTINEL && (
    <p className="hint">✨ AI will choose an existing folder or create a new one based on the task.</p>
)}
```

**Change 5 — Submit handler (line ~187):**
No change needed — `targetFolder` already flows through as-is. The server handler interprets the sentinel.

**Change 6 — `enqueue` payload:**
The sentinel value `'__auto__'` will be sent as `targetFolder` to `POST /queue/generate`. The server stores and later processes it.

---

### Task 4 — Export `AUTO_FOLDER_SENTINEL` from `pipeline-core`

**File:** `packages/pipeline-core/src/tasks/task-prompt-builder.ts` (or `packages/pipeline-core/src/index.ts`)

Export the constant so both `coc` server handler and SPA code can import from the same source, avoiding magic strings:
```ts
export const AUTO_FOLDER_SENTINEL = '__auto__';
```

The VS Code extension's `src/shortcuts/tasks-viewer/types.ts` has its own local copy — leave that unchanged to avoid cross-package coupling (VS Code extension does not depend on `pipeline-core` for this).

---

### Task 5 — Persist Last-Used Folder in SPA

**File:** `packages/coc/src/server/spa/client/react/tasks/GenerateTaskDialog.tsx`

Using `localStorage`:
```ts
const STORAGE_KEY = 'coc.generateTask.lastFolder';

// On mount, load persisted value
const [targetFolder, setTargetFolder] = useState(
    initialFolder ?? localStorage.getItem(STORAGE_KEY) ?? AUTO_FOLDER_SENTINEL
);

// On change, persist it
const handleFolderChange = (v: string) => {
    setTargetFolder(v);
    localStorage.setItem(STORAGE_KEY, v);
};
```

This mirrors the VS Code extension's `saveLastUsedLocation` pattern.

---

## Data Flow Summary

```
User opens Generate Task dialog (targetFolder = "__auto__" by default)
        │
        ▼
User fills prompt, clicks Generate
        │
        ▼
POST /queue/generate  { prompt, targetFolder: "__auto__", name?, model, ... }
        │
        ▼
Queue executor runs job → task-generation-handler
        │
        ├── isAutoFolder = true
        ├── Scan .vscode/tasks/ for existing subfolders (e.g. ["coc", "coc/chat", "deep-wiki"])
        └── Build prompt with AutoFolderContext (tasksRoot + existingFolders)
        │
        ▼
AI decides on folder, creates it if needed, writes file directly
(e.g. writes .vscode/tasks/coc/retry-logic.plan.md)
        │
        ▼
parseCreatedFilePath(response, tasksBase) → finds the .md file
Process store updated, SPA reflects new task in tree
```

---

## Files to Change

| File | Change |
|------|--------|
| `packages/pipeline-core/src/tasks/task-prompt-builder.ts` | Add `AutoFolderContext` interface + `autoFolderContext` param to `buildCreateTaskPromptWithName`; export `AUTO_FOLDER_SENTINEL` |
| `packages/pipeline-core/src/index.ts` | Re-export `AUTO_FOLDER_SENTINEL` and `AutoFolderContext` |
| `packages/coc/src/server/task-generation-handler.ts` | Detect `__auto__` sentinel; scan subfolders; pass `autoFolderContext` to prompt builder; use `tasksBase` for file scanning |
| `packages/coc/src/server/spa/client/react/tasks/GenerateTaskDialog.tsx` | Add `✨ Auto` option; default state to sentinel; hint text; localStorage persistence |
| `packages/pipeline-core/src/tasks/__tests__/task-prompt-builder.test.ts` | Unit tests for `buildCreateTaskPromptWithName` with `autoFolderContext` |

---

## Notes / Risks

- **Queue executor eager resolution:** If the queue executor resolves `targetFolder` to an absolute path before calling the handler, the sentinel would be resolved to a non-existent `__auto__` directory. Must verify `task-queue-executor.ts` does NOT pre-resolve `targetFolder`.
- **`parseCreatedFilePath` depth:** Verify the function scans recursively (or at least 2 levels deep) from `tasksBase` so it finds files placed in a new subfolder the AI created.
- **`initialFolder` prop:** When `GenerateTaskDialog` is opened from a right-click on a folder item, `initialFolder` will be that folder's path. In this case, the auto option is NOT the default — the pre-selected folder is shown. The user can still manually choose `✨ Auto` from the dropdown.
- **VS Code extension**: The existing `AUTO_FOLDER_SENTINEL` in `src/shortcuts/tasks-viewer/types.ts` is a local copy — do **not** change it or create a cross-package dependency.
