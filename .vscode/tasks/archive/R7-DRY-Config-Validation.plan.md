# R7: DRY Config Validation in `config-loader.ts`

## Problem

`packages/deep-wiki/src/config-loader.ts` has **19 repeated validation blocks** inside `validateConfig()` (lines 231-411). Three distinct patterns repeat:

### Pattern A — String field (6 occurrences):
```typescript
if (raw.field !== undefined) {
    if (typeof raw.field !== 'string') {
        throw new Error('Config error: "field" must be a string');
    }
    config.field = raw.field;
}
```
Fields: `repoPath`, `output`, `model`, `focus`, `seeds`, `title`

### Pattern B — Number field with positive/finite check (3 occurrences):
```typescript
if (raw.field !== undefined) {
    if (typeof raw.field !== 'number' || !Number.isFinite(raw.field) || raw.field <= 0) {
        throw new Error('Config error: "field" must be a positive number');
    }
    config.field = raw.field;
}
```
Fields: `concurrency`, `timeout`, `phase` (phase also checks integer + range)

### Pattern C — Boolean field (5 occurrences):
```typescript
if (raw.field !== undefined) {
    if (typeof raw.field !== 'boolean') {
        throw new Error('Config error: "field" must be a boolean');
    }
    config.field = raw.field;
}
```
Fields: `useCache`, `force`, `noCluster`, `strict`, `skipWebsite`

Plus 2 enum fields (`depth`, `theme`) and 5 nested phase fields repeating the same patterns.

## Approach

Extract 3-4 generic validator helpers. Keep them local to `config-loader.ts` (no need for a separate file since they're only used here).

## File Changes

### 1. Add helpers at top of `config-loader.ts` (above `validateConfig`)

```typescript
function assignString<T extends Record<string, unknown>>(
    raw: Record<string, unknown>, field: string, target: T
): void {
    if (raw[field] !== undefined) {
        if (typeof raw[field] !== 'string') {
            throw new Error(`Config error: "${field}" must be a string`);
        }
        (target as Record<string, unknown>)[field] = raw[field];
    }
}

function assignBoolean<T extends Record<string, unknown>>(
    raw: Record<string, unknown>, field: string, target: T
): void {
    if (raw[field] !== undefined) {
        if (typeof raw[field] !== 'boolean') {
            throw new Error(`Config error: "${field}" must be a boolean`);
        }
        (target as Record<string, unknown>)[field] = raw[field];
    }
}

function assignPositiveNumber<T extends Record<string, unknown>>(
    raw: Record<string, unknown>, field: string, target: T
): void {
    if (raw[field] !== undefined) {
        if (typeof raw[field] !== 'number' || !Number.isFinite(raw[field] as number) || (raw[field] as number) <= 0) {
            throw new Error(`Config error: "${field}" must be a positive number`);
        }
        (target as Record<string, unknown>)[field] = raw[field];
    }
}

function assignEnum<T extends Record<string, unknown>>(
    raw: Record<string, unknown>, field: string, target: T, validValues: readonly string[]
): void {
    if (raw[field] !== undefined) {
        if (typeof raw[field] !== 'string') {
            throw new Error(`Config error: "${field}" must be a string`);
        }
        if (!validValues.includes(raw[field] as string)) {
            throw new Error(`Config error: "${field}" must be one of: ${validValues.join(', ')}`);
        }
        (target as Record<string, unknown>)[field] = raw[field];
    }
}
```

### 2. Replace validation blocks in `validateConfig()`

**Before (6 string fields, ~30 lines):**
```typescript
if (raw.repoPath !== undefined) {
    if (typeof raw.repoPath !== 'string') { throw new Error('...'); }
    config.repoPath = raw.repoPath;
}
if (raw.output !== undefined) { ... }
// ... repeated 6 times
```

**After (~6 lines):**
```typescript
assignString(raw, 'repoPath', config);
assignString(raw, 'output', config);
assignString(raw, 'model', config);
assignString(raw, 'focus', config);
assignString(raw, 'seeds', config);
assignString(raw, 'title', config);
```

Similarly for boolean fields:
```typescript
assignBoolean(raw, 'useCache', config);
assignBoolean(raw, 'force', config);
assignBoolean(raw, 'noCluster', config);
assignBoolean(raw, 'strict', config);
assignBoolean(raw, 'skipWebsite', config);
```

Number fields:
```typescript
assignPositiveNumber(raw, 'concurrency', config);
assignPositiveNumber(raw, 'timeout', config);
```

Enum fields:
```typescript
assignEnum(raw, 'depth', config, VALID_DEPTHS);
assignEnum(raw, 'theme', config, VALID_THEMES);
```

**`phase` field** keeps its custom validation (integer check + range 1-5) since it has unique constraints.

### 3. Apply same helpers to nested phase validation (lines 357-405)

```typescript
assignString(phaseRaw, 'model', phaseConfig);
assignPositiveNumber(phaseRaw, 'timeout', phaseConfig);
assignPositiveNumber(phaseRaw, 'concurrency', phaseConfig);
assignEnum(phaseRaw, 'depth', phaseConfig, VALID_DEPTHS);
assignBoolean(phaseRaw, 'skipAI', phaseConfig);
```

## Tests

### Existing: `test/config-loader.test.ts`

All existing config validation tests must pass unchanged. The error messages must remain identical (the helpers produce the same messages).

No new tests needed — existing test coverage is comprehensive for validation logic.

## Validation

```bash
cd packages/deep-wiki && npm run build && npm run test:run
```

## Impact

~90 lines of repetitive validation code reduced to ~20 lines. Adding new config fields becomes a one-liner.
