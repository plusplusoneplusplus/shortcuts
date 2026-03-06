# Context: Tasks Panel Search

## User Story
The Tasks panel in the CoC dashboard accumulates many folders and documents (170+ items across folders like coc, memory, archive). Users need to quickly find a specific task by name without manually drilling through Miller columns folder by folder.

## Goal
Add a client-side search input to the Tasks panel toolbar that filters the task tree into a flat results list in real time, with keyboard shortcuts and match highlighting.

## Commit Sequence
1. Add tree flattening utility and search filter
2. Add search input and state to TasksPanel toolbar
3. Add TaskSearchResults component and wire filtering
4. Add keyboard shortcuts, match highlighting, and polish

## Key Decisions
- Client-side only — no backend API changes; filter against the existing `tree: TaskFolder` prop
- Follow existing debounce pattern from ProcessFilters.tsx (150ms)
- Reuse TaskTreeItem Tailwind classes for visual consistency
- Flatten tree into (TaskDocument | TaskDocumentGroup)[] for search, matching on baseName, fileName, relativePath
- Toggle between Miller columns and flat search results (not overlay)

## Conventions
- Utility functions added to existing `useTaskTree.ts` hook file (collocated with tree types)
- Input styling matches existing SPA pattern: `border-[#e0e0e0] dark:border-[#3c3c3c]` with `focus:border-[#0078d4]`
- New component `TaskSearchResults.tsx` placed alongside other task components in `react/tasks/`
- Tests use Vitest, colocated with source or in `__tests__/` directories
