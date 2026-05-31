# Admin Tab — UI/UX Specification

**Document type:** Formal UX Specification  
**Scope:** CoC Dashboard → Admin (Top-Level Tab + Sidebar Shell)  
**Purpose:** Authoritative reference for validating any future UI/UX changes to the Admin shell, its sub-tabs, and the embedded tool views it hosts.  
**Version:** 2.0.0

---

## 1. Overview

The **Admin shell** is a top-level dashboard tab implementing a Linear-inspired left-sidebar layout (`admin-redesign.css`, scoped under `.admin-redesign`). It owns server administration screens **and** hosts every embedded tool view (Memory, Skills, Logs, Usage & Costs, Servers) so the sidebar stays mounted across navigation.

The sidebar is grouped by user task: **Configure**, **Knowledge**, **Connections** (container-only), **Operations**, **Developer / Internals**. Each row dispatches `SET_ADMIN_SUB_TAB` (admin pages), `SET_ACTIVE_TAB` (tool routes), or `SET_ACTIVE_TAB`+settings sub-tab change (the Configure / Advanced rows). When a tool route is active (`activeTab` ∈ {memory, skills, logs, stats, servers}), the right pane mounts the corresponding view inside `.ar-tool-embed`; otherwise it renders the standard admin card grid.

### 1.1 Tab Identity

| Property | Value |
|---|---|
| Tab label | `Admin` |
| Tab position | Top-level tab (lazy-loaded) |
| Default tab | No |
| URL fragment | `#admin` |
| Sub-tab deep-links | `#admin/<subTab>` where `<subTab>` ∈ `settings`, `providers`, `data`, `server`, `prompts`, `database`, `agents`, `messaging` |
| Settings deep-links | `#admin/settings/<sub>` where `<sub>` ∈ `ai` (default), `chat`, `appearance`, `features`, `integrations`, `advanced` |
| Database deep-link | `#admin/database/<table>?page=N&sort=col&order=asc\|desc` |
| Embedded tool routes | `#memory`, `#skills`, `#logs`, `#stats`, `#servers` (each renders inside the admin shell) |

### 1.2 Admin Sub-Tabs (`AdminSubTab`)

| Sub-Tab | Sidebar Group | Sidebar Label | Container Behavior |
|---|---|---|---|
| `settings` (Configure / Advanced) | Configure / Developer | "Configure" / "Advanced" | Always shown |
| `agents` | Configure (or Connections in container) | "AI Provider" / "Agents" | Label flips to "Agents" when `isContainerMode()` is true; placement moves to Connections in container mode |
| `providers` | Configure | "Providers" | Always shown |
| `messaging` | Connections | "Messaging" | Container-only (`isContainerMode()`) |
| `data` | Operations | "Backup & Reset" | Always shown |
| `server` | Operations | "Server" | Always shown |
| `prompts` | Developer / Internals | "System Prompts" | Always shown |
| `database` | Developer / Internals | "Database Browser" | Always shown |

Tool routes (separate `DashboardTab`s) sharing the admin shell: `memory`, `skills`, `logs`, `stats`, `servers`. Servers row is shown only when `isServersEnabled()` is true.

### 1.3 Settings Internal Sub-Tabs (`SettingsSubTab`)

| Sub | Label | Description |
|---|---|---|
| `ai` (default) | AI & Execution | Default model, parallelism, timeout, output format |
| `chat` | Chat | Conversation behavior and follow-up suggestions, ask-user, intent announcements, tool verbosity |
| `appearance` | Appearance | Theme, layout density, navigation, prompt autocomplete preferences |
| `features` | Features | Enable/disable optional workspace and dashboard features |
| `integrations` | Integrations | Desktop link handlers and notes-sync git remote |
| `advanced` | Advanced | Read-only diagnostics + recovery actions; surfaced in Developer / Internals group |

---

## 2. User Personas

| Persona | Description | Primary Goal |
|---|---|---|
| **Administrator** | Users managing the CoC server | Configure AI defaults, manage credentials, export/import, restart |
| **Operator** | Users monitoring server health and operating the queue | View stats in sidebar, restart, browse logs and usage |
| **Developer** | Engineers debugging AI behavior | Inspect system prompts, browse SQLite tables, tweak feature flags |
| **Power user** | Container or advanced users | Manage messaging integrations, AI provider quota, agent/SDK installs |

---

## 3. User Stories

### 3.1 Shell & Navigation

**US-01 — Switch admin sections via the sidebar**
> As an administrator, I want a single mounted shell that lets me jump between admin pages and tool views without losing the sidebar.

- **Given** the Admin shell is open
- **When** the user clicks any nav row (admin sub-tab, settings sub-section, or tool tab)
- **Then** the shell dispatches the appropriate action (`SET_ADMIN_SUB_TAB`, settings sub-tab change, or `SET_ACTIVE_TAB` for tool routes), updates `location.hash`, updates the breadcrumb (`<Group> / <Label>`), and replaces only the right-pane content
- **And** the sidebar groups, brand, and Usage block stay mounted

---

**US-02 — Breadcrumb reflects the active section**
> As a user, I want a clear "where am I" indicator.

- **Given** an admin page is active → breadcrumb reads `<group> / <tab label>` (e.g. `Configure / AI & Execution`)
- **Given** a tool route is active → breadcrumb reads `<TOOL_TAB_GROUP_LABELS group> / <tool label>` (e.g. `Knowledge / Memory`)
- **And** the mobile `<select>` dropdown lists every nav item grouped by `<optgroup>`

---

**US-03 — Display sidebar usage stats**
> As an operator, I want quick numbers without leaving the current page.

- **Given** the Admin shell is open
- **When** stats load via `GET /api/admin/data/stats?includeWikis=true`
- **Then** the sidebar foot shows `Processes`, `Wikis`, `Disk` (`formatBytes`), with a refresh button (`#admin-refresh-stats`)
- **And** while loading, a small spinner replaces the rows

---

### 3.2 Settings Sub-Tab — AI & Execution

**US-04 — Edit AI execution defaults**
> As an administrator, I want to tune model, parallelism, timeout, and output.

- **Given** Settings → AI & Execution is active (deep-link `#admin/settings/ai` or `#admin/settings`)
- **When** the user edits any field in `SettingsCard`
- **Then** the card becomes dirty (`Save` enabled, `Cancel` shown)
- **When** the user clicks Save
- **Then** validation runs: parallel ≥ 1 integer, timeout positive integer or empty (treated as `null`), output ∈ {table, json, csv, markdown}
- **And** `PUT /api/admin/config` persists `{ model, parallel, timeout, output }`; on success a toast confirms; on error a toast shows the message; the snapshot is updated only on success

---

### 3.3 Settings Sub-Tab — Chat Experience

**US-05 — Configure chat behavior**
> As an administrator, I want to control follow-up suggestions, ask-user, intent announcements, and tool verbosity.

- **Given** Settings → Chat is active
- **When** the user edits any field
- **Then** the card becomes dirty; clicking Save validates `chat.followUpSuggestions.count` is an integer 1–5 and persists:
  - `chat.followUpSuggestions.enabled`
  - `chat.followUpSuggestions.count`
  - `chat.askUser.enabled`
  - `showReportIntent`
  - `toolCompactness` ∈ {0=Full, 1=Compact, 2=Minimal, 3=Whisper}
- **And** display caches are invalidated (`invalidateDisplaySettings()`)

---

### 3.4 Settings Sub-Tab — Appearance & Navigation

**US-06 — Configure UI appearance**
> As an administrator, I want to set theme, layout mode, and density preferences.

- **Given** Settings → Appearance is active
- **When** the user edits theme / repos sidebar collapsed / UI layout mode (`classic` \| `dev-workflow`) / HTML embed / prompt autocomplete (and AI sub-toggle) / task card density / history grouping
- **Then** prefs saves go through `PATCH /api/preferences` and config-only fields go through `PUT /api/admin/config`
- **And** display + html-embed caches are invalidated

---

### 3.5 Settings Sub-Tab — Features

**US-07 — Toggle workspace/dashboard features**
> As an administrator, I want to enable or disable optional features.

- **Given** Settings → Features is active
- **When** the user toggles feature flags
- **Then** clicking Save calls `PUT /api/admin/config` with the flat namespaced keys (e.g. `terminal.enabled`, `notes.enabled`, `myWork.enabled`, `myLife.enabled`, `scratchpad.enabled`, `scratchpad.layout`, `workflows.enabled`, `pullRequests.enabled`, `pullRequests.suggestions`, `servers.enabled`, `ralph.enabled`, `vimNavigation.enabled`, `loops.enabled`, `excalidraw.enabled`, `mcpOauth.enabled`, `features.focusedDiff`, `workItems.hierarchy.enabled`)
- **And** the toggle list reflects the namespaced config registry (see `src/config/namespace-registry.ts`)

---

### 3.6 Settings Sub-Tab — Integrations

**US-08 — Configure desktop link handlers**
> As an administrator, I want CoC to register URL handlers (e.g. `vscode://`).

- **Given** Settings → Integrations is active
- **When** the user toggles a handler
- **Then** the change persists via the `useLinkHandlers` hook
- **And** handler metadata (`getLinkHandlersMeta`) drives the available rows

**US-09 — Configure notes git sync**
> As an administrator, I want to back notes with a git remote.

- **Given** Settings → Integrations is active
- **When** the user enters `sync.gitRemote` and `sync.intervalMinutes`
- **Then** clicking Save persists via `PUT /api/admin/config`

---

### 3.7 Settings Sub-Tab — Advanced

**US-10 — Inspect read-only config and recovery actions**
> As a developer, I want to see resolved config sources and run rare recovery actions.

- **Given** Settings → Advanced is active (sidebar Developer / Internals)
- **Then** the page lists read-only fields (approve permissions, MCP config, persist), config source badges (default/file/cli/env), and "Relaunch welcome tour" button
- **When** the user clicks "Relaunch welcome tour"
- **Then** `PATCH /api/preferences` resets `hasSeenWelcome`, `onboardingProgress`, `dismissedTips`; toast confirms

---

### 3.8 AI Provider (Agents) Sub-Tab

**US-11 — Choose default agent provider and install optional SDKs**
> As an administrator, I want to choose between Copilot, Codex, or Claude and install missing SDKs.

- **Given** the AI Provider tab is active (deep-link `#admin/agents`)
- **Then** the page shows the Default Provider control (Copilot, Codex, Claude), per-provider availability, and an install badge (`Not Installed` / `Installing…` / `Installed` / `Install Failed`)
- **When** the user clicks Install on Codex / Claude
- **Then** `POST /api/agent-providers/<id>/install` starts the npm install; the page polls `GET /api/agent-providers/<id>/install-status` every 2 s until the status resolves; the providers list reloads
- **When** the user changes the default provider or `codex.enabled` / `claude.enabled`
- **Then** clicking Save calls `PUT /api/admin/config` with `defaultProvider`, `codex.enabled`, `claude.enabled` and shows a "restart required" toast
- **And** below the default-provider card the page embeds `ProviderModelsSection` for the selected provider's catalog

**US-12 — View provider quota**
> As an administrator, I want to see remaining quota for the active provider.

- **Given** the AI Provider tab is active
- **When** the user clicks Refresh on the Quota card
- **Then** `GET /api/admin/agent-providers/quota` returns the live data; failure shows an inline error

**US-13 — Container Agents view**
> As a container operator, I want to see and manage agents connected to this container.

- **Given** `isContainerMode()` is true and the Agents tab is active (Connections group)
- **Then** the embedded `ConnectedAgentsPanel` lists connected agents; the AI Provider sub-tab still renders the model catalog separately

---

### 3.9 Providers Sub-Tab

**US-14 — Configure GitHub token**
> As an administrator, I want to set my GitHub PAT.

- **Given** Providers is active (`#admin/providers`)
- **When** the user enters a GitHub PAT and clicks Save in `ProviderTokensSection`
- **Then** `PUT /api/providers/config` persists `{ github: { token } }`

**US-15 — Configure ADO credentials**
> As an administrator, I want to set my ADO organization URL.

- **Given** Providers is active
- **When** the user enters an ADO org URL and clicks Save
- **Then** `PUT /api/providers/config` persists `{ ado: { orgUrl } }`
- **And** an inline note explains that ADO token auth uses `az account get-access-token`
- **And** the panel notes: "Token stored in `~/.coc/providers.json`"

---

### 3.10 Messaging Sub-Tab (Container Only)

**US-16 — Configure container messaging**
> As a container operator, I want to manage WhatsApp / messaging integrations.

- **Given** `isContainerMode()` is true and Messaging is active (`#admin/messaging`)
- **Then** the embedded `IMSettingsSection` renders messaging config and onboarding steps

---

### 3.11 Backup & Reset (Data) Sub-Tab

**US-17 — Export data**
> As an administrator, I want to export all server data as JSON.

- **Given** Backup & Reset is active (`#admin/data`)
- **When** the user clicks Export in `StorageSection`
- **Then** `GET /api/admin/export` is called; the file is downloaded using `Content-Disposition` filename or `coc-export-<iso>.json`

**US-18 — Import data**
> As an administrator, I want to merge or replace data from a backup.

- **Given** Backup & Reset is active
- **When** the user picks a `.json` file and clicks Preview
- **Then** `POST /api/admin/import/preview` shows process / workspace / wiki counts
- **When** the user clicks Import (mode = `replace` \| `merge`)
- **Then** `GET /api/admin/import-token` obtains a token; `POST /api/admin/import?confirm=<token>&mode=<mode>` performs the import; on success stats reload

**US-19 — Wipe data**
> As an administrator, I want to permanently wipe data.

- **Given** Backup & Reset is active (Danger zone)
- **When** the user toggles "Include wikis" and clicks Preview
- **Then** `GET /api/admin/data/stats?includeWikis=<bool>` previews what will be deleted
- **When** the user clicks Wipe Data
- **Then** `GET /api/admin/data/wipe-token` returns a token; clicking Confirm Wipe calls `DELETE /api/admin/data?confirm=<token>&includeWikis=<bool>`; on success stats reload and a toast confirms

---

### 3.12 Server Sub-Tab

**US-20 — View server info and rename**
> As an operator, I want to see the running server's identity and rename it.

- **Given** Server is active (`#admin/server`)
- **Then** the page shows config file path (when present), host, port, data directory, and CoC version + commit (`/api/admin/version`)
- **When** the user edits Server name and clicks Save
- **Then** `PUT /api/admin/config` persists `serve.serverName` (or clears it when blank); toast says "takes effect on next page reload"

**US-21 — Restart the server**
> As an operator, I want to rebuild and restart CoC.

- **Given** Server is active
- **When** the user clicks Rebuild & Restart
- **Then** `POST /api/admin/restart` is called; UI polls `GET /api/admin/data/stats` every 3 s with a 2 s timeout until the server responds; on success the page reloads automatically

---

### 3.13 System Prompts Sub-Tab

**US-22 — Inspect built-in prompts**
> As a developer, I want to see the prompts used by the assistant.

- **Given** System Prompts is active (`#admin/prompts`)
- **When** prompts load via `GET /api/admin/prompts`
- **Then** `PromptsPanel` shows prompt cards grouped by category (Pipeline → Memory → UI), each with title, source badge (monospace), description, and full text in `<pre>`
- **And** failure surfaces a toast via `onError` (panel may show empty groups)

---

### 3.14 Database Browser Sub-Tab

**US-23 — Browse SQLite tables**
> As a developer, I want to inspect the underlying SQLite database.

- **Given** Database Browser is active (`#admin/database`)
- **Then** `DbBrowserSection` lists tables; selecting a table loads paginated rows
- **When** the user clicks a column header
- **Then** sort toggles asc/desc; the URL updates to `#admin/database/<table>?page=N&sort=col&order=asc\|desc` so refresh and copy-link work
- **And** pagination controls update `page` query param without losing sort

---

### 3.15 Embedded Tool Views

**US-24 — Memory (Knowledge group)**
> As an AI operator, I want to manage memory inside the admin shell.

- **Given** the Memory row is active (`#memory[/<subTab>]`)
- **Then** the right pane mounts `MemoryV2Panel`; sidebar stays mounted
- **And** activeAdminSubTab is unchanged (the admin shell hosts the embed)

**US-25 — Skills (Knowledge group)**
> As an administrator, I want to install and configure agent skills inside the admin shell.

- **Given** the Skills row is active (`#skills[/<subTab>]`)
- **Then** the right pane mounts `SkillsView`

**US-26 — Logs (Operations group)**
> As an operator, I want to stream logs inside the admin shell.

- **Given** the Logs row is active (`#logs[?sessionId=…]`)
- **Then** the right pane mounts `LogsView`

**US-27 — Usage & Costs (Operations group)**
> As an operator, I want to inspect token / cost usage inside the admin shell.

- **Given** the Usage & Costs row is active (`#stats`)
- **Then** the right pane mounts `UsageStatsView`

**US-28 — Servers (Configure group, gated)**
> As an operator, I want to browse running CoC servers inside the admin shell.

- **Given** `isServersEnabled()` is true and the Servers row is active (`#servers`)
- **Then** the right pane mounts `ServersView`; otherwise the row is hidden

---

## 4. Feature Inventory & Acceptance Criteria

### 4.1 Shell

| Feature | Acceptance Criteria |
|---|---|
| Layout | `.ar-shell` with `.ar-sidebar` (left) + `.ar-main` (right) |
| Brand | Logo + "CoC Admin" + version `vX.Y.Z` from `/api/admin/version` |
| Nav groups | Configure, Knowledge, Connections (container-only), Operations, Developer / Internals (groups with no items are hidden) |
| Active row | `is-active` + `aria-current="page"` |
| Mobile select | Single `<select>` with `<optgroup>` per group, mirrors sidebar selection |
| Breadcrumb | `<Group> / <Label>` reflecting `activeBreadcrumbGroup` and `activeTabLabel` (or tool item label when embedded) |
| Sidebar Usage block | Processes / Wikis / Disk rows + refresh button (`#admin-refresh-stats`) |

### 4.2 Settings Sub-Tabs (AI / Chat / Appearance / Features / Integrations)

| Feature | Acceptance Criteria |
|---|---|
| Sub-tab bar | `ar-subtab-row` with 5 buttons (Advanced is *not* in the bar — it lives in the sidebar's Developer / Internals group) |
| Per-card dirty | Each `SettingsCard` tracks its own dirty flag from a snapshot; Cancel reverts; Save shows `Saving…` |
| Source badges | Each row shows a `SourceBadge` for the resolved value's source (`default` / `file` / `cli` / `env`) |
| Validation | AI: parallel ≥ 1, timeout positive int or empty, output ∈ {table, json, csv, markdown}. Chat: follow-up count integer 1–5 |
| Cache invalidation | Display + html-embed caches invalidated on chat / appearance / features save |
| Tool verbosity | Segmented control with 4 options (Full / Compact / Minimal / Whisper) |

### 4.3 Settings Sub-Tab — Advanced

| Feature | Acceptance Criteria |
|---|---|
| Read-only fields | Approve permissions, MCP config, persist directory |
| Relaunch welcome | Resets `hasSeenWelcome`, `onboardingProgress`, `dismissedTips` via `PATCH /api/preferences` |
| Source badges | Same as other settings sections |

### 4.4 AI Provider (Agents) Sub-Tab

| Feature | Acceptance Criteria |
|---|---|
| Default provider | Copilot / Codex / Claude radio or segmented control |
| Availability | Per-provider availability indicator from `/api/admin/providers/availability` |
| SDK install badge | `Not Installed` / `Installing…` / `Installed` / `Install Failed` (color-coded) |
| Install action | Triggers SDK install + 2 s polling until terminal state |
| Save | Persists `defaultProvider`, `codex.enabled`, `claude.enabled` via `PUT /api/admin/config`; toast: "restart required" |
| Quota card | `Refresh` button calls `getAgentProvidersQuota`; shows quota or inline error |
| Models section | Embedded `ProviderModelsSection` for the selected default provider |
| Container mode | Sub-tab label becomes "Agents" and is grouped under Connections; `ConnectedAgentsPanel` is rendered |

### 4.5 Providers Sub-Tab

| Feature | Acceptance Criteria |
|---|---|
| GitHub | PAT input with show/hide; Save; "token already saved" indicator |
| ADO | Org URL input; Save; az CLI hint |
| Storage note | "Token stored in `~/.coc/providers.json`" |

### 4.6 Messaging Sub-Tab

| Feature | Acceptance Criteria |
|---|---|
| Visibility | Container only (`isContainerMode()`) |
| Section | `IMSettingsSection` (lazy-loaded) |

### 4.7 Backup & Reset (Data) Sub-Tab

| Feature | Acceptance Criteria |
|---|---|
| Export | Download JSON with status text |
| Import | File picker, mode = `replace` \| `merge`, Preview → Import flow with token confirmation |
| Wipe | "Include wikis" toggle, Preview → Wipe flow with token confirmation, Danger zone styling |

### 4.8 Server Sub-Tab

| Feature | Acceptance Criteria |
|---|---|
| Server info | Config file path (when present), host, port, data dir, version + commit |
| Server name | Edit + Save → `serve.serverName` ; reload-required toast |
| Restart | Calls `/api/admin/restart`; polls every 3 s with 2 s `AbortSignal.timeout(2000)`; auto `window.location.reload()` |

### 4.9 System Prompts Sub-Tab

| Feature | Acceptance Criteria |
|---|---|
| Categories | Pipeline → Memory → UI ordering |
| Card | Title, source badge (mono), description, full text in `<pre>` |
| Loading | Spinner + "Loading…" |

### 4.10 Database Browser Sub-Tab

| Feature | Acceptance Criteria |
|---|---|
| Table list | Loaded from server; click selects table |
| Pagination | `?page=N` |
| Sorting | Column header click toggles asc/desc; `?sort=col&order=asc\|desc` |
| Deep-link | `#admin/database/<table>?page=N&sort=col&order=asc\|desc` |

### 4.11 Embedded Tool Views

| Feature | Acceptance Criteria |
|---|---|
| Embed container | `.ar-tool-embed` with `data-testid="admin-tool-embed-<tab>"` |
| Lazy mount | All tool components are `lazy()`-imported; suspense fallback shows spinner + "Loading…" |
| Memory | Receives `initialScopeId` and `initialTab` from app state; clears scope state via `onInitialScopeConsumed` |
| Servers | Hidden when `isServersEnabled()` is false |

---

## 5. Behavioral Invariants

| ID | Invariant |
|---|---|
| INV-01 | The Admin shell is lazy-loaded from `Router.tsx` and is rendered for `activeTab` ∈ {`admin`, `memory`, `skills`, `logs`, `stats`, `servers`}; the shell decides whether to render an admin page or an embedded tool view based on `state.activeTab` |
| INV-02 | Sidebar groups are filtered by mode/feature flags: container mode adds `Messaging` and moves `Agents`; `Servers` row is gated by `isServersEnabled()` |
| INV-03 | Each settings section is its own `SettingsCard` with isolated dirty/save state and its own snapshot — saving one section does not commit other dirty sections |
| INV-04 | Display/chat changes invalidate `useDisplaySettings` cache (`invalidateDisplaySettings()`); appearance changes also invalidate `useHtmlEmbedPreference` |
| INV-05 | Adding an editable config field is a single registry entry — `admin-handler.ts` is not modified (see admin-config.md) |
| INV-06 | MCP REST surface never exposes secrets (`env`, headers, full `args`) |
| INV-07 | Export and import use time-limited crypto tokens for confirmation |
| INV-08 | Wipe data uses a separate token from import |
| INV-09 | Server restart calls `process.exit(restartExitCode)`; the UI polls `/api/admin/data/stats` every 3 s with 2 s timeout, then `window.location.reload()` |
| INV-10 | Prompts are grouped in the order: Pipeline → Memory → UI |
| INV-11 | The Settings sub-tab `Advanced` is not in the on-page sub-tab bar; it is reachable only via the sidebar Developer / Internals row |
| INV-12 | `agents` sub-tab label is "AI Provider" outside container mode and "Agents" inside container mode; placement also moves between Configure ↔ Connections groups |
| INV-13 | Database deep-links round-trip through hash params (`?page=&sort=&order=`) so refresh and copy-link work |
| INV-14 | All embedded tool views still own their internal sub-tab/hash schemes (`#skills/installed`, `#memory/review`, `#admin/database/<table>?…`); the admin shell does not mutate them |
| INV-15 | Codex / Claude provider switching is gated by the corresponding `enabled` flag and SDK install state |

---

## 6. UI Layout Specification

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  CoC │ Repos │ Wiki │ Admin* (top bar)                                        │
├──────────────────────────────────────────────────────────────────────────────┤
│ ┌──────────────┐  ┌──────────────────────────────────────────────────────┐   │
│ │ CoC Admin    │  │ Configure / AI & Execution                           │   │
│ │ v1.x.x       │  │ Default model, execution limits, timeout, output     │   │
│ │              │  │ ──────────────────────────────────────────────────── │   │
│ │ Configure    │  │ [AI*] [Chat] [Appearance] [Features] [Integrations]  │   │
│ │  ✦ Configure │  │ ┌──────────────────────────────────────────────────┐ │   │
│ │  ◉ AI Prov.  │  │ │ AI & Execution                                   │ │   │
│ │  ◇ Providers │  │ │ Model        [gpt-…  ]  [file]                   │ │   │
│ │  🖥 Servers  │  │ │ Parallelism  [5      ]  [default]                │ │   │
│ │              │  │ │ Timeout      [3600 sec] [default]                │ │   │
│ │ Knowledge    │  │ │ Output       [table ▾]  [default]                │ │   │
│ │  ◈ Memory    │  │ │                                  [Cancel] [Save] │ │   │
│ │  ⚡ Skills   │  │ └──────────────────────────────────────────────────┘ │   │
│ │              │  └──────────────────────────────────────────────────────┘   │
│ │ Operations   │                                                              │
│ │  📊 Usage    │                                                              │
│ │  📋 Logs     │                                                              │
│ │  ⌗ Server    │                                                              │
│ │  ▦ Backup…   │                                                              │
│ │              │                                                              │
│ │ Developer    │                                                              │
│ │  ✎ Prompts   │                                                              │
│ │  ◫ Database  │                                                              │
│ │  ⚙ Advanced  │                                                              │
│ │              │                                                              │
│ │ Usage        │                                                              │
│ │  Processes 142│                                                              │
│ │  Wikis     3 │                                                              │
│ │  Disk   45MB │                                                              │
│ └──────────────┘                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

When a tool route is active, the right pane is replaced with `.ar-tool-embed` hosting the corresponding view (e.g. `MemoryV2Panel`, `SkillsView`).

---

## 7. Error Handling Specification

| Error Scenario | Expected Behavior |
|---|---|
| Stats load failure | Sidebar Usage rows show `—` |
| Config load failure | `data-testid="admin-config-error"` red text inside Settings card |
| Settings save validation failure | Toast notification with concatenated errors |
| Settings save API failure | Toast with server-formatted message; snapshot is not advanced |
| Preferences save failure | Toast notification |
| Provider save failure | Inline error in section |
| Default provider save failure | Toast |
| SDK install failure | `Install Failed` badge + inline error message |
| Quota fetch failure | Inline `quotaError` text |
| Export failure | Status text with error |
| Import preview failure | Error message in preview area |
| Import failure | Error message in import area |
| Wipe failure | Error message in danger zone; token is cleared |
| Restart failure | Toast; polling continues |
| Prompts load failure | Toast via `onError`; panel may show empty groups |
| Database load failure | Inline error in browser section |
| Tool embed load failure | React Suspense fallback remains until import resolves |

---

## 8. Empty State Specification

| State | Display |
|---|---|
| Stats loading | Sidebar spinner |
| Prompts loading | Spinner + "Loading…" |
| No prompts | Empty grouped sections |
| Import preview pending | Preview area empty until file is selected |
| Quota not yet loaded | Sentinel text under Refresh button |
| Tool embed pre-load | Spinner + "Loading…" inside `.ar-tool-embed` |
| Servers row hidden | When `isServersEnabled()` is false |

---

## 9. API Dependencies

| Endpoint | Used by | Critical for |
|---|---|---|
| `GET /api/admin/data/stats` | Sidebar stats, wipe preview, restart poll | Sidebar, US-19, US-21 |
| `GET /api/admin/config` | Settings load | US-04…US-09 |
| `PUT /api/admin/config` | Settings save (all sections) | US-04, US-05, US-06, US-07, US-09, US-11 |
| `GET /api/preferences` | Preferences load | US-06 |
| `PATCH /api/preferences` | Preferences save (theme/sidebar/layout/htmlEmbed/promptAutocomplete/welcome reset) | US-06, US-10 |
| `GET /api/providers/config` | Provider section status | US-14, US-15 |
| `PUT /api/providers/config` | Provider section save | US-14, US-15 |
| `GET /api/admin/providers/availability` | Provider availability indicator | US-11 |
| `GET /api/agent-providers` (`agentProviders.list`) | SDK install statuses | US-11 |
| `POST /api/agent-providers/<id>/install` | Trigger SDK install | US-11 |
| `GET /api/agent-providers/<id>/install-status` | Poll install status | US-11 |
| `GET /api/admin/agent-providers/quota` | Quota refresh | US-12 |
| `GET /api/admin/export` | Data export | US-17 |
| `POST /api/admin/import/preview` | Import preview | US-18 |
| `GET /api/admin/import-token` | Import token | US-18 |
| `POST /api/admin/import` | Import data | US-18 |
| `GET /api/admin/data/wipe-token` | Wipe token | US-19 |
| `DELETE /api/admin/data` | Wipe data | US-19 |
| `GET /api/admin/version` | Sidebar brand version | Sidebar |
| `POST /api/admin/restart` | Server restart | US-21 |
| `GET /api/admin/prompts` | Prompts list | US-22 |
| `GET /api/admin/database/tables`, `GET /api/admin/database/tables/:table` (or equivalent client domain) | Database browser | US-23 |

---

## Revision History

| Version | Date | Summary |
|---|---|---|
| 1.0.0 | 2026-03-25 | Initial specification (5 sub-tabs: Settings, Providers, Data, Server, Prompts; single-page Settings) |
| 2.0.0 | 2026-05-29 | Major rewrite: 8 admin sub-tabs (added `database`, `agents`, `messaging`); Settings split into 6 internal sub-tabs (`ai`, `chat`, `appearance`, `features`, `integrations`, `advanced`); sidebar shell with Configure / Knowledge / Connections / Operations / Developer / Internals groups; embedded tool views (`memory`, `skills`, `logs`, `stats`, `servers`) hosted inside the admin shell; container-mode label/placement variations for `agents` + `messaging`; per-card dirty tracking; database deep-link with `?page=&sort=&order=`; sidebar-foot Usage stats; Codex/Claude SDK install flow with polling. |
