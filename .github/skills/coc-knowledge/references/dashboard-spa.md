# Dashboard SPA

React-based single-page application served by `coc serve`. Located at `packages/coc/src/server/spa/client/`.

## Entry Point & Shell

- `entry.tsx` — Mounts `App` (main shell) or `PopOut` (floating chat window)
- `html-template.ts` — Server-side HTML generation with inline bundled assets from `client/dist/`

## Module Layout

```
spa/client/react/
├── App.tsx              # Root React component
├── admin/              # Admin panel & preferences UI
├── chat/               # Reusable conversation rendering
├── components/         # Shared UI components (ContextWindowIndicator)
├── contexts/           # React contexts (App, Queue, Task, Toast, FloatingChats)
├── hooks/              # 30+ custom hooks
├── layout/             # Layout (Router, TopBar, BottomNav, ThemeProvider)
├── features/
│   ├── chat/           # Chat UI: ChatDetail, ChatListPane, ConversationArea
│   ├── memory/         # Memory V2 route, facts/review/episodes tabs, repo memory settings section
│   ├── notes/          # Notes UI: NoteEditor, Mermaid zoom/pan, sidebar, multi-root dropdown (useNotesRoots)
│   ├── pull-requests/  # PR dashboard: attention groups, provider-derived PR helpers, provider-id/displayName author matching, real diff-stat queue badges/risk, deterministic review summary, BatchCommandPanel
│   └── terminal/       # Terminal UI: TerminalView, pin/unpin
├── processes/          # Process detail, DAG visualization
├── queue/              # Queue management (EnqueueDialog, QueueView)
├── repos/              # Repository views, clone/add dialogs, file explorer, Monaco editor
├── shared/             # Feature-level shared (MarkdownView, RichTextInput, SourceEditor)
├── tasks/              # Task/plan management, inline comments
├── ui/                 # UI primitives (Button, Card, Dialog, Spinner, Badge, Toast)
├── welcome/            # Onboarding (WelcomeTour, FirstStepsCard, FeatureTip)
├── wiki/               # Wiki UI (WikiView, WikiAsk, WikiGraph)
├── types/              # TypeScript type definitions
├── utils/              # Utility modules
└── featureFlags.ts     # Compile-time feature flags
```

When `features.commitChatLens` is enabled from Admin -> Configure -> Features, review chat uses `useReviewChatPresentation()` / `useCommitChatPresentation()` to render unpinned supported chat targets such as commit detail, commit-backed file diff, commit review popouts, PR detail Ask AI, and PR review popouts as desktop-only bottom-right lenses; mobile/tablet layouts fall back to the existing side-panel or drawer path. Lens open, pin, and minimized states are client-local localStorage scoped by workspace plus review target (`commit` hash or PR repo/id/head discriminator). Minimized state only affects lens presentation and restores from a compact bottom-right pill while keeping the hidden chat tree mounted so drafts and attachments stay intact; pinned chats render in the existing side-panel or drawer path with an Unpin action. The flag is disabled by default, so commit review keeps the legacy `coc.commitChat.open` visibility key and `coc.commitChatPanel.width` resizing behavior until the admin flag is enabled.

`features/chat/ChatListPane.tsx` keeps grouped chat-history expansion state
local to the mounted view. Ralph session groups, For Each run groups, Map
Reduce run groups, and plan-file/history groups render collapsed by default on
mount or workspace switch; unread dots/count badges and Mark all read controls
remain the visibility affordances for unread children. Workspace-scoped group
pins from `client.processes.listGroupPins(workspaceId)` render non-running
Ralph session groups, For Each run groups, and Map Reduce run groups as parent
rows in the existing Pinned section, interleaved with individually pinned chats
by pin time; pinned parent rows are removed from their normal recency bucket
without mutating child process pin/archive state. Running For Each and Map
Reduce parent rows stay in the Running section even when pinned, while retaining
the pinned affordance. Parent rows expose the same hover pin affordance and
context-menu Pin to top/Unpin actions as individual chat rows, but those actions
call the workspace group-pin API instead of changing child process `pinnedAt`.
The chat-list multi-select range model follows rendered grouped rows:
collapsed Ralph sessions, For Each runs, and Map Reduce runs count as one row
and expand to their real child process IDs when selected; expanded groups range
over visible child rows, and desktop Shift-click on a parent row uses that
parent as a range endpoint without opening the detail pane. For Each run groups
are backed by workspace-scoped `client.forEach.list(workspaceId)` summaries and
nest linked generation/child chats by `payload.context.forEach`, persisted
`forEach` metadata, or `generationProcessId`. Map Reduce run groups are backed
by workspace-scoped `client.mapReduce.list(workspaceId)` summaries and nest
linked generation/map/reduce chats by `payload.context.mapReduce`, persisted
`mapReduce` metadata, or `generationProcessId` so child chats do not duplicate
as standalone rows.

## Key Contexts

| Context | Purpose |
|---------|---------|
| `AppContext` | Global app state, workspace selection |
| `QueueContext` | Queue state, enqueue/cancel actions |
| `TaskContext` | Active task tracking |
| `ToastContext` | Toast notification queue |
| `FloatingChatsContext` | Floating chat window management |

`App.tsx` reports `AppContext.selectedRepoId` to the server through
`client.workspaces.reportActiveWorkspace({ clientId, workspaceId })` on mount,
workspace changes, and a 60-second heartbeat while a workspace is selected. The
client ID is session-scoped in `sessionStorage` so multiple dashboard tabs can
report independent active workspaces without collapsing multi-repo state. The
server uses these recent active-workspace reports to refresh the active
workspace's Pull Requests and Work Items caches immediately on active-workspace
changes and then on a 5-minute interval while dashboard activity remains
present.

## Key Hooks

| Hook | Purpose |
|------|---------|
| `useApi` | HTTP client wrapper |
| `useWebSocket` | WebSocket connection management |
| `useMarkdownPreview` | Shared markdown rendering pipeline |
| `useDiffComments` | Inline diff comment state |
| `useUnseenChat` | Read/unread tracking |

## Chat UI Architecture

`ConversationTurnBubble` renders:
- **Assistant turns:** Left-aligned with `C` avatar whose color tracks the
  chat's provider via `getProviderAvatarClasses` (`ProviderBadge.tsx`) —
  Copilot=green, Claude=coral/orange, Codex=indigo. Body is borderless,
  flowing content. The `provider` prop flows from `ChatDetail` →
  `ConversationArea` → `ConversationTurnBubble`; missing/unknown provider
  metadata falls back to the Copilot (green) palette.
- **User turns:** Right-aligned with `Y` avatar (blue), soft-gray rounded bubbles.
  Turns with `pasteExternalized: true` keep any detected short typed prompt
  visible and render the large pasted payload as an in-bubble card with character
  count, three-line preview, expand/collapse, and Copy full content; no extra
  persistent display state is stored.
- **Error turns:** Red error-strip aside with retry button; the avatar
  keeps its dedicated red palette and ignores `provider`.
- **Script output:** Dark terminal window with PASS/FAIL highlighting; the
  avatar keeps its dedicated dark-terminal palette and ignores `provider`.

`ProviderBadge` (the chat-header agent pill) shares the same provider
palette and mirrors `ChatStatusPill`'s "Thinking" style: rounded-full
bordered pill with a leading colored dot followed by the provider label.
Running chat-list rows do not render separate provider pills; their leading
status dot uses the provider palette (Copilot green, Claude coral, Codex
indigo) and falls back to Copilot green when provider metadata is missing.
Task-tree queue activity badges reuse the provider dot palette from
`ProviderBadge`: queued/running items carry `payload.provider` through
`useQueueChat`, and file/folder "in progress" badges fall back to Copilot
green when provider metadata is missing.

`QueuedFollowUps` renders pending messages as compact dashed-border cards with cancel buttons.

`ConversationMetadataPopover` keeps long identifiers as separate label/value rows
for wrapping and log links, while short categorical fields render as a compact
summary chip strip and related fields collapse into `Time`, `Workspace`,
`Ralph`, `Goal`, and `System` rows. When a process exposes
`cumulativeTokenUsage`, the popover also renders live conversation-level
`Tokens` and `USD cost` rows: token totals expand to input/output/cache
breakdowns, and cost uses the server-derived native-first
`conversationCostEstimate.displayedUsdCost` (`actualUsdCost ?? estimatedUsdCost`
per turn) with compact source labels, URL-backed pricing-source links, and
partial/unavailable-pricing caveats. While a conversation is
running, `useChatSSE` mirrors `token-usage` event `cumulativeTokenUsage` and
`conversationCostEstimate` snapshots into the cached process details that feed
the popover; after completion, the normal process refresh replaces that live
snapshot with the final server read model.

`UsageStatsView` renders token totals per model/day plus USD-only cost metadata
for every populated usage cell. The displayed cost uses the native-first
`displayedUsdCost` field (`actualUsdCost ?? estimatedUsdCost` as computed by the
server/Forge layer); cells without a displayable USD value show explicit
`USD pricing unavailable` copy instead of silently leaving cost blank. The UI
does not render Copilot premium request units.

## Tool Call Rendering

Inside `WhisperCollapsedGroup`, tool calls render as compact "whisper-row" variant:
- Single flat row: kind pill + truncated summary + duration + chevron
- Color-coded pills: Read/blue, Grep/Glob/green, Edit/Write/amber, Shell/PS/SQL/purple, Skill/grey

In whisper mode (`toolCompactness === 3`), `filterWhisperChunks` keeps a tail of
the final assistant message plus any `task_complete`/visible `ask_user` chunks,
collapsing everything else into one summary group. The final message is the last
`content` chunk plus earlier content chunks separated from it only by
non-breaking trailing tools (`suggest_follow_ups`, `report_intent`,
`task_complete`, `ask_user`); the walk-back stops at the first substantive
tool/tool-group. This keeps a rich answer visible even when a hidden
`suggest_follow_ups` call splits it from a trivial closing line.

Chat commit strips are detected from real shell output on `powershell`, `shell`,
and `bash` tool calls. The detector only treats commit-creating commands
(`git commit`, `git merge`, `git cherry-pick`, `git revert`) with native git
output such as `[branch abc1234] subject`, or compact verification output such
as `abc1234 subject` from the same commit-creating command, as commits;
assistant prose and read-only git command output are ignored.

Completed `ask_user` tool calls render as read-only historical question cards via
`AskUserHistoryCard` inside `ConversationTurnBubble`. Live unanswered questions
remain owned by `ChatDetail`/`ConversationArea` through `processDetails.pendingAskUser`
and `AskUserInline`; the history card only displays persisted `args.questions[]`
plus the completed answer/skip result, with a compatibility unwrap for older
Codex MCP captures stored as `args.arguments.questions[]`, and is kept visible
outside whisper collapse. Generic `ToolCallView` still handles `ask_user` as a fallback and
summarizes `args.questions[0].question` when present.

`toolNormalization.ts` → `normalizeToolName()` canonicalises SDK-specific names before display and storage. Notable aliases: `read_file`/`open_file` → `view`, `edit_file`/`str_replace`/`str_replace_editor` → `edit`, `write_file`/`create_file` → `create`, `command_execution` → `shell`, `file_change` → `apply_patch`, `Skill` (Claude Code SDK PascalCase) → `skill`. All downstream logic (`getToolKindInfo`, `getToolSummary`, `filterWhisperChunks` skill counting) operates on the normalised lowercase name.
For Codex `file_change` calls normalized to `apply_patch`, `ToolCallView`
continues to summarize from `args.changes`; when the backend enriches the
parameters with a unified `args.diff`, expanded tool details and hover previews
render that patch text instead of the short result summary.
`utils/conversationScan.ts` powers chat References and goal-file detection by
scanning completed file-writing tool calls for pinned document extensions
(`.md`, `.txt`, `.yaml`, `.yml`, `.json`). It detects direct create/write/edit
paths, `apply_patch` added files, and conservative shell `mv`/`move` command
destinations from command arguments, including `bash -c`/`bash -lc` wrappers.
It does not infer created files from arbitrary shell output.

## Input Area

Stacked layout with:
1. `RichTextInput` (contenteditable)
2. Toolbar reads as ownership zones separated by 1 px vertical dividers (`chat-toolbar-divider-*`):
    - **Initial chat (`NewChatArea` / `InitialChatComposer`)**: `AgentSelectorChip` → divider → primary `ModePillSelector` (Ask/Autopilot) plus a Workflow submenu for enabled workflow modes → divider → model picker → `EffortPillSelector` → spacer → ctool buttons (`/`, `@`, attach) → divider → send. Commit and PR review-chat empty states reuse `InitialChatComposer`, so their first-message lenses share the Activity composer behavior for provider/model/reasoning selection, slash commands, `/model`, prompt history, ghost-text autocomplete, file attachments, and session-context attachments while binding sends through `context.commitChat` or `context.pullRequestChat`. Ralph is selected from the Workflow submenu; in the Activity tab the active Ralph send control is a split submit where the primary action is **Grill** and **Start from goal...** opens an editable direct-goal review dialog that posts the reviewed text to `/api/ralph-launch` without sending attachments. Review-chat initial composers use the same Ralph grilling send path but omit the direct-goal split action so every send remains bound to the review target. When `forEach.enabled` is true, initial chat exposes `For Each` through the Workflow submenu with the internal value `for-each`; when `mapReduce.enabled` is true, it exposes `Map Reduce` with the internal value `map-reduce`; neither workflow mode is shown in follow-up composers. Submitting For Each or Map Reduce creates a normal persisted Ask-mode generation chat, selects it in the Activity detail pane, and stores `payload.context.forEach.kind='generation'` or `payload.context.mapReduce.kind='generation'` metadata with workspace, generation ID, child mode, original request, status, latest valid structured plan, latest invalid-plan error, and eventual run linkage. The generation chat uses the normal provider/model/reasoning, slash-skill, prompt-history, session-context, and file/image attachment path; follow-ups remain locked to the matching plan-generation system context through persisted process metadata. `ForEachPlanReviewCard` renders the persisted latest valid item plan when available, falls back to transcript scanning for newer assistant turns, keeps the previous valid plan when a refinement emits invalid JSON or no Advanced JSON, shows that error inline, renders a structured editor plus Advanced JSON fallback, and approves through `client.forEach.create/updatePlan/approve` without calling child start/continue endpoints. `MapReducePlanReviewCard` mirrors that flow with editable `maxParallel` and `reduceInstructions`, validates the complete map/reduce JSON plan, and approves through `client.mapReduce.create/updatePlan/approve` without starting map or reduce work. `ChatListPane` renders these generation chats as normal chat-history rows with sky-blue **For Each** or indigo **Map Reduce** badges and generated-plan previews such as `3 proposed items - draft`, `1 proposed item - approved`, or `4 proposed map items, max 3 parallel - draft`.
   - **Follow-up (`FollowUpInputArea`)**: provider chip → divider → `ModePillSelector` → divider → model picker → `EffortPillSelector` (rendered only when the parent supplies `onEffortChange`) → spacer → ctool buttons → `ComposerMetaStrip` → divider → `QueueFollowUpButton`. Provider isn't switchable on a follow-up (locked to the session), so the provider chip is read-only. At widths below `lg` (≤1023px), the row stays `flex-nowrap`, the segmented mode selector collapses to a tap-to-cycle button, slash/mention/attach collapse into a single overflow menu, `ComposerMetaStrip` is hidden, and visible reachable controls use approximately 32px tap targets; `lg:` classes restore the compact desktop sizes and wrapping behavior.
   - **Focused composer shortcuts**: model/slash menus keep first priority. With the text input focused and no slash/model menu open, `Shift+Up/Down` cycles the visible effort control in both composers (`EffortTierSelector` skips unconfigured tiers; legacy `EffortPillSelector` cycles Auto plus selectable supported efforts). In `NewChatArea` only, provider cycling uses `Ctrl+Up/Down` on Windows/Linux and `Cmd+Up/Down` on macOS, skips disabled/unavailable providers, and persists through the repo-scoped `lastChatProvider` preference. These shortcuts are intentionally not exposed in toolbar labels, tooltips, or ARIA copy.
3. `ComposerMetaStrip`: cwd chip + context-window fuel gauge + provider badge for non-Copilot sessions. The context-window gauge renders a segmented system/tool/conversation breakdown when `useChatSSE` receives all three persisted snapshot values (`sessionSystemTokens`, `sessionToolTokens`, `sessionConversationTokens`) or the same fields from live `token-usage`; otherwise it falls back to the single-colour usage bar. In the follow-up toolbar it sits between the tools zone and the send divider so its info reads as status next to send.

Focus indicator propagates mode-colored ring from contenteditable to parent card.

When `features.sessionContextAttachments` is enabled, same-workspace chat/process
rows, Ralph session group rows, Work Item list/hierarchy rows, Git commit rows,
branch range headers/overview headers, and Pull Request rows are copy-drag
context sources. `NewChatArea`, `FollowUpInputArea`, and the desktop repo header
Queue Task / Ask buttons accept these shared drag/drop payloads. The composers
show a dashed copy-context overlay while supported payloads are dragged over
them and render inline feedback for unsupported drops. They validate
same-workspace, duplicate, self-drop/current-child for session-backed pointers,
and a shared three-logical-attachment cap before adding removable context chips
through `AttachedContextPreviews`. `get_conversation` tool availability is
required only for single-session and Ralph pointers. Single
sessions render as neutral **Session** chips, Ralph groups render as purple
**RALPH** chips, and Work Item/Commit/Range/PR pointers render as sky chips with
stable labels such as `Work Item #123`, `Commit abc1234`, `Range base..head`,
and `PR #45` plus short safe metadata. Git commit row body drags are copy-only
context drags; the existing unpushed-commit reorder path remains isolated to the
row's grab handle so context dragging does not trigger commit reordering.

The header buttons validate the drop, open the queue dialog in task or ask mode,
and seed a removable context chip without submitting. Send paths re-check the same constraints before formatting already-attached
source IDs so stale feature/capability state cannot send unusable pointers. The
attached-context formatter emits pointer-only `<attached_session_context>` blocks
for single sessions, pointer-only `<attached_ralph_session_context>` blocks for
Ralph groups, and generic pointer-only `<attached_pointer_context>` blocks for
Work Item, Git commit, Git range, and Pull Request references. Pointer blocks
store source workspace ID and stable identifiers/references only (for example
work item ID/number, commit hash, base/head refs, PR ID/number) plus safe labels,
titles/statuses, and summary counts when available; they do not store work item
bodies, diffs, PR descriptions, file contents, or latest-turn previews. The Ralph
block stores source workspace ID, Ralph session ID, phase/status, safe
title/display label, latest activity, process/iteration counts, and ordered child
process IDs only. Single-session drag payloads derive their title from custom
title/title/displayName, prompt preview or prompt metadata, then process ID; they
do not use latest-turn previews such as `lastMessagePreview`.
`ConversationTurnBubble` parses persisted attached-context blocks on user turns
and renders them as collapsed cards: neutral "Attached session context" cards
for single sessions, purple "Attached Ralph context" cards for Ralph groups, and
sky pointer cards for Work Item/Commit/Range/PR pointers. These cards show their
pointer metadata and a raw-block copy affordance while raw mode still exposes the
exact persisted message content.

New chats use `AgentSelectorChip` to choose a per-chat provider. When `features.autoAgentProviderRouting` is enabled, `Auto` appears beside Copilot, Codex, and Claude as a composer-facing option; selecting it persists `lastChatProvider: "auto"` for the workspace, omits an explicit provider override, and sends only `context.autoProviderRouting.requested` so the server resolves a concrete provider at scheduling time. When the flag is disabled, persisted `auto` selections are ignored and the composer falls back to a selectable concrete provider. Concrete provider selections still send `payload.provider`. Follow-up inputs show the concrete provider stored on the process metadata so existing chats continue using their original provider and never offer Auto switching.

`repos/modeConfig.ts` owns the central `WORKFLOW_REGISTRY` for chat/workflow mode labels, icons, tooltips, pill dots, accent colors, categories, surfaces, and feature flags. `ModePillSelector` derives Ask and Autopilot defaults from that registry, while New Chat and follow-up composers derive visible mode options through the registry-backed visibility helper. Ralph is appended only where the existing Ralph feature flag and eligibility rules allow it. For Each is appended only in New Chat when `forEach.enabled` is true, or in follow-up composers when explicitly allowed and feature-enabled. Map Reduce is appended only in New Chat when `mapReduce.enabled` is true. In New Chat, `ModePillSelector` renders Ask, Autopilot, and an optional Workflow dropdown as one segmented pill; the Workflow segment shows the generic `Workflow` label until a workflow mode is selected, then displays the selected workflow option's registry label (e.g. `Ralph`, `For Each`, `Map Reduce`). The Workflow segment remains visibly active when a workflow mode is selected, mirrors the selected workflow dot, and the composer card keeps the selected workflow mode's registry accent. Prompt schedules expose Ask and Autopilot only. Legacy loaded draft/task/schedule records with `mode='plan'` are normalized to Ask for display and follow-up behavior, and the dashboard does not render a separate Plan pill, badge, tooltip, icon, or custom-instruction tab. Mode accents are Ask yellow, Autopilot green, Ralph purple, For Each sky blue, and Map Reduce indigo.

`features/chat/ForEachRunPane.tsx` renders the dedicated For Each detail pane for `#repos/<workspaceId>/(activity|chats|tasks)/for-each/<runId>` links, approved generation chats, and For Each group-row selection when `forEach.enabled` is true. It reads the parent run through `coc-client`'s `forEach` domain, shows the full original request, parent status, child mode, shared instructions, item status chips, generated prompt previews, a link back to the persisted generation chat when `generationProcessId` is present, and child process links, and exposes explicit Start/Continue, Retry failed item, Skip pending/failed item, Cancel remaining, and Refresh actions. It does not render Ralph journals, recurring loop controls, DAG workflow nodes, or sibling item result context. Generation chats pass approval navigation through `ChatDetailPane`/`RepoChatTab`, which clears the selected chat and opens the run-pane hash after the reviewed plan is approved; For Each group rows use the same parent routing, For Each hashes restore the parent pane on desktop and mobile, and selecting a generation or child chat clears the parent pane and opens the chat detail.

`features/chat/MapReduceRunPane.tsx` renders the dedicated Map Reduce detail pane for `#repos/<workspaceId>/(activity|chats|tasks)/map-reduce/<runId>` links, approved generation chats, and Map Reduce group-row selection when `mapReduce.enabled` is true. It reads the parent run through `coc-client`'s `mapReduce` domain, shows the full original request, parent status, max parallelism, child mode, shared instructions, map item table, reduce-step status/instructions, a link back to the persisted generation chat when `generationProcessId` is present, map child process links, and an `Open final result` link to the completed reduce child process. It exposes explicit Start/Continue, Retry failed map item, Skip pending/failed map item, Retry reduce, Cancel remaining, and Refresh actions. Generation chats pass approval navigation through `ChatDetailPane`/`RepoChatTab`, which clears the selected chat and opens the run-pane hash after the reviewed plan is approved; Map Reduce group rows use the same parent routing, Map Reduce hashes restore the parent pane on desktop and mobile, and selecting a generation/map/reduce child chat clears the parent pane and opens the chat detail.

Modal job-submission dialogs use `shared/ModalJobAiControls.tsx` when they need New Chat-compatible provider/model/reasoning controls. Its `useModalJobAiSelection()` hook centralizes workspace-scoped `lastChatProvider` restore/persist, provider-scoped model catalogs, effort-tier mode, legacy model picker + `EffortPillSelector` fallback, optional initial AI selections for Resume-style flows, a dirty bit, and resolved payload values for queue/chat submissions. Concrete selections resolve to `{ provider, model?, reasoningEffort? }`; Auto resolves to `{ effortTier, autoProviderRouting: true }` with no provider/model override, and submitters translate that flag to `context.autoProviderRouting.requested` or route-level `autoProviderRouting: true` so scheduling routes can pick a concrete provider first and then expand that tier through the selected provider's configuration. `queue/EnqueueDialog.tsx` uses these compact controls in its Advanced area for Ask AI, ad hoc autopilot tasks, skill/context-file runs, bulk context-file submissions, and floating-chat launches. `tasks/GenerateTaskDialog.tsx` uses these compact controls in its configuration area and forwards the resolved values to `/api/workspaces/:id/queue/generate`; `shared/UpdateDocumentDialog.tsx` uses them in the existing configuration area and enqueues custom chat tasks; `features/work-items/WorkItemExecuteDialog.tsx` renders the same controls through `RunSkillPanel` and forwards them to `/api/workspaces/:id/work-items/:wid/execute`; `features/chat/SkillContextDialog.tsx` uses them for git commit, multi-commit, and branch-range skill runs; `features/chat/RalphStartPanel.tsx` uses them for confirmed grilling-phase Ralph starts and posts the resolved selection to `/api/processes/:id/ralph-start`; `shared/RalphLaunchDialog.tsx` uses the same controls for direct goal-file Ralph launches from Notes and can also accept a caller-owned resolved AI selection for New Chat direct-goal launches before posting to `/api/ralph-launch`; `features/chat/RalphWorkflowPane.tsx` uses them in both the stuck-session Resume confirmation and the completed-session Continue-loop confirmation, each initialized from transient session `resumeDefaults` when recoverable and disabled while that action is submitting. Classify-diff toolbars call `useModalJobAiSelection()` directly and render `features/git/diff/ClassifyDiffAiControls.tsx`, an inline toolbar variant that hides the provider chip when only one provider is selectable and shows either an effort-tier selector or the pickable-model command picker. Diff classification categories are `logic`, `mechanical`, `test`, `simple`, and `generated`; `simple` is labeled "Simple function" and remains low-attention by default. PR and commit popout file rails show compact category badges plus a critical marker, and their selected-file unified diff views render test fidelity comments, logic summaries, and critical usage/call-stack evidence inline near each classified hunk; branch-range popout diff UI stays on the compact classification-free path.

`EffortPillSelector` drives the per-turn `reasoningEffort` override (Low/Medium/High; `null` = no override, falls back to the persisted per-model effort then the SDK default). The chip is structurally a dropdown menu (`AgentSelectorChip` style): trigger button (bars icon + label + chevron) opens a popover listbox with `Auto`/`Low`/`Medium`/`High` entries. The `Auto` entry explicitly clears the override and is also what the currently-selected level toggles to when re-clicked. New chats persist the selection alongside the draft (`useDraftStore` → `Draft.effortOverride`). Follow-ups thread the choice through `useSendMessage → ProcessMessageRequest.reasoningEffort → POST /api/processes/:id/message` and into either `bridge.enqueue` (queued) or `bridge.executeFollowUp` (direct/buffered). The server mirrors the value into `task.config.reasoningEffort` via `queue-shared.validateAndParseTask`, so executors see it from a single canonical location.

When effort-tier mode is enabled, `EffortTierSelector` lists `Very Low`, `Low`, `Medium`, and `High` in that order. For concrete providers, tooltips expose the concrete model and reasoning effort mapped to the selected tier and each configured menu option; empty reasoning effort displays as `Auto`, and unconfigured options remain disabled with an Admin configuration tooltip. For the Auto provider selection, all tier keys remain selectable and tooltips explain that the provider and model are resolved at scheduling time.

The Admin AI Provider page's Provider routing subtab exposes the single `features.autoAgentProviderRouting` toggle. When enabled, Auto becomes the default for omitted-provider chats, tasks, and API-created work; explicit provider selections and follow-ups keep their provider. The same subtab lets admins reorder provider rules, toggle each rule, edit normal minimum remaining quota percentages, toggle and edit weekly guard thresholds, choose a fallback provider, and preview the concrete provider selected by the shared Auto router using the current availability state plus cached quota response. The Default Provider buttons only select concrete providers (`copilot`, `codex`, `claude`) for the non-Auto fallback path. The Refresh quota button force-refreshes the provider quota cache and updates the preview. When Auto is disabled, the rule editor is hidden behind an Auto-disabled message.

The Admin AI Provider page's `ProviderEffortTiersSection` uses the same tier order (`Very Low`, `Low`, `Medium`, `High`) when editing provider defaults. Rows sourced from hardcoded provider defaults are prefilled and marked with a `Default` badge; saving persists only rows explicitly changed from those defaults, and clearing an override reverts that row to its provider default.

Quota UI math lives in `shared/quotaUtils.ts`. It formats quota-window labels,
clamps remaining and used percentages, maps remaining percentages to risk
classes, and selects the tightest finite quota across one provider or across
enabled providers. Known provider windows label `five_hour` as `5h` and
`seven_day` as `Weekly`; unknown ids are converted to readable text. The Admin
provider routing table uses those helpers for quota cells: Codex and Claude
finite `quotaTypes[]` snapshots render as compact per-window rows with a
readable quota-window label, remaining percentage, used/entitlement caption,
and remaining-usage bar. Copilot finite quotas render as the single
tightest-limit row used by the legacy quota cell. The page-level quota-risk
summary uses the tightest finite quota across all providers. When the non-container
Admin AI Provider tab is active, `AdminPanel` loads
`admin.getAgentProvidersQuota()` without `force` so the page displays the
server's cached quota snapshot after refresh or tab entry; the page's Refresh
quota button still calls the force path. The desktop
top-bar `AgentProviderQuotaIndicator` uses the same helpers to fill a circular
gauge to the most-constrained enabled provider's used percentage and to render a
NotificationBell-style dropdown. The dropdown lists one row per enabled
provider; each row's gauge and risk badge are driven by that provider's tightest
finite quota window, while the body lists every finite quota window (e.g. both
`5h` and `Weekly`) with its used/entitlement caption and a minute-level UTC reset
timestamp (`YYYY-MM-DD HH:MM`) plus a remaining-time countdown (`Xd Yh left` for
multi-day windows, `Xh Ym left` otherwise, or `due` once elapsed). It also
shows an unlimited badge for all-unlimited providers, provider-level errors, a
last-updated line,
a force-refresh button that calls `admin.getAgentProvidersQuota({ force: true })`,
and an `#admin/agents` link to the AI Provider page.

The model-picker chip in both `NewChatArea` and `FollowUpInputArea` mirrors the `AgentSelectorChip` style: icon + label + chevron, no inline `✕` clear. When a `modelOverride` is set, `ModelCommandMenu` renders a `Use default` entry at the top of the dropdown that calls `setModelOverride(null)`; clearing flows through the menu rather than a chip-side button. `NoteChatPanel` reuses the same menu without passing `onClearOverride`, so the clear row only appears in the chat composers.

## Top Bar

Right-hand action cluster:
`[Connected pill | NotificationBell | AgentProviderQuotaIndicator | Admin | Theme]`.
The quota indicator is hidden below the `md` breakpoint; the mobile top bar does
not render the quota dropdown trigger.

The legacy "Tools" popover has been migrated into the Admin page's left
sidebar, but there is no longer a generic Tools group. The Admin sidebar is
grouped by user task: Configure, Knowledge, Connections, Operations, and
Developer / Internals. Embedded tool rows keep stable ids (`memory-toggle`,
`skills-toggle`, `logs-toggle`, `stats-toggle`,
`servers-toggle`) and `data-tab` still carries the matching dashboard route;
Servers is shown only when `isServersEnabled()` is true.

Clicking an embedded tool row dispatches `SET_ACTIVE_TAB` and updates
`location.hash` to the corresponding top-level route (`#memory`, `#skills`,
`#logs`, `#stats`, `#servers`). The Router maps every embedded tool
tab plus `'admin'` itself to a single `<AdminPanel />` render, so the admin shell
(sidebar + breadcrumb + right pane) stays mounted across navigation.
`AdminPanel` switches on `state.activeTab` — when it matches an embedded tool
route, the right pane mounts the corresponding View embedded inside an
`.ar-tool-embed` flex column (instead of the standard `.ar-page` card grid).
The breadcrumb reads `<Group> / <Label>` while a view is embedded.

Clicking an admin/settings row resets the dashboard tab back to `'admin'`,
unmounts the embed, and renders the standard admin card content.
Each tool's internal sub-tab/hash scheme (e.g. `#skills/installed`,
`#logs?sessionId=…`) is unchanged.

## Onboarding

- `WelcomeTour`: 5-step full-screen modal (Welcome/Modes/Queue/Multi-repo/Servers)
- `FirstStepsCard`: Guided checklist replacing empty repos state
- `FeatureTip`: Contextual dismissible tips
- State in `GlobalPreferences` (hasSeenWelcome, onboardingProgress, dismissedTips)

## Activity Tab

- Action bar: New chat + refresh + ALL/AP split pause pill
- Scope segmented control: Chats / Loops (when `loops.enabled`) / Automations / All
- Search box
- Selection persists in `localStorage['coc-activity-scope']`
- For Each parent run group rows render in Activity Chats and All, but not in
  Activity Automations or Loops; loop-linked child chats can still appear in
  Loops independently of the hidden parent group row.

Ralph activity deep-links mount `RalphWorkflowPane`, which shows a unified task timeline alongside a read-only session file browser. The timeline interleaves iteration nodes (the union of `record.iterations` and parsed `progress.md` sections) with final-check nodes built from `record.finalChecks`: each `RalphFinalCheckRecord` renders a distinct `RalphFinalCheckNode` labeled `Final check #<checkIndex>` immediately after the iteration it validates (`sourceIteration`), and therefore before the first iteration of any gap-fix loop it starts. Final-check nodes show status (`queued`/`running`/`completed`/`failed`) and a gap summary (`No gaps`, `1 gap`, `<N> gaps`, or an in-progress/unknown copy); a node with a recorded `processId` is clickable and opens that final-check chat process, while one without is rendered disabled. Gap-fix loops (a loop whose index matches a `finalCheck.gapLoopStarted`/`gapLoopIndex`) render a `Gap fix loop <N>` divider that is not gated behind `RALPH_MULTI_LOOP` since it follows final-check visibility; generic `Loop <N>` dividers keep their existing `RALPH_MULTI_LOOP`-gated behavior. Final-check visibility is display/navigation only — it reads already-persisted session data and adds no new persistence. The file browser lists the raw files returned by the Ralph session API, selects the first file by default, renders Markdown files through the shared markdown renderer, and formats JSON files as plain indented text. For stuck executing sessions with no running iteration, the pane's Resume confirmation renders `ModalJobAiControls`; unchanged recovered `resumeDefaults` are omitted so the resume route preserves prior AI settings, while changed selections are serialized to `workspaces.resumeRalphSession()`. The completed-session Continue-loop confirmation renders the same controls and serializes the extension to `workspaces.continueRalphSession()` (a `RalphContinueRequest` carrying `additionalIterations` plus the optional AI overrides) with the identical omit-when-unchanged behavior. The pane accepts an optional selected filename from the router and reports file selections back to the host so URL hash wiring can deep-link individual session files with `#repos/{workspaceId}/activity/ralph/{sessionId}/{filename}`; bare and trailing-slash session hashes have no pre-selected file and fall back to the first file.

## Memory Route

The top-level `#memory` route is embedded in the Admin shell's Knowledge group and renders `MemoryV2Panel` in the right pane. The panel root owns the stable `#view-memory` id. `MemorySubTab` values are `facts`, `review`, `episodes`, and `settings`; hash links such as `#memory/review` and `#memory/settings` select the matching V2 tab. The legacy memory-config panel is not rendered on the Memory route (the tool-call/explore cache has been removed). Repo settings still use `RepoMemorySection` for repo-scoped bounded memory and raw memory inspection.

`MemoryV2Panel` lists the global scope plus registered workspace scopes, lets users enable/disable the active scope from the Settings tab, exports JSON, and wipes the active scope after confirmation. The tab content is split into `MemoryV2FactsTab`, `MemoryV2ReviewTab`, `MemoryV2EpisodesTab`, and `MemoryV2SettingsTab`.

## Feature Flags

`featureFlags.ts` defines compile-time flags (e.g., `SHOW_WELCOME_TUTORIAL`). Runtime feature flags are exposed through `GET /api/config/runtime` and SPA helpers in `utils/config.ts`; `workItems.sync.enabled` only reports usable sync UI when both it and `workItems.hierarchy.enabled` are true. Most features gated by flags are disabled by default. The Git tab's cross-clone cherry-pick UI is gated by `features.gitCrossCloneCherryPick` / `gitCrossCloneCherryPickEnabled` and is enabled by default. Chat composer drag/drop session-context attachments are gated by `features.sessionContextAttachments` / `sessionContextAttachmentsEnabled`; when enabled, same-workspace chat rows, process cards, queue/history process rows, process search result cards, Ralph session group rows, Work Item rows/cards, Git commit rows, Git branch-range headers, and Pull Request rows become copy-drag sources using custom pointer-only MIME payloads, and desktop repo-header Ask/Queue Task buttons become copy drop targets that seed queue-dialog chips. Single-session payloads contain workspace ID, process ID, title/preview, status, and last-activity metadata; Ralph group payloads contain workspace ID, Ralph session ID, phase/status, title/display label, last activity, and ordered child process IDs. Work Item, commit, range, and PR payloads contain stable IDs/references plus safe display metadata only.

## Work Items

`WorkItemsTab` presents hierarchy mode as two top-level tracker tabs: **Local** and **Remote**. The selected tracker tab is stored in `localStorage` with a key scoped by `workspaceId`; valid saved values restore on mount, invalid or missing values fall back to Local, and work item/session/commit deep links keep using the existing hash shape while the list pane initializes from the saved tracker tab. The Local tab passes `tracker=local-only` to the tree endpoint and shows local creation actions for local-only Epic trees. The Remote tab calls `workItems.syncStatus(...)` without a provider override, uses the workspace repo remote-derived `remoteProvider` as the authoritative visible provider, and only requests the matching `tracker=github-backed` or `tracker=azure-boards-backed` tree. When one supported provider is detected, the Remote tab shows only that provider's icon, the provider chip header shows only that provider (no All chip), the title/subtitle/empty copy and import dialog are provider-specific, and unavailable/auth/setup warnings apply only to the detected provider. Available providers do not render a success/ready banner. Missing, unsupported, or unrecognized workspace remotes show a concise setup message and hide provider chips and import affordances. The Remote import action opens directly in the detected provider mode, then the SPA switches to Remote, persists Remote as the selected tracker tab, selects/highlights the imported root Epic row/card, and keeps the provider filter aligned with the imported provider.

The Work Items list, grouped list, hierarchy tree, and remote sync-status routes are backed by a server-side response cache that can be proactively warmed for the currently active workspace. Background warming refreshes the default local list/grouped responses, the Local tracker tree, the Remote sync status, and the detected Remote provider tree when hierarchy and sync are enabled. Failed background refreshes do not clear stale cached responses, and explicit GETs can pass `force=true` to bypass and replace the cached response.

`WorkItemDetail` is an always-editable inline form: title, description, priority, tags, status, parent, success criteria, and plan content remain editable without an Edit-mode toggle. Description and plan use per-field Source/Preview markdown controls. The view tracks a unified dirty draft; Ctrl+S/Cmd+S and the Save button send one `workItems.update` PATCH containing every dirty metadata field plus `plan.content` when changed. There is no instant status save and no standalone plan save from the detail screen. If a remote-backed save returns `WORK_ITEM_SYNC_CONFLICT`, the detail view renders an inline warning panel near the save/error area with per-field "Your draft" versus provider value cards and retries the same PATCH path with `syncConflictResolution` after the user applies choices. Dirty work-item detail pages show an unsaved-changes indicator, install a `beforeunload` warning, guard the local back breadcrumb, block dirty hash route changes when the user cancels, and intercept hash links before navigation.
Detail fetch and draft state are scoped to the current `workspaceId` + `workItemId`; stale responses from prior selections are ignored, and drafts initialize or save only when the loaded detail item matches the active selection.

The split Local/Remote tracker views do not show the legacy per-item preview/import/export/sync toolbar, and remote-backed Epic roots do not expose manual provider pull actions. Initial import remains the user-facing Remote tracker seeding action; subsequent remote-to-local refreshes are owned by background provider polling. Adding children under GitHub- or Azure-backed roots still uses the normal create flow, which pushes the new child to the backing provider before storing its mirror metadata. Tree rows and detail headers use provider-specific mirror badges that link to the GitHub issue or Azure Boards work item when the remote URL is available.

## coc-client Integration

The SPA consumes `@plusplusoneplusplus/coc-client` for typed REST transport. Domain clients: admin, processes, queue, schedules, tasks, notes, workflows, wiki, memory, memoryV2, skills, preferences, seen-state, work-items, agentProviders, git. The git domain includes commit/diff/branch helpers, operation history, and patch-transfer export/apply methods used by cross-clone cherry-pick flows. The Git tab treats async git operation responses with `jobId` as pending work, polling operation history until terminal status before refreshing; failed Drop Commit jobs render the tab-level action-error banner. The same-clone commit context menu opens `BranchPickerModal` as a local-branch selector for `Cherry-pick to branch…`, sends selected commit hashes oldest-first through `client.git.cherryPick(..., { hashes, targetBranch })`, shows server dirty/conflict errors in the tab action banner, refreshes on success, and keeps the user on the original branch after the server switches back. When enabled, the Git commit context menu opens `CrossCloneCherryPickModal`, which lists current-CoC registered workspaces plus online registered remote-CoC workspaces using typed workspace/git-info clients, groups targets by normalized remote URL, recommends same-remote clones, labels each target with its CoC server, requires explicit cross-remote confirmation, and requires explicit dirty-target stash opt-in. Local targets call git patch export/apply directly; remote targets call the initiating server's `servers.cherryPickTransfer` orchestrator.

Local React hooks (`fetchApi`, `useWebSocket`, `seenStateApi`) wrap the client for React state management.

## Pull Requests Tab

The Pull Requests tab is enabled by default through `pullRequests.enabled`. The left queue rail starts with the "Open PR by # or URL" input; successful opens from that input are validated through the PR detail API, recorded through the repo-scoped recent-opened PR API, and shown in a compact "Recently opened" list directly below the input. Recent entries stay hidden when empty or when the rail is collapsed, open through the same overview navigation path, and confirmed 404s remove the stale entry from the list.

Queue filters include All, Mine, Team, Blocked, Ready, and the optional For You pill. Team reads the repo-scoped coworker roster through `coc-client`, maps to the existing `scope=all` PR list fetch, and filters the loaded open PRs client-side by provider author id with a displayName fallback. When Team is active, the rail shows roster chips that can be toggled for transient in-session narrowing, removed through the roster API, and extended with an Add coworker picker sourced from distinct authors in the loaded `scope=all` PRs. Its count badge reflects the loaded PR set, so additional roster matches beyond the current page appear after Load more fetches them.

Queue rows use server-enriched provider/git diff stats for file count, review-minute estimates, and deterministic risk tiers: low below 200 changed lines, medium from 200 through 800, and high above 800. Missing diff stats render unavailable queue metadata instead of falling back to mock data.

The PR list route is backed by a server-side cache that can be proactively warmed
for the currently active workspace. Background warming uses the same provider
list and diff-stat enrichment path as the tab load, refreshes the default
`open`/`mine` list without clearing stale data on failure, and reads the
repo-scoped recently opened list, Team roster, and cached suggestions when PR
suggestions are enabled.

The PR detail overview renders a deterministic review-summary card from the PR description, parsed/provider diff stats, checks, reviewers, and comment threads. Findings are derived from failing checks and unresolved threads, and the former persona-lens grid is not rendered.

PR popout file views expose a Full context toggle that calls the PR per-file diff endpoint with `fullContext=true`. The server first tries a full-file-context git diff from PR `baseSha` to `headSha`, fetches missing PR commits into the requested repo checkout when possible, and only then returns the hunk-only diff with `fullContextUnavailable: true`; the banner is shown only for that fallback response.

PR review suggestions remain behind the separate `pullRequests.suggestions` config flag. The `For You` filter includes a `Generate suggestions`/`Refresh` action that first refreshes review history, then asks the server to rank open PRs. The UI shows inline progress, empty-state guidance, and recovery messages for missing review history or provider errors.
