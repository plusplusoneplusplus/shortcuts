# Dashboard SPA — Conversation rendering

How a loaded chat renders: turn bubbles, header, metadata, the implement-plan handoff,
the sub-agent canvas, and tool calls. The chat list and lens live in
[chat.md](chat.md); the composer in [chat-composer.md](chat-composer.md).

## Conversation rendering

### ConversationTurnBubble

- **Assistant turns** — left-aligned, `C` avatar colored by provider through
  `getProviderAvatarClasses` (`ProviderBadge.tsx`): Copilot green, Claude
  coral/orange, Codex indigo. `provider` flows `ChatDetail` → `ConversationArea` →
  `ConversationTurnBubble`; unknown provider metadata falls back to green.
- **User turns** — right-aligned, `Y` avatar. Message text renders through the same
  escape-at-generation `chatMarkdownToHtml` pipeline as assistant turns
  (`breaks: true`, `linkifyFilePaths` skips code spans/blocks, raw HTML escaped and
  never injected), so typed markdown displays formatted; the raw toggle shows literal
  source. Turns with `pasteExternalized: true` keep the short typed prompt visible and
  render the payload as an in-bubble card with character count, preview,
  expand/collapse, and Copy full content — no extra persisted display state.
- **Error turns** — red error-strip aside with retry; the avatar keeps its own red
  palette and ignores `provider`.
- **Interrupted assistant turns** — amber banner above the still-visible partial
  transcript and tool timeline. Continue/retry sends a generated raw follow-up through
  the normal path; it never replays preserved partial content into the prompt and
  never includes composer draft, paste, context, or attachments.
- **Script output** — dark terminal window with PASS/FAIL highlighting; its own
  palette, ignores `provider`.

`ProviderBadge` (the header agent pill) shares that palette and mirrors
`ChatStatusPill`'s style. Running chat-list rows carry no separate provider pill —
their leading status dot uses the provider palette. Task-tree queue activity badges
reuse the same dots, reading `payload.provider` through `useQueueChat`.

### ChatHeader

`ChatHeader` measures its own container with `useContainerWidth` at a
chat-header-specific `wideThreshold` of 960px, raised above the generic 700px because
its wide tier renders the inline `ReferencesDropdown` plus a full status pill on the
left while the right side carries the agent tree popover, copy, and
`ChatHeaderOverflowMenu`.

| Tier | Width | Layout |
|---|---|---|
| wide | ≥960px | References inline; status pill shows label + duration |
| medium | 500–959px | References folds into overflow; pill goes icon-only |
| narrow | <500px | Actions wrap to an end-aligned second row; float/pop-out move to overflow |

The left identity group is `flex-1 min-w-0 overflow-hidden` with an always
`min-w-0 truncate` title, so the title yields width first and can never bleed under
the non-shrinking action group. The `ConversationMetadataPopover` "i" trigger sits
inline after the title at every tier, not in the overflow menu.

### ConversationMetadataPopover

Long identifiers render as separate label/value rows (for wrapping and log links)
while short categorical fields collapse into a summary chip strip and related fields
group into `Time`, `Workspace`, `Ralph`, `Goal`, and `System` rows.

For commit chats, `buildRows()` adds a monospace **Commit** row with the full hash and,
when persisted, a **Commit message** row. Both read `metadata.commitChat` (validated by
`readCommitChatContext`) — never `git rev-parse HEAD` or the prompt text — so the row
keeps naming the commit the conversation was created for after HEAD moves.
`buildMetadataProcess()` falls back to `task.payload.context.commitChat` until process
details load. Because these rows live in the shared popover they appear in the lens,
pinned and floating views, pop-outs, the mobile sheet, and Activity detail with no
extra props.

When a process exposes `cumulativeTokenUsage`, the popover adds live `Tokens` and
`USD cost` rows: token totals expand to input/output/cache breakdowns, and cost uses
the server-derived native-first `conversationCostEstimate.displayedUsdCost`
(`actualUsdCost ?? estimatedUsdCost` per turn) with source labels, pricing-source
links, and partial/unavailable caveats. While a conversation runs, `useChatSSE`
mirrors `token-usage` snapshots into the cached process details feeding the popover;
after completion the normal refresh replaces them with the final server read model.

`UsageStatsView` renders token totals per model/day plus the same `displayedUsdCost`.
Cells with no displayable USD value say `USD pricing unavailable` rather than leaving
cost blank. Copilot premium request units are not rendered.

`QueuedFollowUps` renders pending messages as compact cards with cancel buttons.

## Implement-plan card (plan → autopilot handoff)

`ImplementPlanCard` (`features/chat/ImplementPlanCard.tsx`) is the thread-only flow
card after a completed **Ask-mode plan-file chat**, gated in `ChatDetail` on terminal
status, not busy, Ask mode, and a known `effectivePlanPath`.

### Resolving the plan path

`ChatDetail` derives it from `context.files[0]` → `payload.planFilePath` →
`metadata.planFilePath` → detected `.plan.md` created files → detected plan canvas.
Every persisted slot is filtered through `asPlanPath` (absolute POSIX or Windows drive
path). This filter is load-bearing: scheduled chats enqueue raw instruction text as
`context.files[0]`, and the server records `metadata.planFilePath` from it only when
path-shaped (`asPlanFilePath` in `executors/process-lifecycle-runner.ts`). Prompt text
reaching the launch dialog as a plan path 404s against `/fs/blob`. The non-path
canvas-title label is still admitted when `metadata.planCanvasId` is set.

### Launch dialog

Clicking **Implement** expands `ImplementPlanLaunchDialog` inline below the banner
(styled like `RalphStartPanel`, not a modal). It hosts the target selector, shared AI
controls (`ModalJobAiControls` via `useModalJobAiSelection`, keyed to the target), a
read-only plan summary, and the enqueue action. The resolved selection travels into
the queue payload as `payload.provider/model/reasoningEffort` + `config.effortTier` +
`context.autoProviderRouting`, and is recorded on the `ImplementationRecord`.

When a conversation creates multiple `.plan.md` files, the banner and panel share one
compact selector; persisting the first detected path to metadata does not collapse the
detected list. Explicit task-provided paths and canvas-backed plans stay single-plan.

For a **remote** target the panel fetches providers and effort tiers from the target
server (`getCocClientFor(baseUrl).agentProviders`) and injects them as
`externalAgentProviders` / `externalEffortTierMap` overrides. An unreachable target
replaces the AI controls with a hint while enqueue stays available.

### Target selection

`buildImplementTargets(repos, current)` (`features/chat/implementTargets.ts`) is the
pure helper: current repo + local repos + **online** remote clones
(`remote.offline === false && remote.connection === 'online'`). Offline, connecting,
and virtual workspaces are excluded so they cannot be selected.

The list is scoped to the current repo's git origin: when `current.remoteUrl` is set,
only repos sharing its canonical origin id (`resolveCanonicalOriginId` /
`resolveRepoOriginScope` in `repos/originScope.ts`) survive. With no remote URL, no
origin filter applies. The current repo is always present and ordered first, so it
stays the default. `ChatDetail` builds the list from `useReposOptional()` gated on
`isRemoteShellEnabled()` — no new flag. The selector renders only with more than one
target; outside a `ReposProvider` (a pop-out window) the card is local-only.

Three enqueue paths:

- **Local target** — path-based prompt (`Read and implement the plan file at <path>`
  plus `context.files`), enqueued on the current repo's client.
- **Remote target** — reads plan content on the *initiating* server via
  `explorer.readTrustedBlob(planFilePath)`, inlines it in the prompt (the remote
  machine cannot read the source machine's path), drops `context.files`, and enqueues
  on the target repo's routed client. A failed source read errors inline and never
  enqueues.
- **Remote-sourced plan** — when the *source* workspace is itself a remote clone
  (`sourceIsRemote`/`sourceBaseUrl`, derived by `ChatDetail` from the aggregated repo
  entry → `lookupCloneBaseUrl` → membership in this server's workspace list), content
  is always inlined and both the read and the fallback enqueue route to the source
  baseUrl explicitly. Otherwise a remote plan path gets enqueued as a path-reference
  task on the local server, which the executor rewrites to
  `Follow the instruction <path>.` `buildImplementTargets` carries the caller-supplied
  `isRemote`/`baseUrl`/`serverLabel` when synthesizing a missing current repo.

Each run writes an `ImplementationRecord` (process id, plan path, enqueue time,
`targetWorkspaceId`, `targetLabel`, `targetServerLabel`, `isRemoteTarget`) into
`task.metadata.implementations` on the **source** task via the source client. The
banner shows per-run target and status; `onViewRun(processId, targetWorkspaceId)`
opens the run on the server it was dispatched to, with remote status resolved through
`getCocClientForWorkspace(run.targetWorkspaceId)`.

## Agents view (sub-agent canvas)

`ChatHeader` exposes one agent control through its `viewToggle` slot: `AgentTreeMenu`
(`features/chat/agent-canvas/AgentTreeMenu.tsx`). `ChatDetail` owns a single `AgentNav`
union (`thread` | `map` | `agent`) and derives `effectiveNav`, forcing `thread` when
the chat has no sub-agents (`agentRoot.children.length > 0`) or a selected agent id no
longer resolves. The control is hidden with no sub-agents, in the `floating` variant,
and while loading, so a stale `?view=agents` link lands on the thread rather than an
empty map.

`agentNavHash.ts` owns hash read/write: legacy `?agent=<id>` opens that detail view and
wins over `view`, `?view=agents` opens the map, and no param means thread. Writing
keeps `?view=agents` so old links stay in the same vocabulary. `parseActivityDeepLink`
strips the query so these params never corrupt the taskId. Navigation resets from the
hash on chat switch after initial mount; a stale `agent` id clears to `thread`.

### Deriving the tree

`buildAgentRunTreeFromTurns(turns, root)` needs no extra fetch. The orchestrator is
the root and each `Task` tool call becomes a sub-agent node nested under the sub-agent
that spawned it via `parentToolCallId`, giving real depth. A Task whose parent is not
another captured Task — or whose parent chain is cyclic — attaches to the orchestrator.
Node fields come from the call args: name (`args.name`, falling back to
`description`/`prompt`), type (`agent_type`/`subagent_type`), `model`, `mode`,
`description`, `prompt`; status and timing come from the call itself.

Background `task` calls whose immediate result is only an `agent_id` acknowledgement
are correlated with later `read_agent` calls, and the completed agent output supplies
the node's result and completion time.

Children are deduped across `toolCalls` + timeline, keeping the snapshot with
**non-empty args** — a terminal `tool-complete` often carries empty args while an
earlier snapshot holds the full invocation — then ordered by start time. Tool name and
args are read as `toolName ?? name` and `args ?? parameters`, so sub-agents are
detected in both the live SSE shape and the persisted forge read model and stay on the
canvas after the chat completes. These readers live in `agentToolCalls.ts`, shared with
the sub-agent reconstructor.

### AgentCanvas

Reuses the shared `useZoomPan` hook: opens at 100% centered (`centerContent`),
re-centering on mount, growth, and resize until the user takes over. The toolbar
percentage is a preset dropdown (25/50/75/100/150/200% + Fit) backed by
`zoomTo(scale)`, zooming about the viewport center. Wheel-zoom and pan-drag skip
events originating inside a `[data-no-drag]` overlay — the toolbar and legend — so
those scroll and click natively.

It renders curved SVG edges and node cards (role glyph, name, live elapsed,
spawn-count pill, status dot, progress bar) with a 1s clock for running nodes. The map
opens from `AgentTreeMenu`'s footer once `countRuns(root) > 6`. Clicking a node routes
through `onOpenAgentDetail`; the orchestrator root returns to the main thread. Styles
are scoped in `agent-canvas.css`. This is distinct from the co-edited `CanvasPanel`.

### Tree popover and sub-agent detail

`AgentTreeMenu` renders the tree as ARIA `tree`/`treeitem` rows with indentation,
twisty, status dot, role glyph, elapsed text, and keyboard navigation (Up/Down,
Right/Left, Enter/Space, Escape). The root row is `Main thread` and sets
`{ kind: 'thread' }`; a sub-agent sets `{ kind: 'agent', id }`; the footer action sets
`{ kind: 'map' }`.

Expansion is seeded once: every parent expands in small trees (≤12 runs), large trees
expand the root plus the selected agent's ancestor chain. Because the live `agentRoot`
object is rebuilt as turns stream in, the menu does **not** reseed on root identity
change — it only unions in selected ancestors when the selected id changes, so user
collapse state survives streaming.

`buildSubAgentTurns(turns, id)` reconstructs a sub-agent's conversation as
`[userTurn(prompt), assistantTurn(steps + result)]` by collecting its full descendant
subtree via `parentToolCallId`, rendered through the **same** `ConversationArea` /
`ConversationTurnBubble` as the main thread. Filtered steps keep their
`parentToolCallId`; the sub-agent's own Task id is absent from the synthetic turn, so
the renderer leaves its direct steps top-level and nests deeper descendants under
their parents, re-rooting the subtree.

`SubAgentDetailView`'s header shows the breadcrumb plus status, duration, model, mode,
and spawned count; it does not repeat the prompt or result, which are already the
synthetic turns. There is no follow-up input, and the sub-agent's own status drives
the streaming tail. Background sub-agents close with the matching `read_agent` final
output rather than the `task` acknowledgement.

**Limitation:** `content`-type timeline items carry no parent linkage, so a sub-agent's
prose is unattributed — its Task result shows as the closing content instead.

`ConversationTurnBubble` builds parent/child chunk maps after falling back from
timeline events to persisted `toolCalls`, so nested child tools still render inside
their parent Task when a detail view or older history record has only flat snapshots.
Whisper mode applies to the synthetic assistant turn the same way.

## Tool call rendering

### Render model

`buildToolCallRenderModel` (`toolCallRenderModel.ts`) is a pure kernel deriving
normalized identity, summary, truncation, preview eligibility, and the whisper-row
metric. The whisper-row and card variants share one `ToolCallDetailSections` body.
Inside `WhisperCollapsedGroup` a call is a single flat row: kind pill + truncated
summary + duration + chevron, with color-coded pills (Read blue, Grep/Glob green,
Edit/Write amber, Shell/PS/SQL purple, Skill grey).

### Semantic shell classification

Codex routes every command through the canonical `shell` tool, so
`shellCommandClassifier.ts` reads the command **string** — never executing it — and
relabels a confidently single-family call to Search / Read / Files / Git. It unwraps
one `sh|bash|zsh -c/-lc` interpreter wrapper; refuses redirection, substitution,
subshells, `&`, assignments, and mutating variants (`sed -i`, `find -delete/-exec`,
`tee`, `fd --exec`); allows same-family chains and read-only presentation pipelines
(`| head`, `| sed -n`); and returns null (keep Shell) otherwise.

The render model then overrides the kind pill, the concise summary (a human
`description` wins, else a derived pattern/path/subcommand, else the unwrapped
command), the whisper metric noun (hits/files/lines), the card `displayName`, and an
`isSemanticShell` flag driving the "executed through shell" tooltip. The canonical
stored name, raw args, and `bashCommand` are untouched. Homogeneous shell groups get a
semantic summary (`4 searches`, `2 Git commands`) via `getShellGroupSemanticLabel`
(`toolGroupUtils.ts`); mixed groups keep `N shell operations`. PowerShell is not
classified.

### Whisper mode

In whisper mode (`toolCompactness === 3`), `filterWhisperChunks` keeps a tail of the
final assistant message plus any `task_complete` / visible `ask_user` chunks and
collapses everything else into one summary group. The final message is the last
`content` chunk plus earlier content chunks separated from it only by non-breaking
trailing tools (`suggest_follow_ups`, `report_intent`, `task_complete`, `ask_user`);
the walk-back stops at the first substantive tool. This keeps a rich answer visible
when a hidden `suggest_follow_ups` call splits it from a trivial closing line.

Whisper header parts and the group's reconstructable calls come from
`buildWhisperGroupModel` / `collectGroupToolCalls` (`whisperGroupModel.ts`). Summary
spans (skills, memories, files, commits, PRs, pushes) share the `useHoverPopover` /
`HoverSummarySpan` primitive (`hoverPopover.tsx`). Selecting a skill from a hover list
opens `WhisperSkillDetailDialogProvider`'s panel-scoped dialog. `ChatDetail` mounts
that provider around the left conversation stack so the backdrop is bounded by the
conversation column and does not span right-side canvas/source/diff panels; the DAG
item conversation panel uses it around its slide-in surface. The dialog lazy-loads
details through the clone-routed skill client, tries workspace then global lookup,
caches per workspace/name while mounted, traps focus, and returns focus to the
trigger.

### Commit strips

Commit strips are detected entirely in the SPA from already-loaded turn tool data — no
server-side binding or persistence is needed for display. The detector treats
commit-creating commands (`git commit`, `git merge`, `git cherry-pick`, `git revert`)
with native output like `[branch abc1234] subject`, or compact verification output
like `abc1234 subject`, as commits. For truncated commit-command output it keeps a
short same-turn verification window so a correlated `git log -1` can supply the
hash/subject. Read-only git commands and generic prose are ignored.

### ask_user

Live unanswered batches stay owned by `ChatDetail`/`ConversationArea` through
`processDetails.pendingAskUser` and `AskUserInline`. Each question card has a
response-type dropdown with Answer, Skip, and Need context; the deferred choice marks
the question complete for batch submission and reveals an optional note field.

Unsubmitted live-batch drafts are saved in `localStorage` scoped by process id and
batch id, restored after navigation or refresh for the same batch, and cleared on
accepted submission, skip-all, process cancellation, or replacement by a newer batch
id.

For Ralph multi-agent grilling, optional per-question metadata renders a "Question
planning" summary, role-group headers, provenance chips (`UX Agent · provider/model`),
consolidation chips for merged questions, and warning copy for failed, empty,
unavailable, or duplicate-only agent coverage — all still one batch submission.

Completed calls render read-only through `AskUserHistoryCard` inside
`ConversationTurnBubble`, showing persisted `args.questions[]` plus the
answer/skip/deferred result including "Need more context" notes, with a compatibility
unwrap for older Codex MCP captures stored as `args.arguments.questions[]`. History
cards stay visible outside whisper collapse. Generic `ToolCallView` handles `ask_user`
as a fallback, summarizing `args.questions[0].question`.

### Tool-name normalization

`toolNormalization.ts` → `normalizeToolName()` canonicalises SDK-specific names before
display and storage: `read_file`/`open_file` → `view`,
`edit_file`/`str_replace`/`str_replace_editor` → `edit`, `write_file`/`create_file` →
`create`, `command_execution` → `shell`, `file_change` → `apply_patch`, `Skill`
(Claude Code SDK PascalCase) → `skill`. All downstream logic (`getToolKindInfo`,
`getToolSummary`, whisper skill counting) operates on the normalized lowercase name.

For Codex `file_change` calls normalized to `apply_patch`, `ToolCallView` summarizes
from `args.changes`; when the backend enriches parameters with a unified `args.diff`,
expanded details and hover previews render that patch text. Collapsed whisper
summaries count file edits from `args.changes` when an enriched `apply_patch` carries
a `diff --git` patch with no legacy `*** Add/Update/Delete File:` markers; legacy
marker diffs still supply line counts.

`utils/conversationScan.ts` powers chat References and goal-file detection by scanning
completed file-writing calls for pinned document extensions (`.md`, `.txt`, `.yaml`,
`.yml`, `.json`). Names and args run through `normalizeToolName`/`normalizeToolArgs`
first, so provider shapes are recognized — Claude Code's PascalCase
`Write`/`Edit`/`MultiEdit` with a `file_path` arg map to the canonical create/edit
tools, which is what lets a `.goal.md` written by a Claude session surface the inline
Ralph launch panel. It detects direct create/write/edit paths, `apply_patch` added
files, and conservative shell `mv`/`move` destinations from command arguments
(including `bash -c`/`bash -lc` wrappers). It never infers created files from
arbitrary shell output.
