---
status: pending
---

# 005: Tab Badge & Generation Status Indicators

## Summary

Add badge indicators on the Wiki tab button in the RepoDetail tab bar that reflect real-time wiki generation status, and add inline status overlays inside `RepoWikiTab` for generating and error states. The tab badge shows a pulsing spinner when any wiki for the repo is generating, a warning dot when any wiki has an error or pending status, and no badge when all wikis are loaded or none exist. Inside the wiki tab content, Browse/Ask/Graph sub-tabs are disabled during generation and an error banner with retry is shown on failure.

## Motivation

Users need immediate visual feedback about wiki status without switching to the Wiki tab. A badge on the tab button (consistent with the existing Tasks/Queue/Chat badge pattern) provides at-a-glance status. Once inside the tab, inline banners prevent users from accessing stale data during generation and surface errors with clear recovery actions. This completes the status communication loop: badge → tab → action.

## Changes

### Files to Create

_None._

### Files to Modify

1. **`packages/coc/src/server/spa/client/react/repos/RepoDetail.tsx`** (imports, ~line 2)
   - Add `useApp` context import is already present. No new import needed for the context.
   - The component already has access to `state` via `useApp()`. Use `state.wikis` to derive badge counts.

2. **`packages/coc/src/server/spa/client/react/repos/RepoDetail.tsx`** (badge state computation, insert after existing `chatPendingCount` destructure, ~line 50–55)
   - Add wiki badge state computation using `useMemo`:
     ```typescript
     const repoWikis = useMemo(() =>
         state.wikis.filter((w: any) => w.repoPath === ws.rootPath),
         [state.wikis, ws.rootPath]
     );
     const wikiGeneratingCount = repoWikis.filter((w: any) => w.status === 'generating').length;
     const wikiWarningCount = repoWikis.filter((w: any) => w.status === 'error' || w.status === 'pending').length;
     ```
   - `ws.rootPath` is already available (used for `RepoChatTab`'s `workspacePath` prop on ~line 190). `state.wikis` is already in AppContext (confirmed in `AppContextState`).

3. **`packages/coc/src/server/spa/client/react/repos/RepoDetail.tsx`** (badge rendering, insert after chat badge block, ~lines 170–171)
   - Add two badge elements inside the `SUB_TABS.map()` tab button, after the existing chat badge block:
     ```typescript
     {t.key === 'wiki' && wikiGeneratingCount > 0 && (
         <span
             className="ml-1 text-[10px] bg-[#16825d] text-white px-1 py-px rounded-full animate-pulse"
             data-testid="wiki-generating-badge"
             title="Generating"
         >⟳</span>
     )}
     {t.key === 'wiki' && wikiWarningCount > 0 && wikiGeneratingCount === 0 && (
         <span
             className="ml-1 w-2 h-2 rounded-full bg-[#f59e0b] inline-block"
             data-testid="wiki-warning-badge"
             title="Needs attention"
         />
     )}
     ```
   - **Badge precedence:** Generating badge takes priority over warning badge (a wiki can be generating while another has an error; the active process is more important to surface). The `wikiGeneratingCount === 0` guard on the warning badge enforces this.
   - **Color choices:** Green `#16825d` matches the queue running badge. Amber `#f59e0b` is standard warning. `animate-pulse` is a Tailwind utility already available in the SPA build.
   - **`⟳` character:** Unicode U+27F3, a clockwise arrow — visually indicates a process in progress, renders correctly in all modern browsers without an icon library dependency.

4. **`packages/coc/src/server/spa/client/react/repos/RepoWikiTab.tsx`** (generation status overlay)
   - This file was created in commit 002 and enhanced in commits 003–004. Add inline status handling for generating and error states.
   - **Generating state:** When the selected wiki has `status === 'generating'`, render a progress banner above the WikiDetail content area:
     ```typescript
     {selectedWiki && selectedWiki.status === 'generating' && (
         <div
             className="flex items-center gap-2 px-4 py-2 bg-[#16825d]/10 border border-[#16825d]/30 rounded text-sm"
             data-testid="wiki-generating-banner"
         >
             <span className="animate-spin text-[#16825d]">⟳</span>
             <span>Wiki generation in progress…</span>
         </div>
     )}
     ```
   - **Error state:** When the selected wiki has `status === 'error'`, render an error banner with a retry button:
     ```typescript
     {selectedWiki && selectedWiki.status === 'error' && (
         <div
             className="flex items-center justify-between px-4 py-2 bg-red-500/10 border border-red-500/30 rounded text-sm"
             data-testid="wiki-error-banner"
         >
             <span className="text-red-400">
                 ⚠ Wiki generation failed{selectedWiki.error ? `: ${selectedWiki.error}` : '.'}
             </span>
             <button
                 className="text-xs text-blue-400 hover:underline"
                 data-testid="wiki-retry-btn"
                 onClick={() => handleRetryGeneration(selectedWiki.id)}
             >
                 Retry
             </button>
         </div>
     )}
     ```
   - **Retry handler:** Add a `handleRetryGeneration` callback that POSTs to the existing wiki regeneration endpoint:
     ```typescript
     const handleRetryGeneration = useCallback(async (wikiId: string) => {
         try {
             await fetchApi(`${getApiBase()}/api/dw/generate`, {
                 method: 'POST',
                 headers: { 'Content-Type': 'application/json' },
                 body: JSON.stringify({ wikiId }),
             });
         } catch (err) {
             console.error('Failed to retry wiki generation:', err);
         }
     }, []);
     ```
   - **Banners placement:** Insert banners between the wiki selector (commit 004) and the WikiDetail component, inside a flex column layout. The banners stack above the wiki content.

5. **`packages/coc/src/server/spa/client/react/wiki/WikiDetail.tsx`** (disable tabs during generation, ~lines 209–223)
   - The existing WikiDetail renders Browse/Ask/Graph/Admin tab buttons unconditionally. Add disabled state for Browse, Ask, and Graph when `wikiStatus === 'generating'`:
     ```typescript
     const isGenerating = wikiStatus === 'generating';
     ```
   - In the tab button rendering loop, for tabs other than `'admin'`, add disabled styling and click prevention:
     ```typescript
     <button
         key={tab}
         disabled={isGenerating && tab !== 'admin'}
         className={cn(
             'px-3 py-1 text-sm rounded',
             activeTab === tab ? 'bg-[#0078d4] text-white' : 'text-gray-400 hover:text-white',
             isGenerating && tab !== 'admin' && 'opacity-50 cursor-not-allowed hover:text-gray-400',
         )}
         onClick={() => !isGenerating || tab === 'admin' ? changeTab(tab) : undefined}
     >
         {tab.charAt(0).toUpperCase() + tab.slice(1)}
     </button>
     ```
   - When a disabled tab is selected while generating, show a placeholder message:
     ```typescript
     {isGenerating && activeTab !== 'admin' && (
         <div className="flex items-center justify-center h-full text-gray-500 text-sm" data-testid="wiki-generating-placeholder">
             Generation in progress… Switch to Admin to manage.
         </div>
     )}
     ```
   - The Admin tab remains fully functional during generation so users can monitor progress or reconfigure.

6. **`packages/coc/src/server/spa/client/react/wiki/WikiDetail.tsx`** (force admin tab on generating, ~line 96)
   - If `wikiStatus` transitions to `'generating'` while a non-admin tab is active, auto-switch to admin:
     ```typescript
     useEffect(() => {
         if (wikiStatus === 'generating' && activeTab !== 'admin') {
             changeTab('admin');
         }
     }, [wikiStatus, activeTab, changeTab]);
     ```
   - This ensures users are never stuck on a disabled tab.

### Files to Delete

_None._

## Implementation Notes

- **Badge pattern conformance:** The wiki badges follow the exact same markup structure as Queue/Chat/Tasks badges: a `<span>` inside the `SUB_TABS.map()` button, conditionally rendered, with `data-testid` for testing.
- **Reactive updates:** Wiki state (`state.wikis`) is updated via WebSocket events (`WIKI_RELOAD`, `WIKI_REBUILDING`, `WIKI_ERROR`) dispatched by the AppContext reducer. No additional polling or subscription is needed — the `useMemo` recomputes when `state.wikis` changes.
- **Warning badge suppression during generation:** If a repo has one wiki generating and another with an error, only the generating badge shows. This avoids badge clutter and surfaces the most actionable status.
- **`animate-pulse` and `animate-spin`:** Both are standard Tailwind utilities. `animate-pulse` (opacity fade in/out) is used for the tab badge; `animate-spin` (360° rotation) is used for the inline banner spinner. These are distinct animations for different contexts.
- **Type safety:** `state.wikis` is typed as `any[]` in AppContext. The filters use `(w: any)` to avoid type errors. If wiki types are formalized later, these can be tightened.
- **`embedded` prop:** Commit 003 added an `embedded` prop to WikiDetail. The tab disabling logic in WikiDetail should work regardless of whether `embedded` is true or false — the status-based behavior is universal.
- **No new dependencies:** All styling uses existing Tailwind classes. The `⟳` character is plain Unicode. `fetchApi` and `getApiBase` are already imported/available in RepoWikiTab.

## Tests

Update **`packages/coc/test/spa/react/RepoDetail.test.ts`**:

1. **Wiki generating badge renders when `wikiGeneratingCount > 0`:**
   ```typescript
   it('renders wiki generating badge with data-testid', () => {
       expect(REPO_DETAIL_SOURCE).toContain('data-testid="wiki-generating-badge"');
   });
   ```

2. **Wiki generating badge has animate-pulse class:**
   ```typescript
   it('wiki generating badge uses animate-pulse', () => {
       const line = REPO_DETAIL_SOURCE.split('\n').find(l => l.includes('wiki-generating-badge'));
       expect(line || REPO_DETAIL_SOURCE).toContain('animate-pulse');
   });
   ```

3. **Wiki generating badge uses green background matching queue running badge:**
   ```typescript
   it('wiki generating badge uses green bg-[#16825d]', () => {
       const lines = REPO_DETAIL_SOURCE.split('\n');
       const badgeLine = lines.findIndex(l => l.includes('wiki-generating-badge'));
       const context = lines.slice(Math.max(0, badgeLine - 5), badgeLine + 1).join('\n');
       expect(context).toContain('bg-[#16825d]');
   });
   ```

4. **Wiki generating badge is conditional on `wikiGeneratingCount > 0`:**
   ```typescript
   it('wiki generating badge is gated on wikiGeneratingCount > 0', () => {
       expect(REPO_DETAIL_SOURCE).toContain("t.key === 'wiki' && wikiGeneratingCount > 0");
   });
   ```

5. **Wiki warning badge renders with data-testid:**
   ```typescript
   it('renders wiki warning badge with data-testid', () => {
       expect(REPO_DETAIL_SOURCE).toContain('data-testid="wiki-warning-badge"');
   });
   ```

6. **Wiki warning badge uses amber color:**
   ```typescript
   it('wiki warning badge uses amber bg-[#f59e0b]', () => {
       const lines = REPO_DETAIL_SOURCE.split('\n');
       const badgeLine = lines.findIndex(l => l.includes('wiki-warning-badge'));
       const context = lines.slice(Math.max(0, badgeLine - 5), badgeLine + 1).join('\n');
       expect(context).toContain('bg-[#f59e0b]');
   });
   ```

7. **Warning badge suppressed when generating:**
   ```typescript
   it('wiki warning badge is suppressed when generating', () => {
       expect(REPO_DETAIL_SOURCE).toContain('wikiWarningCount > 0 && wikiGeneratingCount === 0');
   });
   ```

8. **No badge when wiki is loaded (no conditions met):**
   ```typescript
   it('no wiki badge conditions include loaded status', () => {
       // Loaded wikis don't increment either counter, so no badge renders
       expect(REPO_DETAIL_SOURCE).not.toContain("w.status === 'loaded'");
       // Only 'generating', 'error', and 'pending' appear in filters
       expect(REPO_DETAIL_SOURCE).toContain("w.status === 'generating'");
       expect(REPO_DETAIL_SOURCE).toContain("w.status === 'error'");
       expect(REPO_DETAIL_SOURCE).toContain("w.status === 'pending'");
   });
   ```

9. **Badge state computed from `state.wikis` filtered by `ws.rootPath`:**
   ```typescript
   it('filters wikis by ws.rootPath for badge counts', () => {
       expect(REPO_DETAIL_SOURCE).toContain('w.repoPath === ws.rootPath');
   });
   ```

Create **`packages/coc/test/spa/react/RepoWikiTabStatus.test.ts`**:

10. **Generating banner renders with data-testid:**
    ```typescript
    import { describe, it, expect } from 'vitest';
    import * as fs from 'fs';
    import * as path from 'path';

    const SOURCE = fs.readFileSync(
        path.join(__dirname, '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'repos', 'RepoWikiTab.tsx'),
        'utf-8',
    );

    describe('RepoWikiTab generation status', () => {
        it('renders generating banner with data-testid', () => {
            expect(SOURCE).toContain('data-testid="wiki-generating-banner"');
        });

        it('generating banner shows progress message', () => {
            expect(SOURCE).toContain('Wiki generation in progress');
        });

        it('renders error banner with data-testid', () => {
            expect(SOURCE).toContain('data-testid="wiki-error-banner"');
        });

        it('error banner includes retry button', () => {
            expect(SOURCE).toContain('data-testid="wiki-retry-btn"');
        });

        it('retry button calls handleRetryGeneration', () => {
            expect(SOURCE).toContain('handleRetryGeneration');
        });

        it('retry posts to dw/generate endpoint', () => {
            expect(SOURCE).toContain('/api/dw/generate');
        });

        it('error banner displays wiki error message when available', () => {
            expect(SOURCE).toContain('selectedWiki.error');
        });
    });
    ```

Update **`packages/coc/test/spa/react/WikiDetailLayout.test.ts`** (or create `WikiDetailStatus.test.ts`):

11. **Browse/Ask/Graph tabs disabled during generation:**
    ```typescript
    import { describe, it, expect } from 'vitest';
    import * as fs from 'fs';
    import * as path from 'path';

    const SOURCE = fs.readFileSync(
        path.join(__dirname, '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'wiki', 'WikiDetail.tsx'),
        'utf-8',
    );

    describe('WikiDetail generation status handling', () => {
        it('defines isGenerating derived from wikiStatus', () => {
            expect(SOURCE).toContain("wikiStatus === 'generating'");
        });

        it('disables non-admin tabs when generating', () => {
            expect(SOURCE).toContain("isGenerating && tab !== 'admin'");
        });

        it('applies opacity-50 and cursor-not-allowed to disabled tabs', () => {
            expect(SOURCE).toContain('opacity-50');
            expect(SOURCE).toContain('cursor-not-allowed');
        });

        it('shows generating placeholder message for disabled tabs', () => {
            expect(SOURCE).toContain('data-testid="wiki-generating-placeholder"');
            expect(SOURCE).toContain('Generation in progress');
        });

        it('auto-switches to admin tab when generation starts', () => {
            // useEffect that switches to admin when generating and not already on admin
            expect(SOURCE).toContain("wikiStatus === 'generating' && activeTab !== 'admin'");
        });

        it('admin tab remains clickable during generation', () => {
            // The disabled condition excludes admin
            expect(SOURCE).toContain("tab !== 'admin'");
        });
    });
    ```

## Acceptance Criteria

- [ ] **Tab badge — generating:** A pulsing green badge with `⟳` appears on the Wiki tab button when any wiki matching the repo's `rootPath` has `status === 'generating'`.
- [ ] **Tab badge — warning:** An amber dot appears on the Wiki tab button when any repo wiki has `status === 'error'` or `status === 'pending'`, and no wiki is generating.
- [ ] **Tab badge — none:** No badge appears when all repo wikis are loaded or no wikis exist for the repo.
- [ ] **Tab badge — precedence:** Generating badge takes priority over warning badge when both conditions are true.
- [ ] **Tab badge — reactive:** Badge updates immediately when wiki status changes via WebSocket events (no page refresh needed).
- [ ] **Inline generating banner:** A progress banner appears inside RepoWikiTab when the selected wiki is generating.
- [ ] **Inline error banner:** An error banner with message and retry button appears when the selected wiki has error status.
- [ ] **Retry button:** Clicking retry POSTs to `/api/dw/generate` to re-trigger generation.
- [ ] **Disabled tabs:** Browse, Ask, and Graph sub-tabs in WikiDetail are visually disabled and non-clickable during generation.
- [ ] **Admin accessible:** The Admin tab remains fully functional during all wiki states (generating, error, pending).
- [ ] **Auto-switch to admin:** If generation starts while a non-admin tab is active, WikiDetail auto-switches to the Admin tab.
- [ ] **Generating placeholder:** Disabled tabs show "Generation in progress…" message instead of stale content.
- [ ] **All existing tests pass:** No regressions in RepoDetail, Router, or WikiDetail tests.
- [ ] **New tests pass:** All tests listed in the Tests section pass.
- [ ] **TypeScript compilation:** `npm run build` succeeds with no type errors.

## Dependencies

- **Commit 001** (types, tab registration, routing) — provides `'wiki'` in `RepoSubTab`, `SUB_TABS`, and `VALID_REPO_SUB_TABS`.
- **Commit 002** (RepoWikiTab empty state) — provides the `RepoWikiTab.tsx` file to add status banners to.
- **Commit 003** (single wiki rendering) — provides WikiDetail with `embedded` prop and inline rendering.
- **Commit 004** (multi-wiki selector) — provides the wiki selector UI in RepoWikiTab, above which banners are inserted.

## Assumed Prior State

- `RepoSubTab` includes `'wiki'` and `SUB_TABS` has 8 entries (info, git, pipelines, tasks, queue, schedules, chat, wiki) — from commit 001.
- `RepoWikiTab.tsx` exists at `packages/coc/src/server/spa/client/react/repos/RepoWikiTab.tsx` with empty state handling and WikiDetail integration — from commits 002–003.
- `RepoWikiTab.tsx` includes a wiki selector for multi-wiki repos and deep-link support — from commit 004.
- `RepoDetail.tsx` renders `<RepoWikiTab>` when `activeSubTab === 'wiki'` — from commit 002.
- `RepoDetail.tsx` has existing badge blocks for tasks (~line 160), queue (~lines 163–168), and chat (~lines 169–171) inside the `SUB_TABS.map()` tab button.
- `WikiDetail.tsx` exists at `packages/coc/src/server/spa/client/react/wiki/WikiDetail.tsx` with `WikiStatus` type, `statusConfig`, Badge/Spinner rendering, and four sub-tabs (browse, ask, graph, admin).
- `WikiDetail.tsx` has an `embedded` prop (from commit 003) but does not yet disable tabs during generation.
- `state.wikis` in AppContext is an `any[]` containing wiki objects with at least `{ id, repoPath, status, error? }` fields.
- WebSocket events (`WIKI_RELOAD`, `WIKI_REBUILDING`, `WIKI_ERROR`) already update `state.wikis` reactively via the AppContext reducer.
- `fetchApi` and `getApiBase` are importable from existing utility modules in the SPA client.
- `RepoDetail.test.ts` exists at `packages/coc/test/spa/react/RepoDetail.test.ts` with source-based assertion pattern (reads `.tsx` file as string).
- `WikiDetailLayout.test.ts` exists at `packages/coc/test/spa/react/WikiDetailLayout.test.ts` with minimal layout tests.
