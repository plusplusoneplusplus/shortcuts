---
status: pending
---

# 006: Extract admin script and create script assembler

## Summary
Extract the admin portal script into its own module and create the `spa/script.ts` assembler that replaces the monolithic `getSpaScript()` function by importing and concatenating all script modules.

## Motivation
With all other script sections extracted (commits 003-005), the admin section is the last remaining inline code. Creating the assembler completes the script decomposition, giving `getSpaScript()` a clean composition structure where each feature is a separate import.

## Changes

### Files to Create
- `packages/deep-wiki/src/server/spa/scripts/admin.ts` — Exports `getAdminScript(): string`. Contains: `showAdmin()`, `initAdminEvents()`, `setAdminStatus()`, `clearAdminStatus()`, `loadAdminSeeds()`, `loadAdminConfig()`. (Lines ~2681-2835)
- `packages/deep-wiki/src/server/spa/script.ts` — Exports `getSpaScript(opts: ScriptOptions): string`. Imports all script modules from `./scripts/`. Concatenates them in order: core → theme → sidebar → content → markdown → toc → graph(conditional) → ask-ai(conditional) → websocket(conditional) → admin. Imports `ScriptOptions` from `./types`.

### Files to Modify
- `packages/deep-wiki/src/server/spa-template.ts` — Remove the entire `getSpaScript()` function and `ScriptOptions` interface (since ScriptOptions already moved in commit 001). Replace with `import { getSpaScript } from './spa/script';`. The call site in `generateSpaHtml()` is unchanged: `${getSpaScript({...})}`.

## Implementation Notes
- **Assembler structure**:
  ```typescript
  import type { ScriptOptions } from './types';
  import { getCoreScript } from './scripts/core';
  import { getThemeScript } from './scripts/theme';
  // ... all other imports
  
  export function getSpaScript(opts: ScriptOptions): string {
      let script = getCoreScript(opts.defaultTheme);
      script += getThemeScript();
      script += getSidebarScript({ enableSearch: opts.enableSearch, enableGraph: opts.enableGraph });
      script += getContentScript({ enableAI: opts.enableAI });
      script += getMarkdownScript();
      script += getTocScript();
      if (opts.enableGraph) script += getGraphScript();
      if (opts.enableAI) script += getAskAiScript();
      if (opts.enableWatch) script += getWebSocketScript();
      script += getAdminScript();
      return script;
  }
  ```
- After this commit, `spa-template.ts` should only contain: imports, `generateSpaHtml()` with the HTML template, and the re-export of `SpaTemplateOptions`.
- The `ScriptOptions` type was already moved to `spa/types.ts` in commit 001, so this commit just removes the redundant definition.

## Tests
- No new tests needed — existing test coverage is comprehensive
- Run full test suite

## Acceptance Criteria
- [ ] `spa/scripts/admin.ts` exports `getAdminScript`
- [ ] `spa/script.ts` cleanly assembles all modules in correct order
- [ ] `spa-template.ts` no longer contains any `getSpaScript` implementation
- [ ] `spa-template.ts` is now ~200 lines (HTML template + imports only)
- [ ] Generated HTML output is byte-identical to before
- [ ] All existing tests pass unchanged

## Dependencies
- Depends on: 005 (all other script modules extracted)
