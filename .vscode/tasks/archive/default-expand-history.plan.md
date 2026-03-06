---
status: pending
---

# Default Expand Queue History on Repo Queue Tab

## Problem

When navigating to `http://localhost:4000/#repos/{id}/queue`, the **Completed Tasks** (history) section is collapsed by default. Users must manually click the toggle to see past task results. This is an unnecessary extra step since history is often the primary reason for visiting the queue tab.

## Proposed Approach

Change the initial state of `showHistory` from `false` to `true` in `RepoQueueTab.tsx`, then rebuild the SPA bundle.

**Scope:** This change targets only the per-repo queue tab (`RepoQueueTab.tsx`), NOT the global sidebar (`ProcessesSidebar.tsx`) which has its own independent `showHistory` state in `QueueContext`.

## Analysis

### Current State

| Component | State mechanism | Default |
|---|---|---|
| `RepoQueueTab.tsx` (line 22) | Local `useState(false)` | Collapsed |
| `ProcessesSidebar.tsx` | `QueueContext.showHistory` | Collapsed |
| `queue.ts` (legacy vanilla JS) | `queueState.showHistory` | Collapsed |

### Files Affected

1. **`packages/coc/src/server/spa/client/react/repos/RepoQueueTab.tsx`** — Change `useState(false)` → `useState(true)` on line 22
2. **`packages/coc/src/server/spa/client/dist/bundle.js`** — Rebuilt artifact (auto-generated)

### Test Impact

- **`repo-queue-pause-resume.test.ts` (line 28):** Tests `expect(source).toContain('useState(false)')` — STILL PASSES because `isPaused` and `isPauseResumeLoading` still use `useState(false)`.
- **`QueueContext.test.ts`:** Tests context-level `showHistory` — UNAFFECTED (different state).
- **`repo-queue-split-panel.test.ts`:** Source-level checks on layout — UNAFFECTED.
- **`spa-repo-queue-history.test.ts`:** Checks API path strings — UNAFFECTED.

### Risk Assessment

- **Low risk.** Single boolean default change, no logic changes.
- Auto-expand on new completions/failures (in `QueueContext` reducer) is unaffected — that's context-level state used by sidebar only.
- The collapse/expand toggle still works; only the initial render state changes.

## Implementation Steps

1. Edit `RepoQueueTab.tsx` line 22: `useState(false)` → `useState(true)`
2. Rebuild SPA bundle: `cd packages/coc && npm run build:spa` (or appropriate build command)
3. Run tests: `cd packages/coc && npm run test:run`
4. Verify manually at `http://localhost:4000/#repos/{id}/queue` that history is expanded on load

## Commit

Single atomic commit:
```
feat(coc): default expand completed tasks in repo queue tab

The "Completed Tasks" history section now starts expanded when viewing
#repos/{id}/queue, reducing the click needed to see task results.
```
