# Pipeline Detail Page — Tabbed Layout

## Problem

The pipeline detail page currently renders three sections vertically stacked in a single scrollable area:
1. YAML source code (`<pre>` block)
2. Pipeline Flow Preview (collapsible DAG chart via `<PipelineDAGPreview>`)
3. Run History (active + completed tasks via `<PipelineRunHistory>`)

As pipelines grow, the page becomes long and the run history is pushed far below the fold. The user wants to split the content into two tabs so each concern gets full vertical space.

## Proposed Approach

Add a **tab bar** below the header inside `PipelineDetail.tsx` (view mode only). Two tabs:

| Tab | Label | Content |
|-----|-------|---------|
| 1 | **Pipeline** | YAML source code + `<PipelineDAGPreview>` (existing flow preview) |
| 2 | **Run History** | `<PipelineRunHistory>` (existing run history) |

### Design Details

- **Tab bar style**: Reuse the same visual pattern as the repo sub-tabs in `RepoDetail.tsx` — horizontal row of text buttons with an active underline indicator (`h-0.5 bg-[#0078d4]`), sitting below the header and above the content.
- **State**: Local `useState<'pipeline' | 'history'>` defaulting to `'pipeline'`.
- **Edit mode**: When `mode === 'edit'`, tabs are hidden and the textarea fills the content area (same as today).
- **Run History badge**: Show a count badge on the "Run History" tab when there are active (running/queued) tasks, mirroring how `RepoDetail.tsx` shows counts on Queue/Tasks tabs.
- **Each tab gets full height**: The content area (`flex-1 overflow-auto`) renders only the active tab's content, so each tab can use the full available vertical space.

### Visual Wireframe

```
┌─────────────────────────────────────────────────────────┐
│  git-fetch  path  ✅ Valid          ▶ Run  Close  Edit  │  ← Header (unchanged)
├─────────────────────────────────────────────────────────┤
│  [Pipeline]   [Run History (2)]                         │  ← NEW tab bar
├─────────────────────────────────────────────────────────┤
│                                                         │
│  (Tab 1 active → YAML source + DAG preview)             │
│  (Tab 2 active → Run history list + expanded cards)     │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

## Files to Change

| File | Change |
|------|--------|
| `packages/coc/src/server/spa/client/react/repos/PipelineDetail.tsx` | Add tab state, render tab bar, conditionally render tab content |
| `packages/coc/src/server/spa/client/react/repos/PipelineRunHistory.tsx` | Export active-task count (or accept badge count prop) so the tab bar can display it |

No new files needed. No shared Tab component extraction required — follow the inline pattern from `RepoDetail.tsx`.

## Implementation Todos

### 1. Add tab state to `PipelineDetail`
- Add `const [activeTab, setActiveTab] = useState<'pipeline' | 'history'>('pipeline');`
- Only relevant in view mode; edit mode ignores tabs.

### 2. Render tab bar in view mode
- Insert a tab bar `<div>` between the validation-errors section and the content area.
- Two buttons: "Pipeline" and "Run History".
- Style matches `RepoDetail.tsx` sub-tab pattern: `px-3 py-2 text-xs font-medium`, active state with blue text + bottom `h-0.5` indicator bar.
- "Run History" button shows a small badge with active-task count when > 0.

### 3. Conditionally render content by active tab
- When `activeTab === 'pipeline'`: render the `<pre>` YAML block + `<PipelineDAGPreview>`.
- When `activeTab === 'history'`: render `<PipelineRunHistory>`.
- Both wrapped in the existing `flex-1 overflow-auto px-4` container.

### 4. Compute active-task count for badge
- Use the same `useQueue()` + filter logic already in `PipelineRunHistory` to get the active task count.
- Either lift this into `PipelineDetail` directly, or extract a small hook/helper from `PipelineRunHistory.tsx`.
- The simplest approach: duplicate the 3-line filter in `PipelineDetail` since it already has access to `workspaceId` and `pipeline.name`, plus import `useQueue`.

### 5. Update `PipelineRunHistory` layout
- Remove the outer `px-4 pb-4` padding and `mt-4` margin from `<PipelineRunHistory>` header since the parent container now provides padding.
- Or: keep it as-is if visual spacing is acceptable. Minor polish.

### 6. Tests
- Update or add tests in the existing test file for `PipelineDetail` to verify:
  - Tab bar renders with two tabs in view mode.
  - Default tab is "Pipeline" showing YAML + DAG.
  - Clicking "Run History" tab shows run history content.
  - Tab bar is hidden in edit mode.
  - Active-task badge appears when tasks are running.

## Notes

- No routing/URL changes needed — tabs are local UI state within the detail panel.
- The DAG preview collapsible toggle (`expanded` state) is preserved as-is inside the Pipeline tab.
- `refreshKey` prop continues to flow to `<PipelineRunHistory>` unchanged.
