# UX Spec: Create Pipeline with Natural Language

> **Feature URL:** `http://localhost:4000/#repos/{workspaceId}/pipelines`
> **Current State:** The "AI Generated" template option is a placeholder that outputs a static YAML stub — no AI involved.

---

## 1. User Story

**As a** developer using the CoC dashboard,
**I want to** describe what my pipeline should do in plain English,
**so that** the system generates a valid pipeline YAML for me — without needing to learn the YAML schema upfront.

### Target Persona

- Developers who know *what* they want to process but are unfamiliar with the pipeline YAML schema (three modes: map-reduce, single job, DAG workflow).
- Power users who want to quickly scaffold a pipeline and then fine-tune the YAML.

---

## 2. Entry Points

| Entry Point | Location | Action |
|---|---|---|
| **"+ New Pipeline" button** | Top of Pipelines left panel | Opens the enhanced creation dialog |
| **Template dropdown → "AI Generated"** | Inside the Add Pipeline dialog | Reveals the natural language prompt area |

No new commands, keyboard shortcuts, or context menus are needed — the feature lives entirely within the existing pipeline creation flow in the dashboard SPA.

---

## 3. User Flow

### 3.1 Primary Flow — Natural Language Pipeline Creation

```
┌─────────────────────────────────────────────────────────────────────┐
│  Pipelines Tab                                                      │
│  ┌──────────┐                                                       │
│  │+ New     │  ← User clicks                                       │
│  │ Pipeline │                                                       │
│  └──────────┘                                                       │
│         │                                                           │
│         ▼                                                           │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │  Create New Pipeline (Dialog)                               │    │
│  │                                                             │    │
│  │  Name: [my-classifier          ]                            │    │
│  │                                                             │    │
│  │  Template: [ AI Generated ▾ ]                               │    │
│  │                                                             │    │
│  │  ┌─────────────────────────────────────────────────────┐    │    │
│  │  │ Describe what your pipeline should do:              │    │    │
│  │  │                                                     │    │    │
│  │  │ Read bugs.csv and classify each bug by severity     │    │    │
│  │  │ (critical/high/medium/low) and component area.      │    │    │
│  │  │ Then produce a summary report grouped by severity.  │    │    │
│  │  │                                                     │    │    │
│  │  └─────────────────────────────────────────────────────┘    │    │
│  │  80 / 2000 characters                                      │    │
│  │                                                             │    │
│  │  💡 Tip: Mention your data source, what to do with each    │    │
│  │     item, and what the final output should look like.       │    │
│  │                                                             │    │
│  │           [ Cancel ]  [ Generate Pipeline ✨ ]              │    │
│  └─────────────────────────────────────────────────────────────┘    │
│         │                                                           │
│         ▼  (loading state)                                          │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │  Generating...                                              │    │
│  │  ████████████░░░░░░░░  Generating pipeline YAML...          │    │
│  │                                                             │    │
│  │  ⏱ This usually takes 10–30 seconds.                       │    │
│  │           [ Cancel ]                                        │    │
│  └─────────────────────────────────────────────────────────────┘    │
│         │                                                           │
│         ▼  (preview state)                                          │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │  Review Generated Pipeline                                  │    │
│  │                                                             │    │
│  │  ┌─ YAML Preview ──────────────────────────────────────┐    │    │
│  │  │ name: "Bug Classifier"                              │    │    │
│  │  │ description: "Classifies bugs by severity and..."   │    │    │
│  │  │ input:                                              │    │    │
│  │  │   from:                                             │    │    │
│  │  │     type: csv                                       │    │    │
│  │  │     path: "bugs.csv"                                │    │    │
│  │  │ map:                                                │    │    │
│  │  │   prompt: |                                         │    │    │
│  │  │     Classify this bug: {{title}}                    │    │    │
│  │  │     ...                                             │    │    │
│  │  └─────────────────────────────────────────────────────┘    │    │
│  │                                                             │    │
│  │  ✅ Valid pipeline                                          │    │
│  │                                                             │    │
│  │  [ ← Back ]  [ Regenerate 🔄 ]  [ Save Pipeline ✓ ]       │    │
│  └─────────────────────────────────────────────────────────────┘    │
│         │                                                           │
│         ▼                                                           │
│  Pipeline saved → auto-selected in list → PipelineDetail opens     │
└─────────────────────────────────────────────────────────────────────┘
```

### 3.2 Step-by-Step

| Step | User Action | System Response |
|------|-------------|-----------------|
| 1 | Clicks **"+ New Pipeline"** | Dialog opens with Name field + Template dropdown |
| 2 | Enters pipeline name (e.g., `my-classifier`) | Name validated in real-time (alphanumeric + hyphens) |
| 3 | Selects **"AI Generated"** from Template dropdown | Textarea prompt area slides in below the dropdown |
| 4 | Types a natural language description | Character counter updates; tip text remains visible |
| 5 | Clicks **"Generate Pipeline ✨"** | Dialog transitions to loading state with progress indicator |
| 6 | *(waits 10–30s)* | AI generates YAML; dialog transitions to preview state |
| 7 | Reviews the YAML preview | Validation badge shown (✅ Valid or ⚠️ with errors) |
| 8a | Clicks **"Save Pipeline ✓"** | Pipeline saved to `.vscode/pipelines/{name}/pipeline.yaml`, dialog closes, pipeline auto-selected in list |
| 8b | Clicks **"Regenerate 🔄"** | Returns to loading state, generates a new version |
| 8c | Clicks **"← Back"** | Returns to prompt editing step (description preserved) |

### 3.3 Dialog States

The dialog has **three states**, presented as a single evolving dialog (not separate pages):

1. **Input** — Name + Template + Description prompt
2. **Generating** — Spinner/progress, cancel button
3. **Preview** — YAML preview with validation, save/regenerate/back actions

---

## 4. Edge Cases & Error Handling

| Scenario | Behavior |
|----------|----------|
| **Empty description** | "Generate Pipeline" button disabled; subtle hint: "Describe what your pipeline should do" |
| **Description too short** (< 10 chars) | Button disabled; hint: "Please provide more detail" |
| **AI generation fails** (network/timeout) | Error banner in dialog: "Generation failed. Please try again." + "Retry" button; original description preserved |
| **AI unavailable** (no Copilot session) | Error banner: "AI service is not available. Please ensure GitHub Copilot is running." Falls back to showing standard template options |
| **Generated YAML is invalid** | Preview state shows ⚠️ badge with validation errors; user can still save (with warning) or regenerate |
| **Pipeline name already exists** | Inline error on name field: "A pipeline with this name already exists" (same as current behavior) |
| **User cancels during generation** | Returns to input state; description preserved |
| **Very long description** (> 2000 chars) | Character counter turns red; input truncated at 2000 |
| **Non-template selection** (Custom, Data Fan-out, Model Fan-out) | Prompt area hidden; dialog behaves exactly as today |

---

## 5. Visual Design Considerations

### 5.1 Dialog Enhancements

- **Prompt textarea**: 4–6 rows, monospace not needed (it's natural language), placeholder text: *"e.g., Read a CSV of customer tickets, classify each by urgency and department, then summarize counts by category"*
- **Character counter**: Subtle gray text below textarea, turns red near limit
- **Tip block**: Light blue/gray info box with 💡 icon, always visible below textarea
- **Generate button**: Primary action style with ✨ emoji to signal AI involvement
- **Loading indicator**: Animated spinner or pulsing bar (matches dashboard theme)
- **YAML preview**: Monospace `<pre>` block with dark background (same style as PipelineDetail view mode), scrollable, max-height ~300px

### 5.2 Validation Badge in Preview

- ✅ **Valid** — Green badge, "Save Pipeline" button is primary/enabled
- ⚠️ **Invalid** — Amber badge with collapsible error list; "Save Pipeline" still available but shows a confirmation warning

### 5.3 Theme Compatibility

All new elements must respect the dashboard's existing dark/light/auto theme system. Use existing CSS variables and utility classes.

---

## 6. Settings & Configuration

| Setting | Location | Default | Description |
|---------|----------|---------|-------------|
| **AI model for generation** | `~/.coc.yaml` → `model` | Server default | Which model to use for YAML generation |
| **Generation timeout** | `~/.coc.yaml` → `timeout` | 60s | Max time to wait for AI response |

No new settings are needed in the dashboard UI itself — the feature piggybacks on existing CoC configuration.

---

## 7. Discoverability

- **Template dropdown label**: Rename from "AI Generated" → **"AI Generated (describe in natural language)"** to make the capability clear
- **Placeholder text** in the textarea serves as a built-in example
- **Tip block** below the textarea teaches users what to include
- **Empty state enhancement**: In the "No pipelines found" empty state, add a secondary line: *"Create your first pipeline by describing what it should do in plain English."*

---

## 8. API Changes Required

### New Endpoint

```
POST /api/workspaces/:id/pipelines/generate
Body: { description: string, name: string }
Response: { yaml: string, valid: boolean, errors?: string[] }
```

This endpoint:
1. Takes the natural language description
2. Calls the AI (CopilotSDKService) with a system prompt derived from the pipeline-generator skill's knowledge (schema rules, template patterns, validation constraints)
3. Parses and validates the generated YAML
4. Returns the YAML string + validation result

### Modified Endpoint

The existing `POST /api/workspaces/:id/pipelines` (create) remains unchanged — the SPA calls `/generate` first, shows the preview, then calls the existing create endpoint with the generated YAML content (potentially via a new `content` field in the body alongside `name`).

---

## 9. Out of Scope (for this iteration)

- **Conversational refinement** — "Make it process JSON instead of CSV" follow-up turns (future enhancement)
- **Inline AI editing** in the PipelineDetail editor — editing existing pipelines via natural language
- **Multi-step wizard** with structured questions (the pipeline-generator skill's Q&A approach) — keep it simple with a single free-form prompt
- **Pipeline execution** from the dashboard — separate feature
- **YAML syntax highlighting** in the preview — nice-to-have, not blocking
