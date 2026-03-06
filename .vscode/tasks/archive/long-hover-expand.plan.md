# Long Hover Expand Sidebar

## Problem
When the repo sidebar is collapsed (48px mini view showing colored dots + abbreviations), hovering over a repo item for an extended duration should temporarily expand the sidebar to full width so the user can read repo names and see details — without permanently toggling the collapsed state.

## Behavior Spec
- **Trigger:** `mouseenter` on any mini repo item in the collapsed sidebar
- **Delay:** ~600ms hold before expanding (cancels if mouse leaves before threshold)
- **Expand:** Sidebar widens to full 280px, showing the full `ReposList` content
- **Collapse back:** On `mouseleave` from the entire sidebar (`<aside>`), the sidebar returns to 48px
- **No persistence:** This is purely transient UI state — does not update localStorage or `/preferences`
- **Interaction with permanent toggle:** If the user clicks the hamburger to expand permanently, `reposSidebarCollapsed` becomes false and the normal expanded state takes over (temporary state is irrelevant)

## Affected Files

| File | Change |
|------|--------|
| `packages/coc/src/server/spa/client/react/repos/ReposView.tsx` | Add `temporaryExpanded` state; merge with `reposSidebarCollapsed` for sidebar width; wire `onMouseLeave` on `<aside>` |
| `packages/coc/src/server/spa/client/react/repos/MiniReposSidebar.tsx` | Accept `onItemHoverStart` / `onItemHoverEnd` props; attach to each mini item |

## Implementation Plan

### 1. `ReposView.tsx` — temporary expansion state

```tsx
// New local state (no dispatch, no persistence)
const [tempExpanded, setTempExpanded] = useState(false);
const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

const handleMiniHoverStart = useCallback(() => {
  hoverTimerRef.current = setTimeout(() => setTempExpanded(true), 600);
}, []);

const handleMiniHoverEnd = useCallback(() => {
  if (hoverTimerRef.current) {
    clearTimeout(hoverTimerRef.current);
    hoverTimerRef.current = null;
  }
  setTempExpanded(false);
}, []);

// Sidebar <aside> width decision:
const isCollapsed = state.reposSidebarCollapsed && !tempExpanded;
// Use `isCollapsed` instead of `state.reposSidebarCollapsed` for className
```

- `<aside>` gets `onMouseLeave={handleMiniHoverEnd}` to collapse when mouse leaves the whole sidebar
- The mini sidebar `<MiniReposSidebar>` receives `onItemHoverStart` / `onItemHoverEnd`
- When `tempExpanded && state.reposSidebarCollapsed` is true, render the **full** `<ReposList>` inside the aside (same content as when permanently expanded)

### 2. `MiniReposSidebar.tsx` — attach hover handlers to items

```tsx
// Props addition
interface MiniReposSidebarProps {
  // ... existing props
  onItemHoverStart?: () => void;
  onItemHoverEnd?: () => void;
}

// Each MiniRepoItem button:
<button
  onMouseEnter={onItemHoverStart}
  onMouseLeave={onItemHoverEnd}
  ...
>
```

> Note: `onMouseLeave` on each item (in addition to the aside-level one) ensures the timer is cancelled if the mouse moves between items or onto a gap.

## Edge Cases

| Scenario | Handling |
|----------|----------|
| Mouse moves between items quickly | Timer resets on each `mouseenter` |
| User clicks a repo while temp-expanded | Normal repo selection; temp state remains until `mouseleave` |
| Sidebar is already permanently expanded | `tempExpanded` has no visual effect (condition guarded) |
| Component unmounts during hover | `useEffect` cleanup clears the timer ref |

## Tasks

1. Add `tempExpanded` state + timer logic to `ReposView.tsx`
2. Thread `isCollapsed` (derived) into the `<aside>` className and content branching
3. Add `onItemHoverStart`/`onItemHoverEnd` props to `MiniReposSidebar` + wire buttons
4. Add `onMouseLeave` on `<aside>` to collapse temporary expansion
5. Cleanup: `useEffect` return to clear timer on unmount
6. Manual test: collapse sidebar → long hover → auto-expand → mouse out → auto-collapse
