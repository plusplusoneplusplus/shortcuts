/**
 * On-disk persistence for terminal sessions.
 *
 * Layout, per workspace:
 *   <dataDir>/repos/<workspaceId>/terminals/<sessionId>.json  — metadata
 *   <dataDir>/repos/<workspaceId>/terminals/<sessionId>.log   — raw PTY output
 *
 * The `.log` is exactly the session's scrollback buffer (raw bytes, ANSI
 * escapes included), so it is already capped at `SCROLLBACK_MAX_BYTES` by the
 * manager. The truncation marker is a rendering concern and is never stored.
 *
 * Writes are synchronous and atomic (tmp file + rename): synchronous because
 * the shutdown flush has to complete before the process exits, and the payload
 * is at most ~1 MiB per session written at most every few seconds.
 *
 * Logs can contain secrets echoed into a shell, so the directory is created
 * 0700 and the files 0600. Those modes are a no-op on Windows.
 */

import * as fs from 'fs';
import * as path from 'path';
import { getRepoDataPath } from '../paths';

// ============================================================================
// Constants
// ============================================================================

export const TERMINALS_DIR_NAME = 'terminals';
const DIR_MODE = 0o700;
const FILE_MODE = 0o600;

/** Exit code recorded for sessions ended because the server shut down. */
export const SERVER_SHUTDOWN_EXIT_CODE = -2;

// ============================================================================
// Types
// ============================================================================

export interface PersistedTerminalMeta {
    id: string;
    workspaceId: string;
    shell: string;
    cwd: string;
    title: string;
    createdAt: number;
    lastActivity: number;
    status: 'running' | 'exited';
    exitedAt?: number;
    exitCode?: number;
    truncated: boolean;
}

export interface LoadedTerminalSession {
    meta: PersistedTerminalMeta;
    /** Raw scrollback bytes; empty when the `.log` is missing. */
    scrollback: Buffer;
}

// ============================================================================
// Helpers
// ============================================================================

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Validate a parsed `.json` payload. Returns `null` for anything that is not a
 * usable metadata record, so a corrupt file is skipped rather than crashing
 * startup.
 */
function parseMeta(raw: unknown, fallbackId: string): PersistedTerminalMeta | null {
    if (!isRecord(raw)) return null;
    const id = typeof raw.id === 'string' && raw.id ? raw.id : fallbackId;
    if (typeof raw.workspaceId !== 'string' || !raw.workspaceId) return null;

    const num = (v: unknown, fallback: number): number =>
        typeof v === 'number' && Number.isFinite(v) ? v : fallback;

    return {
        id,
        workspaceId: raw.workspaceId,
        shell: typeof raw.shell === 'string' ? raw.shell : '',
        cwd: typeof raw.cwd === 'string' ? raw.cwd : '',
        title: typeof raw.title === 'string' ? raw.title : '',
        createdAt: num(raw.createdAt, 0),
        lastActivity: num(raw.lastActivity, 0),
        status: raw.status === 'running' ? 'running' : 'exited',
        exitedAt: typeof raw.exitedAt === 'number' ? raw.exitedAt : undefined,
        exitCode: typeof raw.exitCode === 'number' ? raw.exitCode : undefined,
        truncated: raw.truncated === true,
    };
}

function writeFileAtomic(filePath: string, data: string | Buffer): void {
    const tmpPath = `${filePath}.tmp`;
    fs.writeFileSync(tmpPath, data, { mode: FILE_MODE });
    fs.renameSync(tmpPath, filePath);
}

// ============================================================================
// TerminalPersistence
// ============================================================================

export class TerminalPersistence {
    constructor(private readonly dataDir: string) { }

    /** `<dataDir>/repos/<workspaceId>/terminals` */
    dirFor(workspaceId: string): string {
        return getRepoDataPath(this.dataDir, workspaceId, TERMINALS_DIR_NAME);
    }

    metaPath(workspaceId: string, sessionId: string): string {
        return path.join(this.dirFor(workspaceId), `${sessionId}.json`);
    }

    logPath(workspaceId: string, sessionId: string): string {
        return path.join(this.dirFor(workspaceId), `${sessionId}.log`);
    }

    /** Write metadata + scrollback. The directory is created lazily. */
    save(meta: PersistedTerminalMeta, scrollback: Buffer): void {
        const dir = this.dirFor(meta.workspaceId);
        fs.mkdirSync(dir, { recursive: true, mode: DIR_MODE });
        writeFileAtomic(path.join(dir, `${meta.id}.json`), JSON.stringify(meta, null, 2));
        writeFileAtomic(path.join(dir, `${meta.id}.log`), scrollback);
    }

    /**
     * Load every persisted session for a workspace. Anything on disk is dead —
     * PTYs do not survive a server restart — so entries are always returned as
     * `exited`. Unreadable or malformed entries are skipped.
     */
    load(workspaceId: string): LoadedTerminalSession[] {
        const dir = this.dirFor(workspaceId);
        let entries: string[];
        try {
            entries = fs.readdirSync(dir);
        } catch {
            return [];
        }

        const loaded: LoadedTerminalSession[] = [];
        for (const entry of entries) {
            if (!entry.endsWith('.json')) continue;
            const sessionId = entry.slice(0, -'.json'.length);
            let meta: PersistedTerminalMeta | null = null;
            try {
                meta = parseMeta(JSON.parse(fs.readFileSync(path.join(dir, entry), 'utf-8')), sessionId);
            } catch {
                meta = null;
            }
            if (!meta) continue;

            let scrollback: Buffer;
            try {
                scrollback = fs.readFileSync(path.join(dir, `${sessionId}.log`));
            } catch {
                scrollback = Buffer.alloc(0);
            }

            loaded.push({
                meta: {
                    ...meta,
                    status: 'exited',
                    exitedAt: meta.exitedAt ?? meta.lastActivity,
                },
                scrollback,
            });
        }
        return loaded;
    }

    /** Delete both files for a session. Missing files are not an error. */
    remove(workspaceId: string, sessionId: string): void {
        for (const file of [this.metaPath(workspaceId, sessionId), this.logPath(workspaceId, sessionId)]) {
            try {
                fs.rmSync(file, { force: true });
            } catch {
                /* best effort */
            }
        }
    }
}
