# Usage Stats Tab — UI/UX Specification

**Document type:** Formal UX Specification  
**Scope:** CoC Dashboard → Usage Stats (Top-Level Tab)  
**Purpose:** Authoritative reference for validating any future UI/UX changes to the Usage Stats tab.  
**Version:** 1.0.0

---

## 1. Overview

The **Usage Stats Tab** is a top-level dashboard tab that displays AI token usage statistics aggregated across all processes. It shows a table of daily token consumption broken down by model, with input/output token counts, optional cost data, and configurable time ranges. Data is computed server-side by aggregating all process records.

### 1.1 Tab Identity

| Property | Value |
|---|---|
| Tab label | `Usage` |
| Tab position | Top-level tab |
| Default tab | No |
| URL fragment | `#stats` |

---

## 2. User Personas

| Persona | Description | Primary Goal |
|---|---|---|
| **Administrator** | Users monitoring AI resource consumption | Track token usage, estimate costs, identify trends |
| **Developer** | Engineers checking their AI usage | See daily breakdown, compare model usage |

---

## 3. User Stories

**US-01 — View token usage table**
> As an administrator, I want to see a daily breakdown of token usage by model.

- **Given** the Usage Stats tab is open
- **When** usage data exists
- **Then** a table shows rows per day with columns for each model and a Total column; each cell shows input (↓) and output (↑) token counts with optional cost

---

**US-02 — Filter by time range**
> As an administrator, I want to filter usage data by time range.

- **Given** the Usage Stats tab is open
- **When** the user selects a time range (Last 7 / 30 / 90 days / All time)
- **Then** the data refetches with the selected `days` parameter

---

**US-03 — Refresh data**
> As an administrator, I want to refresh the usage data.

- **Given** the Usage Stats tab is open
- **When** the user clicks Refresh
- **Then** the data reloads from the server

---

**US-04 — View cell detail on hover**
> As a developer, I want to see detailed token breakdown when hovering over a cell.

- **Given** the usage table is displayed
- **When** the user hovers over a cell
- **Then** a tooltip shows: input tokens, output tokens, cache read/write, total tokens, turns, and cost (if present)

---

**US-05 — View totals**
> As an administrator, I want to see total usage across all days.

- **Given** the usage table is displayed
- **When** data exists
- **Then** a footer row "Total" sums per-model columns and shows the grand total

---

## 4. Feature Inventory & Acceptance Criteria

### 4.1 Control Bar

| Feature | Acceptance Criteria |
|---|---|
| Time range selector | Dropdown: Last 7 days, Last 30 days, Last 90 days, All time |
| Refresh button | Disabled while loading; triggers data reload |
| Generated timestamp | Shows "Generated at: <localized time>" when data exists |

### 4.2 Usage Table

| Feature | Acceptance Criteria |
|---|---|
| Sticky header | Column headers stick on scroll |
| Date column | Monospace font; one row per day |
| Model columns | One per model; header truncated to 18 chars with ellipsis (full ID in title); 20-char threshold |
| Total column | Sum of all models for each row |
| Cell display | ↓ formatted input + ↑ formatted output; optional $ cost (4 decimals) |
| Token formatting | k for thousands, M for millions |
| Zebra rows | Alternating row backgrounds |
| Footer row | "Total" with per-model sums and grand total |
| Hover tooltip | Input, output, cache read/write, total, turns, cost |

---

## 5. Behavioral Invariants

| ID | Invariant |
|---|---|
| INV-01 | Time range change triggers a server refetch, not client-side filtering |
| INV-02 | Invalid `days` values (non-digits) are treated as "all time" by the server |
| INV-03 | The table always shows a footer Total row when data exists |
| INV-04 | Model column headers are truncated at 20 characters with the full ID available in the title attribute |
| INV-05 | Cost is only shown when cost data is present in the response |

---

## 6. UI Layout Specification

```
┌─────────────────────────────────────────────────────────────────────┐
│  CoC │ Processes │ Wiki │ Memory │ Skills │ Usage* │ …              │
├─────────────────────────────────────────────────────────────────────┤
│  [Last 30 days ▼]  [↻ Refresh]          Generated at: 3:42 PM     │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  Date        │ gpt-4o        │ claude-sonnet │ Total               │
│  ────────────┼───────────────┼───────────────┼──────────────────   │
│  2026-03-25  │ ↓12.3k ↑8.1k │ ↓5.2k ↑3.4k  │ ↓17.5k ↑11.5k    │
│              │ $0.0234       │ $0.0156       │ $0.0390            │
│  2026-03-24  │ ↓8.7k ↑6.2k  │ ↓3.1k ↑2.0k  │ ↓11.8k ↑8.2k     │
│              │ $0.0167       │ $0.0098       │ $0.0265            │
│  …           │ …             │ …             │ …                  │
│  ────────────┼───────────────┼───────────────┼──────────────────   │
│  Total       │ ↓156k ↑98k   │ ↓67k ↑42k    │ ↓223k ↑140k       │
│              │ $0.3120       │ $0.1890       │ $0.5010            │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 7. Error Handling Specification

| Error Scenario | Expected Behavior |
|---|---|
| Data fetch failure | Error text (vscode-errorForeground) + Retry button |
| Invalid time range | Server treats as "all time" |

---

## 8. Empty State Specification

| State | Display |
|---|---|
| No usage data | "No token usage data found. Run some AI tasks to see stats here." |
| Loading | Centered "Loading…" |

---

## 9. API Dependencies

| Endpoint | Used by | Critical for |
|---|---|---|
| `GET /api/stats/token-usage` | Usage table | US-01, US-02, US-03 |

---

## Revision History

| Version | Date | Summary |
|---|---|---|
| 1.0.0 | 2026-03-25 | Initial specification |
