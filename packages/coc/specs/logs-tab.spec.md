# Logs Tab — UI/UX Specification

**Document type:** Formal UX Specification  
**Scope:** CoC Dashboard → Logs (Top-Level Tab)  
**Purpose:** Authoritative reference for validating any future UI/UX changes to the Logs tab.  
**Version:** 1.0.0

---

## 1. Overview

The **Logs Tab** is a top-level dashboard tab that provides a real-time log viewer for the CoC server. It connects via Server-Sent Events (SSE) to stream log entries with level filtering, text search with highlighting, connection status indicators, pause/resume auto-scroll, and expandable detail for entries with extra fields. A `LogsDialog` wrapper allows embedding the same view in a modal.

### 1.1 Tab Identity

| Property | Value |
|---|---|
| Tab label | `Logs` |
| Tab position | Top-level tab |
| Default tab | No |
| URL fragment | `#logs` |

---

## 2. User Personas

| Persona | Description | Primary Goal |
|---|---|---|
| **Developer** | Engineers debugging server behavior | Monitor real-time logs, filter by level, search for errors |
| **Operator** | Users monitoring server health | Watch for warnings/errors, verify API activity |
| **Administrator** | Users diagnosing issues | Inspect HTTP request details, review component logs |

---

## 3. User Stories

**US-01 — View real-time logs**
> As a developer, I want to see server log entries as they happen.

- **Given** the Logs tab is open
- **When** the SSE connection is established
- **Then** log entries appear in real time; historical entries (up to 200) are loaded first, then new entries stream in

---

**US-02 — Filter by log level**
> As an operator, I want to filter logs by minimum severity level.

- **Given** the Logs tab is open
- **When** the user clicks a level filter button (All, Debug+, Info+, Warn+, Error+)
- **Then** only entries at or above the selected level are shown

---

**US-03 — Search log entries**
> As a developer, I want to search logs by text.

- **Given** the Logs tab is open
- **When** the user types in the search input
- **Then** entries are filtered client-side on `msg` + `component` (case-insensitive); the first match in `msg` is highlighted with `<mark>`

---

**US-04 — Pause and resume auto-scroll**
> As a developer, I want to pause auto-scroll to read a specific log entry without it scrolling away.

- **Given** logs are streaming
- **When** the user clicks Pause
- **Then** auto-scroll stops but new entries continue to append
- **When** the user clicks Resume
- **Then** the view scrolls to the bottom

---

**US-05 — Clear logs**
> As a developer, I want to clear the log view to start fresh.

- **Given** logs are displayed
- **When** the user clicks Clear
- **Then** the in-memory log list is cleared (server buffer is not affected)

---

**US-06 — View log entry details**
> As an administrator, I want to see additional fields on a log entry.

- **Given** a log entry has extra fields beyond the standard set
- **When** the user clicks the expand button (⋯)
- **Then** a detail block shows all extra fields as `key: value` pairs

---

**US-07 — Monitor connection status**
> As an operator, I want to know if the log stream is connected.

- **Given** the Logs tab is open
- **When** the SSE connection state changes
- **Then** a status indicator shows: "Connecting…" (amber pulse), "Live" (green), or "Disconnected — reconnecting…" (red)

---

## 4. Feature Inventory & Acceptance Criteria

### 4.1 Toolbar

| Feature | Acceptance Criteria |
|---|---|
| Level filter buttons | All, Debug+, Info+, Warn+, Error+; minimum level filtering |
| Search input | Client-side filter on `msg` + `component`; case-insensitive; first match highlighted with `<mark>` |
| Connection status | Dot + label: Connecting (amber pulse), Live (green), Disconnected (red) |
| Pause / Resume | Pauses auto-scroll only; entries still append |
| Clear | Clears in-memory list; does not affect server |

### 4.2 Log Entry Display

| Feature | Acceptance Criteria |
|---|---|
| Timestamp | Localized time with milliseconds |
| Level badge | Color-coded: fatal/error (red), warn (yellow), info (blue), debug/trace (gray) |
| Component | Truncated with full text in title attribute |
| Message | Full text; search matches highlighted |
| Inline fields | When present: HTTP method badge, path, status (color by range), durationMs, resource, id |
| Expand button | Shown when extra fields exist beyond core + known inline fields |
| Expanded detail | Key-value pairs for unknown fields |

### 4.3 Footer

| Feature | Acceptance Criteria |
|---|---|
| Entry count | "N entry/entries shown" |
| Total count | "(M total)" when filtered count differs from total |

---

## 5. Behavioral Invariants

| ID | Invariant |
|---|---|
| INV-01 | SSE connection auto-reconnects after 3 seconds on error |
| INV-02 | Historical entries (up to 200) are loaded on connection via the `history` event |
| INV-03 | Heartbeat events (every 15s) update the connection status to "Live" |
| INV-04 | Pause only affects auto-scroll; new entries continue to be appended to the list |
| INV-05 | Clear only affects the in-memory list; the server log buffer is unaffected |
| INV-06 | SSE parse errors are silently swallowed |
| INV-07 | Level filtering is applied client-side using numeric level ordering |

---

## 6. UI Layout Specification

```
┌─────────────────────────────────────────────────────────────────────┐
│  CoC │ Processes │ Wiki │ Memory │ Skills │ Usage │ Logs* │ …       │
├─────────────────────────────────────────────────────────────────────┤
│  [All] [Debug+] [Info+] [Warn+] [Error+]  [🔍 Search…]           │
│  ● Live                              [⏸ Pause] [🗑 Clear]         │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  15:42:03.123  INFO   server    Server started on port 4000        │
│  15:42:05.456  INFO   api       GET /api/queue  200  12ms          │
│  15:42:06.789  WARN   memory    Memory store approaching limit     │
│  15:42:07.012  DEBUG  ws        WebSocket connection from ::1      │
│  15:42:08.345  ERROR  ai        AI service timeout after 30s       │
│  15:42:09.678  INFO   api       POST /api/queue  201  45ms         │
│  15:42:10.901  INFO   queue     Task abc123 started                │
│  15:42:12.234  DEBUG  sse       SSE client connected               │
│                                                                     │
├─────────────────────────────────────────────────────────────────────┤
│  8 entries shown                                                    │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 7. Error Handling Specification

| Error Scenario | Expected Behavior |
|---|---|
| SSE connection error | Status changes to "Disconnected — reconnecting…"; auto-reconnect after 3s |
| SSE parse error | Silently swallowed; entry skipped |
| Server unavailable | Status shows "Disconnected"; continuous reconnect attempts |

---

## 8. Empty State Specification

| State | Display |
|---|---|
| No log entries yet | "No log entries yet…" with emoji |
| Filter/search returns no results | "No entries match the current filter." with emoji |

---

## 9. API Dependencies

| Endpoint | Used by | Critical for |
|---|---|---|
| `GET /api/logs/stream` | SSE log stream | US-01, US-07 |
| `GET /api/logs/history` | Historical entries (available but not used by LogsView; SSE `history` event used instead) | — |
| `GET /api/logs/sources` | Log source metadata (available but not used by LogsView) | — |

---

## 10. LogsDialog

The `LogsDialog` component wraps `LogsView` in a shared `Dialog` with title "Logs", max-width 1100px, max-height 80vh, and Suspense loading. It provides the same functionality as the top-level tab but in a modal overlay.

---

## Revision History

| Version | Date | Summary |
|---|---|---|
| 1.0.0 | 2026-03-25 | Initial specification |
