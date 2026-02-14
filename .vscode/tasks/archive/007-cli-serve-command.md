---
status: pending
---

# 007: Add `pipeline serve` CLI command

## Summary

Wire the execution server (commit 003) into the `pipeline` CLI as the `pipeline serve` subcommand. Follow the established patterns in `cli.ts` (Commander.js command registration, `resolveConfig()` + `applyGlobalOptions()`, lazy imports, `process.exit(exitCode)`) and mirror the deep-wiki serve command structure (`executeServe()` → server creation → signal handling → graceful shutdown).

## Depends On

- **Commit 003** — `createExecutionServer()` factory and `FileProcessStore`

## Files Changed

| File | Action | Purpose |
|------|--------|---------|
| `packages/pipeline-cli/src/server/types.ts` | **NEW** | `ServeCommandOptions` interface |
| `packages/pipeline-cli/src/commands/serve.ts` | **NEW** | `executeServe()` command executor |
| `packages/pipeline-cli/src/cli.ts` | MODIFY | Register `pipeline serve` subcommand |
| `packages/pipeline-cli/src/config.ts` | MODIFY | Add `serve` section to config types + defaults |
| `packages/pipeline-cli/test/commands/serve.test.ts` | **NEW** | Unit tests |

## Detailed Changes

### 1. `packages/pipeline-cli/src/server/types.ts` — NEW

Define the options interface for the serve command, mirroring deep-wiki's `ServeCommandOptions` pattern (`packages/deep-wiki/src/server/types.ts`).

```ts
export interface ServeCommandOptions {
    port?: number;       // default: 4000
    host?: string;       // default: 'localhost'
    dataDir?: string;    // default: ~/.pipeline-server/
    open?: boolean;      // default: true (--no-open disables)
    theme?: 'auto' | 'light' | 'dark';  // default: 'auto'
    noColor?: boolean;
}
```

### 2. `packages/pipeline-cli/src/commands/serve.ts` — NEW

Follow the exact structure of `packages/deep-wiki/src/commands/serve.ts`:

```ts
export async function executeServe(options: ServeCommandOptions): Promise<number>
```

**Flow** (mirrors deep-wiki `executeServe` at lines 47-185):

1. **Resolve data directory** — Default `~/.pipeline-server/`, expand `~`, create with `fs.mkdirSync({ recursive: true })` if missing.
2. **Create FileProcessStore** — `new FileProcessStore(resolvedDataDir)` (from commit 003).
3. **Create ExecutionServer** — Lazy import `createExecutionServer` (from commit 003's server module), pass store + `{ port, host, theme }`.
4. **Print startup banner** to `process.stderr` using the existing logger utilities (`printHeader`, `printKeyValue`, `printSuccess`, `printInfo`, `bold` — all exported from `packages/pipeline-cli/src/logger.ts`). Load process count from store for the banner.

   ```
   ┌─────────────────────────────────────┐
   │  AI Execution Dashboard             │
   │  ───────────────────────────────    │
   │  Local:    http://localhost:4000    │
   │  Data:     ~/.pipeline-server/     │
   │  Processes: 42                      │
   │                                     │
   │  Press Ctrl+C to stop              │
   └─────────────────────────────────────┘
   ```

   The banner is a single `process.stderr.write()` call with box-drawing characters. Use the `bold` and `cyan` helpers from the logger for the URL and header line.

5. **Open browser** if `options.open !== false` — Reuse the same cross-platform pattern from deep-wiki (lines 240-259): `open` on darwin, `start ""` on win32, `xdg-open` on linux. Implement as a local `openBrowser(url: string)` helper (do **not** import from deep-wiki).

6. **Wait for SIGINT/SIGTERM** — Identical promise pattern to deep-wiki lines 161-172:
   ```ts
   await new Promise<void>((resolve) => {
       const shutdown = async () => {
           process.stderr.write('\n');
           printInfo('Shutting down server...');
           await server.close();
           printSuccess('Server stopped.');
           resolve();
       };
       process.on('SIGINT', () => void shutdown());
       process.on('SIGTERM', () => void shutdown());
   });
   ```

7. **Return `EXIT_CODES.SUCCESS`** (import from `../cli`).

**Error handling:** Catch `EADDRINUSE` and print a port-conflict message (same pattern as deep-wiki line 178-184). All other errors → `EXIT_CODES.EXECUTION_ERROR`.

### 3. `packages/pipeline-cli/src/cli.ts` — MODIFY

Add a new command block between the `list` command (line 122) and the `return program` (line 124), following the exact same section pattern used by `run`, `validate`, and `list`.

```ts
// ========================================================================
// pipeline serve
// ========================================================================

program
    .command('serve')
    .description('Start the AI Execution Dashboard web server')
    .option('-p, --port <number>', 'Port number', (v: string) => parseInt(v, 10))
    .option('-H, --host <string>', 'Bind address')
    .option('-d, --data-dir <path>', 'Data directory for process storage')
    .option('--no-open', 'Don\'t auto-open browser')
    .option('--theme <theme>', 'UI theme: auto, light, dark')
    .option('--no-color', 'Disable colored output')
    .action(async (opts: Record<string, unknown>) => {
        const config = resolveConfig();
        applyGlobalOptions(opts, config);

        const { executeServe } = await import('./commands/serve');
        const exitCode = await executeServe({
            port: (opts.port as number | undefined) ?? config.serve?.port,
            host: (opts.host as string | undefined) ?? config.serve?.host,
            dataDir: (opts.dataDir as string | undefined) ?? config.serve?.dataDir,
            open: opts.open as boolean | undefined,
            theme: (opts.theme as string | undefined ?? config.serve?.theme) as ServeCommandOptions['theme'],
            noColor: opts.color === false,
        });
        process.exit(exitCode);
    });
```

Key points:
- **Lazy import** of `./commands/serve` inside the action (matching deep-wiki pattern at line 324) to avoid loading server code for non-serve commands.
- **No positional argument** — unlike deep-wiki's `serve <wiki-dir>`, this command has no required argument; the data dir comes from `--data-dir` or config.
- Port option uses a parse function `(v: string) => parseInt(v, 10)` — matching deep-wiki line 296.
- `--no-open` uses Commander's boolean negation (`opts.open` is `false` when `--no-open` is passed).
- Config values serve as fallback when CLI flags are absent (CLI flags override config).

Import the `ServeCommandOptions` type at the top of the file (type-only import):

```ts
import type { ServeCommandOptions } from './server/types';
```

### 4. `packages/pipeline-cli/src/config.ts` — MODIFY

**Add `serve` section to `CLIConfig` interface** (after `timeout` at line 33):

```ts
/** Serve command defaults */
serve?: {
    port?: number;
    host?: string;
    dataDir?: string;
    theme?: 'auto' | 'light' | 'dark';
};
```

**Add `serve` to `ResolvedCLIConfig`** (after `timeout` at line 45):

```ts
serve?: {
    port: number;
    host: string;
    dataDir: string;
    theme: 'auto' | 'light' | 'dark';
};
```

**Add defaults** to `DEFAULT_CONFIG` (line 56-60):

```ts
serve: {
    port: 4000,
    host: 'localhost',
    dataDir: '~/.pipeline-server',
    theme: 'auto',
},
```

**Extend `validateConfig`** (after `timeout` validation, ~line 128): Validate the `serve` sub-object — check `port` is a positive number, `host` is a string, `dataDir` is a string, `theme` is one of `auto|light|dark`.

**Extend `mergeConfig`** (after `timeout` merge, ~line 156): Deep-merge the `serve` sub-object:

```ts
serve: {
    port: override?.serve?.port ?? base.serve?.port ?? 4000,
    host: override?.serve?.host ?? base.serve?.host ?? 'localhost',
    dataDir: override?.serve?.dataDir ?? base.serve?.dataDir ?? '~/.pipeline-server',
    theme: override?.serve?.theme ?? base.serve?.theme ?? 'auto',
},
```

### 5. `packages/pipeline-cli/test/commands/serve.test.ts` — NEW

Follow the exact test structure from `packages/pipeline-cli/test/commands/run.test.ts` — Vitest, `vi.spyOn` on stderr/stdout, `setColorEnabled(false)`, temp dir cleanup.

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
```

**Test cases:**

1. **Command registration & option parsing**
   - Import `createProgram` from `../../src/cli`.
   - Verify the `serve` command exists on the program.
   - Parse `['serve', '-p', '8080', '-H', '0.0.0.0', '-d', '/tmp/data', '--theme', 'dark', '--no-open', '--no-color']` and assert each option resolves correctly.

2. **Default values applied**
   - Parse `['serve']` with no flags.
   - Assert defaults: port `4000`, host `localhost`, dataDir `~/.pipeline-server`, theme `auto`, open `true`.

3. **Config file values used when no CLI flags**
   - Mock `resolveConfig()` to return a config with `serve: { port: 5000, host: '0.0.0.0', dataDir: '/data', theme: 'dark' }`.
   - Parse `['serve']` — assert the config values flow through to `executeServe` options.

4. **CLI flags override config file**
   - Mock `resolveConfig()` with `serve.port: 5000`.
   - Parse `['serve', '-p', '9000']` — assert port is `9000`.

5. **Graceful shutdown on SIGINT**
   - Call `executeServe()` with mocked `createExecutionServer` that returns `{ close: vi.fn(), url: '...' }`.
   - Emit `SIGINT` on `process`.
   - Assert `server.close()` was called.
   - Assert exit code is `0`.

6. **Browser open triggered when --open (default)**
   - Mock `child_process.exec`.
   - Call `executeServe({ open: true, ... })` with mocked server.
   - Assert `exec` was called with the correct platform-specific command (`open`/`start`/`xdg-open`).

7. **Browser NOT opened when --no-open**
   - Mock `child_process.exec`.
   - Call `executeServe({ open: false, ... })`.
   - Assert `exec` was **not** called.

8. **Startup banner printed to stderr**
   - `vi.spyOn(process.stderr, 'write')`.
   - Call `executeServe()` with mocked server.
   - Assert stderr output contains: `AI Execution Dashboard`, the URL, the data dir path, and `Ctrl+C`.

9. **EADDRINUSE produces helpful error**
   - Mock `createExecutionServer` to throw an error with message containing `EADDRINUSE`.
   - Assert exit code is `EXIT_CODES.EXECUTION_ERROR` and stderr mentions the port.

10. **Data directory created if missing**
    - Use a non-existent temp path as `dataDir`.
    - Call `executeServe()` with mocked server.
    - Assert the directory was created (`fs.existsSync`).

**Mocking strategy:**
- Mock the server module (`../../src/server/index` or wherever `createExecutionServer` lives) using `vi.mock()` to avoid starting a real HTTP server.
- Mock `FileProcessStore` to return a stub with `listProcesses()` returning an array of a known length (for banner process count).
- Use `vi.useFakeTimers()` if needed for signal testing, or emit signals manually.

## Config File Example

After this commit, `~/.pipeline-cli.yaml` supports:

```yaml
model: gpt-4
parallel: 5
output: table
approvePermissions: false
timeout: 300

serve:
  port: 4000
  host: localhost
  dataDir: ~/.pipeline-server
  theme: auto
```

## Verification

```bash
cd packages/pipeline-cli
npm run test:run -- --reporter=verbose test/commands/serve.test.ts
```

All 10 tests must pass. No existing tests should be broken — verify with:

```bash
npm run test:run
```
