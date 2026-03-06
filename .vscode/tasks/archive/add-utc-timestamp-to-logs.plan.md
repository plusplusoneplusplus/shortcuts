# Add UTC Timestamp to Log Output

## Problem

The `consoleLogger` (pipeline-core) and CLI logger (coc) produce log lines without timestamps:

```
[DEBUG] [AI Service] CopilotSDKService [session-id]: Turn 20 ended
```

The user wants UTC timestamps prepended so the output looks like:

```
[2026-02-28T21:35:07.757Z] [DEBUG] [AI Service] CopilotSDKService [session-id]: Turn 20 ended
```

**Note:** The VS Code extension logger (`src/shortcuts/shared/extension-logger.ts`) already includes ISO timestamps — no changes needed there.

## Approach

Add `new Date().toISOString()` timestamp prefix to the two loggers that lack it.

## Changes

### 1. `packages/pipeline-core/src/logger.ts` — `consoleLogger`

Update the four log methods (lines 68–71) from:

```ts
debug: (cat, msg) => console.debug(`[DEBUG] [${cat}] ${msg}`),
```

to:

```ts
debug: (cat, msg) => console.debug(`[${new Date().toISOString()}] [DEBUG] [${cat}] ${msg}`),
```

Same pattern for `info`, `warn`, `error`.

### 2. `packages/coc/src/logger.ts` — `createCLILogger()`

Update the four log methods to prepend a gray-colored ISO timestamp:

```ts
debug: process.stderr.write(`${gray(`[${new Date().toISOString()}] [DEBUG] [${category}]`)} ${message}\n`);
```

Same pattern for `info`, `warn`, `error`.

### 3. Update tests

Fix any snapshot or string-matching tests in:
- `packages/pipeline-core/src/__tests__/` (logger tests)
- `packages/coc/src/__tests__/` (logger tests)

that assert exact log format strings.

## Out of Scope

- VS Code extension logger (already has timestamps)
- Changing timestamp format (ISO 8601 / UTC is the standard)
- Adding configurable timestamp toggle
