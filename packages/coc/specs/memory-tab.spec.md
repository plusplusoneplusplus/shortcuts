# Memory Tab — UI/UX Specification

**Document type:** Formal UX Specification  
**Scope:** CoC Dashboard → Memory (Embedded in Admin Shell · Knowledge Group)  
**Purpose:** Authoritative reference for validating any future UI/UX changes to the Memory tab.  
**Version:** 2.0.0

---

## 1. Overview

The **Memory route** renders the **Memory V2 Workbench** for managing long-term AI memory. It is reached at the top-level URL `#memory` but is rendered embedded inside the Admin shell's left sidebar **Knowledge** group — `MemoryV2Panel` is mounted in the right pane while the admin sidebar stays visible.

The workbench exposes per-scope facts, a review queue for low-confidence auto-extracted facts, a read-only episode log, and per-scope settings. Scopes include the **global** memory store plus one entry per registered **workspace**.

The legacy entries/files/config layout (raw observation files, explore-cache aggregation, three-level navigation) has been removed. There is no observation-file browser and no tool-call/explore-cache UI in the V2 workbench.

### 1.1 Tab Identity

| Property | Value |
|---|---|
| Route label | `Memory` |
| Sidebar group | `Knowledge` (inside `AdminPanel`) |
| Default tab | No |
| URL fragment | `#memory` |
| Deep-link URL | `#memory/<subTab>` where `<subTab>` ∈ `facts` \| `review` \| `episodes` \| `settings` |
| Embedded view | `MemoryV2Panel` (`features/memory/MemoryV2Panel.tsx`) |
| Panel root id | `view-memory` |

---

## 2. User Personas

| Persona | Description | Primary Goal |
|---|---|---|
| **AI operator** | Engineers managing the assistant's long-term memory | Browse, search, edit, archive facts |
| **Reviewer** | Users curating the auto-extracted review queue | Approve, edit-and-approve, or reject low-confidence facts |
| **Debugger** | Users tracing where facts came from | Inspect episodes, jump into source processes/Ralph runs |
| **Administrator** | Users managing scope availability and bulk data | Enable/disable scopes, export JSON, wipe a scope |

---

## 3. User Stories

### 3.1 Scope Selection

**US-01 — Choose a memory scope**
> As an AI operator, I want to switch between the global scope and any registered workspace scope.

- **Given** the Memory route is open
- **When** scopes load via `GET /api/memory/v2/scopes`
- **Then** a 200 px left rail lists scope rows: `Global` first, then each workspace; the active scope is highlighted; rows show a leading `Scopes` heading
- **And** a row with pending review items shows an amber count badge (e.g. `3`)
- **And** a row with a disabled scope shows an `off` indicator

---

**US-02 — Enable a disabled scope**
> As an administrator, I want to opt a scope into Memory V2.

- **Given** the selected scope's `enabled` flag is `false`
- **When** the right pane shows the disabled-state CTA
- **Then** clicking **Enable Memory** calls `PATCH /api/preferences` (global) or `PATCH /api/workspaces/<wsId>/preferences` with `{ memoryV2: { enabled: true } }`
- **And** the scope list refreshes; tab content becomes available

---

### 3.2 Facts Sub-Tab

**US-03 — Browse facts**
> As an AI operator, I want to browse stored facts for the active scope.

- **Given** the Facts tab is active
- **When** facts load via `GET /api/workspaces/<wsId>/memory/v2/facts?limit=100`
- **Then** a vertical list of fact cards is rendered with content, tag chips, an importance badge (low / medium / high), source label, optional `proc:<id>` link, relative timestamp, and recall count when > 0
- **And** the global scope uses `wsId="global"` for all routes

---

**US-04 — Search and filter facts**
> As an AI operator, I want to find facts by text and status.

- **Given** the Facts tab is active
- **When** the user types in the search input
- **Then** after a 350 ms debounce, `GET …/facts?q=<query>&status=<status>&limit=100` is refetched
- **And** the status `<select>` offers `All statuses`, `Active` (default), `Archived`, `Rejected`

---

**US-05 — View long-content fact**
> As a debugger, I want to read the full text of a long fact.

- **Given** a fact's content is longer than 180 characters
- **When** the user clicks `more`
- **Then** the card expands inline; `less` collapses it again

---

**US-06 — Add a fact**
> As an AI operator, I want to capture a fact manually.

- **Given** the Facts tab is active
- **When** the user clicks **+ Add**
- **Then** an inline form appears with a content textarea and an optional comma-separated tags input
- **And** clicking **Add Fact** calls `POST …/facts` and prepends the new fact to the list

---

**US-07 — Edit a fact**
> As an AI operator, I want to refine a fact's text, tags, or importance.

- **Given** a fact is listed
- **When** the user clicks **Edit**
- **Then** a modal opens with content textarea, tags input, and an importance slider (0.00–1.00)
- **And** clicking **Save** calls `PATCH …/facts/<id>`; the modal closes and the card re-renders with the update

---

**US-08 — Archive a fact**
> As an AI operator, I want to retire a fact without deleting it.

- **Given** a fact is listed
- **When** the user clicks **Archive**
- **Then** `PATCH …/facts/<id>` with `{ status: 'archived' }` updates the fact in place

---

**US-09 — Delete a fact (two-step)**
> As an administrator, I want to permanently remove a fact.

- **Given** a fact is listed
- **When** the user clicks **Delete**, the card flips to a red confirmation panel showing the first 80 characters of content
- **When** the user clicks **Delete** again
- **Then** `DELETE …/facts/<id>` removes the fact; **Cancel** dismisses the confirmation

---

**US-10 — Jump to source process**
> As a debugger, I want to open the originating chat for a fact.

- **Given** a fact has a `sourceProcessId`
- **When** the user clicks the `proc:<id>` button
- **Then** the dashboard switches to the Processes tab and selects that process

---

### 3.3 Review Sub-Tab

**US-11 — Inspect the review queue**
> As a reviewer, I want to see auto-extracted facts that need a decision.

- **Given** the Review tab is active
- **When** the queue loads via `GET …/v2/review`
- **Then** each item is shown in an amber card with content, tag chips, confidence percentage, source, and optional `proc:<id>` reference
- **And** the header shows `<n> items need review` (or `Loading…`)

---

**US-12 — Approve, edit-and-approve, or reject**
> As a reviewer, I want to act on each item explicitly.

- **Given** a review item is shown
- **When** the user clicks **Approve** → `POST …/v2/review/<id>/approve`
- **When** the user clicks **Edit**, types new content, then **Approve edited** → `POST …/v2/review/<id>/approve` with `{ content: editedContent }`
- **When** the user clicks **Reject** → `POST …/v2/review/<id>/reject`
- **Then** in all cases the item is removed from the review queue

---

**US-13 — Empty review queue**
> As a reviewer, I want positive feedback when the queue is clear.

- **Given** there are no items in the queue
- **Then** a green check message reads `✓ Review queue is empty` with a hint about auto-extraction

---

### 3.4 Episodes Sub-Tab

**US-14 — Browse episodes**
> As a debugger, I want a chronological log of session/turn summaries.

- **Given** the Episodes tab is active
- **When** episodes load via `GET …/v2/episodes?limit=100`
- **Then** rows show summary text plus a colored event-type badge (`Chat` / `Ralph` / `Notes` / `Commit`), optional `turn N` / `iter N`, relative timestamp, optional `proc:<id>` and `ralph:<id>` chips
- **And** the header shows `<n> episodes` and a `↻ Refresh` link

---

**US-15 — Jump from episode to process**
> As a debugger, I want to follow an episode back to its process.

- **Given** an episode has a `processId`
- **When** the user clicks the `proc:<id>` link
- **Then** the dashboard switches to the Processes tab and selects that process

---

### 3.5 Settings Sub-Tab

**US-16 — Toggle Memory V2 for the active scope**
> As an administrator, I want to enable or disable memory for the active scope.

- **Given** the Settings tab is active
- **When** the user clicks **Enable** / **Disable**
- **Then** for the global scope `PATCH /api/preferences` is called with `{ memoryV2: { enabled } }`; for a workspace scope `PATCH /api/workspaces/<wsId>/preferences` is called
- **And** the scope row in the sidebar refreshes its state

---

**US-17 — Export scope data**
> As an administrator, I want a JSON dump of facts and episodes for the active scope.

- **Given** the Settings tab is active
- **When** the user clicks **↓ Export JSON**
- **Then** `GET …/v2/export` is called and the response is downloaded as `coc-memory-<wsId>-YYYY-MM-DD.json`

---

**US-18 — Wipe the active scope**
> As an administrator, I want to permanently delete a scope's facts and episodes.

- **Given** the Settings tab is active
- **When** the user clicks **🗑 Wipe memory…** in the Danger zone
- **Then** a modal warns "This will permanently delete all facts and episodes from <scope>"
- **When** the user clicks **Wipe all memory**
- **Then** `DELETE …/v2/wipe` is called with `{ confirm: true }`; on success the modal closes and tab content refreshes

---

## 4. Feature Inventory & Acceptance Criteria

### 4.1 Two-Column Layout

| Feature | Acceptance Criteria |
|---|---|
| Scope sidebar (left) | 200 px fixed width; `data-testid="scope-sidebar"`; rows use `data-testid="scope-row"` and `data-scope-id` |
| Header (right top) | Scope label + colored type badge: Global=blue, Workspace=purple |
| Tab bar | Underline-style buttons: `Facts`, `Review` (with optional amber count), `Episodes`, `Settings`; selected tab uses `#0078d4` accent |
| Disabled-state CTA | When `scope.enabled === false`, replaces tab content with an Enable Memory button (`data-testid="enable-scope-btn"`) |
| Empty scope list | "No memory scopes available. Register a workspace to get started." |

### 4.2 Facts Tab

| Feature | Acceptance Criteria |
|---|---|
| Toolbar | Search input (`facts-search`), status filter (`facts-status-filter`), `+ Add` button, `↻` refresh |
| Search debounce | 350 ms |
| Default status filter | `active` |
| Fact card | Content with `more`/`less` toggle past 180 chars; tag chips; importance badge (`low` < 0.5 ≤ `medium` < 0.8 ≤ `high`); source label; `proc:<id>` button when `sourceProcessId` is set; relative timestamp (`just now` / `<n>m ago` / `<n>h ago` / `<n>d ago`); recall count when > 0 |
| Actions | `Edit`, `Archive`, `Delete` (red) |
| Edit modal | Content textarea, comma-separated tags, importance range slider 0–1 step 0.05, Save / Cancel |
| Add form | Inline blue-bordered card with content + tags + Add Fact / Cancel |
| Two-step delete | Card flips to red confirmation panel showing first 80 chars; Delete or Cancel |
| Empty state | `data-testid="facts-empty"` — "No facts found." plus "Click + Add to create your first fact." when add form is hidden |

### 4.3 Review Tab

| Feature | Acceptance Criteria |
|---|---|
| Header | "<n> items need review" / "Loading…" + `↻` refresh |
| Review item | Amber-bordered card with content, tag chips, "confidence: P% · source: S · proc:<id>" meta |
| Actions | `Approve`, `Edit` → `Approve edited` / Cancel, `Reject` (red) |
| Empty state | Green ✓ message: "Review queue is empty" |

### 4.4 Episodes Tab

| Feature | Acceptance Criteria |
|---|---|
| Header | "<n> episodes" + `↻ Refresh` link |
| Episode row | Summary text; event-type badge with color (`chat-turn` blue, `ralph-iteration` purple, `note-session` green, `commit-chat` orange); optional `turn N` / `iter N`; relative timestamp; optional `proc:<id>` button (clickable) and `ralph:<id>` chip (read-only) |
| Empty state | "No episodes yet." + auto-extraction hint |
| Read-only | No edit / delete actions |

### 4.5 Settings Tab

| Feature | Acceptance Criteria |
|---|---|
| Memory V2 section | Enabled/Disabled label + toggle button; explanatory text differs by scope type |
| Data section | `↓ Export JSON` downloads `coc-memory-<wsId>-YYYY-MM-DD.json` |
| Danger zone | `🗑 Wipe memory…` opens confirmation modal; modal explains the permanence and requires explicit confirm; cannot be undone |

---

## 5. Behavioral Invariants

| ID | Invariant |
|---|---|
| INV-01 | The Memory route renders inside `AdminPanel`'s right pane; the admin sidebar (Configure / Knowledge / Connections / Operations / Developer) remains mounted |
| INV-02 | All workspace-scoped endpoints are under `/api/workspaces/<wsId>/memory/v2/*`; the global scope uses `wsId="global"` |
| INV-03 | The scope-listing endpoint is `GET /api/memory/v2/scopes`, separate from the per-scope routes |
| INV-04 | Scope enable/disable goes through preferences (`PATCH /api/preferences` for global, `PATCH /api/workspaces/<wsId>/preferences` for workspace), not a memory-specific endpoint |
| INV-05 | Fact deletion is a two-step inline confirmation in the same card (no modal) |
| INV-06 | Wipe is a modal with explicit "Wipe all memory" button and a permanence warning |
| INV-07 | Switching scope in the sidebar resets the active tab to `Facts` and bumps a `contentVersion` so child tabs remount |
| INV-08 | Episodes are read-only; only the Facts and Review tabs allow mutation |
| INV-09 | The fact's `proc:<id>` and the episode's `proc:<id>` both navigate to the Processes tab and select the process |
| INV-10 | Status filter values are `'' \| 'active' \| 'archived' \| 'rejected'`; the default is `'active'` |
| INV-11 | The legacy V1 entries / observation-files / explore-cache UI is removed; there is no fallback when a scope is disabled — only the Enable CTA |

---

## 6. UI Layout Specification

```
┌────────────────────────────────────────────────────────────────────────────────┐
│ AdminPanel (admin-redesign.css)                                                │
│ ┌──────────────┐  ┌──────────────────────────────────────────────────────────┐ │
│ │ Sidebar      │  │ MemoryV2Panel  (id="view-memory")                        │ │
│ │ Configure    │  │ ┌─────────┐ ┌──────────────────────────────────────────┐ │ │
│ │ Knowledge    │  │ │ Scopes  │ │ Global  [Global]                         │ │ │
│ │  • Memory*   │  │ │─────────│ │ ─────────────────────────────────────────│ │ │
│ │  • Skills    │  │ │ Global  │ │ [Facts*] [Review 3] [Episodes] [Settings]│ │ │
│ │ Connections  │  │ │ repoA 3 │ │ ─────────────────────────────────────────│ │ │
│ │ Operations   │  │ │ repoB   │ │ [Search facts…] [active ▾] [+ Add] [↻]   │ │ │
│ │ Developer    │  │ │  off    │ │ ┌──────────────────────────────────────┐ │ │ │
│ │              │  │ │         │ │ │ Fact content … [more]                │ │ │ │
│ │              │  │ │         │ │ │ [auth] [patterns]                    │ │ │ │
│ │              │  │ │         │ │ │ medium · chat · proc:abcd1234 · 2h…  │ │ │ │
│ │              │  │ │         │ │ │ [Edit] [Archive] [Delete]            │ │ │ │
│ │              │  │ │         │ │ └──────────────────────────────────────┘ │ │ │
│ └──────────────┘  │ └─────────┘ └──────────────────────────────────────────┘ │ │
│                   └──────────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────────────────────────┘
```

---

## 7. Error Handling Specification

| Error Scenario | Expected Behavior |
|---|---|
| Scope listing fails | Inline red message + `Retry` button (`data-testid="scopes-error"`) |
| Facts list fails | Inline red message (`data-testid="facts-error"`) |
| Fact create / update fails | Inline red text inside the form/modal; submit button stays enabled |
| Fact delete fails | Inline red message in the parent panel; confirmation row is dismissed |
| Review approve / reject fails | Inline red message inside the review card; actions remain available |
| Episodes list fails | Inline red message (`data-testid="episodes-error"`) |
| Toggle enable/disable fails | Inline red message under the toggle button |
| Export fails | Inline red message under the Export button |
| Wipe fails | Inline red message inside the Wipe modal; modal stays open |

---

## 8. Empty State Specification

| State | Display |
|---|---|
| No registered scopes | "No memory scopes available. Register a workspace to get started." (`data-testid="no-scopes-msg"`) |
| Scope disabled | "Memory V2 is not enabled for <scope>." + `Enable Memory` CTA (`data-testid="scope-disabled"`) |
| No facts | "No facts found." (`data-testid="facts-empty"`) plus add hint when add form hidden |
| Empty review queue | "✓ Review queue is empty" with auto-extraction hint (`data-testid="review-empty"`) |
| No episodes | "No episodes yet." (`data-testid="episodes-empty"`) |

---

## 9. API Dependencies

All routes under `/api/...`. Workspace-scoped routes use `wsId="global"` for the global scope.

| Endpoint | Used by | Critical for |
|---|---|---|
| `GET /memory/v2/scopes` | Scope sidebar | US-01 |
| `PATCH /preferences` (global) / `PATCH /workspaces/:wsId/preferences` | Enable/disable scope | US-02, US-16 |
| `GET /workspaces/:wsId/memory/v2/facts?q=&status=&limit=` | Facts list, search, filter | US-03, US-04 |
| `POST /workspaces/:wsId/memory/v2/facts` | Add fact | US-06 |
| `PATCH /workspaces/:wsId/memory/v2/facts/:factId` | Edit / archive | US-07, US-08 |
| `DELETE /workspaces/:wsId/memory/v2/facts/:factId` | Delete | US-09 |
| `GET /workspaces/:wsId/memory/v2/review` | Review queue | US-11 |
| `POST /workspaces/:wsId/memory/v2/review/:factId/approve` | Approve / edit-and-approve | US-12 |
| `POST /workspaces/:wsId/memory/v2/review/:factId/reject` | Reject | US-12 |
| `GET /workspaces/:wsId/memory/v2/episodes?limit=` | Episodes list | US-14 |
| `GET /workspaces/:wsId/memory/v2/export` | Export JSON | US-17 |
| `DELETE /workspaces/:wsId/memory/v2/wipe` (body `{ confirm: true }`) | Wipe scope | US-18 |

---

## Revision History

| Version | Date | Summary |
|---|---|---|
| 1.0.0 | 2026-03-25 | Initial specification (V1: Entries / Files / Config sub-tabs) |
| 2.0.0 | 2026-05-29 | Rewrite for Memory V2 Workbench: scope sidebar (Global + workspaces), four sub-tabs (Facts / Review / Episodes / Settings), embedded inside Admin shell's Knowledge group. Removed legacy observation-files browser, explore-cache aggregation, and V1 entry pagination. Updated all API paths to `/api/workspaces/:wsId/memory/v2/*` and `/api/memory/v2/scopes`. |
