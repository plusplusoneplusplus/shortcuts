# Move Pipeline Action Buttons from Bottom to Top

## Problem
In the CoC dashboard's Pipelines tab, the action buttons (Run, Close, Edit, Delete) are positioned at the bottom-right of the `PipelineDetail` component in a footer section. This wastes vertical space and requires scrolling to access actions.

## Proposed Approach
Move the action buttons from the footer `div` into the header `div` of `PipelineDetail.tsx`. The header already displays the pipeline name, path, and validation badge — the buttons will be appended to the right side of the header.

## File
- `packages/coc/src/server/spa/client/react/repos/PipelineDetail.tsx`

## Todos

1. **move-buttons-to-header** — Remove the footer `div` (lines 143-167) containing the action buttons and integrate those buttons into the header `div` (lines 102-111). Use `flex` with `ml-auto` or `flex-1` + `justify-end` so buttons stay right-aligned in the header row.

2. **adjust-edit-mode-buttons** — The edit mode also has Cancel/Save buttons in the footer. Move these to the header as well, conditionally rendered based on `mode`.

3. **verify-tests** — Run existing PipelineUI tests to confirm no regressions.

## Notes
- The header currently uses `flex items-center gap-2 px-4 pt-4 pb-2`. We'll keep this layout and add a right-aligned button group.
- The Delete confirmation dialog stays as-is (it's a separate `<Dialog>` component).
- No CSS file changes needed — all styling is via Tailwind utility classes inline.
