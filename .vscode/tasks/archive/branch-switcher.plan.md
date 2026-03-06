# Branch Switcher — Click Branch Name in CoC Git Tab

## Problem

The branch name pill in `GitPanelHeader` (CoC SPA dashboard → Git tab) is a static display
element. Clicking it does nothing. Users have no way to switch branches from within the CoC
web UI. The repo may have **millions of branches**, so any UI must be server-driven with
incremental search rather than loading a full list upfront.

## Proposed Approach

Make the branch pill a button that opens a **modal branch-picker** with:
- A debounced server-side search input (no full list load on open)
- Paginated / infinite-scroll results loaded on demand
- A "Switch" action that calls `POST /git/branches/switch`
- Dirty-state guard (warn if working tree is dirty)

---

## Acceptance Criteria

- [ ] Clicking the branch name pill in the Git tab opens a branch-picker modal/dropdown
- [ ] The picker shows a search box; results are fetched from the server as the user types
  (debounce ≥ 300 ms, minimum 0 chars to show recent/top branches on first open)
- [ ] Results are loaded in pages (≤ 50 per request); additional pages load on scroll or
  "Load more" button — supporting repos with millions of branches without memory issues
- [ ] Current branch is visually indicated (check-mark or highlighted) and excluded from the
  switch target list (or shown with a "you are here" badge)
- [ ] Selecting a branch shows a confirmation step if the working tree is dirty
  (options: stash & switch / force / cancel)
- [ ] Successful switch refreshes the git tab (branch pill, branch-range data, history)
- [ ] Error cases (branch not found, merge conflicts) surface a clear inline error message
- [ ] The picker is keyboard-navigable (arrow keys, Enter to confirm, Esc to dismiss)
- [ ] The existing `GET /api/workspaces/:id/git/branches` endpoint is reused — no new
  server routes needed (it already supports `type`, `limit`, `offset`, `search`)
- [ ] Unit / component tests cover: rendering, search debounce, pagination, switch success,
  switch error, dirty-state guard

---

## Subtasks

### 1 — Make branch pill interactive (`GitPanelHeader.tsx`)
- Change `<span>` → `<button>` for the branch pill (`data-testid="git-branch-pill"`)
- Add `onClick` prop that opens the branch-picker (lifted state or callback from parent)
- Add hover/focus styles (cursor-pointer, ring on focus)

### 2 — Create `BranchPickerModal` component
- File: `packages/coc/src/server/spa/client/react/repos/BranchPickerModal.tsx`
- Props: `workspaceId`, `currentBranch`, `isOpen`, `onClose`, `onSwitched`
- Internal state: `query`, `results`, `page`, `isLoading`, `hasMore`, `error`
- On open: fetch first page with `search=''`, `limit=50`, `offset=0`, `type=local`
- On query change (debounced 300 ms): reset offset, fetch new results
- Infinite scroll / "Load more": append next page to results list
- Virtual list rendering if performance degrades (use a lightweight virtualizer if
  needed — the list should never hold more than ~2 pages in DOM at once for large repos)

### 3 — Implement branch switch flow inside the modal
- On branch select: check if dirty (use cached git-info or call `branch-status`)
- If dirty: show inline dirty-state guard with three options (stash & switch, force, cancel)
- Call `POST /workspaces/:id/git/branches/switch` with `{ name, force }`
- On success: call `onSwitched(newBranch)`, close modal, trigger git-tab refresh
- On error: show error message in-modal (do not close)

### 4 — Wire `BranchPickerModal` into `RepoGitTab`
- Add `branchPickerOpen` state in `RepoGitTab.tsx`
- Pass `onOpen={() => setBranchPickerOpen(true)}` down to `GitPanelHeader`
- Render `<BranchPickerModal … />` at the bottom of `RepoGitTab`
- On `onSwitched`: call `fetchBranchRange(true)` and `fetchHistory(true)` to refresh

### 5 — API: verify `search` param works for large repos
- Inspect `BranchService.getLocalBranchesPaginated` in `pipeline-core`
- Confirm `search` is passed to `git branch --list "*<query>*"` (or equivalent) so
  filtering happens in git, not in memory — critical for million-branch repos
- If search is done in-memory today, fix to delegate to git CLI

### 6 — Tests
- `BranchPickerModal.test.tsx`: render, type to search, load-more, switch success, dirty guard
- `GitPanelHeader.test.tsx`: branch pill is a button, onClick fires
- Update `RepoGitTab.test.tsx` if integration test exists

---

## Notes

- **Scale constraint**: `git branch --list` can be slow on repos with millions of refs.
  Use `git for-each-ref --sort=-creatordate --format ... --count=<limit>` with a
  `--contains` or pattern filter for better performance. Consider surfacing this as a
  follow-up optimization if `BranchService` already uses `for-each-ref`.
- The server already has `limit` (max 500 per page) and `offset` pagination — reuse as-is.
- Keep `type=local` as the default; add a toggle for `remote` / `all` in a follow-up.
- Stash logic can be done client-side by calling the existing
  `POST /git/branches/switch` with `force: false` first; if it fails with a dirty-tree
  error, present the guard options.
- Do **not** block on implementing the dirty-state guard for the first iteration — a simple
  `force: false` call with an error message is acceptable as v1.
