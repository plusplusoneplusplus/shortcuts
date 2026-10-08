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
| `useGitAutoRefresh` | Timed `refreshAll` every 5 min while the tab is `active` and the page visible |
| `useGitSkillActions` | Commit-context skill runs |

Pure helpers `selectionModel`, `gitPrompts`, `gitContextMenuModel` sit alongside the
`RepoGitListPane` / `RepoGitDetailPane` / `RepoGitOverlays` presentation components.
**Every hook takes `workspaceId` explicitly and reads its client through
`useCocClient(workspaceId)`**, so git, queue, and preferences traffic targets the
selected clone's server. `useGitOperationActions` owns the pull poller and hands it to
`useGitAutoPullController`, so manual and automatic pulls can never poll concurrently;
auto-pull skips and failures report through `useTransientToast`, not the `actionError`
banner. `useGitAutoRefresh` only calls the existing `refreshAll` (local reads, no
fetch/pull) and relies on its in-progress guard; hosts that keep the tab mounted behind
`display: none` (`RepoDetail`, `RepoGroupView` → `RepoGroupGitTab`) pass `active` so the
timer pauses while hidden and restarts when shown. `RepoGroupGitTab` gives
`RepoGitTab` the raw member id as its data `workspaceId` and the group's
server-qualified `selectionId` as `routeWorkspaceId`, keeping commit and file
navigation on the owning group even when another server has the same group id.

### Commit review lifetime

`RepoGitDetailPane` keys its review host by concrete clone owner and commit, owns shared
`useCommitChatPresentation` state, and renders `CommitReviewChat` independently
of overview/file content. `CommitDetail` and `FileDiffPanel` accept those controls
through `reviewChat`; standalone callers own their presentation locally. File
navigation keeps the conversation mounted and reuses `FileDiffPanel`. During
content loading, Monaco retains hidden prior models, then replaces models in the
same editor. File popovers reset; stale responses are cancelled. Clone-owner/commit
changes replace the host; Classic fallback and explicit retries dispose editors.

### Git panel header

`GitPanelHeader` is one compact row: a `repo ▾ / branch ▾` breadcrumb (the
borderless `RepoGroupGitMemberPicker` trigger, a `/` separator, then the branch
button), the ahead/behind badge, one bordered **sync group** holding the Pull
split button (chevron menu: Fetch / Pull / Push / Rebase autosquash) and the
`GitAutoPullControl` interval rendered `embedded` (left divider, no chevron),
and a refresh button that carries the last-refreshed time. The branch button
passes its rect to `onBranchClick`; `RepoGitTab` keeps that rect as
`branchPickerAnchor` and `BranchPickerModal` opens as a dropdown under it
(`anchorRect`: no backdrop, viewport-clamped, last-commit subject per row). The
cherry-pick target picker passes no anchor and stays a centered modal. In
compact mode the working-tree header shows `+staged ~modified ?untracked` (or
`✓ clean`) via `CompactWorkingTreeSummary` with no total file badge, and each
commit row leads with its short hash before the subject.

### Commit tooltips

`CommitTooltip` renders through a portal to `document.body` with fixed,
viewport-relative positioning. The tooltip stays outside the hover-peek
sidebar's transformed, overflow-clipping container. React hover events retain
sidebar ownership, and tooltip mousedown stops propagation to keep its controls
from triggering the peek's document-level outside-click dismissal. Outside
mousedown, Escape and touch-start cancel tooltip timers and dismiss the portal.

### Stale working-tree recovery

`git-changed` broadcasts come only from server-initiated git operations, so a file
deleted by an external process (an agent task, an editor) can linger in the
working-tree list until the next refresh. When the untracked-file preview's blob
read 404s, `PreviewPane` fires `onNotFound`; `WorkingTreeFileDiff` replaces the
preview with a missing-file notice and calls `onFileMissing` once, which
`RepoGitTab` wires to `bumpWorkingChanges` so the refetched list drops the ghost
entry. Non-404 preview failures keep the plain error + Retry presentation.
The preview reads a workspace-relative path built from `RepoGitTab`'s `repoRoot`.
`RepoGitTab` resolves that root from the repos list by clone key
(`findRepoBySelectionId`), falling back to `state.workspaces`, which lists only
page-origin workspaces. Without a root, the absolute path 404s and a remote
file shows as missing.

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

### Shared file diff sources

`features/git/diff/diffSource.ts` supplies commit, branch-range, and PR views with
patch URLs plus an optional paired-content loader. Each loader resolves
`getCocClientForWorkspace(workspaceId)` when called, so a remote clone route that
becomes available after source construction is honored. Branch-range loaders carry
the selected base mode. PR loaders use the origin-scoped content API with workspace
and repo clone-selection metadata, and the source cache identity includes the head SHA.

`FileDiffPanel` and `WorkingTreeFileDiff` share the global `useDiffEngine` preference
and the same Classic/Editor toggle; the preference defaults to Monaco and updates all
mounted file-diff surfaces immediately. `DiffEngineToggle` and `DiffViewToggle` are
single buttons that show the current choice and flip to the other on click.
Editor toolbars share `DiffWordWrapToggle` and `useDiffWordWrap`, backed by the
global `diffWordWrap` preference (default false). `MonacoFileDiffViewer` observes
the shared state and updates `wordWrap` and `diffWordWrap` on mounted editors;
both split panes and the visible inline editor follow the choice across workspaces.
In Editor mode, `FileDiffPanel` loads the
paired content and renders `MonacoFileDiffViewer`; its synthetic model identity includes
the source cache key and the response's resolved base/head refs so the same path at different commits, ranges, or PR heads cannot
share a model. Branch-range sources opt into working-copy language support only
when the server returns `modifiedMatchesWorkingCopy`; their modified model then
uses the explorer's real document URI. Commit, PR, base, and ineligible branch
models stay synthetic. See [language-servers.md](../language-servers.md) for
document ownership.

Both surfaces use `resolveDiffEngineSelection` for binary, oversized,
content-load, and editor-start fallback; `DiffEngineFallbackBanner` exposes the reason.
Malformed content and synchronous loader exceptions count as content-load failures.
Recoverable failures retry with a fresh content request and editor mount, keyed by
workspace, source identity, file, and attempt. Classic retains the patch request and
comment context, including full-context and truncation controls during fallback.
User-selected Classic and patch-only sources render without a fallback reason.
Monaco supplies find, syntax, overview markers, unified/split layout, and hunk navigation while full-context
and truncation controls stay specific to Classic.

Selection pills receive a concrete attachment destination separately from the
raw payload workspace id. RepoDetail passes its source clone identity through
RepoGitTab and RepoGitDetailPane to FileDiffPanel and WorkingTreeFileDiff. Group
Git hosts derive the member clone key from the group server. Inline PR files
forward RepoDetail’s owner through PullRequestsTab, PullRequestDetail and
PrFilesPanel to FileDiffPanel using attachmentDestinationId. Working-tree
selection sources use the repo-relative path and reach the Monaco viewer as well
as Classic drag handlers. Untracked files pass that owner to PreviewPane for
file-selection attachments, blob I/O and language transport. A bare or omitted
local destination uses an explicit null route, keeping local previews independent
of the active remote clone registry. The preview is keyed by owner so changing
clones reloads the file and isolates edit buffers.

Editing: `MonacoFileDiffViewer`'s `editable` prop opens only the modified side, and
only when `isEditableDiff` holds (working-tree stage, modified model is the real
on-disk document); the original side, ref-backed sides, commit/PR snapshots, and
branch-range heads stay read-only. `WorkingTreeFileDiff` enables it for unstaged
diffs, and for staged diffs only when the disk file equals the index
(`stagedDiskMatchesIndex`, from an extra unstaged content load; the index side
then uses the real document URI via `modifiedMatchesWorkingCopy`). Otherwise a
staged diff stays read-only with a note. Saving never touches the index; Ctrl/Cmd+S (`addSaveCommand`) writes the edited text with
`explorerApi.writeBlob(workspaceId, repoRelativePath, text)`. Hunks recompute live:
the controller reports diffs against the editor's current modified text.
The header shows a Save button and a dirty marker while editable; the view reports
`onDirtyChange` / `onRegisterSave` (Explorer contract; the untracked `PreviewPane`
forwards them). `RepoGitTab` wraps user selection changes with `useDirtyDetailGuard`,
which asks Save / Don't Save / Cancel (`ExplorerCloseTabsDialog`) while the diff is
dirty; a failed save keeps the prompt and the buffer. It also forwards the same
reports to `useSplitGitPanel`'s `onDetailDirtyChange` / `onDetailRegisterSave`, which
reach the panel's Git tab through the dirty bridge in `unifiedGitTabHost`, so the Git
tab shows a dirty dot and closing it prompts (`DIRTY_CLOSE_KINDS` includes `git`).
`RepoGitDetailPane` passes `workingChangesRefreshKey` as `refreshKey`; each bump
re-reads the diff and both sides quietly. A clean view reloads; unsaved edits are
never replaced — when the disk text changed, a "File changed on disk" banner offers
Reload (drop edits) or Keep mine (dismiss; the next save overwrites). A successful
save calls `onSaved` (`onWorkingTreeFileSaved` → `data.bumpWorkingChanges`), so the
change list and the diff refresh; a saved staged edit then appears under Unstaged.
The host passes `editedText` / `savedText` to the viewer so `useDiffLanguageFeatures`
keeps the shared language document on the editor's text: edits go out as
`didChange`, the buffer is marked saved once the editor matches disk again (save or
dropped edits), and unmounting with unsaved edits puts disk text back. A buffer that
diverged elsewhere (unsaved explorer edit) is never written; features stay off.

Both surfaces portal `CommentCard` through `MonacoDiffCommentLayer`, with placement
and selection conversion owned by `monacoCommentThreads` and `diffCoords`.
`FileDiffPanel` uses each source's existing comment refs for CRUD, replies, and AI
actions; sidebar navigation reveals and expands the editor thread. Each inline card's Copy
resolve prompt action copies that one comment through `utils/diffCommentPrompt.ts`
(`formatDiffCommentPrompt`), the same formatter as the sidebar's copy-all, using the
comment's own file and refs; the card shows copied/failed feedback. Send to current chat
drafts the same prompt into the composer of the chat the hosting unified panel shows
(`useCurrentChatInsertDraft` → that chat's `insertDraft`: appends after a blank line,
focuses, never submits), never the source's review chat; it is disabled when no panel
hosts the diff or the shown chat is not mounted. Anchor relocation
matches source rows, excluding patch headers and no-newline annotations during engine
switches. Both engines share the persisted comment shape.

### Changed-file navigation

Live admin setting `features.diffFilePicker` (Admin -> Configure -> Features ->
Code Review & Collaboration -> Diff header file picker; runtime flag
`diffFilePickerEnabled`) defaults on; only an explicit false disables it.
`DiffFilePicker` reads it through `useDiffFilePickerEnabled`, so toggling applies
without a reload and disabling dismisses an open picker. When enabled,
`diff/DiffFilePicker.tsx` makes a navigable multi-file diff's header path a searchable
changed-file picker. It matches full paths case-insensitively, supports arrow keys and
Enter, restores trigger focus on selection/Escape, and dismisses on outside interaction,
host scrolling, resize, or comparison changes. Its portal stays outside clipped and
virtualized rows; single-file and non-navigable paths keep their passive presentation.

`FileBannerRow` shares the picker across Unified and Split viewers, including their
docked copies. Their parsed banner paths include off-screen and non-text files;
selection reuses `scrollToFile` and reports `onFileNavigate` to the host.
`CommitDetail` updates its navigation path without replacing the comparison or chat.
Non-virtualized navigation targets the in-flow banner, not its docked overlay.

`FileDiffPanel` uses `DiffSource.files` or its workspace/source-keyed lazy file list,
then calls `onNavigateToFile(path, 'first')`. Stale file-list responses cannot supply
another comparison's paths. Its header keeps the filename visible while directories
clip first; Ctrl/Cmd+click opens the source file in a unified-panel file tab when
`UnifiedPanelHostProvider` hosts the diff, independently of picker availability.

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

Classic classify-diff toolbars call `useModalJobAiSelection()` directly and render
`features/git/diff/ClassifyDiffAiControls.tsx`, which hides the provider chip when only
one provider is selectable and shows either an effort-tier selector or the
pickable-model command picker.

`commits/CommitDetail.tsx` shares `CommitInfoHeader` with commit pop-outs for
subject, body, metadata, SHA copying, and header disclosure. It mounts those controls
in a classification-settings disclosure, with selection owned by the workspace-scoped
hook. Header and settings
disclosures reset on workspace or commit changes. The collapsed header retains SHA
copying and hides the metadata subtree from keyboard navigation. Its toolbar wraps
review and view controls as independent groups; `DiffViewToggle` accepts a quiet
appearance for this surface.

Categories: `logic`, `mechanical`, `test`, `simple`, `generated`; `simple` is
low-attention by default. PR and commit pop-out file rails show category badges plus a
critical marker, and their selected-file unified diff views render test fidelity
comments, logic summaries, and critical usage/call-stack evidence near each classified
hunk. Branch-range pop-out diff UI uses the compact classification-free path.
`FileDiffPanel` reports its resolved engine through `onDiffEngineChange`;
`useFileDiffEngineState` scopes that report to file/ref identity and the global
preference. Selected Monaco files hide classification controls, rail badges,
dimming, and priority navigation; Classic fallback restores them. Overview and
mobile Classic views retain classification, and cached results and filters survive
engine switches.

## Composer PR chips

`features/chat/conversation/ChatComposerPrChips.tsx` docks read-only PR chips **inside
the composer**, above the textarea, via the `prComposerChips` slot that
`FollowUpInputArea` renders as the first child of the input card. Nothing renders when
no PR is associated. A chat's chips cover both the PRs it created and the PRs that ship
commits it authored.

### Detection and binding

The detector itself is shared by the SPA and the server:
`@plusplusoneplusplus/forge/git/pull-request-detection` (`detectPullRequestsInToolGroup`,
`collectToolCallsFromTurns`, `syntheticRemoteUrlForDetectedPr`). It is pure
JSON/string parsing — no React, no DOM, no Node built-ins — so one copy serves both.

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

Detection requires **positive creation-tool evidence for that PR**, because
each detection is written back as a binding and so is permanent. A tool call yields at
most **one** PR — the specific created URL, not every PR URL in its output. Read-only
PR commands, connector lookups, unsuccessful tool calls (`status` failed/pending/…),
and shell output with **no command metadata** are ignored.

Accepted evidence:
- tool names ending in a delimited `create_pull_request` (native CoC and
  provider/MCP-qualified names): CoC `{success:true, url, id, provider}` results
  support GitHub and Azure DevOps (`provider: 'ado'`); GitHub connector snapshots
  use `{url, number}` and REST payloads use `{html_url, number}`. The detector reads
  object/JSON results and MCP `structuredContent`/JSON text envelopes, validates one
  canonical browser PR URL and matching identity fields, and rejects error flags,
  malformed or conflicting identities. Arguments, bodies and prose supply no evidence;
- a `gh pr create` / `az repos pr create` command, including inside a shell-interpreter
  wrapper (`bash -lc '…'`, `/bin/bash -c "…"`, `sh -c '…'`) whose quoted payload is
  unwrapped and scanned — the **last** PR URL in the result is the created one, and a
  result matching `already exists:` (a failed create printing the pre-existing PR) is
  rejected outright;


Pass `options.remoteUrl` (threaded from the chat workspace's remote through
`gatherDetectedPrsFromTurns`) to scope detections to the chat's own
`owner/repo` — normalized via `normalizeRemoteUrl`, so SSH and `.git` forms match.
`unionAssociations` independently drops any detected PR whose origin is not the chat's
own. `collectToolCallsFromTurns` merges timeline start, completion, and flat
`toolCalls` records by id within each turn: it keeps the start's creating command when
completion carries only a result, and uses the terminal status to reject failed calls.
Separate turns remain distinct because providers may restart tool-call ids on each
assistant turn.

`remoteUrl` is three-valued, and the distinction is load-bearing: `undefined` means the
chat's remote identity is **not known yet**, `null` means the workspace is known to have
**no** remote. `usePrChatStatusItems` holds `chatOriginId` empty (fetching nothing,
rendering nothing) while it is `undefined`. Collapsing the two cases resolves the origin
to `local_<workspaceId>` — an origin no PR data lives under — so the bindings lookup
queries the wrong scope, `unionAssociations` drops the chat's own detected PRs as foreign,
and `detectedPrsNeedingBinding` writes nothing.

`ChatDetail` derives it with `useWorkspaceRemoteUrl(appState.workspaces, reposCtx?.repos,
workspaceId)` (`repos/useWorkspaceRemoteUrl.ts`), which consults three sources in order,
each only when the previous is still unknown: the local workspace list
(`resolveWorkspaceRemoteUrl`), the repos list (`resolveRepoListRemoteUrl` — a row whose
`gitInfoLoading` is set stays unknown), and finally a one-shot `workspaces.gitInfo` probe
routed through `getCocClientForWorkspace`, memoized per workspace for the session. The
repos-list and probe steps are what make the PR banner work on a **remote** workspace:
`appState.workspaces` only ever holds the local server's workspaces
(`WORKSPACES_LOADED` is dispatched from `listWorkspaces()`; the aggregated remote rows
live in `repos` alone), so a chat owned by a remote clone is absent from it. The probe
only fires once the local list has loaded and still lacks the id, so local chats add no
extra request during the pre-load window.

The workspace id itself is not guaranteed to arrive as a prop: `buildChatPopOutUrl`
omits `?workspace=` when the caller has none, and the notification bell floats chats with
an optional id. `ChatDetail` resolves it once through
`resolveChatWorkspaceId(prop, processDetails, task)` (`react/utils/resolveChatWorkspaceId.ts`),
falling back to the process's own `metadata.workspaceId`, and feeds that
`effectiveWorkspaceId` to the workspace-list lookups (root path, name, `remoteUrl`) and to
both `ChatComposerPrChips` mounts. Without it a pop-out has no canonical origin at all and
every origin-scoped piece of chat chrome renders nothing, with zero requests to show for
it. Other `getCocClientForWorkspace(workspaceId)` call sites in `ChatDetail` deliberately
keep using the prop — they route requests to a specific CoC server.

### Authored-commit association

A chat that makes the commits but does not open the PR gets nothing from the union: a
separate `submit-commits-as-pr` run (usually a queued chat) creates the PR and owns the
one binding row it is allowed — `pull_request_chat_bindings` is keyed
`(workspace_id, pr_id)`, so the PR cannot be bound to a second chat.

`usePrChatStatusItems` therefore derives that association at render time and **never
persists it**. A second `runWhenIdle` effect (separate from the main pipeline, appending
to `items` instead of replacing them, and deliberately not bumping the main
`generationRef`) runs `detectCommitsInToolGroup` over the chat's own turns and joins the
result against candidate PRs in two rounds, stopping at the first match:

1. `listChatBindingsForOrigin(originId)` with **no** `taskId` — every PR some chat in
   this repo opened, newest binding first;
2. `listForOrigin(originId, { status: 'open', top: 20 })` — for PRs opened outside coc.

Candidates already associated with the chat are skipped and each round is capped at
`MAX_AUTHORED_CANDIDATES` (20). The join itself is the pure `matchAuthoredPrs` in
`prChatAssociation.ts`:

- **branch fast path** — the PR's `sourceBranch` contains one of the chat's short
  hashes (the CoC create-PR service names its branch `pr/<shortSha>-<slug>`); free,
  since it reads a detail the caller already had;
- **subject match** — `getCommitsForOrigin` (memoized per `originId:prId` for the
  session, evicted on failure) and an exact match on the whole normalized subject.
  Hashes are useless here: the create-PR service cherry-picks, so the PR's SHAs are new.
  `fixup!`/`squash!`/`--amend` commits are excluded — squashed away or rewritten.

Matches get `sources: ['authored']`. `detectedPrsNeedingBinding` still returns only
`detected` PRs, so an authored match issues **no** binding POST, and dismissing an
authored-only chip in `ChatComposerPrChips` hides it for the session with **no** DELETE
— deleting would unbind the chat that actually opened the PR. The whole scan is skipped
when the chat detected no commits, so a chat that never committed does zero extra I/O.

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

Every chip and fold row is a single non-wrapping row: controls are `shrink-0`, the
title (`flex-auto`) outranks the author (`shrink-[10]`) and both truncate. The
`.composer-pr-container` query container in `tailwind.css` compacts by pane width
in rem (so larger base text compacts earlier): ≤43.6875rem hides badge/View labels
(names stay in `aria-label`/`title`), ≤31.1875rem hides author and diff,
≤23.6875rem drops the glyphs and tightens badges. Guarded by
`test/e2e/composer-pr-chip-layout.spec.ts`.

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
load title, description and head metadata through the origin detail API, and
hydrate and persist reviewed/visited file progress through
`client.pullRequests.getReviewProgressForOrigin` / `saveReviewProgressForOrigin`
against `/api/origins/:originId/pull-requests/:prId/review-progress`, passing
workspaceId/repoId metadata for pre-origin migration only. The pop-out description
uses the overview's `getPullRequestReviewSummaryText` and `PrDescription` renderer,
including its empty-description fallback. Description sections sit above selected
file diffs with bounded scrolling. Loaded titles and review identifiers stay in
the window header; target changes reset disclosure and discard stale responses.

PR file data stays origin-scoped while `workspaceId` and optional `repoId` select a
same-origin clone. Classic pop-out views call the per-file diff endpoint with
`fullContext=true`; the server tries a full-file-context git diff from PR `baseSha` to
`headSha`, fetches missing commits into that checkout, then degrades to hunk-only data
with `fullContextUnavailable: true`. Rust decodes supplied Git patch paths and selects
per-file chunks with their exact bytes. Each list refresh fetches current provider
patches and maps Rust summaries to diff statistics, including when the base moves
with an unchanged head or revision metadata is missing. Fresh list-response cache
hits reuse enriched rows; there is no separate patch-statistics cache.
The paired-content endpoint reads both snapshots
from local objects first and falls back to the user's authenticated `gh api` or
`az devops invoke`; Rust parses supplied patch metadata for decoded original paths
and file existence. Binary, symlink, and over-10MB files return no text.

PR review suggestions sit behind `pullRequests.suggestions`. The For You filter's
generate/refresh action first refreshes origin-scoped review history via
`/api/origins/:originId/pull-requests/review-history/refresh`, then ranks open PRs via
`/api/origins/:originId/pull-requests/suggestions/refresh` and caches the result under
the same origin. The UI shows inline progress, empty-state guidance, and recovery
messages for missing review history or provider errors.
