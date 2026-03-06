---
status: pending
---
# Auto-Folder Mode for AI Task Creation

## Problem
When creating a task with AI, the user must manually pick a target folder from a dropdown. There's no way to let the AI decide which feature folder to use (or create a new one) based on the task description.

## Proposed Approach
Add an **"Auto (AI decides)"** option to the `Location` dropdown in the "Create New" tab. The AI already has file-writing tools — so in auto mode, we simply inject the list of existing feature folders into the prompt and instruct the AI to pick the best one (or create a new folder) and save the file directly there. No response parsing needed; the AI handles folder creation itself, exactly as it handles file creation today.

---

## Implementation Plan

### 1. UI — Add Auto option to dropdown (`ai-task-dialog.ts`)

**Where:** The `<select id="taskLocation">` HTML block (line ~484) and the JS block that populates it (`taskLocationSelect` loop, line ~686).

**Change:**
- Prepend a special sentinel option `value="__auto__"` with label `"✨ Auto (AI decides)"` at the top of the dropdown list.
- When `__auto__` is selected, show a hint: *"AI will choose an existing folder or suggest a new one."*
- The option must always be the first item (above `(Root)` and feature folders).
- Persist the last-used selection (already done for other controls via `saveLastUsedAIModel`-style helpers — add a similar `saveLastUsedLocation` / `loadLastUsedLocation`).

**No changes to the submit message shape** — the webview already sends `location: taskLocationSelect.value`, so `__auto__` flows through as a string naturally.

---

### 2. Types — Handle `__auto__` sentinel (`types.ts`)

**Where:** `AITaskCreationOptions` → `createOptions.location` (and `fromFeatureOptions.location`).

**Change:**
- Export a constant: `export const AUTO_FOLDER_SENTINEL = '__auto__';`
- No type change needed — it's still `string`.

---

### 3. Backend — Inject folder context into prompt (`ai-task-commands.ts`)

**Where:** `executeAITaskCreation`, right after location is extracted (line ~215-248).

**Change — detect auto mode:**
```ts
const isAutoFolder = location === AUTO_FOLDER_SENTINEL;
```

**Change — build folder list for prompt injection:**
When `isAutoFolder`, call `taskManager.getFeatureFolders()` to get existing folders:
```ts
const existingFolders = (await taskManager.getFeatureFolders()).map(f => f.relativePath);
```

Pass `tasksFolder` (root) as `targetFolderPath` to the prompt builder, along with the folder list. The AI will pick or create a subfolder and write directly there — no parsing needed from our side.

**Change — `parseCreatedFilePath` base path:**
In auto mode, pass the tasks root as the search base (instead of a specific subfolder). `parseCreatedFilePath` already scans for the file the AI created, so it will find it wherever the AI placed it.

---

### 4. Prompt builders — Accept optional folder hint parameter (`ai-task-commands.ts`)

**Where:** `buildCreateTaskPromptWithName` and `buildCreateFromFeaturePrompt` (lines 962, 1013).

**Change:** Add optional param `autoFolderContext?: { existingFolders: string[] }`. When present, replace the fixed `targetPath` output instruction with:

```
**FOLDER SELECTION (Auto mode)**
Tasks root: <tasksRoot>
Existing feature folders: coc, deep-wiki, tasks-viewer
- Pick the most relevant existing folder, OR create a new one (kebab-case, max 3 words).
- Create the folder if it doesn't exist.
- Save the file directly under <tasksRoot>/<chosen-folder>/<filename>.plan.md
```

The AI already knows how to `mkdir` and write files — no special output format required from it.

---

### 5. Progress message update

In `executeAITaskCreation`, when `isAutoFolder`, update progress label:
```ts
progress.report({ message: 'AI is selecting folder and generating task...' });
```

---

### 6. Tests (`ai-task-commands.test.ts` or existing test file)

- Unit test `buildCreateTaskPromptWithName` with `autoFolderContext` — verify folder list and folder selection instructions appear, and the fixed-path instruction is replaced.
- Unit test `buildCreateFromFeaturePrompt` with `autoFolderContext` — same.
- No parsing regex tests needed (removed).

---

## Data Flow Summary

```
User selects "✨ Auto (AI decides)"
        │
        ▼
submit message: { location: "__auto__", ... }
        │
        ▼
executeAITaskCreation detects isAutoFolder = true
        │
        ├─ getFeatureFolders() → ["coc", "deep-wiki", ...]
        └─ build prompt with tasks-root + folder list
        │
        ▼
AI decides on folder, creates it if needed, writes file directly
(e.g. creates .vscode/tasks/coc/retry-logic.plan.md)
        │
        ▼
parseCreatedFilePath(response, tasksRoot) → finds the created .md file
Tree refreshes, file opens
```

---

## Files Changed

| File | Nature of change |
|------|-----------------|
| `src/shortcuts/tasks-viewer/ai-task-dialog.ts` | Add `__auto__` option, hint text, persist last selection |
| `src/shortcuts/tasks-viewer/ai-task-commands.ts` | Auto-folder detection, prompt injection, response parsing |
| `src/shortcuts/tasks-viewer/types.ts` | Export `AUTO_FOLDER_SENTINEL` constant |
| Test file for `ai-task-commands` | Unit tests for new prompt builder param + parsing |

---

## Notes / Risks
- **`parseCreatedFilePath` base:** In auto mode it must search from `tasksRoot` (not a specific subfolder). Verify this function handles subdirectories correctly — if it only looks one level deep, it may need a small update.
- **From-Feature mode:** The `featureLocation` dropdown should NOT get the auto option — it reads an existing folder's content, so auto doesn't apply.
- **Preselection persistence:** Store last chosen location key (including `__auto__`) in `ExtensionContext.globalState` to pre-select it next time.
