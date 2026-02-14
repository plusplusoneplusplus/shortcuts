# R2: Split `website-generator.ts` (1,206 lines) into Concern-Specific Modules

## Problem

`packages/deep-wiki/src/writing/website-generator.ts` mixes 5 concerns in a single 1,206-line file:
- File I/O (reading markdown, JSON)
- Data serialization
- HTML template generation
- **360 lines of CSS** (inline string)
- **630 lines of client-side JavaScript** (inline string)

## Approach

Extract CSS and JS generation functions into separate files. Extract file reading utilities. Keep the orchestration functions in website-generator.ts.

## File Changes

### 1. Create `writing/website-styles.ts` (~370 lines)

Move `getStyles()` (lines 303-667):

```typescript
import type { WebsiteTheme } from '../types';

export function getStyles(theme: WebsiteTheme): string {
    // ... existing CSS generation code
}
```

### 2. Create `writing/website-client-script.ts` (~640 lines)

Move `getScript()` (lines 673-1301):

```typescript
export function getScript(options: { enableMermaidZoom: boolean }): string {
    // ... existing client-side JS generation code
}
```

Check exact parameters used by `getScript()` — it may also need mermaid zoom script content passed in.

### 3. Create `writing/website-data.ts` (~100 lines)

Move data reading and serialization functions:

```typescript
export function readModuleGraph(wikiDir: string): ModuleGraph | undefined;
export function readMarkdownFiles(wikiDir: string, graph: ModuleGraph, ...): Map<string, string>;
export function generateEmbeddedData(graph: ModuleGraph, articles: Map, ...): string;
export function stableStringify(value: unknown): string;
// Also move: sortedReplacer(), findModuleIdBySlug(), escapeHtml()
```

### 4. Simplify `writing/website-generator.ts` (~100-150 lines)

Keep only:
- `generateWebsite()` — main entry point
- `generateHtmlTemplate()` — assembles the HTML from parts

Update imports:
```typescript
import { getStyles } from './website-styles';
import { getScript } from './website-client-script';
import { readModuleGraph, readMarkdownFiles, generateEmbeddedData, stableStringify } from './website-data';
```

### 5. Update `writing/index.ts` barrel

Either re-export from the new files, or keep exporting from website-generator.ts if it re-exports the moved functions.

**Recommended:** Have website-generator.ts re-export what it previously exported:
```typescript
export { readModuleGraph, readMarkdownFiles, generateEmbeddedData, stableStringify } from './website-data';
```

This way, consumers importing from `writing/website-generator` or `writing/index` continue to work.

## Consumers

Only 3 files import from this module:
- `writing/index.ts` — barrel re-export
- `test/writing/website-generator.test.ts` — comprehensive tests
- `test/commands/generate.test.ts`

If we re-export through `website-generator.ts`, no consumer changes are needed.

## Tests

### Existing: `test/writing/website-generator.test.ts`

Contains **90+ tests** covering all exported functions. Must pass unchanged.

Key test areas:
- `stableStringify` (6 tests)
- `generateEmbeddedData` (9 tests)
- `generateHtmlTemplate` (50+ tests — HTML structure, themes, mermaid, links)
- `readModuleGraph` (3 tests)
- `readMarkdownFiles` (7 tests)
- `generateWebsite` (20+ tests)

Since tests import from `../../src/writing/website-generator`, and we re-export moved functions, tests should pass without modification.

## Validation

```bash
cd packages/deep-wiki && npm run build && npm run test:run
```

## Notes

- The CSS and JS functions are pure string generators with no side effects — extracting them is low risk.
- In the future, the CSS could be moved to an actual `.css` file and the client JS to a `.js` file, loaded at build time. But that's a larger change for later.
- `spa-template.ts` (2,298 lines in server/) is a separate file with similar CSS/JS concerns — consider a similar split for it in a follow-up task.
