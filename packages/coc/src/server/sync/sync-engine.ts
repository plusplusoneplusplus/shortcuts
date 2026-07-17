/**
 * Git-backed sync engine for My Work / My Life notes.
 *
 * Each workspace gets its own SyncEngine instance. The engine
 * clones/pulls/pushes a user-configured Git remote to synchronize
 * note files across machines.
 *
 * Mapping (per workspace):
 *   ~/.coc/repos/<workspaceId>/notes/  ↔  ~/.coc/sync/<sync-subfolder>/
 */

import * as fs from 'fs';
import * as path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { safeExistsAsync, safeReadDirAsync, safeReadFileAsync } from '@plusplusoneplusplus/forge';
import type { AIInvoker } from '@plusplusoneplusplus/forge';
import { DEFAULT_SYNC_INTERVAL_MINUTES, MAX_SYNC_BACKOFF_MINUTES } from './sync-constants';
import {
    RECONCILE_MARKER_VERSION,
    applyMergePlan,
    isNotesTreeNonEmpty,
    isUnrelatedHistoriesError,
    planUnionMerge,
    readReconcileMarker,
    reconcileCommitMessage,
    reconcileReport,
    scanTreeToMap,
    shouldReconcile,
    summarizeMergePlan,
    writeReconcileMarker,
} from './sync-reconcile';
import type { MergePlan, ReconcileMarker, ReconcileReport } from './sync-reconcile';

const execFileAsync = promisify(execFile);

// ── Constants ────────────────────────────────────────────────────────────────

// Interval/backoff constants live in a side-effect-free module so lightweight
// consumers (live-effects, bootstrap) don't pull this engine into their graph.
// Imported for internal use (backoff cap) and re-exported for existing consumers.
export { DEFAULT_SYNC_INTERVAL_MINUTES, MAX_SYNC_BACKOFF_MINUTES };

/**
 * Names that must never be copied into — or mirror-deleted from — the sync
 * repo. `.git` is the repo's own history and `.lock` is our sync lock file;
 * both live in the destination but not in the notes source, so an unguarded
 * mirror copy would delete them and force a re-clone every tick.
 */
export const SYNC_IGNORE_NAMES: ReadonlySet<string> = new Set(['.git', '.lock']);

// ── Types ────────────────────────────────────────────────────────────────────

export interface SyncStatus {
    /** Whether a sync is currently in progress */
    inProgress: boolean;
    /** ISO timestamp of last successful sync, or null if never synced */
    lastSyncTime: string | null;
    /** Error message from last sync attempt, or null if OK */
    lastError: string | null;
    /** Whether sync is enabled (gitRemote configured) */
    enabled: boolean;
    /**
     * Whether the in-progress sync is the one-time initial merge. It can take a
     * lot longer than an ordinary tick — it reads both trees and may call the AI
     * once per colliding note — so it is worth saying so rather than showing the
     * usual "syncing" for a minute.
     */
    reconcileInProgress: boolean;
    /**
     * What the initial merge did, or null if no merge established this mirror's
     * baseline. Survives a restart (it is read back off the marker), and is never
     * cleared: it describes a one-time event, and an automatic tick a few minutes
     * later must not be what wipes the summary before the user has read it.
     */
    reconcileReport: ReconcileReport | null;
}

/** What the one-time initial reconcile did, for reporting and for tests. */
export interface ReconcileResult {
    /** Every path's outcome, plus the counts the status report is built from. */
    plan: MergePlan;
    /** SHA of the squashed merge commit, or the remote's HEAD when nothing changed. */
    mergedCommit: string;
    /** Tag holding the remote's pre-merge HEAD, or null when nothing was pushed. */
    backupTag: string | null;
    /** The same outcome as the status reports it, as persisted on the marker. */
    report: ReconcileReport;
}

export interface SyncEngineOptions {
    dataDir: string;
    /** Virtual workspace ID: 'my_work' or 'my_life' */
    workspaceId: string;
    logger?: SyncLogger;
    /** Optional AI invoker for intelligent merge conflict resolution. Falls back to simple resolution when absent. */
    aiInvoker?: AIInvoker;
}

export interface SyncLogger {
    info(msg: string): void;
    warn(msg: string): void;
    error(msg: string): void;
}

const DEFAULT_LOGGER: SyncLogger = {
    info: (msg) => console.log(`[sync] ${msg}`),
    warn: (msg) => console.warn(`[sync] ${msg}`),
    error: (msg) => console.error(`[sync] ${msg}`),
};

// ── Mapping ──────────────────────────────────────────────────────────────────

interface FolderMapping {
    /** Subfolder name inside the sync Git repo */
    repoFolder: string;
    /** Absolute path to the local notes directory */
    localDir: string;
}

// ── Git helpers ──────────────────────────────────────────────────────────────

async function git(args: string[], cwd: string): Promise<string> {
    const { stdout } = await execFileAsync('git', args, {
        cwd,
        encoding: 'utf8',
        maxBuffer: 10 * 1024 * 1024,
        timeout: 120_000,
    });
    return stdout.trim();
}

/**
 * Run git and hand back raw stdout.
 *
 * The text helper decodes as utf8 and trims, which would corrupt an image and
 * strip a note's trailing newline. Reading blobs out of git objects has to be
 * byte-exact, so those calls come through here instead.
 */
async function gitBuffer(args: string[], cwd: string): Promise<Buffer> {
    const { stdout } = await execFileAsync('git', args, {
        cwd,
        encoding: 'buffer',
        maxBuffer: 64 * 1024 * 1024,
        timeout: 120_000,
    });
    return stdout;
}

async function isGitRepo(dir: string): Promise<boolean> {
    try {
        await git(['rev-parse', '--is-inside-work-tree'], dir);
        return true;
    } catch {
        return false;
    }
}

// ── Lock file helpers ────────────────────────────────────────────────────────

async function acquireLock(lockPath: string): Promise<boolean> {
    await fs.promises.mkdir(path.dirname(lockPath), { recursive: true });
    try {
        await fs.promises.writeFile(lockPath, String(process.pid), { flag: 'wx' });
        return true;
    } catch {
        // Check for stale lock
        try {
            const pid = parseInt(await fs.promises.readFile(lockPath, 'utf8'), 10);
            if (pid && !isProcessRunning(pid)) {
                await fs.promises.unlink(lockPath);
                await fs.promises.writeFile(lockPath, String(process.pid), { flag: 'wx' });
                return true;
            }
        } catch { /* lock held by active process */ }
        return false;
    }
}

async function releaseLock(lockPath: string): Promise<void> {
    try { await fs.promises.unlink(lockPath); } catch { /* ignore */ }
}

function isProcessRunning(pid: number): boolean {
    try {
        process.kill(pid, 0);
        return true;
    } catch {
        return false;
    }
}

// ── File sync helpers ────────────────────────────────────────────────────────

interface CopyDirOptions {
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
        const destEntries = await safeReadDirAsync(dest, true);
        if (destEntries.success) {
            for (const entry of destEntries.data!) {
                if (ignore?.has(entry.name)) continue;
                const destPath = path.join(dest, entry.name);
                if (!await safeExistsAsync(path.join(src, entry.name))) {
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
async function copyFileIfChanged(src: string, dest: string): Promise<boolean> {
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
async function filesEqual(a: string, b: string): Promise<boolean> {
    const [bufA, bufB] = await Promise.all([
        fs.promises.readFile(a),
        fs.promises.readFile(b),
    ]);
    return bufA.equals(bufB);
}

// ── SyncEngine ───────────────────────────────────────────────────────────────

export class SyncEngine {
    private readonly dataDir: string;
    private readonly workspaceId: string;
    private readonly syncRepoDir: string;
    private readonly lockPath: string;
    private readonly logger: SyncLogger;
    private readonly mapping: FolderMapping;
    private readonly aiInvoker?: AIInvoker;

    private status: SyncStatus = {
        inProgress: false,
        lastSyncTime: null,
        lastError: null,
        enabled: false,
        reconcileInProgress: false,
        reconcileReport: null,
    };

    private syncTimer: ReturnType<typeof setTimeout> | null = null;
    /** Base delay between ticks (ms), from the configured interval. */
    private baseDelayMs = 0;
    /** Delay (ms) for the next tick; grows on failure, resets on success. */
    private nextDelayMs = 0;
    /** Bumped on start/stop so an in-flight tick can't resurrect a stopped timer. */
    private timerGeneration = 0;

    constructor(opts: SyncEngineOptions) {
        this.dataDir = opts.dataDir;
        this.workspaceId = opts.workspaceId;
        const syncSubfolder = opts.workspaceId.replace(/_/g, '-');
        this.syncRepoDir = path.join(opts.dataDir, 'sync', syncSubfolder);
        this.lockPath = path.join(this.syncRepoDir, '.lock');
        this.logger = opts.logger ?? DEFAULT_LOGGER;
        this.mapping = {
            repoFolder: '.',
            localDir: path.join(opts.dataDir, 'repos', opts.workspaceId, 'notes'),
        };
        this.aiInvoker = opts.aiInvoker;
    }

    /** Returns the current sync status. */
    getStatus(): SyncStatus {
        return { ...this.status };
    }

    /**
     * Start (or reconfigure) the sync engine: do an initial sync, then schedule
     * periodic syncs. Passing an empty gitRemote disables the engine and stops
     * any running timer — useful when the user clears the remote in settings.
     */
    async start(gitRemote: string, intervalMinutes: number): Promise<void> {
        if (!gitRemote) {
            this.logger.info(`Sync disabled for ${this.workspaceId} (no gitRemote configured)`);
            this.status.enabled = false;
            this.gitRemoteCache = '';
            this.stopPeriodicSync();
            return;
        }

        this.status.enabled = true;
        this.logger.info(`Starting sync engine for ${this.workspaceId}`);

        // The merge that made this mirror's baseline may have happened on a
        // previous run of the server. Its summary is the user's one account of
        // which notes got combined, so read it back rather than showing nothing.
        this.status.reconcileReport = reconcileReport(await readReconcileMarker(this.syncRepoDir));

        // Fire-and-forget initial sync — don't block server startup
        this.performSync(gitRemote).catch(() => {});

        this.startPeriodicSync(intervalMinutes);
    }

    /** Stop the periodic sync timer. */
    stop(): void {
        this.stopPeriodicSync();
    }

    /**
     * Trigger a one-off sync immediately. Returns when complete.
     * Exposed for the manual-trigger REST endpoint.
     */
    async triggerSync(gitRemote: string): Promise<SyncStatus> {
        await this.performSync(gitRemote);
        return this.getStatus();
    }

    // ── Private ──────────────────────────────────────────────────────────────

    private startPeriodicSync(intervalMinutes: number): void {
        this.stopPeriodicSync();
        this.baseDelayMs = intervalMinutes * 60_000;
        this.nextDelayMs = this.baseDelayMs;
        this.scheduleNextSync(this.timerGeneration);
        this.logger.info(`Periodic sync scheduled every ${intervalMinutes} minutes`);
    }

    private stopPeriodicSync(): void {
        // Bump the generation so any in-flight tick won't reschedule itself.
        this.timerGeneration++;
        if (this.syncTimer) {
            clearTimeout(this.syncTimer);
            this.syncTimer = null;
        }
    }

    /**
     * Schedule the next sync via a self-rescheduling timeout (rather than a fixed
     * interval) so the delay can grow after a failure and reset after success.
     */
    private scheduleNextSync(generation: number): void {
        this.syncTimer = setTimeout(() => { void this.runScheduledSync(generation); }, this.nextDelayMs);
        // Don't hold the event loop open for the timer.
        if (this.syncTimer && typeof this.syncTimer === 'object' && 'unref' in this.syncTimer) {
            this.syncTimer.unref();
        }
    }

    private async runScheduledSync(generation: number): Promise<void> {
        if (generation !== this.timerGeneration || !this.status.enabled) return;
        try {
            await this.performSync(this.getGitRemoteFromStatus());
        } catch { /* performSync already records lastError */ }
        // Back off on failure (lastError set), reset to the base delay on success.
        this.nextDelayMs = nextSyncDelayMs({
            failed: this.status.lastError !== null,
            currentMs: this.nextDelayMs,
            baseMs: this.baseDelayMs,
            maxMs: MAX_SYNC_BACKOFF_MINUTES * 60_000,
        });
        // Only reschedule if we haven't been stopped/reconfigured mid-tick.
        if (generation === this.timerGeneration && this.status.enabled) {
            this.scheduleNextSync(generation);
        }
    }

    private gitRemoteCache: string = '';

    private getGitRemoteFromStatus(): string {
        return this.gitRemoteCache;
    }

    private async performSync(gitRemote: string): Promise<void> {
        if (this.status.inProgress) {
            this.logger.warn('Sync already in progress, skipping');
            return;
        }

        if (!await acquireLock(this.lockPath)) {
            this.logger.warn('Could not acquire sync lock, skipping');
            return;
        }

        this.gitRemoteCache = gitRemote;
        this.status.inProgress = true;
        this.status.lastError = null;

        try {
            // 1. Ensure the sync repo exists (clone or verify)
            await this.ensureSyncRepo(gitRemote);

            // 1b. First contact with a remote that already has notes: union-merge
            //     the two sides instead of running the flow below, which treats
            //     local as authoritative and would mirror-delete every remote note
            //     we don't have. Reconcile pushes and copies back itself, so the
            //     tick is done once it returns.
            //
            //     Read the baseline once and hand it to both users below: two
            //     reads a tick could disagree, and they'd disagree on exactly the
            //     question of whether deleting the remote's notes is allowed.
            const baseline = await readReconcileMarker(this.syncRepoDir);
            if (await this.needsReconcile(baseline)) {
                await this.runReconcile('first sync with a remote that already has notes');
                return;
            }

            // 2. Copy local notes → sync repo (changed files only)
            await this.copyLocalToRepo(baseline !== null);

            // 3. Stage local changes and see whether anything actually changed.
            const hasLocalChanges = await this.stageLocalChanges();

            // 4. If nothing changed locally AND the remote has no new commits,
            //    this is an idle tick — skip commit/pull/push/copy-back entirely.
            const remoteHasChanges = await this.remoteHasNewCommits();
            if (!hasLocalChanges && !remoteHasChanges) {
                this.status.lastSyncTime = new Date().toISOString();
                this.status.lastError = null;
                this.logger.info('Sync idle — no local or remote changes');
                return;
            }

            // 5. Commit any staged local changes.
            if (hasLocalChanges) {
                await this.commitLocalChanges();
            }

            // 6. Pull remote changes (may produce conflicts). Git refusing to
            //    merge unrelated histories is the reconcile situation surfacing
            //    late — a repo left in that state before this phase existed has
            //    no marker to detect it by — so heal it here instead of failing
            //    every tick forever.
            let hasConflicts: boolean;
            try {
                hasConflicts = await this.pullRemote();
            } catch (err: unknown) {
                const message = err instanceof Error ? err.message : String(err);
                if (!isUnrelatedHistoriesError(message)) throw err;
                await this.runReconcile('remote history is unrelated to this mirror');
                return;
            }

            // 7. If conflicts, resolve them
            if (hasConflicts) {
                await this.resolveConflicts();
            }

            // 8. Push to remote
            const pushed = await this.pushToRemote();

            // 9. Copy sync repo → local notes
            await this.copyRepoToLocal();

            // 10. A push that landed means this mirror and the remote now share
            //     history by the ordinary route — typically the first push to a
            //     remote that was empty. That earns the same baseline reconcile's
            //     own merge would: without it the next tick would see a remote
            //     that suddenly has commits and no marker, and try to union-merge
            //     these notes with the copies it just pushed.
            if (pushed) await this.recordSyncBaseline();

            this.status.lastSyncTime = new Date().toISOString();
            this.status.lastError = null;
            this.logger.info(`Sync completed successfully at ${this.status.lastSyncTime}`);
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            this.status.lastError = message;
            this.logger.error(`Sync failed: ${message}`);
        } finally {
            this.status.inProgress = false;
            await releaseLock(this.lockPath);
        }
    }

    private async ensureSyncRepo(gitRemote: string): Promise<void> {
        if (await isGitRepo(this.syncRepoDir)) {
            // Verify the remote matches
            try {
                const currentRemote = await git(['remote', 'get-url', 'origin'], this.syncRepoDir);
                if (currentRemote !== gitRemote) {
                    await git(['remote', 'set-url', 'origin', gitRemote], this.syncRepoDir);
                    this.logger.info('Updated sync repo remote URL');
                }
            } catch {
                await git(['remote', 'add', 'origin', gitRemote], this.syncRepoDir);
            }
            return;
        }

        // Clone fresh
        await fs.promises.mkdir(this.syncRepoDir, { recursive: true });
        try {
            await git(['clone', gitRemote, '.'], this.syncRepoDir);
            this.logger.info('Cloned sync repo');
        } catch {
            // Remote might be empty — init locally and add remote
            await git(['init'], this.syncRepoDir);
            await git(['remote', 'add', 'origin', gitRemote], this.syncRepoDir);
            this.logger.info('Initialized empty sync repo with remote');
        }
    }

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
    private async copyLocalToRepo(hasBaseline: boolean): Promise<void> {
        if (await safeExistsAsync(this.mapping.localDir)) {
            // Never touch the sync repo's own .git / .lock on the outbound copy.
            await copyDirContents(this.mapping.localDir, this.syncRepoDir, {
                ignore: SYNC_IGNORE_NAMES,
                mirrorDeletes: hasBaseline,
            });
        }
    }

    /**
     * Stage all local changes and report whether anything is actually staged.
     * `git add -A` after a changed-files-only copy is a cheap stat pass when the
     * tree is unchanged, so an idle tick stages nothing and returns false.
     */
    private async stageLocalChanges(): Promise<boolean> {
        await git(['add', '-A'], this.syncRepoDir);
        try {
            await git(['diff', '--cached', '--quiet'], this.syncRepoDir);
            return false; // nothing staged
        } catch {
            return true; // changes staged
        }
    }

    private async commitLocalChanges(): Promise<void> {
        const hostname = require('os').hostname();
        await git(
            ['commit', '-m', `sync from ${hostname} at ${new Date().toISOString()}`],
            this.syncRepoDir,
        );
        this.logger.info('Committed local changes');
    }

    /**
     * Whether the remote has commits the local sync repo doesn't (or vice-versa).
     * Uses `ls-remote` so an idle tick never fetches or touches the working tree.
     * Returns false when the remote is empty/unreachable — there's nothing to pull.
     */
    private async remoteHasNewCommits(): Promise<boolean> {
        let remoteLine: string;
        try {
            remoteLine = await git(['ls-remote', 'origin', 'HEAD'], this.syncRepoDir);
        } catch {
            return false; // unreachable — nothing to pull this tick
        }
        const remoteHead = remoteLine.split(/\s+/)[0]?.trim();
        if (!remoteHead) return false; // empty remote

        let localHead: string;
        try {
            localHead = await git(['rev-parse', 'HEAD'], this.syncRepoDir);
        } catch {
            return true; // no local commits yet but remote has some → pull
        }
        return remoteHead !== localHead;
    }

    private async pullRemote(): Promise<boolean> {
        try {
            // Check if remote has any commits first
            try {
                await git(['ls-remote', '--heads', 'origin'], this.syncRepoDir);
            } catch {
                return false; // Can't reach remote or empty
            }

            await git(['pull', '--no-rebase', 'origin', 'HEAD'], this.syncRepoDir);
            return false;
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            if (message.includes('CONFLICT') || message.includes('Automatic merge failed')) {
                this.logger.warn('Merge conflicts detected');
                return true;
            }
            // If pull fails for non-conflict reasons (e.g. no upstream), that's OK
            if (message.includes('couldn\'t find remote ref') || message.includes('no tracking information')) {
                return false;
            }
            throw err;
        }
    }

    private async resolveConflicts(): Promise<void> {
        // Get list of conflicted files
        const statusOutput = await git(['status', '--porcelain'], this.syncRepoDir);
        const conflictedFiles = statusOutput
            .split('\n')
            .filter(line => line.startsWith('UU') || line.startsWith('AA') || line.startsWith('DU') || line.startsWith('UD'))
            .map(line => line.slice(3).trim());

        if (conflictedFiles.length === 0) return;

        this.logger.info(`Resolving ${conflictedFiles.length} conflicted file(s)`);

        for (const file of conflictedFiles) {
            const filePath = path.join(this.syncRepoDir, file);
            try {
                const readResult = await safeReadFileAsync(filePath);
                if (!readResult.success) throw readResult.error!;
                const resolved = await this.resolveFileConflict(file, readResult.data!);
                await fs.promises.writeFile(filePath, resolved, 'utf8');
                await git(['add', file], this.syncRepoDir);
            } catch (err) {
                this.logger.error(`Failed to resolve conflict in ${file}: ${err}`);
                // Accept theirs as fallback
                try {
                    await git(['checkout', '--theirs', file], this.syncRepoDir);
                    await git(['add', file], this.syncRepoDir);
                } catch { /* last resort: skip */ }
            }
        }

        try {
            await git(['commit', '--no-edit'], this.syncRepoDir);
            this.logger.info('Committed conflict resolution');
        } catch {
            // May already be committed
        }
    }

    /**
     * Resolve a single file's merge conflicts. Uses AI when available,
     * falls back to simple concatenation-based resolution.
     */
    private async resolveFileConflict(fileName: string, content: string): Promise<string> {
        if (!this.aiInvoker) {
            return resolveConflictSimple(content);
        }

        try {
            const resolved = await resolveConflictWithAI(this.aiInvoker, fileName, content);
            this.logger.info(`AI resolved conflict in ${fileName}`);
            return resolved;
        } catch (err) {
            this.logger.warn(`AI conflict resolution failed for ${fileName}, falling back to simple merge: ${err}`);
            return resolveConflictSimple(content);
        }
    }

    /** Push, reporting whether it landed. A failure retries on the next tick. */
    private async pushToRemote(): Promise<boolean> {
        try {
            await git(['push', '-u', 'origin', 'HEAD'], this.syncRepoDir);
            this.logger.info('Pushed to remote');
            return true;
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            this.logger.warn(`Push failed (will retry next cycle): ${message}`);
            return false;
        }
    }

    private async copyRepoToLocal(): Promise<void> {
        if (await safeExistsAsync(this.syncRepoDir)) {
            await fs.promises.mkdir(this.mapping.localDir, { recursive: true });
            // Copy everything except .git and .lock, writing only changed files so
            // an idle inbound copy doesn't churn mtimes (and the notes fs-watcher).
            const entries = await safeReadDirAsync(this.syncRepoDir, true);
            if (!entries.success) return;
            for (const entry of entries.data!) {
                if (SYNC_IGNORE_NAMES.has(entry.name)) continue;
                const src = path.join(this.syncRepoDir, entry.name);
                const dest = path.join(this.mapping.localDir, entry.name);
                if (entry.isDirectory()) {
                    await copyDirContents(src, dest, { ignore: SYNC_IGNORE_NAMES });
                } else {
                    await copyFileIfChanged(src, dest);
                }
            }
        }
    }

    // ── Initial reconcile ────────────────────────────────────────────────────

    /**
     * Whether this tick has to reconcile before anything else. Asked after the
     * repo exists but before the first copy, because that copy is the destructive
     * step: it mirrors local over the sync repo, deleting whatever the remote had
     * that this device doesn't.
     *
     * Takes the baseline the tick already read rather than reading it again —
     * see `performSync`.
     */
    private async needsReconcile(baseline: ReconcileMarker | null): Promise<boolean> {
        return shouldReconcile({
            markerPresent: baseline !== null,
            localTreeNonEmpty: await isNotesTreeNonEmpty(this.mapping.localDir, SYNC_IGNORE_NAMES),
            remoteHasCommits: await this.remoteHasCommits(),
        });
    }

    /**
     * Whether the remote has any commits to reconcile against. An unreachable
     * remote reports false: there's nothing to merge, and the normal flow's push
     * will fail and back off on its own.
     */
    private async remoteHasCommits(): Promise<boolean> {
        try {
            const line = await git(['ls-remote', 'origin', 'HEAD'], this.syncRepoDir);
            return !!line.split(/\s+/)[0]?.trim();
        } catch {
            return false;
        }
    }

    /**
     * Record the baseline a normal sync established, unless one already exists.
     * Only called after a push actually landed: a swallowed push failure must
     * leave the phase un-retired, so an unmerged remote is never treated as one
     * this device shares history with.
     */
    private async recordSyncBaseline(): Promise<void> {
        if (await readReconcileMarker(this.syncRepoDir)) return;
        await writeReconcileMarker(this.syncRepoDir, {
            version: RECONCILE_MARKER_VERSION,
            mergedCommit: await git(['rev-parse', 'HEAD'], this.syncRepoDir),
            reconciledAt: new Date().toISOString(),
        });
    }

    /**
     * Run the one-time merge and complete the tick on it. Both ways into the
     * phase end here: reconcile has already pushed and copied the merged tree
     * back, so the rest of `performSync` has nothing left to do.
     */
    private async runReconcile(reason: string): Promise<void> {
        this.logger.info(`Initial reconcile — ${reason}`);
        this.status.reconcileInProgress = true;
        try {
            // A failed merge leaves the report alone rather than blanking it: the
            // marker still holds whatever last succeeded, and re-running is safe.
            this.status.reconcileReport = (await this.reconcile()).report;
        } finally {
            this.status.reconcileInProgress = false;
        }
        this.status.lastSyncTime = new Date().toISOString();
        this.status.lastError = null;
        this.logger.info(`Initial reconcile completed at ${this.status.lastSyncTime}`);
    }

    /**
     * One-time union merge of the local notes with a remote that already has
     * content. Runs instead of the normal copy/stage/push flow on first contact,
     * because that flow assumes local is authoritative: it would mirror-delete
     * every remote note missing locally, and its `git pull` can't merge two
     * histories that have no common commit.
     *
     * Nothing on either side is deleted here. A path only one side has is kept;
     * a path both sides have with different text is combined by the same
     * AI-then-simple resolver the steady-state flow uses; a binary both sides
     * changed keeps both copies. The result lands as a single commit on top of
     * the remote's history, so the push fast-forwards and every later sync has
     * this commit as the common ancestor that makes a normal 3-way merge work.
     *
     * Safe to re-run: the merge is idempotent, and the marker that retires this
     * phase is only written once the push has actually landed.
     */
    private async reconcile(): Promise<ReconcileResult> {
        // The remote side must come out of git objects rather than the working
        // tree. When we get here by way of a failed pull, the tree on disk holds
        // the local mirror — reading it would merge local against itself.
        await git(['fetch', 'origin', 'HEAD'], this.syncRepoDir);
        const remoteHead = await git(['rev-parse', 'FETCH_HEAD'], this.syncRepoDir);

        const [local, remote] = await Promise.all([
            scanTreeToMap(this.mapping.localDir, SYNC_IGNORE_NAMES),
            this.readRemoteTree(remoteHead),
        ]);

        const plan = planUnionMerge(local, remote);
        this.logger.info(
            `Reconciling ${local.size} local + ${remote.size} remote note(s): ` +
            `${plan.counts.combined} to combine, ${plan.counts.keptBothBinary} binary conflict(s)`,
        );

        // Re-parent onto the remote's branch without disturbing the working tree:
        // `symbolic-ref` moves HEAD, `reset --mixed` points that branch at the
        // remote's tip and loads its tree into the index. The merged tree is then
        // just the difference we stage on top.
        const branch = await this.remoteDefaultBranch();
        if (branch) await git(['symbolic-ref', 'HEAD', `refs/heads/${branch}`], this.syncRepoDir);
        await git(['reset', '--mixed', remoteHead], this.syncRepoDir);

        await applyMergePlan({
            destDir: this.syncRepoDir,
            plan,
            local,
            remote,
            resolveText: (filePath, blob) => this.resolveFileConflict(filePath, blob),
        });

        let mergedCommit = remoteHead;
        let backupTag: string | null = null;

        if (await this.stageMergedTree()) {
            // Tag the remote's pre-merge tip and get that tag onto the remote
            // before its branch moves, so the reconcile is one `git reset` away
            // from undo even if this machine dies mid-push.
            backupTag = `sync-backup/${backupTagStamp(new Date())}`;
            await git(['tag', backupTag, remoteHead], this.syncRepoDir);
            await git(['push', 'origin', `refs/tags/${backupTag}`], this.syncRepoDir);

            const message = reconcileCommitMessage({
                localCount: local.size,
                remoteCount: remote.size,
                plan,
            });
            await git(['commit', '-m', message], this.syncRepoDir);
            mergedCommit = await git(['rev-parse', 'HEAD'], this.syncRepoDir);

            // Deliberately not pushToRemote(): that swallows failures to retry
            // next tick, but here a failed push must abort before the marker is
            // written, or reconcile would retire having pushed nothing.
            await git(['push', '-u', 'origin', 'HEAD'], this.syncRepoDir);
            this.logger.info(`Reconcile pushed ${mergedCommit.slice(0, 8)} (backup tag ${backupTag})`);
        } else {
            this.logger.info('Reconcile: local and remote already agree, nothing to push');
        }

        await this.copyRepoToLocal();

        // Only now, with the merged tree on the remote and back on disk, does the
        // marker retire this phase and unlock steady-state mirror-deletes. It
        // carries the summary too, so the panel can still show what this merge
        // did after a restart — this is the only run that will ever produce it.
        const summary = summarizeMergePlan(plan, backupTag);
        const reconciledAt = new Date().toISOString();
        await writeReconcileMarker(this.syncRepoDir, {
            version: RECONCILE_MARKER_VERSION,
            mergedCommit,
            reconciledAt,
            report: summary,
        });

        return { plan, mergedCommit, backupTag, report: { ...summary, mergedCommit, reconciledAt } };
    }

    /** Read a commit's full tree into memory, keyed the same way as a disk scan. */
    private async readRemoteTree(ref: string): Promise<Map<string, Buffer>> {
        // -z keeps unusual filenames intact; git would otherwise quote them.
        const listing = await git(['ls-tree', '-r', '--name-only', '-z', ref], this.syncRepoDir);
        const tree = new Map<string, Buffer>();
        for (const filePath of listing.split('\0')) {
            if (!filePath) continue;
            // A remote that was pushed by an older version may carry our own
            // `.lock`; it is never note content, so it never enters the merge.
            if (filePath.split('/').some(seg => SYNC_IGNORE_NAMES.has(seg))) continue;
            tree.set(filePath, await gitBuffer(['show', `${ref}:${filePath}`], this.syncRepoDir));
        }
        return tree;
    }

    /**
     * The branch the remote's HEAD points at, or null when it can't be read.
     * Reconcile targets the remote's default branch, so the merged commit has to
     * land on that branch rather than whatever this mirror happens to be on.
     */
    private async remoteDefaultBranch(): Promise<string | null> {
        try {
            const out = await git(['ls-remote', '--symref', 'origin', 'HEAD'], this.syncRepoDir);
            return out.match(/^ref:\s+refs\/heads\/(\S+)\s+HEAD$/m)?.[1] ?? null;
        } catch {
            return null; // fall back to the branch we're already on
        }
    }

    /**
     * Stage the merged tree and report whether it differs from the remote's.
     * The ignored names are excluded explicitly: the sync lock lives in the
     * working tree, and the one clean reconcile commit shouldn't carry it.
     */
    private async stageMergedTree(): Promise<boolean> {
        const excludes = [...SYNC_IGNORE_NAMES].map(name => `:(exclude)${name}`);
        await git(['add', '-A', '--', '.', ...excludes], this.syncRepoDir);
        try {
            await git(['diff', '--cached', '--quiet'], this.syncRepoDir);
            return false; // merged tree already matches the remote
        } catch {
            return true;
        }
    }
}

/**
 * Timestamp for a `sync-backup/<stamp>` tag. Git ref names can't contain a
 * colon, so the ISO form is flattened rather than used as-is.
 */
export function backupTagStamp(when: Date): string {
    return when.toISOString().replace(/[:.]/g, '-');
}

// ── Utilities ────────────────────────────────────────────────────────────────

/**
 * Compute the delay before the next scheduled sync. On success the delay resets
 * to the base interval; on failure it doubles (capped at `maxMs`) so a broken
 * remote backs off instead of hammering the disk every tick.
 */
export function nextSyncDelayMs(opts: {
    failed: boolean;
    currentMs: number;
    baseMs: number;
    maxMs: number;
}): number {
    if (!opts.failed) return opts.baseMs;
    return Math.min(Math.max(opts.currentMs, opts.baseMs) * 2, opts.maxMs);
}

/**
 * Simple merge-conflict resolution: extracts both sides and concatenates them,
 * preferring to keep all content from both versions.
 */
export function resolveConflictSimple(content: string): string {
    const lines = content.split('\n');
    const result: string[] = [];
    let inConflict = false;
    let side: 'ours' | 'theirs' = 'ours';
    const ours: string[] = [];
    const theirs: string[] = [];

    for (const line of lines) {
        if (line.startsWith('<<<<<<<')) {
            inConflict = true;
            side = 'ours';
            ours.length = 0;
            theirs.length = 0;
            continue;
        }
        if (line.startsWith('=======') && inConflict) {
            side = 'theirs';
            continue;
        }
        if (line.startsWith('>>>>>>>') && inConflict) {
            // Merge: keep both sides, deduplicate identical lines
            const oursText = ours.join('\n');
            const theirsText = theirs.join('\n');
            if (oursText === theirsText) {
                result.push(oursText);
            } else {
                result.push(oursText);
                if (oursText && theirsText) result.push('');
                result.push(theirsText);
            }
            inConflict = false;
            continue;
        }

        if (inConflict) {
            if (side === 'ours') ours.push(line);
            else theirs.push(line);
        } else {
            result.push(line);
        }
    }

    return result.join('\n');
}

// ── AI conflict resolution prompt ────────────────────────────────────────────

const CONFLICT_RESOLUTION_PROMPT = `You are resolving a Git merge conflict in a personal notes file used in a "My Work / My Life" productivity system.

The file below contains Git conflict markers (<<<<<<< / ======= / >>>>>>>). Each conflict region has two versions:
- "Ours" (between <<<<<<< and =======): changes from this machine
- "Theirs" (between ======= and >>>>>>>): changes from another machine

Your job:
1. Understand the semantic content — these are action items, journal entries, goals, reflections, or follow-ups.
2. Merge intelligently: keep ALL meaningful content from both sides. Do not drop any action items, tasks, or journal entries.
3. If both sides edited the same item (e.g. updated a status or added notes), combine them logically — prefer the more complete or recent version, but preserve any unique details from either side.
4. Remove the conflict markers entirely. Output ONLY the final resolved file content with no markers, no explanations, and no surrounding code fences.

File: {{fileName}}

Content with conflicts:
{{content}}`;

/**
 * Resolve merge conflicts using AI. Sends the conflicted file to the AI invoker
 * and expects back a clean resolved version.
 *
 * @throws if the AI call fails or returns an empty response
 */
export async function resolveConflictWithAI(
    aiInvoker: AIInvoker,
    fileName: string,
    content: string,
): Promise<string> {
    const prompt = CONFLICT_RESOLUTION_PROMPT
        .replace('{{fileName}}', fileName)
        .replace('{{content}}', content);

    const result = await aiInvoker(prompt);

    if (!result.success || !result.response?.trim()) {
        throw new Error(result.error || 'AI returned empty response for conflict resolution');
    }

    let resolved = result.response.trim();

    // Strip code fences if the AI wrapped the output
    if (resolved.startsWith('```')) {
        const lines = resolved.split('\n');
        // Remove first line (```markdown or ```) and last line (```)
        if (lines[lines.length - 1].trim() === '```') {
            lines.shift();
            lines.pop();
            resolved = lines.join('\n');
        }
    }

    // Sanity check: resolved content should not contain conflict markers
    if (resolved.includes('<<<<<<<') || resolved.includes('>>>>>>>')) {
        throw new Error('AI response still contains conflict markers');
    }

    return resolved;
}
