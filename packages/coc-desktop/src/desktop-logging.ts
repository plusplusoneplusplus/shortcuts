/**
 * CoC Desktop — main-process file logging (Fix 2).
 *
 * A tiny, dependency-free rotating file logger plus a console tee. Together they
 * make a Finder/Dock-launched (terminal-less) packaged app diagnosable, since a
 * GUI-launched app has no attached terminal and would otherwise discard every
 * `[coc-desktop]` print and all of the forked server's stdout/stderr:
 *
 *   - `createRotatingFileLogger` appends to `<logDir>/coc-desktop.log`, rotating
 *     to `.1`, `.2`, … once the active file exceeds a size cap, so the log can
 *     never grow unbounded.
 *   - `installConsoleTee` mirrors every `process.stdout`/`process.stderr` write
 *     (the `[coc-desktop]` main-process lines) into that file while preserving
 *     the original terminal output for the `npm start` dev flow.
 *
 * This module imports NOTHING from `electron` so it stays unit-testable under
 * plain Node/vitest — the `fs` seam and the target streams are injectable. The
 * real wiring (resolving the data dir; forwarding the forked server's piped
 * stdout/stderr) lives in `main.ts` / `server-controller.ts`.
 *
 * Secret-safety: only the main process's own `[coc-desktop]` lines and the
 * forked CoC server's stdout/stderr — the same output `coc serve` prints — are
 * captured. The devtunnel CLI child's raw output is handled separately with the
 * bounded/credential-safe treatment in `devtunnel-host.ts` and is never routed
 * through these streams, so no tunnel token or auth can reach this file.
 */

import * as fs from 'fs';
import * as path from 'path';

/** Default active-file size cap before rotation (5 MiB). */
export const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;
/** Default number of rotated backups kept (`.1` … `.N`). */
export const DEFAULT_MAX_BACKUPS = 3;
/** Basename of the desktop main-process log inside the log dir. */
export const DESKTOP_LOG_FILENAME = 'coc-desktop.log';

/** Minimal `fs` surface used by the logger — injectable for tests. */
export interface LoggerFs {
    mkdirSync: (dir: string, options: { recursive: boolean }) => void;
    appendFileSync: (file: string, data: string) => void;
    statSync: (file: string) => { size: number };
    existsSync: (file: string) => boolean;
    renameSync: (from: string, to: string) => void;
    unlinkSync: (file: string) => void;
}

export interface RotatingFileLoggerOptions {
    /** Absolute path of the active log file (rotated siblings get `.1`, `.2`, …). */
    filePath: string;
    /** Rotate once the active file would exceed this many bytes (default 5 MiB). */
    maxBytes?: number;
    /** How many rotated backups to keep (default 3). Clamped to at least 1. */
    maxBackups?: number;
    /** Injected `fs` implementation (defaults to Node's `fs`). */
    fsImpl?: LoggerFs;
}

export interface RotatingFileLogger {
    readonly filePath: string;
    /** Append a chunk, rotating first if it would push the file past the cap. */
    write(chunk: string | Buffer): void;
    /** Release resources. A no-op for the sync-append implementation. */
    close(): void;
}

/**
 * Resolve the directory the desktop writes its logs into. Mirrors the forked
 * `server-entry.ts` exactly so the main-process log lands next to the server's
 * `coc-service.ndjson` / `ai-service.ndjson` — one folder to reveal and inspect.
 */
export function resolveDesktopLogDir(dataDir: string): string {
    return process.env.COC_DESKTOP_LOG_DIR || path.join(dataDir, 'logs');
}

/**
 * A minimal rotating file logger. Appends synchronously (log volume is low and
 * a durable, buffer-free write is easiest to reason about across a crash), and
 * size-rotates before a write that would exceed `maxBytes`. Every fs operation
 * is wrapped so a logging failure can never crash the app.
 */
export function createRotatingFileLogger(options: RotatingFileLoggerOptions): RotatingFileLogger {
    const { filePath } = options;
    const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
    const maxBackups = Math.max(1, options.maxBackups ?? DEFAULT_MAX_BACKUPS);
    const io: LoggerFs = options.fsImpl ?? fs;
    const dir = path.dirname(filePath);

    let dirReady = false;
    // -1 until first probed from disk, so a pre-existing file is measured once.
    let size = -1;

    const ensureDir = (): void => {
        if (dirReady) {
            return;
        }
        try {
            io.mkdirSync(dir, { recursive: true });
        } catch {
            /* best-effort — the append below will simply fail and be swallowed */
        }
        dirReady = true;
    };

    const currentSize = (): number => {
        if (size >= 0) {
            return size;
        }
        try {
            size = io.statSync(filePath).size;
        } catch {
            size = 0;
        }
        return size;
    };

    /** Shift `.(*-1)` → `.N`, dropping the oldest, then the active file → `.1`. */
    const rotate = (): void => {
        try {
            const oldest = `${filePath}.${maxBackups}`;
            if (io.existsSync(oldest)) {
                io.unlinkSync(oldest);
            }
        } catch {
            /* best-effort */
        }
        for (let i = maxBackups - 1; i >= 1; i--) {
            try {
                const src = `${filePath}.${i}`;
                if (io.existsSync(src)) {
                    io.renameSync(src, `${filePath}.${i + 1}`);
                }
            } catch {
                /* best-effort */
            }
        }
        try {
            if (io.existsSync(filePath)) {
                io.renameSync(filePath, `${filePath}.1`);
            }
        } catch {
            /* best-effort */
        }
        size = 0;
    };

    return {
        filePath,
        write(chunk: string | Buffer): void {
            const data = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
            if (!data) {
                return;
            }
            try {
                ensureDir();
                const bytes = Buffer.byteLength(data, 'utf8');
                // Never rotate a fresh/empty file — always land at least one write
                // so a single oversized chunk still gets recorded.
                if (currentSize() > 0 && currentSize() + bytes > maxBytes) {
                    rotate();
                }
                io.appendFileSync(filePath, data);
                size = currentSize() + bytes;
            } catch {
                /* Logging must never crash the app. */
            }
        },
        close(): void {
            /* Sync appends leave nothing buffered; kept for symmetry. */
        },
    };
}

/** A writable stream surface with the single method the tee overrides. */
export interface TeeableStream {
    write(chunk: string | Uint8Array, ...args: unknown[]): boolean;
}

export interface ConsoleTeeOptions {
    /** Destination the mirrored output is appended to. */
    logger: Pick<RotatingFileLogger, 'write'>;
    /** Override for `process.stdout` (defaults to it). */
    stdout?: TeeableStream;
    /** Override for `process.stderr` (defaults to it). */
    stderr?: TeeableStream;
}

/**
 * Mirror every `stdout`/`stderr` write into `logger`, preserving the original
 * write (so a TTY dev run still shows output). Returns an idempotent uninstall
 * function that restores the original `write` methods.
 */
export function installConsoleTee(options: ConsoleTeeOptions): () => void {
    const stdout: TeeableStream = options.stdout ?? (process.stdout as unknown as TeeableStream);
    const stderr: TeeableStream = options.stderr ?? (process.stderr as unknown as TeeableStream);
    // Keep the original method references for exact restoration on uninstall, and
    // bound copies for invoking with the correct `this`.
    const originalOutRef = stdout.write;
    const originalErrRef = stderr.write;
    const originalOut = originalOutRef.bind(stdout);
    const originalErr = originalErrRef.bind(stderr);

    const teed = (
        original: (chunk: string | Uint8Array, ...rest: unknown[]) => boolean,
        chunk: string | Uint8Array,
        rest: unknown[],
    ): boolean => {
        try {
            if (typeof chunk === 'string' || Buffer.isBuffer(chunk)) {
                options.logger.write(chunk as string | Buffer);
            }
        } catch {
            /* never break the real stream because logging failed */
        }
        return original(chunk, ...rest);
    };

    stdout.write = (chunk: string | Uint8Array, ...rest: unknown[]): boolean =>
        teed(originalOut, chunk, rest);
    stderr.write = (chunk: string | Uint8Array, ...rest: unknown[]): boolean =>
        teed(originalErr, chunk, rest);

    let uninstalled = false;
    return () => {
        if (uninstalled) {
            return;
        }
        uninstalled = true;
        stdout.write = originalOutRef;
        stderr.write = originalErrRef;
    };
}
