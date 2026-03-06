# Plan: Persist Effort Selection to Preferences

## Problem

In the **Generate Task** dialog, the user can select an effort level (Low / Medium / High). This selection is currently ephemeral — it resets to the default every time the dialog opens. The user wants the last-used effort level to be saved to preferences and restored automatically on the next open.

## Current State

| Layer | File | What it stores today |
|-------|------|----------------------|
| React hook | `packages/coc/src/server/spa/client/react/hooks/usePreferences.ts` | `lastModel`, `lastDepth` |
| Backend handler | `packages/coc-server/src/preferences-handler.ts` | `lastModel`, `lastDepth` in `~/.coc/preferences.json` |
| Dialog | `packages/coc/src/server/spa/client/react/tasks/GenerateTaskDialog.tsx` | `effortLevel` state — **not persisted** |

The effort level drives both the model and depth via `EFFORT_PRESETS`, but those derived values are saved independently of the effort label. So if the user selects **High**, `lastDepth: 'deep'` is stored, but the effort tab still shows no selection on next open.

## Approach

Add `lastEffort` as a first-class preference field alongside `lastModel` and `lastDepth`.

1. **Backend** — extend `preferences-handler.ts` to accept and return `lastEffort` (`'low' | 'medium' | 'high'`).
2. **Hook** — extend `usePreferences.ts` to expose `effort` / `setEffort`, reading and writing `lastEffort`.
3. **Dialog** — initialize `effortLevel` state from `savedEffort` (from the hook) and call `persistEffort()` whenever the effort button is clicked.

## Tasks

### 1. Extend backend preferences schema
- [x] **File:** `packages/coc-server/src/preferences-handler.ts`
- Add `lastEffort?: 'low' | 'medium' | 'high'` to the `Preferences` type / validation.
- Include it in the PATCH merge logic (already uses spread — no structural change needed).

### 2. Extend `usePreferences` hook
- [x] **File:** `packages/coc/src/server/spa/client/react/hooks/usePreferences.ts`
- Add local state `effort` (default `undefined`).
- Read `lastEffort` from the GET response and set `effort`.
- Add `setEffort(e: EffortLevel)` that updates state and PATCHes `{ lastEffort: e }`.
- Export `effort` and `setEffort`.

### 3. Wire into `GenerateTaskDialog`
- [x] **File:** `packages/coc/src/server/spa/client/react/tasks/GenerateTaskDialog.tsx`
- Destructure `effort: savedEffort, setEffort: persistEffort` from `usePreferences()`.
- When preferences finish loading (`loaded`), if `savedEffort` is set, update `effortLevel` to `savedEffort` (and apply the preset — model, depth).
- On each effort button click, call `persistEffort(level)` in addition to the existing state update.

## Notes

- `EffortLevel` type is already defined locally in `GenerateTaskDialog.tsx`; move/share it or import in the hook. Simpler option: keep the type in the dialog and use `string` in the hook with a cast — avoids a new shared module.
- Default effort when no preference exists: keep the current default (no selection / 'medium' — whatever is in use today).
- The existing model/depth persistence remains unchanged; effort preference is additive.
- No migration needed — `~/.coc/preferences.json` files without `lastEffort` simply return `undefined`, which maps to the current default behavior.
