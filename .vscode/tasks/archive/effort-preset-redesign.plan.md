# Effort Preset Redesign — GenerateTaskDialog

## Problem

The current effort level mapping in the CoC SPA `GenerateTaskDialog` uses:
- **Low** → haiku/mini/flash/fast model, low priority, normal depth
- **Medium** → sonnet/gpt-4/pro model, normal priority, normal depth
- **High** → opus/o3/o1/premium model, normal priority, deep depth

This mapping doesn't match the desired UX where:
- **Low** = quick, cheap task generation (sonnet-class model)
- **Medium** = higher quality (opus-class model)
- **High** = highest quality + deep analysis (opus-class model + deep depth)

Additionally, there's no visible indicator explaining what each effort level maps to.

## Proposed Changes

### 1. Update `EFFORT_PRESETS` mapping

Use the actual model IDs from the project's `MODEL_REGISTRY` (in `pipeline-core/src/copilot-sdk-wrapper/model-registry.ts`):

| Effort | Model keywords | Priority | Depth |
|--------|---------------|----------|-------|
| **Low** | sonnet, gpt-5.2, pro | `normal` | `normal` |
| **Medium** | opus, gpt-5.3, codex, premium | `normal` | `normal` |
| **High** | opus, gpt-5.3, codex, premium | `normal` | `deep` |

**Recognized models** (from MODEL_REGISTRY):
- `claude-sonnet-4.6` — standard tier
- `claude-haiku-4.5` — fast tier
- `claude-opus-4.6` — premium tier
- `gpt-5.2` — standard tier
- `gpt-5.3-codex` — premium tier
- `gemini-3-pro-preview` — standard tier

**File:** `packages/coc/src/server/spa/client/react/tasks/GenerateTaskDialog.tsx` (lines 45–61)

### 2. Add info icon with tooltip next to effort selector

Add a small `ⓘ` icon next to each effort button (or as a single icon near the "Effort" tab label) that shows a tooltip/popover explaining the mapping:
- **Low** — Sonnet-class model, normal analysis
- **Medium** — Opus-class model, normal analysis
- **High** — Opus-class model, deep analysis (uses go-deep skill)

This should be a hover tooltip or a small popover. Keep it minimal — inline text beneath each button showing the mapped model + depth.

**File:** `packages/coc/src/server/spa/client/react/tasks/GenerateTaskDialog.tsx`

### 3. Update tests

Update all tests that assert on the old preset values:

**File:** `packages/coc/test/spa/react/GenerateTaskDialog.test.tsx`

- `EFFORT_PRESETS exports are correctly shaped` — update expected priority/depth values
- `effort model picker selects correct model for each level` — update expected model picks
- `submit with effort=low` — update expected priority from `low` to `normal`, model from haiku to sonnet
- `submit with effort=medium` — update expected depth/model
- `submit with effort=high` — already expects `deep` depth, update priority
- `effort preset picks matching model from available models` — update assertion for low (sonnet instead of haiku)

### 4. Default effort level

Change default from `high` to `medium` — a sensible default that gives good quality without the heavier deep analysis.

## Files to Modify

1. `packages/coc/src/server/spa/client/react/tasks/GenerateTaskDialog.tsx` — presets + info icon
2. `packages/coc/test/spa/react/GenerateTaskDialog.test.tsx` — test assertions

## Notes

- The `pickModel` function does keyword substring matching against the dynamic model list from `/api/queue/models`. The keywords need to match the actual model IDs in MODEL_REGISTRY.
- Priority stays `normal` for all levels since priority controls queue ordering, not quality. Effort should only affect model + depth.
- The info icon should render inline descriptions below each effort button rather than a hover-only tooltip, for better discoverability.
