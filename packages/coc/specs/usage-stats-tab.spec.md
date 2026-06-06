# Usage & Costs Tab — UI/UX Specification

**Document type:** Formal UX Specification  
**Scope:** CoC Dashboard → Usage & Costs (embedded in Admin Shell · Operations Group)  
**Purpose:** Authoritative reference for validating any future UI/UX changes to the Usage & Costs tab.  
**Version:** 3.0.0

---

## 1. Overview

The **Usage & Costs route** displays AI token usage and estimated cost statistics aggregated across all processes. It is reached at the top-level URL `#stats` but is rendered embedded inside the Admin shell's left sidebar **Operations** group — `UsageStatsView` is mounted in the right pane while the admin sidebar stays visible.

The view shows a three-column table (Date / Model / Tokens) with models stacked as rows within each date group rather than spread horizontally as columns. Each date group starts with an "All models" summary row followed by per-model rows. Each cell breaks input tokens into `total / cached / new`, output tokens, cache-write tokens, and (in summary rows) estimated USD cost. Hover tooltips reveal the full numeric breakdown plus per-model pricing source. Data is computed server-side by aggregating all process records. This row-based layout fits the viewport regardless of how many models are in use.

### 1.1 Tab Identity

| Property | Value |
|---|---|
| Sidebar label | `Usage & Costs` |
| Sidebar group | `Operations` (inside `AdminPanel`) |
| Default tab | No |
| URL fragment | `#stats` |
| Embedded view | `UsageStatsView` (`features/stats/UsageStatsView.tsx`) |

---

## 2. User Personas

| Persona | Description | Primary Goal |
|---|---|---|
| **Administrator** | Users monitoring AI resource consumption | Track token usage, estimate costs, identify trends |
| **Developer** | Engineers checking their AI usage | See daily breakdown, compare model usage |
| **FinOps** | Users reconciling estimated cost with provider invoices | Audit input/output/cache cost split per model and pricing source |

---

## 3. User Stories

**US-01 — View token usage table**
> As an administrator, I want to see a daily breakdown of token usage by model.

- **Given** the Usage & Costs tab is open
- **When** usage data is loaded via `useTokenUsageStats(days)` (`GET /api/stats/token-usage?days=<n>`)
- **Then** the table has 3 fixed columns (Date / Model / Tokens); each date group shows an "All models" summary row followed by one row per model that has data for that day
- **And** each cell shows `↓<input> total · <cached> cached · <new> new` and `↑<output> out · <cacheWrite> cache write` (with optional `est $X` cost in summary rows)

---

**US-02 — Filter by time range**
> As an administrator, I want to filter usage data by time range.

- **Given** the Usage & Costs tab is open
- **When** the user selects a time range (Last 7 days / Last 30 days / Last 90 days / All time)
- **Then** the data refetches with the selected `days` parameter (omitted for All time)
- **And** the default is `30` days

---

**US-03 — Refresh data**
> As an administrator, I want to refresh the usage data.

- **Given** the Usage & Costs tab is open
- **When** the user clicks **↻ Refresh**
- **Then** the data reloads via `reload()`; the button is disabled while loading

---

**US-04 — View cell tooltip**
> As a developer, I want to see the full token + cost breakdown when hovering.

- **Given** the usage table is displayed
- **When** the user hovers over a cell
- **Then** a `title` tooltip lists multi-line:
  - `Input total: <n>`
  - `Input cached/read: <n>`
  - `Input non-cached: <n>`
  - `Cache write: <n>`
  - `Output: <n>`
  - `Turns: <n>`
- **And** when cost details are shown (Total column or grand total) the tooltip also includes:
  - `Estimated token cost: $X`
  - per-component breakdown (`Input`, `Cached input`, `Cache write`, `Output`)
  - `No pricing table entry for this model` when `pricingUnavailable`
  - `Premium units: <n>` when premium-unit `cost` is set
  - `Pricing source: <source>` when present

---

**US-05 — View per-model and grand totals**
> As an administrator, I want to see a per-model total plus a single grand total.

- **Given** the usage table is displayed with at least one entry
- **Then** a `<tfoot>` section labeled "Total" shows an "All models" grand total row (with `showCostDetails`) followed by one row per model (using `sumByModel`)

---

**US-06 — See generated timestamp**
> As any user, I want to know when the displayed data was computed.

- **Given** the data has loaded
- **Then** the controls bar shows "Generated at: `<localized timestamp>`" right-aligned

---

## 4. Feature Inventory & Acceptance Criteria

### 4.1 Controls Bar

| Feature | Acceptance Criteria |
|---|---|
| Time range select | 4 options: 7 / 30 / 90 / All time; default 30 days; All time sends no `days` param |
| Refresh button | `↻ Refresh`; disabled while loading |
| Generated timestamp | Right-aligned `Generated at: <localeString>` when data is loaded |

### 4.2 Usage Table

| Feature | Acceptance Criteria |
|---|---|
| Sticky header | `<thead>` is `sticky top-0` with 3 columns: Date / Model / Tokens |
| Date groups | Each date uses `rowSpan` on the Date cell; first row is "All models" summary, followed by per-model rows (only models with data for that day) |
| Model names | Full model name in cell text and `title` attribute; truncated via CSS `max-w-[200px] truncate` |
| Summary row | "All models" row per date shows `entry.dayTotal` with `showCostDetails` |
| Cell input row | `↓<inputTotal> total · <cachedInput> cached · <newInput> new` |
| Cell output row | `↑<outputTotal> out · <cacheWrite> cache write[ · est $<usd>]` (cost only when `showCostDetails`) |
| Premium units row | `Premium units: <units>` (only when `usage.cost` is present and `showCostDetails`) |
| Token formatting | `fmt(n)` — `k` for ≥1000, `M` for ≥1_000_000, otherwise integer |
| Cost formatting | `fmtUsdCost`: `$X.XX` for ≥$0.01; up to 6 decimals (trailing zeros stripped) for smaller |
| Zebra striping | Alternating date groups use `vscode-list-hoverBackground` |
| Footer total section | `<tfoot>` "Total" with "All models" grand total row (with `showCostDetails`) + per-model rows; `—` for models with no data |
| Tooltip | Multi-line `title` per US-04 |
| Fixed width | 3 columns fit within the viewport regardless of model count |

### 4.3 Hooks / Data Aggregation

| Feature | Acceptance Criteria |
|---|---|
| Hook | `useTokenUsageStats(days)` from `features/chat/hooks/useTokenUsageStats` |
| Aggregation | `sumByModel(entries, model)` and `sumUsage(entries)` add token counts, turns, cost (premium units), `estimatedUsdCost`, and `costBreakdown` (input/cached input/cache write/output USD) |
| Pricing source | Carried through aggregation (`pricingSource`); `pricingUnavailable` is OR'ed across rows |

---

## 5. Behavioral Invariants

| ID | Invariant |
|---|---|
| INV-01 | The Usage & Costs route renders inside the Admin shell's right pane (Operations group); the admin sidebar stays mounted |
| INV-02 | Time range change triggers a server refetch via `useTokenUsageStats`, not client-side filtering |
| INV-03 | "All time" is sent as no `days` param (the server treats missing/invalid `days` as all-time) |
| INV-04 | The table footer Total section is only rendered when `data.entries.length > 0` |
| INV-05 | Model names are shown in full within each row; CSS `truncate` with `max-w-[200px]` handles overflow; full ID is available in the `title` attribute |
| INV-06 | Cost details (`est $X`, premium units, breakdown lines) are only rendered when `showCostDetails` is true — on "All models" summary rows (per-date and grand total) |
| INV-07 | When `costBreakdown` is missing on an `entry.byModel[m]` cell, that cell still aggregates without breakdown; the Total column may still show breakdown if at least one source provided it |
| INV-08 | Tooltip text is rendered via the native `title` attribute (no custom popover) |

---

## 6. UI Layout Specification

```
┌── AdminPanel ────────────────────────────────────────────────────────┐
│ ┌──────────────┐  ┌────────────────────────────────────────────────┐ │
│ │ Operations   │  │ UsageStatsView                                 │ │
│ │  📊 Usage*   │  │ ─────────────────────────────────────────────  │ │
│ │  📋 Logs     │  │ [Last 30 days ▾] [↻ Refresh]   Generated at:…  │ │
│ │  ⌗ Server    │  │ ─────────────────────────────────────────────  │ │
│ │  ▦ Backup…   │  │ DATE     | MODEL       | TOKENS                │ │
│ │              │  │ 26-05-29 | All models  | ↓20k total …  est $0.18│
│ │              │  │          | gpt-4o      | ↓12k total …           │ │
│ │              │  │          | claude-…    | ↓8k total …            │ │
│ │              │  │ 26-05-28 | All models  | ↓15k total …  est $0.12│
│ │              │  │          | gpt-4o      | ↓15k total …           │ │
│ │              │  │ ─────────┼─────────────┼──────────────────────  │ │
│ │              │  │ Total    | All models  | ↓35k total …  est $0.30│
│ │              │  │          | gpt-4o      | ↓27k total …           │ │
│ │              │  │          | claude-…    | ↓8k total …            │ │
│ └──────────────┘  └────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────┘
```

---

## 7. Error Handling Specification

| Error Scenario | Expected Behavior |
|---|---|
| Data fetch failure | Centered red text (`vscode-errorForeground`) + `Retry` link |
| Invalid time range | Server treats as "all time" |
| `pricingUnavailable` for a model | Tooltip shows "No pricing table entry for this model"; cost still rendered as best-effort if available |

---

## 8. Empty State Specification

| State | Display |
|---|---|
| No entries | "No token usage data found. Run some AI tasks to see stats here." |
| Loading | Centered "Loading…" |
| Error | Red error message + Retry link |

---

## 9. API Dependencies

| Endpoint | Used by | Critical for |
|---|---|---|
| `GET /api/stats/token-usage?days=<n>` (via `useTokenUsageStats(days)`) | Usage table data | US-01, US-02, US-03 |

The response shape is `ClientTokenUsageStatsResponse` with `entries[]` (date / byModel / dayTotal), a sorted `models[]`, `generatedAt`, and `totalDays` (see `types/dashboard.ts`).

---

## Revision History

| Version | Date | Summary |
|---|---|---|
| 1.0.0 | 2026-03-25 | Initial specification (top-level Usage tab; flat input/output cell + simple cost) |
| 2.0.0 | 2026-05-29 | Embedded inside Admin shell's Operations group; sidebar label changed to "Usage & Costs"; cell layout now shows `↓<input> total · <cached> · <new>` and `↑<output> · <cacheWrite>`; cost details (`costBreakdown`, `estimatedUsdCost`, premium units, pricing source / unavailable) surfaced via tooltip and Total column. |
| 3.0.0 | 2026-06-05 | Redesigned from column-per-model table to 3-column row-based layout (Date / Model / Tokens). Models are stacked as rows within each date group, keeping the table width fixed regardless of model count. |
