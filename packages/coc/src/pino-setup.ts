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
import type { ResolvedLoggingConfig } from './config';

// ============================================================================
// Types
// ============================================================================

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
 * Level is taken from resolved.level. Pretty mode resolves 'auto' via TTY detection.
 * File logging is opt-in via resolved.dir. Per-store level overrides are applied
 * to child loggers via resolved.stores.
 */
export function createCLIPinoLogger(resolved: ResolvedLoggingConfig): CLIPinoLoggers {
    const level = resolved.level ?? 'info';
    const usePretty = resolved.pretty === 'auto'
        ? process.stderr.isTTY === true
        : (resolved.pretty as boolean);
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

    if (resolved.dir) {
        // Ensure log directory exists before opening file streams
        fs.mkdirSync(resolved.dir, { recursive: true });
    }

    // Determine which store files to create (defaults to both when dir is set)
    const aiFile = resolved.dir && resolved.stores?.['ai-service']?.file !== false
        ? path.join(resolved.dir, 'ai-service.ndjson')
        : undefined;
    const cocFile = resolved.dir && resolved.stores?.['coc-service']?.file !== false
        ? path.join(resolved.dir, 'coc-service.ndjson')
        : undefined;

    if (usePretty && (aiFile || cocFile)) {
        // Pretty stderr + file destinations via multi-target transport
        const fileTargets: pino.TransportTargetOptions[] = [];
        if (aiFile) {
            fileTargets.push({
                target: 'pino/file',
                options: { destination: aiFile },
                level,
            });
        }
        if (cocFile) {
            fileTargets.push({
                target: 'pino/file',
                options: { destination: cocFile },
                level,
            });
        }
        root = pino({
            ...pinoOpts,
            transport: {
                targets: [
                    {
                        target: 'pino-pretty',
                        options: { ...prettyTransportOptions, destination: 2 },
                        level,
                    },
                    ...fileTargets,
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
    } else if (aiFile || cocFile) {
        // JSON to stderr + .ndjson files via multistream
        const streams: pino.StreamEntry[] = [
            { level: level as pino.Level, stream: process.stderr },
        ];
        if (aiFile) {
            streams.push({
                level: level as pino.Level,
                stream: pino.destination({ dest: aiFile, sync: false }),
            });
        }
        if (cocFile) {
            streams.push({
                level: level as pino.Level,
                stream: pino.destination({ dest: cocFile, sync: false }),
            });
        }
        root = pino(pinoOpts, pino.multistream(streams));
    } else {
        // JSON to stderr only
        root = pino(pinoOpts, process.stderr);
    }

    // Create child loggers and apply per-store level overrides
    const ai = root.child({ store: 'ai-service' });
    const aiStoreLevel = resolved.stores?.['ai-service']?.level;
    if (aiStoreLevel) { ai.level = aiStoreLevel; }

    const coc = root.child({ store: 'coc-service' });
    const cocStoreLevel = resolved.stores?.['coc-service']?.level;
    if (cocStoreLevel) { coc.level = cocStoreLevel; }

    return { root, ai, coc };
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
