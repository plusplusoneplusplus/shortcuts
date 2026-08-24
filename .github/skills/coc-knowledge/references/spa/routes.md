# Dashboard SPA — Routes

Onboarding, My Work Today, the Activity tab and its panel chrome, Dreams, CLI Sessions,
and the Memory route.

## Onboarding

- `WelcomeTour` — 5-step full-screen modal (Welcome / Modes / Queue / Multi-repo /
  Servers).
- `FirstStepsCard` — guided checklist that takes the place of the empty repos state.
- `FeatureTip` — contextual dismissible tips.

State lives in `GlobalPreferences`: `hasSeenWelcome`, `onboardingProgress`,
`dismissedTips`.

## My Work — Today tab

`react/features/my-work/`, prepended to My Work as the landing sub-tab when the
default-off `myWork.todayView` flag is on.

### Data

`useMyWorkTasks(active)` covers `/api/my-work/tasks*` (`getTasks`, `patchTask`, `addTask`,
`archiveTasks`) plus `repos.syncMyWork` for the empty state's Sync. `Action Items.md` and
`Follow Ups.md` are the source of truth.

Writes are optimistic → PATCH → refetch, because ids are content-derived and any write
reflows them. A failure rolls back and shows an inline banner over a list that never
blanks; a `busy` guard keeps one mutation in flight at a time. The fetch re-runs each time
`active` goes false → true, so a background sync or scheduled write is picked up without a
page reload.

### Bucketing

`taskBuckets.ts` is pure, React-free view logic: three urgency buckets (Needs you today /
Waiting on others / Everything else), age from the `## Synced <date>` heading, `@due(…)`
tone, the header triage chip (zero segments dropped), snooze targets, the person roll-up
summary, and the nudge draft.

### Rows and keyboard triage

One `TaskRow` serves every bucket. **Selection, which editor is open, and which due menu
is open are held by `MyWorkTodayTab`, not by each row**, because the keyboard layer drives
all three from outside.

`useTaskKeyboardTriage` binds `j`/`k` to move, `x` to toggle, `e` to edit, `d` to open the
due menu, `s` to defer a day, `/` to focus the filter, and Escape to close or deselect.
Every key calls the same handler its click calls. It installs **one** document listener,
reading changing inputs through a ref so it attaches once, and suppresses itself on any
text-entry target, when the pane is hidden (`offsetParent === null` — it is a mounted
keep-alive tab), when inactive, on chords, and inside a dialog or the detail pane. `j`/`k`
step only rows on screen, so section expansion state lives in the tab too.

### Waiting on others

Collapsed per person, with a **Nudge** action that builds a draft from the items, their
ages, and their `sourceUrl`s and opens it in a floating chat (`QueueContext`
`OPEN_DIALOG`, mode `ask`), falling back to the clipboard outside a `QueueProvider`. It
has no send mechanism of its own.

### Placeholders and the What-changed strip

`TodayPlaceholders.tsx` renders skeleton rows on the first fetch only, an empty state
leading with Sync and the two notes links, and a distinct no-matches state when a filter
is on.

`WhatChangedStrip.tsx` pins above the buckets with up to five entries from
`GET /api/my-work/timeline` (the Work Radar note `notes/Work/timeline.md`), each label
linking to its thread note. It is dismissible for the browser session (`sessionStorage`,
key `myWork.whatChanged.dismissed`), refetches per activation like the tasks, and renders
`null` — zero vertical pixels — when the note is absent, empty, junk, dismissed, or the
fetch failed. A failure is `console.warn`ed and swallowed so the task list always comes
up. Nothing writes that note yet, so empty is the normal state.

## Activity tab

The action bar carries New chat, refresh, and the ALL/AP split pause pill. A scope
segmented control selects Chats / Scheduled (when `cron.enabled`) / Automations / All,
persisted in `localStorage['coc-activity-scope']`.

For Each parent run group rows render in Chats and All, not in Automations or Scheduled;
cron-linked child chats can still appear in Scheduled independently of the hidden parent
row.

### Scoped Ctrl+F

The search box is hidden by default behind `searchVisible`. Ctrl+F / ⌘F routes by which
pane owns **keyboard focus** — never mouse hover — through
`useScopedFindShortcut(containerRef, onTrigger, opts)`
(`react/hooks/useScopedFindShortcut.ts`). Every search-owning panel (chat list, git commit
list, tasks, work items) uses it, so none can fight over `preventDefault` or swallow
native find. Panels carry `data-find-scope` while mounted so a sibling never steals Ctrl+F
from a different focused panel.

Decision order:

1. **Skip** when its container is hidden (`offsetParent === null`), so a mounted-but-hidden
   keep-alive tab never intercepts.
2. **Yield** when focus is in the detail pane (`data-pane="detail"`, via the exported
   `isWithinDetailPane`) so native find-in-page takes over — it only opens when
   `defaultPrevented` stays false.
3. **Handle** when focus is inside the container.
4. **Yield** when focus is in any other region that is neither this container nor
   `document.body`/`documentElement` — e.g. the workspace right dock's terminal/explorer,
   which owns its own Ctrl+F story.
5. On `document.body` or nothing, **handle only if `claimsBodyFocus`** (default true; the
   git list passes `!isSplitWorkspace` so the chat list wins body focus in the
   split-workspace layout).

✕ clears the query and leaves the box open; Escape clears and hides it; a `workspaceId`
change resets `searchVisible`.

### Chat list chrome

`ChatListPane` keeps the action, scope, and search controls in a sticky
`chat-list-fixed-header` block while rows scroll underneath. The header full-bleeds to the
scroll container edges (`-mx-2 md:-mx-4`) and the `chat-list-pane` scroll container
carries **no top padding** (`px-2 pb-2 md:px-4 md:pb-4`) so the `sticky top-0` header sits
flush — top padding there shows as a gap that a negative header margin cannot cancel,
because sticky clamps to the padding edge.

The desktop activity split (`RepoChatTab`) can collapse the left chat-list panel to a
rail; the affordance sits on the list/detail resize handle. Collapsed state persists in
`localStorage['activity-list-collapsed-{workspaceId}']` and width in
`localStorage['activity-left-panel-width-{workspaceId}']`.

### Notes sidebar collapse

The Notes tree sidebar (`NotesView` → `NotesSidebar`, shared by repo notes, My Life, and
My Work) collapses the whole left column to a rail on desktop and tablet; mobile keeps its
`ResponsiveSidebar` drawer. Collapsed state persists per workspace under
`localStorage['coc-notes-sidebar-collapsed-{workspaceId}']` (`'1'`/`'0'`, written only on
an explicit toggle) via `useNotesSidebarCollapsed`, so repo, My Life, and My Work each
remember their own. The tree stays mounted-hidden (keep-alive) inside the
`ResponsiveSidebar`, and while collapsed the view publishes `NOTES_SIDEBAR_RAIL_WIDTH` to
`--workspace-left-col-width` so the docked status bar stays flush. `useHoverPeek` floats
the sidebar back as a transient overlay on fine-pointer hover without rewriting the
persisted flag. State is a local `useState` store — no Cmd/Ctrl+B and no cross-tree sync,
because every consumer lives in the single `NotesView` subtree.

### SplitWorkspacePanel

The chat/git divider is an explicit horizontal `role="separator"` resize handle persisting
the chat pane height under `split-workspace:{workspaceId}:chat-height`. Each left half
(chat top, git bottom) sits under a compact section header; clicking it collapses that
half to its bar and the open half grows to fill, and the divider renders only when both
halves are open. Collapsed bodies stay mounted but `hidden` so scroll and selection
survive. Collapsed state persists under `split-workspace:{workspaceId}:chat-collapsed` and
`split-workspace:{workspaceId}:git-collapsed`, written only on an explicit user toggle —
never on mount or workspace switch. The optional docked `footer` (the remote-first shell's
status cluster) pins bottom-left; when both halves are collapsed neither carries `flex-1`,
so a `flex-1` spacer keeps the footer down.

### The git half's dense skin

`SplitWorkspacePanel` exposes a `gitHeaderExtra` slot on the git section header. Its
clicks do not toggle, and it stays visible while collapsed, with the collapsed half
switching to `overflow-visible` so dropdowns are not clipped. `RepoDetail` fills the slot
with a portal host div (`splitGitHeaderNode`, mirroring `splitDetailNode`) and passes it to
`RepoGitTab` as `headerToolbarContainer`; `RepoGitTab` portals a `compact`
`GitPanelHeader` into it instead of the standalone toolbar strip.

**The hoisted portal is a sibling OUTSIDE the git list's `onClickCapture` wrapper.**
Portaled React events bubble through the React tree, so nesting it would make toolbar
clicks (Pull, refresh) mark git last-clicked and steal the shared detail pane from chat.

In split layout the search bar slims (full hint kept in `aria-label`), the
`git-repo-sections` grid tightens, and `BranchChanges` / `WorkingTree` render their
`compact` variant with full text preserved in `title` tooltips.

### Owned-sidebar status docks

Views that own their sidebar host the remote-first status cluster in their own chrome
instead of the app-wide `GlobalStatusDock`: `NotesView` passes `DockedStatusFooter` into
`NotesSidebar`; regular repo and My Life Settings pass `dockStatusFooter` to
`RepoSettingsTab`; My Work keeps a body-level `DockedStatusFooter` shared across sub-tabs;
`PullRequestsTab` docks one at the bottom of its PR queue sidebar, hidden while that queue
is collapsed to a rail, with `GlobalStatusDock` standing down on the `pull-requests`
sub-tab.

## Ralph workflow pane

Ralph activity deep-links mount `RalphWorkflowPane`: a unified task timeline beside a
read-only session file browser. Timeline node semantics (iteration nodes, `Final check
#<checkIndex>` nodes and their `sourceIteration` placement, `Gap fix loop <N>` dividers,
`Submit PR` / `RalphSubmitNode`, resume and continue-loop confirmations with
`ModalJobAiControls` and omit-when-unchanged serialization) live in
[../ralph-lifecycle.md](../ralph-lifecycle.md).

SPA-specific rules:

- The timeline interleaves the union of `record.iterations` and parsed `progress.md`
  sections with final-check nodes from `record.finalChecks`.
- The `Gap fix loop <N>` divider is **not** gated behind `RALPH_MULTI_LOOP` (it follows
  final-check visibility); generic `Loop <N>` dividers stay gated.
- The file browser lists the raw files from the Ralph session API, selects the first by
  default, renders Markdown through the shared renderer, and formats JSON as indented
  text. It accepts an optional selected filename from the router and reports selections
  back, so `#repos/{workspaceId}/activity/ralph/{sessionId}/{filename}` deep-links a
  session file; bare and trailing-slash session hashes fall back to the first file.

## Dreams route

The repo-scoped Dreams tab (`features/dreams/DreamsPanel.tsx`) is a review surface
separate from Work Items. It appears in repo tab strips only when the global
`dreams.enabled` flag is on, then requires the workspace `preferences.dreams.enabled`
opt-in before calling Dreams routes.

It lists visible cards by default, supports status filters for hidden lifecycle history,
exposes a manual **Run dream now**, shows run summaries and no-new-dreams states, links
source process turn ranges back to the Activity conversation route, and offers card
lifecycle actions: approve, dismiss, record conversion, supersede.

Approved cards also expose a **Take next action** dialog: skill and prompt cards queue an
Ask-mode skill-hardening task, user-workflow cards save to Notes or Memory V2, and product
cards create a new Work Item or append the recommendation to an existing one. Each next
action runs only after the dialog submit, then records the resulting artifact as a dream
conversion.

## CLI Sessions tab

`features/native-copilot-sessions/NativeCopilotSessionsPanel.tsx` (exported as
`NativeCliSessionsPanel`) is a read-only, provider-switched view of native Copilot, Codex,
and Claude Code CLI sessions for the active workspace. It is gated by
`features.nativeCliSessions` / `nativeCliSessionsEnabled` (off by default;
`useNativeCliSessionsEnabled()` tracks live runtime-config updates), reads through
`coc-client`'s `nativeCliSessions` domain, and registers as the `cli-sessions` repo
sub-tab while accepting the hidden `copilot-sessions` key.

**Everything here is read-only**: no input box, streaming, resume, follow-up, archive,
pin, delete, retry, or turn actions, and stored HTML or scripts never execute.

### Layout and provider switching

Two panes on wide screens (searchable session list left, selected-session detail right),
stacked single-pane navigation on narrow screens.

The provider switcher defaults to Copilot and renders one tab per `available` descriptor
in the shared `AVAILABLE_NATIVE_CLI_PROVIDER_DESCRIPTORS` registry (Copilot, Codex,
Claude). A provider staged as `planned` (`opencode`) gets no tab, and
`parseNativeCliSessionDeepLink` rejects its hash, so the UI can only offer providers the
server registers. Tab labels, store hints, and the external-session label all read from
the descriptor; the header uses the shared `ProviderBadge` palette.

### Search strategy

The list supports text query, session-ID, branch, date-range filters, and pagination. Each
response carries an explicit `searchStrategy`:

| Provider | Strategy | Behavior |
|---|---|---|
| Copilot | `native-index` | Delegates to the native SQLite FTS provider |
| Codex, Claude | `on-demand-scan` | Substring-scans JSONL transcripts |
| any | `unavailable` | Distinct notice that transcript text cannot be searched |

The panel falls back to the `searchIndexAvailable` signal when a response omits
`searchStrategy`.

Selection is deep-linked through the URL hash
(`#repos/{wsId}/cli-sessions/{provider}/{sessionId}`, parsed and built via
`parseNativeCliSessionDeepLink` / `buildNativeCliSessionHash`) so it survives refresh and
back/forward and is shareable. `#repos/{wsId}/copilot-sessions/{sessionId}` parses as a
Copilot link.

### Deduplication

The list route deduplicates against the Activity tab: native sessions whose provider
session ID matches a CoC process `sdk_session_id` for the workspace (resolved via
`ProcessStore.getSdkSessionIds(workspaceId)`) are hidden, and `deduplicatedCount` drives
the `native-sessions-deduplicated` hint.

Automated Copilot background-job sessions whose first turn matches
`BACKGROUND_JOB_PROMPT_PREFIXES` are hidden by default and counted in
`backgroundJobCount`, driving a `native-sessions-background-hidden` hint. The panel
renders distinct disabled, unavailable (`store-missing` / `store-invalid`), loading,
empty, and error states per provider.

### Detail reconstruction

`GET /api/workspaces/:id/native-cli-sessions/:sessionId?provider=...` returns
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
with the selected provider passed through for avatar coloring.

## Memory route

The top-level `#memory` route is embedded in the Admin shell's Knowledge group and renders
`MemoryV2Panel` in the right pane; the panel root owns the stable `#view-memory` id.
`V2Tab` values are `facts`, `review`, `episodes`, and `settings`, so hashes such as
`#memory/review` and `#memory/settings` select the matching tab.

`MemoryV2Panel` lists the global scope plus registered workspace scopes, enables and
disables the active scope from the Settings tab, exports JSON, and wipes the active scope
after confirmation. Facts, Review, and Episodes are separate components
(`MemoryV2FactsTab`, `MemoryV2ReviewTab`, `MemoryV2EpisodesTab`); Settings renders inline
in `MemoryV2Panel`.

Repo Settings shows `MemoryStatusCard` (`features/memory/MemoryStatusCard.tsx`, mounted by
`RepoSettingsTab`), which never reads or edits V1 bounded-memory state. See
[../memory-system.md](../memory-system.md).
