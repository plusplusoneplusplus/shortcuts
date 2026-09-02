/**
 * A canvas revision is three files — the version snapshot, the artifact, and
 * the descriptor — and an extension save is up to five more. Writing them one
 * by one leaves a window where a crash strands a descriptor that describes
 * content nobody wrote.
 *
 * {@link StagedCommit} closes most of that window by splitting a write into
 * two halves: `stage()` does all the work that can fail (serializing, creating
 * directories, writing bytes) into temp files, and `commit()` does nothing but
 * renames, which are atomic per file and effectively never fail once the temp
 * exists on the same filesystem. `rollback()` throws the temps away when
 * staging did not get far enough to be worth committing.
 *
 * Temp names start with `.tmp-`; every reader filters that prefix, so a temp
 * left behind by a killed process is inert rather than half-visible.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { reportCanvasCorruption, type CanvasArtifactRole } from './canvas-diagnostics';

/** Prefix marking a partially-written file that no reader should look at. */
export const CANVAS_TEMP_PREFIX = '.tmp-';

/** True for a staging file left in a canvas directory. */
export function isCanvasTempName(name: string): boolean {
    return name.startsWith(CANVAS_TEMP_PREFIX);
}

/** Write a single file through a temp + rename. */
export function writeFileAtomic(filePath: string, data: string | Buffer): void {
    const tmpPath = path.join(path.dirname(filePath), `${CANVAS_TEMP_PREFIX}${path.basename(filePath)}-${crypto.randomBytes(4).toString('hex')}`);
    fs.writeFileSync(tmpPath, data);
    fs.renameSync(tmpPath, filePath);
}

interface StagedFile {
    tempPath: string;
    targetPath: string;
}

/**
 * A set of file writes and deletions prepared up front and applied together.
 *
 * Ordering inside `commit()` is the order things were staged, and it matters:
 * the descriptor carries the revision number, so it is staged LAST by every
 * caller. If the process dies mid-commit, the on-disk revision is then never
 * ahead of the content it names.
 */
export class StagedCommit {
    private readonly files: StagedFile[] = [];
    private readonly removals: string[] = [];
    private committed = false;

    /** Write `data` to a temp file next to `targetPath`, to be renamed on commit. */
    stage(targetPath: string, data: string | Buffer): void {
        const dir = path.dirname(targetPath);
        fs.mkdirSync(dir, { recursive: true });
        const tempPath = path.join(dir, `${CANVAS_TEMP_PREFIX}${path.basename(targetPath)}-${crypto.randomBytes(4).toString('hex')}`);
        fs.writeFileSync(tempPath, data);
        this.files.push({ tempPath, targetPath });
    }

    /** Delete `targetPath` on commit (no-op when it is already absent). */
    stageRemoval(targetPath: string): void {
        this.removals.push(targetPath);
    }

    /** True when nothing has been staged. */
    get isEmpty(): boolean {
        return this.files.length === 0 && this.removals.length === 0;
    }

    /** Rename every staged file into place, then apply the removals. */
    commit(): void {
        if (this.committed) return;
        this.committed = true;
        for (const { tempPath, targetPath } of this.files) {
            fs.renameSync(tempPath, targetPath);
        }
        for (const targetPath of this.removals) {
            try {
                fs.unlinkSync(targetPath);
            } catch {
                // Already gone
            }
        }
    }

    /** Discard the temps. Safe to call after a partial or failed commit. */
    rollback(): void {
        for (const { tempPath } of this.files) {
            try {
                fs.unlinkSync(tempPath);
            } catch {
                // Already renamed or never created
            }
        }
        this.files.length = 0;
        this.removals.length = 0;
    }
}

/** How long a staging file must sit untouched before it counts as abandoned. */
const STALE_TEMP_AGE_MS = 5 * 60 * 1000;

/**
 * Delete staging files a dead process left behind. Best-effort and cheap
 * enough to run on the commit path: a canvas directory holds a handful of
 * entries, and a temp that a concurrent writer is still using is younger than
 * the cutoff.
 */
export function cleanupStaleTemps(dir: string, context: { workspaceId: string; canvasId?: string; role?: CanvasArtifactRole }): void {
    let entries: string[];
    try {
        entries = fs.readdirSync(dir);
    } catch {
        return;
    }
    const cutoff = Date.now() - STALE_TEMP_AGE_MS;
    for (const entry of entries) {
        if (!isCanvasTempName(entry)) continue;
        const fullPath = path.join(dir, entry);
        try {
            if (fs.statSync(fullPath).mtimeMs > cutoff) continue;
            fs.unlinkSync(fullPath);
        } catch (error) {
            reportCanvasCorruption({
                workspaceId: context.workspaceId,
                canvasId: context.canvasId,
                role: context.role ?? 'temp-cleanup',
                file: entry,
                error,
            });
        }
    }
}
