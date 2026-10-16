/** Electron-free record of a helper handoff, read again on the next launch. */
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { ReleaseInfo } from './update-check';

export interface PendingUpdate {
    release: ReleaseInfo;
    /** Download directory where helpers write install-error.txt and remove on success. */
    tempDir: string;
    /** macOS staging beside the app bundle. */
    stageDir?: string;
    startedAt: number;
}

export type PendingUpdateStatus =
    | { state: 'none' | 'installing' | 'succeeded' }
    | { state: 'failed'; release: ReleaseInfo; reason: string };

/** Helpers wait up to five minutes for quit; a much older record has no live helper. */
export const PENDING_UPDATE_STALE_MS = 60 * 60 * 1000;

/** Written before helper launch so a failed install can be reported after relaunch. */
export async function recordPendingUpdate(file: string, pending: PendingUpdate): Promise<void> {
    await fs.mkdir(path.dirname(file), { recursive: true });
    const partial = `${file}.${process.pid}.tmp`;
    await fs.writeFile(partial, JSON.stringify(pending));
    await fs.rename(partial, file);
}

export async function clearPendingUpdate(file: string): Promise<void> {
    await fs.rm(file, { force: true });
}

async function exists(file: string): Promise<boolean> {
    try {
        await fs.stat(file);
        return true;
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
        throw error;
    }
}

function parse(text: string): PendingUpdate | undefined {
    try {
        const value = JSON.parse(text) as Partial<PendingUpdate>;
        if (typeof value.tempDir === 'string' && path.isAbsolute(value.tempDir)
            && typeof value.startedAt === 'number' && typeof value.release?.tag === 'string'
            && typeof value.release.version === 'string'
            && Array.isArray(value.release.assets)
            && (value.stageDir === undefined || (typeof value.stageDir === 'string' && path.isAbsolute(value.stageDir)))) {
            return value as PendingUpdate;
        }
    } catch { /* invalid records are discarded below */ }
    return undefined;
}

/** Returns a note when macOS staging must be kept for manual recovery. */
async function removeStage(stageDir: string | undefined): Promise<string | undefined> {
    if (!stageDir) return undefined;
    if (await exists(path.join(stageDir, 'previous.app'))) {
        return `The previous app was kept at ${path.join(stageDir, 'previous.app')}.`;
    }
    try {
        // rmdir refuses a non-empty mount point, so a still-mounted image is never removed.
        await fs.rmdir(path.join(stageDir, 'image'));
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
            return `Update files were kept at ${stageDir}.`;
        }
    }
    await fs.rm(stageDir, { recursive: true, force: true });
    return undefined;
}

/**
 * Inspect the last handoff. A present tempDir without an error means the helper may
 * still be running (Windows relaunches before its cleanup), so nothing is removed.
 */
export async function recoverPendingUpdate(file: string, options: {
    currentVersion: string;
    now?: number;
}): Promise<PendingUpdateStatus> {
    let text: string;
    try {
        text = await fs.readFile(file, 'utf8');
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { state: 'none' };
        throw error;
    }
    const pending = parse(text);
    if (!pending) {
        await clearPendingUpdate(file);
        return { state: 'none' };
    }
    let reason: string | undefined;
    try {
        reason = (await fs.readFile(path.join(pending.tempDir, 'install-error.txt'), 'utf8')).trim()
            || 'The update installer failed.';
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    if (reason === undefined) {
        if (await exists(pending.tempDir)) {
            if ((options.now ?? Date.now()) - pending.startedAt < PENDING_UPDATE_STALE_MS) {
                return { state: 'installing' };
            }
            if (pending.release.version !== options.currentVersion) {
                reason = 'The update helper stopped before installing the update.';
            }
        }
    }
    const note = await removeStage(pending.stageDir);
    await fs.rm(pending.tempDir, { recursive: true, force: true });
    await clearPendingUpdate(file);
    if (reason === undefined) return { state: 'succeeded' };
    return { state: 'failed', release: pending.release, reason: note ? `${reason}\n${note}` : reason };
}
