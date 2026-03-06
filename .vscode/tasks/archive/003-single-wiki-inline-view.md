---
status: pending
---

# 003: Single Wiki Inline View

## Summary

When exactly one wiki matches the workspace's `repoPath`, render its full detail view inline within the repo wiki tab — no intermediate list or selection step. This is State 2 of the repo wiki tab (State 1 = empty, from commit 002). The approach reuses `WikiDetail` directly by adding an `embedded` prop that suppresses the back button and hash-based navigation, keeping the wiki tab self-contained within the repo detail panel.

## Motivation

A repo that has a single wiki should surface the wiki's Browse/Ask/Graph/Admin experience immediately when the user clicks the Wiki tab. Requiring an extra click to select the only available wiki would be needless friction. Embedding `WikiDetail` inline reuses all existing two-pane layout, graph fetching, tab management, and component rendering without duplication.

## Changes

### Files to Create

_None._

### Files to Modify

1. **`packages/coc/src/server/spa/client/react/wiki/WikiDetail.tsx`**

   - Extend `WikiDetailProps` (line 25-27) to accept an optional `embedded` prop:
     ```typescript
     interface WikiDetailProps {
         wikiId: string;
         embedded?: boolean;
     }
     ```
   - Destructure `embedded` in the component signature (line 52):
     ```typescript
     export function WikiDetail({ wikiId, embedded }: WikiDetailProps) {
     ```
   - **Back button (lines 190-194):** Conditionally render the back button only when `!embedded`:
     ```typescript
     {!embedded && (
         <button
             className="text-sm text-[#848484] hover:text-[#1e1e1e] dark:hover:text-[#cccccc]"
             onClick={handleBack}
             title="Back to wiki list"
         >←</button>
     )}
     ```
   - **Hash updates (lines 96-111):** Guard all `location.hash = ...` assignments behind `!embedded` to prevent the wiki detail from clobbering the repo hash route. Apply this to:
     - `changeTab` callback (line 99): wrap `location.hash = buildWikiHash(...)` in `if (!embedded)`
     - `handleAdminTabChange` callback (line 104): wrap `location.hash = buildWikiHash(...)` in `if (!embedded)`
     - `handleSelectComponent` callback (line 109): wrap `location.hash = buildWikiHash(...)` in `if (!embedded)`
   - **`handleBack` callback (lines 91-94):** Guard the dispatch and hash change behind `!embedded`. When embedded, `handleBack` should be a no-op (the back button is hidden anyway, but defensive):
     ```typescript
     const handleBack = useCallback(() => {
         if (embedded) return;
         dispatch({ type: 'SELECT_WIKI', wikiId: null });
         location.hash = '#wiki';
     }, [dispatch, embedded]);
     ```
   - **Initial tab effect (lines 60-71):** Skip consuming `state.wikiDetailInitialTab` when `embedded`, since the embedded context does not use the global initial-tab mechanism:
     ```typescript
     useEffect(() => {
         if (embedded) return;
         if (state.wikiDetailInitialTab) {
             // ...existing logic
         }
     }, [state.wikiDetailInitialTab, embedded]);
     ```

2. **`packages/coc/src/server/spa/client/react/repos/RepoWikiTab.tsx`** _(created in commit 002)_

   Add State 2 rendering. The full component after this commit:
   ```typescript
   import { useMemo } from 'react';
   import { useApp } from '../context/AppContext';
   import { WikiDetail } from '../wiki/WikiDetail';

   interface RepoWikiTabProps {
       repoPath: string;
   }

   export function RepoWikiTab({ repoPath }: RepoWikiTabProps) {
       const { state } = useApp();

       const repoWikis = useMemo(
           () => state.wikis.filter((w: any) => w.repoPath === repoPath),
           [state.wikis, repoPath]
       );

       // State 1: no wikis (empty state from commit 002 — kept as-is)
       if (repoWikis.length === 0) {
           return (
               <div className="flex flex-col items-center justify-center h-full text-center p-8">
                   <div className="text-4xl mb-3">📚</div>
                   <div className="text-sm font-semibold text-[#1e1e1e] dark:text-[#cccccc] mb-1">
                       No Wiki
                   </div>
                   <div className="text-xs text-[#848484] max-w-xs">
                       No wiki has been generated for this repository yet.
                       Use the Wiki tab in the main sidebar to create one.
                   </div>
               </div>
           );
       }

       // State 2: exactly one wiki — render inline
       if (repoWikis.length === 1) {
           return <WikiDetail wikiId={repoWikis[0].id} embedded />;
       }

       // State 3: multiple wikis (commit 004 — placeholder)
       return null;
   }
   ```

3. **`packages/coc/src/server/spa/client/react/types/dashboard.ts`** _(line 6)_

   Add `'wiki'` to the `RepoSubTab` union type (if not already done in commit 001):
   ```typescript
   export type RepoSubTab = 'info' | 'pipelines' | 'tasks' | 'queue' | 'schedules' | 'chat' | 'git' | 'wiki';
   ```

### Files to Delete

_None._

## Implementation Notes

- **Why `embedded` prop instead of extracting a shared component:** WikiDetail is 250+ lines with internal state (graph, activeTab, adminSubTab), multiple effects, and tightly coupled hash routing. Extracting a `WikiDetailContent` component would require threading ~10 props/callbacks through. The `embedded` boolean is a minimal, non-breaking change that keeps the component cohesive. If more embedding contexts arise, refactoring to a shared inner component can happen then.
- **Hash routing suppression is critical.** Without it, clicking tabs inside the embedded wiki would replace the URL hash from `#repos/<id>/wiki` to `#wiki/<wikiId>/browse`, breaking back-button behavior and potentially causing the entire view to jump to the top-level wiki page.
- **The `location.hash` guards use the `embedded` variable captured in `useCallback` closures.** Since `embedded` is a prop (not state), it's stable across renders and safe to include in dependency arrays.
- **ProjectOverview is a file-private component** inside WikiDetail.tsx (not exported). It does not need modification — it renders correctly as-is when WikiDetail is embedded.
- **The outer container `h-[calc(100vh-48px)]` (line 187)** should work within the repo detail panel because the panel already provides its own scroll context. If the height overflows, a follow-up can adjust to `h-full`.

## Tests

Add tests to `packages/coc/test/spa/react/wiki/WikiComponents.test.tsx`:

1. **`WikiDetail — embedded mode hides back button`**
   - Render `<WikiDetail wikiId="w1" embedded />` (seeded with a wiki via `SeededWikiDetail` pattern).
   - Assert: no element with `title="Back to wiki list"` is present.
   - Assert: wiki name and tab bar (Browse/Ask/Graph/Admin) still render.

2. **`WikiDetail — embedded mode does not mutate location.hash`**
   - Render `<WikiDetail wikiId="w1" embedded />` seeded with a loaded wiki + mock graph.
   - Click the "Ask" tab button.
   - Assert: `location.hash` has not changed (or remains at its initial value).

3. **`WikiDetail — non-embedded mode still shows back button`** (regression guard)
   - Render `<WikiDetail wikiId="w1" />`.
   - Assert: element with `title="Back to wiki list"` is present.

4. **`RepoWikiTab — renders WikiDetail inline for single wiki`**
   - Seed state with one wiki whose `repoPath` matches.
   - Render `<RepoWikiTab repoPath="/path/to/repo" />`.
   - Assert: `#wiki-project-title` element is present (WikiDetail's title).
   - Assert: `#wiki-project-tabs` element is present (WikiDetail's tab bar).
   - Assert: no back button (`title="Back to wiki list"`) is present (embedded mode).

5. **`RepoWikiTab — still shows empty state when no wikis match`** (regression guard)
   - Seed state with one wiki whose `repoPath` does NOT match.
   - Render `<RepoWikiTab repoPath="/other/path" />`.
   - Assert: "No Wiki" text is present.

6. **`RepoWikiTab — returns null for multiple wikis (placeholder)`**
   - Seed state with two wikis whose `repoPath` matches.
   - Render `<RepoWikiTab repoPath="/path/to/repo" />`.
   - Assert: container is empty (component returns null).

## Acceptance Criteria

- [ ] When one wiki matches the repo's workspace path, the Wiki sub-tab renders the full WikiDetail inline with Browse/Ask/Graph/Admin tabs.
- [ ] The back button ("←") is **not** visible in the embedded wiki view.
- [ ] Clicking Browse/Ask/Graph/Admin tabs within the embedded wiki switches content without changing `location.hash`.
- [ ] Component tree sidebar appears when on Browse tab with a loaded graph.
- [ ] Selecting a component in the tree renders `WikiComponent` in the right pane.
- [ ] The empty state (no matching wiki) continues to work as before.
- [ ] Non-embedded `WikiDetail` (top-level wiki page) is unaffected — back button visible, hash routing works.
- [ ] All new and existing tests pass (`npm run test:run` in `packages/coc`).

## Dependencies

- **Commit 001** — `'wiki'` added to `RepoSubTab`, `SUB_TABS`, keyboard shortcut, basic routing.
- **Commit 002** — `RepoWikiTab.tsx` created with empty state. Wired into `RepoDetail` rendering.

## Assumed Prior State

- `RepoSubTab` in `packages/coc/src/server/spa/client/react/types/dashboard.ts` includes `'wiki'`.
- `SUB_TABS` in `packages/coc/src/server/spa/client/react/repos/RepoDetail.tsx` includes `{ key: 'wiki', label: 'Wiki' }`.
- `RepoDetail.tsx` renders `<RepoWikiTab repoPath={...} />` when `activeRepoSubTab === 'wiki'`.
- `RepoWikiTab.tsx` exists at `packages/coc/src/server/spa/client/react/repos/RepoWikiTab.tsx` with the empty-state implementation from commit 002.
- `WikiDetail` is exported from `packages/coc/src/server/spa/client/react/wiki/WikiDetail.tsx` and currently accepts only `{ wikiId: string }`.
