---
status: pending
---

# 002: Add toolCompactness display setting (server + client hook)

## Summary
Adds a new `toolCompactness` integer config field (values `0 | 1 | 2`, default `0`) to the CoC CLI config schema and surfaces it through `GET /api/admin/config` → `resolved.toolCompactness` and persists it via `PUT /api/admin/config`. The client hook `useDisplaySettings` is extended to read and expose this value.

## Motivation
This is a display-only setting that controls how tool-call entries are rendered in the conversation UI (full / compact / minimal). It parallels the existing `showReportIntent` boolean pattern already established in commit 001 and shares the same server + client pipeline.

## Changes

### Files to Create
_(none)_

### Files to Modify

- `packages/coc/src/config/schema.ts` — Add `toolCompactness` field to `CLIConfigSchema`
- `packages/coc/src/config.ts` — Add `toolCompactness` to `CLIConfig`, `ResolvedCLIConfig`, `DEFAULT_CONFIG`, `CONFIG_SOURCE_KEYS`, and `mergeConfig`
- `packages/coc/src/server/admin-handler.ts` — Add validation + persistence for `toolCompactness` in `PUT /api/admin/config`
- `packages/coc/src/server/spa/client/react/hooks/useDisplaySettings.ts` — Extend `DisplaySettings` type, `DEFAULT_SETTINGS`, and `fetchDisplaySettings`

### Files to Delete
_(none)_

## Implementation Notes

### 1. Zod schema — `packages/coc/src/config/schema.ts` (line 22)

Add after the `showReportIntent` entry (line 22):

```ts
/** How compact to render tool calls in conversation views: 0=full, 1=compact, 2=minimal (default: 0) */
toolCompactness: z.number().int().min(0).max(2).optional(),
```

The schema uses `.strict()` (line 39), so the field must be declared here or Zod will reject it.

---

### 2. Config types + defaults — `packages/coc/src/config.ts`

**`CLIConfig` interface** (currently ends ~line 58): add optional property:
```ts
/** How compact to render tool calls in conversation views: 0=full, 1=compact, 2=minimal */
toolCompactness?: 0 | 1 | 2;
```

**`ResolvedCLIConfig` interface** (currently ends ~line 88): add required property with narrow union type:
```ts
toolCompactness: 0 | 1 | 2;
```

**`DEFAULT_CONFIG`** (line 101): add:
```ts
toolCompactness: 0,
```

**`CONFIG_SOURCE_KEYS`** (line 129 – `as const` array): add `'toolCompactness'` alongside `'showReportIntent'`:
```ts
'timeout', 'persist', 'showReportIntent', 'toolCompactness',
```

**`mergeConfig`** (line 230): add after the `showReportIntent` line:
```ts
toolCompactness: (override.toolCompactness ?? base.toolCompactness) as 0 | 1 | 2,
```
The cast is needed because the schema-inferred type is `number` while `ResolvedCLIConfig` uses the narrower `0 | 1 | 2` union.

---

### 3. Admin PUT handler — `packages/coc/src/server/admin-handler.ts`

**Validation block** (after `showReportIntent` block, ~line 209):
```ts
if ('toolCompactness' in body) {
    if (
        typeof body.toolCompactness !== 'number' ||
        !Number.isInteger(body.toolCompactness) ||
        body.toolCompactness < 0 ||
        body.toolCompactness > 2
    ) {
        errors.push('toolCompactness must be 0, 1, or 2');
    }
}
```

**Persistence block** (after `showReportIntent` line ~242):
```ts
if ('toolCompactness' in body) { existing.toolCompactness = body.toolCompactness as CLIConfig['toolCompactness']; }
```

No changes needed to the GET handler — `getResolvedConfigWithSource` already walks `CONFIG_SOURCE_KEYS` dynamically and `resolved` is the full `ResolvedCLIConfig` object, so `toolCompactness` will appear automatically once it is added to those structures.

---

### 4. Client hook — `packages/coc/src/server/spa/client/react/hooks/useDisplaySettings.ts`

**`DisplaySettings` interface** (line 9):
```ts
interface DisplaySettings {
    showReportIntent: boolean;
    toolCompactness: 0 | 1 | 2;
}
```

**`DEFAULT_SETTINGS`** (line 13):
```ts
const DEFAULT_SETTINGS: DisplaySettings = { showReportIntent: false, toolCompactness: 0 };
```

**`fetchDisplaySettings`** return object (lines 23-25): extend the existing property bag:
```ts
return {
    showReportIntent: data?.resolved?.showReportIntent ?? false,
    toolCompactness: (data?.resolved?.toolCompactness ?? 0) as 0 | 1 | 2,
};
```
The `as 0 | 1 | 2` cast is safe because the server guarantees the value is `0`, `1`, or `2`; the fallback `0` matches the narrow type without needing an extra runtime check.

---

### Key patterns from existing code

- All `CONFIG_SOURCE_KEYS` entries (flat string keys) are iterated generically by `getFieldSource` via `(fileConfig as Record<string, unknown>)[key]`, so adding `'toolCompactness'` to the array is sufficient — no extra branch needed in that function.
- The `CLIConfigSchema` uses `.strict()`, so omitting the Zod field would cause a validation error whenever a config file containing `toolCompactness` is loaded.
- The `useDisplaySettings` hook uses a module-level cache (`cachedSettings`) and a deduplication promise (`fetchPromise`). Adding a field to the return object of `fetchDisplaySettings` automatically flows through the cache — no structural changes are required.

## Tests

### `packages/coc/test/config/schema.test.ts`
- `validates toolCompactness 0` — `CLIConfigSchema.parse({ toolCompactness: 0 })` → `result.toolCompactness === 0`
- `validates toolCompactness 1` — same with `1`
- `validates toolCompactness 2` — same with `2`
- `rejects toolCompactness 3` — expects `ZodError`
- `rejects toolCompactness -1` — expects `ZodError`
- `rejects non-integer toolCompactness` — e.g. `1.5`, expects `ZodError`
- `rejects string toolCompactness` — e.g. `'1'`, expects `ZodError`

### `packages/coc/test/config.test.ts`
- `DEFAULT_CONFIG.toolCompactness should be 0`
- `mergeConfig should override toolCompactness` — override `{ toolCompactness: 2 }`, expect `result.toolCompactness === 2`
- `mergeConfig should preserve toolCompactness default when not overridden` — expect `result.toolCompactness === 0`
- `getResolvedConfigWithSource should include toolCompactness in resolved` — config file with `toolCompactness: 1`, expect `result.resolved.toolCompactness === 1`
- `getResolvedConfigWithSource should report source as file for toolCompactness` — same setup, expect `result.sources.toolCompactness === 'file'`
- `getResolvedConfigWithSource should report source as default when toolCompactness absent` — no file, expect `result.sources.toolCompactness === 'default'`

### `packages/coc/test/server/admin-handler.test.ts`
- `PUT /api/admin/config should accept toolCompactness 0` → `body.resolved.toolCompactness === 0`, `body.sources.toolCompactness === 'file'`
- `PUT /api/admin/config should accept toolCompactness 2` → `body.resolved.toolCompactness === 2`
- `PUT /api/admin/config should reject toolCompactness 3` → status 400, `body.error` contains `'toolCompactness'`
- `PUT /api/admin/config should reject non-integer toolCompactness (1.5)` → status 400
- `PUT /api/admin/config should persist toolCompactness and not lose other config` — set `model` first, then `toolCompactness`; verify both survive

### `packages/coc/src/server/spa/client/react/hooks/useDisplaySettings.test.ts` _(if a unit test file exists; otherwise cover inline)_
- `fetchDisplaySettings maps toolCompactness from resolved` — mock fetch returning `{ resolved: { toolCompactness: 2 } }`, expect `settings.toolCompactness === 2`
- `fetchDisplaySettings defaults toolCompactness to 0 when absent` — mock fetch returning `{ resolved: {} }`, expect `settings.toolCompactness === 0`

## Acceptance Criteria
- [ ] `GET /api/admin/config` response includes `resolved.toolCompactness` (number, `0` when no config file)
- [ ] `GET /api/admin/config` response includes `sources.toolCompactness` (`'default'` or `'file'`)
- [ ] `PUT /api/admin/config { toolCompactness: 1 }` persists the value and returns it in `resolved`
- [ ] `PUT /api/admin/config { toolCompactness: 3 }` returns HTTP 400 with a message mentioning `toolCompactness`
- [ ] `PUT /api/admin/config { toolCompactness: 1.5 }` returns HTTP 400
- [ ] `useDisplaySettings()` returns `toolCompactness: 0 | 1 | 2` with default `0`
- [ ] Schema validation rejects values outside `[0, 2]` and non-integers
- [ ] All existing tests continue to pass

## Dependencies
- Depends on: None (parallel to commit 001)

## Assumed Prior State
- `showReportIntent` boolean is already present in `CLIConfig`, `ResolvedCLIConfig`, `DEFAULT_CONFIG`, `CONFIG_SOURCE_KEYS`, `CLIConfigSchema`, the PUT handler, and `useDisplaySettings` — `toolCompactness` follows the exact same pattern.
- `useDisplaySettings.ts` exists at `packages/coc/src/server/spa/client/react/hooks/useDisplaySettings.ts` with the module-level cache + `getOrFetch` structure shown above.
- `packages/coc/src/config/schema.ts` uses Zod `.strict()` for `CLIConfigSchema`.
- `packages/coc/src/server/admin-handler.ts` (coc-specific, not coc-server) wires `getResolvedConfigWithSource`, `loadConfigFile`, `writeConfigFile` directly from `../config`.
