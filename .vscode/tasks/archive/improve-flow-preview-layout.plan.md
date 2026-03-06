# Improve Pipeline Flow Preview Layout

## Problem

The Pipeline Flow Preview section in the YAML pipeline webview is not user-friendly:

1. **Boxes pushed to the right** — The Input/Map/Reduce node boxes are not centered in the available space; they cluster toward the right edge of the container.
2. **Boxes too small** — The node boxes have insufficient size relative to the available space, making labels hard to read.
3. **Cramped layout** — Not enough spacing between nodes and edges; link labels (e.g., "category, summa...") get truncated.
4. **Poor vertical use of space** — The `graph TB` (top-to-bottom) mermaid direction is used, but the nodes render in a horizontal line anyway, wasting vertical space while overflowing horizontally.

## Affected Files

| File | What to Change |
|------|----------------|
| `src/shortcuts/yaml-pipeline/ui/preview-content.ts` | CSS styles for `.diagram-container`, `.diagram-wrapper`, `.mermaid`; Mermaid `initialize()` flowchart config |
| `src/shortcuts/yaml-pipeline/ui/preview-mermaid.ts` | Graph direction (`graph TB` → `graph LR`), node label truncation length |

## Approach

Make surgical CSS and Mermaid config changes to center the diagram, increase node sizing, and improve spacing. No structural HTML changes needed.

## Tasks

### 1. Center the diagram within its container
**File:** `preview-content.ts` (CSS, lines ~1211–1250)

- Change `.diagram-container` to use flexbox centering instead of relying on `text-align: center`:
  ```css
  .diagram-container {
      display: flex;
      justify-content: center;
      align-items: center;
      /* keep existing: background, border, border-radius, padding, overflow, position, cursor, min-height */
  }
  ```
- Ensure `.diagram-wrapper` remains compatible with zoom/pan transforms by keeping `display: inline-block` but adding `margin: 0 auto` as a fallback.

### 2. Increase Mermaid node spacing and padding
**File:** `preview-content.ts` (JS, lines ~1678–1689)

- Update the `mermaid.initialize()` flowchart config to increase node/rank spacing and padding:
  ```js
  flowchart: {
      useMaxWidth: false,   // was true — let the diagram size naturally
      htmlLabels: true,
      curve: 'basis',
      padding: 20,          // was 15
      nodeSpacing: 60,      // increase horizontal gap between nodes
      rankSpacing: 50       // increase vertical gap between ranks
  }
  ```
- Setting `useMaxWidth: false` is key — it prevents Mermaid from constraining the SVG to the container width, which causes the cramped right-aligned appearance.

### 3. Switch graph direction to LR (left-to-right)
**File:** `preview-mermaid.ts` (line 110, and similar in `generateJobMermaid`)

- Change `graph TB` to `graph LR` so the flow direction matches the natural reading order (Input → Map → Reduce flows left to right).
- This gives nodes more horizontal space and aligns with the stepper above the diagram.

### 4. Increase label truncation limit
**File:** `preview-mermaid.ts` (line ~63, `truncateText` function)

- Increase the default `maxLength` from 20 to 30 characters to reduce label truncation on link edges and node labels.
- This gives more readable context (e.g., "category, summary" instead of "category, summa...").

### 5. Increase minimum diagram container height
**File:** `preview-content.ts` (CSS, line ~1220)

- Bump `min-height` from `200px` to `280px` to give the diagram more breathing room and prevent the cramped appearance.

## Validation

- Open any pipeline YAML in the preview editor and verify:
  - Flow nodes are centered horizontally in the container
  - Nodes have comfortable size and spacing
  - Link labels are not truncated unnecessarily
  - Zoom/pan still works correctly
  - Collapse/expand toggle still works
  - Both light and dark themes render correctly
- Run `npm run build` to confirm no compile errors.
- Run `npm run test` to confirm no regressions.
