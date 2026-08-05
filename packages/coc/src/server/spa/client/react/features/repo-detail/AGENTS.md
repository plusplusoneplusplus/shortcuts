# repo-detail

TopBar repo navigation and the per-repo detail view.

## RepoTabStrip kernel decomposition

`RepoTabStrip.tsx` is the top-bar repo navigation surface (visible tabs, agent
pills, overflow menu, context menu, add/edit dialogs). Its navigation logic lives
in three extracted kernels so the component stays composition glue:

- `repoTabModel.ts` — pure, DOM-light helpers: queue-status mapping
  (`buildRepoQueueStatusMap`), overflow flags (`computeRepoOverflowState`),
  visible-set math (`computeVisibleRepoIds` / `computeVisibleAgentIds`),
  `flattenGroups`, accessible labels, `getRepoDisplayName`, drag drop-position
  helpers, and `REPO_TAB_DRAG_MIME`.
- `useRepoTabSelection.ts` — the single `selectRepo(wsId, agentId?)` command used
  by every tab, agent pill, agent submenu, and overflow row. It switches the
  active agent (falsy `agentId` = no agent), selects the workspace, and forces
  `onRefresh` only when the SAME workspace id is re-selected under a different
  agent. Keep all selection surfaces routed through this — the same workspace id
  can exist under multiple agents in container mode.
- `useRepoTabOrdering.ts` — persisted `repoTabOrder`/`gitGroupOrder` load, save,
  reset, customize mode, drag/drop reordering, and polite live-region messages.
  The flat ordered id list is passed in via `allRepoIdsRef` (a ref, not a value)
  because that list is derived from the hook's own `repoTabOrder`; a ref breaks
  the render-time dependency cycle and keeps the drag callbacks stable. Pure order
  math is in `../../repos/repoOrder`.

`RepoTabStrip.tsx` re-exports the model symbols (`getRepoDisplayName`,
`getRepoQueueStatusInfo`, `computeVisibleRepoIds`, `computeVisibleAgentIds`, and
the queue-status types) that RepoDetail, TopBar, and the tab-strip test suites
import.

## RepoCopilotTab Agent Skills

`RepoCopilotTab.tsx` shares `useWorkspaceSkillsController` with
`RepoSettingsTab`; it injects the default SPA client resolver and passes the
controller to `AgentSkillsPanel`. Keep workspace skill loading, detail, config,
toggle, delete, and extra-folder behavior in that controller instead of adding
tab-local copies. `AgentSkillsPanel` and its focused child components are the
visual layer.

## Clone routing

`RepoDetail.tsx` runs its workspace-scoped calls (work-items badge, queue seed,
Resume Queue) through `getCocClientForWorkspace(ws.id)` so a remote clone hits its
own server. `/chat/launch-terminal` deliberately stays on the local-origin
`fetchApi` — it spawns a terminal on whichever machine runs the server. The queue
store is still fed by the LOCAL websocket only, so remote-sourced rows can be
overwritten by a local `REPO_QUEUE_UPDATED`; per-clone queue WS fan-in is the fix.

## Tests

`test/spa/react/repos/RepoTabStrip*.test.tsx` cover the component (tabs, overflow,
agent highlight, queue indicators). `repoTabModel.test.ts`,
`useRepoTabSelection.test.tsx`, and `useRepoTabOrdering.test.tsx` cover the kernels
directly. Run with `node scripts/run-vitest.mjs <files>`.
