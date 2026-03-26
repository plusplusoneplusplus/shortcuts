# Models Tab — UI/UX Specification

**Document type:** Formal UX Specification  
**Scope:** CoC Dashboard → Models (Top-Level Tab)  
**Purpose:** Authoritative reference for validating any future UI/UX changes to the Models tab.  
**Version:** 1.0.0

---

## 1. Overview

The **Models Tab** is a top-level dashboard tab for viewing and managing available AI models. It displays a responsive grid of model cards with search, capability filtering, and per-model enable/disable toggles. Clicking a card copies the model ID to the clipboard. Enabled model state is persisted to `~/.coc/config.yaml`.

### 1.1 Tab Identity

| Property | Value |
|---|---|
| Tab label | `Models` |
| Tab position | Top-level tab |
| Default tab | No |
| URL fragment | `#models` |

---

## 2. User Personas

| Persona | Description | Primary Goal |
|---|---|---|
| **Developer** | Engineers selecting models for AI tasks | Browse available models, copy model IDs |
| **Administrator** | Users managing which models are available | Enable/disable models, filter by capability |

---

## 3. User Stories

**US-01 — Browse available models**
> As a developer, I want to see all available AI models.

- **Given** the Models tab is open
- **When** models are loaded
- **Then** a responsive grid shows model cards with display name, model ID (monospace), context window size, and capability badges (Vision, Reasoning)

---

**US-02 — Search models**
> As a developer, I want to search for a model by name.

- **Given** the Models tab is open
- **When** the user types in the search input
- **Then** the grid filters to show only models matching the search term

---

**US-03 — Filter by capability**
> As a developer, I want to filter models by capability.

- **Given** the Models tab is open
- **When** the user selects a capability filter (All / Vision / Reasoning)
- **Then** the grid filters to show only models with the selected capability

---

**US-04 — Copy model ID**
> As a developer, I want to quickly copy a model's ID.

- **Given** a model card is visible
- **When** the user clicks the card
- **Then** the model ID is copied to the clipboard and a "Copied!" overlay appears for ~1.5 seconds

---

**US-05 — Enable or disable a model**
> As an administrator, I want to control which models are available for use.

- **Given** a model card is visible
- **When** the user clicks the enable/disable toggle
- **Then** the model's enabled state changes; `PUT /api/models/enabled` persists the full enabled model list to `~/.coc/config.yaml`

---

**US-06 — View enabled count**
> As an administrator, I want to see how many models are enabled.

- **Given** the Models tab is open
- **When** models are loaded
- **Then** the toolbar shows "X of Y enabled" (with "…" suffix while saving)

---

## 4. Feature Inventory & Acceptance Criteria

### 4.1 Toolbar

| Feature | Acceptance Criteria |
|---|---|
| Search input | "Search models…" placeholder; filters grid |
| Capability filter | Dropdown: All, Vision, Reasoning |
| Model count | Shows count of filtered models |
| Enabled count | "X of Y enabled"; "…" while saving |

### 4.2 Model Grid

| Feature | Acceptance Criteria |
|---|---|
| Responsive layout | `grid-cols-1` → `xl:grid-cols-4` |
| Card as button | Entire card is clickable; copies model ID |
| Enable toggle | Top-right corner; `stopPropagation`; pill switch; `aria-label` Disable/Enable; `aria-disabled` when saving |
| Card content | Display name or ID; monospace ID; context window (when > 0); Vision/Reasoning badges |
| Border color | Green when enabled; gray when disabled |
| "Copied!" overlay | Appears for ~1.5s after click; clipboard failure is silent |

---

## 5. Behavioral Invariants

| ID | Invariant |
|---|---|
| INV-01 | Toggle uses optimistic update; reverts to server state on PUT failure |
| INV-02 | `PUT /api/models/enabled` sends the full list of enabled model IDs, not a delta |
| INV-03 | If the model store is empty, the server falls back to static models from forge's `getAllModels()` |
| INV-04 | Clipboard copy failure is silently handled (no error shown) |
| INV-05 | The toggle `stopPropagation` prevents the card click (copy) from firing when toggling |

---

## 6. UI Layout Specification

```
┌─────────────────────────────────────────────────────────────────────┐
│  CoC │ Processes │ Wiki │ Memory │ Skills │ Usage │ Logs │ Models*  │
├─────────────────────────────────────────────────────────────────────┤
│  [🔍 Search models…]  [Capability: All ▼]  12 models  8 of 12 on  │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌────────────────┐  ┌────────────────┐  ┌────────────────┐       │
│  │ GPT-4o    [🔘] │  │ Claude 3.5[🔘] │  │ GPT-4    [🔘] │       │
│  │ gpt-4o         │  │ claude-3.5-s…  │  │ gpt-4          │       │
│  │ ───────────    │  │ ───────────    │  │ ───────────    │       │
│  │ Context: 128k  │  │ Context: 200k  │  │ Context: 128k  │       │
│  │ [Vision]       │  │ [Vision]       │  │ [Reasoning]    │       │
│  └────────────────┘  └────────────────┘  └────────────────┘       │
│                                                                     │
│  ┌────────────────┐  ┌────────────────┐  ┌────────────────┐       │
│  │ o1        [🔘] │  │ Gemini Pro[○ ] │  │ GPT-4o-mi[🔘] │       │
│  │ o1             │  │ gemini-1.5-pro │  │ gpt-4o-mini    │       │
│  │ ───────────    │  │ ───────────    │  │ ───────────    │       │
│  │ Context: 200k  │  │ Context: 1M    │  │ Context: 128k  │       │
│  │ [Reasoning]    │  │ [Vision]       │  │ [Vision]       │       │
│  └────────────────┘  └────────────────┘  └────────────────┘       │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 7. Error Handling Specification

| Error Scenario | Expected Behavior |
|---|---|
| Model list fetch failure | Error message + Retry button |
| Toggle save failure | Reverts to last server state |
| Clipboard copy failure | Silent (no error shown) |

---

## 8. Empty State Specification

| State | Display |
|---|---|
| No models match filter | "No models match your filter." + Clear button (resets search + capability filter) |
| Loading | Full viewport "Loading models…" |

---

## 9. API Dependencies

| Endpoint | Used by | Critical for |
|---|---|---|
| `GET /api/models` | Model list | US-01 |
| `GET /api/models/enabled` | Enabled model IDs | US-05 |
| `PUT /api/models/enabled` | Persist enabled state | US-05 |

---

## Revision History

| Version | Date | Summary |
|---|---|---|
| 1.0.0 | 2026-03-25 | Initial specification |
