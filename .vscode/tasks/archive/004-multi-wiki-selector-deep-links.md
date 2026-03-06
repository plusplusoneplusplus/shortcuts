---
status: pending
---

# 004: Multi-Wiki Selector & Deep Links

## Summary

Implement State 3 (multiple wikis for a repo) with a dropdown selector in `RepoWikiTab`, and add deep-link URL routing for `#repos/{workspaceId}/wiki/{wikiId}/...`. When a repo has 2+ wikis, a compact dropdown appears at the top; selecting a wiki loads its `WikiDetail` inline. Deep links allow direct navigation to a specific wiki, wiki tab, component, or admin sub-tab within the repo context. The `WikiDetail` component gains an `embedded` prop that suppresses the back-button top-bar and adjusts height for inline use. URL hash updates bidirectionally: selecting a wiki updates the hash, and navigating to a deep-link hash selects the wiki.

## Motivation

Commits 001–003 added the wiki sub-tab, created `RepoWikiTab` with empty state (State 1) and single-wiki rendering (State 2). However, a repo may have multiple wikis (e.g., different branches, theme-focused, or re-generated versions). Users need a way to switch between them without leaving the repo context. Deep links enable sharing or bookmarking a specific wiki view within a repo, following the same pattern established by pipelines (`#repos/{id}/pipelines/{name}`), queue (`#repos/{id}/queue/{taskId}`), and chat (`#repos/{id}/chat/{sessionId}`).

## Changes

### Files to Create

_None._ All changes are modifications to existing files.

### Files to Modify

1. **`packages/coc/src/server/spa/client/react/context/AppContext.tsx`**

   Add two new state fields and two new actions for repo-scoped wiki deep linking:

   - **State fields** (add to `AppContextState` interface, lines 12–34, after `activeRepoSubTab`):
     ```typescript
     selectedRepoWikiId: string | null;
     repoWikiInitialTab: WikiProjectTab | null;
     repoWikiInitialAdminTab: WikiAdminTab | null;
     repoWikiInitialComponentId: string | null;
     ```

   - **Initial state** (add to `initialState`, lines 36–58):
     ```typescript
     selectedRepoWikiId: null,
     repoWikiInitialTab: null,
     repoWikiInitialAdminTab: null,
     repoWikiInitialComponentId: null,
     ```

   - **New actions** (add to `AppAction` union, lines 65–99):
     ```typescript
     | { type: 'SET_REPO_WIKI_ID'; wikiId: string | null }
     | { type: 'SET_REPO_WIKI_DEEP_LINK'; wikiId: string; tab?: WikiProjectTab | null; adminTab?: WikiAdminTab | null; componentId?: string | null }
     | { type: 'CLEAR_REPO_WIKI_INITIAL' }
     ```

   - **Reducer cases** (add to `appReducer`, after the `SET_REPO_SUB_TAB` case at line 149):
     ```typescript
     case 'SET_REPO_WIKI_ID':
         return { ...state, selectedRepoWikiId: action.wikiId };
     case 'SET_REPO_WIKI_DEEP_LINK':
         return {
             ...state,
             selectedRepoWikiId: action.wikiId,
             repoWikiInitialTab: action.tab ?? null,
             repoWikiInitialAdminTab: action.adminTab ?? null,
             repoWikiInitialComponentId: action.componentId ?? null,
         };
     case 'CLEAR_REPO_WIKI_INITIAL':
         return { ...state, repoWikiInitialTab: null, repoWikiInitialAdminTab: null, repoWikiInitialComponentId: null };
     ```

   - **Import types** — `WikiProjectTab` and `WikiAdminTab` are already imported at the top of the file (used by existing `SELECT_WIKI_WITH_TAB` action). Verify and add if missing.

2. **`packages/coc/src/server/spa/client/react/layout/Router.tsx`** (lines 151–180, repo deep-link parsing)

   Add wiki deep-link parsing inside the existing `if (tab === 'repos')` block, after the chat deep-link handler (line 179). Follow the exact same pattern as pipelines/queue/chat:

   ```typescript
   // Wiki deep-link: #repos/{id}/wiki/{wikiId} and deeper paths
   if (parts[2] === 'wiki' && parts[3]) {
       const wikiId = decodeURIComponent(parts[3]);
       // Parse optional wiki sub-path: parts[4] = tab/component, parts[5] = componentId/adminTab
       if (parts[4] === 'component' && parts[5]) {
           dispatch({
               type: 'SET_REPO_WIKI_DEEP_LINK',
               wikiId,
               tab: 'browse',
               componentId: decodeURIComponent(parts[5]),
           });
       } else if (parts[4] && VALID_WIKI_PROJECT_TABS.has(parts[4])) {
           const tab = parts[4] as WikiProjectTab;
           let adminTab: WikiAdminTab | null = null;
           if (tab === 'admin' && parts[5] && VALID_WIKI_ADMIN_TABS.has(parts[5])) {
               adminTab = parts[5] as WikiAdminTab;
           }
           dispatch({ type: 'SET_REPO_WIKI_DEEP_LINK', wikiId, tab, adminTab });
       } else {
           dispatch({ type: 'SET_REPO_WIKI_ID', wikiId });
       }
   } else if (parts[2] === 'wiki') {
       dispatch({ type: 'SET_REPO_WIKI_ID', wikiId: null });
   }
   ```

   Note: `VALID_WIKI_PROJECT_TABS` and `VALID_WIKI_ADMIN_TABS` are already exported from this file (lines 30–31).

3. **`packages/coc/src/server/spa/client/react/wiki/WikiDetail.tsx`** (lines 25–27, 52, 186–245)

   Add `embedded` prop support to suppress the standalone top-bar and adjust layout height:

   - **Props interface** (line 25–27):
     ```typescript
     interface WikiDetailProps {
         wikiId: string;
         embedded?: boolean;
         initialTab?: WikiProjectTab | null;
         initialAdminTab?: WikiAdminTab | null;
         initialComponentId?: string | null;
         onHashChange?: (path: string) => void;
     }
     ```

   - **Destructure new props** (line 52):
     ```typescript
     export function WikiDetail({ wikiId, embedded, initialTab, initialAdminTab, initialComponentId, onHashChange }: WikiDetailProps) {
     ```

   - **Consume `initialTab`/`initialAdminTab`/`initialComponentId` props** — add a second `useEffect` after the existing `wikiDetailInitialTab` effect (line 60–71) that reads from props when `embedded` is true:
     ```typescript
     useEffect(() => {
         if (!embedded) return;
         if (initialTab && WIKI_TABS.includes(initialTab)) {
             setActiveTab(initialTab);
         }
         if (initialAdminTab) {
             setAdminSubTab(initialAdminTab);
         }
         if (initialComponentId) {
             dispatch({ type: 'SELECT_WIKI_COMPONENT', componentId: initialComponentId });
         }
     }, [embedded, initialTab, initialAdminTab, initialComponentId]); // eslint-disable-line react-hooks/exhaustive-deps
     ```

   - **Modify `buildWikiHash` calls** — when `embedded` is true, call `onHashChange` instead of setting `location.hash` directly. Update `changeTab` (line 96–100) and `handleSelectComponent` (line 107–111):
     ```typescript
     const changeTab = useCallback((tab: WikiProjectTab) => {
         setActiveTab(tab);
         if (tab !== 'admin') setAdminSubTab(null);
         const hash = buildWikiHash(wikiId, tab, tab === 'browse' ? state.selectedWikiComponentId : null);
         if (onHashChange) {
             onHashChange(hash.replace(/^#wiki\/[^/]+/, ''));
         } else {
             location.hash = hash;
         }
     }, [wikiId, state.selectedWikiComponentId, onHashChange]);
     ```

   - **Conditional rendering** (line 186–225): when `embedded` is true, suppress the back-button top-bar and use `h-full` instead of `h-[calc(100vh-48px)]`:
     ```typescript
     return (
         <div className={cn('flex flex-col overflow-hidden', embedded ? 'h-full' : 'h-[calc(100vh-48px)]')} id="view-wiki">
             {/* Top bar — only in standalone mode */}
             {!embedded && (
                 <div className="flex items-center gap-2 px-3 py-2 border-b border-[#e0e0e0] dark:border-[#3c3c3c]">
                     <button ... onClick={handleBack} ...>←</button>
                     ...
                 </div>
             )}
             {/* Tab bar — always shown, but in embedded mode show inline */}
             {embedded && (
                 <div className="flex items-center gap-2 px-3 py-1.5 border-b border-[#e0e0e0] dark:border-[#3c3c3c]">
                     <Badge status={cfg.badge}>
                         {wikiStatus === 'generating' && <Spinner size="sm" />}
                         {cfg.label}
                     </Badge>
                     <div className="flex-1" />
                     <div className="flex gap-0.5" id="wiki-project-tabs">
                         {WIKI_TABS.map(t => ( /* same tab buttons */ ))}
                     </div>
                 </div>
             )}
             {/* Two-pane layout (unchanged) */}
             ...
         </div>
     );
     ```

   - **`handleBack` in embedded mode** — when `embedded` is true, `handleBack` should be a no-op (the back button is hidden anyway). No code change needed since the button is conditionally rendered.

4. **`packages/coc/src/server/spa/client/react/repos/RepoWikiTab.tsx`** (existing file from commit 002 — this commit adds State 3 multi-wiki selector)

   This file was created in commit 002 with empty state (State 1) and single wiki rendering (State 2). Add the multi-wiki selector (State 3) and deep-link consumption:

   - **Add imports:**
     ```typescript
     import type { WikiProjectTab, WikiAdminTab } from '../types/dashboard';
     ```

   - **Add props for deep-link initial state:**
     ```typescript
     interface RepoWikiTabProps {
         workspaceId: string;
         workspacePath: string;
         initialWikiId?: string | null;
         initialTab?: WikiProjectTab | null;
         initialAdminTab?: WikiAdminTab | null;
         initialComponentId?: string | null;
     }
     ```

   - **Filter and sort wikis:**
     ```typescript
     const repoWikis = useMemo(() => {
         const filtered = state.wikis.filter((w: any) => w.repoPath === workspacePath);
         return filtered.sort((a: any, b: any) =>
             (b.generatedAt || '').localeCompare(a.generatedAt || '')
         );
     }, [state.wikis, workspacePath]);
     ```

   - **Wiki selection state with deep-link initialization:**
     ```typescript
     const [selectedWikiId, setSelectedWikiId] = useState<string | null>(initialWikiId ?? null);
     const activeWikiId = selectedWikiId || repoWikis[0]?.id || null;

     // Sync deep-link initial wiki ID from props
     useEffect(() => {
         if (initialWikiId) {
             setSelectedWikiId(initialWikiId);
         }
     }, [initialWikiId]);
     ```

   - **Clear deep-link initial state after consuming:**
     ```typescript
     useEffect(() => {
         if (initialWikiId || initialTab) {
             dispatch({ type: 'CLEAR_REPO_WIKI_INITIAL' });
         }
     }, []); // eslint-disable-line react-hooks/exhaustive-deps
     ```

   - **URL hash update on selection change:**
     ```typescript
     const handleWikiSelect = useCallback((wikiId: string) => {
         setSelectedWikiId(wikiId);
         location.hash = '#repos/' + encodeURIComponent(workspaceId) + '/wiki/' + encodeURIComponent(wikiId);
     }, [workspaceId]);

     const handleWikiHashChange = useCallback((subPath: string) => {
         // Called by WikiDetail (embedded) when internal navigation changes
         const base = '#repos/' + encodeURIComponent(workspaceId) + '/wiki/' + encodeURIComponent(activeWikiId!);
         location.hash = base + subPath;
     }, [workspaceId, activeWikiId]);
     ```

   - **State 1 (no wikis) — already exists from commit 002, no change.**

   - **State 2 (single wiki) — already exists from commit 002. Ensure it passes `embedded` prop:**
     ```typescript
     if (repoWikis.length === 1) {
         return (
             <WikiDetail
                 wikiId={repoWikis[0].id}
                 embedded
                 initialTab={initialTab}
                 initialAdminTab={initialAdminTab}
                 initialComponentId={initialComponentId}
                 onHashChange={handleWikiHashChange}
             />
         );
     }
     ```

   - **State 3 (multiple wikis) — new code:**
     ```typescript
     if (repoWikis.length > 1) {
         const activeWiki = repoWikis.find((w: any) => w.id === activeWikiId);
         return (
             <div className="flex flex-col h-full min-h-0">
                 {/* Wiki selector bar */}
                 <div className="flex items-center gap-2 px-3 py-2 border-b border-[#e0e0e0] dark:border-[#3c3c3c] flex-shrink-0">
                     <label className="text-xs text-[#848484] flex-shrink-0">Wiki:</label>
                     <select
                         className="text-xs bg-transparent border border-[#e0e0e0] dark:border-[#3c3c3c] rounded px-2 py-1 text-[#1e1e1e] dark:text-[#cccccc] min-w-0 max-w-xs truncate"
                         value={activeWikiId || ''}
                         onChange={(e) => handleWikiSelect(e.target.value)}
                         data-testid="repo-wiki-selector"
                     >
                         {repoWikis.map((w: any) => (
                             <option key={w.id} value={w.id}>
                                 {w.name || w.title || w.id}
                                 {w.status === 'generating' ? ' ⟳' : ''}
                                 {w.status === 'error' ? ' ⚠' : ''}
                             </option>
                         ))}
                     </select>
                     <span className="text-[10px] text-[#848484]">
                         {repoWikis.length} wikis
                     </span>
                 </div>
                 {/* Wiki detail */}
                 <div className="flex-1 min-h-0">
                     {activeWikiId && (
                         <WikiDetail
                             wikiId={activeWikiId}
                             embedded
                             initialTab={activeWikiId === initialWikiId ? initialTab : null}
                             initialAdminTab={activeWikiId === initialWikiId ? initialAdminTab : null}
                             initialComponentId={activeWikiId === initialWikiId ? initialComponentId : null}
                             onHashChange={handleWikiHashChange}
                         />
                     )}
                 </div>
             </div>
         );
     }
     ```

5. **`packages/coc/src/server/spa/client/react/repos/RepoDetail.tsx`** (lines 179–192, sub-tab content rendering)

   Pass deep-link props to `RepoWikiTab`:
   ```typescript
   {activeSubTab === 'wiki' && (
       <RepoWikiTab
           workspaceId={ws.id}
           workspacePath={ws.rootPath}
           initialWikiId={state.selectedRepoWikiId}
           initialTab={state.repoWikiInitialTab}
           initialAdminTab={state.repoWikiInitialAdminTab}
           initialComponentId={state.repoWikiInitialComponentId}
       />
   )}
   ```

   Add import at the top:
   ```typescript
   import { RepoWikiTab } from './RepoWikiTab';
   ```

   Note: The `RepoWikiTab` import and initial render may already exist from commit 002. If so, this commit only changes the props passed (adding `initialWikiId`, `initialTab`, `initialAdminTab`, `initialComponentId`).

### Files to Delete

_None._

## Implementation Notes

- **State management decision:** Wiki selection is primarily **local** to `RepoWikiTab` (via `useState`), but the deep-link initial values are stored in **global** `AppContextState` so the Router can pass them through. After `RepoWikiTab` consumes the initial values, it dispatches `CLEAR_REPO_WIKI_INITIAL` to reset them (one-shot signal pattern, identical to how `selectedChatSessionId` works in `RepoChatTab` / `RepoDetail` lines 81–85).

- **Deep-link URL structure:**
  - `#repos/{workspaceId}/wiki` — wiki sub-tab, no specific wiki selected (default to most recent)
  - `#repos/{workspaceId}/wiki/{wikiId}` — select a specific wiki (browse tab by default)
  - `#repos/{workspaceId}/wiki/{wikiId}/browse` — explicit browse tab
  - `#repos/{workspaceId}/wiki/{wikiId}/ask` — ask tab
  - `#repos/{workspaceId}/wiki/{wikiId}/graph` — graph tab
  - `#repos/{workspaceId}/wiki/{wikiId}/admin` — admin tab (default sub-tab)
  - `#repos/{workspaceId}/wiki/{wikiId}/admin/seeds` — admin with specific sub-tab
  - `#repos/{workspaceId}/wiki/{wikiId}/component/{componentId}` — direct component view
  This mirrors the existing `#wiki/{wikiId}/...` structure from `parseWikiDeepLink` (Router.tsx lines 40–60) but prefixed with `#repos/{id}/wiki/` instead of `#wiki/`.

- **`buildWikiHash` reuse:** The existing `buildWikiHash` in `WikiDetail.tsx` (line 40–50) produces `#wiki/{id}/...` paths. When `embedded` is true, the component calls `onHashChange` with only the sub-path portion (e.g., `/browse`, `/component/{cId}`, `/admin/seeds`). `RepoWikiTab` prepends `#repos/{workspaceId}/wiki/{wikiId}` to form the full hash. This avoids modifying `buildWikiHash` itself.

- **Default wiki selection:** When no `initialWikiId` is provided, `activeWikiId` falls back to `repoWikis[0]?.id`, which is the most recently generated wiki (sorted by `generatedAt` descending).

- **`embedded` prop backward compatibility:** All existing callers of `WikiDetail` (namely `WikiView.tsx` → `WikiList.tsx` → `WikiDetail`) don't pass `embedded`, so it defaults to `undefined`/`false` and behavior is unchanged. The `onHashChange` callback is also optional — when absent, `WikiDetail` continues to set `location.hash` directly.

- **Avoid duplicate hash updates:** When the Router parses a deep link and dispatches `SET_REPO_WIKI_DEEP_LINK`, the `RepoWikiTab` consumes it and selects the wiki. Selecting a wiki normally updates the hash, but since it was already set by the user navigating, a guard should prevent re-setting the same hash. Use a ref (`initializedFromDeepLink`) to skip the first `handleWikiSelect` call if `initialWikiId` matches the current selection.

- **Keyboard shortcut `W`:** Already handled by commit 001. No changes needed here — `W` navigates to `#repos/{id}/wiki` which is the base wiki sub-tab. From there, the user interacts with the selector.

## Tests

All tests go in `packages/coc/test/spa/react/`. Use Vitest with `@testing-library/react` patterns matching existing test files.

### New test file: `packages/coc/test/spa/react/RepoWikiTab.test.tsx`

1. **Multi-wiki selector renders when 2+ wikis match the repo path:**
   - Provide `state.wikis` with 3 wikis, 2 matching `workspacePath`, 1 not matching.
   - Assert `[data-testid="repo-wiki-selector"]` renders as a `<select>` with 2 `<option>` elements.

2. **Default selection is the most recently generated wiki:**
   - Provide 2 matching wikis with different `generatedAt` values.
   - Assert the `<select>` value equals the wiki ID with the later `generatedAt`.

3. **Selector does NOT render when only 1 wiki matches:**
   - Provide `state.wikis` with 1 matching wiki.
   - Assert `[data-testid="repo-wiki-selector"]` does not exist.
   - Assert `WikiDetail` is rendered with `embedded` prop.

4. **Changing selector loads a different WikiDetail:**
   - Render with 2 matching wikis, wiki-A selected by default.
   - Fire change event on the `<select>` to select wiki-B.
   - Assert `WikiDetail` re-renders with `wikiId` = wiki-B's ID.

5. **URL hash updates when wiki is selected from dropdown:**
   - Render with 2 matching wikis.
   - Change the selector to wiki-B.
   - Assert `location.hash` contains `wiki/${encodedWikiBId}`.

6. **Deep link `initialWikiId` selects the correct wiki:**
   - Render with `initialWikiId` set to wiki-B's ID (not the default/most-recent).
   - Assert the `<select>` value equals wiki-B's ID.
   - Assert `WikiDetail` renders with wiki-B's `wikiId`.

7. **Deep link `initialTab` is forwarded to WikiDetail:**
   - Render with `initialWikiId` and `initialTab: 'ask'`.
   - Assert `WikiDetail` receives `initialTab='ask'` prop.

8. **Deep link initial state is cleared after consumption:**
   - Render with `initialWikiId` and `initialTab`.
   - Assert `dispatch` was called with `{ type: 'CLEAR_REPO_WIKI_INITIAL' }`.

9. **Empty state (0 wikis) renders empty-state UI (not selector):**
   - Provide `state.wikis` with 0 matching wikis.
   - Assert no `<select>` and no `WikiDetail`, but the existing empty-state message renders.

10. **Wiki count badge shows correct number:**
    - Render with 3 matching wikis.
    - Assert text "3 wikis" is present.

### Updates to existing test file: `packages/coc/test/spa/react/Router.test.ts` (or `.tsx`)

11. **Deep link `#repos/{id}/wiki/{wikiId}` dispatches `SET_REPO_WIKI_ID`:**
    - Set `location.hash = '#repos/my-repo/wiki/my-wiki'` and trigger `hashchange`.
    - Assert `dispatch` called with `{ type: 'SET_REPO_WIKI_ID', wikiId: 'my-wiki' }`.

12. **Deep link `#repos/{id}/wiki/{wikiId}/ask` dispatches `SET_REPO_WIKI_DEEP_LINK` with tab:**
    - Set `location.hash = '#repos/my-repo/wiki/my-wiki/ask'`.
    - Assert dispatch: `{ type: 'SET_REPO_WIKI_DEEP_LINK', wikiId: 'my-wiki', tab: 'ask' }`.

13. **Deep link `#repos/{id}/wiki/{wikiId}/component/{cId}` dispatches with componentId:**
    - Set `location.hash = '#repos/my-repo/wiki/my-wiki/component/auth-module'`.
    - Assert dispatch: `{ type: 'SET_REPO_WIKI_DEEP_LINK', wikiId: 'my-wiki', tab: 'browse', componentId: 'auth-module' }`.

14. **Deep link `#repos/{id}/wiki/{wikiId}/admin/seeds` dispatches with adminTab:**
    - Set `location.hash = '#repos/my-repo/wiki/my-wiki/admin/seeds'`.
    - Assert dispatch: `{ type: 'SET_REPO_WIKI_DEEP_LINK', wikiId: 'my-wiki', tab: 'admin', adminTab: 'seeds' }`.

15. **Deep link `#repos/{id}/wiki` (no wikiId) dispatches null:**
    - Set `location.hash = '#repos/my-repo/wiki'`.
    - Assert dispatch: `{ type: 'SET_REPO_WIKI_ID', wikiId: null }`.

16. **URL-encoded wikiId is properly decoded:**
    - Set `location.hash = '#repos/my-repo/wiki/wiki%20with%20spaces'`.
    - Assert dispatch: `{ type: 'SET_REPO_WIKI_ID', wikiId: 'wiki with spaces' }`.

### Updates to existing test file: `packages/coc/test/spa/react/wiki/WikiDetail.test.tsx` (or create if not exists)

17. **`embedded` prop suppresses back button:**
    - Render `<WikiDetail wikiId="w1" embedded />`.
    - Assert the "←" back button is NOT in the DOM.

18. **`embedded` prop uses `h-full` instead of `h-[calc(100vh-48px)]`:**
    - Render `<WikiDetail wikiId="w1" embedded />`.
    - Assert the root `div#view-wiki` has class `h-full`, not `h-[calc(100vh-48px)]`.

19. **Without `embedded`, back button renders (existing behavior unchanged):**
    - Render `<WikiDetail wikiId="w1" />`.
    - Assert the "←" back button IS in the DOM.

20. **`onHashChange` callback is invoked instead of setting location.hash when embedded:**
    - Render with `embedded` and `onHashChange` mock.
    - Trigger a tab change (e.g., click "Ask" tab).
    - Assert `onHashChange` was called with a sub-path string (e.g., `/ask`).
    - Assert `location.hash` was NOT modified by the component.

21. **`initialTab` prop sets the active tab when embedded:**
    - Render `<WikiDetail wikiId="w1" embedded initialTab="graph" />`.
    - Assert the "Graph" tab is active.

### Updates to `AppContext` reducer tests (if they exist)

22. **`SET_REPO_WIKI_ID` sets `selectedRepoWikiId`:**
    - Dispatch `{ type: 'SET_REPO_WIKI_ID', wikiId: 'w1' }`.
    - Assert `state.selectedRepoWikiId === 'w1'`.

23. **`SET_REPO_WIKI_DEEP_LINK` sets all four fields:**
    - Dispatch `{ type: 'SET_REPO_WIKI_DEEP_LINK', wikiId: 'w1', tab: 'admin', adminTab: 'seeds', componentId: null }`.
    - Assert `selectedRepoWikiId === 'w1'`, `repoWikiInitialTab === 'admin'`, `repoWikiInitialAdminTab === 'seeds'`.

24. **`CLEAR_REPO_WIKI_INITIAL` resets initial fields but keeps selectedRepoWikiId:**
    - Start with `selectedRepoWikiId: 'w1'`, `repoWikiInitialTab: 'ask'`.
    - Dispatch `{ type: 'CLEAR_REPO_WIKI_INITIAL' }`.
    - Assert `selectedRepoWikiId === 'w1'`, `repoWikiInitialTab === null`.

## Acceptance Criteria

- [ ] When a repo has 2+ wikis, a `<select>` dropdown appears above the wiki content with `data-testid="repo-wiki-selector"`.
- [ ] The dropdown lists all wikis whose `repoPath` matches the current workspace path.
- [ ] Wikis are sorted by `generatedAt` descending; the most recent is selected by default.
- [ ] Selecting a different wiki from the dropdown renders its `WikiDetail` inline (embedded mode).
- [ ] The dropdown shows wiki name and status indicators (⟳ for generating, ⚠ for error).
- [ ] When only 1 wiki exists, no selector renders (behavior unchanged from commit 003).
- [ ] When 0 wikis exist, empty state renders (behavior unchanged from commit 002).
- [ ] `WikiDetail` accepts an `embedded` prop that hides the back button and uses `h-full` height.
- [ ] `WikiDetail` accepts `onHashChange` callback that replaces direct `location.hash` mutation when embedded.
- [ ] Navigating to `#repos/{id}/wiki/{wikiId}` selects that specific wiki in the selector.
- [ ] Navigating to `#repos/{id}/wiki/{wikiId}/ask` selects the wiki and opens the Ask tab.
- [ ] Navigating to `#repos/{id}/wiki/{wikiId}/component/{cId}` selects the wiki and navigates to the component.
- [ ] Navigating to `#repos/{id}/wiki/{wikiId}/admin/seeds` selects the wiki and opens the Admin > Seeds sub-tab.
- [ ] Selecting a wiki from the dropdown updates `location.hash` to `#repos/{id}/wiki/{wikiId}`.
- [ ] Changing tabs within embedded WikiDetail updates `location.hash` to `#repos/{id}/wiki/{wikiId}/{tab}`.
- [ ] All existing Router, WikiDetail, and RepoDetail tests continue to pass.
- [ ] New tests pass: 24 test cases across RepoWikiTab, Router, WikiDetail, and AppContext.
- [ ] TypeScript compilation passes with no errors after adding new state fields and action types.

## Dependencies

- **Commit 001** (`001-types-tab-registration-routing.md`): `'wiki'` must be in `RepoSubTab`, `SUB_TABS`, `VALID_REPO_SUB_TABS`, and `W` shortcut must exist.
- **Commit 002**: `RepoWikiTab.tsx` must exist with empty-state rendering (State 1) and be wired into `RepoDetail.tsx`.
- **Commit 003**: `RepoWikiTab.tsx` must handle single-wiki rendering (State 2) using `WikiDetail` with the `embedded` prop pattern.

## Assumed Prior State

- `RepoSubTab` type includes `'wiki'` at `packages/coc/src/server/spa/client/react/types/dashboard.ts` line 6.
- `SUB_TABS` array in `RepoDetail.tsx` includes `{ key: 'wiki', label: 'Wiki' }` as the last entry.
- `VALID_REPO_SUB_TABS` in `Router.tsx` line 105 includes `'wiki'`.
- `RepoWikiTab.tsx` exists at `packages/coc/src/server/spa/client/react/repos/RepoWikiTab.tsx` with `workspaceId` and `workspacePath` props, empty-state rendering (State 1), and single-wiki `WikiDetail` rendering (State 2).
- `RepoDetail.tsx` renders `<RepoWikiTab>` when `activeSubTab === 'wiki'`, passing at minimum `workspaceId={ws.id}` and `workspacePath={ws.rootPath}`.
- `WikiDetail.tsx` at `packages/coc/src/server/spa/client/react/wiki/WikiDetail.tsx` accepts `wikiId: string` prop and renders a standalone two-pane layout with back button and `h-[calc(100vh-48px)]` height.
- `AppContextState` has `selectedRepoWikiId`, `repoWikiInitialTab`, `repoWikiInitialAdminTab`, and `repoWikiInitialComponentId` fields — **NOT yet present**; this commit adds them.
- `parseWikiDeepLink` exists at Router.tsx lines 40–60 and parses `#wiki/{id}/...` paths. This function is NOT reused for repo-scoped wiki links — a new inline parser is added instead, because the URL structure differs (`#repos/{id}/wiki/{wikiId}/...` vs `#wiki/{wikiId}/...`).
- `VALID_WIKI_PROJECT_TABS` and `VALID_WIKI_ADMIN_TABS` are exported from Router.tsx lines 30–31.
- `WikiProjectTab` = `'browse' | 'ask' | 'graph' | 'admin'` and `WikiAdminTab` = `'generate' | 'seeds' | 'config' | 'delete'` at `types/dashboard.ts` lines 7–8.
- The one-shot deep-link signal pattern is established by `selectedChatSessionId` in `RepoChatTab` (props `initialSessionId`) and `RepoDetail` (lines 81–85 clearing after consumption).
