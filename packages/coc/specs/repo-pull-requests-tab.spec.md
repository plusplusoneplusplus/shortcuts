# Repository Pull Requests Tab — UI/UX Specification

**Document type:** Formal UX Specification  
**Scope:** CoC Dashboard → Repository Detail → Pull Requests Tab  
**Purpose:** Authoritative reference for validating any future UI/UX changes to the Pull Requests tab.  
**Version:** 1.0.0

---

## 1. Overview

The **Repository Pull Requests Tab** provides an interface for browsing, filtering, and inspecting pull requests from the repository's remote provider (GitHub or Azure DevOps). It features a resizable split-panel layout with a filterable PR list on the left and a detail view with overview, threads, and file diffs on the right. Provider credentials are configured inline when not yet set up.

### 1.1 Tab Identity

| Property | Value |
|---|---|
| Tab label | `Pull Requests` |
| Tab position | Fourth tab in `RepoDetail` |
| Default tab | No |
| URL fragment | `#repos/<workspaceId>/pull-requests` |
| Deep-link URL | `#repos/<workspaceId>/pull-requests/<prNumber>` |

---

## 2. User Personas

| Persona | Description | Primary Goal |
|---|---|---|
| **Developer** | Engineers reviewing PRs for their repository | Browse open PRs, read diffs, check review status |
| **Reviewer** | Team members assigned to review PRs | Read threads, view file changes, check reviewer votes |
| **Team lead** | Managers monitoring PR activity | Filter by status/author, audit merged PRs |

---

## 3. User Stories

### 3.1 PR Browsing

**US-01 — Browse pull requests**
> As a developer, I want to see a list of pull requests so I can review recent activity.

- **Given** the Pull Requests tab is open and credentials are configured
- **When** pull requests exist
- **Then** a list shows PRs with status badge, number, title, author avatar, branches (target ← source), reviewer count, comment count, and updated time

---

**US-02 — Filter by status**
> As a team lead, I want to filter PRs by status so I can focus on open or merged PRs.

- **Given** the PR list is visible
- **When** the user selects a status from the dropdown (open / closed / merged / draft / all)
- **Then** the list refetches from the server with the selected status filter

---

**US-03 — Search PRs by title**
> As a developer, I want to search PRs by title to find a specific one.

- **Given** the PR list is visible
- **When** the user types in the search input
- **Then** the list filters client-side to show only PRs whose title contains the search term (case-insensitive)

---

**US-04 — Filter by author**
> As a team lead, I want to filter PRs by author.

- **Given** the PR list is visible
- **When** the user types in the author filter input
- **Then** the list filters client-side to show only PRs whose author display name or ID matches (case-insensitive)

---

**US-05 — Paginate PR list**
> As a developer, I want to load more PRs when the list is long.

- **Given** more PRs exist beyond the current page
- **When** the user clicks "Load more"
- **Then** the next batch of 25 PRs is appended to the list

---

### 3.2 PR Detail

**US-06 — View PR overview**
> As a reviewer, I want to see the PR description, reviewers, and labels.

- **Given** a PR is selected
- **When** the Overview tab is active
- **Then** the detail pane shows the rendered markdown description, reviewer badges with vote icons, label chips, and an "Open in browser" link

---

**US-07 — View PR threads**
> As a reviewer, I want to read comment threads on a PR.

- **Given** a PR is selected
- **When** the Threads tab is active
- **Then** all comment threads are listed with file paths (when applicable), author avatars, timestamps, and expandable thread content

---

**US-08 — View PR file changes**
> As a reviewer, I want to see the unified diff of changed files.

- **Given** a PR is selected
- **When** the Files Changed tab is active
- **Then** a `UnifiedDiffViewer` shows the diff with line numbers; the diff loads lazily on first tab selection

---

**US-09 — Deep-link to a PR**
> As a developer sharing a link, I want a URL that opens a specific PR.

- **Given** a URL of the form `#repos/<workspaceId>/pull-requests/<prNumber>`
- **When** the user navigates to that URL
- **Then** the Pull Requests tab opens with the specified PR selected

---

### 3.3 Provider Configuration

**US-10 — Configure provider credentials**
> As a developer, I want to set up my GitHub or ADO credentials so I can access PRs.

- **Given** the provider is not configured (401 with `unconfigured` error)
- **When** the `ProviderConfigPanel` is shown
- **Then** for GitHub: a PAT input with show/hide and Save; for ADO: organization URL + PAT inputs with Save
- **When** credentials are saved successfully
- **Then** the PR list is fetched automatically

---

## 4. Feature Inventory & Acceptance Criteria

### 4.1 Left Pane — PR List

| Feature | Acceptance Criteria |
|---|---|
| Status filter | Server-side filter: open, closed, merged, draft, all; triggers refetch |
| Search input | Client-side filter on PR title; case-insensitive substring match |
| Author filter | Client-side filter on author display name or ID |
| Refresh button | Force-refreshes bypassing both server and client cache |
| PR rows | Status badge, #number, title, author initial, branches, reviewer count, comment count, updated time |
| Load more | Appends next 25 PRs; hidden when no more results |
| Client cache | PR list cached per `repoId|statusFilter`; avoids refetch on remount unless forced |

### 4.2 Right Pane — Detail

| Feature | Acceptance Criteria |
|---|---|
| Three sub-tabs | Overview, Threads (N), Files Changed |
| Overview | Rendered markdown description; reviewer badges with vote icons; label chips; "Open in browser" link |
| Threads | Expandable thread list; file path when available; author avatars and timestamps |
| Files Changed | `UnifiedDiffViewer` with line numbers; lazy load on first tab selection |
| Mobile back | "← Back to list" clears selection and resets hash |

### 4.3 Provider Config Panel

| Feature | Acceptance Criteria |
|---|---|
| Detection | Shown on 401 with `unconfigured` or `no-ado-credentials` error |
| GitHub | PAT input with show/hide toggle; Save button |
| ADO | Organization URL + PAT inputs; Save button |
| Success | Banner shown; auto-refetch PRs |
| Storage note | Footer: "Token stored in `~/.coc/providers.json`" |

### 4.4 Resize Behavior

| Feature | Acceptance Criteria |
|---|---|
| Left panel resize | Drag handle; width range 160–600px; persisted as `pr-left-panel-width` |
| Mobile layout | Single pane: list or detail with back navigation |

---

## 5. Behavioral Invariants

| ID | Invariant |
|---|---|
| INV-01 | Status filter always triggers a server refetch; search and author filters are client-side only |
| INV-02 | The client cache is keyed by `repoId|statusFilter`; changing status always invalidates the cache entry |
| INV-03 | Force refresh bypasses both server cache (60-min TTL) and client cache |
| INV-04 | The Files Changed diff is fetched lazily only when the tab is first selected; it is not pre-loaded |
| INV-05 | Provider configuration panel replaces the PR list when credentials are missing; it does not overlay |
| INV-06 | Thread fetch failures result in an empty thread list, not an error state |
| INV-07 | PR selection is scoped to the current repository; switching repos clears the selection |

---

## 6. UI Layout Specification

```
┌─────────────────────────────────────────────────────────────────────┐
│  [Repo Name]   Activity │ Git │ Plans │ Pull Requests* │ ...        │
├────────────────────────┬────────────────────────────────────────────┤
│                        │                                            │
│  [🔍 Search PRs…]      │  #42 — Add authentication module          │
│  [Status: open ▼]      │  ──────────────────────────────────        │
│  [Author filter…]      │  main ← feature/auth                      │
│  [↻ Refresh]           │  @alice · Created 2h ago · Updated 1h ago │
│                        │                                            │
│  ┌──────────────────┐  │  [Overview*] [Threads (3)] [Files Changed]│
│  │ ● #42 Add auth…  │  │                                            │
│  │   alice · main←…  │  │  ## Description                          │
│  │   👥2 💬3 · 1h    │  │  This PR adds the authentication module  │
│  ├──────────────────┤  │  with JWT token support and…              │
│  │ ● #41 Fix bug…   │  │                                            │
│  │   bob · main←…    │  │  **Reviewers:**                          │
│  │   👥1 💬1 · 3h    │  │  ✓ Bob (Approved, Required)             │
│  ├──────────────────┤  │  ○ Charlie (No vote)                      │
│  │ ◐ #40 Draft: …   │  │                                            │
│  └──────────────────┘  │  **Labels:** enhancement, auth            │
│                        │                                            │
│  [Load more]           │  [Open in browser ↗]                      │
└────────────────────────┴────────────────────────────────────────────┘
```

---

## 7. Error Handling Specification

| Error Scenario | Expected Behavior |
|---|---|
| Provider not configured | `ProviderConfigPanel` shown with setup instructions |
| Auth error (401) | `ProviderConfigPanel` shown for re-authentication |
| List fetch failure | Generic error message in list area |
| Single PR fetch failure | Error container with message in detail pane |
| Thread fetch failure | Empty thread list (silent degradation) |
| Diff fetch failure | "No diff available…" message |
| Credential save failure | Error shown in config panel |

---

## 8. Empty State Specification

| State | Display |
|---|---|
| No pull requests | "No pull requests found" |
| Filters exclude all | "No pull requests match your filters." |
| No description | "No description" in overview |
| No threads | "No comment threads." |
| No diff | "No diff available…" |
| No selection | Empty detail pane (desktop only) |

---

## 9. API Dependencies

| Endpoint | Used by | Critical for |
|---|---|---|
| `GET /api/repos/:repoId/pull-requests` | PR list | US-01, US-02, US-05 |
| `GET /api/repos/:repoId/pull-requests/:prId` | PR detail | US-06 |
| `GET /api/repos/:repoId/pull-requests/:prId/threads` | Thread list | US-07 |
| `GET /api/repos/:repoId/pull-requests/:prId/diff` | File diff (plain text) | US-08 |
| `PUT /api/providers/config` | Save credentials | US-10 |

---

## Revision History

| Version | Date | Summary |
|---|---|---|
| 1.0.0 | 2026-03-25 | Initial specification |
