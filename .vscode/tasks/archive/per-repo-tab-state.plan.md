# Per-Repo Tab State Persistence

## Problem

When switching between different repositories in the CoC dashboard, the active tab resets instead of restoring the user's last active tab for that repository. Users want to return to the same tab they were on when they last visited each repo.

## Approach

Keep a client-side in-memory map `repoTabState: Record<repoKey, tabId>` in the SPA's state/store. No server round-trips or persistence to disk. When the active repo changes, look up the stored tab for the incoming repo and activate it. Write to the map whenever the user switches tabs. State is lost on page refresh — that is acceptable.

---

## Acceptance Criteria

- [x] When switching to a different repo, the tab state restores to the last tab the user had open for that repo
- [x] If a repo is visited for the first time, falls back to a sensible default tab (e.g. first tab)
- [x] Tab state is held in SPA memory only (reset on page refresh is acceptable)
- [x] Tab state is scoped per repo (repo A and repo B can each remember a different active tab)
- [x] No regressions to existing tab switching behavior within a single repo session

---

## Subtasks

1. **Investigate current tab state management**
   - Locate where the active tab is tracked in the SPA dashboard (`packages/coc-server/src/`)
   - Understand how the active repo/workspace is identified

2. **Add `repoTabState` map to SPA store**
   - Add a `repoTabState: Record<repoKey, tabId>` map to the relevant Pinia/Vue/React store (client-side only, no API calls)

3. **Persist tab changes in the map**
   - On tab switch, write `repoTabState[currentRepo] = tabId` to the in-memory map

4. **Restore tab on repo switch**
   - When the active repo changes, read `repoTabState[incomingRepo]` and activate that tab
   - If no entry exists, fall back to the default tab

5. **Tests**
   - Unit tests for the store logic: switch repo → verify correct tab restored

---

## Notes

- Pure client-side change — no new API endpoints, no server preferences involvement
- Repo key should be a stable identifier available in the SPA (e.g. repo path or workspace name)
- If the stored tab no longer exists (e.g. tab was removed), fall back gracefully to the default tab
