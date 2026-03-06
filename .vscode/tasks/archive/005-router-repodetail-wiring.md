---
status: pending
---

# 005: Router & RepoDetail Wiki Tab Wiring

## Summary
Wire the Wiki tab into the repo detail page's SUB_TABS array and the router's VALID_REPO_SUB_TABS set, adding deep-link parsing for `#repos/{wsId}/wiki` hashes so the wiki sub-tab is navigable and bookmarkable.

## Motivation
Commits 2–4 built the visual components (WikiDetail embedded mode, LinkWikiPanel, RepoWikiTab) but none of them are reachable yet — RepoDetail doesn't list a "Wiki" tab and the router doesn't recognise `wiki` as a valid repo sub-tab. This commit is the integration seam that makes the feature visible and navigable. It is separated from commit 4 (which created RepoWikiTab) to keep component creation and wiring as distinct, reviewable units.

## Changes

### Files to Create
- (none)

### Files to Modify

- **`packages/coc/src/server/spa/client/react/types/dashboard.ts`** — Verify `'wiki'` already exists in `RepoSubTab` (added in commit 4). **No edit needed** — this is a verification step only.

- **`packages/coc/src/server/spa/client/react/repos/RepoDetail.tsx`** — Three changes:
  1. **Import** `RepoWikiTab` from `'./RepoWikiTab'` (new import after the `RepoChatTab` import, line 14).
  2. **SUB_TABS array** (line 29–36): Append `{ key: 'wiki', label: 'Wiki' }` after the `chat` entry, making it the new last tab (7 entries total).
  3. **Tab content switch** (line 137–148): Inside the `<div className="h-full overflow-y-auto …">` block, add a new conditional render after the `chat` line:
     ```tsx
     {activeSubTab === 'wiki' && <RepoWikiTab workspaceId={ws.id} rootPath={ws.rootPath} />}
     ```
     This follows the exact same pattern as the other tab content entries (info, pipelines, queue, schedules, chat). The wiki tab does **not** need the TasksPanel special-case wrapper since it manages its own scrolling.

- **`packages/coc/src/server/spa/client/react/layout/Router.tsx`** — Two changes:
  1. **VALID_REPO_SUB_TABS** (line 105): Add `'wiki'` to the Set constructor, making it 7 entries: `new Set(['info', 'pipelines', 'tasks', 'queue', 'schedules', 'chat', 'wiki'])`.
  2. **handleHash repo deep-link block** (lines 151–180): After the existing chat deep-link handling block (lines 175–179), add a parallel wiki block. The wiki sub-tab doesn't need additional deep-link state beyond `SET_REPO_SUB_TAB` because RepoWikiTab reads its own sub-navigation from the hash internally. However, if the hash has the form `#repos/{wsId}/wiki/{wikiSubPath}`, the router should still set `wiki` as the active sub-tab. The minimal addition:
     ```ts
     // Wiki sub-tab: no extra dispatch needed — RepoWikiTab parses sub-state from hash
     // (VALID_REPO_SUB_TABS.has('wiki') already handles SET_REPO_SUB_TAB dispatch)
     ```
     Since `'wiki'` is now in `VALID_REPO_SUB_TABS`, the existing generic code at line 157–158 (`if (parts.length >= 3 && VALID_REPO_SUB_TABS.has(parts[2]))`) will automatically dispatch `SET_REPO_SUB_TAB` with `'wiki'`. No explicit wiki-specific block is required unless we want to parse deeper sub-paths (component IDs, etc.) — leave that to RepoWikiTab via `location.hash` reading.

- **`packages/coc/test/spa/react/RepoDetail.test.ts`** — Update 4 existing assertions + add new ones:
  1. `'has exactly 6 entries'` → `'has exactly 7 entries'` (line 27–28: `toHaveLength(6)` → `toHaveLength(7)`).
  2. `'contains all expected sub-tabs in order'` (line 31–33): Append `'wiki'` to the expected array: `['info', 'pipelines', 'tasks', 'queue', 'schedules', 'chat', 'wiki']`.
  3. `'"chat" is the last entry'` (line 22–24): Change to `'"wiki" is the last entry'` — update `last.key` expectation from `'chat'` to `'wiki'`.
  4. Add new test: `'includes a "wiki" entry'` that mirrors the existing `'includes a "chat" entry'` test — finds SUB_TABS entry with key `'wiki'`, asserts label is `'Wiki'`.
  5. Add source-inspection test: `'renders RepoWikiTab when activeSubTab is wiki'` — verify `REPO_DETAIL_SOURCE` contains `activeSubTab === 'wiki'` and `<RepoWikiTab`.
  6. Add source-inspection test: `'passes ws.rootPath to RepoWikiTab'` — verify `REPO_DETAIL_SOURCE` contains `rootPath={ws.rootPath}`.

- **`packages/coc/test/spa/react/Router.test.ts`** — Update 1 existing assertion + add new ones:
  1. `'has exactly 6 entries'` (line 109–110): Change `toBe(6)` → `toBe(7)`.
  2. Add: `'includes "wiki"'` — `expect(VALID_REPO_SUB_TABS.has('wiki')).toBe(true)`.
  3. Add to `'repo sub-tab deep-link parsing'` describe block: `'parses #repos/my-repo/wiki correctly'` — assert `repoId` is `'my-repo'` and `subTab` is `'wiki'`.
  4. Add: `'parses #repos/my-repo/wiki/browse correctly as wiki sub-tab'` — assert `subTab` is `'wiki'` (deeper path segments are ignored by the generic parser; RepoWikiTab handles them).
  5. Add to `'tabFromHash'` describe block: `'returns "repos" for #repos/some-id/wiki'` — mirrors existing tests for other sub-tabs.

### Files to Delete
- (none)

## Implementation Notes

1. **Tab ordering convention**: New tabs are appended to the end of `SUB_TABS`. Wiki goes after Chat, becoming the 7th and last tab. This matches the pattern where Chat was the most recent addition.

2. **No wiki-specific deep-link dispatch needed in Router**: The generic `VALID_REPO_SUB_TABS.has(parts[2])` check + `SET_REPO_SUB_TAB` dispatch already handles `#repos/{wsId}/wiki`. RepoWikiTab is responsible for reading deeper hash segments (`wiki/browse`, `wiki/component/{id}`) via `location.hash` — this keeps the Router lean and avoids coupling it to wiki-internal navigation state.

3. **Wiki status badge (optional, deferred)**: The task description mentions an optional wiki status badge (✓ loaded / ⚠ pending). This requires reading `state.wikis` to check if a wiki is linked to the workspace. Defer this to a follow-up or commit 6 to keep this commit focused on structural wiring. The badge can be added with the same pattern as the queue/chat badges in the `SUB_TABS.map()` render loop.

4. **RepoWikiTab props**: Pass `workspaceId={ws.id}` and `rootPath={ws.rootPath}`, matching the pattern used by RepoChatTab and RepoSchedulesTab. The component was created in commit 4 with these props.

5. **Type safety**: Commit 4 already added `'wiki'` to `RepoSubTab` in `dashboard.ts`. This commit only verifies it's present (via TypeScript compilation) — no edit to that file.

6. **Test source-reading pattern**: RepoDetail.test.ts reads the source file with `fs.readFileSync` and asserts against string contents. New wiki tests should follow this same pattern for consistency.

## Tests

- **RepoDetail.test.ts**: SUB_TABS length updated to 7; ordering array includes `'wiki'` at end; last-entry test checks for `'wiki'`; new `'includes a "wiki" entry'` test; source-inspection tests for `RepoWikiTab` rendering and prop passing.
- **Router.test.ts**: VALID_REPO_SUB_TABS size updated to 7; new `'includes "wiki"'` membership test; deep-link parsing test for `#repos/{id}/wiki`; `tabFromHash` test for wiki sub-tab hash.

## Acceptance Criteria
- [ ] `SUB_TABS` in RepoDetail.tsx has 7 entries, with `'wiki'` as the last
- [ ] `VALID_REPO_SUB_TABS` in Router.tsx has 7 entries including `'wiki'`
- [ ] Navigating to `#repos/{wsId}/wiki` activates the Wiki sub-tab and renders `<RepoWikiTab>`
- [ ] `RepoWikiTab` receives `workspaceId` and `rootPath` props from `ws`
- [ ] All existing RepoDetail tests pass after updating count/ordering expectations
- [ ] All existing Router tests pass after updating VALID_REPO_SUB_TABS size
- [ ] New tests cover wiki entry presence, ordering, deep-link parsing, and source wiring
- [ ] TypeScript compiles with no errors (`npm run compile` passes)
- [ ] `RepoSubTab` type in dashboard.ts includes `'wiki'` (verify or add)

## Dependencies
- Depends on: 004

## Assumed Prior State
- RepoSubTab type includes 'wiki' (commit 4, dashboard.ts)
- RepoWikiTab component exists at repos/RepoWikiTab/ (commit 4)
- WikiDetail has embedded mode (commit 2)
- LinkWikiPanel exists (commit 3)
- PATCH repoPath API exists (commit 1)
