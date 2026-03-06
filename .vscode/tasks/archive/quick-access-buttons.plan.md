# Move Quick Access Button to Repo Header

## Problem
The "✨ Generate task with AI" button is currently buried inside the Tasks tab toolbar. The user wants this as a quick-access button at the top of the repo detail view (near the repo name) so it's always visible regardless of which sub-tab is active.

## Approach
Add a **quick-action button** to the `RepoDetail` header area, between the tab bar and the content area (or inline with the repo name). This button will be visible on all sub-tabs and will:
1. Auto-switch to the Tasks tab when clicked (if not already there)
2. Trigger the same dialog/action as the existing toolbar button

### Current Layout
```
┌─────────────────────────────────────────┐
│ ● shortcuts              [Edit] [Remove]│  ← Header
├─────────────────────────────────────────┤
│ Info | Pipelines | Tasks | Queue | ...  │  ← Tab bar
├─────────────────────────────────────────┤
│ [+New Task] [+New Folder] [✨Generate]  │  ← Only visible on Tasks tab
│ ┌─────────┐ ┌──────────────────────────┐│
│ │TaskTree  │ │ TaskPreview              ││
│ └─────────┘ └──────────────────────────┘│
└─────────────────────────────────────────┘
```

### Proposed Layout
```
┌─────────────────────────────────────────┐
│ ● shortcuts              [✨Gen] [Edit] │  ← Header with quick action
├─────────────────────────────────────────┤
│ Info | Pipelines | Tasks | Queue | ...  │  ← Tab bar
├─────────────────────────────────────────┤
│ [+New Task] [+New Folder] [Copy path]   │  ← Remaining toolbar (Tasks tab)
│ [Open] [☑ Context files]               │
│ ┌─────────┐ ┌──────────────────────────┐│
│ │TaskTree  │ │ TaskPreview              ││
│ └─────────┘ └──────────────────────────┘│
└─────────────────────────────────────────┘
```

## Todos

1. **lift-generate-dialog-state** — Lift `generateDialog` state and `GenerateTaskDialog` rendering from `TasksPanel` up to `RepoDetail`, so the dialog can be triggered from the header. Pass a callback down to `TasksPanel` so the existing toolbar button still works.

2. **add-quick-action-button** — Add a "✨ Generate task with AI" button to the `RepoDetail` header row (right-aligned, next to Edit/Remove). This button should:
   - Switch to Tasks sub-tab if not already active
   - Open the generate task dialog

3. **remove-duplicate-button** — Remove the "✨ Generate task with AI" button from the `TasksPanel` toolbar to avoid duplication. Keep all other toolbar items (+New Task, +New Folder, Copy path, Open in editor, Context files checkbox, selection/queue controls).

4. **update-tests** — Update any test files that reference the moved button or toolbar structure.

## Design Notes

- The "✨ Generate task with AI" button is simple — it only needs `wsId` and opens a dialog. This can be fully lifted to RepoDetail without complications.

- The "+ New Task" and "+ New Folder" buttons remain in the Tasks tab toolbar as before, since they depend on `tree` (the root TaskFolder loaded inside TasksPanel) and don't need to be promoted.