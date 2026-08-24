# Dashboard SPA — Routes

Onboarding, My Work Today, the Activity tab and its panel chrome, Dreams, CLI
Sessions, and the Memory route.

## Onboarding

- `WelcomeTour` — 5-step full-screen modal (Welcome / Modes / Queue / Multi-repo /
  Servers).
- `FirstStepsCard` — guided checklist that takes the place of the empty repos state.
- `FeatureTip` — contextual dismissible tips.

State lives in `GlobalPreferences`: `hasSeenWelcome`, `onboardingProgress`,
`dismissedTips`.

## My Work — Today tab

`react/features/my-work/`, prepended to My Work as the landing sub-tab when the
default-off `myWork.todayView` flag is on. With the flag off the tab shape is
unchanged.

### Data

`useMyWorkTasks(active)` covers `/api/my-work/tasks*` (`getTasks`, `patchTask`,
`addTask`, `archiveTasks`) plus `repos.syncMyWork` for the empty state's Sync.
`Action Items.md` and `Follow Ups.md` remain the source of truth.

Writes are optimistic → PATCH → refetch, because ids are content-derived and any write
reflows them. A failure rolls back and shows an inline banner over a list that never
blanks, and a `busy` guard keeps one mutation in flight at a time. The fetch re-runs
each time `active` goes false → true, so a background sync or scheduled write is picked
up without a page reload.

### Bucketing

`taskBuckets.ts` is pure, React-free view logic: three urgency buckets (Needs you today
/ Waiting on others / Everything else), age from the `## Synced <date>` heading,
`@due(…)` tone, the header triage chip (`2 overdue · 5 due today · 3 waiting >7d`, with
zero segments dropped), snooze targets, the person roll-up summary, and the nudge
draft.

### Rows and keyboard triage

One `TaskRow` serves every bucket: checkbox, due chip, `#tag` pills, age badge, source
link, pencil, and ⏰. **Selection, which editor is open, and which due menu is open are
held by `MyWorkTodayTab`, not by each row**, because the keyboard layer drives all
three from outside.

`useTaskKeyboardTriage` binds `j`/`k` to move, `x` to toggle, `e` to edit, `d` to open
the due menu, `s` to defer a day, `/` to focus the filter, and Escape to close or
deselect. Every key calls the same handler its click calls. It installs **one** document
listener, reading all changing inputs through a ref so it attaches once, and suppresses
itself on any text-entry target, when the pane is hidden (`offsetParent === null` — it
is a mounted keep-alive tab), when inactive, on chords, and inside a dialog or the
detail pane. `j`/`k` step only rows actually on screen, so section expansion state lives
in the tab too.

### Waiting on others

Collapsed per person to `Priya · 3 items · oldest 9d` with a **Nudge** action that
builds a draft from the items, their ages, and their `sourceUrl`s and opens it in a
floating chat (`QueueContext` `OPEN_DIALOG`, mode `ask`), falling back to the clipboard
outside a `QueueProvider`. It has no send mechanism of its own.

### Placeholders and the What-changed strip

`TodayPlaceholders.tsx` renders skeleton rows on the first fetch only, an empty state
leading with Sync and the two notes links (manual add secondary), and a distinct
no-matches state when a filter is on.

`WhatChangedStrip.tsx` pins above the buckets with up to five entries from
`GET /api/my-work/timeline` (the Work Radar note `notes/Work/timeline.md`), each showing
time · thread label · one line, the label linking to its thread note. `View all <n>`
appears only when the note holds more than is shown. It is dismissible for the browser
session (`sessionStorage`, key `myWork.whatChanged.dismissed`).

It renders `null` — no placeholder, zero vertical pixels — when the note is absent,
empty, junk, dismissed, or the fetch failed; a failure is `console.warn`ed and
swallowed so the task list below always comes up. It refetches per activation like the
tasks. Nothing writes that note yet, so empty is the normal state.

## Activity tab

The action bar carries New chat, refresh, and the ALL/AP split pause pill. A scope
segmented control selects Chats / Scheduled (when `cron.enabled`) / Automations / All,
persisted in `localStorage['coc-activity-scope']`.

For Each parent run group rows render in Chats and All, but not in Automations or
Scheduled; cron-linked child chats can still appear in Scheduled independently of the
hidden parent row.

### Scoped Ctrl+F

The search box is hidden by default behind `searchVisible`. Ctrl+F / ⌘F routes by which
pane owns **keyboard focus** — never mouse hover — through
`useScopedFindShortcut(containerRef, onTrigger, opts)`
(`react/hooks/useScopedFindShortcut.ts`). Every search-owning panel (chat list, git
commit list, tasks, work items) uses it, so none can fight over `preventDefault` or
swallow native find. Panels are tagged with `data-find-scope` while mounted so a sibling
never steals Ctrl+F from a different focused panel.

The hook's decision order:

1. **Skip** when its container is hidden (`offsetParent === null`), so a
   mounted-but-hidden keep-alive tab never intercepts.
2. **Yield** when focus is in the detail pane (`data-pane="detail"`, via the exported
   `isWithinDetailPane`) so native find-in-page takes over — it only opens when
   `defaultPrevented` stays false.
3. **Handle** when focus is inside the container.
4. **Yield** when focus is in any other region that is neither this container nor
   `document.body`/`documentElement` — for example the workspace right dock's
   terminal/explorer, which owns its own Ctrl+F story.
5. On `document.body` or nothing, **handle only if `claimsBodyFocus`** (default true;
   the git list passes `!isSplitWorkspace` so the chat list wins body focus in the
   split-workspace layout).

✕ clears the query but leaves the box open; Escape clears the query and hides the box;
a `workspaceId` change also resets `searchVisible`.

### Chat list chrome

`ChatListPane` keeps the action, scope, and search controls in a sticky
`chat-list-fixed-header` block while rows scroll underneath. The header full-bleeds to
the scroll container edges (`-mx-2 md:-mx-4`) and the `chat-list-pane` scroll container
carries **no top padding** (`px-2 pb-2 md:px-4 md:pb-4`, not `p-2 md:p-4`) so the
`sticky top-0` header sits flush — top padding there shows as a gap above the panel,
which a negative header margin cannot cancel because sticky clamps to the padding edge.

The desktop activity split (`RepoChatTab`) can collapse the left chat-list panel to a
thin rail. Collapsed state persists in
`localStorage['activity-list-collapsed-{workspaceId}']`, left-panel width in
`localStorage['activity-left-panel-width-{workspaceId}']`, and the collapse affordance
sits on the list/detail resize handle.

### Notes sidebar collapse

The Notes tree sidebar (`NotesView` → `NotesSidebar`, shared by repo notes, My Life, and
My Work) collapses the whole left column to a 36px rail on desktop and tablet; mobile
keeps its `ResponsiveSidebar` drawer. Collapsed state persists per workspace under
`localStorage['coc-notes-sidebar-collapsed-{workspaceId}']` (`'1'`/`'0'`, written only
on an explicit toggle) via `useNotesSidebarCollapsed`, so repo, My Life, and My Work
each remember their own.

The tree stays mounted-hidden (keep-alive) inside the `ResponsiveSidebar`. While
collapsed the view publishes the rail width (`NOTES_SIDEBAR_RAIL_WIDTH`) to
`--workspace-left-col-width` so the docked status bar stays flush. Hovering the rail on
a fine-pointer device floats the sidebar back as an absolute `z-30` slide-in overlay
(`useHoverPeek`, 400ms open / 250ms close grace, Escape and outside-click dismiss); the
peek is a transient layer that never rewrites the persisted flag.

This mirrors the `SplitWorkspacePanel` whole-left-column collapse UX with a lighter
local `useState` store — no Cmd/Ctrl+B and no cross-tree sync, because every consumer
lives in the single `NotesView` subtree. Both toggle controls carry `aria-expanded`, and
the peek slide honours `prefers-reduced-motion` via `motion-reduce:transition-none`
(the panel still floats out, just without the transition).

### SplitWorkspacePanel

The chat/git divider is an explicit horizontal `role="separator"` resize handle with an
expanded hit target, persisting the chat pane height per workspace under
`split-workspace:{workspaceId}:chat-height`.

Each left half (chat top, git bottom) sits under a compact 22px VS Code-style section
header. Clicking a header collapses that half to just its bar and the still-open half
grows to fill; the divider renders only when both halves are open. Collapsed bodies stay
mounted but `hidden` so scroll and selection survive. Collapsed state persists under
`split-workspace:{workspaceId}:chat-collapsed` and
`split-workspace:{workspaceId}:git-collapsed`, written only on an explicit user toggle —
never on mount or workspace switch.

The optional docked `footer` (the remote-first shell's status cluster) pins to the
bottom-left of the column. When both halves are collapsed neither carries `flex-1`, so a
`flex-1` spacer renders above the footer to keep it at the bottom instead of riding up
under the headers.

### The git half's dense skin

`SplitWorkspacePanel` exposes a `gitHeaderExtra` slot on the git section header,
rendered right of the chevron+label toggle. Its clicks do not toggle, and it stays
visible while collapsed, with the collapsed half switching to `overflow-visible` so
dropdowns are not clipped.

`RepoDetail` fills the slot with a portal host div (`splitGitHeaderNode`, mirroring the
`splitDetailNode` pattern) and passes it to `RepoGitTab` as `headerToolbarContainer`;
`RepoGitTab` portals a `compact` `GitPanelHeader` (slim pills and buttons, timestamp
without " ago") into it instead of rendering the 38px toolbar strip.

**The hoisted portal is a sibling OUTSIDE the git list's `onClickCapture` wrapper.**
Portaled React events bubble through the React tree, so nesting it would make toolbar
clicks (Pull, refresh) mark git last-clicked and steal the shared detail pane from the
chat.

In split layout the search bar also slims (placeholder `Search commits…`, full hint kept
in `aria-label`), the `git-repo-sections` grid tightens, and `BranchChanges` /
`WorkingTree` render their `compact` variant: flat left-accent rows instead of rounded
cards, `Range`/`Local` tags, shortened summaries, and `{n}f` file-count badges with the
full text preserved in `title` tooltips.

### Owned-sidebar status docks

Workspace views that own their sidebar host the remote-first status cluster in their own
chrome instead of relying on the app-wide `GlobalStatusDock`: `NotesView` passes
`DockedStatusFooter` into `NotesSidebar`; regular repo and My Life Settings pass
`dockStatusFooter` to `RepoSettingsTab` so the cluster sits inside the 210px settings
nav; My Work keeps a body-level `DockedStatusFooter` shared across all sub-tabs; and
`PullRequestsTab` docks one at the bottom of its PR queue sidebar, hidden while the
queue is collapsed to the 44px rail, with `GlobalStatusDock` standing down on the
`pull-requests` sub-tab.

## Ralph workflow pane

Ralph activity deep-links mount `RalphWorkflowPane`: a unified task timeline beside a
read-only session file browser.

### Timeline

The timeline interleaves iteration nodes — the union of `record.iterations` and parsed
`progress.md` sections — with final-check nodes built from `record.finalChecks`. Each
`RalphFinalCheckRecord` renders a `RalphFinalCheckNode` labeled `Final check
#<checkIndex>` immediately after the iteration it validates (`sourceIteration`), and
therefore before the first iteration of any gap-fix loop it starts.

Final-check nodes show status (`queued`/`running`/`completed`/`failed`) and a gap
summary (`No gaps`, `1 gap`, `<N> gaps`, or in-progress/unknown copy). A node with a
recorded `processId` is clickable and opens that chat process; one without renders
disabled.

A gap-fix loop — a loop whose index matches a `finalCheck.gapLoopStarted`/`gapLoopIndex`
— renders a `Gap fix loop <N>` divider that is **not** gated behind `RALPH_MULTI_LOOP`,
since it follows final-check visibility. Generic `Loop <N>` dividers stay
`RALPH_MULTI_LOOP`-gated. Final-check visibility is display and navigation only: it
reads already-persisted session data and adds no new persistence.

### Submits

For a completed session (any terminal reason) the header meta row shows a `Submit PR`
button (`ralph-workflow-submit-pr`). One click, no dialog, calls
`workspaces.submitRalphPr`; the container's `onSubmitPr` refreshes the view afterwards.
It is disabled while any `record.submits` entry is `queued`/`running` or while the
request is in flight, and a rejected request renders an inline error.

Each `RalphSubmitRecord` renders a `RalphSubmitNode` (`PR submit #<submitIndex>`,
`ralph-submit-node-<N>`) appended after all iteration and final-check items in
`submitIndex` order. A completed node links its `prUrl` in a new tab, a failed node
shows the `error` text, and a node with a `processId` opens the submit chat through the
same host callback as final-check nodes. `useRalphSessionView` continues its 5s poll on
a complete session while a submit is `queued`/`running`, so submit-node status advances
live.

### File browser and resume

The file browser lists the raw files returned by the Ralph session API, selects the
first by default, renders Markdown through the shared markdown renderer, and formats
JSON as plain indented text. The pane accepts an optional selected filename from the
router and reports selections back to the host, so URL hash wiring can deep-link
individual session files with
`#repos/{workspaceId}/activity/ralph/{sessionId}/{filename}`; bare and trailing-slash
session hashes have no pre-selected file and fall back to the first.

For a stuck executing session with no running iteration, the Resume confirmation renders
`ModalJobAiControls`. Unchanged recovered `resumeDefaults` are **omitted** so the resume
route preserves prior AI settings, while changed selections serialize to
`workspaces.resumeRalphSession()`. The completed-session Continue-loop confirmation
renders the same controls and serializes to `workspaces.continueRalphSession()` — a
`RalphContinueRequest` carrying `additionalIterations` plus optional AI overrides — with
the identical omit-when-unchanged behavior.

## Dreams route

The repo-scoped Dreams tab (`features/dreams/DreamsPanel.tsx`) is a review surface
separate from Work Items. It appears in repo tab strips only when the global
`dreams.enabled` flag is on, then requires the workspace `preferences.dreams.enabled`
opt-in before calling Dreams routes.

Once enabled it lists visible cards by default, supports status filters for hidden
lifecycle history, exposes a manual **Run dream now**, shows run summaries and
no-new-dreams states, links source process turn ranges back to the Activity conversation
route, and offers card lifecycle actions: approve, dismiss, record conversion, and
supersede.

Approved cards also expose a **Take next action** dialog: skill and prompt cards can
queue an Ask-mode skill-hardening task, user-workflow cards can save to Notes or Memory
V2, and product cards can create a new Work Item or append the recommendation to an
existing one. Each next action runs only after the dialog submit, then records the
resulting artifact as a dream conversion.

## CLI Sessions tab

`features/native-copilot-sessions/NativeCopilotSessionsPanel.tsx` (exported as
`NativeCliSessionsPanel`) is a read-only, provider-switched view of native Copilot,
Codex, and Claude Code CLI sessions for the active workspace. It is gated by
`features.nativeCliSessions` / `nativeCliSessionsEnabled` (disabled by default;
`useNativeCliSessionsEnabled()` tracks live runtime-config updates), reads through
`coc-client`'s `nativeCliSessions` domain, and registers as the `cli-sessions` repo
sub-tab while accepting the hidden `copilot-sessions` key for older links.

**Everything here is read-only**: no input box, streaming, resume, follow-up, archive,
pin, delete, retry, or turn actions, and stored HTML or scripts never execute.

### Layout and provider switching

Two panes on wide screens — searchable session list left at a clamped ~42% width,
selected-session detail right — and stacked single-pane navigation on narrow screens.

The provider switcher defaults to Copilot for compatibility and renders one tab per
`available` descriptor in the shared `AVAILABLE_NATIVE_CLI_PROVIDER_DESCRIPTORS`
registry (Copilot, Codex, Claude). A provider staged as `planned` (`opencode`) gets no
tab, and `parseNativeCliSessionDeepLink` rejects its hash, so the UI can only offer
providers the server registers. Tab labels, store hints, and the external-session label
all read from the descriptor. The header uses the shared `ProviderBadge` palette, a
provider-specific native-session label, and a read-only badge whose tooltip shows the
selected provider's local store path.

### Search strategy

The list supports text query, session-ID, branch, date-range filters, and pagination.
Each response carries an explicit `searchStrategy`:

| Provider | Strategy | Behavior |
|---|---|---|
| Copilot | `native-index` | Delegates to the native SQLite FTS provider |
| Codex, Claude | `on-demand-scan` | Substring-scans JSONL transcripts; the panel explains there is no native search index |
| any | `unavailable` | Distinct notice that transcript text cannot be searched |

The panel falls back to the older `searchIndexAvailable` signal when a response omits
`searchStrategy`.

Each row shows a short session-ID chip, updated timestamp, two-line summary preview,
repository/cwd, optional match snippets, and right-aligned turn-count and branch pills;
the selected row gets a left accent bar. Selection is deep-linked through the URL hash
(`#repos/{wsId}/cli-sessions/{provider}/{sessionId}`, parsed and built via
`parseNativeCliSessionDeepLink` / `buildNativeCliSessionHash`) so it survives refresh and
back/forward and is shareable. `#repos/{wsId}/copilot-sessions/{sessionId}` parses as a
Copilot provider link.

### Deduplication

The list route deduplicates against the Activity tab: native sessions whose provider
session ID matches a CoC process `sdk_session_id` for the workspace (resolved via
`ProcessStore.getSdkSessionIds(workspaceId)`) are hidden, and the response
`deduplicatedCount` drives a `native-sessions-deduplicated` hint reading
`N sessions hidden — already tracked in CoC Activity`.

Automated Copilot background-job sessions whose first turn matches
`BACKGROUND_JOB_PROMPT_PREFIXES` are hidden by default and counted in
`backgroundJobCount`, driving a `native-sessions-background-hidden` hint. The panel
renders distinct disabled, unavailable (`store-missing` / `store-invalid`), loading,
empty, and error states per provider.

### Detail reconstruction

The unified detail endpoint
(`GET /api/workspaces/:id/native-cli-sessions/:sessionId?provider=...`) returns
provider-tagged metadata, `storePath`, `searchIndexAvailable`, `searchStrategy`, and an
always-present `conversation: ReconstructedConversationTurn[]`.

Copilot reconstruction prefers the native `session-state/<id>/events.jsonl` log and falls
back to flat `session-store.db` turns. Codex and Claude reconstruction comes from
defensive JSONL parsers that skip malformed or unknown records while preserving
user/assistant messages, tool start/complete/failed timeline items, thinking/reasoning,
data-URL images, and model metadata. Codex `event_msg` user-message image metadata merges
into the matching user turn; `local_images` paths render as read-only markdown references
because the chat image gallery only renders data URLs.

The SPA maps each turn to `ClientConversationTurn` via `nativeConversationTurns.ts`
(`toClientConversationTurns`), folding assistant `thinking` into a leading markdown
blockquote since `ClientConversationTurn` has no reasoning field, and renders one
read-only `ConversationTurnBubble` per turn under a `native-session-conversation` card
(`Conversation (N)`) with the selected provider passed through for avatar coloring.

## Memory route

The top-level `#memory` route is embedded in the Admin shell's Knowledge group and
renders `MemoryV2Panel` in the right pane; the panel root owns the stable `#view-memory`
id. `V2Tab` values are `facts`, `review`, `episodes`, and `settings`, so hash links such
as `#memory/review` and `#memory/settings` select the matching tab.

`MemoryV2Panel` lists the global scope plus registered workspace scopes, enables and
disables the active scope from the Settings tab, exports JSON, and wipes the active
scope after confirmation. Facts, Review, and Episodes are separate components
(`MemoryV2FactsTab`, `MemoryV2ReviewTab`, `MemoryV2EpisodesTab`); the Settings tab
renders inline in `MemoryV2Panel`.

Repo Settings shows `MemoryStatusCard` (`features/memory/MemoryStatusCard.tsx`, mounted
by `RepoSettingsTab`), which never reads or edits V1 bounded-memory state. See
[memory-system.md](../memory-system.md).
