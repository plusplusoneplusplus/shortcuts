---
status: pending
---

# 007: Extract HTML template and finalize barrel

## Summary
Extract the HTML template skeleton into `spa/html-template.ts`, create the `spa/index.ts` barrel, and convert `spa-template.ts` into a thin re-export barrel for backward compatibility.

## Motivation
This final commit completes the refactoring. The HTML template (~120 lines) moves to its own file, and the barrel pattern ensures all existing import paths (`from './spa-template'`, `from '../../src/server/spa-template'`) continue to work without any consumer changes.

## Changes

### Files to Create
- `packages/deep-wiki/src/server/spa/html-template.ts` — Exports `generateSpaHtml(options: SpaTemplateOptions): string`. Contains the HTML skeleton (DOCTYPE, head with CDN links, body structure with sidebar/main/admin/ask-widget). Imports `getSpaStyles` from `./styles`, `getSpaScript` from `./script`, `escapeHtml` from `./helpers`, `SpaTemplateOptions` from `./types`.
- `packages/deep-wiki/src/server/spa/index.ts` — Barrel file: `export { generateSpaHtml } from './html-template'; export type { SpaTemplateOptions } from './types';`

### Files to Modify
- `packages/deep-wiki/src/server/spa-template.ts` — Replace entire file content with:
  ```typescript
  /**
   * SPA Template — Backward compatibility barrel
   *
   * The SPA template has been refactored into the spa/ directory.
   * This file re-exports the public API for backward compatibility.
   */
  export { generateSpaHtml } from './spa';
  export type { SpaTemplateOptions } from './spa';
  ```
- `packages/deep-wiki/src/server/index.ts` — No changes needed (it imports from `./spa-template` which still exports the same API).

### Files to Delete
- None — `spa-template.ts` is preserved as a barrel, not deleted.

## Implementation Notes
- **HTML template** needs these imports:
  - `SpaTemplateOptions` from `./types`
  - `getSpaStyles` from `./styles`
  - `getSpaScript` from `./script`
  - `escapeHtml` from `./helpers`
  - `WebsiteTheme` stays imported from `../../types` (in types.ts already)
- **Test imports are unchanged**: `from '../../src/server/spa-template'` resolves to the barrel, which re-exports from `./spa/index.ts`.
- **server/index.ts re-exports are unchanged**: `export { generateSpaHtml } from './spa-template'` and `export type { SpaTemplateOptions } from './spa-template'` continue to work.
- Verify the final directory structure matches the plan.

## Tests
- No new tests needed
- Run full test suite to confirm all ~1880 tests pass
- Optionally: verify `generateSpaHtml()` output is byte-identical by comparing before/after snapshots

## Acceptance Criteria
- [ ] `spa/html-template.ts` contains the HTML skeleton
- [ ] `spa/index.ts` barrel exports `generateSpaHtml` and `SpaTemplateOptions`
- [ ] `spa-template.ts` is a 6-line re-export barrel
- [ ] No test files needed updating
- [ ] `server/index.ts` imports/re-exports work without changes
- [ ] All existing tests pass unchanged
- [ ] Final directory structure:
  ```
  src/server/spa/
  ├── index.ts
  ├── types.ts
  ├── helpers.ts
  ├── styles.ts
  ├── script.ts
  ├── html-template.ts
  └── scripts/
      ├── core.ts
      ├── theme.ts
      ├── sidebar.ts
      ├── content.ts
      ├── markdown.ts
      ├── toc.ts
      ├── graph.ts
      ├── ask-ai.ts
      ├── websocket.ts
      └── admin.ts
  ```

## Dependencies
- Depends on: 006 (all script modules and assembler in place)
