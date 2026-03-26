# Admin Tab — UI/UX Specification

**Document type:** Formal UX Specification  
**Scope:** CoC Dashboard → Admin (Top-Level Tab)  
**Purpose:** Authoritative reference for validating any future UI/UX changes to the Admin tab.  
**Version:** 1.0.0

---

## 1. Overview

The **Admin Tab** is a top-level dashboard tab for server administration. It provides five sub-tabs: Settings (server configuration, display preferences, chat follow-up settings), Providers (GitHub/ADO credential management), Data (export, import, wipe), Server (server info and restart), and Prompts (built-in prompt inspection). A stats bar in the header shows process count, wiki count, and disk usage.

### 1.1 Tab Identity

| Property | Value |
|---|---|
| Tab label | `Admin` |
| Tab position | Top-level tab (lazy-loaded) |
| Default tab | No |
| URL fragment | `#admin` |

---

## 2. User Personas

| Persona | Description | Primary Goal |
|---|---|---|
| **Administrator** | Users managing the CoC server | Configure settings, manage credentials, export/import data |
| **Operator** | Users monitoring server health | View stats, restart server, inspect prompts |
| **Developer** | Engineers debugging AI behavior | Review built-in prompts, adjust display settings |

---

## 3. User Stories

### 3.1 Settings Sub-Tab

**US-01 — View and edit server configuration**
> As an administrator, I want to configure the server's AI settings.

- **Given** the Settings sub-tab is active
- **When** config loads via `GET /api/admin/config`
- **Then** editable fields are shown: model, parallelism, timeout, output format; each with a source badge (default/file/cli/env)

---

**US-02 — Configure display settings**
> As a developer, I want to adjust how AI responses are displayed.

- **Given** the Settings sub-tab is active
- **When** the user toggles "Intent announcements" or changes "Tool call verbosity"
- **Then** `PUT /api/admin/config` saves immediately; on failure, the toggle reverts and a toast is shown

---

**US-03 — Configure chat follow-up suggestions**
> As an administrator, I want to control whether follow-up suggestions appear and how many.

- **Given** the Settings sub-tab is active
- **When** the user toggles the follow-up checkbox or changes the count (1–5)
- **Then** the values are saved with the main Save button (not auto-saved)

---

**US-04 — Save configuration**
> As an administrator, I want to save all configuration changes.

- **Given** settings have been modified
- **When** the user clicks Save
- **Then** validation runs (parallel ≥ 1, timeout integer or empty, valid output format, follow-up count 1–5); `PUT /api/admin/config` persists; toast confirms; config reloads

---

**US-05 — Configure global preferences**
> As an administrator, I want to set the UI theme and sidebar behavior.

- **Given** the Settings sub-tab is active (PreferencesSection)
- **When** the user changes theme (auto/light/dark) or sidebar collapsed state
- **Then** `PATCH /api/preferences` saves immediately; toast on error

---

### 3.2 Providers Sub-Tab

**US-06 — Configure GitHub token**
> As an administrator, I want to set my GitHub personal access token.

- **Given** the Providers sub-tab is active
- **When** the user enters a GitHub PAT and clicks Save
- **Then** `PUT /api/providers/config` with `{ github: { token } }` persists the token

---

**US-07 — Configure ADO credentials**
> As an administrator, I want to set my Azure DevOps organization URL.

- **Given** the Providers sub-tab is active
- **When** the user enters an ADO org URL and clicks Save
- **Then** `PUT /api/providers/config` with `{ ado: { orgUrl } }` persists the URL

---

### 3.3 Data Sub-Tab

**US-08 — Export data**
> As an administrator, I want to export all server data as a JSON file.

- **Given** the Data sub-tab is active
- **When** the user clicks Export
- **Then** `GET /api/admin/export` downloads a JSON blob; filename from `Content-Disposition` or fallback

---

**US-09 — Import data**
> As an administrator, I want to import data from a previously exported file.

- **Given** the Data sub-tab is active
- **When** the user selects a `.json` file and chooses Replace or Merge mode
- **Then** Preview (`POST /api/admin/import/preview`) shows process/workspace/wiki counts
- **When** the user clicks Import
- **Then** `GET /api/admin/import-token` obtains a confirmation token; `POST /api/admin/import?confirm=<token>&mode=<mode>` performs the import

---

**US-10 — Wipe data**
> As an administrator, I want to wipe all server data.

- **Given** the Data sub-tab is active (Danger zone)
- **When** the user checks "Include wikis" (optional) and clicks Preview
- **Then** `GET /api/admin/data/stats?includeWikis=<bool>` shows what will be deleted
- **When** the user clicks "Wipe Data" and confirms
- **Then** `GET /api/admin/data/wipe-token` obtains a token; `DELETE /api/admin/data?confirm=<token>&includeWikis=<bool>` performs the wipe

---

### 3.4 Server Sub-Tab

**US-11 — View server info**
> As an operator, I want to see the server's configuration file path, host, port, and data directory.

- **Given** the Server sub-tab is active
- **When** config is loaded
- **Then** the config file path (if present), host, port, and data directory are displayed

---

**US-12 — Restart the server**
> As an operator, I want to restart the CoC server.

- **Given** the Server sub-tab is active
- **When** the user clicks "Rebuild & Restart"
- **Then** `POST /api/admin/restart` is called; a toast is shown; the UI polls `GET /api/admin/data/stats` every 3s until the server responds; then `window.location.reload()` refreshes the page

---

### 3.5 Prompts Sub-Tab

**US-13 — View built-in prompts**
> As a developer, I want to inspect the built-in AI prompts.

- **Given** the Prompts sub-tab is active
- **When** prompts load via `GET /api/admin/prompts`
- **Then** prompt cards are displayed grouped by category (Pipeline → Memory → UI); each card shows title, source badge (monospace), description, and full text in `<pre>`

---

## 4. Feature Inventory & Acceptance Criteria

### 4.1 Header

| Feature | Acceptance Criteria |
|---|---|
| Title | "Admin" |
| Stats bar | Process count, wiki count, disk usage (`formatBytes`); spinner while loading; refresh button |

### 4.2 Sub-Tab Navigation

| Feature | Acceptance Criteria |
|---|---|
| Desktop | Underline-style tabs: Settings, Providers, Data, Server, Prompts |
| Mobile | `<select>` dropdown for same tabs |

### 4.3 Settings Sub-Tab

| Feature | Acceptance Criteria |
|---|---|
| Config fields | Model, parallelism, timeout, output format; each with source badge |
| Advanced section | Collapsible; read-only: approve permissions, MCP config, persist |
| Display toggles | Intent announcements (immediate save); tool verbosity segmented control (Full/Compact/Minimal, immediate save) |
| Chat settings | Follow-up enabled checkbox + count (1–5); saved with main Save |
| Preferences | Theme (auto/light/dark); sidebar collapsed; immediate save |
| Save button | Validates and persists all non-auto-saved fields |

### 4.4 Providers Sub-Tab

| Feature | Acceptance Criteria |
|---|---|
| GitHub | PAT input with show/hide; Save; note when token already saved |
| ADO | Org URL input; Save; note about `az account get-access-token` |
| Storage note | "Token stored in `~/.coc/providers.json`" |

### 4.5 Data Sub-Tab

| Feature | Acceptance Criteria |
|---|---|
| Export | Download JSON blob; status text during download |
| Import | File input (.json); Replace/Merge mode; Preview → Import flow with token confirmation |
| Wipe | "Include wikis" checkbox; Preview → Wipe flow with token confirmation; Danger zone styling |

### 4.6 Server Sub-Tab

| Feature | Acceptance Criteria |
|---|---|
| Server info | Config file path, host, port, data directory |
| Restart | Toast → poll every 3s → page reload on success |

### 4.7 Prompts Sub-Tab

| Feature | Acceptance Criteria |
|---|---|
| Prompt cards | Grouped by category (Pipeline, Memory, UI); title, source badge, description, full text |
| Loading | Spinner + "Loading…" |

---

## 5. Behavioral Invariants

| ID | Invariant |
|---|---|
| INV-01 | Display toggle changes (intent, verbosity) save immediately via PUT; they do not wait for the Save button |
| INV-02 | Display toggles revert on failed PUT |
| INV-03 | Chat follow-up settings are saved only via the main Save button, not auto-saved |
| INV-04 | Export and import use time-limited crypto tokens for confirmation |
| INV-05 | Wipe data uses a separate token from import |
| INV-06 | Server restart calls `process.exit(restartExitCode)` on the server; the UI must poll until the server is back |
| INV-07 | Prompts are grouped in the order: Pipeline → Memory → UI |
| INV-08 | The Admin tab is lazy-loaded from `Router.tsx` |

---

## 6. UI Layout Specification

```
┌─────────────────────────────────────────────────────────────────────┐
│  CoC │ Processes │ Wiki │ Memory │ Skills │ … │ Admin*               │
├─────────────────────────────────────────────────────────────────────┤
│  Admin    Processes: 142  Wikis: 3  Disk: 45.2 MB         [↻]     │
│  [Settings*] [Providers] [Data] [Server] [Prompts]                  │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  Server Configuration                                              │
│  ─────────────────────────────────────                             │
│                                                                     │
│  Model:        [gpt-4o          ]  [file]                          │
│  Parallelism:  [5               ]  [default]                       │
│  Timeout (s):  [1800            ]  [default]                       │
│  Output:       [table ▼         ]  [default]                       │
│                                                                     │
│  ▶ Advanced (read-only)                                            │
│                                                                     │
│  Display                                                           │
│  ─────────────────────────────────────                             │
│  Intent announcements:  [🔘 On]                                    │
│  Tool call verbosity:   [Full | Compact | Minimal]                 │
│                                                                     │
│  Chat                                                              │
│  ─────────────────────────────────────                             │
│  [☑] Enable follow-up suggestions   Count: [3]                    │
│                                                                     │
│  Preferences                                                       │
│  ─────────────────────────────────────                             │
│  Theme: [auto ▼]   [☐] Collapse repos sidebar                     │
│                                                                     │
│                                                    [Save]          │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 7. Error Handling Specification

| Error Scenario | Expected Behavior |
|---|---|
| Config load failure | Red error text (`configError`) in Settings card |
| Config save validation failure | Inline validation errors |
| Config save API failure | Toast notification |
| Display toggle save failure | Revert toggle state; toast |
| Preferences save failure | Toast notification |
| Provider save failure | Error in provider section |
| Export failure | Status text with error |
| Import preview failure | Error message in preview area |
| Import failure | Error message in import area |
| Wipe failure | Error message in danger zone |
| Restart failure | Toast; polling continues |
| Prompts load failure | Toast via `onError` (panel may show empty groups) |

---

## 8. Empty State Specification

| State | Display |
|---|---|
| Stats loading | Spinner in header |
| Prompts loading | Spinner + "Loading…" |
| No prompts | Empty grouped sections |
| Import preview pending | Preview area empty until file selected |

---

## 9. API Dependencies

| Endpoint | Used by | Critical for |
|---|---|---|
| `GET /api/admin/data/stats` | Header stats, wipe preview, restart poll | Header, US-10, US-12 |
| `GET /api/admin/config` | Settings load | US-01 |
| `PUT /api/admin/config` | Settings save, display toggles | US-02, US-03, US-04 |
| `GET /api/preferences` | Preferences load | US-05 |
| `PATCH /api/preferences` | Preferences save | US-05 |
| `GET /api/providers/config` | Provider status | US-06, US-07 |
| `PUT /api/providers/config` | Provider save | US-06, US-07 |
| `GET /api/admin/export` | Data export | US-08 |
| `POST /api/admin/import/preview` | Import preview | US-09 |
| `GET /api/admin/import-token` | Import token | US-09 |
| `POST /api/admin/import` | Import data | US-09 |
| `GET /api/admin/data/wipe-token` | Wipe token | US-10 |
| `DELETE /api/admin/data` | Wipe data | US-10 |
| `POST /api/admin/restart` | Server restart | US-12 |
| `GET /api/admin/prompts` | Prompt list | US-13 |

---

## Revision History

| Version | Date | Summary |
|---|---|---|
| 1.0.0 | 2026-03-25 | Initial specification |
