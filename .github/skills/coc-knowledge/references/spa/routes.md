# Dashboard SPA — Routes

## Onboarding

- `WelcomeTour`: 5-step full-screen modal (Welcome/Modes/Queue/Multi-repo/Servers)
- `FirstStepsCard`: Guided checklist replacing empty repos state
- `FeatureTip`: Contextual dismissible tips
- State in `GlobalPreferences` (hasSeenWelcome, onboardingProgress, dismissedTips)

## My Work — Today tab

`react/features/my-work/`, prepended to My Work as the landing sub-tab when the
default-off `myWork.todayView` flag is on. Flag off, the tab shape is unchanged.

- **Data** — `useMyWorkTasks(active)` over `/api/my-work/tasks*` (`getTasks`,
  `patchTask`, `addTask`, `archiveTasks`) plus `repos.syncMyWork` for the empty
  state's Sync. `Action Items.md` and `Follow Ups.md` stay the source of truth.
  Writes are optimistic → PATCH → refetch (ids are content-derived, so any write
  reflows them); a failure rolls back and shows an inline banner over a list that
  never blanks. A `busy` guard keeps one mutation in flight at a time. The fetch
  re-runs each time `active` goes false → true, so a background sync or a
  scheduled write is picked up without a page reload.
- **Bucketing** — `taskBuckets.ts` is pure, React-free view logic: three urgency
  buckets (Needs you today / Waiting on others / Everything else), age from the
  `## Synced <date>` heading, `@due(…)` tone, the header triage chip
  (`2 overdue · 5 due today · 3 waiting >7d`, zero segments dropped), snooze
  targets, the person roll-up summary, and the nudge draft.
- **Rows** — one `TaskRow` for every bucket: checkbox, due chip, `#tag` pills,
  age badge, source link, pencil and ⏰. Selection, which editor is open and
  which due menu is open are held by `MyWorkTodayTab`, not by each row, because
  the keyboard layer drives all three from outside.
- **Keyboard triage** — `useTaskKeyboardTriage`: `j`/`k` move, `x` toggles, `e`
  edits, `d` opens the due menu, `s` defers a day, `/` focuses the filter,
  Escape closes/deselects. Every key calls the handler its click calls. One
  document listener, all changing inputs read through a ref so it attaches once;
  suppressed on any text-entry target, when the pane is hidden
  (`offsetParent === null` — it is a mounted keep-alive tab), when inactive, on
  chords, and inside a dialog or the detail pane. `j`/`k` step only rows that are
  actually on screen, so section expansion state lives in the tab too.
- **Waiting on others** — collapsed per person to `Priya · 3 items · oldest 9d`
  with a **Nudge** that builds a draft from the items, their ages and their
  `sourceUrl`s and opens it in a floating chat (`QueueContext` `OPEN_DIALOG`,
  mode `ask`); it falls back to the clipboard outside a `QueueProvider`. No send
  mechanism of its own.
- **Placeholders** — `TodayPlaceholders.tsx`: skeleton rows on the first fetch
  only, an empty state leading with Sync and the two notes links (manual add
  secondary), and a distinct no-matches state when a filter is on.
- **What changed strip** — `WhatChangedStrip.tsx`, pinned above the buckets:
  up to five entries from `GET /api/my-work/timeline` (the Work Radar note
  `notes/Work/timeline.md`), each showing time · thread label · one line, the
  label linking to its thread note. `View all <n>` appears only when the note
  holds more than is shown. Dismissible for the browser session
  (`sessionStorage`, key `myWork.whatChanged.dismissed`). It renders `null` —
  no placeholder, zero vertical pixels — when the note is absent, empty, junk,
  dismissed, or the fetch failed; a failure is `console.warn`ed and swallowed so
  the task list below always comes up. Refetches per activation like the tasks.
  Nothing writes that note yet, so empty is the normal state.

## Activity Tab

- Action bar: New chat + refresh + ALL/AP split pause pill
- Scope segmented control: Chats / Scheduled (when `cron.enabled`) / Automations / All
- Search box: hidden by default, gated behind `searchVisible`. Ctrl+F / ⌘F
  routes by which pane owns keyboard focus (never mouse hover) through the shared
  `useScopedFindShortcut(containerRef, onTrigger, opts)` hook
  (`react/hooks/useScopedFindShortcut.ts`). Every search-owning panel (chat list,
  git commit list, tasks, work items) uses it so none can fight over
  `preventDefault` or swallow native find. The hook: skips when its container is
  hidden (`offsetParent === null`, so a mounted-but-hidden keep-alive tab never
  intercepts); yields when focus is in the detail pane (`data-pane="detail"`, via
  the exported `isWithinDetailPane`) so native find-in-page (Electron overlay /
  browser find) takes over — it only opens when `defaultPrevented` stays false;
  handles when focus is inside the container; yields when focus is inside any
  other region that is neither this container nor `document.body`/
  `documentElement` (e.g. the workspace right dock's terminal/explorer — that
  region owns its own Ctrl+F story, so native find wins); and, when focus is on
  `document.body`/nothing, handles only if `claimsBodyFocus` is set (default true;
  the git list passes `!isSplitWorkspace` so the chat list wins body focus in the
  split-workspace layout). Panels are tagged with `data-find-scope` while mounted
  so a sibling never steals Ctrl+F from a different focused panel. ✕ clears the
  query but leaves the box open; Escape clears the query and hides the box; a
  `workspaceId` change also resets `searchVisible`
- Selection persists in `localStorage['coc-activity-scope']`
- `ChatListPane` keeps the action/scope/search controls in a sticky
  `chat-list-fixed-header` block while the list rows scroll underneath. The
  header full-bleeds to the scroll container edges (`-mx-2 md:-mx-4`) and the
  `chat-list-pane` scroll container carries no top padding (`px-2 pb-2 md:px-4
  md:pb-4`, not `p-2 md:p-4`) so the `sticky top-0` header sits flush against the
  top — top padding there would show as a gap above the panel, which a negative
  header margin cannot cancel because sticky clamps to the padding edge.
- The desktop activity split (`RepoChatTab`) can collapse the left chat-list
  panel to a thin rail; collapsed state persists in
  `localStorage['activity-list-collapsed-{workspaceId}']`, the left-panel width
  persists in `localStorage['activity-left-panel-width-{workspaceId}']`, and the
  collapse affordance sits on the list/detail resize handle.
- The Notes tree sidebar (`NotesView` → `NotesSidebar`, shared by repo notes,
  My Life, and My Work) collapses the whole left column to a 36px rail on
  desktop/tablet only (mobile keeps its `ResponsiveSidebar` drawer). A `«`
  chevron hover-revealed on the sidebar resize handle collapses it; the rail's
  `»` button expands it. Collapsed state persists per workspace under
  `localStorage['coc-notes-sidebar-collapsed-{workspaceId}']` (`'1'`/`'0'`,
  written only on an explicit toggle) via `useNotesSidebarCollapsed`, so repo /
  My Life / My Work each remember their own state. The tree stays mounted-hidden
  (keep-alive) inside the `ResponsiveSidebar`, and while collapsed the view
  publishes the rail width (`NOTES_SIDEBAR_RAIL_WIDTH`) to
  `--workspace-left-col-width` so the docked status bar stays flush. Hovering the
  rail on a fine-pointer device floats the sidebar back as an absolute `z-30`
  slide-in overlay (`useHoverPeek`, 400ms open / 250ms close grace, Escape +
  outside-click dismiss); the peek is a transient layer that never rewrites the
  persisted collapsed flag. Mirrors the `SplitWorkspacePanel` whole-left-column
  collapse UX with a lighter local `useState` store (no Cmd/Ctrl+B, no cross-tree
  sync — every consumer lives in the single `NotesView` subtree). Both toggle
  controls carry `aria-expanded` reflecting the sidebar state, and the peek slide
  honours `prefers-reduced-motion` via `motion-reduce:transition-none` (the panel
  still floats out, it just appears without the transition).
- The `SplitWorkspacePanel` chat/git divider is an explicit horizontal
  `role="separator"` resize handle with an expanded hit target; it persists the
  chat pane height per workspace under
  `split-workspace:{workspaceId}:chat-height`.
- Each `SplitWorkspacePanel` left half (chat top, git bottom) sits under a
  compact 22px VS Code-style section header. Clicking a header collapses that
  half to just its bar; the still-open half grows to fill (the chat/git divider
  renders only when both halves are open). Collapsed bodies stay mounted but
  `hidden` so scroll/selection survive. Collapsed state persists per workspace
  under `split-workspace:{workspaceId}:chat-collapsed` and
  `split-workspace:{workspaceId}:git-collapsed`, written only on an explicit
  user toggle (never on mount or workspace switch). The optional docked `footer`
  (the remote-first shell's status cluster) is pinned to the bottom-left of the
  column; when both halves are collapsed neither carries `flex-1`, so a `flex-1`
  spacer is rendered above the footer to keep it at the bottom instead of riding
  up under the headers.
- Owned-sidebar workspace views host the remote-first status cluster inside
  their own sidebar/footer chrome instead of relying on the app-wide
  `GlobalStatusDock`: `NotesView` passes `DockedStatusFooter` into
  `NotesSidebar`, regular repo and My Life Settings pass `dockStatusFooter` to
  `RepoSettingsTab` so the cluster sits inside the 210px settings nav, My
  Work keeps its body-level `DockedStatusFooter` shared across all sub-tabs,
  and `PullRequestsTab` docks a `DockedStatusFooter` at the bottom of its PR
  queue sidebar (hidden while the queue is collapsed to the 44px rail;
  `GlobalStatusDock` stands down on the `pull-requests` sub-tab).
- The git half uses a dense skin to save vertical space. `SplitWorkspacePanel`
  exposes a `gitHeaderExtra` slot on the git section header (rendered right of
  the chevron+label toggle; its clicks don't toggle; stays visible while
  collapsed, with the collapsed half switching to `overflow-visible` so
  dropdowns aren't clipped). `RepoDetail` fills the slot with a portal host div
  (`splitGitHeaderNode`, mirroring the `splitDetailNode` pattern) and passes it
  to `RepoGitTab` as `headerToolbarContainer`; `RepoGitTab` portals a
  `compact` `GitPanelHeader` (slim pills/buttons, timestamp without " ago")
  into it instead of rendering the 38px toolbar strip. The hoisted portal is a
  sibling OUTSIDE the git list's `onClickCapture` wrapper — portaled React
  events bubble through the React tree, so nesting it would make toolbar clicks
  (Pull/refresh) mark git last-clicked and steal the shared detail pane from
  the chat. In split layout the
  search bar also slims (placeholder `Search commits…`, full hint kept in
  `aria-label`), the `git-repo-sections` grid tightens, and `BranchChanges` /
  `WorkingTree` render their `compact` variant: flat left-accent rows instead
  of rounded cards, `Range`/`Local` tags, shortened summaries and `{n}f`
  file-count badges with the full text preserved in `title` tooltips.
- For Each parent run group rows render in Activity Chats and All, but not in
  Activity Automations or Scheduled; cron-linked child chats can still appear in
  Scheduled independently of the hidden parent group row.

Ralph activity deep-links mount `RalphWorkflowPane`, which shows a unified task timeline alongside a read-only session file browser. The timeline interleaves iteration nodes (the union of `record.iterations` and parsed `progress.md` sections) with final-check nodes built from `record.finalChecks`: each `RalphFinalCheckRecord` renders a distinct `RalphFinalCheckNode` labeled `Final check #<checkIndex>` immediately after the iteration it validates (`sourceIteration`), and therefore before the first iteration of any gap-fix loop it starts. Final-check nodes show status (`queued`/`running`/`completed`/`failed`) and a gap summary (`No gaps`, `1 gap`, `<N> gaps`, or an in-progress/unknown copy); a node with a recorded `processId` is clickable and opens that final-check chat process, while one without is rendered disabled. Gap-fix loops (a loop whose index matches a `finalCheck.gapLoopStarted`/`gapLoopIndex`) render a `Gap fix loop <N>` divider that is not gated behind `RALPH_MULTI_LOOP` since it follows final-check visibility; generic `Loop <N>` dividers keep their existing `RALPH_MULTI_LOOP`-gated behavior. Final-check visibility is display/navigation only — it reads already-persisted session data and adds no new persistence. The file browser lists the raw files returned by the Ralph session API, selects the first file by default, renders Markdown files through the shared markdown renderer, and formats JSON files as plain indented text. For stuck executing sessions with no running iteration, the pane's Resume confirmation renders `ModalJobAiControls`; unchanged recovered `resumeDefaults` are omitted so the resume route preserves prior AI settings, while changed selections are serialized to `workspaces.resumeRalphSession()`. The completed-session Continue-loop confirmation renders the same controls and serializes the extension to `workspaces.continueRalphSession()` (a `RalphContinueRequest` carrying `additionalIterations` plus the optional AI overrides) with the identical omit-when-unchanged behavior. The pane accepts an optional selected filename from the router and reports file selections back to the host so URL hash wiring can deep-link individual session files with `#repos/{workspaceId}/activity/ralph/{sessionId}/{filename}`; bare and trailing-slash session hashes have no pre-selected file and fall back to the first file. For a completed session (any terminal reason) the header meta row shows a `Submit PR` button (`ralph-workflow-submit-pr`): a single click with no dialog calls `workspaces.submitRalphPr` (the container's `onSubmitPr` refreshes the view afterwards); it is disabled while any `record.submits` entry is `queued`/`running` or while the request is in flight, and a rejected request renders an inline error. Each `RalphSubmitRecord` renders a `RalphSubmitNode` (`PR submit #<submitIndex>`, `ralph-submit-node-<N>`) appended after all iteration and final-check items in `submitIndex` order; a completed node links its `prUrl` in a new tab, a failed node shows the `error` text, and a node with a recorded `processId` is clickable to open the submit chat via the same host process-id callback as final-check nodes. `useRalphSessionView` continues its 5s poll on a complete session while a submit is `queued`/`running` so submit-node status advances live.

## Dreams Route

The repo-scoped Dreams tab (`features/dreams/DreamsPanel.tsx`) is a dedicated review surface separate from Work Items. It is included in repo tab strips only when the global `dreams.enabled` feature flag is on, then requires the workspace `preferences.dreams.enabled` opt-in before calling Dreams routes. Once enabled, it lists visible cards by default, supports status filters for hidden lifecycle history, exposes a manual **Run dream now** action, shows run summaries/no-new-dreams states, links source process turn ranges back to the Activity conversation route, and offers card lifecycle actions: approve, dismiss, record conversion, and supersede. Approved cards also expose an explicit **Take next action** dialog: skill/prompt cards can queue an Ask-mode skill-hardening task, user-workflow cards can save to Notes or Memory V2, and product cards can create a new Work Item or append the recommendation to an existing Work Item. Each next action runs only after the dialog submit and then records the resulting artifact as a dream conversion.

## CLI Sessions Tab

The repo-scoped `CLI Sessions` tab (`features/native-copilot-sessions/NativeCopilotSessionsPanel.tsx`, exported as `NativeCliSessionsPanel`) is a read-only provider-switched view of native Copilot, Codex, and Claude Code CLI sessions for the active workspace. It is gated by `features.nativeCliSessions` / `nativeCliSessionsEnabled` (disabled by default; `useNativeCliSessionsEnabled()` tracks live runtime-config updates), reads through `coc-client`'s `nativeCliSessions` domain, and registers as the `cli-sessions` repo sub-tab while accepting the legacy hidden `copilot-sessions` key for old links. The panel renders a two-pane layout on wide screens (searchable session list left at a clamped ~42% width, selected-session detail right) and stacked single-pane navigation on narrow screens. A provider switcher defaults to Copilot for legacy compatibility and renders one tab per `available` descriptor in the shared `AVAILABLE_NATIVE_CLI_PROVIDER_DESCRIPTORS` registry (currently Copilot, Codex, Claude) — a provider staged as `planned` (`opencode`) gets no tab, and `parseNativeCliSessionDeepLink` rejects its hash, so the UI can only offer providers the server registers. Tab labels, store hints, and the external-session label all read from the descriptor. The header uses the shared `ProviderBadge` palette (Copilot green, Codex indigo, Claude coral), a provider-specific native-session label, and a read-only badge whose tooltip shows the selected provider's local store path.

The list supports text query, session-ID, branch, date-range filters, and pagination. Each list response carries an explicit `searchStrategy`: Copilot delegates to the native SQLite FTS provider and reports `native-index`, while Codex and Claude substring-scan JSONL transcripts and report `on-demand-scan` (the panel then explains there is no native search index); a provider reporting `unavailable` shows a distinct notice that it cannot search transcript text. The panel falls back to the older `searchIndexAvailable` signal when a response omits `searchStrategy`. Each list row shows a short session-ID chip, updated timestamp, two-line summary preview, repository/cwd, optional match snippets, and right-aligned turn-count and branch pills; the selected row gets a left accent bar. The selected session is deep-linked through the URL hash (`#repos/{wsId}/cli-sessions/{provider}/{sessionId}`, parsed/built via `parseNativeCliSessionDeepLink`/`buildNativeCliSessionHash`) so selections survive refresh/back-forward and are shareable; `#repos/{wsId}/copilot-sessions/{sessionId}` is parsed as a legacy Copilot provider link.

The list route deduplicates against the Activity tab: native sessions whose provider session ID matches a CoC process `sdk_session_id` for the workspace (resolved via `ProcessStore.getSdkSessionIds(workspaceId)`) are hidden, and the response `deduplicatedCount` drives a `native-sessions-deduplicated` hint reading `N sessions hidden — already tracked in CoC Activity`. Automated Copilot background-job sessions whose first turn matches `BACKGROUND_JOB_PROMPT_PREFIXES` are hidden by default and counted in `backgroundJobCount`, which drives a `native-sessions-background-hidden` hint. The panel renders distinct disabled/unavailable (`store-missing`/`store-invalid`)/loading/empty/error states per provider.

The detail pane reconstructs the selected session as a rich CoC chat transcript rather than a plain text dump. The unified detail endpoint (`GET /api/workspaces/:id/native-cli-sessions/:sessionId?provider=...`) returns provider-tagged metadata, `storePath`, `searchIndexAvailable`, `searchStrategy`, and an always-present `conversation: ReconstructedConversationTurn[]`. Copilot reconstruction prefers the native `session-state/<id>/events.jsonl` log and falls back to flat `session-store.db` turns; Codex and Claude reconstruction comes from defensive JSONL parsers that skip malformed or unknown records and preserve user/assistant messages, tool start/complete/failed timeline items, thinking/reasoning, data-URL images, and model metadata when present. Codex `event_msg` user-message image metadata is merged into the matching user turn; `local_images` paths are shown as read-only markdown references because the existing chat image gallery only renders data URLs. The SPA maps each turn to `ClientConversationTurn` via `nativeConversationTurns.ts` (`toClientConversationTurns`, folding assistant `thinking` into a leading markdown blockquote since `ClientConversationTurn` has no reasoning field) and renders one read-only `ConversationTurnBubble` per turn under a `native-session-conversation` card (`Conversation (N)`) with the selected provider passed through for avatar coloring. The whole feature is strictly read-only: no input box, streaming, resume, follow-up, archive, pin, delete, retry, or turn actions are exposed; stored HTML/scripts never execute.

## Memory Route

The top-level `#memory` route is embedded in the Admin shell's Knowledge group and renders `MemoryV2Panel` in the right pane. The panel root owns the stable `#view-memory` id. `MemorySubTab` values are `facts`, `review`, `episodes`, and `settings`; hash links such as `#memory/review` and `#memory/settings` select the matching V2 tab. The legacy memory-config panel is not rendered on the Memory route (the tool-call/explore cache has been removed). Repo settings still use `RepoMemorySection` for repo-scoped bounded memory and raw memory inspection.

`MemoryV2Panel` lists the global scope plus registered workspace scopes, lets users enable/disable the active scope from the Settings tab, exports JSON, and wipes the active scope after confirmation. The tab content is split into `MemoryV2FactsTab`, `MemoryV2ReviewTab`, `MemoryV2EpisodesTab`, and `MemoryV2SettingsTab`.
