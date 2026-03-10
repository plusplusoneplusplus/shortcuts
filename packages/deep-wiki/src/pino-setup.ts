/**
 * Deep Wiki Pino logger initialization.
 *
 * Creates a Pino logger instance for Deep Wiki operations:
 * - pino-pretty to stderr in TTY mode
 * - Simple JSON to stderr when not a TTY
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import pino from 'pino';
import { createPinoAdapter } from '@plusplusoneplusplus/pipeline-core';
import type { Logger } from '@plusplusoneplusplus/pipeline-core';

export { createPinoAdapter };

// ============================================================================
// Types
// ============================================================================

export interface DeepWikiPinoOptions {
    /** Log level (default: 'info'). */
    level?: string;
    /** Whether verbose mode is active. Sets level to 'debug'. */
    verbose?: boolean;
    /** Pretty-print mode. 'auto' (default) = true if TTY. */
    pretty?: 'auto' | boolean;
}

// ============================================================================
// Factory
// ============================================================================

/**
 * Create a Pino logger for Deep Wiki CLI usage.
 *
 * Level precedence: verbose: true → 'debug', level option, default 'info'.
 * Pretty mode: 'auto' (default) uses TTY detection, true/false forces the mode.
 */
export function createDeepWikiPinoLogger(options: DeepWikiPinoOptions = {}): pino.Logger {
    const level = options.verbose ? 'debug' : (options.level ?? 'info');
    const prettyOpt = options.pretty ?? 'auto';
    const usePretty = prettyOpt === 'auto'
        ? process.stderr.isTTY === true
        : (prettyOpt as boolean);

    const pinoOpts: pino.LoggerOptions = {
        level,
        serializers: { err: pino.stdSerializers.err },
    };

    if (usePretty) {
        return pino({
            ...pinoOpts,
            transport: {
                target: 'pino-pretty',
                options: {
                    colorize: process.stderr.isTTY === true,
                    translateTime: 'SYS:standard',
                    ignore: 'pid,hostname',
                    levelFirst: true,
                },
            },
        });
    }

    return pino(pinoOpts, process.stderr);
}

// ============================================================================
// Adapter
// ============================================================================

/**
 * Wrap a Pino logger in the pipeline-core Logger interface.
 */
export function pinoAdapterForPipelineCore(pinoLogger: pino.Logger): Logger {
    return createPinoAdapter(pinoLogger);
}
