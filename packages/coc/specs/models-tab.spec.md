# Provider Models Section — UI/UX Specification

**Document type:** Formal UX Specification  
**Scope:** CoC Dashboard → Admin → AI Provider (embedded `ProviderModelsSection`)  
**Purpose:** Authoritative reference for validating any future UI/UX changes to the per-provider model catalog and ad-hoc query UI.  
**Version:** 2.0.0

---

## 1. Overview

The **Provider Models Section** is an embedded section inside the Admin shell's **AI Provider** sub-tab (renamed "Agents" in container mode). It is **no longer a top-level dashboard tab** — there is no `#models` route and no entry in `DashboardTab`. Instead, `ProviderModelsSection` is mounted by `AdminPanel` directly below the Default Provider card, and is scoped to one provider at a time (`copilot`, `codex`, or `claude`).

The section has two view modes:

- **Catalog** (default): grid of model cards with search, capability filtering, per-model enable toggles, click-to-copy, and per-model reasoning-effort selection.
- **Query**: ad-hoc one-shot prompt against a chosen model, with response/error/duration display.

The previous unified "all-models" view has been replaced by this provider-scoped section so per-provider catalogs (Copilot, Codex SDK, Claude SDK) stay distinct.

### 1.1 Component Identity

| Property | Value |
|---|---|
| Section name | `ProviderModelsSection` (`features/models/ProviderModelsSection.tsx`) |
| Mount site | Inside `AdminPanel` → `agents` sub-tab, rendered for the currently selected `defaultProvider` |
| Route | None — accessed via `#admin/agents` (or `#admin/messaging`-adjacent for container mode) |
| Tab label (container) | "Agents" |
| Tab label (default) | "AI Provider" |
| Main test ids | `provider-models-section`, `provider-models-grid`, `provider-models-tab-catalog`, `provider-models-tab-query` |

---

## 2. User Personas

| Persona | Description | Primary Goal |
|---|---|---|
| **Developer** | Engineers selecting models for AI tasks | Browse the per-provider catalog, copy model IDs, run quick prompts |
| **Administrator** | Users curating which models are exposed | Enable/disable models, set per-model reasoning effort defaults |
| **Power user** | Reasoning-aware users tuning effort levels | Pick from supported reasoning-effort tiers per model |

---

## 3. User Stories

### 3.1 Section Mount

**US-01 — Mount the section for the active provider**
> As an administrator, I want the embedded model catalog to follow my default provider selection.

- **Given** the AI Provider tab is active and the default provider is `<P>`
- **When** the panel mounts
- **Then** `ProviderModelsSection` is rendered with `provider={P}` and `available={P-availability}`
- **And** when the provider is unavailable (not enabled, not installed, or auth missing), an `provider-models-unavailable` panel renders with a configuration hint

---

### 3.2 Catalog View

**US-02 — Browse provider models**
> As a developer, I want to see the catalog for the selected provider.

- **Given** Catalog view is active (default)
- **When** models load via `GET /api/agent-providers/<provider>/models`
- **Then** a grid (`grid-cols-1 sm:grid-cols-2 lg:grid-cols-3`) of model cards is rendered with display name (or ID), monospace ID, optional context window (`Context: <fmt(n)>`), capability badges (`👁 Vision`, `🧠 Reasoning`), and per-model reasoning-effort chips when supported

---

**US-03 — Search models**
> As a developer, I want to filter the grid by name or ID.

- **Given** Catalog view is active
- **When** the user types in the search input (`provider-models-search`)
- **Then** the grid filters case-insensitively against `id` and `name`

---

**US-04 — Filter by capability**
> As a developer, I want to narrow to vision or reasoning models.

- **Given** Catalog view is active
- **When** the user changes the capability `<select>` (`provider-models-filter`)
- **Then** the grid keeps only models whose `capabilities.supports.vision` or `.reasoningEffort` matches the selected `all` / `vision` / `reasoning` filter

---

**US-05 — Copy a model ID**
> As a developer, I want to quickly grab a model's ID.

- **Given** a model card is visible
- **When** the user clicks the card body (not the toggle / not an effort chip)
- **Then** `navigator.clipboard.writeText(model.id)` runs and a "Copied!" overlay appears for ~1.5 s; clipboard failures are silently swallowed

---

**US-06 — Enable or disable a model**
> As an administrator, I want to control which models the assistant may use.

- **Given** a model card is visible
- **When** the user clicks the top-right toggle (`provider-model-toggle`)
- **Then** the toggle propagation is stopped (so the card-click does not also fire), the local state is updated optimistically, and `useProviderModelConfig.toggleModel` calls the server (`agentProviders.setEnabled`); failure reverts to the server state

---

**US-07 — Refresh catalog**
> As an administrator, I want to re-fetch the catalog after upstream changes.

- **Given** Catalog view is active
- **When** the user clicks the `↻` refresh button (`provider-models-refresh-btn`)
- **Then** `reload()` is called and the grid is repopulated

---

**US-08 — Pick a per-model reasoning effort**
> As a power user, I want to set a non-default reasoning effort per model.

- **Given** a model card lists supported reasoning efforts (chips with `data-testid="effort-<name>"`)
- **When** the user clicks an effort chip
- **Then** if the chip equals the current selected override, the override is cleared (chip click acts as toggle); otherwise `agentProviders.setReasoningEffort(provider, modelId, effort)` persists the new override
- **And** the chip indicator: active chip shows `★`, the default chip carries `data-default="true"`, and `(custom)` italic text appears next to the chip row when a non-default override is active

---

### 3.3 Query View

**US-09 — Run a one-shot prompt**
> As a developer, I want to test a model with an ad-hoc prompt.

- **Given** the user toggles to Query view (`provider-models-tab-query`)
- **Then** a two-column layout appears: left side has Model `<select>` (Provider default + each enabled model — falls back to all models if none enabled) and a Prompt `<textarea>`; right side has the Result panel
- **When** the user types a prompt and clicks **Run** (`provider-model-query-run`)
- **Then** `agentProviders.queryModel(provider, { prompt, model?, timeoutMs: 60000 })` is called
- **And** while running the button reads `Running…` and is disabled
- **And** on success the right panel shows the response (`<pre>`), plus a header `<model> · <durationMs>ms · <sessionId?>`
- **And** on failure the right panel shows a red `<pre>` with the server-formatted error

---

**US-10 — Empty query state**
> As a developer, I want a clear empty state.

- **Given** Query view is active and no query has run yet
- **Then** the result panel shows "No query result yet." (`provider-model-query-empty`)

---

### 3.4 Footer / Status

**US-11 — See model count and saving indicator**
> As an administrator, I want to know how many models match my filters and how many are enabled.

- **Given** Catalog view is active
- **Then** the header shows `<n> models` (`provider-models-count`) and `<enabled> of <total> enabled` (`provider-models-enabled-count`); while a toggle save is in flight an extra ` …` suffix appears in the enabled count

---

## 4. Feature Inventory & Acceptance Criteria

### 4.1 Header & View Toggle

| Feature | Acceptance Criteria |
|---|---|
| Provider title | "<Copilot \| Codex \| Claude> Models" |
| View toggle | Catalog / Query segmented control with `role="tab"` and `aria-selected` |
| Unavailable state | `provider-models-unavailable` panel with configurable message |
| Loading state | `provider-models-loading` text |
| Error state | `provider-models-error` + `Retry` button (`provider-models-retry`) |

### 4.2 Catalog View Toolbar

| Feature | Acceptance Criteria |
|---|---|
| Search | `🔍 Search models…` placeholder (`provider-models-search`) |
| Capability filter | `<select>` All / Vision / Reasoning (`provider-models-filter`) |
| Counts | `<n> models` + `<enabled> of <total> enabled[ …]` |
| Refresh | `↻` button (`provider-models-refresh-btn`) |
| Empty filter result | "No models match your filter." + inline `Clear` button (resets search + capability to `all`) |
| Empty catalog | "No models available from `<provider>`." |

### 4.3 Model Card

| Feature | Acceptance Criteria |
|---|---|
| Card as button | Entire card is `<button>`; clicking copies model ID |
| Border color | Green when enabled, gray when disabled |
| Toggle | Top-right pill (`provider-model-toggle`); `stopPropagation` so card click does not also fire; `aria-label` "Disable model" / "Enable model"; `aria-disabled` while saving; inner `toggle-on` / `toggle-off` testid |
| Display name | `model.name` or `model.id` |
| Model ID | Monospace below name |
| Context window | `Context: <fmt>` (k / M abbreviation) when > 0 |
| Capability badges | `👁 Vision` (`badge-vision`) green; `🧠 Reasoning` (`badge-reasoning`) blue |
| Reasoning-effort chips | Rendered when `supportedReasoningEfforts.length > 0` (`reasoning-efforts` container); chip per effort with `data-testid="effort-<name>"`, `data-active="true\|false"`, `data-default="true\|false"`; active chip highlighted + suffixed `★`; clicking the same selected chip clears the override |
| Custom indicator | `(custom)` italic text after chips when a non-default override is active (`effort-override-indicator`) |
| Copied overlay | `Copied!` overlay 1.5 s after copy (`copied-overlay`) |

### 4.4 Query View

| Feature | Acceptance Criteria |
|---|---|
| Layout | `grid-cols-1 xl:grid-cols-[minmax(0,480px)_minmax(0,1fr)]` (`provider-model-query-view`) |
| Model select | "Provider default" first, then enabled models (or all models if none enabled) |
| Prompt textarea | Min height 140 px, monospace |
| Run button | Disabled when prompt empty or running; reads "Running…" while in flight |
| Result | `<pre>` with response (`provider-model-query-result`) on success, red `<pre>` with error on failure (`provider-model-query-error`), or `No query result yet.` (`provider-model-query-empty`) |
| Result header | `<model> · <durationMs>ms · <sessionId>?` shown when `durationMs` is set |
| Timeout | Default 60 s |

### 4.5 Reasoning Efforts Hydration

| Feature | Acceptance Criteria |
|---|---|
| Initial load | `GET /api/agent-providers/<provider>/reasoning-efforts` populates the `reasoningEfforts` map; missing/non-object responses are silently ignored |
| Persist | `setReasoningEffort(provider, modelId, effort)` writes to the server; failure reverts the local map |
| Clear | Empty-string effort (selected = current) deletes the override and re-saves |

---

## 5. Behavioral Invariants

| ID | Invariant |
|---|---|
| INV-01 | Models is no longer a top-level dashboard tab. There is no `#models` route and no `'models'` value in `DashboardTab`. The previous endpoints `GET /api/models`, `GET /api/models/enabled`, `PUT /api/models/enabled` are obsolete; per-provider routes under `/api/agent-providers/<provider>/...` replace them |
| INV-02 | The section is provider-scoped — Copilot, Codex, and Claude each have their own catalog. Switching the default provider in the parent panel re-mounts `ProviderModelsSection` with the new `provider` prop |
| INV-03 | Toggle save is optimistic; a server failure reverts the local state |
| INV-04 | Toggle `stopPropagation` prevents the card click (copy) from firing when toggling |
| INV-05 | Clipboard copy failure is silently handled (no error shown) |
| INV-06 | Reasoning-effort chips are only rendered when `supportedReasoningEfforts.length > 0` |
| INV-07 | Clicking the currently-selected chip clears the override; clicking the default chip when no override is set is a no-op |
| INV-08 | The Query view uses a separate prompt+result state and does not affect the catalog |
| INV-09 | When a provider is unavailable, only the configuration hint panel is rendered — no catalog, no query view |
| INV-10 | The Query view's model `<select>` defaults to enabled models; if none are enabled it falls back to the full model list so the user can still test something |

---

## 6. UI Layout Specification

```
┌── AI Provider sub-tab ────────────────────────────────────────────────┐
│ Default Provider: ( ) Copilot  ( ) Codex  ( ) Claude                  │
│ [Save]                                                               │
│                                                                      │
│ ┌── Provider Models (Copilot) ──────────────────────────────────────┐│
│ │ Copilot Models                  [Catalog*][Query]                 ││
│ │ [🔍 Search…] [All ▾]  12 models  8 of 12 enabled  [↻]             ││
│ │ ┌────────────┐ ┌────────────┐ ┌────────────┐                      ││
│ │ │ GPT-4o   ▣ │ │ o1       ▣ │ │ Claude 3.5 □│                     ││
│ │ │ gpt-4o     │ │ o1         │ │ claude-3-5  │                     ││
│ │ │ ──────     │ │ ──────     │ │ ──────      │                     ││
│ │ │ Context 128k│ │ Context 200│ │ Context 200k│                     ││
│ │ │ 👁 Vision  │ │ 🧠 Reasoning│ │ 👁 Vision   │                     ││
│ │ │             │ │ Effort: low│ │             │                     ││
│ │ │             │ │  med★ high │ │             │                     ││
│ │ └────────────┘ └────────────┘ └────────────┘                      ││
│ └───────────────────────────────────────────────────────────────────┘│
└──────────────────────────────────────────────────────────────────────┘
```

Query view (when toggled):

```
┌── Provider Models (Copilot) Query ───────────────────────────────────┐
│ Copilot Models                  [Catalog][Query*]                    │
│ ┌── Inputs ────────────┐  ┌── Result ────────────────────────────┐  │
│ │ Model [Provider d ▾] │  │  gpt-4o · 432ms · sess-abc           │  │
│ │ Prompt               │  │  <pre> response… </pre>              │  │
│ │ [textarea]           │  │                                      │  │
│ │ [Run]                │  │                                      │  │
│ └──────────────────────┘  └──────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────┘
```

---

## 7. Error Handling Specification

| Error Scenario | Expected Behavior |
|---|---|
| Catalog fetch failure | `provider-models-error` panel + `Retry` button |
| Toggle save failure | Optimistic update reverts to server state |
| Reasoning-effort save failure | Local state reverts to previous map |
| Reasoning-effort hydration failure | Silently ignored (override map starts empty) |
| Query timeout / failure | Red `<pre>` in result panel with server-formatted error |
| Clipboard copy failure | Silent (no error shown) |
| Provider unavailable | `provider-models-unavailable` panel — no catalog, no query |

---

## 8. Empty State Specification

| State | Display |
|---|---|
| No models from provider | "No models available from `<provider>`." (`provider-models-empty`) |
| No models match filter | "No models match your filter." + inline `Clear` link |
| No query result | "No query result yet." (`provider-model-query-empty`) |
| Loading | `Loading <provider> models…` (`provider-models-loading`) |

---

## 9. API Dependencies

All endpoints use the per-provider namespace:

| Endpoint | Used by | Critical for |
|---|---|---|
| `GET /api/agent-providers/<provider>/models` | Catalog list | US-02 |
| `agentProviders.toggleModel(provider, id, enabled)` (`POST` per-provider) | Enable/disable | US-06 |
| `GET /api/agent-providers/<provider>/reasoning-efforts` | Hydrate reasoning-effort overrides | US-08 |
| `agentProviders.setReasoningEffort(provider, modelId, effort)` | Persist per-model effort override | US-08 |
| `agentProviders.queryModel(provider, { prompt, model?, timeoutMs })` | Run ad-hoc query | US-09 |

The legacy `GET /api/models`, `GET /api/models/enabled`, `PUT /api/models/enabled` endpoints are removed.

---

## Revision History

| Version | Date | Summary |
|---|---|---|
| 1.0.0 | 2026-03-25 | Initial specification (top-level Models tab at `#models` over a unified `/api/models` catalog) |
| 2.0.0 | 2026-05-29 | Major rewrite: removed top-level Models tab; the catalog now renders as `ProviderModelsSection` embedded inside the Admin shell's AI Provider sub-tab, scoped per-provider. Added Catalog/Query view toggle, per-model reasoning-effort chips with default/active indicators, and per-provider endpoints under `/api/agent-providers/:provider/*`. Removed legacy `/api/models[/enabled]` endpoints. |
