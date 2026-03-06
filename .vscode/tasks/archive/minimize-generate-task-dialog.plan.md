# Minimize / Restore Generate Task Dialog

## Problem

The "Generate Task" dialog in the CoC SPA dashboard is a full modal overlay. When the user wants to reference other content (tasks, queue, pipelines) while composing a task, they must close the dialog and lose all their in-progress form state. We need a minimize capability that collapses the dialog into a small floating pill/chip at the bottom of the screen, preserving all form state, and allows restoring it to the full modal with a single click.

## Approach

Lift the dialog state out of the `GenerateTaskDialog` component so it persists across minimize/restore cycles. Add a `minimized` state to the existing `generateDialog` state object in `RepoDetail.tsx`. When minimized, render a small floating pill (portal to `document.body`) instead of the full modal. Clicking the pill restores the full dialog with all form fields intact.

### Key Design Decisions

- **State preservation**: All form fields (prompt, name, targetFolder, model, priority, depth, includeContext, images) are owned by `GenerateTaskDialog` via `useState`. Since we keep the component mounted (just hidden or swapped to pill view), state is automatically preserved. No need to lift state.
- **Minimize trigger**: Add a minimize button (▬ or ─) in the dialog header, next to the existing × close button.
- **Minimized view**: A small fixed-position pill at the bottom-right of the viewport showing "✨ Generate Task" with a restore button. Portal-rendered at z-index consistent with existing patterns (z-[10001] — below the dialog overlay's 10002).
- **Keyboard**: Escape while dialog is open → minimize (not close). The × button and "Close" button still fully close and discard state.
- **No backdrop when minimized**: The dark overlay is removed when minimized so the user can interact with the rest of the UI.

## Files to Change

| File | Change |
|------|--------|
| `packages/coc/src/server/spa/client/react/repos/RepoDetail.tsx` | Add `minimized` boolean to `generateDialog` state; pass `onMinimize`/`minimized` props to `GenerateTaskDialog`; render minimized pill when `generateDialog.open && generateDialog.minimized` |
| `packages/coc/src/server/spa/client/react/tasks/GenerateTaskDialog.tsx` | Accept `onMinimize` prop; add minimize button in header; when minimized render a floating pill instead of full dialog |
| `packages/coc/src/server/spa/client/react/shared/Dialog.tsx` | Add optional `onMinimize` prop; render minimize button in header when provided |

## Todos

1. [x] **dialog-minimize-prop** — Update `Dialog.tsx` to accept an optional `onMinimize` callback; when present, render a minimize button (▬) in the dialog header next to the title.
2. [x] **generate-dialog-state** — Update `RepoDetail.tsx` to add `minimized: boolean` to the `generateDialog` state object. Pass `onMinimize` handler to `GenerateTaskDialog`. Always mount the component when `open` is true (regardless of minimized), so React state is preserved.
3. [x] **generate-dialog-minimize-ui** — Update `GenerateTaskDialog.tsx`: accept `onMinimize` and `minimized` props. When `minimized=true`, render a small floating pill (fixed bottom-right, portal) instead of the full `<Dialog>`. The pill shows "✨ Generate Task" plus a preview of the prompt (truncated). Clicking the pill calls `onRestore`. When `minimized=false`, render the existing full dialog, passing `onMinimize` through to `<Dialog>`.
4. [x] **escape-key-behavior** — Change Escape key behavior: when the dialog is open (not minimized), Escape minimizes instead of closing. The × button and "Close" button still fully close.
5. [x] **generate-button-badge** — When the dialog is minimized, show a small indicator dot on the "✨ Generate" button in the repo header to signal there's a minimized draft in progress.
6. [x] **tests** — Add/update tests for minimize/restore round-trip, state preservation, escape-key behavior, and pill rendering.

## UX Details

### Minimized Pill
```
┌──────────────────────────────┐
│ ✨ Generate Task  ▪ "Fix th…" │  ← fixed bottom-right, rounded, shadow
│                    [Restore] │
└──────────────────────────────┘
```
- Position: `fixed bottom-4 right-4`
- Z-index: `z-[10001]` (below dialog overlay but above page content)
- Dark mode aware with existing color tokens
- Subtle shadow + border matching existing dialogs
- Shows truncated prompt text (first ~30 chars) as context hint
- Click anywhere on pill → restore full dialog

### Full Dialog Changes
- Minimize button (▬) positioned at `top-3 right-10` (left of existing × at `top-3 right-3`)
- Tooltip: "Minimize (Esc)"

### Keyboard Shortcuts
| Key | Context | Action |
|-----|---------|--------|
| Escape | Full dialog open | Minimize |
| Escape | Focus on pill (minimized) | Close/discard |
| Ctrl+Enter | Full dialog open | Submit (unchanged) |

## Non-Goals

- Drag-to-resize or drag-to-reposition the minimized pill
- Multiple concurrent minimized dialogs
- Persisting minimized state across page reloads (the dialog is ephemeral)
