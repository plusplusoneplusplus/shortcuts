# Repository Pull Requests Tab — UI/UX Specification

**Document type:** Formal UX Specification  
**Scope:** CoC Dashboard → Repository Detail → Pull Requests Tab  
**Purpose:** Authoritative reference for validating any future UI/UX changes to the Pull Requests tab.  
**Version:** 2.0.0

---

## 1. Overview

The **Pull Requests Tab** is the redesigned "PR review command queue". The left rail shows the filtered open-PR queue grouped into attention-based sections (e.g. *Needs review*, *Ready after checks*); the right pane shows either a single PR's detail (Overview / Files changed / Commits / Checks sub-tabs) or a batch-command panel when multiple PRs are multi-selected. Provider credentials are configured inline when not yet set up. AI-driven extras (PR Suggestions, AI Assistant drawer, AI Pass) are gated behind feature flags.

### 1.1 Tab Identity

| Property | Value |
|---|---|
| Tab label | `Pull Requests` (renamed to `Full Requests` in dev-workflow UI layout mode) |
| Keyboard shortcut | `Alt+R` |
| Tab visibility | Hidden when `pullRequests.enabled` is false or the repo is not a Git repo |
| Default tab | No |
| URL fragment | `#repos/<workspaceId>/pull-requests` |
| Deep-link | `#repos/<workspaceId>/pull-requests/<prNumber>[/<detailTab>]` where `<detailTab>` ∈ `overview` (default), `files`, `commits`, `checks` |
| Suggestions feature | Gated by `isPullRequestsSuggestionsEnabled()` (`pullRequests.suggestions`) |
| Implementing component | `PullRequestsTab` (`features/pull-requests/PullRequestsTab.tsx`) |

---

## 2. User Personas

| Persona | Description | Primary Goal |
|---|---|---|
| **Reviewer** | Team members assigned to review PRs | Triage queue, work through "Needs review", read diffs/threads, vote |
| **Developer** | Engineers with their own open PRs | Track checks, see status, jump to ADO/GitHub |
| **Team lead** | Managers monitoring PR throughput | Use the global "All" scope, batch-act on stale PRs, audit checks |
| **Power reviewer** | Frequent reviewers using AI helpers | Run AI Pass, use the AI Assistant drawer, accept "For you" suggestions |

---

## 3. User Stories

### 3.1 Queue (Left Rail)

**US-01 — Browse the open-PR queue**
> As a reviewer, I want to see the open PR queue grouped by attention.

- **Given** the Pull Requests tab is open and credentials are configured
- **When** PRs load via `pullRequests.list(repoId, { status: 'open', scope, top: 25, skip })`
- **Then** rows are rendered as `PullRequestRow` components grouped under `QUEUE_SECTION_CONFIGS` sections (`Needs review` / `Ready after checks`) via `classifyQueueSection`
- **And** each row shows status, `#number`, title, author initial, branches (`target ← source`), reviewer count, comment count, and a relative `Updated X` timestamp

---

**US-02 — Switch the queue scope/filter**
> As a team lead, I want pill filters to change which PRs are visible.

- **Given** the queue is visible
- **When** the user clicks a `PrQueueFilters` pill (All / Mine / Blocked / Ready, plus `For you` when suggestions are enabled)
- **Then** the active filter changes; the server scope (`mine` / `all`) is derived via `scopeForFilter`; switching scope triggers a server refetch
- **And** Blocked / Ready / For you filter rows out PRs client-side using the attention classifier (`classifyPr`)

---

**US-03 — Search PRs by title**
> As a reviewer, I want a quick title search.

- **Given** the queue is visible
- **When** the user types in the search input
- **Then** the queue filters client-side by case-insensitive substring of `pr.title`

---

**US-04 — Paginate the queue**
> As a reviewer, I want to load more PRs.

- **Given** more PRs exist beyond the current page (`hasMore`)
- **When** the user clicks **Load more**
- **Then** the next batch of `PAGE_SIZE = 25` PRs is appended
- **And** the cumulative result is cached at `prListCache[<repoId>|open|<scope>]` so remounting the panel does not refetch unless `force` is true

---

**US-05 — Refresh the queue**
> As a reviewer, I want to bypass server and client cache.

- **When** the user clicks **↻** Refresh
- **Then** `pullRequests.list(...)` is called with `force: true`; the client cache entry is deleted before the request

---

**US-06 — See "Updated X min ago"**
> As a reviewer, I want to know how stale the queue is.

- **Given** PRs are loaded
- **Then** a `formatFetchedAt(ts)` label updates every 30 s ("Updated just now" → "Updated X min ago" → "Updated X hr ago")

---

**US-07 — Open PR by number or URL**
> As a power reviewer, I want to jump straight to a PR with its number or URL.

- **Given** the queue is visible
- **When** the user enters a PR number (e.g. `1234`) or PR URL into the **Open PR** input and clicks **Open**
- **Then** `parsePrInput` extracts the number; if a URL points at a different known repo, `matchWorkspaceForPrUrl` re-routes the request; `pullRequests.get(repoId, prNumber)` validates existence
- **And** on success the hash navigates to `#repos/<repoId>/pull-requests/<n>/overview`

---

**US-08 — Multi-select / batch mode**
> As a reviewer, I want to select multiple PRs and run a batch command.

- **Given** the queue is visible
- **When** the user toggles batch mode
- **Then** rows show selection checkboxes; the right pane swaps the detail view for a `BatchCommandPanel`
- **And** the batch panel highlights the dominant attention group (`dominantGroup`) of the selection so it can suggest a relevant action

---

**US-09 — Collapse the queue**
> As a reviewer, I want to give the detail pane more room.

- **Given** the queue is visible
- **When** the user clicks the collapse handle
- **Then** the queue collapses to `QUEUE_COLLAPSED_WIDTH = 44 px`; batch mode and selections are cleared; the collapsed state persists in `localStorage[pr-queue-collapsed]`

---

### 3.2 PR Suggestions ("For you")

**US-10 — Browse cached suggestions**
> As a reviewer, I want to see ranked PRs the system thinks I should review.

- **Given** suggestions are enabled (`isPullRequestsSuggestionsEnabled()`)
- **When** the queue mounts
- **Then** `pullRequests.getSuggestions(repoId)` populates `suggestions[]` and `rankedAt`; matching PRs in the open list are flagged

**US-11 — Refresh suggestions from review history**
> As a reviewer, I want to recompute the ranking after I've reviewed more PRs.

- **When** the user clicks **Refresh suggestions**
- **Then** `pullRequests.refreshReviewHistory(repoId)` runs first; if review history is empty, an inline info note is shown and ranking is skipped
- **Otherwise** `pullRequests.refreshSuggestions(repoId)` re-ranks; status text steps through "Fetching review history…" → "Ranking open PRs…" → "Updated just now"
- **And** errors surface inline (`setSuggestionsError`)

---

### 3.3 PR Detail (Right Pane)

**US-12 — View PR detail with sub-tabs**
> As a reviewer, I want to read the full PR.

- **Given** a PR is selected
- **When** the detail loads via parallel calls to `pullRequests.get`, `getThreads`, `getDiff`, `getCommits`, `getChecks`
- **Then** the pane shows four sub-tabs: **Overview** (default), **Files changed**, **Commits**, **Checks**
- **And** switching tabs updates `state.selectedPrDetailTab` and the URL hash to `…/pull-requests/<n>/<tab>` via `history.replaceState`

**US-13 — Overview tab**
> As a reviewer, I want the description, threads, reviewer votes, and labels in one view.

- **Given** the Overview tab is active
- **Then** the pane renders the rendered markdown description, reviewer badges with vote icons (`ReviewerBadge`), label chips, an "Open in browser" link, threads (`PrAiGroupedThreads` when AI summarization is enabled, otherwise `ThreadList`), and the AI Summary card when present (`PrAiSummaryPanel`)

**US-14 — Files changed tab**
> As a reviewer, I want a unified diff with classification when available.

- **Given** the Files changed tab is active
- **Then** `PrFilesPanel` renders the parsed diff (`parseDiffFileList(text)`); when `SHOW_FOCUSED_DIFF` is true and the PR has a `headSha`, file classification (logic / mechanical / generated / test) overlays the file list via `useClassification`
- **And** clicking a file pops out the diff viewer in a new window via `buildGitPrPopOutUrl`

**US-15 — Commits tab**
> As a reviewer, I want a chronological commit log.

- **Given** the Commits tab is active
- **Then** `PrCommitTable` renders rows from `pullRequests.getCommits`; failures show an inline `commitsError` message

**US-16 — Checks tab**
> As a reviewer, I want to see CI checks and merge readiness.

- **Given** the Checks tab is active
- **Then** `PrChecksAndReadiness` renders entries from `pullRequests.getChecks`; failures show an inline `checksError` message

---

### 3.4 PR Detail — AI helpers (feature-flagged)

**US-17 — Open the AI Assistant drawer**
> As a power reviewer, I want an AI helper sidebar.

- **When** the user opens the assistant
- **Then** `PrAiAssistantDrawer` slides in alongside the detail pane; conversation state lives inside `PrConversationPanel`

**US-18 — Run an AI Pass**
> As a power reviewer, I want a one-shot AI summary + review.

- **When** the user clicks **Run AI Pass**
- **Then** `aiPassRunning` flips true while the SDK call is in flight; `aiPassDone` flips true when complete; the summary copy button uses `summaryCopied` to show a transient confirmation

**US-19 — Quick review workflow**
> As a reviewer, I want a guided walk-through to vote / comment.

- **When** the user opens the quick review panel
- **Then** `PrQuickReviewWorkflow` orchestrates the multi-step flow

---

### 3.5 Provider Configuration

**US-20 — Configure provider credentials inline**
> As a developer, I want to set up GitHub or ADO inline.

- **Given** the list call returns 401 with body `{ error: 'unconfigured', detected, remoteUrl }` or `{ error: 'no-ado-credentials' }`
- **Then** `ProviderConfigPanel` replaces the queue with a setup card targeting the detected provider (GitHub PAT, or ADO org URL + PAT)
- **When** credentials are saved successfully
- **Then** `unconfigured` clears and the queue refetches automatically

---

### 3.6 Mobile Layout

**US-21 — Mobile single-pane**
> As a mobile user, I want one pane at a time.

- **Given** `useBreakpoint().isMobile` is true
- **Then** `mobileShowDetail` toggles between the queue and the detail; back button clears `mobileShowDetail`

---

## 4. Feature Inventory & Acceptance Criteria

### 4.1 Queue (Left Rail)

| Feature | Acceptance Criteria |
|---|---|
| Sections | `Needs review`, `Ready after checks` (driven by `QUEUE_SECTION_CONFIGS`); each section is a collapsible `PrQueueGroupSection` |
| Filter pills | `PrQueueFilters` — All / Mine / Blocked / Ready / For you (when suggestions enabled); active pill has the accent color |
| Filter counts | `QueueFilterCounts` — `all`, `mine`, `blocked`, `ready`, `foryou`; computed locally from the loaded scope |
| Search | Title-only client-side filter; case-insensitive |
| Open PR input | Accepts number or URL; cross-repo URLs re-route to the matching repo |
| Refresh | Bypasses server (60 min TTL) and client cache (`prListCache`) |
| Pagination | Append next 25; `hasMore = newPrs.length === PAGE_SIZE` |
| Live label | "Updated X min/hr ago" refreshed every 30 s |
| Collapse | `localStorage[pr-queue-collapsed]`; collapsed width 44 px; clears batch state |
| Cache key | `${repoId}|open|${effectiveScope}` |

### 4.2 Detail (Right Pane)

| Feature | Acceptance Criteria |
|---|---|
| Sub-tabs | `overview`, `files`, `commits`, `checks` (mapped via `PrDetailTab`); switching updates store + hash |
| Overview | Description (markdown), threads (`ThreadList` or `PrAiGroupedThreads`), reviewer badges, labels, "Open in browser" |
| Files | Unified diff + optional classification overlay (`SHOW_FOCUSED_DIFF` + `useClassification`); file click pops-out review |
| Commits | `PrCommitTable` from `pullRequests.getCommits`; errors inline |
| Checks | `PrChecksAndReadiness` from `pullRequests.getChecks`; errors inline |
| Refresh | Force refresh re-runs all five fetches (`pullRequests.get/getThreads/getDiff/getCommits/getChecks`) |
| AI Assistant | `PrAiAssistantDrawer` (gated UI) |
| AI Pass | One-shot summary; transient `summaryCopied` confirmation |
| Quick Review | `PrQuickReviewWorkflow` |
| Pop-out window | `buildGitPrPopOutUrl(workspaceId, repoId, prId)`; `markPoppedOut` from `useGitReviewPopOut` |

### 4.3 Suggestions

| Feature | Acceptance Criteria |
|---|---|
| Cached load | `getSuggestions(repoId)` → `{ suggestions, rankedAt }`; non-fatal on error |
| Refresh | `refreshReviewHistory` then `refreshSuggestions`; status text mirrors phase |
| Empty history | Inline info: "No past reviewed PRs found yet…" |
| Match | `suggestedPrNumbers = new Set(suggestions.map(s => s.prNumber))` filters the For you pill |

### 4.4 Provider Config Panel

| Feature | Acceptance Criteria |
|---|---|
| Detection | 401 with `unconfigured` (and optional `detected`/`remoteUrl`) or `no-ado-credentials` |
| GitHub | PAT input with show/hide; Save |
| ADO | Org URL + PAT inputs; Save |
| Storage note | "Token stored in `~/.coc/providers.json`" |

### 4.5 Resize + Mobile

| Feature | Acceptance Criteria |
|---|---|
| Resizable left pane | `useResizablePanel` with min 200 / max 600 / default 276; persisted as `pr-left-panel-width` |
| Mobile | Single-pane toggle (`mobileShowDetail`); back button on detail |

---

## 5. Behavioral Invariants

| ID | Invariant |
|---|---|
| INV-01 | The status filter is hard-coded to `open`; only `scope` (`mine` / `all`) varies and only that triggers a server refetch |
| INV-02 | Filter pills `Blocked`, `Ready`, `For you` are derived client-side via `classifyPr` / suggestion membership |
| INV-03 | The client cache is keyed by `${repoId}|open|${effectiveScope}`; force refresh deletes the entry before fetching |
| INV-04 | Force refresh bypasses both server cache (60 min TTL) and client cache (`prListCache`) |
| INV-05 | Detail data is fetched in parallel (`get`, `getThreads`, `getDiff`, `getCommits`, `getChecks`); thread, diff, commits, and checks failures degrade independently with per-section error state |
| INV-06 | Switching detail sub-tabs uses `history.replaceState` (no new history entry); the canonical hash includes the active sub-tab |
| INV-07 | Threads do not have their own top-level sub-tab; they appear inside Overview |
| INV-08 | Provider config panel replaces the queue when credentials are missing; it does not overlay |
| INV-09 | PR selection is scoped to the current repository; switching repos clears `state.selectedPrId` |
| INV-10 | Cross-repo PR open via URL uses `matchWorkspaceForPrUrl` to redirect to the matching workspace; numbers without context default to the current repo |
| INV-11 | Queue collapsed state clears multi-selection and batch mode |
| INV-12 | Suggestions feature is fully gated by `pullRequests.suggestions` (`isPullRequestsSuggestionsEnabled`); when off, the pill, panel, and refresh button are hidden |
| INV-13 | Live "Updated X" label re-renders every 30 s via a single `setInterval(setNow, 30_000)` |
| INV-14 | The Files Changed classification overlay is gated by `SHOW_FOCUSED_DIFF`; without it the diff list still renders without classifications |

---

## 6. UI Layout Specification

```
┌── RepoDetail ─────────────────────────────────────────────────────────┐
│  [Repo Name]   Chats │ Git │ … │ Pull Requests* │ …                   │
├──────────────────────┬───────────────────────────────────────────────┤
│ [All|Mine|Blocked|   │  PR #42 — Add authentication module           │
│  Ready|For you]      │  ────────────────────────────────────────     │
│ [🔍 Search…]         │  main ← feature/auth                           │
│ [Open PR: 1234] →    │  @alice · Updated 1h ago                       │
│ Updated 2 min ago    │                                                │
│ ────────────────     │  [Overview*][Files changed][Commits][Checks]   │
│ Needs review (3)     │                                                │
│ ▾ #42 Add auth…      │  Description                                   │
│ ▾ #41 Fix bug…       │  …                                             │
│ ────────────────     │  Reviewers: ✓ Bob (Required) · ○ Charlie       │
│ Ready after checks(2)│  Labels:    enhancement · auth                 │
│ ▾ #40 Update README  │  Threads:   3                                  │
│ ▾ #38 Refactor…      │  [Open in browser ↗]  [Run AI Pass]            │
│ [Load more]          │                                                │
└──────────────────────┴───────────────────────────────────────────────┘
```

When batch mode is active, the right pane is replaced by `BatchCommandPanel` displaying the dominant attention group of the selection.

---

## 7. Error Handling Specification

| Error Scenario | Expected Behavior |
|---|---|
| Provider not configured (`unconfigured` / `no-ado-credentials`) | `ProviderConfigPanel` replaces the queue |
| Auth error (401) other body | Plain error message in the queue area |
| Non-401 list failure | Inline error in queue area |
| Single PR fetch failure | Top-level detail error message |
| Threads fetch failure | Empty threads list (silent degradation) |
| Diff fetch failure | `diffError` shown inside the Files tab |
| Commits fetch failure | `commitsError` shown inside the Commits tab |
| Checks fetch failure | `checksError` shown inside the Checks tab |
| Suggestions fetch failure | Inline `suggestionsError` text in the queue |
| Open-by-input not found | Inline `openPrError` next to the input |
| Save credentials failure | Inline error in `ProviderConfigPanel` |

---

## 8. Empty State Specification

| State | Display |
|---|---|
| No pull requests | "No pull requests found." |
| Filters / search exclude all | Empty queue (sections still rendered with 0 counts) |
| Suggestions disabled | For-you pill and panel hidden |
| Suggestions empty due to no review history | Inline info: "No past reviewed PRs found yet…" |
| No description | "No description" inside Overview |
| No threads | "No comment threads." inside Overview |
| No diff | "No diff available." inside Files |
| No commits | "No commits to display." inside Commits |
| No checks | "No checks to display." inside Checks |
| No selection (desktop) | Empty detail pane |

---

## 9. API Dependencies

| Method | HTTP | Used by |
|---|---|---|
| `pullRequests.list(repoId, { status: 'open', scope, top, skip, force })` | `GET /api/repos/:repoId/pull-requests` | Queue list (US-01, US-02, US-04, US-05) |
| `pullRequests.get(repoId, prId, { force })` | `GET /api/repos/:repoId/pull-requests/:prId` | Detail load + open-by-input validation |
| `pullRequests.getThreads(repoId, prId)` | `GET .../threads` | Threads (Overview) |
| `pullRequests.getDiff(repoId, prId)` | `GET .../diff` (text) | Files Changed |
| `pullRequests.getCommits(repoId, prId)` | `GET .../commits` | Commits |
| `pullRequests.getChecks(repoId, prId)` | `GET .../checks` | Checks |
| `pullRequests.getSuggestions(repoId)` | `GET /api/repos/:repoId/pull-requests/suggestions` | For-you pill, suggestions panel |
| `pullRequests.refreshReviewHistory(repoId)` | `POST /api/repos/:repoId/pull-requests/review-history/refresh` | Suggestions refresh prerequisite |
| `pullRequests.refreshSuggestions(repoId)` | `POST /api/repos/:repoId/pull-requests/suggestions/refresh` | Re-rank suggestions |
| `PUT /api/providers/config` | `PUT` | Provider credentials |

---

## Revision History

| Version | Date | Summary |
|---|---|---|
| 1.0.0 | 2026-03-25 | Initial specification (3 detail sub-tabs: Overview / Threads / Files Changed; status filter dropdown + author filter) |
| 2.0.0 | 2026-05-29 | Major rewrite to match the redesigned PR review queue: detail now has 4 sub-tabs (`overview`, `files`, `commits`, `checks`); threads are inside Overview; status hard-coded to `open`; queue grouped into attention sections (`QUEUE_SECTION_CONFIGS`) with classifier-driven Blocked/Ready/For-you pill filters; deep-link includes the detail sub-tab; documented PR suggestions feature flag, batch-command panel, queue collapse state, cross-repo open-by-URL, AI Assistant drawer, AI Pass, focused-diff classification gate, pop-out review window, and `formatFetchedAt` live label. |
