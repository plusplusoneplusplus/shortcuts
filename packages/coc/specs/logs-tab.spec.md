# Logs Tab — UI/UX Specification

**Document type:** Formal UX Specification  
**Scope:** CoC Dashboard → Logs (embedded in Admin Shell · Operations Group)  
**Purpose:** Authoritative reference for validating any future UI/UX changes to the Logs tab.  
**Version:** 2.0.0

---

## 1. Overview

The **Logs route** provides a real-time log viewer for the CoC server. It is reached at the top-level URL `#logs` but is rendered embedded inside the Admin shell's left sidebar **Operations** group — `LogsView` is mounted in the right pane while the admin sidebar stays visible.

It connects via Server-Sent Events (SSE) to stream log entries with level filtering, text search with highlighting, connection-status indicator, pause/resume auto-scroll, in-memory clear, expandable detail for entries with extra fields, color-coded HTTP fields, and a per-session filter driven by the `?sessionId=…` URL parameter. A `LogsDialog` wrapper exposes the same view inside a modal.

### 1.1 Tab Identity

| Property | Value |
|---|---|
| Route label | `Logs` |
| Sidebar group | `Operations` (inside `AdminPanel`) |
| Default tab | No |
| URL fragment | `#logs` |
| Session filter | `#logs?sessionId=<id>` (parsed in `LogsView` via `URLSearchParams` on the hash tail) |
| Embedded view | `LogsView` (`features/logs/LogsView.tsx`) |
| Modal wrapper | `LogsDialog` (`features/logs/LogsDialog.tsx`) |
| Panel root id | `view-logs` |

---

## 2. User Personas

| Persona | Description | Primary Goal |
|---|---|---|
| **Developer** | Engineers debugging server behavior | Monitor real-time logs, filter by level, search for errors |
| **Operator** | Users monitoring server health | Watch warnings/errors, verify API activity |
| **Administrator** | Users diagnosing issues | Inspect HTTP request details, review component logs |

---

## 3. User Stories

**US-01 — View real-time logs**
> As a developer, I want to see server log entries as they happen.

- **Given** the Logs route is open
- **When** the SSE connection is established at `<apiBase>/logs/stream[?sessionId=…]`
- **Then** historical entries arrive via the `history` event first, followed by streaming `log-entry` events; the in-memory buffer is capped at 2000 entries (oldest dropped)

---

**US-02 — Filter by minimum log level**
> As an operator, I want to hide low-severity entries.

- **Given** the Logs route is open
- **When** the user clicks one of the level filter buttons (All, Debug+, Info+, Warn+, Error+)
- **Then** rows below the selected numeric level are hidden client-side
- **And** the active filter button uses `bg-[#0078d4]` highlighting and `data-testid="level-filter-<value>"`

---

**US-03 — Search log entries**
> As a developer, I want to find entries by text.

- **Given** the Logs route is open
- **When** the user types in the search input (`log-search`)
- **Then** entries are filtered case-insensitively against `msg + ' ' + component`; the first match in `msg` is highlighted with `<mark>`

---

**US-04 — Pause and resume auto-scroll**
> As a developer, I want to read a row without it scrolling away.

- **Given** logs are streaming
- **When** the user clicks **Pause** (`pause-btn`) the button flips to **▶ Resume** and uses the active accent color; auto-scroll stops; new entries continue to append to the list (and to the buffer)
- **When** the user clicks **Resume**
- **Then** the list scrolls to the bottom on the next animation frame

---

**US-05 — Clear logs**
> As a developer, I want to start with a fresh viewport.

- **Given** logs are displayed
- **When** the user clicks **Clear** (`clear-btn`)
- **Then** the in-memory list is cleared (the server buffer is unaffected)

---

**US-06 — View log entry details**
> As an administrator, I want to see additional fields on a log entry.

- **Given** a log entry has fields beyond the core (`ts`, `level`, `component`, `msg`) and the known inline fields (`method`, `path`, `status`, `durationMs`, `resource`, `id`)
- **When** the user clicks the `⋯` toggle (`log-expand-toggle`)
- **Then** a detail row appears showing each unknown key as `<key>: <JSON.stringify(value)>`

---

**US-07 — Monitor connection status**
> As an operator, I want to know if the log stream is connected.

- **Given** the Logs route is open
- **Then** an indicator (`sse-status`) reflects the SSE state:
  - `connecting` — amber pulsing dot, label "Connecting…"
  - `open` — green dot, label "Live"
  - `closed` — red dot, label "Disconnected — reconnecting…"

---

**US-08 — Filter by session**
> As an operator, I want to follow logs for a specific session.

- **Given** the user opens `#logs?sessionId=<id>`
- **Then** the `LogsView` reads `sessionId` from the hash tail and reconnects SSE to `/logs/stream?sessionId=<id>`; the buffer is cleared
- **And** a yellow chip (`session-filter-chip`) shows `🔗 Session: <id-truncated-to-20-chars>…` plus a `✕ Clear` button (`clear-session-filter`) that resets the hash to `#logs`

---

**US-09 — Use the Logs view inside a modal**
> As any user, I want to consult the same logs without leaving my current screen.

- **Given** any panel imports `LogsDialog`
- **When** it opens
- **Then** the dialog hosts `LogsView` with the same toolbar, list, footer, and SSE behavior, in a constrained surface (max-width 1100 px, max-height 80 vh) with Suspense loading

---

## 4. Feature Inventory & Acceptance Criteria

### 4.1 Toolbar

| Feature | Acceptance Criteria |
|---|---|
| Level filter | 5 buttons: All, Debug+, Info+, Warn+, Error+; active state `bg-[#0078d4] text-white` |
| Search | `log-search` input; placeholder "Search…"; client-side filter on `msg + component` |
| Connection status | `sse-status` indicator with dot + label (Connecting / Live / Disconnected) |
| Pause / Resume | Single button, label flips between `⏸ Pause` and `▶ Resume`; `pause-btn` testid |
| Clear | `clear-btn`; clears in-memory list only |

### 4.2 Session Filter Chip

| Feature | Acceptance Criteria |
|---|---|
| Visibility | Shown only when `sessionId` query param is present |
| Container | Yellow strip below the toolbar with `data-testid="session-filter-chip"` |
| Display | `🔗 Session: <id>` (truncated to 20 chars + `…` when longer) |
| Clear | `✕ Clear` button (`clear-session-filter`) sets hash to `#logs` |

### 4.3 Log Row

| Feature | Acceptance Criteria |
|---|---|
| Layout | `font-mono text-xs leading-5`; row carries `data-testid="log-row"` and `data-level="<level>"` |
| Timestamp | `90 px` column; `HH:mm:ss.mmm` (24-hour, ms padded) |
| Level badge | `44 px` column; color-coded (fatal/error red, warn amber, info blue, trace/debug gray) |
| Component | `80 px` truncated column with `title` tooltip |
| Message | Flex; full text; first match highlighted with `<mark>` |
| Method badge | `log-field-method`; color-coded GET=blue, POST=green, PUT/PATCH=amber, DELETE=red, default gray |
| Path | `log-field-path`; max-width 200 px with truncate + tooltip |
| Status | `log-field-status`; ≥500 red, ≥400 amber, else green |
| Duration | `log-field-duration` ("Nms") |
| Resource | `log-field-resource` |
| ID | `log-field-id`; max-width 80 px truncated with title |
| Expand toggle | `log-expand-toggle` (`⋯`); shown when extra fields exist; `aria-expanded` reflects state |
| Detail row | `log-row-details`; key-value pairs with `<key>: <JSON.stringify(value)>` |
| Row text color | error/fatal red, warn amber, otherwise inherited |

### 4.4 Empty / Footer

| Feature | Acceptance Criteria |
|---|---|
| Empty (no entries) | `log-empty-state` "No log entries yet. Logs will appear here once activity is recorded." (with 📋) |
| Empty (filtered) | `log-empty-state` "No entries match the current filter." |
| Footer | `<n> entry/entries shown` plus `(M total)` when filtered count differs |

### 4.5 SSE Wiring

| Feature | Acceptance Criteria |
|---|---|
| Endpoint | `<apiBase>/logs/stream[?sessionId=…]` |
| Buffer cap | Last 2000 entries kept |
| Events | `history` (initial bulk), `log-entry` (incremental), `heartbeat` (keepalive) |
| Status mapping | `connecting` (start) → `open` (history/heartbeat/onopen) → `closed` (onerror) → reconnect after 3 s |
| Filter switch | Changing `sessionFilter` clears the buffer and reconnects |
| Heartbeat | Updates status to `open` |

---

## 5. Behavioral Invariants

| ID | Invariant |
|---|---|
| INV-01 | The Logs route renders inside the Admin shell's right pane (Operations group); the admin sidebar stays mounted |
| INV-02 | SSE connection auto-reconnects after 3 s on error |
| INV-03 | Initial historical entries arrive via the `history` event; `/api/logs/history` and `/api/logs/sources` are not consumed by `LogsView` |
| INV-04 | Heartbeat events update the connection status to `open`; missing heartbeats do not flip the status — only `onerror` does |
| INV-05 | Pause only affects auto-scroll; new entries continue to be appended to the in-memory buffer |
| INV-06 | Clear only affects the in-memory list; the server log buffer is unaffected |
| INV-07 | SSE / parse errors are silently swallowed (entry skipped) |
| INV-08 | Level filtering uses numeric ordering: `trace=10, debug=20, info=30, warn=40, error=50, fatal=60` |
| INV-09 | The in-memory buffer is capped at 2000 entries (oldest dropped) |
| INV-10 | Session filter is parsed from the hash tail (`#logs?sessionId=…`); changing it forces a full reconnect |
| INV-11 | `LogsDialog` wraps `LogsView` and shares all behavior; it does not duplicate state |

---

## 6. UI Layout Specification

```
┌── AdminPanel (admin-redesign) ────────────────────────────────────────┐
│ ┌──────────────┐  ┌──────────────────────────────────────────────────┐│
│ │ Operations   │  │ LogsView (id="view-logs")                        ││
│ │  📊 Usage    │  │ [All*] [Debug+] [Info+] [Warn+] [Error+]  [🔍] … ││
│ │  📋 Logs*    │  │                       ● Live  [⏸ Pause][Clear] ││
│ │  ⌗ Server    │  │ ─────────────────────────────────────────────── ││
│ │  ▦ Backup…   │  │ 15:42:03.123 INFO   server  Server started…     ││
│ │              │  │ 15:42:05.456 INFO   api     [GET][/api/queue]200││
│ │              │  │ 15:42:06.789 WARN   memory  Memory store …      ││
│ │              │  │ 15:42:07.012 DEBUG  ws      WebSocket conn …    ││
│ │              │  │ 15:42:08.345 ERROR  ai      AI service timeout… ││
│ │              │  │ ─────────────────────────────────────────────── ││
│ │              │  │ 8 entries shown                                  ││
│ └──────────────┘  └──────────────────────────────────────────────────┘│
└──────────────────────────────────────────────────────────────────────┘
```

When `?sessionId=<id>` is present, a yellow chip is inserted between the toolbar and the list.

---

## 7. Error Handling Specification

| Error Scenario | Expected Behavior |
|---|---|
| SSE connection error | Status flips to `closed` ("Disconnected — reconnecting…"); the connection is closed and a reconnect is scheduled after 3 s |
| SSE parse error | Silently swallowed; entry skipped |
| Server unavailable | Status remains `closed`; reconnect attempts continue every 3 s |
| Heartbeat absent | Status stays at last known state until an explicit `onerror` fires |

---

## 8. Empty State Specification

| State | Display |
|---|---|
| No entries received | 📋 + "No log entries yet. Logs will appear here once activity is recorded." (`log-empty-state`) |
| Filter/search returns nothing | 📋 + "No entries match the current filter." (`log-empty-state`) |

---

## 9. API Dependencies

| Endpoint | Used by | Critical for |
|---|---|---|
| `GET <apiBase>/logs/stream[?sessionId=…]` (SSE) | Live + historical stream (`history` / `log-entry` / `heartbeat`) | US-01, US-02, US-07, US-08 |
| `GET /api/logs/history` | Available; not consumed by `LogsView` | — |
| `GET /api/logs/sources` | Available; not consumed by `LogsView` | — |

---

## 10. LogsDialog

`LogsDialog` wraps `LogsView` in the shared `Dialog` shell with title "Logs", `max-width: 1100px`, `max-height: 80vh`, and Suspense fallback. It is used to embed the same view in modals (e.g. ad-hoc log inspection from a chat detail or process timeline).

---

## Revision History

| Version | Date | Summary |
|---|---|---|
| 1.0.0 | 2026-03-25 | Initial specification (top-level Logs tab) |
| 2.0.0 | 2026-05-29 | Embedded inside Admin shell's Operations group; documented session filter via `#logs?sessionId=…`, in-memory buffer cap of 2000, color-coded HTTP method/status/duration columns, expandable extra-field detail row, and full SSE event semantics (`history`, `log-entry`, `heartbeat`). Clarified that `/api/logs/history` and `/api/logs/sources` are not used by `LogsView`. |
