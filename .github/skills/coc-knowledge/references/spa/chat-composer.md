# Dashboard SPA — Chat composer

The input area, its toolbars, attachments, and the provider/mode/effort/style selectors
shared with modal job dialogs. Rendering lives in
[chat-conversation.md](chat-conversation.md); run panes, group rows, and the chat list in
[chat.md](chat.md).

## Input area

Stacked layout: `RichTextInput` → toolbar → `ComposerMetaStrip`.

### RichTextInput paste

Paste always inserts plain text via `execCommand('insertText')`, preserving undo. When the
clipboard carries a meaningful `text/html` flavor, `shared/pasteHtmlToMarkdown.ts` converts
it to markdown source first — a lean chat-specific turndown config (bold/italic/
strikethrough, headings, lists, links, inline and fenced code, blockquotes, GFM tables;
inline `<img>` dropped, script/style stripped). Trivial markup (converted markdown equals
the plain flavor modulo escapes and whitespace), absent HTML, or conversion failure falls
back to `text/plain`. Chained `onPaste` hooks (attachments, the >16 KB large-paste chip)
run first and veto via `preventDefault()`.

### Initial-chat toolbar

`NewChatArea` / `InitialChatComposer` use `settingsLayout="responsive"`. At desktop
container widths the toolbar is `AgentSelectorChip` → `ModePillSelector` (Ask/Autopilot
plus a Workflow submenu) → model picker → `EffortPillSelector` or `EffortTierSelector` →
tool buttons (`/`, attach) → send. Below the `wide` tier (<700px via `useContainerWidth`)
it switches to compact layout, so the toolbar compacts before its chip row would wrap;
`settingsLayout="compact"` forces this for lens-sized surfaces.

Compact layout replaces the provider/mode/workflow/model/effort controls with one AI
settings chip labeled `provider · active mode/workflow · effort`, keeping attach, `/`, and
send visible. The chip opens a settings editor pairing provider and effort on one row and
mode/workflow on the next; the model picker renders only when effort-tier mode is inactive,
because in tier mode the tier supplies the model. The editor uses an anchored popover with
visible overflow so nested menus stay unclipped, falling back to a scrollable fixed bottom
sheet when the composer is too narrow.

Commit, PR, and Work Item review-chat empty states reuse `InitialChatComposer` in compact
layout, preserving slash commands, `/model`, prompt history, ghost-text autocomplete, file
and session-context attachments, with sends bound through `context.commitChat`,
`context.pullRequestChat`, or `context.workItemChat`.

### Workflow modes in the composer

Ralph is selected from the Workflow submenu. In the Activity tab the Ralph send control is
a split submit whose primary action is **Grill**, with **Start from goal…** opening an
editable direct-goal review dialog that posts to `/api/ralph-launch` without attachments.
Review-chat composers use the same grilling path but omit the split action so every send
stays bound to the review target.

`For Each` (`forEach.enabled`, internal value `for-each`) and `Map Reduce`
(`mapReduce.enabled`, `map-reduce`) appear in the Workflow submenu for initial chat only —
never in follow-up composers. Submitting either creates a normal persisted Ask-mode
**generation chat**, selects it in Activity detail, and stores
`payload.context.forEach.kind='generation'` or `payload.context.mapReduce.kind='generation'`
metadata carrying workspace, generation ID, child mode, original request, status, latest
valid structured plan, latest invalid-plan error, and eventual run linkage. Generation chats
use the normal provider/model/reasoning, slash-skill, prompt-history, session-context, and
attachment paths; follow-ups stay locked to the plan-generation system context through
persisted metadata.

`ChatDetail` passes `ForEachPlanReviewCard` / `MapReducePlanReviewCard` into
`ConversationArea` as post-conversation content, so review cards stay inside the
`activity-chat-conversation` scroll region above the composer. Each renders the persisted
latest valid plan, falls back to transcript scanning for newer assistant turns, keeps the
previous valid plan when a refinement emits invalid JSON (showing the error inline), offers
a structured editor plus Advanced JSON fallback, and approves through
`client.forEach.create/updatePlan/approve` or the `mapReduce` equivalents — never calling
child start/continue endpoints. Map Reduce adds editable `maxParallel` and
`reduceInstructions`. Run panes, group rows, and approval navigation live in
[chat.md](chat.md).

### Follow-up toolbar

`FollowUpInputArea` lays out provider chip → `ModePillSelector` → model picker →
`EffortPillSelector` (only when the parent supplies `onEffortChange`) → flexible middle
hosting a right-aligned `ComposerMetaStrip` → tool buttons → `QueueFollowUpButton`.

The flexible middle is `flex-basis: 0` + `min-w-0` + `container-type: inline-size`, so the
meta strip can never push the toolbar onto a second row: it grows into free space, shrinks
by truncating the cwd path, and — because basis-0 makes its width equal the toolbar's free
space — container queries hide unshrinkable pieces rather than letting them overlap.

The toolbar measures itself with `useContainerWidth` at a raised `wideThreshold` of 820px
and sheds progressively: below 820px an icon-only model chip and cwd basename; below 500px
mobile controls (mode pills become tap-to-cycle, slash/attach fold into a "⋯" menu) driven
by the container signal, not the `lg:` viewport gate; below 380px provider chip and Send go
`iconOnly` with accessible names preserved; below ~300px `lg:flex-wrap` wraps to a second
row. Provider is locked to the session on a follow-up, so its chip is read-only.

### Focused-composer shortcuts

Model and slash menus keep first priority. With the input focused and no menu open,
`Shift+Up/Down` cycles the visible effort control in both composers (`EffortTierSelector`
skips unconfigured tiers; `EffortPillSelector` cycles Auto plus selectable efforts). In
`NewChatArea` only, `Ctrl+Up/Down` (`Cmd` on macOS) cycles provider, skipping
disabled/unavailable ones and persisting through the repo-scoped `lastChatProvider`
preference. These are absent from labels, tooltips, and ARIA copy.

### ComposerMetaStrip and the warm dot

`ComposerMetaStrip` carries the cwd chip, the context-window fuel gauge, and a provider
badge for non-Copilot sessions. The gauge renders a segmented system/tool/conversation
breakdown when `useChatSSE` receives all three persisted snapshot values
(`sessionSystemTokens`, `sessionToolTokens`, `sessionConversationTokens`) or the same fields
from live `token-usage`; otherwise it falls back to a single-colour bar.

`WarmIndicatorDot` reflects this conversation process's backend warm-client state, with
display and side effect split (`features/chat/hooks/`):

- **Display is stream-only.** `useWarmClientStatus({ workspaceId, processId })` opens the
  warm-only SSE stream (`/processes/:id/stream?warm=1` via `cloneApiBase`), maps
  `warm_status` frames to `cold | warming | warm | active`, and resets to `cold` on
  process/workspace change, error, or unmount. The initial snapshot makes an already-warm
  conversation show the dot immediately. The dot is **never** set from a POST response —
  the stream is the single source of truth, with no client-side TTL or decay.
- **Side effect** is `useTypingPrewarmClient({ input, workspaceId, processId, enabled,
  debounceMs })`: the first non-empty input schedules one debounced
  `client.processes.prewarm(processId, { workspace })` through `getCocClientForWorkspace`,
  fires at most once per typing window, re-arms on empty input or a `(workspace, process)`
  change, and swallows errors. The server prewarms under the process id warm key, so other
  conversations in the same cwd stay cold. `FollowUpInputArea` gates it with
  `enabled: !inputDisabled && !sending && !isActiveGeneration`.

Claude and other non-warming providers only emit `cold`, so their dot is an invisible
spacer.

### Attachments

File and image attachments flow through the shared `useFileAttachments` hook before the
new-chat, follow-up, note-chat, queue, task-generation, review-chat, For Each, and Map
Reduce send paths serialize them. Browser-supported raster images at or above 64 KiB (`png`,
`jpg`/`jpeg`, `webp`) are canvas-downscaled to at most 1600px on the long edge and
re-encoded as JPEG **only when that reduces the payload**, before the wire
`AttachmentPayload` / `images` data URLs reach the server. Smaller, unsupported, and failed
conversions keep their original bytes.

`InitialChatComposer` persists pending attachments to a per-tab `sessionStorage` sidecar
(`attachmentDraftStore`, key `coc.attachmentDraft.<draftKey>`) keyed by the same `draftKey`
as the `useDraftStore` text draft, so pasted images survive in-SPA navigation. Only the wire
`AttachmentPayload` subset is stored — client id and category are regenerated by
`useFileAttachments.restoreAttachments` — and saves over ~2 MB serialized are skipped to
avoid quota errors. The sidecar clears on successful send and Ralph direct-goal launch, and
resets when switching to a draft key with no saved attachments. Follow-up composers and
`EnqueueDialog` do not use this path.

### Session-context attachments

With `features.sessionContextAttachments` enabled, same-workspace chat/process rows, Ralph
session group rows, Work Item list and hierarchy rows, Git commit rows, branch range
headers, and Pull Request rows become copy-drag context sources. `NewChatArea`,
`FollowUpInputArea`, and the desktop repo header Queue Task / Ask buttons accept them.

Drops validate same-workspace, duplicate, self-drop/current-child for session-backed
pointers, and a shared three-logical-attachment cap before adding removable chips through
`AttachedContextPreviews`. `get_conversation` tool availability is required only for
single-session and Ralph pointers. Send paths re-check the same constraints before
formatting attached source IDs, so stale capability state cannot send unusable pointers. Git
commit row *body* drags are copy-only; the unpushed-commit reorder path stays isolated to
the row's grab handle. The review-chat drop target that rebinds an existing chat is in
[chat.md](chat.md).

The formatter emits **pointer-only** blocks: `<attached_session_context>` for single
sessions, `<attached_ralph_session_context>` for Ralph groups, and
`<attached_pointer_context>` for Work Item, commit, range, and PR references. Pointer blocks
store the source workspace ID and stable identifiers (work item ID/number, commit hash,
base/head refs, PR ID/number) plus safe labels, titles/statuses, and summary counts. They
never store work item bodies, diffs, PR descriptions, file contents, or latest-turn
previews. The Ralph block stores workspace ID, session ID, phase/status, title, latest
activity, process/iteration counts, and ordered child process IDs. Single-session drag
payloads title themselves from custom title/title/displayName, then prompt preview or prompt
metadata, then process ID — never `lastMessagePreview`.

`ConversationTurnBubble` parses persisted blocks on user turns and renders collapsed cards
showing pointer metadata plus a raw-block copy affordance; raw mode exposes the exact
persisted content.

### Provider, mode, effort, and style selection

New chats pick a per-chat provider with `AgentSelectorChip`. With
`features.autoAgentProviderRouting` enabled, `Auto` joins Copilot, Codex, and Claude:
selecting it persists `lastChatProvider: "auto"` for the workspace, omits an explicit
provider override, and sends only `context.autoProviderRouting.requested` so the server
resolves a concrete provider at scheduling time. With the flag disabled, persisted `auto`
selections are ignored and the composer falls back to a concrete provider. Concrete
selections send `payload.provider`. Follow-ups show the concrete provider from process
metadata and never offer Auto.

`repos/modeConfig.ts` owns the central `WORKFLOW_REGISTRY` — labels, icons, tooltips, pill
dots, accent colors, categories, surfaces, and feature flags for every chat and workflow
mode. `ModePillSelector` derives Ask and Autopilot from it, and both composers derive
visible options through the registry-backed visibility helper: Ralph appends where its flag
and eligibility rules allow; For Each and Map Reduce append in New Chat under their flags.
In New Chat, `ModePillSelector` renders Ask, Autopilot, and an optional Workflow dropdown as
one segmented pill, the composer card taking the selected workflow's accent. Prompt
schedules expose Ask and Autopilot only. Loaded draft/task/schedule records with
`mode='plan'` normalize to Ask, which has no pill, badge, tooltip, icon, or
custom-instruction tab. Accents: Ask yellow, Autopilot green, Ralph purple, For Each sky
blue, Map Reduce indigo.

`EffortPillSelector` drives the per-turn `reasoningEffort` override (Low/Medium/High;
`null` = no override, falling back to the persisted per-model effort then the SDK default).
It is structurally a dropdown in `AgentSelectorChip` style; the `Auto` entry clears the
override and is what re-clicking the selected level toggles to. New chats persist the choice
alongside the draft (`useDraftStore` → `Draft.effortOverride`). Follow-ups thread it through
`useSendMessage → ProcessMessageRequest.reasoningEffort → POST /api/processes/:id/message`
into `bridge.enqueue` (queued) or `bridge.executeFollowUp` (direct/buffered); the server
mirrors it into `task.config.reasoningEffort` via `queue-shared.validateAndParseTask` so
executors read one canonical location.

Effort-tier mode is enabled by default through `effortLevels.enabled` and can be turned off
live from Admin to get the separate model picker and reasoning-effort controls.
`EffortTierSelector` lists `Very Low`, `Low`, `Medium`, `High`. For concrete providers,
tooltips expose the model and effort each tier maps to (empty effort shows as `Auto`) and
unconfigured options stay disabled with an Admin tooltip. Under Auto, every tier stays
selectable and tooltips explain that provider and model resolve at scheduling time.

`ChatStyleSelector` renders a `Style: <label>` chip after Effort in both composers when
`features.chatStyleSelector` is on. Options come from `CHAT_STYLES` / `CHAT_STYLE_LABELS` in
`@plusplusoneplusplus/coc-client` (`Default` first, then Human, Direct,
Structured) — only the one-line descriptions live in the component; do not re-list the wire
values. Every style is always selectable, with no per-provider configuration.

`useChatStyleSelectorEnabled(baseUrl)` resolves the flag against the server owning the
target: with no `baseUrl` it reads live dashboard config and subscribes to
`DASHBOARD_CONFIG_UPDATED_EVENT`; with one — the clone's raw server root from
`useResolveCloneBaseUrl` / `sourceRemoteInfo`, the shape sibling hooks like
`useAgentProviders` take — it appends the configured api base path itself (mirroring
`cloneApiBase`; remote servers are never container-mode) and fetches
`${root}${apiBasePath}/config/runtime`, cached per root, treating unreachable or older
servers as unsupported.

`NewChatArea` shows the chip for Ask/Autopilot only and always starts on
`DEFAULT_CHAT_STYLE` — no preference seed and no `preferences.patchRepo` write, so a
workspace never carries a style into a new chat. `ChatDetail` *derives* the follow-up style
rather than syncing it into state: a `chatStyleOverride` (null until the user picks, reset
on task change) takes precedence over `processDetails.metadata.chatStyle` (missing or
invalid reads as `'default'`), so a late or partial process record still lands the right
style while a user pick is never clobbered. `useSendMessage.buildMessageRequest()` includes
`chatStyle` only when the flag is on. `ConversationMetadataPopover` shows the `Style` row
unconditionally, `Default` included, because Default is a real state. The style is prepended
to the user message server-side and appears verbatim in the user bubble — the SPA does no
stripping, and Style has no keyboard shortcut.

The model-picker chip in both composers mirrors `AgentSelectorChip` and has no inline clear.
When a `modelOverride` is set, `ModelCommandMenu` renders a `Use default` entry calling
`setModelOverride(null)`. `NoteChatPanel` reuses the menu without `onClearOverride`, so the
clear row appears only in the chat composers.

### Shared modal AI controls

Modal job-submission dialogs use `shared/ModalJobAiControls.tsx` for New Chat-compatible
provider/model/reasoning controls. Its `useModalJobAiSelection()` hook centralizes
workspace-scoped `lastChatProvider` restore/persist, provider-scoped model catalogs,
effort-tier mode, the plain picker + `EffortPillSelector` fallback, optional initial
selections for Resume-style flows, a dirty bit, and resolved payload values. Concrete
selections resolve to `{ provider, model?, reasoningEffort? }`; Auto resolves to
`{ effortTier, autoProviderRouting: true }` with no provider/model override, and submitters
translate that flag to `context.autoProviderRouting.requested` or route-level
`autoProviderRouting: true`, so scheduling picks a concrete provider first and then expands
the tier through that provider's configuration.

Consumers: `queue/EnqueueDialog.tsx` (Advanced area — Ask AI, ad hoc autopilot tasks,
skill/context-file runs, bulk submissions, floating-chat launches),
`tasks/GenerateTaskDialog.tsx` (→ `/api/workspaces/:id/queue/generate`),
`shared/UpdateDocumentDialog.tsx`, `features/work-items/WorkItemExecuteDialog.tsx` (through
`RunSkillPanel` → `/api/workspaces/:id/work-items/:wid/execute`), and
`features/chat/SkillContextDialog.tsx` (git commit, multi-commit, branch-range skill runs).

`queue/SkillPicker.tsx` splits its search box and repo/global grouped keyboard-navigable
list into an exported `SkillPickerPanel`; `SkillPicker` wraps it in the multi-select
trigger/chips popover and `queue/SkillBrowserDialog.tsx` wraps it in a centered
single-select modal. The Git tab's commit context menu lists the top `MRU_SKILL_LIMIT`
skills (ranked by `rankSkillsByRecency` over the `commitSkillUsageMap` preference) inline
under **Use Skill**, with a browse-all entry opening `SkillBrowserDialog` rather than a
third-tier hover submenu. `useGitSkillActions` snapshots the context-menu target into
`skillBrowserContext` when the modal opens and replays it through
`startSkillRun(name, target)` on pick, so the confirm dialog and MRU recording behave the
same as the inline entries.

## Ralph launch surfaces

`features/chat/RalphGrillSetupPanel.tsx` renders the multi-agent grilling setup card when
`features.ralphMultiAgentGrill` is enabled (disabled by default). New Chat Ralph grilling
(`NewChatArea`) and promoted ask-mode chats (`FollowUpInputArea` via `ChatDetail`) share the
card: choose Light/Standard/Deep depth, see inherited provider/effort defaults once, and
expand individual role rows only for per-role overrides before the consolidated
question-planning turn is submitted. While the server runs the grill-agent preflight,
`ConversationArea` renders the transient `ralph-grill-planning` SSE state as a status card.
The live `ask_user` form then renders grill planning metadata from `pendingAskUser` as one
card with grouped role sections — it does not create separate agent threads or separate
answer submissions ([chat-conversation.md](chat-conversation.md)).

`shared/RalphExecutionRepoSelector.tsx` backs every Ralph start surface. Launch callers pass
a transient source reference with the physical `workspaceId`, the clone-qualified
`selectionId` from `getRepoSelectionId(repo)` when available, and a `baseUrl` fallback for
clone-routed pop-out windows. The selector builds targets keyed by `(serverId, workspaceId)`
(`local` is the dashboard server), resolves remote selection IDs by exact server and
workspace, and uses a unique normalized base URL only as a compatibility fallback. It never
treats a missing clone-registry entry as evidence that the source is local. An unresolved,
ambiguous, connecting, or cached-offline source stays unselected behind a focused
availability warning, while unrelated remote aggregation warnings do not disable healthy
targets. Repo refreshes and reconnects restore the source target until the user explicitly
picks another, after which the open dialog owns that choice. Source-less callers keep the
first-available default.

`features/chat/RalphStartPanel.tsx` drives `ModalJobAiControls` from the selected execution
workspace and reuses `/api/processes/:id/ralph-start` only when the resolved source and
selection share an exact target key. `shared/RalphLaunchDialog.tsx` uses the same target
identity for direct goal-file launches from Notes and New Chat and can accept a caller-owned
resolved AI selection. Every cross-workspace or cross-server launch posts to the target
server's `/api/ralph-launch`, and source paths are forwarded only on an exact source-target
match. `features/chat/RalphWorkflowPane.tsx` uses `ModalJobAiControls` in both the
stuck-session Resume and completed-session Continue-loop confirmations, each initialized
from transient session `resumeDefaults` when recoverable and disabled while submitting.
