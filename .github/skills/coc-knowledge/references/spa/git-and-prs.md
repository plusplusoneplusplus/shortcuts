# Dashboard SPA — Git & Pull Requests

Git tab controllers, branch range, cherry-pick, worktree execution controls, diff
classification, composer PR chips, and the Pull Requests tab.

## Git tab

`features/git/RepoGitTab.tsx` is a composition shell over `features/git/repoGitTab/`:

| Controller | Owns |
|---|---|
| `useRepoGitData` | Commits, branch range, repo state, caches, `refreshAll` |
| `useRepoGitSelection` | Right-panel routing, URL hash + AppContext sync, deep links, direct SHA lookup |
| `useGitOperationActions` | Every mutation plus all four job pollers |
| `useGitAutoPullController` | Automatic pull scheduling |
| `useGitSkillActions` | Commit-context skill runs |

Pure helpers `selectionModel`, `gitPrompts`, `gitContextMenuModel` sit alongside the
`RepoGitListPane` / `RepoGitDetailPane` / `RepoGitOverlays` presentation components.
**Every hook takes `workspaceId` explicitly and reads its client through
`useCocClient(workspaceId)`**, so git, queue, and preferences traffic targets the
selected clone's server. `useGitOperationActions` owns the pull poller and hands it to
`useGitAutoPullController`, so manual and automatic pulls can never poll concurrently;
auto-pull skips and failures report through `useTransientToast`, not the `actionError`
banner.

### Job polling

A git operation response carrying a `jobId` is pending work: poll operation history to
terminal status before refreshing. Failed Drop Commit jobs render the tab-level
action-error banner.

Pull, rebase autosquash, drop commit, and reorder share `useGitOperationPoller`
(`features/git/hooks/`): `setInterval` in a ref cleared on unmount and repo switch;
workspace id plus a generation token captured per `start()` so stale ticks drop;
terminal jobs routed through per-operation `onSuccess` / `onFailure` / `onMissing` /
`isComplete`. Lifecycle in the hook, refresh and error semantics in the caller. Pull
also keeps its `pulling` flag and exposes the active job id to the WebSocket
`git-changed` handler.

### Branch range

`getBranchRange`, `listBranchRangeFiles`, `getBranchRangeDiff`, and
`getBranchRangeFileDiff` all accept `base=default-branch` (default) or `base=upstream`;
`BranchCommitStrip` toggles it, labeled with the server-resolved `baseRef`. `upstream`
diffs against `@{upstream}`, so only unpushed commits show.

`useBranchRangeBaseMode` persists the choice per workspace in `localStorage`.
`useBranchRangeCache` keys entries by `workspaceId:baseMode`; an explicit Refresh drops
every mode for the workspace. `createBranchRangeDiffSource` carries the mode into
file-diff URLs and its cache key. With no upstream the server falls back to the default
branch and sets `baseModeFallback`. Pop-out URLs serialize `&base=upstream`; the
default mode is omitted.

### Cherry-pick

Same-clone: the commit context menu opens `BranchPickerModal` as a local-branch
selector and sends hashes **oldest-first** through
`client.git.cherryPick(..., { hashes, targetBranch })`. Server dirty/conflict errors
show in the tab action banner; success refreshes and leaves the user on the original
branch after the server switches back.

Cross-clone (`features.gitCrossCloneCherryPick`, enabled by default):
`CrossCloneCherryPickModal` on the single- and multi-commit menus takes `commits[]`
ordered oldest-first via `orderOldestFirst`. It lists current-CoC registered workspaces
plus online registered remote-CoC workspaces through typed workspace/git-info clients,
keeps only clones of the source repository (`isSameRepoClone` from
`@plusplusoneplusplus/forge/git/repo-identity`: equal case-insensitive normalized
origins, or equal repo names when either side has no remote) and hides the rest with
no reveal toggle, groups the survivors by normalized remote URL, recommends
same-remote clones, labels each target with its CoC server (badge: `Same remote` or
`Remote unknown`), and requires explicit opt-in to stash a dirty target. The range exports as **one
concatenated `git am` mailbox**; the modal reports the applied count and names the
conflicting commit on a mid-range conflict. Local targets call
`git.exportCommitPatches` + `git.applyCommitPatch`; remote targets call the initiating
server's `servers.cherryPickTransfer` orchestrator with `source.commitHashes`.

The same-repo rule is enforced server-side too, so the API cannot be bypassed:
`/git/patch/export` reports `normalizedSourceRemoteUrl` **and** `sourceRepoName`, and
`/git/patch/apply` resolves the target's own identity and rejects anything that is not a
clone of the source with `400 { error, code: 'repo-mismatch' }` before preflight, `git am`,
or any stash. A request carrying no source identity is rejected the same way — there is no
override flag. `cherryPickTransfer` forwards `sourceRepoName` and propagates the 400 with
its code intact.

## Git worktree execution

`features.gitWorktreeExecution` (disabled by default) adds
`shared/WorktreeLaunchControls.tsx` to the launch dialogs
(`shared/RalphLaunchDialog.tsx`, `features/chat/RalphStartPanel.tsx`,
`features/work-items/WorkItemExecuteDialog.tsx`): an isolated-worktree checkbox, an
optional base ref/SHA field (empty defaults to `HEAD`), and the
uncommitted-source-changes warning. State is in `useWorktreeLaunchControls({ open })`;
per-target support comes from `useWorktreeCapability(apiBase, { enabled })` reading the
target's `/config/runtime`, so a remote target that does not advertise support disables
the option. The control renders nothing when the flag is off, the target lacks
capability, or the workspace is not a Git repo. Checked, it adds
`worktree: { enabled: true, baseRef? }` to the launch body.

`shared/WorktreeChip.tsx` (branch, base, status, copyable path) shows post-launch on
the Ralph session detail (`RalphWorkflowPane` header, `session.worktree`) and the Work
Item execution-history entry (`WorkItemDetail`, `execution.worktree` — see
[work-items.md](work-items.md)). Its opt-in cleanup affordance
(`onCleanup`/`canCleanup`/`cleanupError`, only for `status === 'active'`,
`window.confirm`-gated) is driven by `shared/useWorktreeCleanup.ts`.

`features/git/working-tree/WorktreeList.tsx` renders under the Git tab —
workspace-scoped, collapsible, only when the flag is on and ≥1 record exists — listing
each worktree with its linked task/session and a Cleanup action calling
`client.git.cleanupWorktree`. Success flips the row to `cleaned` locally; a `409`
(dirty or running) surfaces the raw Git error inline and leaves the record active.
**The branch is never deleted from the UI.**

## Diff classification

Classify-diff toolbars call `useModalJobAiSelection()` directly and render
`features/git/diff/ClassifyDiffAiControls.tsx`, which hides the provider chip when only
one provider is selectable and shows either an effort-tier selector or the
pickable-model command picker.

Categories: `logic`, `mechanical`, `test`, `simple`, `generated`; `simple` is
low-attention by default. PR and commit pop-out file rails show category badges plus a
critical marker, and their selected-file unified diff views render test fidelity
comments, logic summaries, and critical usage/call-stack evidence near each classified
hunk. Branch-range pop-out diff UI uses the compact classification-free path.

## Composer PR chips

`features/chat/conversation/ChatComposerPrChips.tsx` docks read-only PR chips **inside
the composer**, above the textarea, via the `prComposerChips` slot that
`FollowUpInputArea` renders as the first child of the input card. Nothing renders when
no PR is associated.

### Detection and binding

The detector itself is shared by the SPA and the server:
`@plusplusoneplusplus/forge/git/pull-request-detection` (`detectPullRequestsInToolGroup`,
`collectToolCallsFromTurns`, `syntheticRemoteUrlForDetectedPr`). It is pure
strings/regex — no React, no DOM, no Node built-ins — so one copy serves both.

`usePrChatStatusItems` unions PRs detected in loaded turns with persisted bindings
looked up by `task_id` (`listChatBindingsForOrigin(originId, { taskId })`). It resolves
each PR's canonical origin via `resolveCanonicalOriginId`, upserts a binding
(`createChatBindingForOrigin`) for any freshly-detected PR so it survives reload with
the creating turn collapsed, and fetches detail per row (`getForOrigin`) into per-row
loading/ready/error state with retry. Union and origin logic live in the pure
`conversation/prChatAssociation.ts`.

The client path only runs while a chat is open, so it is backstopped server-side:
`ProcessLifecycleRunner`'s `finally` calls
`processes/bind-detected-pull-requests.ts`, which re-runs the same detector over the
finished conversation's turns and upserts a binding. It is scoped to the workspace
remote, keyed by the **bare** task id (no `queue_` prefix, matching what the client
writes and reads), idempotent (`INSERT OR REPLACE`), and self-swallowing — a binding
failure never fails the task. Stores without `getDatabase`/`getConversationTurns` (e.g.
`FileProcessStore`) are a clean no-op.

Detection requires **positive evidence that this tool call created that PR**, because
each detection is written back as a binding and so is permanent. A tool call yields at
most **one** PR — the specific created URL, not every PR URL in its output. Read-only
PR commands, connector lookups, unsuccessful tool calls (`status` failed/pending/…),
and output with **no command metadata** are ignored.

Accepted evidence:
- the GitHub connector's create-pull-request tool;
- a `gh pr create` / `az repos pr create` command, including inside a shell-interpreter
  wrapper (`bash -lc '…'`, `/bin/bash -c "…"`, `sh -c '…'`) whose quoted payload is
  unwrapped and scanned — the **last** PR URL in the result is the created one, and a
  result matching `already exists:` (a failed create printing the pre-existing PR) is
  rejected outright;
- the `submit_commits_as_pr.py` wrapper's line-start
  `JSON: {... "pr_url": "...", "status": "done"}` line, which contributes **only that
  line's `pr_url`**. It is still recognized when surfaced by a later `grep`/`tail` of
  persisted stdout (the original output is often truncated under a large git dump), but
  only when the file being read is a path this chat's own PR-creation run named — so a
  grep that hits another run's log cannot pin that run's PR here;
- a known wrapper command whose untruncated result echoes a creating command.

Pass `options.remoteUrl` (threaded from the chat workspace's remote through
`gatherDetectedPrsFromTurns`) to scope detections to the chat's own
`owner/repo` — normalized via `normalizeRemoteUrl`, so SSH and `.git` forms match.
`unionAssociations` independently drops any detected PR whose origin is not the chat's
own. Timeline and flat `toolCalls` records are de-duplicated by tool-call id within
each turn; separate turns remain distinct because providers may restart tool-call ids
on each assistant turn.

### Chip contents

`ComposerPrChip` (presentational) shows, per PR: the `#number` opening the provider PR
URL from detail or detection — falling back to `PullRequestDetail` via
`buildPrDetailHash` only when no provider URL exists — the title, a lifecycle badge
(`prStatusBadge`), a reviewer badge (`summarizeReviewerApprovals` over eager-loaded
origin reviewers, with a popover separating approved, waiting, and change-requested
reviewers so names stay out of the chip), a checks badge (`summarizeCheckRows` over
eager-loaded `item.checks`, tinted by worst-active status, omitted until the fetch
resolves with ≥1 check), diff counts (`mapPrDetailToCardPr`'s `diffStats` via
`parseDiffStats`, omitted with no counts), a provider link, and dismiss. Loading rows
render a skeleton; error rows show the message plus retry.

Chips order newest-first. Dismiss hides the chip immediately **and** issues
`deleteChatBindingForOrigin(originId, prId)` (best-effort), so a dismissed PR does not
return on reload.

### Folding

Settled PRs fold so the stack cannot outgrow the textarea. The pure
`conversation/composerPrChipFold.ts` owns the split:
`partitionComposerPrChips(items, { activeCap = 3 })` sorts newest-first
(`sortNewestFirst`) and returns `{ head, folded }`:

1. Only `ready` + terminal chips fold (`isFoldableComposerPrChip`, keyed off shared
   `conversation/prTerminalStatus.ts`, also used by `PrStatusCard` and
   `prStatusFreshness`).
2. `loading` and `error` chips are pinned and never fold.
3. With nothing else expanded, the newest settled chip stays expanded, so the stack is
   never chip-less.
4. Ready open/draft chips fold past `activeCap`; a fold of fewer than two chips renders
   inline instead, since the fold row costs a row of its own.

`summarizeFoldedPrChips` tallies hidden chips into a count, a merged/closed breakdown,
the PR numbers, and up to `FOLD_DOT_LIMIT` (4) state dots for `ComposerPrFoldRow`.

Fold state is local to `ChatComposerPrChips`, defaults to closed, and is **not
persisted** — it derives from PR state, not user preference. Orthogonal to dismiss:
folding hides, dismissing unbinds, and dismiss still works on chips inside an expanded
fold.

### CI auto-fix

With `triggers.enabled` on, each chip carries CI auto-fix controls
(`usePrAutoFixTrigger`, gated on `isTriggersEnabled()` read in `ChatComposerPrChips`,
which threads the conversation `processId` + `workspaceId` down as an `autoFix` prop).

`ComposerPrChecksPopover` opens when ≥1 check is failing **or** when CI auto-fix is
available, so the monitor can be armed while checks are pending or green. Its Auto-fix
CI toggle arms/disarms a `ci-failure` condition-monitor trigger bound to the PR's
`originId`/`prId` and the conversation `processId`; it stays usable regardless of check
state, so an armed monitor can be disarmed after CI goes green. A separate
`fixNowDisabledReason` disables only the manual fix-now action, which sends one
`autopilot` message built by `prAutoFixPrompt.ts#buildCiFixPrompt` (a browser copy of
the server `ci-failure-prompt.ts` template) through `processes.sendMessage`.

All arm/disarm/list/fix calls route through workspace-scoped
`getCocClientForWorkspace(workspaceId).triggers` / `.processes` so remote-clone
conversations act on their owning server — never a raw `fetchApi`. Unresolved
PR/conversation context renders the controls disabled; with the flag off the toggle,
button, and badge are hidden and no trigger network calls are made.

### Polling and freshness

`mapPrDetailToCardPr` carries canonical `autoMerge`
(`{ enabled, state, enabledBy?, mergeMethod?, blockedReason? }`, mapped server-side
from GitHub REST `pulls.get` / ADO `autoCompleteSetBy`) and `diffStats` onto the card
PR.

`usePrChatStatusItems` eager-loads each ready row's checks (`getChecksForOrigin` once
detail resolves to `ready`, deduped via `checksStatusRef`, mapped by
`buildCheckRowsFromChecks`) and reviewers (`getReviewersForOrigin`, deduped via
`reviewersStatusRef`), and exposes `expandChecks`, `refresh(key?)`, `refreshingKeys`,
`lastUpdatedAt`, `isPolling`. `refresh()` with no key force-refreshes every row; with a
key, one. Both run silently with `{ force: true }` so rows do not flash a skeleton, and
only manually refreshed rows appear in `refreshingKeys`.

Freshness lives in the pure `conversation/prStatusFreshness.ts`.
`shouldPollPrStatusItems` is true only while some PR is non-terminal **and** has checks
pending/running, auto-merge armed/queued, or unresolved reviewer approval; it goes
false once everything is merged or closed. Because checks and reviewers are
eager-loaded, a never-expanded row with pending checks or waiting reviewers still keeps
the poll alive. `setInterval(PR_STATUS_POLL_INTERVAL_MS = 45s)` is armed only while
`isPolling`.

Force-refresh threads `{ force }` through
`getForOrigin`/`getReviewersForOrigin`/`getChecksForOrigin` to `?force=true`; the
reviewers and checks routes honour it by evicting their subresource caches, and the
detail route already evicts sub-caches.

`PrStatusCard` / `ChatPrStatusCard` and their pure helpers — `describeAutoMerge` /
`autoMergeLabel` / `prProviderFromUrl`, `summarizeLifecycleStatus` /
`summarizeMergeStatus` in `prMergeStatusSummary.ts`, the
`features/pull-requests/PrChecksSummary.tsx` chips, and `prStatusFreshness.ts` — stay
exported and unit-tested but are mounted nowhere.

## Pull Requests tab

Enabled by default via `pullRequests.enabled`. Admin → Configure → Features exposes
`pullRequests.suggestions` and `pullRequests.autoClassifyTeam`, both disabled by
default, through runtime config helpers.

List load, refresh, and open-by-number validation use
`client.pullRequests.listForOrigin` / `getForOrigin` against
`/api/origins/:originId/pull-requests...`, passing selected workspace/repo metadata so
provider calls run against a concrete clone while cache identity stays the canonical
origin.

### Queue rail and filters

Filters: All, Mine, Team, Blocked, Ready, plus the optional For You pill.

**Team** reads the origin-scoped coworker roster through `coc-client` and requests
`scope=team`. The server fetches provider `scope=all`, supplements with best-effort
per-roster-member queries (`login` when present, otherwise provider id), filters by the
roster **before** pagination, and returns the filtered total. Roster chips toggle for
transient in-session narrowing, are removed through the roster API, or are extended via
a debounced combobox searching repo PR authors at
`/api/origins/:originId/pull-requests/coworker-candidates`. The count badge reflects
the server-filtered loaded set, so roster matches beyond the current page appear after
Load more.

The rail's open-by-number/URL input validates through the origin PR detail API, records
opens at `/api/origins/:originId/pull-requests/recent-opened`, and lists them in a
recently-opened list using the same overview navigation path. Entries are removable via
the recent-opened DELETE API and drop automatically when opening one returns a
confirmed 404.

Queue rows use server-enriched provider/git diff stats for file count, review-minute
estimates, and deterministic risk tiers: **low** below 200 changed lines, **medium**
200–800, **high** above 800. Missing diff stats render unavailable queue metadata
rather than mock data.

### Server-side cache

The PR list route is backed by a server-side cache that can be proactively warmed for
the active workspace. Background warming reuses the tab's provider list and diff-stat
enrichment path, refreshes the default `open`/`mine` list without clearing stale data
on failure, and reads the origin-scoped recently opened list, Team roster, and cached
suggestions when PR suggestions are enabled.

### Team auto-classification

With Pull Requests, focused diff, and Team auto-classification all enabled, PR list
load/refresh and active-workspace background warming ask the server to enqueue at most
**10** missing low-priority classifications for loaded open Team PRs having a
`headSha`, skipping cached or running ones via the origin-scoped classify-diff store
and pending markers, and reading the origin-scoped Team roster.

PR file-list and pop-out classify controls build classification keys from the selected
workspace, repo, and canonical origin, then trigger and poll
`/api/origins/:originId/classify-diff`, so on-demand classifications share state across
same-origin clones. The Team toolbar reads
`/api/origins/:originId/classify-diff/batch-status` for loaded Team PR identifiers and
shows disabled/idle/queueing/running/ready status plus cached/running/missing counts,
adding row-level badges without changing filters, grouping, ordering, or risk tiers.
Its classify-now action posts to
`/api/origins/:originId/pull-requests/team-auto-classification` with workspace/repo
metadata, so manual requests share the server cap and skip logic instead of
client-side POST loops.

### Detail, pop-outs, and suggestions

The detail overview renders a deterministic review-summary card from the PR
description, parsed/provider diff stats, checks, reviewers, and comment threads, with
findings derived from failing checks and unresolved threads.

Review pop-outs carry the selected workspace's resolved origin ID in the pop-out URL,
load title and head metadata through the origin detail API, and hydrate and persist
reviewed/visited file progress through
`client.pullRequests.getReviewProgressForOrigin` / `saveReviewProgressForOrigin`
against `/api/origins/:originId/pull-requests/:prId/review-progress`, passing
workspaceId/repoId metadata for pre-origin migration only.

Pop-out file views expose a full-context toggle calling the per-file diff endpoint with
`fullContext=true`. The server first tries a full-file-context git diff from PR
`baseSha` to `headSha`, fetches missing PR commits into the requested checkout when
possible, and only then returns the hunk-only diff with `fullContextUnavailable: true`.

PR review suggestions sit behind `pullRequests.suggestions`. The For You filter's
generate/refresh action first refreshes origin-scoped review history via
`/api/origins/:originId/pull-requests/review-history/refresh`, then ranks open PRs via
`/api/origins/:originId/pull-requests/suggestions/refresh` and caches the result under
the same origin. The UI shows inline progress, empty-state guidance, and recovery
messages for missing review history or provider errors.
