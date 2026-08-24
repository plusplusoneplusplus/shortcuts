# Dashboard SPA — Conversation rendering

Turn bubbles, header, metadata, the implement-plan handoff, the sub-agent canvas, and
tool calls. Chat list and lens: [chat.md](chat.md). Composer:
[chat-composer.md](chat-composer.md). Canvas panels: [canvas.md](canvas.md).

## Conversation rendering

### ConversationTurnBubble

`provider` flows `ChatDetail` → `ConversationArea` → `ConversationTurnBubble`, colouring
the assistant avatar via `getProviderAvatarClasses` (`ProviderBadge.tsx`): Copilot green,
Claude coral/orange, Codex indigo, unknown → green. Error and script-output turns use
their own palettes and ignore `provider`.

User turns render through the same escape-at-generation `chatMarkdownToHtml` pipeline as
assistant turns (`breaks: true`, `linkifyFilePaths` skips code spans/blocks, raw HTML
escaped and never injected); the raw toggle shows literal source. Turns with
`pasteExternalized: true` keep the typed prompt visible and render the payload as an
in-bubble card, with no extra persisted display state.

Interrupted assistant turns keep their partial transcript and tool timeline. Continue and
retry send a generated raw follow-up through the normal path — never replaying preserved
partial content into the prompt, and never including composer draft, paste, context, or
attachments.

`ProviderBadge` (header agent pill) shares that palette. Running chat-list rows use the
provider palette on their status dot; task-tree queue activity badges reuse those dots,
reading `payload.provider` via `useQueueChat`.

### ChatHeader

`useContainerWidth` with a chat-header-specific `wideThreshold` of 960px (raised above the
generic 700px so the wide tier fits inline `ReferencesDropdown` + full status pill beside
the agent tree popover, copy, and `ChatHeaderOverflowMenu`). Below 960px References folds
into overflow and the pill goes icon-only; below 500px actions wrap to a second row. The
left identity group is `flex-1 min-w-0 overflow-hidden` with an always `min-w-0 truncate`
title, so the title yields width first and never bleeds under the non-shrinking action
group. The `ConversationMetadataPopover` trigger stays inline at every tier.

### ConversationMetadataPopover

Long identifiers get their own label/value rows (wrapping, log links); short categorical
fields collapse into a chip strip; related fields group into `Time`, `Workspace`, `Ralph`,
`Goal`, `System`. For commit chats `buildRows()` adds a monospace **Commit** row (full hash) and, when
persisted, **Commit message**. Both read `metadata.commitChat` (validated by
`readCommitChatContext`) — never `git rev-parse HEAD` or prompt text — so the row keeps
naming the original commit after HEAD moves; `buildMetadataProcess()` falls back to
`task.payload.context.commitChat` until process details load. Living in the shared
popover, these rows reach the lens, pinned/floating views, pop-outs, the mobile sheet,
and Activity detail with no extra props.

With `cumulativeTokenUsage` present, the popover adds `Tokens` (expanding to
input/output/cache) and `USD cost` from the server-derived native-first
`conversationCostEstimate.displayedUsdCost` (`actualUsdCost ?? estimatedUsdCost` per
turn), with source labels, pricing-source links, and partial/unavailable caveats. While a
conversation runs `useChatSSE` mirrors `token-usage` snapshots into the cached process
details feeding the popover; the post-completion refresh replaces them with the final
server read model.

`UsageStatsView` shows token totals per model/day plus the same `displayedUsdCost`,
saying `USD pricing unavailable` when there is none; Copilot premium request units are
not rendered. `QueuedFollowUps` renders pending messages as cancellable cards.

## Implement-plan card (plan → autopilot handoff)

`ImplementPlanCard` (`features/chat/ImplementPlanCard.tsx`) is the thread-only flow card
after a completed **Ask-mode plan-file chat**, gated in `ChatDetail` on terminal status,
not busy, Ask mode, and a known `effectivePlanPath`.

### Resolving the plan path

`ChatDetail` derives it from `context.files[0]` → `payload.planFilePath` →
`metadata.planFilePath` → detected `.plan.md` created files → detected plan canvas. Every
persisted slot is filtered through `asPlanPath` (absolute POSIX or Windows drive path).
That filter is load-bearing: scheduled chats enqueue raw instruction text as
`context.files[0]`, and the server records `metadata.planFilePath` from it only when
path-shaped (`asPlanFilePath` in `executors/process-lifecycle-runner.ts`); prompt text
reaching the launch dialog as a plan path 404s against `/fs/blob`. The non-path
canvas-title label is admitted when `metadata.planCanvasId` is set.

### Launch dialog

**Implement** expands `ImplementPlanLaunchDialog` inline below the banner: target selector,
`ModalJobAiControls` via `useModalJobAiSelection` keyed to the target
([chat-composer.md](chat-composer.md)), a read-only plan summary, and enqueue. The resolved
selection enters the queue payload as `payload.provider/model/reasoningEffort` +
`config.effortTier` + `context.autoProviderRouting`, and is recorded on the
`ImplementationRecord`. Multiple detected `.plan.md` files share one compact selector;
persisting the first detected path to metadata does not collapse the detected list, while
explicit task-provided paths and canvas-backed plans stay single-plan.

A **remote** target fetches providers and effort tiers from the target server
(`getCocClientFor(baseUrl).agentProviders`), injected as `externalAgentProviders` /
`externalEffortTierMap` overrides; an unreachable target replaces the AI controls with a
hint while enqueue stays available.

### Target selection

`buildImplementTargets(repos, current)` (`features/chat/implementTargets.ts`) is the pure
helper: current repo + local repos + **online** remote clones
(`remote.offline === false && remote.connection === 'online'`); offline, connecting, and
virtual workspaces are excluded.

The list is scoped to the current repo's git origin: with `current.remoteUrl` set, only
repos sharing its canonical origin id (`resolveCanonicalOriginId` /
`resolveRepoOriginScope` in `repos/originScope.ts`) survive; with no remote URL, no origin
filter. The current repo is always present and ordered first, so it stays the default.
`ChatDetail` builds the list from `useReposOptional()` gated on `isRemoteShellEnabled()`;
outside a `ReposProvider` (a pop-out window) the card is local-only.

Three enqueue paths:

- **Local target** — path-based prompt (`Read and implement the plan file at <path>` plus
  `context.files`) on the current repo's client.
- **Remote target** — reads plan content on the *initiating* server via
  `explorer.readTrustedBlob(planFilePath)`, inlines it (the remote machine cannot read the
  source machine's path), drops `context.files`, enqueues on the target repo's routed
  client. A failed source read errors inline and never enqueues.
- **Remote-sourced plan** — when the *source* workspace is itself a remote clone
  (`sourceIsRemote`/`sourceBaseUrl`, derived by `ChatDetail` from the aggregated repo entry
  → `lookupCloneBaseUrl` → membership in this server's workspace list), content is always
  inlined and both the read and the fallback enqueue route to the source baseUrl
  explicitly. Otherwise a remote plan path enqueues as a path-reference task on the local
  server, which the executor rewrites to `Follow the instruction <path>.`
  `buildImplementTargets` carries caller-supplied `isRemote`/`baseUrl`/`serverLabel` when
  synthesizing a missing current repo.

Each run writes an `ImplementationRecord` (process id, plan path, enqueue time,
`targetWorkspaceId`, `targetLabel`, `targetServerLabel`, `isRemoteTarget`) into
`task.metadata.implementations` on the **source** task via the source client.
`onViewRun(processId, targetWorkspaceId)` opens the run on the server it was dispatched
to, resolving remote status through `getCocClientForWorkspace(run.targetWorkspaceId)`.

## Agents view (sub-agent canvas)

`ChatHeader`'s `viewToggle` slot holds `AgentTreeMenu`
(`features/chat/agent-canvas/AgentTreeMenu.tsx`). `ChatDetail` owns one `AgentNav` union
(`thread` | `map` | `agent`) and derives `effectiveNav`, forcing `thread` when the chat
has no sub-agents (`agentRoot.children.length > 0`) or a selected agent id does not
resolve. The control is hidden with no sub-agents, in the `floating` variant, and while
loading, so a stale `?view=agents` link lands on the thread rather than an empty map.

`agentNavHash.ts` owns hash read/write: `?agent=<id>` opens that detail view and wins over
`view`, `?view=agents` opens the map, no param means thread. `parseActivityDeepLink`
strips the query so these params never corrupt the taskId. Navigation resets from the hash
on chat switch after initial mount; a stale `agent` id clears to `thread`.

### Deriving the tree

`buildAgentRunTreeFromTurns(turns, root)` needs no extra fetch. The orchestrator is the
root; each `Task` tool call becomes a node nested under the sub-agent that spawned it via
`parentToolCallId`. A Task whose parent is not another captured Task, or whose parent chain
is cyclic, attaches to the orchestrator. Node fields come from call args: name (`args.name`
→ `description`/`prompt`), type (`agent_type`/`subagent_type`), `model`, `mode`,
`description`, `prompt`; status and timing from the call. Background `task` calls whose
immediate result is only an `agent_id` acknowledgement are correlated with later
`read_agent` calls, whose output supplies the node's result and completion time.

Children are deduped across `toolCalls` + timeline keeping the snapshot with **non-empty
args** (a terminal `tool-complete` often carries empty args while an earlier snapshot
holds the full invocation), then ordered by start time. Name and args are read as
`toolName ?? name` and `args ?? parameters`, so sub-agents are detected in both the live
SSE shape and the persisted forge read model and survive completion. These readers live in
`agentToolCalls.ts`, shared with the sub-agent reconstructor.

### AgentCanvas

Reuses the shared `useZoomPan` hook: opens centered (`centerContent`), re-centering on
mount, growth, and resize until the user takes over; the toolbar zoom preset dropdown is
backed by `zoomTo(scale)` about the viewport center. Wheel-zoom and pan-drag skip events
originating inside a `[data-no-drag]` overlay (toolbar, legend) so those scroll and click
natively. It renders curved SVG edges and node cards with a 1s clock for running nodes. The
map opens from `AgentTreeMenu`'s footer once `countRuns(root) > 6`; clicking a node routes
through `onOpenAgentDetail`, the orchestrator root returning to the main thread. Styles are
scoped in `agent-canvas.css`. Distinct from the co-edited `CanvasPanel`.

### Tree popover and sub-agent detail

`AgentTreeMenu` renders ARIA `tree`/`treeitem` rows with keyboard navigation. The root row
`Main thread` selects `{ kind: 'thread' }`; a sub-agent `{ kind: 'agent', id }`; the footer
action `{ kind: 'map' }`.

Expansion is seeded once: every parent expands in small trees (≤12 runs); large trees
expand the root plus the selected agent's ancestor chain. Because the live `agentRoot`
object is rebuilt as turns stream in, the menu does **not** reseed on root identity change
— it only unions in selected ancestors when the selected id changes, so user collapse
state survives streaming.

`buildSubAgentTurns(turns, id)` reconstructs a sub-agent's conversation as
`[userTurn(prompt), assistantTurn(steps + result)]` from its full descendant subtree
(`parentToolCallId`), rendered through the **same** `ConversationArea` /
`ConversationTurnBubble` as the main thread. Filtered steps keep their `parentToolCallId`;
the sub-agent's own Task id is absent from the synthetic turn, so the renderer leaves its
direct steps top-level and nests deeper descendants under their parents, re-rooting the
subtree.

`SubAgentDetailView`'s header shows breadcrumb, status, duration, model, mode, spawned
count; prompt and result are already the synthetic turns. It has no follow-up input, and the
sub-agent's own status drives the streaming tail. Background sub-agents close with the
matching `read_agent` output rather than the `task` acknowledgement.

**Limitation:** `content`-type timeline items carry no parent linkage, so a sub-agent's
prose is unattributed — its Task result shows as the closing content instead.

`ConversationTurnBubble` builds parent/child chunk maps after falling back from timeline
events to persisted `toolCalls`, so nested child tools render inside their parent Task even
when a detail view or older history record has only flat snapshots. Whisper mode applies to
the synthetic assistant turn the same way.

## Tool call rendering

### Render model

`buildToolCallRenderModel` (`toolCallRenderModel.ts`) is a pure kernel deriving normalized
identity, summary, truncation, preview eligibility, and the whisper-row metric. Whisper-row
and card variants share one `ToolCallDetailSections` body; inside `WhisperCollapsedGroup` a
call is one flat row.

### Semantic shell classification

Codex routes every command through the canonical `shell` tool, so
`shellCommandClassifier.ts` reads the command **string** — never executing it — and
relabels a confidently single-family call to Search / Read / Files / Git. It unwraps one
`sh|bash|zsh -c/-lc` wrapper; refuses redirection, substitution, subshells, `&`,
assignments, and mutating variants (`sed -i`, `find -delete/-exec`, `tee`, `fd --exec`);
allows same-family chains and read-only presentation pipelines (`| head`, `| sed -n`); and
returns null (keep Shell) otherwise.

The render model then overrides the kind pill, the concise summary (human `description`
wins, else a derived pattern/path/subcommand, else the unwrapped command), the whisper
metric noun (hits/files/lines), the card `displayName`, and an `isSemanticShell` flag
driving the "executed through shell" tooltip. Canonical stored name, raw args, and
`bashCommand` are untouched. Homogeneous shell groups get a semantic summary
(`4 searches`, `2 Git commands`) via `getShellGroupSemanticLabel` (`toolGroupUtils.ts`);
mixed groups keep `N shell operations`. PowerShell is not classified.

### Whisper mode

In whisper mode (`toolCompactness === 3`), `filterWhisperChunks` keeps a tail of the final
assistant message plus any `task_complete` / visible `ask_user` chunks and collapses the
rest into one summary group. The final message is the last `content` chunk plus earlier
content chunks separated from it only by non-breaking trailing tools (`suggest_follow_ups`,
`report_intent`, `task_complete`, `ask_user`); the walk-back stops at the first substantive
tool, so a hidden `suggest_follow_ups` cannot hide a rich answer behind a trivial closing
line.

Whisper header parts and the group's reconstructable calls come from
`buildWhisperGroupModel` / `collectGroupToolCalls` (`whisperGroupModel.ts`). Summary spans
(skills, memories, files, commits, PRs, pushes) share the `useHoverPopover` /
`HoverSummarySpan` primitive (`hoverPopover.tsx`). Selecting a skill opens
`WhisperSkillDetailDialogProvider`'s panel-scoped dialog; `ChatDetail` mounts that provider
around the left conversation stack so the backdrop is bounded by the conversation column
and does not span right-side canvas/source/diff panels (the DAG item conversation panel
mounts it around its slide-in surface). The dialog lazy-loads through the clone-routed
skill client, tries workspace then global lookup, and caches per workspace/name while
mounted.

### Commit strips

Detected entirely in the SPA from already-loaded turn tool data — no server-side binding or
persistence. Commit-creating commands (`git commit`, `git merge`, `git cherry-pick`,
`git revert`) with native output like `[branch abc1234] subject`, or compact verification
output like `abc1234 subject`, count as commits. For truncated commit output a short
same-turn verification window lets a correlated `git log -1` supply the hash/subject.
Read-only git commands and generic prose are ignored.

### ask_user

Live unanswered batches stay owned by `ChatDetail`/`ConversationArea` through
`processDetails.pendingAskUser` and `AskUserInline`. Each question offers Answer, Skip, or
Need context; the deferred choice marks the question complete for batch submission.

Unsubmitted live-batch drafts are saved in `localStorage` scoped by process id and batch
id, restored after navigation or refresh for the same batch, and cleared on accepted
submission, skip-all, process cancellation, or replacement by a newer batch id.

For Ralph multi-agent grilling, optional per-question metadata renders a "Question
planning" summary, role-group headers, provenance chips (`UX Agent · provider/model`),
consolidation chips, and coverage warnings — all one batch submission.

Completed calls render read-only through `AskUserHistoryCard` inside
`ConversationTurnBubble`: persisted `args.questions[]` plus the answer/skip/deferred
result, with a compatibility unwrap for older Codex MCP captures stored as
`args.arguments.questions[]`. History cards stay visible outside whisper collapse; generic
`ToolCallView` is the fallback, summarizing `args.questions[0].question`.

### Tool-name normalization

`toolNormalization.ts` → `normalizeToolName()` canonicalises SDK-specific names before
display and storage: `read_file`/`open_file` → `view`,
`edit_file`/`str_replace`/`str_replace_editor` → `edit`, `write_file`/`create_file` →
`create`, `command_execution` → `shell`, `file_change` → `apply_patch`, `Skill` (Claude
Code SDK PascalCase) → `skill`. All downstream logic (`getToolKindInfo`, `getToolSummary`,
whisper skill counting) works on the normalized lowercase name.

For Codex `file_change` normalized to `apply_patch`, `ToolCallView` summarizes from
`args.changes`; a backend-enriched unified `args.diff` renders as patch text. Collapsed
whisper summaries count file edits from `args.changes` when an enriched `apply_patch`
carries a `diff --git` patch with no `*** Add/Update/Delete File:` markers; marker-style
diffs supply line counts.

`utils/conversationScan.ts` powers chat References and goal-file detection by scanning
completed file-writing calls for pinned document extensions (`.md`, `.txt`, `.yaml`,
`.yml`, `.json`). Names and args pass through `normalizeToolName`/`normalizeToolArgs`
first, so Claude Code's PascalCase `Write`/`Edit`/`MultiEdit` with a `file_path` arg map to
the canonical create/edit tools — which is what lets a `.goal.md` written by a Claude
session surface the inline Ralph launch panel. It detects direct create/write/edit paths,
`apply_patch` added files, and conservative shell `mv`/`move` destinations from command
arguments (including `bash -c`/`bash -lc` wrappers), never inferring created files from
arbitrary shell output.

## Quick Ask side-notes

Gated by the live server flag `features.quickAskSidenotes`. Selecting text in an assistant
turn's `MarkdownView` raises a floating pill (`Cmd/Ctrl+J` is the keyboard alternative);
the answer attaches to that message's Side notes row. Components live under
`features/chat/quick-ask/`: `useQuickAskSidenotes`, selection and anchoring helpers,
`QuickAskPill`, `QuickAskSidenotePopover`, `QuickAskTurnLayer` — plumbed from `ChatDetail`
through `ConversationArea` to `ConversationTurnBubble`.

### Threads

Once answered the popover is a multi-turn thread: `QuickAskTurnLayer` passes
`QuickAskSidenotePopover`'s `reply` control whenever the host wires `onFollowUp`. Follow-ups
go through
`useQuickAskSidenotes.followUpSidenote(id, question)` →
`POST /api/processes/:id/sidenotes/:noteId/follow-up`, which persists the turn so the
thread survives reload. `retrySidenoteTurn(id, turnIndex)` re-runs a failed turn, index 0
falling back to the original lookup. The live thread is `ClientSideNote.thread`, derived
from persisted `turns` on hydrate; a follow-up in flight marks only its own turn `asking`.
Cap: `MAX_QUICK_ASK_TURNS` (10).

### The pill

`QuickAskPill` expands into the inline question input, and — when `QuickAskTurnLayer`
receives `onAttachContext` — offers **Attach**, sending the selection to
`useAttachedContext().add(turnIndex, 'assistant', snippet)`. `ChatDetail` wraps that `add`
in `handleAttachContext`, which also focuses the composer (`richTextRef.current?.focus()`);
the same wrapper serves the right-click menu path. Because the layer mounts only under
`features.quickAskSidenotes`, the right-click **Attach as context** menu item is the
flag-independent path.

### Notes editor mirror

The rich Notes editor uses the same selection controls and answer endpoint through
`NoteQuickAskLayer`, storing the answer in the note's `[^qa-<id>]` reference plus JSON
definition format. New definitions optionally persist the exact selected text and its
prefix/suffix; `{"a":"..."}` and `{"q":"...","a":"..."}` payloads stay byte-stable.

`SidenoteRefExtension` keeps the payload on the inline atom and resolves it into a
presentation-only `note-quick-ask-anchor` ProseMirror decoration that can span inline
formatting **without entering the Markdown**. Repeated text is disambiguated with context
and chip position; deleting the chip removes its decoration and serialized definition. The
persistence extension stays registered when the flag is off so saved side-notes survive
edits; only creation and popover controls go inactive.
