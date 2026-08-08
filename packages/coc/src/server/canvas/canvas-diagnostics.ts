/**
 * Canvas persistence diagnostics
 *
 * A corrupt descriptor, artifact, snapshot, extension document, or comments
 * file used to be swallowed by a bare `catch {}`, so a canvas simply vanished
 * or lost its history with nothing to look at afterwards. Every such skip now
 * routes through here.
 *
 * What is logged is deliberately narrow: workspace id, canvas id, the ROLE of
 * the file, its bare name, and the error's class/`errno` code. Never the file
 * contents (canvas text is user data) and never an absolute path (it leaks the
 * local filesystem layout into logs that get shipped around).
 *
 * An ordinary "file is not there" is not a fault — a canvas without comments,
 * without an extension, or without snapshots is normal — so ENOENT is dropped
 * before it reaches the logger.
 */

import { getServerLogger } from '../logging/server-logger';

/** Which canvas file failed to read, parse, or be removed. */
export type CanvasArtifactRole =
    | 'descriptor'
    | 'artifact'
    | 'version'
    | 'version-prune'
    | 'comments'
    | 'extension-manifest'
    | 'extension-capabilities'
    | 'extension-ui'
    | 'listing'
    | 'temp-cleanup';

export interface CanvasCorruptionReport {
    workspaceId: string;
    canvasId?: string;
    role: CanvasArtifactRole;
    /** Bare file name (never a path), e.g. `canvas.json` or `12.json`. */
    file?: string;
    error: unknown;
}

/** Errno codes that mean "absent", which is an ordinary state, not corruption. */
const ABSENT_CODES = new Set(['ENOENT', 'ENOTDIR']);

function errorCode(error: unknown): string | undefined {
    const code = (error as NodeJS.ErrnoException | null)?.code;
    return typeof code === 'string' ? code : undefined;
}

/** True when the error just means the file or directory does not exist. */
export function isAbsentError(error: unknown): boolean {
    const code = errorCode(error);
    return code !== undefined && ABSENT_CODES.has(code);
}

/**
 * Record that a canvas file could not be read, parsed, or pruned. Best-effort
 * and never throws — a diagnostics failure must not take down a read path.
 */
export function reportCanvasCorruption(report: CanvasCorruptionReport): void {
    if (isAbsentError(report.error)) return;
    try {
        const error = report.error;
        getServerLogger().warn(
            {
                component: 'canvas-store',
                workspaceId: report.workspaceId,
                ...(report.canvasId ? { canvasId: report.canvasId } : {}),
                role: report.role,
                ...(report.file ? { file: report.file } : {}),
                errorClass: error instanceof Error ? error.constructor.name : typeof error,
                ...(errorCode(error) ? { errorCode: errorCode(error) } : {}),
            },
            'Skipped unreadable canvas file',
        );
    } catch {
        // Logging must never break persistence
    }
}
