---
status: pending
---

# 001: Add spa/ directory with types and helpers

## Summary
Create the `spa/` module directory and extract shared types and the server-side `escapeHtml` helper, establishing the foundation that all subsequent modules depend on.

## Motivation
Types (`SpaTemplateOptions`, `ScriptOptions`) and the `escapeHtml` TS utility are used by multiple downstream modules (HTML template, script assembler). Extracting them first eliminates circular dependencies and sets up the directory structure.

## Changes

### Files to Create
- `packages/deep-wiki/src/server/spa/types.ts` — `SpaTemplateOptions` and `ScriptOptions` interfaces (copied from spa-template.ts lines 22-35 and 1233-1239)
- `packages/deep-wiki/src/server/spa/helpers.ts` — Server-side `escapeHtml(str: string): string` function (from spa-template.ts lines 2843-2849)

### Files to Modify
- `packages/deep-wiki/src/server/spa-template.ts` — Import `SpaTemplateOptions`, `ScriptOptions`, and `escapeHtml` from the new modules instead of defining them inline. Remove the inline definitions. Keep all other code in place. Re-export `SpaTemplateOptions` so external consumers are unaffected.

## Implementation Notes
- The `SpaTemplateOptions` interface is publicly exported; `ScriptOptions` is internal only.
- `escapeHtml` in helpers.ts is the **TypeScript** function used during HTML generation (line 2843). There is a separate client-side `escapeHtml` JS function inside `getSpaScript()` (line 2003) — do NOT touch that one.
- Import path from `spa-template.ts` to new modules: `'./spa/types'` and `'./spa/helpers'`.
- The `WebsiteTheme` import stays in `spa-template.ts` as it's from `../types`.

## Tests
- No new tests needed — this is a pure structural extraction
- Run `npm run test:run` in `packages/deep-wiki/` to confirm all existing tests pass

## Acceptance Criteria
- [ ] `spa/types.ts` exports `SpaTemplateOptions` and `ScriptOptions`
- [ ] `spa/helpers.ts` exports `escapeHtml`
- [ ] `spa-template.ts` imports from the new modules
- [ ] `spa-template.ts` still exports `SpaTemplateOptions` and `generateSpaHtml`
- [ ] All 1880+ existing tests pass unchanged
- [ ] Generated HTML output is byte-identical to before

## Dependencies
- Depends on: None
