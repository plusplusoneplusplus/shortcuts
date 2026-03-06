# Async Git Info on SPA Refresh

## Problem

When the SPA dashboard (`coc serve`) is refreshed in the browser, the entire "Repos" view
stalls on **"Loading repositories…"** for several seconds. The root cause is that the server
blocks the HTTP response for every `GET /api/workspaces/:id/git-info` request by running
git commands with `childProcess.execSync` (see `packages/pipeline-core/src/git/branch-service.ts`).
With many git clones, those blocking calls pile up and the browser waits for all of them
before rendering anything.

## Proposed Approach

**Client-only change — progressive / optimistic rendering**

Stop bundling git-info into the initial parallel fetch that gates the whole page render.
Instead:
- Render workspace cards immediately (using data from `GET /api/workspaces`).
- Fetch git-info per-workspace *after* cards are visible, filling in branch/dirty/ahead/behind
  as each response arrives.
- Show a small skeleton/spinner inside the git-info section of each card while it loads.

No server changes are required; the existing `/api/workspaces/:id/git-info` endpoint is used
as-is.

## Acceptance Criteria

- [x] On SPA refresh, workspace cards appear immediately (< 500 ms) without waiting for any
      git commands to complete.
- [x] Git branch name, dirty state, ahead/behind counts render progressively as each
      workspace's git-info response arrives.
- [x] Each git-info card slot shows a loading indicator while its data is in-flight.
- [x] No regression in the existing SPA behaviour (pipelines, tasks, processes still load).

## Subtasks

### 1. Decouple git-info from initial workspace fetch in the SPA ✅
- **File:** `packages/coc/src/server/spa/client/react/repos/ReposView.tsx`
- Split the single big `Promise.all` into two phases:
  1. Fetch `GET /api/workspaces` (+ pipelines/tasks if fast) → set state → render cards.
  2. After cards render, trigger per-workspace git-info fetches; update each card as responses
     arrive (e.g., `setRepos(prev => prev.map(r => r.id === id ? { ...r, gitInfo } : r))`).
- Add a `gitInfoLoading` flag per repo to drive the skeleton/spinner.

### 2. Add loading skeleton for git-info in each repo card ✅
- **File(s):** `packages/coc/src/server/spa/client/react/repos/RepoCard.tsx` (or equivalent)
- While `gitInfoLoading === true`, render a placeholder (e.g., a grey pill or `—` text).
- Animate with a subtle pulse if a CSS utility is already in place (Tailwind `animate-pulse`).

### 3. Update / add tests ✅
- `packages/coc-server/src/api-handler.test.ts` — verify git-info endpoint still returns correct shape with mocked responses.

## Notes

- The client-side change delivers the biggest perceived-performance win with no server risk.
- Consider adding an optional client-side cache (TTL ~10 s) for git-info to avoid refetching
  on repeated tab switches; this is a stretch goal.
