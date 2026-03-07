# UX Spec: "Edit with AI" Right Sidebar Panel

## Overview

Redesign the "Edit with AI" interaction in the Workflows tab from a full-page panel takeover into a **persistent right sidebar** that slides in alongside the existing workflow view — letting users see the YAML and the AI conversation simultaneously.

---

## 1. User Story

**As a** developer managing CoC pipelines in the dashboard,  
**I want** to ask AI to edit my workflow YAML while still seeing the original content and flow preview,  
**So that** I can provide better context, compare changes in place, and iterate without losing my bearings.

**Pain point today:** Clicking "Edit with AI" replaces the entire Workflow view with `PipelineAIRefinePanel`. The user loses sight of the original YAML and the DAG preview, making it harder to write a good instruction or understand what changed.

---

## 2. Entry Points

| Trigger | Behavior |
|---------|----------|
| **"Edit with AI ✨" button** (top-right, Workflow tab) | Opens the right sidebar; button becomes "Close AI" |
| **Keyboard shortcut** `Ctrl+Shift+A` / `Cmd+Shift+A` | Toggles the sidebar open/closed |
| **Sidebar already open** → click button again | Closes the sidebar, restoring full-width view |

The sidebar does **not** open automatically on any other action — it is always user-initiated.

---

## 3. User Flow

### 3.1 Primary Flow — Happy Path

```
[Workflow tab — full width]
    YAML preview + DAG visible
    "Edit with AI ✨" button in header
         │
         ▼ click
[Sidebar slides in from right ~40% width]
    Left panel: YAML + DAG (shrinks to ~60%)
    Right panel: AI Edit sidebar
         │
         ├─ Phase 1 · INSTRUCT
         │   ┌────────────────────────────────┐
         │   │ 💬 Describe what you want…     │
         │   │ [                            ] │
         │   │ [  multiline textarea         ] │
         │   │ [  min 10 / max 2000 chars    ] │
         │   └────────────────────────────────┘
         │   [Refine with AI →]   (primary CTA)
         │
         ▼ submit
         ├─ Phase 2 · REFINING
         │   Spinner + "AI is editing your workflow…"
         │   [Cancel] link to abort
         │
         ▼ result
         └─ Phase 3 · REVIEW
             Unified diff rendered in sidebar
             (green additions, red deletions, unchanged gray)
             ┌────────────┐  ┌────────────┐
             │ ✓ Apply    │  │ ✗ Discard  │
             └────────────┘  └────────────┘
             [← Try a different instruction]   (back link)
```

### 3.2 After Apply

- YAML and DAG preview in the left panel **update in place** (no full reload).
- Sidebar returns to **Phase 1 (INSTRUCT)** — empty textarea, ready for next iteration.
- A brief success toast: "Workflow updated ✓" appears at top of sidebar.
- The "Edit" and "Run" buttons in the main header remain accessible throughout.

### 3.3 Discard / Cancel

- Returns directly to Phase 1 in the sidebar.
- Left panel YAML is unchanged.

---

## 4. Visual Layout

### Desktop (≥1024 px)

```
┌──────────────────────────────────────────────────────────────────┐
│  git-fetch   D:\…   ✅ Valid    [▶ Run]  [Close]  [Edit]  [Edit with AI ✨ ×]  │
├────────────────────────────────────┬─────────────────────────────┤
│  Workflow   Run History            │  ✨ Edit with AI             │
│                                    │  ─────────────────────────  │
│  name: git-fetch                   │  Describe what to change:   │
│  job:                              │  ┌─────────────────────────┐│
│    prompt: "…"                     │  │                         ││
│                                    │  │                         ││
│  ▼ Workflow Flow Preview           │  └─────────────────────────┘│
│                                    │  [Refine with AI →]         │
│      [1 Job]                       │                             │
│    ┌──────────┐                    │                             │
│    │   Job    │                    │                             │
│    └──────────┘                    │                             │
└────────────────────────────────────┴─────────────────────────────┘
```

- **Sidebar width:** 380–420 px fixed on desktop; 40% on medium screens.
- **Resize handle** (optional v2): draggable divider to adjust split.
- Sidebar header shows: `✨ Edit with AI` title + `×` close icon (top-right).
- Uses existing `ResponsiveSidebar` component.

### Tablet (768–1023 px)

Same split layout; sidebar collapses to 50% width.

### Mobile (<768 px)

Sidebar renders as a **bottom sheet** (consistent with `ItemConversationPanel` on mobile). Full-screen height, drag-to-dismiss handle at top.

---

## 5. Sidebar Anatomy

### Header
```
┌─────────────────────────────────┐
│ ✨ Edit with AI          [×]    │
│ git-fetch                       │  ← current workflow name (subtle, small)
└─────────────────────────────────┘
```

### Phase 1 — Instruct
- Placeholder: *"e.g. Add a retry policy with 3 attempts"*
- Character counter: `0 / 2000` bottom-right of textarea
- Primary button: **Refine with AI →** (disabled until ≥10 chars)
- History accordion (collapsed by default): last 3 successful instructions, clickable to re-apply

### Phase 2 — Refining
- Full-width spinner (matches existing dashboard spinner)
- Subtext: *"Analyzing workflow and generating changes…"*
- **Cancel** text link centered below

### Phase 3 — Review
- Diff viewer: monospace font, line numbers, color-coded hunks
- Two-button row: **✓ Apply Changes** (primary) | **✗ Discard** (ghost)
- Back link: *← Edit instruction* (returns to Phase 1 with textarea pre-filled with previous instruction)
- If diff is empty (no changes): show inline notice *"No changes suggested. Try rephrasing your instruction."* + back link.

---

## 6. Edge Cases & Error Handling

| Scenario | Behavior |
|----------|----------|
| AI returns no diff | Phase 3 shows "No changes suggested" notice + back link |
| Network / API error | Inline error banner in sidebar: "Something went wrong. [Retry]" |
| Request cancelled by user | Return to Phase 1, textarea retains instruction |
| User navigates away mid-edit | Sidebar state is **preserved** if user returns to same workflow within the session |
| User opens a different workflow | Sidebar closes; state is cleared |
| YAML invalid after apply | Toast warning: "Applied but workflow is now invalid — check YAML" |

---

## 7. Visual Design Considerations

### Icons
- `✨` spark emoji or equivalent icon for the "Edit with AI" button label (already in use)
- `×` close icon in sidebar header (standard, reuse existing)
- Standard spinner for Phase 2 (reuse existing)

### Diff Colors
- **Added lines:** green background `#d1fae5` / dark mode `#064e3b`
- **Removed lines:** red background `#fee2e2` / dark mode `#7f1d1d`
- **Unchanged context:** neutral gray text, dimmed
- Line numbers in a narrow gutter column

### Sidebar Transition
- Slide-in from right: CSS `transform: translateX(100%)` → `translateX(0)`, duration 200ms ease-out
- Left panel smoothly narrows (CSS flex transition)

### Status Indicator
- Button in header changes appearance when sidebar is open: filled/active state with `×` suffix
- No modal overlay — sidebar is non-blocking

---

## 8. Settings & Configuration

| Setting | Key | Default | Description |
|---------|-----|---------|-------------|
| Default sidebar width | `coc.editWithAI.sidebarWidth` | `400` | Width in pixels (desktop) |
| Persist instruction history | `coc.editWithAI.historySize` | `3` | How many past instructions to remember per session |

Sensible defaults: sidebar opens at 400 px; no history persistence across page reloads (session-only).

---

## 9. Discoverability

- **Button label is explicit**: "Edit with AI ✨" — no icon-only ambiguity.
- **Tooltip** on hover: *"Ask AI to modify this workflow"*
- **First-time hint** (one-time): small dismissible callout inside the sidebar on first open: *"Describe a change in plain English and AI will edit the YAML for you."*
- **Keyboard shortcut** shown in tooltip after initial use.

---

## 10. Out of Scope (v1)

- Streaming / token-by-token diff preview (full response only)
- Multi-turn conversation history persisted across sessions
- Inline code editor in the sidebar (diff-only, no manual edit)
- Applying partial hunks from the diff

---

## Related Files

| File | Role |
|------|------|
| `packages/coc/src/server/spa/client/react/repos/PipelineDetail.tsx` | Add sidebar toggle logic, layout split |
| `packages/coc/src/server/spa/client/react/repos/PipelineAIRefinePanel.tsx` | Adapt as sidebar content (remove full-page wrapper) |
| `packages/coc/src/server/spa/client/react/shared/ResponsiveSidebar.tsx` | Reuse as sidebar shell |
| `packages/coc-server/src/handlers/pipeline-handlers.ts` | `/refine` API (no changes needed) |
