# UX Spec: Mini Sidebar (Collapsed State)

## User Story

As a user of the AI Execution Dashboard with multiple repositories, I want to see a compact icon-strip sidebar when I collapse the full sidebar, so I can still quickly identify and switch between repos without reopening the full panel.

**Current behavior:** Clicking the hamburger (☰) collapses the sidebar to `w-0` — completely hidden.
**Desired behavior:** Clicking the hamburger shrinks the sidebar to a narrow "mini" rail (~48px) showing color dots and abbreviated repo identifiers, keeping repo switching accessible at all times.

---

## Entry Points

| Trigger | Action |
|---------|--------|
| **Hamburger button (☰)** in TopBar | Toggles between full sidebar (280px) ↔ mini sidebar (48px) |
| **Click on mini-sidebar item** | Selects that repo in the detail pane (does NOT auto-expand the full sidebar) |
| **Double-click on mini-sidebar item** | Selects the repo AND expands the full sidebar |
| **Hover over mini-sidebar item** | Shows tooltip with full repo name + branch |

---

## Visual Design

### Mini Sidebar Layout (48px wide)

```
┌──────────┐
│  [+ btn] │  ← Small circular "+" button to add repos
│──────────│
│   🔵     │  ← Color dot + first letter of repo name
│   S      │
│──────────│
│   🔴     │  ← Selected item has highlight ring
│   S2     │
│──────────│
│   🟢     │
│   A      │
│          │
│          │
│          │
│──────────│
│  3 repos │  ← Compact footer (count only)
└──────────┘
```

### Mini-Sidebar Item

Each item is a **48×40px** clickable area, vertically stacked:

```
┌────────────────┐
│   ●  S         │   ● = repo color dot (10px)
│                │   S = first letter (or first 2 letters for disambiguation)
└────────────────┘
```

- **Color dot**: Same color as the repo's `workspace.color` — the primary identifier
- **Letter(s)**: First letter of `workspace.name`, uppercased, 11px font, muted text color
- **Selected state**: Left 3px accent border in `#0078d4` (same blue as the full sidebar ring)
- **Hover state**: Background lightens slightly (`bg-black/[0.04]` / `bg-white/[0.06]`)
- **Grouped repos**: When repos share a remote (clone group), show a subtle horizontal divider between groups — mirroring the grouping in the full sidebar

### Transitions

| Property | From | To | Duration |
|----------|------|----|----------|
| Sidebar width | 280px (full) | 48px (mini) | 150ms ease-out |
| Sidebar width | 48px (mini) | 280px (full) | 150ms ease-out |
| Content opacity (full sidebar) | 1 → 0 | at collapse start | 100ms |
| Content opacity (mini sidebar) | 0 → 1 | after collapse ends | 100ms (50ms delay) |

The full `ReposGrid` content fades out first, then the width shrinks. On expand, width grows first, then content fades in. This prevents a jarring "squish" of text.

---

## User Flow

### Collapsing

1. User clicks ☰ in the TopBar
2. The full sidebar (280px) smoothly transitions to 48px
3. `ReposGrid` content fades out, replaced by mini-sidebar items
4. Hamburger tooltip updates to "Expand repository sidebar"

### Selecting a Repo (Mini Mode)

1. User clicks a mini-sidebar item (color dot + letter)
2. The repo is selected — detail pane on the right updates
3. The mini sidebar stays visible (does NOT expand)
4. The selected item shows a left accent border

### Expanding

1. User clicks ☰ again (or double-clicks a mini item)
2. Sidebar expands from 48px → 280px
3. Mini items fade out, full `ReposGrid` fades in
4. The previously selected repo remains highlighted

### Adding a Repo (Mini Mode)

1. User clicks the small "+" button at the top of the mini sidebar
2. The `AddRepoDialog` opens as a modal (same as full sidebar)
3. After adding, the new repo appears in the mini sidebar

---

## Edge Cases & Error Handling

| Scenario | Behavior |
|----------|----------|
| **0 repos** | Mini sidebar shows only the "+" button and "No repos" text (rotated or small) |
| **Many repos (20+)** | Mini sidebar is scrollable (overflow-y-auto) |
| **Duplicate first letters** | Show first 2 characters (e.g., "Sh" and "Sn") — disambiguate within each visible group |
| **Very long repo names** | Tooltip on hover shows full name; mini sidebar always shows max 2 chars |
| **Window resize** | Mini sidebar stays at 48px; does not auto-expand |
| **Tab switch away from Repos** | Mini sidebar is hidden (same as current: sidebar is only for Repos tab) |
| **Return to Repos tab** | Sidebar restores to its last state (mini or full), preserving user preference |

---

## State Management

### AppContext Changes

The existing `reposSidebarCollapsed: boolean` is sufficient — no new state needed.

- `reposSidebarCollapsed = true` → render mini sidebar (48px)
- `reposSidebarCollapsed = false` → render full sidebar (280px)

The mini sidebar reads the same `repos` data and `selectedRepoId` from context.

### No Persistence Needed

The collapsed state already resets on page load (starts expanded). No localStorage persistence is required for v1.

---

## Component Structure

```
ReposView
├── <aside> (sidebar container, width transitions between 280px ↔ 48px)
│   ├── ReposGrid (shown when expanded, opacity transition)
│   └── MiniReposSidebar (shown when collapsed, opacity transition)  ← NEW
│       ├── MiniAddButton
│       ├── MiniRepoItem[]   (one per repo, grouped with dividers)
│       └── MiniFooter
└── <main> (detail pane, unchanged)
```

Only **one new component** is needed: `MiniReposSidebar` (plus its child `MiniRepoItem`). Everything else is CSS/className changes to `ReposView`.

---

## Settings & Configuration

No new settings for v1. The 48px width and behavior are fixed defaults.

**Future consideration:** A user setting to choose between "mini sidebar" vs "fully hidden" collapse behavior, but this is out of scope for now.

---

## Discoverability

- The mini sidebar is **self-evident**: collapsing the sidebar reveals it immediately
- Tooltips on hover guide users who don't recognize the color-dot pattern
- The "+" button in mini mode ensures the "Add repo" action remains discoverable
- The selected-repo accent border makes it clear which repo is active

---

## Accessibility

- Mini items have `aria-label` with full repo name + branch (e.g., "shortcuts (main)")
- Mini sidebar has `role="navigation"` and `aria-label="Repository quick-switch"`
- Keyboard: Tab navigates between mini items; Enter selects; hamburger toggles
- Color dots are supplemented by letter labels (not color-only identification)
