# Add Per-Repository Preferences Display to Info Tab

## Problem

The Info tab in the CoC SPA dashboard (`RepoInfoTab.tsx`) shows repository metadata and recent processes, but has unused space below the process list. Per-repository preferences were recently migrated to a per-repo structure (`GET /api/workspaces/:id/preferences`) but are not surfaced anywhere in the UI. Users should be able to see (and potentially edit) their per-repo preferences directly from the Info tab.

## Approach

Add a **Preferences** section to `RepoInfoTab.tsx` below the "Recent Processes" section. Fetch per-repo preferences from the existing API endpoint and display them in a read-friendly format. Provide inline editing for key preferences (model, depth, effort, skill).

## Acceptance Criteria

1. A "Preferences" section appears on the Info tab below "Recent Processes"
2. Displays current per-repo preference values: last model, last depth, last effort, last skill
3. Shows "No preferences set" when all values are empty/undefined
4. Preferences are fetched from `GET /api/workspaces/:id/preferences` on tab load
5. Values are displayed as read-only labels (matching the existing MetaRow pattern)
6. Optionally: inline editing via dropdowns/inputs that PATCH the preference back to the API
7. Loading and error states are handled gracefully

## Subtasks

1. **Fetch preferences in RepoInfoTab** — Add a `useEffect` + `useState` to call `GET /api/workspaces/${ws.id}/preferences` and store the result as `PerRepoPreferences`.

2. **Render Preferences section** — Below "Recent Processes", add a new `<div>` section with heading "Preferences" and `MetaRow` entries for:
   - Model (`lastModel` — display name or "default")
   - Depth (`lastDepth` — "deep" / "normal" or "default")
   - Effort (`lastEffort` — "low" / "medium" / "high" or "default")
   - Skill (`lastSkill` — name or "none")
   - Recent Follow Prompts count (`recentFollowPrompts?.length` or 0)

3. **Handle empty state** — If no preferences exist (all undefined), show a subtle "No preferences set" message.

4. **Add tests** — Unit tests for the new preferences rendering (empty state, populated state, loading state).

## Notes

- The API endpoint `GET /api/workspaces/:id/preferences` already exists in `packages/coc/src/server/preferences-handler.ts`.
- `pinnedChats` and `archivedChats` are internal bookkeeping and probably don't need to be displayed.
- The `MetaRow` helper in `RepoInfoTab.tsx` can be reused directly for label/value display.
- Future enhancement: make preferences editable inline (dropdown for model/depth/effort, PATCH on change).
- The red-bordered empty area in the screenshot is where this section should appear.
