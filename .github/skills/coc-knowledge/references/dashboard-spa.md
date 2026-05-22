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
│   ├── notes/          # Notes UI: NoteEditor, sidebar, multi-root dropdown (useNotesRoots)
│   ├── pull-requests/  # PR dashboard: attention groups, BatchCommandPanel
│   └── terminal/       # Terminal UI: TerminalView, pin/unpin
├── processes/          # Process detail, DAG visualization
├── queue/              # Queue management (EnqueueDialog, QueueView)
├── repos/              # Repository views, file explorer, Monaco editor
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
- **Assistant turns:** Left-aligned with `C` avatar (green), borderless flowing content
- **User turns:** Right-aligned with `Y` avatar (blue), soft-gray rounded bubbles
- **Error turns:** Red error-strip aside with retry button
- **Script output:** Dark terminal window with PASS/FAIL highlighting

`QueuedFollowUps` renders pending messages as compact dashed-border cards with cancel buttons.

## Tool Call Rendering

Inside `WhisperCollapsedGroup`, tool calls render as compact "whisper-row" variant:
- Single flat row: kind pill + truncated summary + duration + chevron
- Color-coded pills: Read/blue, Grep/Glob/green, Edit/Write/amber, Shell/PS/SQL/purple

## Input Area

Stacked layout with:
1. `RichTextInput` (contenteditable)
2. Toolbar: ModePillSelector → model picker → ctool buttons → QueueFollowUpButton
3. `ComposerMetaStrip`: cwd chip + context-window fuel gauge

Focus indicator propagates mode-colored ring from contenteditable to parent card.

## Top Bar

Right-hand action cluster: `[Connected pill | NotificationBell | Admin | Theme]`

The legacy "Tools" popover has been migrated to the Admin page's left
sidebar. The Admin sidebar exposes a "Tools" nav group containing Skills,
Logs, Usage, Models, and Servers (Servers only when `isServersEnabled()` is
true). Each row dispatches `SET_ACTIVE_TAB` and updates `location.hash` to
the corresponding top-level route (`#skills`, `#logs`, `#stats`, `#models`,
`#servers`). Row ids match the legacy dropdown (`skills-toggle`,
`logs-toggle`, `stats-toggle`, `models-toggle`, `servers-toggle`).

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

## Feature Flags

`featureFlags.ts` defines compile-time flags (e.g., `SHOW_WELCOME_TUTORIAL`). Features gated by flags are disabled by default.

## coc-client Integration

The SPA consumes `@plusplusoneplusplus/coc-client` for typed REST transport. Domain clients: admin, processes, queue, schedules, tasks, notes, workflows, wiki, memory, skills, preferences, seen-state, work-items, models, git.

Local React hooks (`fetchApi`, `useWebSocket`, `seenStateApi`) wrap the client for React state management.

## Pull Request Suggestions

The Pull Requests tab exposes PR review suggestions behind the `pullRequests.suggestions` config flag. The `For You` filter includes a `Generate suggestions`/`Refresh` action that first refreshes review history, then asks the server to rank open PRs. The UI shows inline progress, empty-state guidance, and recovery messages for missing review history or provider errors.
