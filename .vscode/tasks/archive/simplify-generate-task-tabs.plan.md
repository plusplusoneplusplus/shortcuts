# Simplify Generate Task Dialog — Two Tabs (Effort vs Advanced)

## Problem

The `GenerateTaskDialog` in the CoC SPA (`packages/coc/src/server/spa/client/react/tasks/GenerateTaskDialog.tsx`) currently shows all configuration fields (Model, Priority, Depth) in a flat list at the bottom of the form. This clutters the UI for users who just want a quick "effort level" selection.

## Proposed Approach

Replace the flat Model/Priority/Depth section with a **two-tab configuration area** below the common fields (Prompt, Task name, Target folder, Include folder context). The common fields remain always visible; only the bottom configuration section switches between tabs.

### Tab 1: "Effort" (default)
- Three radio-style buttons: **Low**, **Medium**, **High**
- Each effort level maps to sensible defaults for Model, Priority, and Depth:
  - **Low** → fast/cheap model, low priority, normal depth
  - **Medium** → standard model, normal priority, normal depth  
  - **High** → premium model, normal priority, deep depth
- This is the simplified UX for most users

### Tab 2: "Advanced"
- Contains the existing three dropdowns: **Model**, **Priority**, **Depth**
- Identical to current behavior
- Switching to this tab overrides any Effort preset

## Files to Change

| File | Change |
|------|--------|
| `packages/coc/src/server/spa/client/react/tasks/GenerateTaskDialog.tsx` | Add tab UI below the checkbox, replace flat Model/Priority/Depth with tabbed section |
| `packages/coc/test/spa/react/GenerateTaskDialog.test.tsx` | Update tests for new tab structure |

## UI Layout (after change)

```
┌─────────────────────────────────────────┐
│ Generate Task                     _ × │
├─────────────────────────────────────────┤
│ Prompt                                  │
│ ┌─────────────────────────────────────┐ │
│ │ Describe the task to generate…      │ │
│ └─────────────────────────────────────┘ │
│                                         │
│ Task name (optional)                    │
│ ┌─────────────────────────────────────┐ │
│ │ Leave blank — AI will decide        │ │
│ └─────────────────────────────────────┘ │
│                                         │
│ Target folder (optional)                │
│ ┌─────────────────────────────────────┐ │
│ │ coc/tasks                        ▾  │ │
│ └─────────────────────────────────────┘ │
│                                         │
│ ☐ Include folder context                │
│   Attach plan.md, spec.md, …            │
│                                         │
│ ─────────────────────────────────────── │
│                                         │
│  [ Effort ]  [ Advanced ]               │
│                                         │
│  ┌─────┐  ┌────────┐  ┌──────┐         │
│  │ Low │  │ Medium │  │ High │         │
│  └─────┘  └────────┘  └──────┘         │
│                                         │
│               [Close]  [Generate ⌘↩]    │
└─────────────────────────────────────────┘
```

## Todos

1. **effort-tab-ui** — ✅ Add the two-tab layout (Effort / Advanced) to `GenerateTaskDialog.tsx`. The "Effort" tab shows Low/Medium/High radio buttons. The "Advanced" tab shows the existing Model, Priority, Depth dropdowns.
2. **effort-mapping** — ✅ Define the effort→settings mapping (Low/Medium/High → model, priority, depth). When user selects an effort level and the "Effort" tab is active, populate model/priority/depth from the mapping before submitting.
3. **update-tests** — ✅ Update `GenerateTaskDialog.test.tsx` for the new tab structure: test tab switching, effort selection, and that Advanced still works.

## Notes

- This is **UI-first** — no backend changes needed. The same `enqueue()` call sends model/priority/depth regardless of which tab set them.
- The `usePreferences` hook already persists model and depth; we may want to also persist the last-used effort level or active tab.
- The effort presets need a model list from the API to map "fast/cheap" vs "premium". We can use index-based selection from the `models` array or hardcode well-known model prefixes (e.g., `haiku` → fast, `opus` → premium).
