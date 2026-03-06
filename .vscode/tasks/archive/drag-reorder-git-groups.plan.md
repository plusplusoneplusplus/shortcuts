# Allow Drag to Change Git Group Order

## Problem

The Repositories panel in the CoC dashboard lists git repository groups in a fixed order. Users have no way to reorder them — they must remove and re-add groups to change the display order. A drag-and-drop reorder UX would let users arrange groups to match their workflow.

## Acceptance Criteria

- [x] Users can drag a repository group row to a new position in the Repositories list.
- [x] A visual drop indicator (line or highlight) shows where the dragged item will land.
- [x] The new order persists after page reload (stored in server-side preferences or the process store).
- [x] Order is preserved across `coc serve` restarts.
- [x] Reordering does not disrupt any running processes associated with the groups.
- [ ] Works on both desktop and touch/mobile viewports.

## Subtasks

### 1. Investigate current data model
- Locate where repository groups are stored (likely `~/.coc/preferences.json` or similar).
- Confirm whether groups already carry an explicit `order` field or rely on insertion order.
- Files: `packages/coc-server/src/`, `packages/coc-server/src/preferences*`.

### 2. Add order persistence to the data model
- If no `order` field exists, add one (integer index) to the repository group schema.
- Expose a `PATCH /api/repositories/order` (or equivalent) endpoint that accepts a new ordered array of group IDs.
- Files: server API handler, preferences store.

### 3. Implement drag-and-drop in the SPA
- Add drag-and-drop support to the Repositories list component in the dashboard SPA.
- Use the HTML5 Drag and Drop API (no heavy library needed) or a lightweight helper already in use.
- Show a drop-indicator line between rows while dragging.
- On drop, call the reorder API endpoint and optimistically update local state.
- Files: `packages/coc-server/src/spa/` (or equivalent SPA source).

### 4. Handle edge cases
- Disable drag on mobile if touch events conflict; provide a fallback (e.g., up/down buttons).
- Gracefully handle API failure: revert optimistic update and show an error toast.
- Ensure keyboard accessibility (arrow keys to reorder for a11y).

### 5. Tests
- Unit test: reorder API endpoint returns updated order and persists correctly.
- Integration test: SPA reorder action calls the API and re-renders the list.

## Notes

- The image shows three repository groups: `plusplusoneplusplus/shortcuts`, `facebook/rocksdb`, `apple/foundationdb`. Drag handles (⠿ icon) should appear on hover to keep the UI clean.
- Keep drag handle visually subtle (left-side gripper icon) consistent with CoC's minimal UI style.
- Confirm whether "git group" maps to a single repository entry or a logical group of repos; if groups can contain multiple repos, only top-level group ordering is in scope here.
