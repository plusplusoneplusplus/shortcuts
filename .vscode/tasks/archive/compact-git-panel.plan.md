# Compact Git Panel — Grouped Layout & Unified History

## Problem

The Git panel in the COC dashboard currently displays five flat, top-level sections in the left panel:

1. **Branch Changes** (feature branch summary)
2. **Staged** (0-N files)
3. **Changes** (0-N files)
4. **Untracked** (0-N files)
5. **Unpushed** (0-N commits)
6. **History** (remaining commits)

On mobile/narrow viewports this produces excessive vertical scrolling — especially when Staged/Changes/Untracked are all empty (3 section headers + 3 "No changes" placeholders consuming ~200px for zero information). The Unpushed section duplicates information that could live in History with visual distinction.

## Proposed Approach

### 1. Group working-tree sections under a single collapsible "Working Changes" group

- Wrap Staged + Changes + Untracked inside one parent-level collapsible section called **"Working Changes"**.
- Show a **combined badge count** (e.g., `Working Changes 3`) on the parent header — sum of staged + unstaged + untracked counts.
- When expanded, show the three sub-sections (Staged, Changes, Untracked) as **nested children** with smaller headers.
- When all counts are zero, the parent shows `0` and is **collapsed by default** — saving ~150px of vertical space.
- When any count > 0, auto-expand the parent (matching current behavior of individual sections).

### 2. Merge Unpushed into History with color-coded status

- **Remove** the separate "Unpushed" `<CommitList>` section entirely.
- **Unify** into a single "History" `<CommitList>` that receives all commits.
- Pass `unpushedCount` into `CommitList` so it can visually distinguish unpushed vs pushed commits:
  - **Unpushed commits**: hash rendered in **orange/amber** (`#f57c00` / `#ffb74d` dark) with a filled dot indicator (`●`), matching the "not yet synced" semantic.
  - **Pushed commits**: hash remains **blue** (`#0078d4` / `#3794ff` dark) with hollow dot (`○`), as currently.
  - A subtle **separator line** with label "↑ N unpushed" between the unpushed and pushed regions acts as a visual divider without being a separate collapsible section.
- This eliminates one section header + the "Nothing to push" empty state, saving ~60px when there are no unpushed commits and reducing visual noise when there are.

### 3. Mobile-first compact tweaks

- Reduce section header vertical padding from `py-2` → `py-1.5` on narrow viewports.
- The `BranchChanges` summary header remains as-is (already compact and information-dense).

## Files to Modify

| File | Changes |
|------|---------|
| `packages/coc/src/server/spa/client/react/repos/WorkingTree.tsx` | Wrap the three `<Section>` components inside a new parent-level collapsible group with combined count badge |
| `packages/coc/src/server/spa/client/react/repos/CommitList.tsx` | Add `unpushedCount` prop; render unpushed commits with orange hash color and filled dot; add inline separator between unpushed/pushed regions |
| `packages/coc/src/server/spa/client/react/repos/RepoGitTab.tsx` | Remove dual `<CommitList>` usage; pass single unified commit list + `unpushedCount` to one `<CommitList>`; no changes to data fetching |

## Todos

### `group-working-changes` — Wrap Staged/Changes/Untracked in collapsible parent group
**WorkingTree.tsx**: Add a parent-level collapsible wrapper around the three Section components.
- New outer `<div>` with a section header button showing "Working Changes" + combined count badge.
- Collapsed state hides all three sub-sections. Expanded shows them as nested.
- Auto-expand when any count > 0. Default collapsed when all are 0.
- Keep all existing per-file actions (stage/unstage/discard/delete) and per-section "± All" buttons intact.

### `merge-unpushed-into-history` — Unify commit list with color-coded unpushed indicator
**CommitList.tsx**: Add optional `unpushedCount` prop (default 0).
- For commits at index `< unpushedCount`: render hash in orange, use filled dot `●`.
- For commits at index `>= unpushedCount`: keep current blue hash, hollow dot `○`.
- When `unpushedCount > 0`, render a thin separator row between the last unpushed and first pushed commit showing "↑ N unpushed".
- Remove `title` from the section header when used in unified mode (optional: keep for backwards compat).

**RepoGitTab.tsx**: Replace the two `<CommitList>` blocks with a single one:
```tsx
<CommitList
  title="History"
  commits={commits}
  unpushedCount={unpushedCount}
  selectedHash={selectedCommit?.hash}
  onSelect={handleSelect}
  onFileSelect={handleCommitFileSelect}
  workspaceId={workspaceId}
/>
```

### `update-tests` — Update/add tests for new layout
- Update any existing CommitList tests that assert on separate "Unpushed" / "History" sections.
- Add test for `unpushedCount` color coding in CommitList.
- Add test for WorkingTree parent group collapse/expand behavior.
- Verify existing staging/unstaging action tests still pass.

## Design Notes

- **No API changes needed** — the backend already returns `commits[]` + `unpushedCount` in a single response. The restructuring is purely frontend.
- **No breaking changes** — CommitList gets a new optional prop; existing callsites (if any outside RepoGitTab) continue to work.
- **Color semantics**: Orange for unpushed aligns with the existing unstage button color (`#f57c00`), creating a consistent "pending/not synced" visual language.
- **Accessibility**: The separator label "↑ N unpushed" provides screen-reader context. The dot indicators (●/○) supplement but don't replace the color distinction.
