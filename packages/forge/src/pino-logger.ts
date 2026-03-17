import path from 'path';
import pino from 'pino';
import type { Logger } from './logger';

/**
 * Per-store configuration for the Pino logger.
 */
export interface StoreOptions {
    /** Override the log level for this store. */
    level?: string;
    /** Set to false to skip writing a file for this store. */
    file?: boolean;
}

/**
 * Named log stores for structured log routing.
 */
export type LogStoreName = 'ai-service' | 'coc-service';

/**
 * Options for creating the root Pino logger.
 */
export interface PinoLoggerOptions {
    /** Minimum log level (default: 'info') */
    level?: string;
    /** Directory where .ndjson log files are written */
    logDir?: string;
    /** Enable pino-pretty output to stderr in dev mode */
    pretty?: boolean;
    /** Per-store level / file overrides */
    stores?: Partial<Record<LogStoreName, StoreOptions>>;
    /** Custom Pino serializers */
    serializers?: pino.LoggerOptions['serializers'];
}

/**
 * Create a root Pino logger with optional multistream transport.
 *
 * In pretty mode the transport API is used so that pino-pretty is loaded
 * lazily via a worker thread — this keeps the dependency optional at runtime.
 * When pretty is disabled, JSON lines go directly to stderr.
 *
 * File streams (one per store) are added when `logDir` is provided.
 */
export function createRootPinoLogger(options: PinoLoggerOptions): pino.Logger {
    const level = options.level ?? 'info';

    const serializers: pino.LoggerOptions['serializers'] = {
        err: pino.stdSerializers.err,
        req: (req: { method: string; url: string }) => ({ method: req.method, url: req.url }),
        ...options.serializers,
    };

    // Build streams for pino.multistream
    const streams: pino.StreamEntry[] = [];

    if (options.logDir) {
        for (const [storeName, storeOpts] of Object.entries(options.stores ?? {})) {
            if (!storeOpts || storeOpts.file === false) continue;
            const filePath = path.join(options.logDir, `${storeName}.ndjson`);
            streams.push({
                level: (storeOpts.level ?? level) as pino.Level,
                stream: pino.destination({ dest: filePath, mkdir: true, sync: false }),
            });
        }
    }

    if (options.pretty) {
        // Use transport API so pino-pretty is loaded as a worker (lazy, optional)
        return pino({
            level,
            serializers,
            transport: {
                target: 'pino-pretty',
                options: { colorize: true, translateTime: 'SYS:standard', ignore: 'pid,hostname' },
            },
        });
    }

    if (streams.length === 0) {
        return pino({ level, serializers }, process.stderr);
    }

    // Add stderr as the final catch-all stream
    streams.push({ level: level as pino.Level, stream: process.stderr });

    return pino({ level, serializers }, pino.multistream(streams));
}

/**
 * Create a child Pino logger bound to a named store.
 * The `store` field is injected into every log record for downstream routing.
 */
export function createLogStore(root: pino.Logger, store: LogStoreName): pino.Logger {
    return root.child({ store });
}

/**
 * Wrap a Pino logger in the existing `Logger` interface.
 * Preserves full backward-compatibility: callers using `getLogger()` continue
 * to work without any changes.
 */
export function createPinoAdapter(pinoLogger: pino.Logger): Logger {
    return {
        debug: (category, message) => pinoLogger.debug({ category }, message),
        info: (category, message) => pinoLogger.info({ category }, message),
        warn: (category, message) => pinoLogger.warn({ category }, message),
        error: (category, message, error) => pinoLogger.error({ category, err: error }, message),
    };
}

/**
 * Create a silent Pino-backed `Logger` that discards all output.
 * Useful in tests as a drop-in replacement for the hand-rolled `nullLogger`.
 */
export function createPinoNullLogger(): Logger {
    return createPinoAdapter(pino({ level: 'silent' }));
}
