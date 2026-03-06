# Context: Schedules Split-Panel Layout

## User Story
Change the Schedules page so it has a left panel with a list of schedules and a right panel with all the info for the selected schedule — like the existing Pipelines tab layout.

## Goal
Refactor `RepoSchedulesTab` from a vertical expand/collapse card list into a persistent two-column split-panel layout: compact schedule list on the left (~w-72), full schedule detail on the right (flex-1).

## Commit Sequence
1. Extract ScheduleDetail component — pure refactor, moves inline expanded-detail JSX into `ScheduleDetail` sub-component
2. Refactor schedule selection state — rename `expandedId` → `selectedId`, remove toggle behavior, add auto-select on load, move history fetch to a `useEffect`
3. Implement split-panel layout — convert `flex-col` wrapper to `flex h-full`, add left/right panels following `PipelinesTab` pattern exactly
4. Update tests for split-panel layout — update selectors for removed Card wrappers and expand arrows; add 5 new split-panel-specific tests

## Key Decisions
- Follow `PipelinesTab.tsx` as the reference implementation — exact same Tailwind classes for panel widths, borders, and active row highlight
- Left panel width: `w-72` (288px), matching pipelines
- Active row highlight: `border-l-2 border-[#0078d4] bg-[#e8e8e8] dark:bg-[#2a2d2e]`
- `CreateScheduleForm` renders in the right panel (not above the list), keeping the left list always visible
- Auto-select `schedules[0]` on load; WebSocket refreshes must NOT reset an active selection
- Race condition guard on history fetch: `cancelled` flag in `useEffect` cleanup

## Conventions
- All files in `packages/coc/src/server/spa/client/react/repos/`
- Tailwind utility classes only (no CSS modules)
- Test files use Vitest + React Testing Library, `vi.stubGlobal` for fetch, `waitFor` for async
- Sub-components defined in the same file (`RepoSchedulesTab.tsx`) — no new files created
