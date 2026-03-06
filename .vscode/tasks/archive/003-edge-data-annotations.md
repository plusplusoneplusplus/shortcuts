---
status: pending
---

# 003: Edge Data Annotations

## Summary

Add inline data shape badges on DAG edges and schema preview tooltips on edge hover, so users can see at a glance what data flows between pipeline phases without clicking into nodes.

## Motivation

Commits 001 and 002 established the visual context layer and rich hover tooltips for nodes. Edges are still bare SVG lines with no indication of what data they carry. This commit adds the "data flow" dimension: a small badge centered on each edge showing the data shape (e.g., "150 rows", "[category, summary]"), and a hover tooltip revealing the full schema. This is a separate commit because it introduces a new component (`DAGEdgeLabel`), modifies the edge rendering, and adds edge-specific hover state — all orthogonal to the node tooltip work in 002.

## Changes

### Files to Create

- `packages/coc/src/server/spa/client/react/processes/dag/DAGEdgeLabel.tsx` — New component that renders an SVG `<g>` containing an inline badge (pill) and manages hover state for the schema tooltip. Accepts edge midpoint coordinates, badge text, tooltip text, and theme flag.

- `packages/coc/src/server/spa/client/react/processes/dag/edgeAnnotations.ts` — Pure utility module with two functions: `getEdgeBadgeText(fromPhase, toPhase, pipelineConfig)` returns the short badge label, and `getEdgeSchemaText(fromPhase, toPhase, pipelineConfig)` returns the full schema string for the hover tooltip.

- `packages/coc/test/spa/react/dag/DAGEdgeLabel.test.tsx` — Unit tests for the `DAGEdgeLabel` component.

- `packages/coc/test/spa/react/dag/edgeAnnotations.test.ts` — Unit tests for `getEdgeBadgeText` and `getEdgeSchemaText`.

### Files to Modify

- `packages/coc/src/server/spa/client/react/processes/dag/DAGEdge.tsx` — Extend `DAGEdgeProps` to accept optional `badgeText`, `tooltipText`, and `isDark`. Import and render `<DAGEdgeLabel>` at the edge midpoint when `badgeText` is provided.

- `packages/coc/src/server/spa/client/react/processes/dag/PipelineDAGChart.tsx` — Import `getEdgeBadgeText` and `getEdgeSchemaText`. Use the `pipelineConfig` prop already added by commit 002 (type: `PipelineConfig`). In the edge rendering loop, compute badge and tooltip text from `pipelineConfig` and pass them to `<DAGEdge>`.

- `packages/coc/src/server/spa/client/react/processes/dag/PipelineDAGSection.tsx` — Pass the `pipelineConfig` object (already available as `config` from `process.metadata.pipelineConfig`) through to `<PipelineDAGChart>` as a new prop.

- `packages/coc/src/server/spa/client/react/processes/dag/index.ts` — Add export for `DAGEdgeLabel` and `edgeAnnotations`.

### Files to Delete

(none)

## Implementation Notes

### DAGEdgeLabel component

```tsx
// DAGEdgeLabel.tsx
import { useState } from 'react';

export interface DAGEdgeLabelProps {
    /** Center X of the label (edge midpoint) */
    x: number;
    /** Center Y of the label (edge midpoint) */
    y: number;
    /** Short text for the pill badge, e.g. "150 rows" or "[category, summary]" */
    badgeText: string;
    /** Full schema text for hover tooltip (optional) */
    tooltipText?: string;
    isDark: boolean;
}

export function DAGEdgeLabel({ x, y, badgeText, tooltipText, isDark }: DAGEdgeLabelProps) {
    const [hovered, setHovered] = useState(false);

    const bgColor = isDark ? '#2d2d2d' : '#f3f3f3';
    const borderColor = isDark ? '#3c3c3c' : '#e0e0e0';
    const textColor = isDark ? '#cccccc' : '#616161';

    // Approximate badge width: ~6px per character + 16px padding
    const badgeWidth = Math.max(badgeText.length * 6 + 16, 40);
    const badgeHeight = 18;

    return (
        <g
            data-testid="dag-edge-label"
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
            style={{ cursor: tooltipText ? 'help' : 'default' }}
        >
            {/* Badge pill background */}
            <rect
                x={x - badgeWidth / 2}
                y={y - badgeHeight / 2}
                width={badgeWidth}
                height={badgeHeight}
                rx={9}
                fill={bgColor}
                stroke={borderColor}
                strokeWidth={1}
            />
            {/* Badge text */}
            <text
                x={x}
                y={y + 4}
                textAnchor="middle"
                fill={textColor}
                fontSize={9}
                fontFamily="system-ui, sans-serif"
            >
                {badgeText}
            </text>
            {/* SVG <title> for native tooltip — simple, accessible, no foreignObject */}
            {tooltipText && <title>{tooltipText}</title>}

            {/* HTML tooltip for richer hover display (positioned absolutely) */}
            {hovered && tooltipText && (
                <foreignObject
                    x={x - 140}
                    y={y + badgeHeight / 2 + 4}
                    width={280}
                    height={80}
                    style={{ overflow: 'visible' }}
                >
                    <div
                        data-testid="dag-edge-tooltip"
                        style={{
                            background: isDark ? '#1e1e1e' : '#ffffff',
                            border: `1px solid ${borderColor}`,
                            borderRadius: 4,
                            padding: '6px 8px',
                            fontSize: 10,
                            fontFamily: 'system-ui, sans-serif',
                            color: isDark ? '#cccccc' : '#1e1e1e',
                            whiteSpace: 'pre-wrap',
                            boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
                            maxWidth: 280,
                        }}
                    >
                        {tooltipText}
                    </div>
                </foreignObject>
            )}
        </g>
    );
}
```

**Design decisions:**
- The pill badge uses SVG `<rect>` + `<text>` (no foreignObject) for the always-visible label — lightweight and consistent with DAGNode text rendering.
- The hover tooltip uses `<foreignObject>` for richer HTML layout (same pattern as the node tooltips from commit 002). It only mounts on hover via React state.
- A `<title>` element is always present for accessibility (screen readers, browsers without JS).
- Badge width is dynamically computed from text length to avoid overflow.

### edgeAnnotations utility

```ts
// edgeAnnotations.ts
import type { PipelinePhase, PipelineConfig } from '@plusplusoneplusplus/pipeline-core';

/**
 * Compute the short badge text for an edge between two phases.
 */
export function getEdgeBadgeText(
    fromPhase: PipelinePhase,
    toPhase: PipelinePhase,
    config?: any,
): string | null {
    if (!config) return null;

    // Input → Filter or Input → Map: show data type/source
    if (fromPhase === 'input' && (toPhase === 'filter' || toPhase === 'map')) {
        return getInputBadge(config);
    }

    // Filter → Map: show "filtered" or count if available
    if (fromPhase === 'filter' && toPhase === 'map') {
        return 'filtered';
    }

    // Map → Reduce: show output field names
    if (fromPhase === 'map' && toPhase === 'reduce') {
        return getMapOutputBadge(config);
    }

    return null;
}

function getInputBadge(config: any): string | null {
    const input = config.input;
    if (!input) return null;

    // CSV source
    if (input.from?.type === 'csv') return 'CSV';
    // Inline items
    if (input.items && Array.isArray(input.items)) {
        return `${input.items.length} items`;
    }
    // Inline from array
    if (Array.isArray(input.from)) {
        return `${input.from.length} items`;
    }
    // Generate
    if (input.generate) return 'generated';

    return null;
}

function getMapOutputBadge(config: any): string | null {
    const output = config.map?.output;
    if (!output || !Array.isArray(output) || output.length === 0) return null;
    // Truncate if too many fields
    if (output.length <= 3) return `[${output.join(', ')}]`;
    return `[${output.slice(0, 2).join(', ')}, …+${output.length - 2}]`;
}

/**
 * Compute the full schema text for an edge hover tooltip.
 */
export function getEdgeSchemaText(
    fromPhase: PipelinePhase,
    toPhase: PipelinePhase,
    config?: any,
): string | null {
    if (!config) return null;

    if (fromPhase === 'input' && (toPhase === 'filter' || toPhase === 'map')) {
        return getInputSchemaText(config);
    }

    if (fromPhase === 'filter' && toPhase === 'map') {
        return getFilterSchemaText(config);
    }

    if (fromPhase === 'map' && toPhase === 'reduce') {
        return getMapReduceSchemaText(config);
    }

    return null;
}

function getInputSchemaText(config: any): string | null {
    const input = config.input;
    if (!input) return null;

    const fields = extractInputFields(input, config.map);
    if (!fields || fields.length === 0) return null;

    const source = input.from?.type === 'csv' ? `Source: CSV (${input.from.path})\n` : '';
    return `${source}Fields: ${fields.join(', ')}`;
}

function getFilterSchemaText(config: any): string | null {
    const filter = config.filter;
    if (!filter) return null;

    let text = `Filter type: ${filter.type}`;
    if (filter.rule?.rules && Array.isArray(filter.rule.rules)) {
        const ruleFields = filter.rule.rules.map((r: any) => r.field).filter(Boolean);
        if (ruleFields.length > 0) {
            text += `\nRule fields: ${ruleFields.join(', ')}`;
        }
    }
    return text;
}

function getMapReduceSchemaText(config: any): string | null {
    const inputFields = extractInputFields(config.input, config.map);
    const outputFields = config.map?.output;

    const parts: string[] = [];
    if (inputFields && inputFields.length > 0) {
        parts.push(`Input: ${inputFields.join(', ')}`);
    }
    if (outputFields && Array.isArray(outputFields) && outputFields.length > 0) {
        parts.push(`Output: ${outputFields.join(', ')}`);
    }
    if (parts.length === 0) return null;
    return parts.join('\n→ ');
}

/**
 * Extract input field names from config.
 * Sources: inline items keys, generate schema, or template variables in map prompt.
 */
function extractInputFields(input: any, map: any): string[] | null {
    if (!input) return null;

    // From inline items: use keys of first item
    if (input.items && Array.isArray(input.items) && input.items.length > 0) {
        return Object.keys(input.items[0]);
    }

    // From inline from array: use keys of first item
    if (Array.isArray(input.from) && input.from.length > 0) {
        return Object.keys(input.from[0]);
    }

    // From generate schema
    if (input.generate?.schema && Array.isArray(input.generate.schema)) {
        return input.generate.schema;
    }

    // Infer from map prompt template variables: {{varName}}
    // Exclude reserved: ITEMS, BATCH
    if (map?.prompt && typeof map.prompt === 'string') {
        const matches = map.prompt.match(/\{\{(\w+)\}\}/g);
        if (matches) {
            const reserved = new Set(['ITEMS', 'BATCH']);
            const fields = [...new Set(
                matches.map((m: string) => m.slice(2, -2)).filter((f: string) => !reserved.has(f))
            )];
            if (fields.length > 0) return fields;
        }
    }

    return null;
}
```

**Key design decisions:**
- `extractInputFields` tries four sources in priority order: inline items keys → inline from keys → generate schema → map prompt template variables. This covers all `InputConfig` variants.
- Template variable extraction excludes `ITEMS` and `BATCH` (reserved for batch mode).
- Badge text is kept short (≤30 chars) with truncation for long output field lists.
- All functions accept `config?: any` rather than strict `PipelineConfig` because the config comes from process metadata and may have extra/missing fields at runtime.

### DAGEdge modifications

```tsx
// DAGEdge.tsx — updated
export interface DAGEdgeProps {
    fromX: number;
    fromY: number;
    toX: number;
    toY: number;
    state: EdgeState;
    isDark: boolean;
    /** Short label to display as a badge on the edge */
    badgeText?: string | null;
    /** Full schema text for hover tooltip */
    tooltipText?: string | null;
}
```

Add `<DAGEdgeLabel>` rendering after the `<path>`:

```tsx
{badgeText && (
    <DAGEdgeLabel
        x={(fromX + toX) / 2}
        y={(fromY + toY) / 2}
        badgeText={badgeText}
        tooltipText={tooltipText ?? undefined}
        isDark={isDark}
    />
)}
```

The midpoint calculation `(fromX + toX) / 2` is correct because edges are straight lines (`M fromX fromY L toX toY`). The Y values are identical (all nodes are at the same `y + NODE_H / 2`), so the badge naturally sits on the line.

### PipelineDAGChart modifications

Add `pipelineConfig?: any` to `PipelineDAGChartProps` (line 11-21).

In the edge rendering loop (lines 100-116), compute badge and tooltip:

```tsx
import { getEdgeBadgeText, getEdgeSchemaText } from './edgeAnnotations';

// Inside the edge map:
const badgeText = getEdgeBadgeText(prev.phase, node.phase, pipelineConfig);
const tooltipText = getEdgeSchemaText(prev.phase, node.phase, pipelineConfig);

return (
    <DAGEdge
        key={`edge-${prev.phase}-${node.phase}`}
        fromX={fromPos.x + NODE_W}
        fromY={fromPos.y + NODE_H / 2}
        toX={toPos.x}
        toY={toPos.y + NODE_H / 2}
        state={deriveEdgeState(prev.state, node.state)}
        isDark={isDark}
        badgeText={badgeText}
        tooltipText={tooltipText}
    />
);
```

### PipelineDAGSection modifications

In `PipelineDAGSection.tsx`, the `config` variable is already extracted at line 52:

```tsx
const config = meta?.pipelineConfig;
```

Pass it to `PipelineDAGChart`:

```tsx
<PipelineDAGChart
    data={dagData}
    isDark={isDark}
    now={isRunning ? now : undefined}
    phaseDetails={phaseDetails}
    onScrollToConversation={handleScrollToConversation}
    pipelineConfig={config}
/>
```

### SVG viewBox height

The current `totalHeight = 2 * PADDING + NODE_H + 20` (line 71) provides 20px below nodes for the progress bar. The edge badges are rendered at the vertical midpoint of the edge (same y as node centers), so they don't need extra vertical space. The hover tooltip uses `<foreignObject>` with `overflow: visible`, which renders outside the SVG viewBox. No viewBox changes needed.

### Edge between nodes with gap

The gap between nodes is `GAP_X = 60` pixels. The badge pill is ~40-80px wide. For edges with short gaps, the badge could overlap node borders. Since the gap is 60px and badge max width is ~80px, there could be slight overlap on long labels. Mitigation: cap `badgeText` at 20 characters in `getEdgeBadgeText` and truncate with "…" if longer.

## Tests

### DAGEdgeLabel.test.tsx

- **Renders badge text** — Mount `<DAGEdgeLabel x={100} y={50} badgeText="CSV" isDark={false} />`, assert `<text>` contains "CSV" and `data-testid="dag-edge-label"` is present.
- **Renders pill background** — Assert `<rect>` with `rx={9}` exists within the `<g>`.
- **Shows tooltip on hover** — Fire `mouseEnter` on the `<g>`, assert `data-testid="dag-edge-tooltip"` appears with tooltip text.
- **Hides tooltip on mouse leave** — Fire `mouseLeave`, assert tooltip is removed.
- **No tooltip when tooltipText is undefined** — Mount without `tooltipText`, fire `mouseEnter`, assert no tooltip renders.
- **Dark mode styling** — Mount with `isDark={true}`, assert background rect fill is `#2d2d2d`.

### edgeAnnotations.test.ts

- **getEdgeBadgeText returns "CSV" for input→map with CSV source** — config: `{ input: { from: { type: 'csv', path: 'data.csv' } }, map: { prompt: '...' } }`.
- **getEdgeBadgeText returns item count for input→map with inline items** — config: `{ input: { items: [{a:1},{a:2}] } }` → "2 items".
- **getEdgeBadgeText returns output fields for map→reduce** — config: `{ map: { output: ['category', 'summary'] } }` → "[category, summary]".
- **getEdgeBadgeText truncates long output fields** — config: `{ map: { output: ['a','b','c','d','e'] } }` → "[a, b, …+3]".
- **getEdgeBadgeText returns "filtered" for filter→map** — any config with filter.
- **getEdgeBadgeText returns null when config is undefined** — `getEdgeBadgeText('input', 'map', undefined)` → null.
- **getEdgeBadgeText returns "generated" for input→map with generate config** — config: `{ input: { generate: { prompt: '...', schema: ['a'] } } }`.
- **getEdgeSchemaText returns fields from inline items** — config with `input.items: [{title:'x', desc:'y'}]` → contains "title, desc".
- **getEdgeSchemaText returns CSV source path** — config with CSV from → contains "Source: CSV".
- **getEdgeSchemaText infers fields from map prompt template** — config with `map.prompt: "Analyze {{title}} and {{content}}"` → contains "title, content".
- **getEdgeSchemaText excludes reserved template vars** — prompt with `{{ITEMS}}` → not included in fields.
- **getEdgeSchemaText returns input→output for map→reduce edge** — config with both input fields and map.output → contains "Input:" and "Output:".
- **getEdgeSchemaText returns null when no data available** — empty config → null.
- **getEdgeSchemaText returns filter metadata for filter→map** — config with filter rules → contains "Filter type:" and rule fields.

### Existing test updates

- **PipelineDAGChart.test.tsx** — Add a test: when `pipelineConfig` prop is passed with CSV input and map output, `dag-edge-label` test IDs appear in the rendered SVG.
- **DAGEdge test** (if one exists, otherwise add to PipelineDAGChart tests) — Verify that `DAGEdge` renders `DAGEdgeLabel` when `badgeText` is provided and omits it when `badgeText` is null.

## Acceptance Criteria

- [ ] Small rounded pill badges appear centered on edges between nodes
- [ ] Input→Map/Filter edge shows data source type ("CSV", "N items", "generated")
- [ ] Filter→Map edge shows "filtered"
- [ ] Map→Reduce edge shows output field names (e.g., "[category, summary]")
- [ ] Hovering an edge badge shows a tooltip with the full data schema
- [ ] Input→Map tooltip shows source info and field names
- [ ] Map→Reduce tooltip shows "Input: ... → Output: ..." schema
- [ ] Field names are inferred from inline items, generate schema, or map prompt template variables
- [ ] Long output field lists are truncated with "…+N" in the badge
- [ ] Badge and tooltip render correctly in both light and dark themes
- [ ] No badge renders when `pipelineConfig` is not available (graceful null handling)
- [ ] Existing DAG tests continue to pass (no regressions)
- [ ] New unit tests for `DAGEdgeLabel` and `edgeAnnotations` all pass
- [ ] `PipelineDAGChart` test verifies edge labels appear when config is provided

## Dependencies

- Depends on: 002

## Assumed Prior State

Commit 002 pipes PipelineConfig to DAG chart as a prop. Tooltip pattern established. The `process.metadata.pipelineConfig` object is available in `PipelineDAGSection` and contains `input`, `filter`, `map`, and `reduce` configuration matching the `PipelineConfig` type from `pipeline-core/src/pipeline/types.ts`.
