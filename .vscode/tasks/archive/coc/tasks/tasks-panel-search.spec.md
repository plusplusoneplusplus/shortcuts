# Tasks Panel Search — UX Specification

## Requirement

The Tasks panel can accumulate many folders and documents (e.g., 155+ items in archive alone). Users need a way to quickly locate a specific task by name without manually drilling through Miller columns. A lightweight, always-available search bar should filter the visible tree in real time.

## High-Level Approach

Add a search input to the Tasks toolbar (between the action buttons and the tree). As the user types, flatten the Miller-column tree into a single filtered list showing all matching `TaskDocument` and `TaskDocumentGroup` items whose `baseName`, `fileName`, or `relativePath` contains the query (case-insensitive substring). Clearing the input restores the normal Miller-column navigation. The search box is a controlled React input with debounced filtering (~150 ms) and a clear ✕ button. No backend changes needed — filtering is purely client-side against the existing `tree: TaskFolder` prop.

---

## User Story

As a developer managing many task documents across folders, I want to type a keyword and instantly see matching tasks so I can open the right document without navigating folder by folder.

## Entry Points

| Entry Point | Action |
|---|---|
| Search input in toolbar | Always visible; type to filter |
| Keyboard shortcut | `Ctrl+F` / `Cmd+F` when Tasks panel is focused → focuses the search input |

## User Flow

1. **Initial state** — Search input is empty; Miller-column tree displays normally.
2. **User types** — After 150 ms debounce, the tree collapses into a flat, sorted list of matching items showing `baseName` and a dimmed `relativePath` breadcrumb.
3. **User clicks a result** — Opens TaskPreview for that document (same as clicking in the tree).
4. **User clears input** (✕ button or `Esc`) — Restores Miller-column view, optionally scrolling to the last-selected item.

## Edge Cases & Error Handling

- **No matches** — Show "No tasks match '{query}'" placeholder.
- **Empty folders** — Excluded from results (only documents/groups shown).
- **Archived items** — Include in results but render with muted/italic styling.
- **Special characters** — Treat query as literal substring, not regex.

## Visual Design

- Search input sits in the toolbar row, to the right of the existing buttons, with a magnifying-glass icon prefix and a ✕ clear button suffix.
- Filtered list items reuse `TaskTreeItem` styling but rendered in a single flat column.
- Highlight the matched substring in bold within each result.

## Settings & Configuration

- No new settings required. Search is always available, stateless, client-side only.

## Discoverability

- The input is always visible in the toolbar — no hidden affordance.
- Placeholder text: "Search tasks…"
