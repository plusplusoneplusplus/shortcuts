# R6: Extract `getErrorMessage()` Utility

## Problem

The pattern `(error as Error).message` appears **34 times** across 17 files in `packages/deep-wiki/src/`. Variable names vary (`error`, `e`, `parseError`, `writeError`), but the intent is identical: safely extract a message from an `unknown` error.

**Affected files:**
- `cli.ts` (2 occurrences)
- `commands/generate.ts` (7)
- `commands/discover.ts` (2)
- `commands/seeds.ts` (2)
- `commands/serve.ts` (2)
- `config-loader.ts` (1)
- `seeds/seed-file-parser.ts` (1)
- `seeds/response-parser.ts` (2)
- `seeds/seeds-session.ts` (1)
- `discovery/response-parser.ts` (2)
- `discovery/discovery-session.ts` (2)
- `discovery/large-repo-handler.ts` (1)
- `discovery/iterative/merge-response-parser.ts` (2)
- `discovery/iterative/merge-session.ts` (2)
- `discovery/iterative/probe-response-parser.ts` (1)
- `discovery/iterative/probe-session.ts` (1)
- `server/api-handlers.ts` (4)

## Approach

Create a utility function and incrementally replace occurrences. The function handles non-Error throws gracefully (returns `String(e)` for primitives).

## File Changes

### 1. Create utility (choose one location)

**Option A:** Add to an existing shared utils file if one exists.
**Option B:** Create `packages/deep-wiki/src/utils/error-utils.ts`:

```typescript
/**
 * Safely extract an error message from an unknown thrown value.
 */
export function getErrorMessage(error: unknown): string {
    if (error instanceof Error) {
        return error.message;
    }
    return String(error);
}
```

### 2. Replace all 34 occurrences

Each replacement follows the same pattern:

**Before:**
```typescript
} catch (error) {
    throw new Error(`Something failed: ${(error as Error).message}`);
}
```

**After:**
```typescript
import { getErrorMessage } from '../utils/error-utils';
// ...
} catch (error) {
    throw new Error(`Something failed: ${getErrorMessage(error)}`);
}
```

**Implementation note:** Do this file-by-file. Add the import to each file, then find-and-replace all `(error as Error).message` → `getErrorMessage(error)`, `(e as Error).message` → `getErrorMessage(e)`, `(parseError as Error).message` → `getErrorMessage(parseError)`, `(writeError as Error).message` → `getErrorMessage(writeError)` within that file.

## Tests

### New: `test/utils/error-utils.test.ts`

- [x] Returns message for Error instances
- [x] Returns message for Error subclasses (TypeError, etc.)
- [x] Returns string representation for string throws
- [x] Returns string representation for number throws
- [x] Returns string representation for null/undefined

### Existing tests

All 59 test files must continue to pass — this is a pure behavioral no-op refactoring.

## Validation

```bash
cd packages/deep-wiki && npm run build && npm run test:run
```

## Notes

- This is a zero-risk refactoring — the behavior is identical for Error instances.
- The utility is *slightly* better than raw casting because it handles non-Error throws (e.g., `throw "oops"` or `throw 42`) without crashing.
- Consider doing this refactoring in conjunction with R5 (shared AI response parser), since several of the 34 occurrences will be eliminated by R5.
