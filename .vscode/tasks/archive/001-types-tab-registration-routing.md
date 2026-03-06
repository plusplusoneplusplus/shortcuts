---
status: pending
---

# 001: Types, Tab Registration & Routing

## Summary

Add the `wiki` sub-tab to the CoC SPA repo detail view. This commit extends the `RepoSubTab` type union, registers the Wiki tab in the `SUB_TABS` array, adds `'wiki'` to `VALID_REPO_SUB_TABS`, parses `#repos/{id}/wiki` routes, and adds the `W` keyboard shortcut. No tab content rendering — that comes in commit 002.

## Motivation

The Wiki feature needs a navigable tab in the repo detail view before any wiki UI can be built. This foundational commit makes the tab button visible, URL-addressable, and keyboard-accessible, following the exact patterns established by existing tabs (Chat, Queue, Pipelines).

## Changes

### Files to Create

_None._

### Files to Modify

1. **`packages/coc/src/server/spa/client/react/types/dashboard.ts`** (line 6)
   - Add `| 'wiki'` to the `RepoSubTab` type union:
     ```typescript
     export type RepoSubTab = 'info' | 'pipelines' | 'tasks' | 'queue' | 'schedules' | 'chat' | 'git' | 'wiki';
     ```

2. **`packages/coc/src/server/spa/client/react/repos/RepoDetail.tsx`** (lines 30–38)
   - Append `{ key: 'wiki', label: 'Wiki' }` as the last entry in the `SUB_TABS` array:
     ```typescript
     export const SUB_TABS: { key: RepoSubTab; label: string }[] = [
         { key: 'info', label: 'Info' },
         { key: 'git', label: 'Git' },
         { key: 'pipelines', label: 'Pipelines' },
         { key: 'tasks', label: 'Tasks' },
         { key: 'queue', label: 'Queue' },
         { key: 'schedules', label: 'Schedules' },
         { key: 'chat', label: 'Chat' },
         { key: 'wiki', label: 'Wiki' },
     ];
     ```

3. **`packages/coc/src/server/spa/client/react/layout/Router.tsx`** (line 105)
   - Add `'wiki'` to `VALID_REPO_SUB_TABS`:
     ```typescript
     export const VALID_REPO_SUB_TABS: Set<string> = new Set(['info', 'pipelines', 'tasks', 'queue', 'schedules', 'chat', 'wiki']);
     ```
   - Note: `'git'` is intentionally absent from this set (it was added to `SUB_TABS` but never to `VALID_REPO_SUB_TABS`). Do not add `'git'` here — only add `'wiki'`.

4. **`packages/coc/src/server/spa/client/react/layout/Router.tsx`** (lines 151–180, repo deep-link parsing)
   - In the repo deep-link parsing block, add a case for the `wiki` sub-path. Follow the same pattern used by `pipelines`, `queue`, and `chat`:
     ```typescript
     } else if (sub === 'wiki') {
         dispatch({ type: 'SET_REPO_SUB_TAB', tab: 'wiki' });
     }
     ```
   - Only handle the base `#repos/{id}/wiki` route in this commit. Deeper wiki routes (`#repos/{id}/wiki/{wikiId}/browse|ask|graph|admin|component/{cId}`) will be added in commit 004.

5. **`packages/coc/src/server/spa/client/react/layout/Router.tsx`** (lines 202–216, keyboard shortcuts)
   - Add a `useEffect` block for the `W` keyboard shortcut, mirroring the existing `C` → Chat pattern:
     ```typescript
     useEffect(() => {
         const handler = (e: KeyboardEvent) => {
             const target = e.target as HTMLElement;
             if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return;
             if (e.ctrlKey || e.metaKey || e.altKey) return;
             if (state.activeTab !== 'repos' || !state.selectedRepoId) return;
             if (e.key === 'w' || e.key === 'W') {
                 dispatch({ type: 'SET_REPO_SUB_TAB', tab: 'wiki' });
                 location.hash = '#repos/' + encodeURIComponent(state.selectedRepoId) + '/wiki';
             }
         };
         document.addEventListener('keydown', handler);
         return () => document.removeEventListener('keydown', handler);
     }, [dispatch, state.activeTab, state.selectedRepoId]);
     ```
   - Alternative: extend the existing Chat keyboard handler to also check `'w'`/`'W'`. Prefer a separate `useEffect` block for clarity and to match the existing pattern.

### Files to Delete

_None._

## Implementation Notes

- **Pattern conformance:** Every change mirrors an existing tab's pattern exactly. The Chat tab is the closest analog for keyboard shortcuts; Pipelines/Queue/Chat are the analogs for deep-link parsing.
- **No tab content rendering:** `RepoDetail.tsx` lines 179–192 contain the sub-tab content switch. Do NOT add a `wiki` case there in this commit — that is commit 002's responsibility. When the wiki tab is selected, it will simply render nothing (fall through to default).
- **`VALID_REPO_SUB_TABS` vs `SUB_TABS`:** These serve different purposes. `VALID_REPO_SUB_TABS` gates URL-based navigation (hash parsing); `SUB_TABS` drives the rendered tab bar. Both must include `'wiki'`.
- **`'git'` anomaly:** `'git'` is in `SUB_TABS` but not in `VALID_REPO_SUB_TABS`. This means `#repos/{id}/git` does not deep-link. This is pre-existing behavior — do not fix it in this commit.
- **Keyboard shortcut guard conditions:** The handler must check `state.activeTab !== 'repos'` and `!state.selectedRepoId` to avoid firing when not in repo detail view, and must skip when the user is typing in an input/textarea/contenteditable.

## Tests

Update **`packages/coc/test/spa/react/Router.test.ts`**:

1. **`VALID_REPO_SUB_TABS` includes 'wiki':**
   ```typescript
   it('should include wiki in VALID_REPO_SUB_TABS', () => {
       expect(VALID_REPO_SUB_TABS.has('wiki')).toBe(true);
   });
   ```

2. **Hash route `#repos/{id}/wiki` sets sub-tab to 'wiki':**
   - Set `location.hash = '#repos/my-repo/wiki'` and trigger the `hashchange` event.
   - Assert that `dispatch` was called with `{ type: 'SET_REPO_SUB_TAB', tab: 'wiki' }`.
   - Follow the same test pattern used for `#repos/{id}/chat` or `#repos/{id}/pipelines` route tests.

3. **`W` keyboard shortcut navigates to wiki tab:**
   - Set state to `{ activeTab: 'repos', selectedRepoId: 'my-repo' }`.
   - Dispatch a `keydown` event with `key: 'W'`.
   - Assert `dispatch` was called with `{ type: 'SET_REPO_SUB_TAB', tab: 'wiki' }`.
   - Assert `location.hash` contains `/wiki`.
   - Also test lowercase `'w'`.

4. **`W` shortcut does NOT fire in input fields:**
   - Focus an `<input>` element, dispatch `keydown` with `key: 'W'`.
   - Assert `dispatch` was NOT called.

5. **`W` shortcut does NOT fire with modifier keys:**
   - Dispatch `keydown` with `key: 'W'` and `ctrlKey: true`.
   - Assert `dispatch` was NOT called.

Update **`packages/coc/test/spa/react/RepoDetail.test.ts`**:

6. **`SUB_TABS` includes wiki entry:**
   ```typescript
   it('should include wiki in SUB_TABS', () => {
       const wikiTab = SUB_TABS.find(t => t.key === 'wiki');
       expect(wikiTab).toBeDefined();
       expect(wikiTab!.label).toBe('Wiki');
   });
   ```

7. **Wiki tab is last in `SUB_TABS`:**
   ```typescript
   it('should have wiki as the last tab', () => {
       expect(SUB_TABS[SUB_TABS.length - 1].key).toBe('wiki');
   });
   ```

## Acceptance Criteria

- [ ] `RepoSubTab` type includes `'wiki'` — TypeScript compilation passes with no errors.
- [ ] Wiki tab button appears in the repo detail tab bar as the rightmost tab with label "Wiki".
- [ ] Navigating to `#repos/{id}/wiki` selects the wiki sub-tab.
- [ ] Pressing `W` or `w` (without modifier keys, outside input fields) while viewing a repo switches to the wiki tab and updates the URL hash.
- [ ] `VALID_REPO_SUB_TABS.has('wiki')` returns `true`.
- [ ] All existing Router and RepoDetail tests continue to pass.
- [ ] New tests for wiki routing, keyboard shortcut, and tab registration pass.
- [ ] No tab content is rendered for wiki yet (empty/default pane is expected).

## Dependencies

_None._ This is the foundational commit — all subsequent wiki commits depend on this one.

## Assumed Prior State

- `RepoSubTab` type exists at `packages/coc/src/server/spa/client/react/types/dashboard.ts` line 6 with values: `'info' | 'pipelines' | 'tasks' | 'queue' | 'schedules' | 'chat' | 'git'`.
- `SUB_TABS` array exists at `packages/coc/src/server/spa/client/react/repos/RepoDetail.tsx` lines 30–38 with 7 entries (info through chat).
- `VALID_REPO_SUB_TABS` exists at `packages/coc/src/server/spa/client/react/layout/Router.tsx` line 105 with 6 entries (no 'git', no 'wiki').
- Keyboard shortcut `useEffect` for `C` → Chat exists at Router.tsx lines 202–216.
- Repo deep-link parsing exists at Router.tsx lines 151–180 handling pipelines, queue, and chat.
- Router and RepoDetail test files exist at `packages/coc/test/spa/react/`.
