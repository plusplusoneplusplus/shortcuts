# Memory Tab — UI/UX Specification

**Document type:** Formal UX Specification  
**Scope:** CoC Dashboard → Memory (Top-Level Tab)  
**Purpose:** Authoritative reference for validating any future UI/UX changes to the Memory tab.  
**Version:** 1.0.0

---

## 1. Overview

The **Memory Tab** is a top-level dashboard tab for managing the AI memory system. It provides three sub-tabs: Entries (paginated, searchable memory entries), Files (observation files and explore cache organized by level), and Config (memory settings and explore cache aggregation). The memory system stores facts learned from AI sessions, organized into global (system), per-git-remote, and per-repository levels.

### 1.1 Tab Identity

| Property | Value |
|---|---|
| Tab label | `Memory` |
| Tab position | Top-level tab |
| Default tab | No |
| URL fragment | `#memory` |
| Deep-link URL | `#memory/<subTab>` (entries, files, config) |

---

## 2. User Personas

| Persona | Description | Primary Goal |
|---|---|---|
| **AI operator** | Engineers managing AI memory | Browse entries, review observations, configure settings |
| **Debugger** | Users troubleshooting AI behavior | Inspect raw memory files, review cached tool calls |
| **Administrator** | Users managing storage and aggregation | Configure memory limits, trigger aggregation, review stats |

---

## 3. User Stories

### 3.1 Entries Sub-Tab

**US-01 — Browse memory entries**
> As an AI operator, I want to browse stored memory entries.

- **Given** the Entries sub-tab is active
- **When** entries exist
- **Then** a paginated list shows entries with summary (or truncated ID), tags as chips, source, and created date

---

**US-02 — Search and filter entries**
> As an AI operator, I want to search entries by text and filter by tag.

- **Given** the Entries sub-tab is active
- **When** the user types in the search input or tag filter
- **Then** `GET /api/memory/entries?q=<query>&tag=<tag>&page=<page>` refetches with the filters applied

---

**US-03 — View entry detail**
> As a debugger, I want to see the full content of a memory entry.

- **Given** an entry is listed
- **When** the user clicks View
- **Then** a modal overlay shows the full content in `<pre>` format, tags, source, and created time; clicking the backdrop closes the modal

---

**US-04 — Delete an entry**
> As an administrator, I want to delete a memory entry.

- **Given** an entry is listed
- **When** the user clicks Delete and then Confirm (two-step)
- **Then** `DELETE /api/memory/entries/:id` removes the entry and the list refreshes

---

### 3.2 Files Sub-Tab

**US-05 — Browse observation files**
> As a debugger, I want to browse observation files organized by level.

- **Given** the Files sub-tab is active with Observations selected
- **When** observation levels exist
- **Then** a left column shows level cards: Global (system), Git Remotes (with counts), Repositories (with counts); each card shows file count and "consolidated" badge when applicable

---

**US-06 — View an observation file**
> As a debugger, I want to read the content of an observation file.

- **Given** a level is selected and files are listed
- **When** the user clicks a filename
- **Then** the right panel shows metadata (pipeline, timestamp, optional model/repo) and content in `<pre>` format

---

**US-07 — Browse explore cache**
> As a debugger, I want to browse cached tool call results.

- **Given** the Files sub-tab is active with Explore Cache selected
- **When** cache data exists
- **Then** three-level navigation (Global / git-remote / repo) with Raw and Consolidated sub-tabs

---

**US-08 — View raw cache entry**
> As a debugger, I want to see a raw cached tool call.

- **Given** the Raw sub-tab is active
- **When** the user clicks a file
- **Then** the detail shows tool name, timestamp, optional git hash, question, and answer in `<pre>` format

---

**US-09 — View consolidated cache entry**
> As a debugger, I want to see a consolidated cache entry.

- **Given** the Consolidated sub-tab is active
- **When** the user clicks an entry
- **Then** the detail shows question, created time, hit count, tool sources, topic chips, and answer in `<pre>` format

---

### 3.3 Config Sub-Tab

**US-10 — Configure memory settings**
> As an administrator, I want to configure memory storage and behavior.

- **Given** the Config sub-tab is active
- **When** the settings card loads
- **Then** fields are shown: storage directory, backend (file/sqlite/vector), max entries, TTL (0 = no limit), auto-inject checkbox, conversation recording checkbox

---

**US-11 — Save memory configuration**
> As an administrator, I want to save my memory settings.

- **Given** the Config sub-tab is active
- **When** the user modifies settings and clicks Save
- **Then** `PUT /api/memory/config` persists the configuration; "Saving…" → "Saved!" feedback (2.5s); error shown on failure

---

**US-12 — Trigger explore cache aggregation**
> As an administrator, I want to aggregate raw cache entries into consolidated entries.

- **Given** the Config sub-tab is active
- **When** the user clicks "Aggregate now"
- **Then** `POST /api/memory/aggregate-tool-calls` triggers aggregation; success message auto-clears after 4s

---

## 4. Feature Inventory & Acceptance Criteria

### 4.1 Entries Sub-Tab

| Feature | Acceptance Criteria |
|---|---|
| Entry list | Paginated (20 per page); cards with summary, tags, source, date |
| Search | Text search via `q` query parameter |
| Tag filter | Filter by tag via `tag` query parameter |
| Pagination | Previous / Next; "Page X of Y (N entries)" |
| View modal | Full content in `<pre>`; backdrop click to close |
| Delete | Two-step confirm (Delete → Confirm / Cancel) |
| Empty state | "No memory entries found." |

### 4.2 Files Sub-Tab — Observations

| Feature | Acceptance Criteria |
|---|---|
| Level cards | Global (system), Git Remotes, Repositories; file counts; "consolidated" badge |
| File list | Click filename to view content |
| Detail panel | Metadata + `<pre>` content; close (✕) button |
| Refresh | Reloads file list for current level |
| Empty states | Per-section "No git remote observations" / "No repo observations"; "No observation files at this level" |

### 4.3 Files Sub-Tab — Explore Cache

| Feature | Acceptance Criteria |
|---|---|
| Three-level navigation | Global / git-remote / repo with `LevelCard` stats |
| Raw sub-tab | File list → detail with tool name, timestamp, hash, question, answer |
| Consolidated sub-tab | Entry list → detail with question, created, hits, sources, topics, answer |
| Refresh | Refetches raw + consolidated lists |

### 4.4 Config Sub-Tab

| Feature | Acceptance Criteria |
|---|---|
| Settings card | Storage dir, backend select, max entries, TTL, auto-inject, conversation recording |
| Save | "Saving…" → "Saved!" (2.5s) or error |
| Unsaved indicator | "Current saved: …" for storage directory |
| Explore cache card | Stats (raw count, consolidated count, last aggregation); Aggregate now; Refresh |
| Aggregation feedback | Success message auto-clears after 4s |

---

## 5. Behavioral Invariants

| ID | Invariant |
|---|---|
| INV-01 | Entry deletion uses a two-step confirm; single click does not delete |
| INV-02 | Pagination is server-side with a fixed page size of 20 |
| INV-03 | View and delete failures are silently swallowed (no toast) |
| INV-04 | The Files sub-tab toggle between Observations and Explore Cache is local state only |
| INV-05 | Explore cache aggregation may return 503 if the AI invoker is not available |
| INV-06 | Memory levels are: system (global), git-remote (per-remote), repo (per-repository) |

---

## 6. UI Layout Specification

```
┌─────────────────────────────────────────────────────────────────────┐
│  CoC │ Processes │ Wiki │ Memory* │ Skills │ …                      │
├─────────────────────────────────────────────────────────────────────┤
│  [Entries*] [Files] [Config]                                        │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  [🔍 Search entries…]  [Filter by tag…]                            │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │ Authentication patterns learned from code review sessions   │   │
│  │ Tags: [auth] [patterns]  Source: wiki-ask  Created: 2h ago │   │
│  │                                          [View] [Delete]    │   │
│  ├─────────────────────────────────────────────────────────────┤   │
│  │ Database connection pooling best practices                  │   │
│  │ Tags: [database] [perf]  Source: chat  Created: 1d ago     │   │
│  │                                          [View] [Delete]    │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  [← Previous]  Page 1 of 3 (52 entries)  [Next →]                 │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 7. Error Handling Specification

| Error Scenario | Expected Behavior |
|---|---|
| Entry list fetch failure | Error text displayed |
| Entry view failure | Silently swallowed |
| Entry delete failure | Silently swallowed |
| Config save failure | `saveError` text displayed |
| Aggregation failure | Error or 503 message |
| Observation file load failure | Error in detail panel |

---

## 8. Empty State Specification

| State | Display |
|---|---|
| No entries | "No memory entries found." (`data-testid="memory-entries-empty"`) |
| No observation files | "No observation files at this level" |
| No git remote observations | "No git remote observations" |
| No repo observations | "No repo observations" |
| No cache data | Empty lists in Raw/Consolidated sub-tabs |

---

## 9. API Dependencies

| Endpoint | Used by | Critical for |
|---|---|---|
| `GET /api/memory/entries` | Entry list | US-01, US-02 |
| `GET /api/memory/entries/:id` | Entry detail | US-03 |
| `DELETE /api/memory/entries/:id` | Delete entry | US-04 |
| `GET /api/memory/observations/levels` | Level overview | US-05 |
| `GET /api/memory/observations` | File list | US-05 |
| `GET /api/memory/observations/:filename` | File content | US-06 |
| `GET /api/memory/explore-cache/levels` | Cache level overview | US-07 |
| `GET /api/memory/explore-cache/raw` | Raw cache list | US-07, US-08 |
| `GET /api/memory/explore-cache/raw/:filename` | Raw cache detail | US-08 |
| `GET /api/memory/explore-cache/consolidated` | Consolidated list | US-07, US-09 |
| `GET /api/memory/explore-cache/consolidated/:id` | Consolidated detail | US-09 |
| `GET /api/memory/config` | Config load | US-10 |
| `PUT /api/memory/config` | Config save | US-11 |
| `GET /api/memory/aggregate-tool-calls/stats` | Cache stats | US-12 |
| `POST /api/memory/aggregate-tool-calls` | Trigger aggregation | US-12 |

---

## Revision History

| Version | Date | Summary |
|---|---|---|
| 1.0.0 | 2026-03-25 | Initial specification |
