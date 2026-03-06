---
status: pending
---

# 002: RepoWikiTab Scaffold with Empty State

## Summary

Create the `RepoWikiTab` component that displays an empty state (State 1) when no wiki exists for the current workspace. Wire it into `RepoDetail.tsx`'s conditional tab rendering alongside the existing sub-tabs. This commit only implements the empty/no-wiki state; wiki-exists states (States 2 and 3) come in later commits.

## Motivation

Commit 001 added the `wiki` sub-tab to routing, the `RepoSubTab` type, `SUB_TABS`, `VALID_REPO_SUB_TABS`, and the 'W' keyboard shortcut. However, navigating to `#repos/{id}/wiki` currently renders nothing because no component handles `activeSubTab === 'wiki'`. This commit provides the component scaffold with the first meaningful UI: an empty state that tells the user no wiki exists and offers a "Generate Wiki" CTA button.

## Changes

### Files to Create

1. **`packages/coc/src/server/spa/client/react/repos/RepoWikiTab.tsx`**

   New React component. Structure:

   ```typescript
   import { useCallback, useMemo } from 'react';
   import { useApp } from '../context/AppContext';
   import { Button } from '../shared';
   import { fetchApi } from '../api';

   interface RepoWikiTabProps {
       workspaceId: string;
       workspacePath?: string;
   }

   export function RepoWikiTab({ workspaceId, workspacePath }: RepoWikiTabProps) { ... }
   ```

   **Props:** `workspaceId: string` and `workspacePath?: string` — mirrors the `RepoChatTab` pattern (see `RepoChatTab.tsx` lines 22–26).

   **Wiki lookup logic:**
   - Access `state.wikis` via the `useApp()` hook.
   - Filter: `const repoWikis = useMemo(() => state.wikis.filter(w => w.repoPath === workspacePath), [state.wikis, workspacePath]);`
   - If `repoWikis.length === 0`, render the empty state.

   **Empty state UI** (follow the pattern from `WikiDetail.tsx` lines 131–141):
   ```tsx
   <div className="flex flex-col items-center justify-center h-full text-center">
       <div className="text-4xl mb-3">📚</div>
       <div className="text-sm font-semibold text-[#1e1e1e] dark:text-[#cccccc] mb-1">
           No Wiki Found
       </div>
       <div className="text-xs text-[#848484] mb-4 max-w-xs">
           No wiki has been generated for this workspace yet.
           Generate one to get auto-documented architecture, components, and code insights.
       </div>
       <Button
           size="sm"
           disabled={!workspacePath}
           title={!workspacePath ? 'A repository path is required to generate a wiki' : undefined}
           onClick={handleGenerateWiki}
       >
           Generate Wiki
       </Button>
   </div>
   ```

   **`handleGenerateWiki` callback:**
   ```typescript
   const handleGenerateWiki = useCallback(async () => {
       if (!workspacePath) return;
       const res = await fetchApi('/api/wikis', {
           method: 'POST',
           body: JSON.stringify({ repoPath: workspacePath }),
       });
       if (res.ok) {
           const wiki = await res.json();
           // Navigate to wiki detail/admin for generation
           dispatch({ type: 'navigate', path: `#wikis/${wiki.id}/admin` });
       }
   }, [workspacePath, dispatch]);
   ```

   **Edge case — no `workspacePath`:**
   - The "Generate Wiki" button is rendered but `disabled={!workspacePath}`.
   - A `title` attribute provides a tooltip: `"A repository path is required to generate a wiki"`.

2. **`packages/coc/test/spa/react/RepoWikiTab.test.ts`**

   Vitest test file following the existing pattern in `packages/coc/test/spa/react/` (e.g., `RepoChatTab.test.ts`).

   ```typescript
   import { describe, it, expect, beforeAll } from 'vitest';
   import * as fs from 'fs';
   import * as path from 'path';
   ```

   See [Tests](#tests) section for full test cases.

### Files to Modify

1. **`packages/coc/src/server/spa/client/react/repos/RepoDetail.tsx`**

   **Change 1 — Add import** (near line 10, alongside existing tab imports):
   ```typescript
   import { RepoWikiTab } from './RepoWikiTab';
   ```

   **Change 2 — Add wiki tab rendering** (inside the `<div className="h-full overflow-y-auto min-w-0">` block, after the `activeSubTab === 'git'` line, approximately line 190):
   ```typescript
   {activeSubTab === 'wiki' && <RepoWikiTab workspaceId={ws.id} workspacePath={ws.rootPath} />}
   ```

   This follows the exact same conditional rendering pattern used by all other sub-tabs in that block.

### Files to Delete

None.

## Implementation Notes

- **Component location:** `packages/coc/src/server/spa/client/react/repos/RepoWikiTab.tsx` — placed in the `repos/` directory alongside `RepoChatTab.tsx`, `RepoGitTab.tsx`, `RepoInfoTab.tsx`, etc.
- **Shared imports:** Use `Button` from `../shared` (re-exported via `packages/coc/src/server/spa/client/react/shared/index.ts`). Use `useApp` from `../context/AppContext`.
- **API calls:** Use the existing `fetchApi` helper (same as other components) for `POST /api/wikis`.
- **Navigation after create:** Use `dispatch({ type: 'navigate', path: ... })` from the app context to navigate to the wiki admin view where generation can begin.
- **WikiData interface:** Defined in `WikiList.tsx` lines 17–28. The component filters `state.wikis` (type `WikiData[]`) by `repoPath === workspacePath`. No new type definitions needed.
- **Path comparison:** Use strict equality (`===`) for `wiki.repoPath === workspacePath`. Both values come from the same source (workspace `rootPath`), so no normalization is needed for now.
- **State 1 only:** This commit exclusively handles the empty state (no matching wikis). Do not add loading spinners, wiki-exists views, or generation progress UI — those are in commits 003+.

## Tests

Create `packages/coc/test/spa/react/RepoWikiTab.test.ts` with the following test cases:

```typescript
describe('RepoWikiTab', () => {
    const componentPath = path.resolve(__dirname, '../../../src/server/spa/client/react/repos/RepoWikiTab.tsx');
    let content: string;

    beforeAll(() => {
        content = fs.readFileSync(componentPath, 'utf-8');
    });

    describe('file structure', () => {
        it('should exist at the expected path', () => {
            expect(fs.existsSync(componentPath)).toBe(true);
        });

        it('should export a RepoWikiTab component', () => {
            expect(content).toMatch(/export\s+(function|const)\s+RepoWikiTab/);
        });
    });

    describe('props interface', () => {
        it('should accept workspaceId prop', () => {
            expect(content).toContain('workspaceId');
        });

        it('should accept workspacePath prop', () => {
            expect(content).toContain('workspacePath');
        });
    });

    describe('empty state rendering', () => {
        it('should display a "No Wiki Found" heading', () => {
            expect(content).toContain('No Wiki Found');
        });

        it('should include a Generate Wiki button', () => {
            expect(content).toMatch(/Generate Wiki/);
        });

        it('should filter state.wikis by workspacePath', () => {
            expect(content).toMatch(/repoPath\s*===\s*workspacePath/);
        });
    });

    describe('disabled state when no workspacePath', () => {
        it('should disable the button when workspacePath is missing', () => {
            expect(content).toMatch(/disabled=\{!workspacePath\}/);
        });

        it('should include a tooltip explaining why generation is disabled', () => {
            expect(content).toContain('repository path is required');
        });
    });

    describe('generate wiki action', () => {
        it('should POST to /api/wikis endpoint', () => {
            expect(content).toContain('/api/wikis');
        });

        it('should send repoPath in the request body', () => {
            expect(content).toContain('repoPath');
        });
    });

    describe('integration with RepoDetail', () => {
        const detailPath = path.resolve(__dirname, '../../../src/server/spa/client/react/repos/RepoDetail.tsx');
        let detailContent: string;

        beforeAll(() => {
            detailContent = fs.readFileSync(detailPath, 'utf-8');
        });

        it('should be imported in RepoDetail', () => {
            expect(detailContent).toMatch(/import.*RepoWikiTab.*from/);
        });

        it('should be rendered when activeSubTab is wiki', () => {
            expect(detailContent).toMatch(/activeSubTab\s*===\s*['"]wiki['"]/);
            expect(detailContent).toContain('RepoWikiTab');
        });

        it('should receive workspaceId and workspacePath props', () => {
            expect(detailContent).toMatch(/RepoWikiTab\s+workspaceId=\{ws\.id\}\s+workspacePath=\{ws\.rootPath\}/);
        });
    });
});
```

**Run tests with:** `cd packages/coc && npx vitest run test/spa/react/RepoWikiTab.test.ts`

## Acceptance Criteria

- [ ] `RepoWikiTab.tsx` exists at `packages/coc/src/server/spa/client/react/repos/RepoWikiTab.tsx`
- [ ] Component accepts `workspaceId: string` and `workspacePath?: string` props
- [ ] When no wikis match `workspacePath`, renders empty state with 📚 icon, "No Wiki Found" heading, description text, and "Generate Wiki" button
- [ ] "Generate Wiki" button calls `POST /api/wikis` with `{ repoPath: workspacePath }` and navigates to wiki admin on success
- [ ] "Generate Wiki" button is disabled with tooltip when `workspacePath` is undefined/empty
- [ ] `RepoDetail.tsx` imports `RepoWikiTab` and renders it for `activeSubTab === 'wiki'` with `workspaceId={ws.id} workspacePath={ws.rootPath}`
- [ ] All tests in `RepoWikiTab.test.ts` pass
- [ ] Existing tests (`npm run test` and `cd packages/coc && npm run test:run`) are not broken

## Dependencies

- **Commit 001** (wiki sub-tab routing) must be merged first — provides `'wiki'` in `RepoSubTab`, `SUB_TABS`, `VALID_REPO_SUB_TABS`, and `#repos/{id}/wiki` route handling.
- **Existing infrastructure:** `useApp` hook, `fetchApi`, `Button` component, `state.wikis` array, `POST /api/wikis` endpoint, app-level navigation dispatch.

## Assumed Prior State

- Commit 001 has landed: `RepoSubTab` includes `'wiki'`, `SUB_TABS` has the wiki entry with 'W' shortcut, and `VALID_REPO_SUB_TABS` includes `'wiki'`.
- `RepoDetail.tsx` routes to sub-tab components but has no `wiki` case yet (selecting the wiki tab renders a blank area).
- `state.wikis` is populated by existing app-level data fetching (no new data-fetching infrastructure needed).
- `POST /api/wikis` endpoint exists and returns a `WikiData` object with an `id` field on success.
- Shared components (`Button`, `useApp`, `fetchApi`) are stable and available.
