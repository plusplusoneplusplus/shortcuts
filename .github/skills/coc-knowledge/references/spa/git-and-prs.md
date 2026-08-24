# Dashboard SPA — Git & Pull Requests

`features/chat/conversation/ChatComposerPrChips.tsx` docks a stack of compact,
read-only PR chips **inside the composer** (above the textarea, via the
`prComposerChips` slot that `FollowUpInputArea` renders as the first child of the
input card) for chats that created pull requests — there is no top-of-thread PR
card. The
`usePrChatStatusItems` hook unions PRs detected in the loaded turns
(`pullRequestDetection.ts`, no new regex) with persisted bindings looked up by
`task_id`. Detection requires PR-creation evidence from the GitHub connector's
create-pull-request tool, or per shell tool call: a `gh pr create` /
`az repos pr create` command — including when the harness serializes it inside a
shell-interpreter wrapper (`bash -lc '…'`, `/bin/bash -c "…"`, `sh -c '…'`), whose
quoted payload is unwrapped and scanned so the wrapped command still matches — a
result carrying the
`submit_commits_as_pr.py` wrapper's structured success line (a line-start
`JSON: {... "pr_url": "...", "status": "done"}` — recognized even when surfaced
by a later `grep`/`tail` of the wrapper's persisted stdout, since the original
command output is often truncated under a large git dump), a known wrapper
command whose untruncated result echoes a creating command, or output with no
command metadata; read-only PR commands and connector lookups are ignored. The
hook looks up bindings by `task_id`
(`listChatBindingsForOrigin(originId, { taskId })`), resolves each
PR's canonical origin through `resolveCanonicalOriginId`, upserts a binding
(`createChatBindingForOrigin`) for any freshly-detected PR so it survives reload
with the creating turn collapsed, and fetches PR detail per row
(`getForOrigin`) into per-row loading/ready/error state with retry. The union
and origin logic live in the pure `conversation/prChatAssociation.ts` module.
Each chip (`ComposerPrChip`, presentational) shows a git glyph, a pin marker, the
`#number` (opening the provider PR URL from detail/detection, falling back to
`PullRequestDetail` via `buildPrDetailHash` only when no provider URL exists), the
title, the lifecycle status badge (`prStatusBadge` — Open / Draft / Merged /
Closed), a reviewer-count badge (`approved/total reviewers`, via
`summarizeReviewerApprovals` on eager-loaded origin reviewers; names stay out of
the chip and a lightweight popover separates approved, waiting, and
change-requested/blocking reviewers), a CI-checks count badge (`✓ passing/total`
like `10/30`, via `summarizeCheckRows` on the eager-loaded `item.checks`; tinted
red/amber/blue/green by worst-active status, omitted until the checks fetch
resolves with ≥1 check), the `+adds / −dels` diff (from
`mapPrDetailToCardPr`'s `diffStats`, parsed by `parseDiffStats`; omitted when the
detail carries no counts), a filled **View** provider link, and a ✕ dismiss. A loading row renders a skeleton; an error
row shows the message plus Retry and View. `ChatComposerPrChips` orders chips
newest-first, hides any the user ✕-dismisses for the session (a fresh detection
or binding re-surfaces it on reload), and renders nothing when no PR is
associated, so the composer keeps no PR chrome otherwise. The stack's first row
sits flush with the composer card via `rounded-t-lg overflow-hidden`, and each
chip's bottom border doubles as the divider above the textarea.

Settled PRs fold so the stack cannot out-grow the textarea it sits above. The
pure `conversation/composerPrChipFold.ts` owns the split:
`partitionComposerPrChips(items, { activeCap = 3 })` sorts newest-first
(`sortNewestFirst`) and returns `{ head, folded }` under four rules — only
`ready` + terminal chips fold (`isFoldableComposerPrChip`, keyed off the shared
`conversation/prTerminalStatus.ts`, which `PrStatusCard` and `prStatusFreshness`
also use); `loading`/`error` chips are pinned and never fold; when nothing else
is expanded the newest settled chip stays expanded so the stack is never
chip-less; a fold of fewer than two chips renders inline instead (the fold row
costs a row of its own); and ready open/draft chips fold past `activeCap`.
`summarizeFoldedPrChips` tallies the hidden chips into the count, a
`4 merged · 1 closed` breakdown, the PR numbers, and up to `FOLD_DOT_LIMIT` (4)
state dots that `ComposerPrFoldRow` renders as one compact `py-1` row — so you
can tell whether anything folded needs attention without expanding it. Fold
state is local to `ChatComposerPrChips`, defaults to closed, and is not
persisted (it is derived from PR state, not a user preference). It is orthogonal
to dismiss: folding hides, dismissing removes for the session, and ✕ still works
on chips rendered inside an expanded fold.

When the `triggers.enabled` flag is on, each chip also carries CI auto-fix
controls (`usePrAutoFixTrigger`, gated on `isTriggersEnabled()` read in
`ChatComposerPrChips`, which threads the conversation `processId` + `workspaceId`
down as an `autoFix` context prop). The checks-badge popover
(`ComposerPrChecksPopover`) opens when ≥1 check is failing **or** when CI
auto-fix is available, so the monitor can be armed proactively while checks are
still pending/green (with no failures the badge would otherwise be a plain,
non-interactive pill). It gains an "Auto-fix CI" toggle that arms/disarms a
`ci-failure` condition-monitor trigger bound to that PR's `originId`/`prId` and
the conversation `processId`. The toggle stays usable regardless of current
check state; a separate `fixNowDisabledReason` disables only the manual "Fix
now" button when nothing is failing. "Fix now" sends one `autopilot` fix message
(`prAutoFixPrompt.ts#buildCiFixPrompt`, a browser copy of the server
`ci-failure-prompt.ts` template) via `processes.sendMessage`. While a monitor is
armed the chip shows an "Auto-fix on" badge — and because the toggle is
failure-independent, that monitor can also be disarmed after CI goes green. All arm/disarm/list/fix calls route
through the workspace-scoped `getCocClientForWorkspace(workspaceId).triggers` /
`.processes` (so remote-clone conversations act on their owning server — never a
raw `fetchApi`). When the PR/conversation context is unresolved the controls
render disabled with an explanatory tooltip; when the flag is off the toggle,
button, and badge are hidden and no trigger network calls are made.

`mapPrDetailToCardPr` carries the canonical `autoMerge`
(`{ enabled, state, enabledBy?, mergeMethod?, blockedReason? }`, mapped
server-side from GitHub REST `pulls.get` / ADO `autoCompleteSetBy`) and
`diffStats` onto the card PR. The legacy presentational card components
(`PrStatusCard` / `ChatPrStatusCard`) and their pure helpers — `describeAutoMerge`
/ `autoMergeLabel` / `prProviderFromUrl`, `summarizeLifecycleStatus` /
`summarizeMergeStatus` in `prMergeStatusSummary.ts`, the
`features/pull-requests/PrChecksSummary.tsx` chips, and freshness in
`prStatusFreshness.ts` — remain exported and unit-tested but are no longer
mounted. `usePrChatStatusItems` still eager-loads each ready row's CI checks
(`getChecksForOrigin` once detail resolves to `ready`, deduped via
`checksStatusRef`, mapped by `buildCheckRowsFromChecks`) and reviewers
(`getReviewersForOrigin` once detail resolves to `ready`, deduped via
`reviewersStatusRef`) and exposes
`expandChecks`, `refresh(key?)` (force-refreshes one row by `key`, or every row
when called with no key — the composer chips pass their own key for a per-row
refresh; the card's single control refreshes all — always running silently with
`{ force: true }` so rows don't flash a skeleton), `refreshingKeys` (the set of
row keys with a manual refresh in flight, so only the refreshed rows' controls
spin; the smart poll refreshes silently and adds nothing to it), `lastUpdatedAt`,
and `isPolling`. Freshness lives in the pure
`conversation/prStatusFreshness.ts`: `shouldPollPrStatusItems` returns true only
while some PR is non-terminal AND has checks pending/running, auto-merge
armed/queued, or unresolved reviewer approval (false once all merged/closed;
because checks/reviewers are eager-loaded, a never-expanded row with pending
checks or waiting reviewers still keeps the poll active); an internal
`setInterval(PR_STATUS_POLL_INTERVAL_MS = 45s)` is armed only while `isPolling`
is true and torn down once everything settles. Force-refresh threads through
`getForOrigin`/`getReviewersForOrigin`/`getChecksForOrigin` `{ force }` to the
`?force=true` query, which the reviewers and checks routes honour by evicting
their subresource caches (the detail route already evicts sub-caches).

Classify-diff toolbars call `useModalJobAiSelection()` directly and render
`features/git/diff/ClassifyDiffAiControls.tsx`, an inline toolbar variant that
hides the provider chip when only one provider is selectable and shows either
an effort-tier selector or the pickable-model command picker. Diff
classification categories are `logic`, `mechanical`, `test`, `simple`, and
`generated`; `simple` is labeled "Simple function" and remains low-attention by
default. PR and commit popout file rails show compact category badges plus a
critical marker, and their selected-file unified diff views render test fidelity
comments, logic summaries, and critical usage/call-stack evidence inline near
each classified hunk; branch-range popout diff UI stays on the compact
classification-free path.

### Git worktree execution controls

When `features.gitWorktreeExecution` is enabled, the launch dialogs
(`shared/RalphLaunchDialog.tsx`, `features/chat/RalphStartPanel.tsx`,
`features/work-items/WorkItemExecuteDialog.tsx`) render the shared
`shared/WorktreeLaunchControls.tsx` — an "Use isolated Git worktree" checkbox and,
when checked, an optional "Base ref/SHA" field (empty defaults to current `HEAD`)
plus the uncommitted-source-changes-excluded warning. State lives in the
`useWorktreeLaunchControls({ open })` hook; per-target support is resolved by
`useWorktreeCapability(apiBase, { enabled })`, which fetches the target's
`/config/runtime` so a remote target that does not advertise support disables the
option with an explanatory message. The control renders nothing when the flag is
off, the target lacks capability, or the workspace is not a Git repo, and when
checked it adds `worktree: { enabled: true, baseRef? }` to the launch body.

Post-launch visibility uses the presentational `shared/WorktreeChip.tsx` (branch,
base, status, copyable path). It appears on the Ralph session detail
(`RalphWorkflowPane` header, reading `session.worktree`) and the Work Item
execution-history entry (`WorkItemDetail`, reading `execution.worktree`). The chip
has an opt-in cleanup affordance (`onCleanup`/`canCleanup`/`cleanupError` props,
shown only for `status === 'active'`, `window.confirm`-gated) driven by the shared
`shared/useWorktreeCleanup.ts` hook. A repo-scoped
`features/git/working-tree/WorktreeList.tsx` renders under the Git tab
(`RepoGitTab`) — workspace-scoped, collapsible, only when the flag is on and ≥1
record exists — listing each worktree with its linked task/session and a Cleanup
action. Cleanup calls `client.git.cleanupWorktree`; success flips the row to
`cleaned` locally, a `409` (dirty/running) surfaces the raw Git error inline and
leaves the record active. The branch is never deleted from the UI.

## Pull Requests Tab

The Pull Requests tab is enabled by default through `pullRequests.enabled`. Admin -> Configure -> Features exposes both `pullRequests.suggestions` and `pullRequests.autoClassifyTeam`; both are disabled by default and flow through runtime config helpers. PR list load/refresh and open-by-number validation use `client.pullRequests.listForOrigin` / `getForOrigin` against `/api/origins/:originId/pull-requests...`, passing the selected workspace/repo metadata so provider calls run against a concrete clone while cache identity remains the canonical origin. When Pull Requests, focused diff, and Team auto-classification are enabled, PR list load/refresh and active-workspace background warming ask the server to enqueue at most 10 missing low-priority classifications for loaded open Team PRs with `headSha`, skipping cached or running classifications through the origin-scoped classify-diff store/pending markers and reading the origin-scoped Team roster. PR file-list and pop-out classify controls build classification keys with the selected workspace, repo, and canonical origin, then trigger/poll `/api/origins/:originId/classify-diff` so on-demand PR classifications share state across same-origin clones. The Team toolbar reads `/api/origins/:originId/classify-diff/batch-status` for loaded Team PR identifiers, shows disabled/idle/queueing/running/ready status text plus cached/running/missing counts, and adds row-level AI classification badges without changing filters, grouping, ordering, or deterministic risk tiers. Its "Classify now" control posts to `/api/origins/:originId/pull-requests/team-auto-classification` with the selected workspace/repo metadata, so manual requests use the same server cap/skip logic instead of client-side POST loops while still selecting a concrete clone for queue routing. The left queue rail starts with the "Open PR by # or URL" input; successful opens from that input are validated through the origin PR detail API, recorded through the `/api/origins/:originId/pull-requests/recent-opened` API, and shown in a compact "Recently opened" list directly below the input. Recent entries stay hidden when empty or when the rail is collapsed, open through the same overview navigation path, expose a hover/focus-revealed remove control that deletes the entry from the origin list through the recent-opened DELETE API, and also drop automatically when opening one returns a confirmed 404. PR review pop-outs carry the selected workspace's resolved origin ID in the pop-out URL, load PR title/head metadata through the origin detail API, and hydrate/persist reviewed/visited file progress through `client.pullRequests.getReviewProgressForOrigin` / `saveReviewProgressForOrigin` against `/api/origins/:originId/pull-requests/:prId/review-progress`, while still passing workspaceId/repoId metadata for legacy migration only.

Queue filters include All, Mine, Team, Blocked, Ready, and the optional For You pill. Team reads the origin-scoped coworker roster through `coc-client`, requests the PR list with `scope=team`, and relies on the server to fetch provider `scope=all`, supplement with best-effort per-roster-member provider queries (`login` when present, otherwise provider id), filter by the origin-scoped roster before pagination, and return the filtered total. When Team is active, the rail shows roster chips that can be toggled for transient in-session narrowing, removed through the roster API, and extended with a debounced text combobox that searches repo PR authors through `/api/origins/:originId/pull-requests/coworker-candidates` using the selected workspace/repo metadata instead of only currently loaded rows. Its count badge reflects the server-filtered loaded PR set, so additional roster matches beyond the current page appear after Load more fetches them.

Queue rows use server-enriched provider/git diff stats for file count, review-minute estimates, and deterministic risk tiers: low below 200 changed lines, medium from 200 through 800, and high above 800. Missing diff stats render unavailable queue metadata instead of falling back to mock data.

The PR list route is backed by a server-side cache that can be proactively warmed
for the currently active workspace. Background warming uses the same provider
list and diff-stat enrichment path as the tab load, refreshes the default
`open`/`mine` list without clearing stale data on failure, and reads the
origin-scoped recently opened list, origin-scoped Team roster, and origin-scoped
cached suggestions when PR suggestions are enabled.

The PR detail overview renders a deterministic review-summary card from the PR description, parsed/provider diff stats, checks, reviewers, and comment threads. Findings are derived from failing checks and unresolved threads, and the former persona-lens grid is not rendered.

PR popout file views expose a Full context toggle that calls the PR per-file diff endpoint with `fullContext=true`. The server first tries a full-file-context git diff from PR `baseSha` to `headSha`, fetches missing PR commits into the requested repo checkout when possible, and only then returns the hunk-only diff with `fullContextUnavailable: true`; the banner is shown only for that fallback response.

PR review suggestions remain behind the separate `pullRequests.suggestions` config flag. The `For You` filter includes a `Generate suggestions`/`Refresh` action that first refreshes origin-scoped review history through `/api/origins/:originId/pull-requests/review-history/refresh`, then asks the server to rank open PRs through `/api/origins/:originId/pull-requests/suggestions/refresh` and cache the result under the same origin. The UI shows inline progress, empty-state guidance, and recovery messages for missing review history or provider errors.
