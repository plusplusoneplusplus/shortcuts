# R5: Extract Shared AI Response Parsing Utility

## Problem

Four response parsers in `packages/deep-wiki/src/` repeat the same ~15-line JSON extraction + validation pattern:
1. `seeds/response-parser.ts` (lines 35-65) — with `attemptJsonRepair` fallback
2. `discovery/response-parser.ts` (lines 42-72) — with `attemptJsonRepair` fallback
3. `discovery/iterative/probe-response-parser.ts` (lines 27-47) — simplified, no repair
4. `discovery/iterative/merge-response-parser.ts` (lines 27-47) — simplified, no repair

The duplicated pattern:
```typescript
if (!response || typeof response !== 'string') {
    throw new Error('Empty or invalid response from AI');
}
const jsonStr = extractJSON(response);
if (!jsonStr) {
    throw new Error('No JSON found in AI response...');
}
let parsed: unknown;
try {
    parsed = JSON.parse(jsonStr);
} catch (parseError) {
    // optional: attemptJsonRepair fallback
    throw new Error(`Invalid JSON in AI response: ${(parseError as Error).message}`);
}
if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('AI response is not a JSON object');
}
```

## Approach

Create a shared utility function with an option to enable/disable JSON repair, then replace all 4 duplicated blocks with a single call.

## File Changes

### 1. Create `packages/deep-wiki/src/utils/parse-ai-response.ts`

```typescript
import { extractJSON, attemptJsonRepair } from './json-utils'; // or wherever extractJSON lives

export interface ParseOptions {
    /** Context string for error messages (e.g., 'discovery', 'probe') */
    context: string;
    /** Whether to attempt JSON repair on parse failure. Default: false */
    repair?: boolean;
}

/**
 * Validates an AI response string, extracts JSON, parses it, and validates it's an object.
 * Throws descriptive errors at each step.
 */
export function parseAIJsonResponse(response: string | undefined | null, options: ParseOptions): Record<string, unknown> {
    const { context, repair = false } = options;

    if (!response || typeof response !== 'string') {
        throw new Error(`Empty or invalid response from AI (${context})`);
    }

    const jsonStr = extractJSON(response);
    if (!jsonStr) {
        throw new Error(`No JSON found in AI response (${context}). The AI may not have returned structured output.`);
    }

    let parsed: unknown;
    try {
        parsed = JSON.parse(jsonStr);
    } catch (parseError) {
        if (repair) {
            const fixed = attemptJsonRepair(jsonStr);
            if (fixed) {
                try {
                    parsed = JSON.parse(fixed);
                } catch {
                    throw new Error(`Invalid JSON in ${context} response: ${(parseError as Error).message}`);
                }
            } else {
                throw new Error(`Invalid JSON in ${context} response: ${(parseError as Error).message}`);
            }
        } else {
            throw new Error(`Invalid JSON in ${context} response: ${(parseError as Error).message}`);
        }
    }

    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        throw new Error(`${context} response is not a JSON object`);
    }

    return parsed as Record<string, unknown>;
}
```

**Note:** Check where `extractJSON` and `attemptJsonRepair` are currently defined. They may need to be re-exported from a shared location, or the new utility should import from wherever they currently live.

### 2. Update `seeds/response-parser.ts`

Replace the 30-line block (lines 35-65) with:
```typescript
import { parseAIJsonResponse } from '../utils/parse-ai-response';
// ...
const parsed = parseAIJsonResponse(response, { context: 'seeds', repair: true });
```

### 3. Update `discovery/response-parser.ts`

Replace the 30-line block (lines 42-72) with:
```typescript
import { parseAIJsonResponse } from '../utils/parse-ai-response';
// ...
const parsed = parseAIJsonResponse(response, { context: 'discovery', repair: true });
```

### 4. Update `discovery/iterative/probe-response-parser.ts`

Replace the 20-line block (lines 27-47) with:
```typescript
import { parseAIJsonResponse } from '../../utils/parse-ai-response';
// ...
const parsed = parseAIJsonResponse(response, { context: 'probe' });
```

### 5. Update `discovery/iterative/merge-response-parser.ts`

Replace the 20-line block (lines 27-47) with:
```typescript
import { parseAIJsonResponse } from '../../utils/parse-ai-response';
// ...
const parsed = parseAIJsonResponse(response, { context: 'merge' });
```

## Tests

### New: `test/utils/parse-ai-response.test.ts`

- [ ] Returns parsed object for valid JSON response
- [ ] Throws on empty/null/undefined response
- [ ] Throws when no JSON found in response
- [ ] Throws on invalid JSON (no repair mode)
- [ ] Attempts repair and succeeds when `repair: true`
- [ ] Attempts repair and fails with original error when repair fails
- [ ] Throws when response is JSON array (not object)
- [ ] Includes context string in all error messages

### Existing tests must still pass

All 4 response parser test files should pass without modification since behavior is identical:
- `test/seeds/response-parser.test.ts`
- `test/discovery/response-parser.test.ts` (if exists)
- `test/discovery/iterative/probe-response-parser.test.ts`
- `test/discovery/iterative/merge-response-parser.test.ts` (if exists)

## Validation

```bash
cd packages/deep-wiki && npm run build && npm run test:run
```

## Impact

~60 lines of duplicated code removed across 4 files. Single point of maintenance for JSON parsing logic.
