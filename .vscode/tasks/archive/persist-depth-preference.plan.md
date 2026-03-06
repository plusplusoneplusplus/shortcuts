# Persist Last-Used Depth Option in Preferences

## Problem
The "Depth" dropdown in the Generate Task dialog resets to its default (`deep`) every time the dialog opens. The user expects their last selection to be remembered, similar to how the Model dropdown already persists via the preferences API.

## Approach
Follow the exact same pattern used for `lastModel` persistence — extend it to include `lastDepth`. Changes span three layers: server-side preferences (coc-server + coc), the React hook, and the dialog component. The VS Code extension's dialog (`ai-task-dialog.ts`) also stores depth via `workspaceState`, mirroring the model pattern.

## Affected Files

### Layer 1 — Server-side Preferences (types + validation)

| File | Change |
|------|--------|
| `packages/coc-server/src/preferences-handler.ts` | Add `lastDepth?: 'deep' \| 'normal'` to `UserPreferences`; add validation in `validatePreferences()` |
| `packages/coc/src/server/preferences-handler.ts` | Same as above (coc wraps its own copy of the handler) |
| `packages/coc-server/src/export-import-types.ts` | Add `lastDepth?: string` to `UserPreferences` type (for export/import schema) |

### Layer 2 — React Hook (`usePreferences`)

| File | Change |
|------|--------|
| `packages/coc/src/server/spa/client/react/hooks/usePreferences.ts` | Add `depth` + `setDepth` to `UsePreferencesResult`; load from `prefs.lastDepth` on mount; persist via `PATCH /preferences` with `{ lastDepth }` on change |

### Layer 3 — Generate Task Dialog (SPA)

| File | Change |
|------|--------|
| `packages/coc/src/server/spa/client/react/tasks/GenerateTaskDialog.tsx` | Destructure `depth: savedDepth, setDepth: persistDepth` from `usePreferences()`; initialize local `depth` state from `savedDepth`; call `persistDepth()` on dropdown change |

### Layer 4 — VS Code Extension Dialog

| File | Change |
|------|--------|
| `src/shortcuts/ai-service/ai-config-helpers.ts` | Add `getLastUsedDepth()` / `saveLastUsedDepth()` helpers (mirroring `getLastUsedAIModel` / `saveLastUsedAIModel`) |
| `src/shortcuts/tasks-viewer/ai-task-commands.ts` | Call `saveLastUsedDepth()` on submit; pass `getLastUsedDepth()` to dialog to set default |
| `src/shortcuts/tasks-viewer/ai-task-dialog.ts` | Accept a `defaultDepth` parameter; pre-select the matching radio button in HTML |

### Layer 5 — Tests

| File | Change |
|------|--------|
| `packages/coc/test/server/preferences-handler.test.ts` | Add tests for `lastDepth` round-trip (validate, read, write, PATCH merge) |
| `packages/coc/test/spa/react/usePreferences.test.tsx` | Add tests for `depth` loading and `setDepth` persistence |
| `packages/coc/test/spa/react/GenerateTaskDialog.test.tsx` | Verify depth default comes from preferences |
| `packages/coc-server/test/export-import-types.test.ts` | Verify `lastDepth` survives export/import validation |
| `src/test/suite/ai-task-dialog.test.ts` | Add test for depth default from workspace state |

## Todos

1. **server-types** — Add `lastDepth` to `UserPreferences` in both `coc-server` and `coc` preference handlers + validation
2. **export-import** — Add `lastDepth` to export-import types
3. **hook** — Extend `usePreferences` hook with `depth` / `setDepth`
4. **dialog-spa** — Wire depth persistence in `GenerateTaskDialog.tsx`
5. **vscode-helpers** — Add `getLastUsedDepth` / `saveLastUsedDepth` in `ai-config-helpers.ts`
6. **vscode-dialog** — Pass and use `defaultDepth` in `ai-task-dialog.ts` and `ai-task-commands.ts`
7. **tests** — Add/update tests across all layers

## Notes
- Default depth when no preference exists: `deep` (current SPA default) / `simple` (current VS Code default)
- `lastDepth` values differ: SPA uses `'deep' | 'normal'`, VS Code uses `'deep' | 'simple'`. Keep them as-is; they're independent UIs.
- The PATCH merge in the preferences API already handles partial updates, so depth persistence "just works" once the type + validation accepts it.
