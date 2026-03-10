/**
 * CLI-specific Pino logger initialization.
 *
 * Creates a root Pino logger wired for CLI usage:
 * - pino-pretty to stderr in TTY mode
 * - Optional .ndjson file destinations under logDir
 * - Exports child loggers for ai-service and coc-service stores
 * - Exports a pipeline-core Logger adapter via createPinoAdapter
 */

import path from 'path';
import fs from 'fs';
import pino from 'pino';
import { createPinoAdapter } from '@plusplusoneplusplus/pipeline-core';
import type { Logger } from '@plusplusoneplusplus/pipeline-core';
import { isColorEnabled } from './logger';

// ============================================================================
// Types
// ============================================================================

export interface CLIPinoOptions {
    /** Explicit log level (default: 'info'). Overridden by verbose: true → 'debug'. */
    level?: string;
    /** Directory for .ndjson log files. No file logging when undefined. */
    logDir?: string;
    /** Force pino-pretty formatting. Defaults to process.stderr.isTTY. */
    pretty?: boolean;
    /** Shorthand: sets level to 'debug'. */
    verbose?: boolean;
}

export interface CLIPinoLoggers {
    /** Root Pino logger. */
    root: pino.Logger;
    /** Child logger tagged with store: 'ai-service'. */
    ai: pino.Logger;
    /** Child logger tagged with store: 'coc-service'. */
    coc: pino.Logger;
}

// ============================================================================
// Factory
// ============================================================================

/**
 * Create a root CLI Pino logger plus ai and coc child loggers.
 *
 * Level precedence: verbose → 'debug', level option, default 'info'.
 * Pretty mode: enabled when pretty option is true, or stderr is a TTY.
 * File logging: opt-in via logDir.
 */
export function createCLIPinoLogger(options: CLIPinoOptions): CLIPinoLoggers {
    const level = options.verbose ? 'debug' : (options.level ?? 'info');
    const usePretty = options.pretty ?? (process.stderr.isTTY === true);
    const colorize = isColorEnabled() && (process.stderr.isTTY === true);

    const pinoOpts: pino.LoggerOptions = {
        level,
        serializers: { err: pino.stdSerializers.err },
    };

    const prettyTransportOptions = {
        colorize,
        translateTime: 'SYS:standard',
        ignore: 'pid,hostname,store',
        messageFormat: '{category} {msg}',
        levelFirst: true,
    };

    let root: pino.Logger;

    if (options.logDir) {
        // Ensure log directory exists before opening file streams
        fs.mkdirSync(options.logDir, { recursive: true });
    }

    if (usePretty && options.logDir) {
        // Pretty stderr + file destinations via multi-target transport
        root = pino({
            ...pinoOpts,
            transport: {
                targets: [
                    {
                        target: 'pino-pretty',
                        options: { ...prettyTransportOptions, destination: 2 },
                        level,
                    },
                    {
                        target: 'pino/file',
                        options: { destination: path.join(options.logDir, 'ai-service.ndjson') },
                        level,
                    },
                    {
                        target: 'pino/file',
                        options: { destination: path.join(options.logDir, 'coc-service.ndjson') },
                        level,
                    },
                ],
            },
        });
    } else if (usePretty) {
        // Pretty stderr only
        root = pino({
            ...pinoOpts,
            transport: {
                target: 'pino-pretty',
                options: prettyTransportOptions,
            },
        });
    } else if (options.logDir) {
        // JSON to stderr + .ndjson files via multistream
        const streams: pino.StreamEntry[] = [
            { level: level as pino.Level, stream: process.stderr },
            {
                level: level as pino.Level,
                stream: pino.destination({
                    dest: path.join(options.logDir, 'ai-service.ndjson'),
                    sync: false,
                }),
            },
            {
                level: level as pino.Level,
                stream: pino.destination({
                    dest: path.join(options.logDir, 'coc-service.ndjson'),
                    sync: false,
                }),
            },
        ];
        root = pino(pinoOpts, pino.multistream(streams));
    } else {
        // JSON to stderr only
        root = pino(pinoOpts, process.stderr);
    }

    return {
        root,
        ai: root.child({ store: 'ai-service' }),
        coc: root.child({ store: 'coc-service' }),
    };
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
