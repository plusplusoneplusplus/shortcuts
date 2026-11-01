# Dashboard SPA — Conversation rendering

Turn bubbles, header, metadata, the implement-plan handoff, the sub-agent canvas, and
tool calls. Chat list and lens: [chat.md](chat.md). Composer:
[chat-composer.md](chat-composer.md). Canvas panels: [canvas.md](canvas.md).

## Conversation rendering

### Owner-scoped history paging

The owning server's live default-on `chatHistoryPagingEnabled` capability selects
`useChatHistoryPaging` for every `ChatDetail` mode, including Notes, groups and popouts.
Local runtime patches and owner config/reconnect notifications refresh capability reads;
unresolved remote selections cannot hydrate locally.

REST hydration, queued transitions and SSE snapshots share the revision-aware merger.
Owner WebSocket process-added/updated notifications coalesce into one detail GET per
microtask batch; later notifications can start another read. Each matching notification
supersedes prior handler results, and effect cleanup discards scheduled work.
Same-revision snapshots replace the latest tail while retaining loaded older pages;
revision changes cancel reads and reset to the latest page and bottom. Conversation
caches retain only that latest page and mark it as paged, so disabling the flag cannot
reuse it as full history.

An IntersectionObserver loads shared `PAGE_TURNS` pages through the owner client, with
one in-flight read, layout anchoring and automatic capped backoff. Hash `turn`/`turnIndex`,
`coc-jump-to-turn`, minimap and pinned navigation load contiguous pages before highlighting.
Pins have an independent owner-scoped read; find searches loaded turns. `navigateToTurn`
resolves whether it highlighted the turn; an optional `accept` check rejects a loaded turn
and cancels background retries so a failed verification never jumps later. `ChatDetail` mounts
the conversation minimap only after hydration for non-Sentinel displayed modes, resolved
from owner-scoped process state independently of pinned Sentinel origins. Owner/chat changes
abort requests and discard delayed results. Flag-off hydration and rendering remain full-history;
hash turn links and explicit turn targets scroll/highlight those already-loaded turns without page reads.

### ConversationTurnBubble

Git review openers retain the chat's concrete source owner and optional endpoint.
`ChatDetail` threads `sourceSelectionId` and `sourceBaseUrl` through
`ConversationArea`, pinned and normal turn bubbles, commit strips and whisper
commit popovers. Review URLs keep the owner separate from raw workspace metadata;
explicit endpoints take precedence, and explicit local owners stay on the page
origin.

Persisted turn `provider` and `segmentId` attribution flows unchanged through history
loading and SSE snapshots. `ConversationTurnBubble` prefers the turn provider for its
assistant avatar, provider label, and model metadata, falling back to the active
conversation provider only for unattributed records. `ConversationArea` derives a
non-persisted `Continued with <Provider>` separator before the first assistant response
of each provable provider segment. Error and script-output turns keep their own palettes.

`AssistantStatsBadge` reads per-turn token usage and elapsed time in the shared bubble
across chat modes and pop-outs. It reuses `ContextUsagePopover`'s token formatter and
button reset, retains exact cache/total/time details, and exposes disclosure state to
assistive technology. Streaming turns omit metrics; partial usage keeps zero defaults
and derives missing totals from input/output. Header wrapping preserves complete values
and the non-shrinking action group; keyboard focus reveals actions.

Native rewind and edit-and-resend are available only for user turns in the active
provider segment. Earlier-segment controls stay visible but disabled with the
cross-provider rewind explanation; the REST route enforces the same boundary against
the authoritative provider/session binding before calling a provider SDK.

Stopped-chat continuation resolves the requested provider before applying strict-resume
guards. Same-provider continuation requires the saved native session and preserves
`SESSION_NOT_RESUMABLE`; a different provider bypasses outgoing-session liveness and
queues a reconstructed continuation without a resume session id.

Follow-up retry resolves its provider from the latest recorded user turn. A newly
confirmed composer provider takes precedence, so an intentional retry switch still
uses the standard confirmation flow; unattributed old turns preserve active-provider
fallback behavior.

Native compaction and resume-in-provider-CLI resolve provider and session id together
from the active binding. Compaction labels its display-only result turn with the active
provider and segment. Legacy CLI-resume records retain their metadata/default-provider
and historical session-id fallbacks.

### Sentinel result cards

The live, default-on `features.sentinelResultCards` page-wide presentation flag selects
`SentinelResultCard` unless explicitly false, including when configuration/runtime flags
are absent. Cards require receipt-correlated user turns with the exact review prefix,
validated result schema and matching parent workspace/process. Unknown envelopes keep
ordinary rendering. Native disclosures separate readable inert chat Markdown from exact
JSON view/copy; links, images and embeds in summaries remain inactive. Open-job routes
inherit the source owner, with explicit endpoints taking precedence. In a hosted Sentinel,
a plain click on an in-app Open job link (`data-sentinel-result-job`, ordinary or Ralph child)
opens it without a process read and starts the shared To-do excursion, so the job shows
`SentinelTodoOriginBar`'s Back to Sentinel. Stored/model content,
whole-turn raw/copy, review admission, To-do assessment and authorization remain unchanged.

### Conversation compaction

`metadata.compaction` carries queued/running/completed/failed/cancelled state and the durable
task ID. `CompactionBubble` offers Cancel while queued; messages remain sendable and follow
the admission boundary. Owning-server socket updates refresh state across tabs and reloads;
completion refreshes the transcript, failure stays visible, and queued state preserves the
active turn's streaming placeholder. Compact and Cancel route through the workspace client.

Both chat context popovers share `AutoCompactPanel`. Its manual action calls
`useSendMessage.compactNow`, sharing `/compact` execution, duplicate admission, loading
and toast handling while preserving composer drafts and automatic settings. `ChatDetail`
supplies the exact owner client and raw workspace. Busy, read-only, unresolved-owner,
queued/running compaction and OpenCode states disable the action; runtime support errors
use the shared toast. Owner changes revoke retained actions and delayed results.

User turns render through the same escape-at-generation `chatMarkdownToHtml` pipeline as
assistant turns (`breaks: true`, `linkifyFilePaths` skips code spans/blocks).
`shared/htmlLineBreaks.ts` permits only attribute-free `<br>`, `<br/>` and `<br />`
HTML tokens. Shared `renderMarkdownToHtml` table cells use its Marked-token protection
before Forge inline formatting; Notes rich editing already parses and saves cell
breaks. Escapes, code and other raw HTML remain literal in chat and previews, including
interactive table upgrades. The raw toggle shows literal source. Local markdown anchors
(relative, absolute, Windows, `file:`) get `md-local-file-link--html|--source`, which CSS
renders as a trailing browser/code icon; external and other-scheme links stay plain. Turns with
`pasteExternalized: true` keep the typed prompt visible and render the payload as an
in-bubble card, with no extra persisted display state. `LargePasteCard` opens the
exact payload through `openUnifiedPasteTab` when `useUnifiedPanelHostForChat`
matches the turn's chat and its workspace is known. The tab uses the host's panel
scope and the conversation's workspace/source selection as owner; chats without a
matching panel retain inline expand and copy.

For rendered user-message text, `extractInjectedBlocks` removes complete leading
`<coc-chat-mode>`, `<chat-style>` and `<selected_skills>` prefixes in any order and any
subset, each tag consumed at most once. The extracted blocks hang under the bubble as one
`InjectedBlockChips` row, ordered mode, style, then one chip per selected skill. Chips are
colour-coded by kind (mode green, style amber, skill blue) and labelled by value — the mode
chip reads `Ask`/`Autopilot` off the directive's own markers, the style chip off the
`Selected style: ...` line. A chip is only rendered for a block the turn actually carried,
and the whole row disappears when there is none. Past four skills the row folds behind a
`+N` chip that expands it. Clicking a chip opens a single panel below the row: a minimal
scrollable (`max-h-[16rem]`) monospace `<pre>` holding the block verbatim, plus a copy
button — no header, path, or title. Clicking the same chip closes it; clicking another
switches the panel, so at most one is open. Parsing is client-only; raw view (which hides
the row), copy, rewind/edit, search, export, persisted content, and model input use the
original turn content. Assistant turns are not parsed; non-leading supported tags and
every other tag name stay in the displayed message text.

`parseSelectedSkillNames` recovers the skill names from the block's
`The user explicitly selected these skills: ...` sentence (split on `,`, trimmed, deduped;
`[]` on an absent or reworded sentence, which falls back to a single generic
`Selected skills` chip). The parser mirrors `prependSelectedSkillsDirective`
in `server/executors/prompt-builder.ts`; there is no structured per-turn record of the
selected skills yet.

In a repo-group chat, a user turn carrying `repoGroupContext` hangs a collapsed "Repo
group context" toggle (`RepoGroupContextDisclosure`) under its content, revealing the
`<repo_group_context>` block that dispatch appended to the outgoing prompt — verbatim,
preformatted, stale members already dropped. The message text itself is unchanged, and a
turn without the field shows no toggle — the block is re-injected only at first-turn,
history-rebuild, membership-change, and post-compaction boundaries, so most follow-up turns
in a group chat legitimately have no toggle.

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

`buildOverflowItems` emits grouped rows — conversation (Pin/Unpin, References, scratchpad,
same-context chat, Fork) → export (HTML, Select turns, PDF) → CLI (Resume, copy command)
→ window (narrow-tier Float/Pop out) — with `ChatMenuIcons` SVG glyphs. Duration and
model/context usage are `info` items rendered as a muted, non-actionable footer.
`ChatHeaderOverflowMenu` is a `role="menu"` portal with separators between groups,
roving arrow/Home/End focus, Escape/Tab returning focus to the trigger, outside-click
close, viewport clamping and disabled in-flight rows. Pin/Unpin shows at every tier once
the process loads (hidden for read-only chats): `useConversationPin` starts from the
persisted `pinnedAt`, follows list-side pin changes for the same process, and mutates via
the list provider's `setChatPinned` (or the clone-routed `pinArchiveApi` with the chat's
workspace when no provider is mounted), rolling back and toasting on failure.

The folder action uses `useUnifiedPanelHostForChat(taskId)` to open the hosted
workspace right panel in Explorer mode with its navigator tree visible. Its
pressed state follows the panel's open bit, mode, and tree state. A second click
closes only the tree, preserving resource tabs and the panel. Repo-group chats
use the group's panel scope and current dock target. Without a matching panel
(mobile, pop-outs, embedded chats, or a background chat), the action toggles
the chat's source-canvas directory tree instead.

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

### Tool inventory reader

`ChatDetail` supplies its owner-selected client, persisted raw workspace and process ID
only for the current hydrated owner. Unresolved owners and loading replacements omit
the target. `ChatHeaderMetadata.toolInventoryTarget` carries that identity and an owner-scoped
turn refresh key through `ChatHeader` and the compact Notes header to
`ConversationMetadataPopover`. A supplied target enables the Tools footer action beside
Fork, including a footer with Tools alone. Opening the reader closes the popover or
mobile sheet; the surviving metadata trigger receives focus when the reader closes.
Metadata-only native session adapters omit the target rather than guessing an owner.

`useToolInventoryUpdates` observes the existing exact-server/workspace/process socket
for descriptor-free pending/captured invalidations and owner reconnects. It supplies
`refreshKey` without fetching inventory or using optimistic send/status transitions.
Remote pop-outs relay their own owning-server event stream; local pop-outs use
`ReposProvider`'s designated socket.

`ConversationToolsDialog` lazily reads `processes.getToolInventory`, cancels closed or
superseded reads, and polls only pending snapshots while open. Its `refreshKey`
immediately hides preceding-turn data and rejects delayed reads. Search matches names,
descriptions and server labels; source/server groups retain actual descriptors and
explicit completeness gaps. The shared `Dialog` provides opt-in focus containment.

For Sentinel chats with the live `sentinelAdditionalInstructionsEnabled` flag on,
`ChatDetail` derives `ChatHeaderMetadata.additionalInstructionsTarget` (client, workspace,
process ID) from the same exact-owner tool target, so edits never resolve a fallback
server. The popover then shows an "Additional instructions" footer action that opens
`AdditionalInstructionsDialog`: it reads `processes.getAdditionalInstructions` fresh on
each open (retryable load error), saves through `updateAdditionalInstructions`, closes
only after the save succeeds, and keeps the draft with the server message on failure.
Cancel, Escape and dismiss never save; blank text clears; the shared 10000-character
limit blocks Save. The timing copy states that text applies when initial context is
built or after the next compression.

### Bot-managed conversation presentation

`utils/botControl.ts` consumes only the owning server's default-off, gated public
`BotControlPresentation`. Private metadata, payloads, provider selection and automated
turns cannot supply presentation. `BotManagementBadge` serves `ChatHeader`,
`ChatListPane` and the compact Notes header; narrow layouts retain full accessible
source text. The shared metadata popover/mobile sheet exposes control, source and safe
controller, including queued origins. An optional server-authorized thread link also
requires matching-host HTTPS syntax and opens with `noopener noreferrer`.

`buildMetadataProcess` prefers process detail even when its control is absent, clearing
stale queued presentation. SSE applies explicit control/null without synthesizing a
partial process. `useBotControlUpdates` observes existing local/remote socket events
by exact owner and workspace, independently of the page-origin feature config and
process index. List overrides apply only to unchanged source rows and expire on row
refresh/removal or scope change. Process-summary omission clears cached control.
Socket publication is documented in [streaming-architecture.md](../streaming-architecture.md).

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
`ChatDetail` builds the list from `useReposOptional()`; outside a `ReposProvider`
(a pop-out window) the card is local-only.

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
target identity, and optional AI selection) into `task.metadata.implementations` on the
**source** task via the source client. PR-gated records also retain the server-assigned
chain id. The target implementation process records the submitted or merged PR annotation;
`ChatDetail` polls through the target-routed client and mirrors only a chain-matched
annotation into the source record's optional `prUrl`, `prNumber`, and `prState` fields.
This keeps remote targets from calling back into the source server. The card links the PR,
and `onViewRun(processId, targetWorkspaceId)` opens the run on its target server.

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

`buildToolCallRenderModel` (`toolCallRenderModel.ts`) derives normalized identity, summary,
truncation, preview eligibility, response size and the whisper-row metric. Whisper-row and
card variants share `ToolCallDetailSections`; inside `WhisperCollapsedGroup` a call is one
flat row. Browser actions always use that compact row, summarizing action and target.
`toolResultPresentation.ts` extracts raster images from provider-neutral
`binaryResultsForLlm` or MCP image blocks; `ToolResultThumbnails` shares thumbnail/lightbox
presentation between details and the popover without rendering binary payloads as text
or reading image files.

Response size uses a validated retained byte count when duplicate inline prose suppresses
the result; otherwise it measures the available raw string's UTF-8 bytes before display
clipping, including JSON/base64. Empty strings measure zero; unavailable sizes stay hidden.
Headers use B/KiB/MiB/GiB with exact bytes and scope in accessible text. Live and persisted
owner-scoped data need no extra reads. The wire/store has no dedicated reported-size
metadata; omitted content and tokens are never inferred.

The shared body ends with a muted timing line, `Started <start> · <duration>`, using
`startTimeDetailLabel` (`formatStartTimeDetailed`, seconds precision); the collapsed card
header keeps minute-precision `startTimeLabel`. Omitted without a parseable start time.

### Running calls and tool progress

A running call renders a real spinner (reduced-motion safe) in place of the card's status
emoji, with an accessible `<displayName>, in progress` label, and its duration measures
against the `now` argument of `buildToolCallRenderModel` — `ToolCallView` feeds that from
`useRunningClock`, which only ticks while the call is running. `progressText` is the
running-only status line: the latest provider `progressMessage`, else the `waitingText` of
`LONG_RUNNING_TOOL_DISPLAY` (today `read_batch` → `Reading files… This can take a while`),
else ''. The same table humanizes `read_batch` to `Reading files`; its summary is the path
or `N files` read off a paths-like array arg. A settled call shows no progress text even if
persisted data still carries a message — terminal state wins.

`progressMessage` arrives over the provider-neutral `tool-progress` SSE event, which
`useChatSSE` applies in place to the matching running call in the current assistant turn
(name, args, parent, startTime, and status preserved); an event for an unknown or settled
call is ignored.

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
rest into one summary group. A call that is still actively working also stays outside the
collapse — a running `read_batch`, or any running call with a `progressMessage` — so the
operation currently blocking the response is never hidden behind `1 tool call`; it joins
the collapsed history once it settles. The final message is the last `content` chunk plus earlier
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

`buildWhisperFileHunks` replays tool calls into one hunk per operation without
file I/O, and `buildWhisperFileDiff` formats them as a unified diff. Captured
`apply_patch` bodies keep their existing anchors; edits, creates and a leading
unanchored patch body get a synthetic `@@` header (`WhisperFileHunk.header`, never
a real position). Combined sections carry both `diff` and `hunks`.
The classic viewer uses `hideFileHeaders`, so this boundary keeps added-file content
outside the viewer's suppressed git preamble.

`WhisperDiffPanel` (the chat dock and the unified panel's "N files changed" /
Changes `diff` tabs) renders that replayed snapshot in the shared Git/PR review
shell: `ReviewFiles` supplies the tree, selection, filters, resize separator and
narrow drawer. `whisperReviewModel` maps each file to a workspace-relative row
(A/M/D, popover counts) and decides its content honestly. Both diff kinds open
in `MonacoFileDiffViewer` (synthetic models keyed by owner workspace and diff
hash, read-only, no language features): a single all-added new-file hunk is
`whole` (empty original, exact created text); every other change is `patch`,
shown under the patch-only note as `buildSnippetSides` excerpts. Each operation,
split again at every captured `@@` anchor, is its own block that starts with one
shared row (the anchor text, or `⋯` when the position is unknown), so disjoint
hunks never merge. Per-side `lineLabels` (`DiffModelDescriptor.lineLabels`,
applied by the adapter as Monaco `lineNumbers`) number lines only from captured
`@@ -a,b +c,d @@` anchors; synthetic headers and separator rows stay blank.
Deleted and non-reconstructable files say no diff was captured. It never reads
disk, Git or another turn. The footer opens
the first file in tree order, a file row its `focusPath`; selection resets per
open of a frozen group and survives a live Changes source's rebuilds via
`selectionKey`. The Classic engine preference and editor failure
(`DiffEngineFallbackBanner` + Retry) fall back to the classic patch.

### Commit strips

Detected entirely in the SPA from already-loaded turn tool data — no server-side binding or
persistence. Commit-creating commands (`git commit`, `git merge`, `git cherry-pick`,
`git revert`) with native output like `[branch abc1234] subject`, or compact verification
output like `abc1234 subject`, count as commits. For truncated commit output a short
same-turn verification window lets a correlated `git log -1` supply the hash/subject.
Read-only git commands and generic prose are ignored.

Commit rows in strips and the whisper "N commits" popover activate on click; popover rows
are also focusable and activate on Enter/Space, while the trailing ↗️ pop-out keeps its own
click/key handling without activating the row. `ChatDetail` provides a
`ChatCommitOpenerContext` opener (`chatCommitOpener.ts`) only when the unified panel shows
this chat and `chatCommitPanelTarget` resolves its repo; the exact SHA then opens in the
panel's Git tab through `openPanelGitCommit` and the chat stays visible. Otherwise (pop-outs,
lens/side-panel chats, group-level chats) rows keep the `#repos/<workspaceId>/git/<sha>` route.
Commit lookup and not-found states belong to the Git detail.

### ask_user

Live unanswered batches stay owned by `ChatDetail`/`ConversationArea` through
`processDetails.pendingAskUser` and `AskUserInline`. Each question offers Answer, Skip, or
Need context; the deferred choice marks the question complete for batch submission.
Reply fields submit the whole valid batch through the clone-routed button path.
`textarea` drafts preserve whitespace, use Enter for newlines and Ctrl/Cmd+Enter to
submit, and support restoring the supplied draft; one-line fields submit on Enter.
Need context notes allow Shift+Enter multiline input and remain optional. Composition/229 and repeated keydowns do not submit. Synchronous admission
blocks in-flight and accepted duplicates; failed delivery retains the draft for retry.

Unsubmitted live-batch drafts are saved in `localStorage` scoped by process id and batch
id, restored after navigation or refresh for the same batch, and cleared on accepted
submission, skip-all, process cancellation, or replacement by a newer batch id.

`sensitive-input` questions render a masked password field whose value lives in
component state only (never drafts) and is cleared once submit runs. On submit the
dashboard calls the desktop `importCookies` bridge directly (`sensitiveInputSink.ts`) and
posts only the receipt (`{ ok: true, count }` or `{ ok: false, reason }`). Without the
desktop bridge the field is replaced by an "Open CoC desktop" notice and submit answers
`{ skipped: true, reason: 'unavailable' }`; another open dashboard is never pre-empted.

For Ralph multi-agent grilling, optional per-question metadata renders a "Question
planning" summary, role-group headers, provenance chips (`UX Agent · provider/model`),
consolidation chips, and coverage warnings — all one batch submission.

Completed calls render read-only through `AskUserHistoryCard` inside
`ConversationTurnBubble`: persisted `args.questions[]` plus the answer/skip/deferred
result. Textarea answers retain line breaks, collapse long text, and show the server
`edited` marker. There is a compatibility unwrap for older Codex MCP captures stored as
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

Answers render with `chatMarkdownToHtml` (no `wsId`, embeds off) — they are chat content, not
notes. The notes live-preview renderer `renderMarkdownToHtml` deliberately keeps `**`/backtick
markers in `.md-marker` spans and is wrong here. Related: `MarkdownView` re-highlights `pre
code` on mount but skips anything inside `.code-block-container`, since forge's
`renderCodeBlock` already highlighted it and wraps lines in `.code-line`/`.line-number` spans
that `hljs.highlightElement` would flatten.

Answers render with `chatMarkdownToHtml` (no `wsId`, embeds off) — they are chat content, not
notes. The notes live-preview renderer `renderMarkdownToHtml` deliberately keeps `**`/backtick
markers in `.md-marker` spans and is wrong here. Related: `MarkdownView` re-highlights `pre
code` on mount but skips anything inside `.code-block-container`, since forge's
`renderCodeBlock` already highlighted it and wraps lines in `.code-line`/`.line-number` spans
that `hljs.highlightElement` would flatten.

AI-response and rendered Markdown-canvas `MarkdownView`s pass `tableWrapToggle`: upgraded
`InteractiveTable`s get a per-table "Wrap text" toolbar toggle (`aria-pressed`, default off).
`MarkdownView` holds the wrapped set keyed by table portal id, because every `html` change
remounts the portals. Wrapped tables drop the length-weighted `<colgroup>` for auto layout
with a 4rem column floor. Static tables already wrap via `.markdown-body` and get no toggle;
file viewers leave the prop off. Kusto uses the same `InteractiveTable` control directly.

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
flag-independent path. `ChatDetail` drops attached `turn` items when its owner changes.

A sent turn snippet is stored and sent as a leading
`<context from="user|assistant" turn="N">` block (N is the canonical `turnIndex` in the
same chat). `parseTurnReferenceBlocks` (`conversation/turnReference.ts`) reads only those
leading blocks, so later or fenced `<context>` text stays message content; the user bubble
shows a quote card (role label, Markdown-stripped excerpt, **Go to message**) and the raw
view and copy keep the stored content. `ConversationArea.goToTurnReference` accepts only
an earlier turn whose role and text match the quote (`turnMatchesReference`), loading
older pages through `navigateToTurn` or scrolling loaded turns when paging is off;
otherwise the card shows an inline unavailable notice.

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
