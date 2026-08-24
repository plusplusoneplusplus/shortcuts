# Dashboard SPA — Git & Pull Requests

The Git tab and its controller family, branch-range and cherry-pick flows, worktree
execution controls, diff classification, the composer PR chips, and the Pull Requests
tab.

## Git tab

`features/git/RepoGitTab.tsx` is a composition shell over the controller family in
`features/git/repoGitTab/`:

| Controller | Owns |
|---|---|
| `useRepoGitData` | Commits, branch range, repo state, caches, `refreshAll` |
| `useRepoGitSelection` | Right-panel routing, URL hash + AppContext sync, deep links, direct SHA lookup |
| `useGitOperationActions` | Every mutation plus all four job pollers |
| `useGitAutoPullController` | Automatic pull scheduling |
| `useGitSkillActions` | Commit-context skill runs |

Pure helpers `selectionModel`, `gitPrompts`, and `gitContextMenuModel` sit alongside
the `RepoGitListPane` / `RepoGitDetailPane` / `RepoGitOverlays` presentation
components. **Every hook takes `workspaceId` explicitly and reads its client through
`useCocClient(workspaceId)`**, so git, queue, and preferences traffic targets the
selected clone's server.

`useGitOperationActions` owns the pull poller and hands it to
`useGitAutoPullController`, so a manual and an automatic pull can never poll
concurrently. Auto-pull skips and failures report through the shared
`useTransientToast` rather than the `actionError` banner.

### Job polling

A git operation response carrying a `jobId` is pending work: the tab polls operation
history until terminal status before refreshing. Failed Drop Commit jobs render the
tab-level action-error banner.

Pull, rebase autosquash, drop commit, and reorder share `useGitOperationPoller`
(`features/git/hooks/`). It owns each poll's `setInterval` in a ref and clears it on
unmount and repo switch, captures the workspace id plus a generation token per
`start()` so stale ticks are dropped, and routes terminal jobs through per-operation
`onSuccess` / `onFailure` / `onMissing` / `isComplete` callbacks — lifecycle in the
hook, refresh and error semantics in the caller. Pull additionally keeps its `pulling`
flag and exposes the active job id to the WebSocket `git-changed` handler.

### Branch range

All four branch-range helpers (`getBranchRange`, `listBranchRangeFiles`,
`getBranchRangeDiff`, `getBranchRangeFileDiff`) accept a `base` query of
`default-branch` (default) or `upstream`. `BranchCommitStrip` exposes this as a
**vs main | unpushed** toggle labeled with the server-resolved `baseRef`; `upstream`
diffs against `@{upstream}` so only unpushed commits show.

`useBranchRangeBaseMode` remembers the choice per workspace in `localStorage`,
`useBranchRangeCache` keys entries by `workspaceId:baseMode` (an explicit Refresh
drops every mode for the workspace), and `createBranchRangeDiffSource` carries the
mode into its file-diff URLs and cache key. When the branch has no upstream the server
falls back to the default branch and sets `baseModeFallback`, which the strip shows as
a one-line note. Pop-out URLs serialize the mode as `&base=upstream`; the default mode
is omitted.

### Cherry-pick

The same-clone commit context menu opens `BranchPickerModal` as a local-branch
selector for `Cherry-pick to branch…`, sends selected hashes **oldest-first** through
`client.git.cherryPick(..., { hashes, targetBranch })`, shows server dirty/conflict
errors in the tab action banner, refreshes on success, and keeps the user on the
original branch after the server switches back.

`features.gitCrossCloneCherryPick` (enabled by default) adds
`CrossCloneCherryPickModal` to the single- and multi-commit menus, taking a `commits[]`
ordered oldest-first via `orderOldestFirst`. It lists current-CoC registered workspaces
plus online registered remote-CoC workspaces using typed workspace/git-info clients,
groups targets by normalized remote URL, recommends same-remote clones, labels each
target with its CoC server, and requires explicit confirmation for a cross-remote
target and explicit opt-in to stash a dirty target.

The modal exports the whole range as **one concatenated `git am` mailbox** and reports
the applied count ("applied k of N", or a partial count with the conflicting commit on
a mid-range conflict). Local targets call `git.exportCommitPatches` +
`git.applyCommitPatch` directly; remote targets call the initiating server's
`servers.cherryPickTransfer` orchestrator with `source.commitHashes`.

## Git worktree execution

With `features.gitWorktreeExecution` enabled (disabled by default), the launch dialogs
(`shared/RalphLaunchDialog.tsx`, `features/chat/RalphStartPanel.tsx`,
`features/work-items/WorkItemExecuteDialog.tsx`) render the shared
`shared/WorktreeLaunchControls.tsx`: a "Use isolated Git worktree" checkbox and, when
checked, an optional "Base ref/SHA" field (empty defaults to current `HEAD`) plus the
uncommitted-source-changes-excluded warning.

State lives in `useWorktreeLaunchControls({ open })`. Per-target support is resolved by
`useWorktreeCapability(apiBase, { enabled })`, which fetches the target's
`/config/runtime`, so a remote target that does not advertise support disables the
option with an explanation. The control renders nothing when the flag is off, the
target lacks capability, or the workspace is not a Git repo. When checked it adds
`worktree: { enabled: true, baseRef? }` to the launch body.

Post-launch visibility uses the presentational `shared/WorktreeChip.tsx` (branch, base,
status, copyable path) on the Ralph session detail (`RalphWorkflowPane` header, reading
`session.worktree`) and the Work Item execution-history entry (`WorkItemDetail`,
reading `execution.worktree`). The chip has an opt-in cleanup affordance
(`onCleanup`/`canCleanup`/`cleanupError`, shown only for `status === 'active'`,
`window.confirm`-gated) driven by `shared/useWorktreeCleanup.ts`.

`features/git/working-tree/WorktreeList.tsx` renders under the Git tab —
workspace-scoped, collapsible, only when the flag is on and at least one record exists
— listing each worktree with its linked task/session and a Cleanup action. Cleanup
calls `client.git.cleanupWorktree`; success flips the row to `cleaned` locally, and a
`409` (dirty or running) surfaces the raw Git error inline and leaves the record
active. **The branch is never deleted from the UI.**

## Diff classification

Classify-diff toolbars call `useModalJobAiSelection()` directly and render
`features/git/diff/ClassifyDiffAiControls.tsx`, an inline toolbar variant that hides
the provider chip when only one provider is selectable and shows either an effort-tier
selector or the pickable-model command picker.

Categories are `logic`, `mechanical`, `test`, `simple`, and `generated`; `simple` is
labeled "Simple function" and is low-attention by default. PR and commit pop-out file
rails show compact category badges plus a critical marker, and their selected-file
unified diff views render test fidelity comments, logic summaries, and critical
usage/call-stack evidence inline near each classified hunk. Branch-range pop-out diff
UI uses the compact classification-free path.

## Composer PR chips

`features/chat/conversation/ChatComposerPrChips.tsx` docks a stack of compact,
read-only PR chips **inside the composer**, above the textarea, via the
`prComposerChips` slot that `FollowUpInputArea` renders as the first child of the input
card. There is no top-of-thread PR card, and the stack renders nothing when no PR is
associated. Its first row sits flush with the composer card
(`rounded-t-lg overflow-hidden`), and each chip's bottom border doubles as the divider
above the textarea.

### Detection and binding

`usePrChatStatusItems` unions PRs detected in loaded turns (`pullRequestDetection.ts`)
with persisted bindings looked up by `task_id`
(`listChatBindingsForOrigin(originId, { taskId })`). It resolves each PR's canonical
origin through `resolveCanonicalOriginId`, upserts a binding
(`createChatBindingForOrigin`) for any freshly-detected PR so it survives reload with
the creating turn collapsed, and fetches PR detail per row (`getForOrigin`) into
per-row loading/ready/error state with retry. The union and origin logic are in the
pure `conversation/prChatAssociation.ts`.

Detection requires PR-**creation** evidence — read-only PR commands and connector
lookups are ignored. It accepts:

- The GitHub connector's create-pull-request tool.
- A `gh pr create` / `az repos pr create` shell command, including when the harness
  serializes it inside a shell-interpreter wrapper (`bash -lc '…'`, `/bin/bash -c "…"`,
  `sh -c '…'`), whose quoted payload is unwrapped and scanned.
- The `submit_commits_as_pr.py` wrapper's structured success line — a line-start
  `JSON: {... "pr_url": "...", "status": "done"}`. This is recognized even when
  surfaced by a later `grep`/`tail` of the wrapper's persisted stdout, because the
  original command output is often truncated under a large git dump.
- A known wrapper command whose untruncated result echoes a creating command, or
  output with no command metadata.

### Chip contents

`ComposerPrChip` (presentational) shows a git glyph, a pin marker, the `#number`
(opening the provider PR URL from detail or detection, falling back to
`PullRequestDetail` via `buildPrDetailHash` only when no provider URL exists), the
title, the lifecycle badge (`prStatusBadge` — Open / Draft / Merged / Closed), a
reviewer-count badge (`approved/total reviewers` via `summarizeReviewerApprovals` on
eager-loaded origin reviewers, with a popover separating approved, waiting, and
change-requested reviewers — names stay out of the chip), a CI-checks badge
(`✓ passing/total` via `summarizeCheckRows` on eager-loaded `item.checks`, tinted by
worst-active status, omitted until the fetch resolves with ≥1 check), the
`+adds / −dels` diff (`mapPrDetailToCardPr`'s `diffStats`, parsed by `parseDiffStats`,
omitted with no counts), a **View** provider link, and a ✕ dismiss. Loading rows render
a skeleton; error rows show the message plus Retry and View.

Chips order newest-first. A ✕ dismiss hides the chip for the session; a fresh detection
or binding re-surfaces it on reload.

### Folding

Settled PRs fold so the stack cannot outgrow the textarea above it. The pure
`conversation/composerPrChipFold.ts` owns the split:
`partitionComposerPrChips(items, { activeCap = 3 })` sorts newest-first
(`sortNewestFirst`) and returns `{ head, folded }` under four rules:

1. Only `ready` + terminal chips fold (`isFoldableComposerPrChip`, keyed off the shared
   `conversation/prTerminalStatus.ts`, which `PrStatusCard` and `prStatusFreshness`
   also use).
2. `loading` and `error` chips are pinned and never fold.
3. When nothing else is expanded, the newest settled chip stays expanded, so the stack
   is never chip-less.
4. Ready open/draft chips fold past `activeCap`, and a fold of fewer than two chips
   renders inline instead — the fold row costs a row of its own.

`summarizeFoldedPrChips` tallies the hidden chips into a count, a `4 merged · 1 closed`
breakdown, the PR numbers, and up to `FOLD_DOT_LIMIT` (4) state dots that
`ComposerPrFoldRow` renders as one compact row, so you can tell whether anything folded
needs attention without expanding it.

Fold state is local to `ChatComposerPrChips`, defaults to closed, and is **not
persisted** — it is derived from PR state, not a user preference. It is orthogonal to
dismiss: folding hides, dismissing removes for the session, and ✕ still works on chips
inside an expanded fold.

### CI auto-fix

With `triggers.enabled` on, each chip carries CI auto-fix controls
(`usePrAutoFixTrigger`, gated on `isTriggersEnabled()` read in `ChatComposerPrChips`,
which threads the conversation `processId` + `workspaceId` down as an `autoFix` context
prop).

The checks-badge popover (`ComposerPrChecksPopover`) opens when ≥1 check is failing
**or** when CI auto-fix is available, so the monitor can be armed proactively while
checks are still pending or green — with no failures the badge would otherwise be a
non-interactive pill. Its "Auto-fix CI" toggle arms and disarms a `ci-failure`
condition-monitor trigger bound to that PR's `originId`/`prId` and the conversation
`processId`. The toggle stays usable regardless of check state; a separate
`fixNowDisabledReason` disables only the manual "Fix now" button when nothing is
failing. Because the toggle is failure-independent, an armed monitor can also be
disarmed after CI goes green.

"Fix now" sends one `autopilot` message built by
`prAutoFixPrompt.ts#buildCiFixPrompt` — a browser copy of the server
`ci-failure-prompt.ts` template — through `processes.sendMessage`.

All arm/disarm/list/fix calls route through the workspace-scoped
`getCocClientForWorkspace(workspaceId).triggers` / `.processes`, so remote-clone
conversations act on their owning server; never a raw `fetchApi`. With unresolved
PR/conversation context the controls render disabled with a tooltip; with the flag off
the toggle, button, and badge are hidden and no trigger network calls are made.

### Polling and freshness

`mapPrDetailToCardPr` carries the canonical `autoMerge`
(`{ enabled, state, enabledBy?, mergeMethod?, blockedReason? }`, mapped server-side
from GitHub REST `pulls.get` / ADO `autoCompleteSetBy`) and `diffStats` onto the card
PR.

`usePrChatStatusItems` eager-loads each ready row's CI checks (`getChecksForOrigin`
once detail resolves to `ready`, deduped via `checksStatusRef`, mapped by
`buildCheckRowsFromChecks`) and reviewers (`getReviewersForOrigin`, deduped via
`reviewersStatusRef`). It exposes `expandChecks`, `refresh(key?)`, `refreshingKeys`,
`lastUpdatedAt`, and `isPolling`. `refresh()` with no key force-refreshes every row;
with a key it refreshes one. Both run silently with `{ force: true }` so rows do not
flash a skeleton, and only manually refreshed rows appear in `refreshingKeys` — the
smart poll adds nothing to it.

Freshness lives in the pure `conversation/prStatusFreshness.ts`.
`shouldPollPrStatusItems` returns true only while some PR is non-terminal **and** has
checks pending/running, auto-merge armed/queued, or unresolved reviewer approval — it
goes false once everything is merged or closed. Because checks and reviewers are
eager-loaded, a never-expanded row with pending checks or waiting reviewers still keeps
the poll active. An internal `setInterval(PR_STATUS_POLL_INTERVAL_MS = 45s)` is armed
only while `isPolling` and torn down once everything settles.

Force-refresh threads `{ force }` through
`getForOrigin`/`getReviewersForOrigin`/`getChecksForOrigin` to the `?force=true` query,
which the reviewers and checks routes honour by evicting their subresource caches; the
detail route already evicts sub-caches.

The presentational card components `PrStatusCard` / `ChatPrStatusCard` and their pure
helpers — `describeAutoMerge` / `autoMergeLabel` / `prProviderFromUrl`,
`summarizeLifecycleStatus` / `summarizeMergeStatus` in `prMergeStatusSummary.ts`, the
`features/pull-requests/PrChecksSummary.tsx` chips, and `prStatusFreshness.ts` — stay
exported and unit-tested but are not mounted anywhere.

## Pull Requests tab

Enabled by default through `pullRequests.enabled`. Admin → Configure → Features exposes
`pullRequests.suggestions` and `pullRequests.autoClassifyTeam`, both disabled by
default, flowing through runtime config helpers.

List load, refresh, and open-by-number validation use
`client.pullRequests.listForOrigin` / `getForOrigin` against
`/api/origins/:originId/pull-requests...`, passing the selected workspace/repo metadata
so provider calls run against a concrete clone while cache identity stays the canonical
origin.

### Queue rail and filters

Filters are All, Mine, Team, Blocked, Ready, and the optional For You pill.

**Team** reads the origin-scoped coworker roster through `coc-client` and requests
`scope=team`; the server fetches provider `scope=all`, supplements with best-effort
per-roster-member queries (`login` when present, otherwise provider id), filters by the
roster **before** pagination, and returns the filtered total. The rail then shows
roster chips that can be toggled for transient in-session narrowing, removed through
the roster API, or extended with a debounced text combobox searching repo PR authors
via `/api/origins/:originId/pull-requests/coworker-candidates`. The count badge
reflects the server-filtered loaded set, so roster matches beyond the current page
appear after Load more.

The rail starts with the "Open PR by # or URL" input. Successful opens are validated
through the origin PR detail API, recorded through
`/api/origins/:originId/pull-requests/recent-opened`, and listed in a compact "Recently
opened" list below the input. Entries stay hidden when empty or when the rail is
collapsed, open through the same overview navigation path, can be removed through the
recent-opened DELETE API, and drop automatically when opening one returns a confirmed
404.

Queue rows use server-enriched provider/git diff stats for file count, review-minute
estimates, and deterministic risk tiers: **low** below 200 changed lines, **medium**
200 through 800, **high** above 800. Missing diff stats render unavailable queue
metadata rather than falling back to mock data.

### Server-side cache

The PR list route is backed by a server-side cache that can be proactively warmed for
the active workspace. Background warming uses the same provider list and diff-stat
enrichment path as the tab load, refreshes the default `open`/`mine` list without
clearing stale data on failure, and reads the origin-scoped recently opened list, Team
roster, and cached suggestions when PR suggestions are enabled.

### Team auto-classification

With Pull Requests, focused diff, and Team auto-classification all enabled, PR list
load/refresh and active-workspace background warming ask the server to enqueue at most
**10** missing low-priority classifications for loaded open Team PRs that have a
`headSha`, skipping cached or running ones through the origin-scoped classify-diff
store and pending markers, and reading the origin-scoped Team roster.

PR file-list and pop-out classify controls build classification keys from the selected
workspace, repo, and canonical origin, then trigger and poll
`/api/origins/:originId/classify-diff`, so on-demand classifications share state across
same-origin clones. The Team toolbar reads
`/api/origins/:originId/classify-diff/batch-status` for loaded Team PR identifiers and
shows disabled/idle/queueing/running/ready status text plus cached/running/missing
counts, adding row-level badges without changing filters, grouping, ordering, or
deterministic risk tiers. Its "Classify now" posts to
`/api/origins/:originId/pull-requests/team-auto-classification` with workspace/repo
metadata, so manual requests use the same server cap and skip logic instead of
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

Pop-out file views expose a Full context toggle calling the per-file diff endpoint with
`fullContext=true`. The server first tries a full-file-context git diff from PR
`baseSha` to `headSha`, fetches missing PR commits into the requested checkout when
possible, and only then returns the hunk-only diff with `fullContextUnavailable: true`
— the banner shows only for that fallback.

PR review suggestions sit behind `pullRequests.suggestions`. The `For You` filter's
`Generate suggestions` / `Refresh` action first refreshes origin-scoped review history
through `/api/origins/:originId/pull-requests/review-history/refresh`, then asks the
server to rank open PRs through `/api/origins/:originId/pull-requests/suggestions/refresh`
and cache the result under the same origin. The UI shows inline progress, empty-state
guidance, and recovery messages for missing review history or provider errors.
