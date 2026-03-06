# Expand Code Blocks by Default in CoC SPA Markdown Preview

## Problem

In the CoC SPA markdown preview, code blocks with more than 15 lines are **collapsed by default**, showing only the first 5 lines with a "Show N more lines" indicator. Users must click to expand each code block. This is inconvenient when reviewing markdown documents — code snippets should be fully visible by default.

## Proposed Approach

Add a `defaultExpanded` option to `CodeBlockRenderOptions` so callers can control whether collapsible code blocks start expanded or collapsed. The CoC SPA markdown renderer will pass `defaultExpanded: true` to render code blocks expanded by default while preserving the ability to manually collapse them.

This keeps the collapsible infrastructure intact (users can still collapse long blocks) but flips the default in the SPA context.

## Files to Change

### 1. `packages/pipeline-core/src/editor/parsing/block-renderers.ts`

- **Add `defaultExpanded?: boolean` to `CodeBlockRenderOptions`** (around line 40).
- **Use it in `renderCodeBlock()`** (line 154): when `defaultExpanded` is true, set `data-collapsed="false"` instead of `"true"`.
- **Update collapse button initial icon** (line 165): show `▼` (expanded) instead of `▶` (collapsed) when `defaultExpanded` is true.

### 2. `packages/coc/src/server/spa/client/markdown-renderer.ts`

- **Pass `defaultExpanded: true`** in the `renderCodeBlock()` call (line 78–84) so the SPA renders code blocks expanded by default.

### 3. `packages/coc/src/server/spa/client/tailwind.css`

- No CSS changes needed — the existing `data-collapsed="false"` state already renders the block fully expanded (the CSS only applies max-height constraints when `data-collapsed="true"`).

## Detailed Changes

### block-renderers.ts — Options interface (~line 38–40)

```typescript
// Add after collapseThreshold
/** Start collapsible blocks in expanded state. Default: false (collapsed). */
defaultExpanded?: boolean;
```

### block-renderers.ts — renderCodeBlock() (~line 112–115)

```typescript
const defaultExpanded = options?.defaultExpanded ?? false;
```

### block-renderers.ts — Container attributes (~line 153–155)

```diff
 if (isCollapsible) {
-    containerAttrs += ' data-collapsible="true" data-collapsed="true"';
+    const collapsed = defaultExpanded ? 'false' : 'true';
+    containerAttrs += ' data-collapsible="true" data-collapsed="' + collapsed + '"';
 }
```

### block-renderers.ts — Collapse button (~line 164–166)

```diff
 if (isCollapsible) {
-    headerHtml += '<button class="code-block-collapse" title="Expand">▶</button>';
+    const btnTitle = defaultExpanded ? 'Collapse' : 'Expand';
+    const btnIcon = defaultExpanded ? '▼' : '▶';
+    headerHtml += '<button class="code-block-collapse" title="' + btnTitle + '">' + btnIcon + '</button>';
 }
```

### markdown-renderer.ts — SPA call site (~line 78–84)

```diff
 codeBlockHtml.set(block.startLine, renderCodeBlock(block, {
     highlight: highlightFn,
     showLineNumbers: true,
     showCopyButton: true,
     showLanguageLabel: true,
     collapsible: true,
+    defaultExpanded: true,
 }));
```

## Testing

- Existing tests in `packages/coc/test/server/spa/client/markdown-renderer.test.ts` and `packages/pipeline-core/` should still pass (default behavior unchanged when `defaultExpanded` is not set).
- Add a test for `renderCodeBlock` with `defaultExpanded: true` verifying `data-collapsed="false"` and the `▼` button icon.

## Impact

- **CoC SPA only** — the VS Code extension's markdown preview is unaffected (it doesn't pass `defaultExpanded`).
- **No breaking changes** — `defaultExpanded` defaults to `false`, preserving existing collapsed behavior for all other callers.
