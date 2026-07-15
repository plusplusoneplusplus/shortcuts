/**
 * Shared server-logging setup.
 *
 * Wires the Pino logger stack into the coc-server capture chain so that
 * request logs, AI-service logs, and Claude-SDK logs all flow into:
 *   - the in-process ring buffer that feeds `/api/logs/stream`
 *     (via the `setServerLogger()` capture proxy), and
 *   - the optional `<logDir>/*.ndjson` files.
 *
 * This block used to live inline in the CLI `serve` command. It is extracted
 * here so BOTH entry points can share identical wiring:
 *   - `packages/coc/src/commands/serve.ts` (the `coc serve` CLI), and
 *   - `packages/coc-desktop/src/server-entry.ts` (the desktop-forked server),
 *     which reaches this helper via `require('@plusplusoneplusplus/coc/dist/server')`.
 *
 * Keeping it in one place guarantees the desktop-forked server captures logs
 * exactly like the CLI, and that `setServerLogger()` is invoked exactly once
 * per process (no double-wrapping of the capture proxy).
 */

import type pino from 'pino';
import { createCLIPinoLogger, pinoAdapterForPipelineCore } from '../../pino-setup';
import { resolveLoggingConfig } from '../../config';
import type { LoggingConfig } from '../../config';
import { setLogger, initAIServiceLogger } from '@plusplusoneplusplus/forge';
import { initSDKLogger } from '@plusplusoneplusplus/coc-agent-sdk';
import { setServerLogger, getServerLogger } from './server-logger';

export interface SetupServerLoggingOptions {
    /** Minimum log level (CLI `--log-level`), overrides config-file level. */
    logLevel?: string;
    /** Directory for `*.ndjson` log files (e.g. `<dataDir>/logs`). */
    logDir: string;
    /** Loaded config file — its `logging:` section is honored if present. */
    fileConfig?: { logging?: LoggingConfig };
}

/**
 * Create the Pino logger stack and route it through the coc-server capture
 * proxy. Call this ONCE per process, before `createExecutionServer()`.
 *
 * @returns the root `ai` and `coc` Pino child loggers (the caller may use
 *   `coc` for its own structured startup logs).
 */
export function setupServerLogging(
    opts: SetupServerLoggingOptions,
): { ai: pino.Logger; coc: pino.Logger } {
    const { ai, coc } = createCLIPinoLogger(
        resolveLoggingConfig(
            { logLevel: opts.logLevel, logDir: opts.logDir },
            opts.fileConfig?.logging,
        ),
    );
    // Wire the server capture proxy first so that subsequent child loggers
    // derived from getServerLogger() are also routed through the ring buffer.
    setServerLogger(coc);
    initAIServiceLogger(getServerLogger().child({ component: 'ai-service' }));
    // Route coc-agent-sdk getSDKLogger() through the same capture chain so
    // Claude SDK debug logs appear in the dashboard log stream.
    initSDKLogger(getServerLogger().child({ component: 'claude-sdk' }));
    // Route forge getLogger() through the same capture chain so MCP/AI debug
    // logs (LogCategory.MCP, LogCategory.AI) appear in the /api/logs/stream
    // dashboard view.
    setLogger(pinoAdapterForPipelineCore(getServerLogger().child({ store: 'ai-service' })));
    return { ai, coc };
}
