/**
 * Detection primitives for the initial-reconcile sync phase.
 *
 * When a user points an existing notebook at a remote that already has content,
 * the steady-state flow is wrong twice over: it mirror-deletes every remote file
 * missing locally, and `git pull` refuses to merge the two unrelated histories.
 * The engine instead runs a one-time union merge. This module answers the two
 * questions that phase depends on — "has reconcile already run for this
 * workspace?" and "are we in the situation that needs it?" — and nothing else;
 * the merge itself lives in the engine.
 *
 * The marker is deliberately stored inside the sync repo's `.git` directory: it
 * is per-workspace state about the mirror, not note content, so it must never be
 * committed or pushed to the shared remote.
 */

import * as fs from 'fs';
import * as path from 'path';

/** Marker filename, resolved inside the sync repo's `.git` directory. */
export const RECONCILE_MARKER_NAME = 'coc-reconciled.json';

/** Current marker schema version. Bump when the shape changes incompatibly. */
export const RECONCILE_MARKER_VERSION = 1;

/**
 * Records that the initial reconcile completed for a workspace. Its presence is
 * both the "skip reconcile" signal and the baseline that steady-state
 * mirror-deletes are guarded behind — without it, a deletion can't be
 * distinguished from a note the local tree has simply never seen.
 */
export interface ReconcileMarker {
    /** Schema version of this marker. */
    version: number;
    /** SHA of the squashed merge commit the reconcile pushed. */
    mergedCommit: string;
    /** ISO timestamp of when the reconcile completed. */
    reconciledAt: string;
}

/** Absolute path of the reconcile marker for a given sync repo. */
export function reconcileMarkerPath(syncRepoDir: string): string {
    return path.join(syncRepoDir, '.git', RECONCILE_MARKER_NAME);
}

/**
 * Read the reconcile marker, or null when reconcile has not (verifiably) run.
 *
 * A missing, unreadable, malformed, or wrong-shaped marker all collapse to null
 * on purpose. Null is the safe direction in both places the marker is consumed:
 * deletions stay suppressed, and reconcile re-runs — which is harmless, because
 * the union merge is idempotent.
 */
export async function readReconcileMarker(syncRepoDir: string): Promise<ReconcileMarker | null> {
    let raw: string;
    try {
        raw = await fs.promises.readFile(reconcileMarkerPath(syncRepoDir), 'utf8');
    } catch {
        return null; // absent or unreadable — reconcile has not run
    }

    try {
        const parsed = JSON.parse(raw) as Partial<ReconcileMarker>;
        if (
            typeof parsed?.version !== 'number' ||
            typeof parsed?.mergedCommit !== 'string' || !parsed.mergedCommit ||
            typeof parsed?.reconciledAt !== 'string' || !parsed.reconciledAt
        ) {
            return null; // shape we can't trust as a baseline
        }
        return { version: parsed.version, mergedCommit: parsed.mergedCommit, reconciledAt: parsed.reconciledAt };
    } catch {
        return null; // truncated/corrupt JSON
    }
}

/**
 * Persist the reconcile marker. Written via a temp file + rename so a crash
 * mid-write can't leave a half-written marker behind.
 */
export async function writeReconcileMarker(syncRepoDir: string, marker: ReconcileMarker): Promise<void> {
    const target = reconcileMarkerPath(syncRepoDir);
    await fs.promises.mkdir(path.dirname(target), { recursive: true });
    const tmp = `${target}.tmp`;
    await fs.promises.writeFile(tmp, `${JSON.stringify(marker, null, 2)}\n`, 'utf8');
    await fs.promises.rename(tmp, target);
}

/**
 * Whether a failed `git pull` is git declining to merge two unrelated histories.
 *
 * This is the self-healing path: a repo already left in the unrelated state by
 * an earlier version (or a manual `git init`) has no marker to detect, so the
 * pull failure itself is what routes it into reconcile.
 */
export function isUnrelatedHistoriesError(message: string): boolean {
    return /refusing to merge unrelated histories/i.test(message);
}

/**
 * Whether the engine should enter the reconcile phase instead of the normal
 * copy/stage/push flow.
 *
 * All three conditions are required. A marker means reconcile already ran; an
 * empty local tree has nothing to contribute to a union merge (and is exactly
 * the case where the old mirror-delete would have wiped the remote); an empty
 * remote has nothing to reconcile against, so the normal flow's first push is
 * already correct.
 */
export function shouldReconcile(opts: {
    markerPresent: boolean;
    localTreeNonEmpty: boolean;
    remoteHasCommits: boolean;
}): boolean {
    return !opts.markerPresent && opts.localTreeNonEmpty && opts.remoteHasCommits;
}

/**
 * Whether `dir` holds at least one syncable file at any depth.
 *
 * The ignore set is passed in rather than imported from the engine so this
 * module stays a leaf of the import graph (the engine imports it, not the other
 * way round). Directories that contain only ignored names — or nothing at all —
 * don't count: an empty `.git`-only tree is not a notebook worth merging.
 */
export async function isNotesTreeNonEmpty(dir: string, ignore?: ReadonlySet<string>): Promise<boolean> {
    let entries: fs.Dirent[];
    try {
        entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch {
        return false; // missing or unreadable — nothing to sync
    }

    for (const entry of entries) {
        if (ignore?.has(entry.name)) continue;
        if (entry.isDirectory()) {
            if (await isNotesTreeNonEmpty(path.join(dir, entry.name), ignore)) return true;
        } else {
            return true;
        }
    }
    return false;
}
