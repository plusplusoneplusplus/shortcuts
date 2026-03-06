---
status: future
---
# Plan: Reveal & Execute Task File from Chat

**Feature:** Jump to Task Stack from AI-Generated File Links in Chat  
**Status:** Draft  
**Location:** CoC SPA Dashboard → Chat Conversation → Tasks Panel

---

## Problem

When the AI generates a `.vscode/tasks/` file during a chat session, the user can:
- ✅ Hover over the file path to see a preview tooltip
- ✅ Click the hidden `↗` button (inside the tooltip) to reveal in the Tasks Panel
- ❌ **Cannot** jump directly to the task's tree position from chat without hovering first
- ❌ **Cannot** execute (queue) the individual task file from the tasks panel reveal view
- ❌ The reveal action is buried — not discoverable at a glance

**User Goal:** See an AI-created task file in chat → one-click to task stack → execute it.

---

## Current Architecture

### File Link Rendering (SPA)
- `packages/coc/src/server/spa/client/react/shared/file-path-utils.ts`  
  `linkifyFilePaths()` wraps any file path in chat HTML into `<span class="file-path-link">` spans.
- `packages/coc/src/server/spa/client/react/file-path-preview.ts`  
  Global hover handler: 250ms delay → fetches preview → shows tooltip with `file-preview-goto-btn` (↗) only for `.vscode/tasks/` files.
- Click on ↗ fires `CustomEvent('coc-reveal-in-panel', { filePath })`.

### Tasks Panel Navigation
- `packages/coc/src/server/spa/client/react/` — `TasksPanel.tsx`  
  Listens for `coc-reveal-in-panel` → sets `navigateToFilePath` state → scrolls/highlights file.  
  Folder-level **"Queue All Tasks"** exists via `queueDispatch({ type: 'OPEN_DIALOG', folderPath })`.  
  No single-file execution action exposed during navigation.

---

## Proposed Solution

### Improvement 1 — Inline "Open in Tasks" Action Button in Chat
**Where:** `file-path-preview.ts` or `ConversationTurnBubble.tsx`

For every `.vscode/tasks/` file path rendered in a chat message, append a small inline action button **directly on the file path span** (visible without hover), e.g.:

```
📄 .vscode/tasks/coc-chat-minimap/ux-spec.md  [↗ Open in Tasks]
```

- The `[↗ Open in Tasks]` button is always visible (not tooltip-only).
- Clicking it fires the existing `coc-reveal-in-panel` event + switches the side panel to Tasks tab.
- This replaces the current buried tooltip button as the primary affordance.

**Files to change:**
- `file-path-preview.ts` — expose the goto action outside tooltip
- OR `ConversationTurnBubble.tsx` — post-process `.file-path-link` spans for task files to append action button

---

### Improvement 2 — Auto-Switch to Tasks Panel Tab on Reveal
**Where:** `App.tsx` or the panel tab controller

Currently, `coc-reveal-in-panel` reveals the file inside the Tasks Panel — but the Tasks Panel tab may not be visible/active. When this event fires:
1. Auto-switch the side panel to the **Tasks** tab.
2. Expand folder tree to the file's location.
3. Scroll to and highlight the file row.

**Files to change:**
- `App.tsx` — handle `coc-reveal-in-panel` to also set active panel tab
- `TasksPanel.tsx` — ensure `navigateToFilePath` triggers tree expansion, not just scroll

---

### Improvement 3 — Single-File Execute Action in Tasks Panel (Reveal Context)
**Where:** `TasksPanel.tsx` task file row

When a file is navigated-to via `navigateToFilePath`, show a prominent **"Queue This File"** action on the highlighted file row:

```
[📄 ux-spec.md]   [▶ Queue]  [👁 Preview]
```

- "Queue" button calls the existing queue dispatch with the single file path.
- This allows immediate execution of the AI-created file without navigating to its folder.

**Files to change:**
- `TasksPanel.tsx` — add per-file action buttons in the file row when selected/navigated
- Extend `queueDispatch` to support single-file mode if not already supported

---

### Improvement 4 — Follow-up Prompt Context (Optional Enhancement)
**Where:** Chat input area / follow-up prompt

After clicking "Open in Tasks", pre-populate the follow-up prompt with a suggestion:

```
Follow up: Execute the task at .vscode/tasks/coc-chat-minimap/ux-spec.md
```

This connects the "view" action to the "act" action in one flow.

**Files to change:**
- `App.tsx` or follow-up prompt component — accept a context payload from `coc-reveal-in-panel`

---

## Implementation Sequence

1. **Improvement 1** — Inline action button on task file paths in chat (highest impact, lowest risk)
2. **Improvement 2** — Auto-switch panel tab on reveal (UX polish, no logic change)
3. **Improvement 3** — Single-file Queue action in tasks panel (requires queue logic extension)
4. **Improvement 4** — Follow-up prompt context seeding (optional, deferred)

---

## Key Files

| File | Role |
|------|------|
| `packages/coc/src/server/spa/client/react/file-path-preview.ts` | Tooltip + goto-btn logic |
| `packages/coc/src/server/spa/client/react/shared/file-path-utils.ts` | Path linkification |
| `packages/coc/src/server/spa/client/react/processes/ConversationTurnBubble.tsx` | Chat message rendering |
| `packages/coc/src/server/spa/client/react/TasksPanel.tsx` | Tasks panel + navigation handler |
| `packages/coc/src/server/spa/client/react/App.tsx` | Panel tab control, event hub |

---

## Non-Goals

- No changes to VS Code extension's native tasks-viewer tree (the SPA is the interaction surface here)
- No changes to the AI pipeline execution engine
- No changes to how `.vscode/tasks/` files are created
