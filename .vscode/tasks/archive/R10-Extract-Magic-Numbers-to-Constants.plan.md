# R10: Extract Magic Numbers to Named Constants

## Problem

Several files use inline magic numbers that reduce readability and make values harder to find and change.

## File Changes

### 1. `packages/deep-wiki/src/server/file-watcher.ts` (line 59)

**Before:**
```typescript
const { repoPath, debounceMs = 2000 } = this.options;
```

**After:**
```typescript
const DEFAULT_DEBOUNCE_MS = 2000;
// ... (at module level or as class static)

const { repoPath, debounceMs = DEFAULT_DEBOUNCE_MS } = this.options;
```

### 2. `packages/deep-wiki/src/consolidation/rule-based-consolidator.ts` (line 250-256)

**Before:**
```typescript
const levels: Record<string, number> = { low: 0, medium: 1, high: 2 };
let max = 0;
for (const m of modules) {
    const level = levels[m.complexity] ?? 0;
    if (level > max) { max = level; }
}
return max === 2 ? 'high' : max === 1 ? 'medium' : 'low';
```

**After:**
```typescript
const COMPLEXITY_LEVELS: Record<string, number> = { low: 0, medium: 1, high: 2 };
const COMPLEXITY_NAMES: Record<number, string> = { 2: 'high', 1: 'medium', 0: 'low' };
// ...
let max = 0;
for (const m of modules) {
    const level = COMPLEXITY_LEVELS[m.complexity] ?? 0;
    if (level > max) { max = level; }
}
return COMPLEXITY_NAMES[max] ?? 'low';
```

### 3. `packages/deep-wiki/src/consolidation/ai-consolidator.ts` (line 300-306)

Same complexity level pattern — apply identical constants. Since both consolidator files use this pattern, extract to a shared location:

**Option A:** Create `packages/deep-wiki/src/consolidation/constants.ts`:
```typescript
export const COMPLEXITY_LEVELS: Record<string, number> = { low: 0, medium: 1, high: 2 };
export const COMPLEXITY_NAMES: Record<number, string> = { 2: 'high', 1: 'medium', 0: 'low' };

export function resolveMaxComplexity(modules: { complexity: string }[]): string {
    let max = 0;
    for (const m of modules) {
        const level = COMPLEXITY_LEVELS[m.complexity] ?? 0;
        if (level > max) { max = level; }
    }
    return COMPLEXITY_NAMES[max] ?? 'low';
}
```

Then both consolidators call `resolveMaxComplexity(modules)` instead of duplicating the logic.

**Option B:** Keep constants inline in each file (simpler, less coupling).

### 4. `packages/deep-wiki/src/server/context-builder.ts` (line 107-108)

**Before:**
```typescript
if (nameLower.includes(term)) {
    score *= 1.5;
}
```

**After:**
```typescript
const NAME_MATCH_BOOST = 1.5;
// ... (at module level)

if (nameLower.includes(term)) {
    score *= NAME_MATCH_BOOST;
}
```

## Tests

No new tests needed. All existing tests must pass unchanged since values don't change.

## Validation

```bash
cd packages/deep-wiki && npm run build && npm run test:run
```

## Notes

- This is a cosmetic/readability refactoring with zero behavioral change.
- If choosing Option A for consolidation constants, this also eliminates ~8 lines of duplication between the two consolidator files.
- Consider combining with R6 if doing both in one PR.
