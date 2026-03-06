# Plan: Compact Tool Call Display in CoC Chat

## Problem

Each tool call renders as its own full-height row. When an agent fires many consecutive
`view`, `glob`, `grep`, `edit`, or `powershell` calls the chat becomes a wall of identical
rows, making it hard to skim the conversation.

## Approach

Add a `toolCompactness` display setting (0=Full, 1=Compact, 2=Minimal).
When enabled, post-process the flat `chunks` array in `ConversationTurnBubble` to detect
maximal consecutive runs of tools in the same category and replace them with a single
`GroupChunk`. A new `ToolCallGroupView` component renders the group row with expand/collapse.

All changes are in `packages/coc/src/server/spa/client/react/` and the server config layer.
No data-model changes; this is purely a rendering-layer transformation.

---

## Tool Categories

| Category | Tools |
|----------|-------|
| `read`   | `view`, `glob`, `grep` |
| `write`  | `edit`, `create` |
| `shell`  | `powershell`, `shell` |

All other tools (`task`, `skill`, `report_intent`, etc.) are non-groupable and always break
an active group. A run of exactly 1 groupable tool is never collapsed.

---

## Tasks

### Phase 1 — Settings Layer

#### T1 · `display-setting` · Add `toolCompactness` to DisplaySettings
- **File:** `packages/coc/src/server/spa/client/react/hooks/useDisplaySettings.ts`
- Extend `DisplaySettings` type: `toolCompactness: 0 | 1 | 2`
- Add to `DEFAULT_SETTINGS = { showReportIntent: false, toolCompactness: 0 }`
- Read `data.resolved.toolCompactness` in `fetchDisplaySettings()`; fall back to `0`
- No other changes needed in the hook itself

#### T2 · `server-config` · Expose `toolCompactness` in server config *(depends on T1)*
- **File:** `packages/coc-server/src/handlers/` (preferences or admin-config handler)
- Add `toolCompactness: number` (default `0`) to the server-side preferences schema
- Ensure `GET /admin/config` returns it inside `resolved`
- Add `PUT /admin/config` handling for the new field (same pattern as `showReportIntent`)

#### T3 · `settings-ui` · Add compactness toggle to display settings UI *(depends on T1, T2)*
- **File:** the existing display settings panel component (where `showReportIntent` toggle lives)
- Add a segmented control or radio group: **Full / Compact / Minimal**
- On change: call the existing settings-update API with `{ toolCompactness: value }`
- Call `invalidateDisplaySettings()` after save so all mounted hooks re-fetch

---

### Phase 2 — Data Layer (pure logic, no React)

#### T4 · `group-types` · Define category types and classification utility
- **New file:** `packages/coc/src/server/spa/client/react/processes/toolGroupUtils.ts`
- ```ts
  export type ToolGroupCategory = 'read' | 'write' | 'shell';

  const CATEGORY_MAP: Record<string, ToolGroupCategory> = {
    view: 'read', glob: 'read', grep: 'read',
    edit: 'write', create: 'write',
    powershell: 'shell', shell: 'shell',
  };

  export function getToolGroupCategory(toolName: string): ToolGroupCategory | null {
    return CATEGORY_MAP[toolName] ?? null;
  }
  ```
- Also export `CATEGORY_ICONS` and `getCategoryLabel(category, counts)` for the view layer

#### T5 · `group-chunk-type` · Add `GroupChunk` to the `RenderChunk` union *(depends on T4)*
- **File:** `ConversationTurnBubble.tsx`
- Extend `RenderChunk`:
  ```ts
  // existing
  | { kind: 'content'; key: string; html: string; parentToolId?: string }
  | { kind: 'tool';   key: string; toolId: string; parentToolId?: string }
  // new
  | { kind: 'tool-group'; key: string; category: ToolGroupCategory;
      toolIds: string[]; startTime?: number; endTime?: number; allSucceeded: boolean }
  ```

#### T6 · `group-algorithm` · Implement `groupConsecutiveToolChunks()` *(depends on T4, T5)*
- **File:** `toolGroupUtils.ts` (or bottom of `ConversationTurnBubble.tsx`)
- Signature:
  ```ts
  export function groupConsecutiveToolChunks(
    chunks: RenderChunk[],
    toolById: Map<string, RenderToolCall>,
    parentToolIds: Set<string>   // skip chunks that are children
  ): RenderChunk[]
  ```
- Algorithm:
  1. Walk `chunks` linearly; skip `kind !== 'tool'` or chunks whose `toolId` is in `parentToolIds`
  2. Track `currentRun: { category, toolIds[] }`
  3. On each `kind === 'tool'` chunk: get category; if same category → push to run; else flush run + start new
  4. On flush: if `run.length >= 2` → emit one `GroupChunk`; else emit individual chunks unchanged
  5. Non-tool chunks always flush the current run first

---

### Phase 3 — UI Component

#### T7 · `tool-group-view` · Create `ToolCallGroupView` component *(depends on T4, T5)*
- **New file:** `packages/coc/src/server/spa/client/react/processes/ToolCallGroupView.tsx`
- Props:
  ```ts
  interface ToolCallGroupViewProps {
    category: ToolGroupCategory;
    toolCalls: RenderToolCall[];   // ordered, already resolved
    compactness: 0 | 1 | 2;
    isStreaming?: boolean;         // for auto-expand logic
    renderToolTree: (toolId: string, depth: number) => React.ReactNode;
  }
  ```
- State: `expanded: boolean` — initialized to `false` (collapsed by default)
- **Header row** (always visible):
  - Category icon (📄 read / ✏️ write / 💻 shell — or SVG equivalents from existing icon set)
  - Summary: `"N <category> operations (<tool>×<count>, ...)"` e.g. `"4 read operations (glob×1, view×3)"`
  - Time: first tool's timestamp + total elapsed (`lastEnd - firstStart`)
  - Status badge: green check if all `status === 'success'`, warning if any failed
  - Chevron toggle (▶ collapsed / ▼ expanded)
- **Expanded body**: map `toolCalls` → `renderToolTree(id, 0)` (reuses existing tree renderer)
- **Minimal mode** (`compactness === 2`): header row has `max-height: 0; overflow: hidden` and transitions to normal on hover or `expanded === true`
- **Streaming**: `useEffect` watches `isStreaming`; force `expanded = true` while true; when it flips false → `setExpanded(false)`
- **Accessibility**: header `div` gets `role="button"`, `tabIndex={0}`, `aria-expanded={expanded}`, `onKeyDown` handles Enter/Space

---

### Phase 4 — Integration

#### T8 · `bubble-integration` · Wire grouping into `ConversationTurnBubble` *(depends on T6, T7, T1)*
- **File:** `ConversationTurnBubble.tsx`
- In the component body, after calling `buildAssistantRender(turn)`:
  ```ts
  const { showReportIntent, toolCompactness } = useDisplaySettings();

  const processedChunks = useMemo(() =>
    toolCompactness >= 1
      ? groupConsecutiveToolChunks(
          assistantRender.chunks,
          assistantRender.toolById,
          new Set(assistantRender.toolParentById.keys())
        )
      : assistantRender.chunks,
    [assistantRender, toolCompactness]
  );
  ```
- In the top-level chunk render loop (L689–718), add a branch:
  ```ts
  } else if (chunk.kind === 'tool-group') {
    flushContent();
    const toolCalls = chunk.toolIds.map(id => assistantRender.toolById.get(id)!);
    nodes.push(
      <ToolCallGroupView
        key={chunk.key}
        category={chunk.category}
        toolCalls={toolCalls}
        compactness={toolCompactness}
        isStreaming={isStreaming}
        renderToolTree={renderToolTree}
      />
    );
  }
  ```
- No changes to `renderToolTree` itself (child-level grouping is deferred — see Non-Goals)

#### T9 · `minimal-mode` · Implement Minimal mode CSS behaviour *(depends on T7)*
- Add CSS class `.tool-group-header--minimal` that applies `max-height: 1.5rem; overflow: hidden; transition: max-height 0.2s`
- On hover or `expanded === true`: class removed / height expands
- Keeps the row visible as a thin stripe rather than truly zero-height (avoids layout jump)

#### T10 · `streaming-autoexpand` · Auto-expand groups during streaming *(depends on T7, T8)*
- Covered in T7 `useEffect`; verify that `isStreaming` prop is correctly derived from `turn.status === 'streaming'` or equivalent in `ConversationTurnBubble`

#### T11 · `a11y` · Keyboard accessibility *(depends on T7)*
- Covered in T7; verify with tab-navigation smoke test

---

### Phase 5 — Tests

#### T12 · `tests` · Unit tests *(depends on T6, T7)*
- **File:** `toolGroupUtils.test.ts`
  - `groupConsecutiveToolChunks`: mixed sequence, run-of-1 (not grouped), cross-category boundary, empty array, all-same-category, streaming tool in middle
- **File:** `ToolCallGroupView.test.tsx`
  - Renders collapsed summary correctly
  - Click → expands to show child ToolCallView nodes
  - `isStreaming=true` → forces expanded; flips false → collapses
  - Minimal mode class applied when `compactness=2`

---

## Key Files

| File | Change type |
|------|-------------|
| `hooks/useDisplaySettings.ts` | Extend type + fetch |
| `coc-server` preferences handler | Add field |
| Display settings panel component | New UI control |
| `processes/toolGroupUtils.ts` | **New** |
| `processes/ToolCallGroupView.tsx` | **New** |
| `processes/ConversationTurnBubble.tsx` | Extend types + wire grouping |
| `processes/toolGroupUtils.test.ts` | **New** |
| `processes/ToolCallGroupView.test.tsx` | **New** |

---

## Non-Goals

- Grouping child tool calls inside a `task` subtool tree (deferred)
- Persisting expanded/collapsed state across page reloads
- Changing the timeline or process-list views
- Any data-model or API changes beyond the preferences field
