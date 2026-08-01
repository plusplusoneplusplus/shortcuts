/**
 * Mirror-copy kernel for the notes sync engine.
 *
 * The directory-mirroring primitives (change-only copy, mirror-delete, ignore
 * semantics) live here, along with {@link SyncMirrorCopier} which binds them to
 * a workspace's local-notes ⇄ sync-repo directions.
 */

import * as fs from 'fs';
import * as path from 'path';
import { safeExistsAsync, safeReadDirAsync } from '@plusplusoneplusplus/forge';

/**
 * Names that must never be copied into — or mirror-deleted from — the sync
 * repo. `.git` is the repo's own history and `.lock` is our sync lock file;
 * both live in the destination but not in the notes source, so an unguarded
 * mirror copy would delete them and force a re-clone every tick.
 */
export const SYNC_IGNORE_NAMES: ReadonlySet<string> = new Set(['.git', '.lock']);

export interface CopyDirOptions {
    /** Basenames to never copy from the source or delete from the destination. */
    ignore?: ReadonlySet<string>;
    /**
     * Whether a path missing from `src` should be deleted from `dest`.
     * Defaults to true — that mirror-delete is what makes this a mirror.
     *
     * Pass false when `src` is not yet known to describe the whole tree, so
     * "absent here" cannot be read as "deleted by the user". The outbound
     * copy does exactly that until reconcile has established a baseline.
     */
    mirrorDeletes?: boolean;
    /**
     * A cutoff (epoch ms) below which a `dest`-only entry may be mirror-deleted.
     * When set, the delete pass skips any entry whose own mtime is at or after
     * the cutoff, treating it as created too recently to be a deletion `src` is
     * authoritative about.
     *
     * This guards the inbound copy's mid-tick creation race: `src` (the clone)
     * is snapshotted early in a tick, but a note can be written locally before
     * the copy-back runs, so it is absent from `src` yet is not a deletion —
     * deleting it would destroy fresh work. Skipped entries sync normally on the
     * next tick. Checking each entry's own mtime is enough at every depth: a new
     * note freshens its parent dir's mtime too, and a stale dir holding a
     * brand-new file is the nested case the recursion handles by descending and
     * re-checking that file's own mtime. Only meaningful when
     * `mirrorDeletes` is not false.
     */
    preserveNewerThanMs?: number;
}

/**
 * Mirror `src` into `dest`: copy new/changed files, mirror-delete anything in
 * `dest` that no longer exists in `src`, and leave unchanged files untouched.
 *
 * Two properties matter for keeping disk churn low:
 *   - Ignored names (e.g. the sync repo's own `.git`/`.lock`) are skipped in
 *     BOTH the delete pass and the copy pass, so they survive every cycle.
 *   - Files whose content already matches are not rewritten, so their mtime
 *     stays stable and `git add -A` can skip re-hashing them.
 *
 * @returns the number of files actually written (copied), for callers/tests
 *          that want to confirm an idle cycle wrote nothing.
 */
export async function copyDirContents(src: string, dest: string, options?: CopyDirOptions): Promise<number> {
    const ignore = options?.ignore;
    await fs.promises.mkdir(dest, { recursive: true });

    // Remove files in dest that don't exist in src (mirror-delete), skipping ignored names.
    if (options?.mirrorDeletes !== false) {
        const cutoff = options?.preserveNewerThanMs;
        const destEntries = await safeReadDirAsync(dest, true);
        if (destEntries.success) {
            for (const entry of destEntries.data!) {
                if (ignore?.has(entry.name)) continue;
                const destPath = path.join(dest, entry.name);
                if (!await safeExistsAsync(path.join(src, entry.name))) {
                    // Freshly written during this tick (absent from the early src
                    // snapshot but not a deletion) — leave it for the next tick.
                    if (cutoff !== undefined) {
                        const stat = await fs.promises.stat(destPath).catch(() => null);
                        if (stat && stat.mtimeMs >= cutoff) continue;
                    }
                    if (entry.isDirectory()) {
                        await fs.promises.rm(destPath, { recursive: true, force: true });
                    } else {
                        await fs.promises.unlink(destPath);
                    }
                }
            }
        }
    }

    if (!await safeExistsAsync(src)) return 0;

    let copied = 0;
    const srcEntries = await safeReadDirAsync(src, true);
    if (!srcEntries.success) return copied;
    for (const entry of srcEntries.data!) {
        if (ignore?.has(entry.name)) continue;
        const srcPath = path.join(src, entry.name);
        const destPath = path.join(dest, entry.name);
        if (entry.isDirectory()) {
            copied += await copyDirContents(srcPath, destPath, options);
        } else if (await copyFileIfChanged(srcPath, destPath)) {
            copied++;
        }
    }
    return copied;
}

/**
 * Copy `src` → `dest` only when they differ. Skips the write (and preserves the
 * destination's mtime) when size + content already match, so repeated syncs of
 * an unchanged file cost only a stat/read, never a rewrite. The copied file's
 * mtime is aligned to the source so the next tick can skip via the fast path.
 *
 * @returns true when a copy was performed, false when the file was up to date.
 */
export async function copyFileIfChanged(src: string, dest: string): Promise<boolean> {
    const [srcStat, destStat] = await Promise.all([
        fs.promises.stat(src).catch(() => null),
        fs.promises.stat(dest).catch(() => null),
    ]);

    if (srcStat && destStat && srcStat.size === destStat.size) {
        // Fast path: same size and mtime — treat as unchanged, no read needed.
        if (Math.floor(srcStat.mtimeMs) === Math.floor(destStat.mtimeMs)) {
            return false;
        }
        // Same size, different mtime — compare content before rewriting.
        if (await filesEqual(src, dest)) {
            // Content identical: realign mtime so future ticks hit the fast path.
            await fs.promises.utimes(dest, srcStat.atime, srcStat.mtime).catch(() => { /* best-effort */ });
            return false;
        }
    }

    await fs.promises.copyFile(src, dest);
    // Preserve the source mtime so an unchanged file stays skippable next tick.
    if (srcStat) {
        await fs.promises.utimes(dest, srcStat.atime, srcStat.mtime).catch(() => { /* best-effort */ });
    }
    return true;
}

/** Byte-for-byte comparison of two files. Assumes callers already matched size. */
export async function filesEqual(a: string, b: string): Promise<boolean> {
    const [bufA, bufB] = await Promise.all([
        fs.promises.readFile(a),
        fs.promises.readFile(b),
    ]);
    return bufA.equals(bufB);
}

/**
 * Binds the mirror primitives to a workspace's two sync directions: local notes
 * → sync repo (outbound) and sync repo → local notes (inbound). Both directions
 * skip {@link SYNC_IGNORE_NAMES} so the repo's own `.git`/`.lock` survive.
 */
export class SyncMirrorCopier {
    constructor(
        private readonly localDir: string,
        private readonly syncRepoDir: string,
    ) {}

    /**
     * Copy local notes over the sync repo.
     *
     * `hasBaseline` decides whether a note the local tree lacks is a deletion to
     * propagate or a note this device simply hasn't been told about yet. Only a
     * reconcile baseline can tell those apart: it is the point at which the two
     * sides were proven to hold the same notes, so anything missing since is the
     * user's doing. Without one — a fresh mirror, an unrelated remote, a notes
     * dir that hasn't been restored yet — an empty or partial local tree would
     * otherwise mirror-delete the remote's notes and push the result.
     *
     * The parameter is required rather than defaulted: this is the destructive
     * direction, and a caller that forgets should not compile.
     */
    async copyLocalToRepo(hasBaseline: boolean): Promise<void> {
        if (await safeExistsAsync(this.localDir)) {
            // Never touch the sync repo's own .git / .lock on the outbound copy.
            await copyDirContents(this.localDir, this.syncRepoDir, {
                ignore: SYNC_IGNORE_NAMES,
                mirrorDeletes: hasBaseline,
            });
        }
    }

    /**
     * Copy the sync repo's tree back onto local notes: a full mirror, changed
     * files only, so a deletion pulled from the remote reaches this device's
     * notes dir instead of surviving and being re-pushed next tick.
     *
     * `hasBaseline` gates the mirror-delete the same way {@link copyLocalToRepo}
     * does — this is the destructive direction inbound, so a note the clone
     * lacks is only treated as a deletion once reconcile has proven the clone
     * shares history with local. `tickStartMs` (the tick's start time) protects
     * a note created after the clone was snapshotted but before this copy runs:
     * such a note is absent from the clone yet is not a deletion, so the delete
     * pass skips anything freshened at or after it. Both are required rather
     * than defaulted: this direction can destroy local notes, and a caller that
     * forgets should not compile.
     */
    async copyRepoToLocal(hasBaseline: boolean, tickStartMs: number): Promise<void> {
        if (await safeExistsAsync(this.syncRepoDir)) {
            await fs.promises.mkdir(this.localDir, { recursive: true });
            // Everything except .git and .lock, writing only changed files so an
            // idle inbound copy doesn't churn mtimes (and the notes fs-watcher).
            await copyDirContents(this.syncRepoDir, this.localDir, {
                ignore: SYNC_IGNORE_NAMES,
                mirrorDeletes: hasBaseline,
                preserveNewerThanMs: tickStartMs,
            });
        }
    }
}
