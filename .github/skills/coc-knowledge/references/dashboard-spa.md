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
│   ├── pull-requests/  # PR dashboard: attention groups, provider-derived PR helpers, real diff-stat queue badges/risk, deterministic review summary, BatchCommandPanel
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

`features/chat/ChatListPane.tsx` keeps grouped chat-history expansion state
local to the mounted view. Ralph session groups and plan-file/history groups
render collapsed by default on mount or workspace switch; unread dots/count
badges and Mark all read controls remain the visibility affordances for unread
children.

## Key Contexts

| Context | Purpose |
|---------|---------|
| `AppContext` | Global app state, workspace selection |
| `QueueContext` | Queue state, enqueue/cancel actions |
| `TaskContext` | Active task tracking |
| `ToastContext` | Toast notification queue |
| `FloatingChatsContext` | Floating chat window management |

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
- **User turns:** Right-aligned with `Y` avatar (blue), soft-gray rounded bubbles
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
output such as `[branch abc1234] subject` as commits; assistant prose and
read-only git command output are ignored.

Completed `ask_user` tool calls render as read-only historical question cards via
`AskUserHistoryCard` inside `ConversationTurnBubble`. Live unanswered questions
remain owned by `ChatDetail`/`ConversationArea` through `processDetails.pendingAskUser`
and `AskUserInline`; the history card only displays persisted `args.questions[]`
plus the completed answer/skip result and is kept visible outside whisper
collapse. Generic `ToolCallView` still handles `ask_user` as a fallback and
summarizes `args.questions[0].question` when present.

`toolNormalization.ts` → `normalizeToolName()` canonicalises SDK-specific names before display and storage. Notable aliases: `read_file`/`open_file` → `view`, `edit_file`/`str_replace`/`str_replace_editor` → `edit`, `write_file`/`create_file` → `create`, `command_execution` → `shell`, `file_change` → `apply_patch`, `Skill` (Claude Code SDK PascalCase) → `skill`. All downstream logic (`getToolKindInfo`, `getToolSummary`, `filterWhisperChunks` skill counting) operates on the normalised lowercase name.

## Input Area

Stacked layout with:
1. `RichTextInput` (contenteditable)
2. Toolbar reads as ownership zones separated by 1 px vertical dividers (`chat-toolbar-divider-*`):
   - **New chat (`NewChatArea`)**: `AgentSelectorChip` → divider → `ModePillSelector` → divider → model picker → `EffortPillSelector` → spacer → ctool buttons (`/`, `@`, attach) → divider → send. When Ralph is selected, the send control is a split submit: the primary action is **Grill** and still enqueues the existing ask-mode grilling flow, while **Start from goal...** opens an editable direct-goal review dialog that posts the reviewed text to `/api/ralph-launch` without sending attachments.
   - **Follow-up (`FollowUpInputArea`)**: provider chip → divider → `ModePillSelector` → divider → model picker → `EffortPillSelector` (rendered only when the parent supplies `onEffortChange`) → spacer → ctool buttons → `ComposerMetaStrip` → divider → `QueueFollowUpButton`. Provider isn't switchable on a follow-up (locked to the session), so the provider chip is read-only. At widths below `lg` (≤1023px), the row stays `flex-nowrap`, the segmented mode selector collapses to a tap-to-cycle button, slash/mention/attach collapse into a single overflow menu, `ComposerMetaStrip` is hidden, and visible reachable controls use approximately 32px tap targets; `lg:` classes restore the compact desktop sizes and wrapping behavior.
3. `ComposerMetaStrip`: cwd chip + context-window fuel gauge + provider badge for non-Copilot sessions. The context-window gauge renders a segmented system/tool/conversation breakdown when `useChatSSE` receives all three persisted snapshot values (`sessionSystemTokens`, `sessionToolTokens`, `sessionConversationTokens`) or the same fields from live `token-usage`; otherwise it falls back to the single-colour usage bar. In the follow-up toolbar it sits between the tools zone and the send divider so its info reads as status next to send.

Focus indicator propagates mode-colored ring from contenteditable to parent card.

When `features.sessionContextAttachments` is enabled, both `NewChatArea` and
`FollowUpInputArea` accept drag/drop session-context payloads from same-workspace
chat/process rows. The composers validate same-workspace, duplicate, self-drop,
three-session cap, and `get_conversation` tool availability before adding
removable session chips through the existing `AttachedContextPreviews` surface.
The attached-context formatter emits pointer-only `<attached_session_context>`
blocks in user-message content; it stores source workspace/process IDs, status,
title, and last activity only. `ConversationTurnBubble` parses persisted
session-context blocks on user turns and renders them as collapsed "Attached
session context" cards with title, status, last activity, workspace/process IDs,
and a raw-block copy affordance while raw mode still exposes the exact persisted
message content.

New chats use `AgentSelectorChip` to choose a per-chat provider. The initial selection comes from the workspace's `lastChatProvider` preference when that provider is enabled and available; otherwise it falls back to the configured `defaultProvider` from runtime config, and then to Copilot if the configured default provider cannot be selected. Follow-up inputs show the provider stored on the process metadata so existing chats continue using their original provider.

`ModePillSelector` exposes Ask and Autopilot by default. Ralph is appended only where the existing Ralph feature flag and eligibility rules allow it; prompt schedules expose Ask and Autopilot only. Legacy loaded draft/task/schedule records with `mode='plan'` are normalized to Ask for display and follow-up behavior, and the dashboard does not render a separate Plan pill, badge, tooltip, icon, or custom-instruction tab. Mode accents are Ask yellow, Autopilot green, and Ralph purple.

Modal job-submission dialogs use `shared/ModalJobAiControls.tsx` when they need New Chat-compatible provider/model/reasoning controls. Its `useModalJobAiSelection()` hook centralizes workspace-scoped `lastChatProvider` restore/persist, provider-scoped model catalogs, effort-tier mode, legacy model picker + `EffortPillSelector` fallback, and resolved `{ provider, model?, reasoningEffort? }` payload values for queue/chat submissions. `queue/EnqueueDialog.tsx` uses these compact controls in its Advanced area for Ask AI, ad hoc autopilot tasks, skill/context-file runs, bulk context-file submissions, and floating-chat launches; it sends `payload.provider` plus optional model/reasoning-effort config while preserving legacy template model overrides. `tasks/GenerateTaskDialog.tsx` uses these compact controls in its configuration area and forwards the resolved values to `/api/workspaces/:id/queue/generate`; `shared/UpdateDocumentDialog.tsx` uses them in the existing configuration area and enqueues custom chat tasks with `payload.provider` plus optional model/reasoning-effort config; `features/work-items/WorkItemExecuteDialog.tsx` renders the same controls through `RunSkillPanel` and forwards them to `/api/workspaces/:id/work-items/:wid/execute`; `features/chat/SkillContextDialog.tsx` uses them for git commit, multi-commit, and branch-range skill runs and sends `payload.provider` plus optional model/reasoning-effort config through the queued chat task; `features/chat/RalphStartPanel.tsx` uses them for confirmed grilling-phase Ralph starts and posts the resolved provider plus optional model/reasoning-effort config to `/api/processes/:id/ralph-start`; `shared/RalphLaunchDialog.tsx` uses the same controls for direct goal-file Ralph launches from Notes and can also accept a caller-owned resolved AI selection for New Chat direct-goal launches before posting to `/api/ralph-launch`. Classify-diff toolbars call `useModalJobAiSelection()` directly and render `features/git/diff/ClassifyDiffAiControls.tsx`, an inline toolbar variant that hides the provider chip when only one provider is selectable and shows either an effort-tier selector or the pickable-model command picker. Diff classification categories are `logic`, `mechanical`, `test`, `simple`, and `generated`; `simple` is labeled "Simple function" and remains low-attention by default. PR and commit popout file rails show compact category badges plus a critical marker, and their selected-file unified diff views render test fidelity comments, logic summaries, and critical usage/call-stack evidence inline near each classified hunk; branch-range popout diff UI stays on the compact classification-free path.

`EffortPillSelector` drives the per-turn `reasoningEffort` override (Low/Medium/High; `null` = no override, falls back to the persisted per-model effort then the SDK default). The chip is structurally a dropdown menu (`AgentSelectorChip` style): trigger button (bars icon + label + chevron) opens a popover listbox with `Auto`/`Low`/`Medium`/`High` entries. The `Auto` entry explicitly clears the override and is also what the currently-selected level toggles to when re-clicked. New chats persist the selection alongside the draft (`useDraftStore` → `Draft.effortOverride`). Follow-ups thread the choice through `useSendMessage → ProcessMessageRequest.reasoningEffort → POST /api/processes/:id/message` and into either `bridge.enqueue` (queued) or `bridge.executeFollowUp` (direct/buffered). The server mirrors the value into `task.config.reasoningEffort` via `queue-shared.validateAndParseTask`, so executors see it from a single canonical location.

When effort-tier mode is enabled, `EffortTierSelector` lists `Very Low`, `Low`, `Medium`, and `High` in that order. Tooltips expose the concrete model and reasoning effort mapped to the selected tier and each configured menu option; empty reasoning effort displays as `Auto`, and unconfigured options remain disabled with an Admin configuration tooltip.

The Admin AI Provider page's `ProviderEffortTiersSection` uses the same tier order (`Very Low`, `Low`, `Medium`, `High`) when editing provider defaults. Rows sourced from hardcoded provider defaults are prefilled and marked with a `Default` badge; saving persists only rows explicitly changed from those defaults, and clearing an override reverts that row to its provider default.

The model-picker chip in both `NewChatArea` and `FollowUpInputArea` mirrors the `AgentSelectorChip` style: icon + label + chevron, no inline `✕` clear. When a `modelOverride` is set, `ModelCommandMenu` renders a `Use default` entry at the top of the dropdown that calls `setModelOverride(null)`; clearing flows through the menu rather than a chip-side button. `NoteChatPanel` reuses the same menu without passing `onClearOverride`, so the clear row only appears in the chat composers.

## Top Bar

Right-hand action cluster: `[Connected pill | NotificationBell | Admin | Theme]`

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
- 3-column scope segmented control: Chats / Automations / All
- Search box
- Selection persists in `localStorage['coc-activity-scope']`

Ralph activity deep-links mount `RalphWorkflowPane`, which shows the iteration timeline alongside a read-only session file browser. The file browser lists the raw files returned by the Ralph session API, selects the first file by default, renders Markdown files through the shared markdown renderer, and formats JSON files as plain indented text. The pane accepts an optional selected filename from the router and reports file selections back to the host so URL hash wiring can deep-link individual session files with `#repos/{workspaceId}/activity/ralph/{sessionId}/{filename}`; bare and trailing-slash session hashes have no pre-selected file and fall back to the first file.

## Memory Route

The top-level `#memory` route is embedded in the Admin shell's Knowledge group and renders `MemoryV2Panel` in the right pane. The panel root owns the stable `#view-memory` id. `MemorySubTab` values are `facts`, `review`, `episodes`, and `settings`; hash links such as `#memory/review` and `#memory/settings` select the matching V2 tab. The legacy memory-config panel is not rendered on the Memory route (the tool-call/explore cache has been removed). Repo settings still use `RepoMemorySection` for repo-scoped bounded memory and raw memory inspection.

`MemoryV2Panel` lists the global scope plus registered workspace scopes, lets users enable/disable the active scope from the Settings tab, exports JSON, and wipes the active scope after confirmation. The tab content is split into `MemoryV2FactsTab`, `MemoryV2ReviewTab`, `MemoryV2EpisodesTab`, and `MemoryV2SettingsTab`.

## Feature Flags

`featureFlags.ts` defines compile-time flags (e.g., `SHOW_WELCOME_TUTORIAL`). Runtime feature flags are exposed through `GET /api/config/runtime` and SPA helpers in `utils/config.ts`; `workItems.sync.enabled` only reports usable sync UI when both it and `workItems.hierarchy.enabled` are true. Features gated by flags are disabled by default. The Git tab's cross-clone cherry-pick UI is gated by `features.gitCrossCloneCherryPick` / `gitCrossCloneCherryPickEnabled`. Chat composer drag/drop session-context attachments are gated by `features.sessionContextAttachments` / `sessionContextAttachmentsEnabled`; when enabled, same-workspace chat rows, process cards, queue/history process rows, and process search result cards become copy-drag sources using a custom session-context MIME payload that contains only workspace ID, process ID, title/preview, status, and last-activity metadata.

## Work Items

`WorkItemsTab` presents hierarchy mode as two top-level tracker tabs: **Local** and **Remote**. The Local tab passes `tracker=local-only` to the tree endpoint and shows local creation actions for local-only Epic trees. The Remote tab calls `workItems.syncStatus(...)` without a provider override, uses the workspace repo remote-derived `remoteProvider` as the authoritative visible provider, and only requests the matching `tracker=github-backed` or `tracker=azure-boards-backed` tree. When one supported provider is detected, the provider chip header shows only that provider (no All chip), the title/subtitle/empty copy and import dialog are provider-specific, and unavailable/auth/setup warnings apply only to the detected provider. Missing, unsupported, or unrecognized workspace remotes show a concise setup message and hide provider chips and import affordances. The Remote import action opens directly in the detected provider mode, then the SPA switches to Remote, selects/highlights the imported root Epic row/card, and keeps the provider filter aligned with the imported provider.

`WorkItemDetail` is an always-editable inline form: title, description, priority, tags, status, parent, success criteria, and plan content remain editable without an Edit-mode toggle. Description and plan use per-field Source/Preview markdown controls. The view tracks a unified dirty draft; Ctrl+S/Cmd+S and the Save button send one `workItems.update` PATCH containing every dirty metadata field plus `plan.content` when changed. There is no instant status save and no standalone plan save from the detail screen. Dirty work-item detail pages show an unsaved-changes indicator, install a `beforeunload` warning, guard the local back breadcrumb, block dirty hash route changes when the user cancels, and intercept hash links before navigation.

The split Local/Remote tracker views do not show the legacy per-item preview/import/export/sync toolbar. Remote-backed Epic roots expose provider-aware context-menu actions (`Sync from GitHub` or `Sync from Azure Boards`) that call the matching per-Epic pull endpoint; Azure sync warnings from remote-wins conflict handling are shown inline in the tree. Adding children under GitHub- or Azure-backed roots still uses the normal create flow, which pushes the new child to the backing provider before storing its mirror metadata. Tree rows and detail headers use provider-specific mirror badges that link to the GitHub issue or Azure Boards work item when the remote URL is available.

## coc-client Integration

The SPA consumes `@plusplusoneplusplus/coc-client` for typed REST transport. Domain clients: admin, processes, queue, schedules, tasks, notes, workflows, wiki, memory, memoryV2, skills, preferences, seen-state, work-items, agentProviders, git. The git domain includes commit/diff/branch helpers, operation history, and patch-transfer export/apply methods used by cross-clone cherry-pick flows. When enabled, the Git commit context menu opens `CrossCloneCherryPickModal`, which lists current-CoC registered workspaces plus online registered remote-CoC workspaces using typed workspace/git-info clients, groups targets by normalized remote URL, recommends same-remote clones, labels each target with its CoC server, requires explicit cross-remote confirmation, and requires explicit dirty-target stash opt-in. Local targets call git patch export/apply directly; remote targets call the initiating server's `servers.cherryPickTransfer` orchestrator.

Local React hooks (`fetchApi`, `useWebSocket`, `seenStateApi`) wrap the client for React state management.

## Pull Requests Tab

The Pull Requests tab is enabled by default through `pullRequests.enabled`. The left queue rail starts with the "Open PR by # or URL" input; successful opens from that input are validated through the PR detail API, recorded through the repo-scoped recent-opened PR API, and shown in a compact "Recently opened" list directly below the input. Recent entries stay hidden when empty or when the rail is collapsed, open through the same overview navigation path, and confirmed 404s remove the stale entry from the list.

Queue rows use server-enriched provider/git diff stats for file count, review-minute estimates, and deterministic risk tiers: low below 200 changed lines, medium from 200 through 800, and high above 800. Missing diff stats render unavailable queue metadata instead of falling back to mock data.

The PR detail overview renders a deterministic review-summary card from the PR description, parsed/provider diff stats, checks, reviewers, and comment threads. Findings are derived from failing checks and unresolved threads, and the former persona-lens grid is not rendered.

PR review suggestions remain behind the separate `pullRequests.suggestions` config flag. The `For You` filter includes a `Generate suggestions`/`Refresh` action that first refreshes review history, then asks the server to rank open PRs. The UI shows inline progress, empty-state guidance, and recovery messages for missing review history or provider errors.
