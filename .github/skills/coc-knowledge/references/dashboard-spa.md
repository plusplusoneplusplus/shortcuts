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
│   ├── notes/          # Notes UI: NoteEditor, sidebar, multi-root dropdown (useNotesRoots)
│   ├── pull-requests/  # PR dashboard: attention groups, BatchCommandPanel
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
   - **New chat (`NewChatArea`)**: `AgentSelectorChip` → divider → `ModePillSelector` → divider → model picker → `EffortPillSelector` → spacer → ctool buttons (`/`, `@`, attach) → divider → send
   - **Follow-up (`FollowUpInputArea`)**: `ModePillSelector` → divider → model picker → `EffortPillSelector` (rendered only when the parent supplies `onEffortChange`) → spacer → ctool buttons → `ComposerMetaStrip` → divider → `QueueFollowUpButton`. Provider isn't switchable on a follow-up (locked to the session), so the row starts at the mode zone.
3. `ComposerMetaStrip`: cwd chip + context-window fuel gauge + provider badge for non-Copilot sessions. In the follow-up toolbar it sits between the tools zone and the send divider so its info reads as status next to send.

Focus indicator propagates mode-colored ring from contenteditable to parent card.

New chats use `AgentSelectorChip` to choose a per-chat provider. The initial selection comes from the workspace's `lastChatProvider` preference when that provider is enabled and available; otherwise it falls back to the configured `defaultProvider` from runtime config, and then to Copilot if the configured default provider cannot be selected. Follow-up inputs show the provider stored on the process metadata so existing chats continue using their original provider.

Modal job-submission dialogs use `shared/ModalJobAiControls.tsx` when they need New Chat-compatible provider/model/reasoning controls. Its `useModalJobAiSelection()` hook centralizes workspace-scoped `lastChatProvider` restore/persist, provider-scoped model catalogs, effort-tier mode, legacy model picker + `EffortPillSelector` fallback, and resolved `{ provider, model?, reasoningEffort? }` payload values for queue/chat submissions. `tasks/GenerateTaskDialog.tsx` uses these compact controls in its configuration area and forwards the resolved values to `/api/workspaces/:id/queue/generate`; `features/work-items/WorkItemExecuteDialog.tsx` renders the same controls through `RunSkillPanel` and forwards them to `/api/workspaces/:id/work-items/:wid/execute`; `features/chat/RalphStartPanel.tsx` uses them for confirmed grilling-phase Ralph starts and posts the resolved provider plus optional model/reasoning-effort config to `/api/processes/:id/ralph-start`; `shared/RalphLaunchDialog.tsx` uses the same controls for direct goal-file Ralph launches and sends the resolved provider plus optional model/reasoning-effort config to `/api/ralph-launch`.

`EffortPillSelector` drives the per-turn `reasoningEffort` override (Low/Medium/High; `null` = no override, falls back to the persisted per-model effort then the SDK default). The chip is structurally a dropdown menu (`AgentSelectorChip` style): trigger button (bars icon + label + chevron) opens a popover listbox with `Auto`/`Low`/`Medium`/`High` entries. The `Auto` entry explicitly clears the override and is also what the currently-selected level toggles to when re-clicked. New chats persist the selection alongside the draft (`useDraftStore` → `Draft.effortOverride`). Follow-ups thread the choice through `useSendMessage → ProcessMessageRequest.reasoningEffort → POST /api/processes/:id/message` and into either `bridge.enqueue` (queued) or `bridge.executeFollowUp` (direct/buffered). The server mirrors the value into `task.config.reasoningEffort` via `queue-shared.validateAndParseTask`, so executors see it from a single canonical location.

When effort-tier mode is enabled, `EffortTierSelector` tooltips expose the concrete model and reasoning effort mapped to the selected tier and each configured menu option; empty reasoning effort displays as `Auto`, and unconfigured options remain disabled with an Admin configuration tooltip.

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

## Memory Route

The top-level `#memory` route is embedded in the Admin shell's Knowledge group and renders `MemoryV2Panel` in the right pane. The panel root owns the stable `#view-memory` id. `MemorySubTab` values are `facts`, `review`, `episodes`, and `settings`; hash links such as `#memory/review` and `#memory/settings` select the matching V2 tab. The legacy memory-config panel is not rendered on the Memory route (the tool-call/explore cache has been removed). Repo settings still use `RepoMemorySection` for repo-scoped bounded memory and raw memory inspection.

`MemoryV2Panel` lists the global scope plus registered workspace scopes, lets users enable/disable the active scope from the Settings tab, exports JSON, and wipes the active scope after confirmation. The tab content is split into `MemoryV2FactsTab`, `MemoryV2ReviewTab`, `MemoryV2EpisodesTab`, and `MemoryV2SettingsTab`.

## Feature Flags

`featureFlags.ts` defines compile-time flags (e.g., `SHOW_WELCOME_TUTORIAL`). Features gated by flags are disabled by default.

## coc-client Integration

The SPA consumes `@plusplusoneplusplus/coc-client` for typed REST transport. Domain clients: admin, processes, queue, schedules, tasks, notes, workflows, wiki, memory, memoryV2, skills, preferences, seen-state, work-items, agentProviders, git.

Local React hooks (`fetchApi`, `useWebSocket`, `seenStateApi`) wrap the client for React state management.

## Pull Request Suggestions

The Pull Requests tab is enabled by default through `pullRequests.enabled`; PR review suggestions remain behind the separate `pullRequests.suggestions` config flag. The `For You` filter includes a `Generate suggestions`/`Refresh` action that first refreshes review history, then asks the server to rank open PRs. The UI shows inline progress, empty-state guidance, and recovery messages for missing review history or provider errors.
