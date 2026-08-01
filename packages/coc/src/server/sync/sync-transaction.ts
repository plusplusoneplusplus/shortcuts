/**
 * Ordered sync transaction for the notes sync engine.
 *
 * The correctness property of a sync tick is ordering: repo verification and
 * baseline check must gate the destructive mirror copy, the merged tree must
 * reach the remote before the marker retires reconcile, and a swallowed push
 * failure must not write a baseline. {@link SyncTransactionRunner} keeps that
 * ordering in one place, driving the git / mirror / conflict kernels and
 * updating the shared {@link SyncStatus} from each step.
 */

import * as fs from 'fs';
import * as os from 'os';
import { safeExistsAsync } from '@plusplusoneplusplus/forge';
import type { SyncGitRepository } from './sync-git';
import type { SyncMirrorCopier } from './sync-mirror';
import { SYNC_IGNORE_NAMES } from './sync-mirror';
import type { SyncConflictResolver } from './sync-conflict';
import type { SyncLogger, SyncStatus, ReconcileResult } from './sync-types';
import {
    RECONCILE_MARKER_VERSION,
    applyMergePlan,
    isNotesTreeNonEmpty,
    isUnrelatedHistoriesError,
    planUnionMerge,
    readReconcileMarker,
    reconcileCommitMessage,
    scanTreeToMap,
    shouldReconcile,
    summarizeMergePlan,
    writeReconcileMarker,
} from './sync-reconcile';
import type { ReconcileMarker } from './sync-reconcile';

export interface SyncTransactionDeps {
    git: SyncGitRepository;
    mirror: SyncMirrorCopier;
    resolver: SyncConflictResolver;
    syncRepoDir: string;
    localDir: string;
    logger: SyncLogger;
    /** The engine's live status object; the runner mutates it as steps complete. */
    status: SyncStatus;
}

/**
 * Timestamp for a `sync-backup/<stamp>` tag. Git ref names can't contain a
 * colon, so the ISO form is flattened rather than used as-is.
 */
export function backupTagStamp(when: Date): string {
    return when.toISOString().replace(/[:.]/g, '-');
}

export class SyncTransactionRunner {
    private readonly git: SyncGitRepository;
    private readonly mirror: SyncMirrorCopier;
    private readonly resolver: SyncConflictResolver;
    private readonly syncRepoDir: string;
    private readonly localDir: string;
    private readonly logger: SyncLogger;
    private readonly status: SyncStatus;

    constructor(deps: SyncTransactionDeps) {
        this.git = deps.git;
        this.mirror = deps.mirror;
        this.resolver = deps.resolver;
        this.syncRepoDir = deps.syncRepoDir;
        this.localDir = deps.localDir;
        this.logger = deps.logger;
        this.status = deps.status;
    }

    /**
     * Run one steady-state sync tick against `gitRemote`. Throws on unhandled
     * failure (the caller records `lastError`); updates status in place on each
     * success/idle/reconcile path.
     */
    async run(gitRemote: string): Promise<void> {
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
        await this.mirror.copyLocalToRepo(baseline !== null);

        // 3. Stage local changes and see whether anything actually changed.
        const hasLocalChanges = await this.git.stageAll(SYNC_IGNORE_NAMES);

        // 4. Nothing changed locally and the remote has no new commits, so
        //    there is nothing to commit, pull or push. The copy back still
        //    runs: the mirror can hold notes this device has never had on
        //    disk — one cloned by an earlier tick, or a notes dir that was
        //    restored empty — and no other step will put them there. It is
        //    a stat pass over an unchanged tree, and writes nothing when
        //    the device already agrees.
        const remoteHasChanges = await this.git.hasRemoteChanges();
        if (!hasLocalChanges && !remoteHasChanges) {
            await this.mirror.copyRepoToLocal();
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
            hasConflicts = await this.git.pull();
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            if (!isUnrelatedHistoriesError(message)) throw err;
            await this.runReconcile('remote history is unrelated to this mirror');
            return;
        }

        // 7. If conflicts, resolve them
        if (hasConflicts) {
            const report = await this.resolver.resolveConflicts();
            if (report) this.status.lastResolution = report;
        }

        // 8. Push to remote
        const pushed = await this.pushStep();

        // 9. Copy sync repo → local notes
        await this.mirror.copyRepoToLocal();

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
    }

    private async ensureSyncRepo(gitRemote: string): Promise<void> {
        if (await this.git.isUsable()) {
            // Verify the remote matches
            await this.git.ensureRemote(gitRemote);
            return;
        }

        // Nothing usable here: a mirror whose refs stopped resolving, or a tree
        // left by an interrupted clone. Clear it before cloning — `git clone .`
        // refuses a non-empty directory, and everything in the mirror is
        // derived (its notes come from `localDir`, its history from the
        // remote), so there is nothing here that only exists here.
        if (await safeExistsAsync(this.syncRepoDir)) {
            await fs.promises.rm(this.syncRepoDir, { recursive: true, force: true });
            this.logger.warn('Sync repo unusable — rebuilding it from the remote');
        }
        await fs.promises.mkdir(this.syncRepoDir, { recursive: true });
        await this.git.clone(gitRemote);
    }

    private async commitLocalChanges(): Promise<void> {
        await this.git.commit(`sync from ${os.hostname()} at ${new Date().toISOString()}`);
        this.logger.info('Committed local changes');
    }

    /**
     * Push, reporting whether it landed. A failure retries on the next tick, so
     * it is kept out of `lastError` (the local sync did complete) and surfaced as
     * `pushPending` instead — an amber "retrying" state rather than a red failure.
     */
    private async pushStep(): Promise<boolean> {
        try {
            await this.git.push();
            this.logger.info('Pushed to remote');
            this.status.pushPending = false;
            this.status.lastPushError = null;
            return true;
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            // A repeated failure (already pending) is stuck, not transient — log it
            // at error so the console distinguishes the two.
            if (this.status.pushPending) {
                this.logger.error(`Push still failing (commit stuck, will keep retrying): ${message}`);
            } else {
                this.logger.warn(`Push failed (will retry next cycle): ${message}`);
            }
            this.status.pushPending = true;
            this.status.lastPushError = message;
            return false;
        }
    }

    // ── Initial reconcile ────────────────────────────────────────────────────

    /**
     * Whether this tick has to reconcile before anything else. Asked after the
     * repo exists but before the first copy, because that copy is the destructive
     * step: it mirrors local over the sync repo, deleting whatever the remote had
     * that this device doesn't.
     *
     * Takes the baseline the tick already read rather than reading it again.
     */
    private async needsReconcile(baseline: ReconcileMarker | null): Promise<boolean> {
        return shouldReconcile({
            markerPresent: baseline !== null,
            localTreeNonEmpty: await isNotesTreeNonEmpty(this.localDir, SYNC_IGNORE_NAMES),
            remoteHasCommits: await this.git.hasRemoteCommits(),
        });
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
            mergedCommit: await this.git.headSha(),
            reconciledAt: new Date().toISOString(),
        });
    }

    /**
     * Run the one-time merge and complete the tick on it. Both ways into the
     * phase end here: reconcile has already pushed and copied the merged tree
     * back, so the rest of the tick has nothing left to do.
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
        const remoteHead = await this.git.fetchHeadSha();

        const [local, remote] = await Promise.all([
            scanTreeToMap(this.localDir, SYNC_IGNORE_NAMES),
            this.git.readTree(remoteHead, SYNC_IGNORE_NAMES),
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
        const branch = await this.git.defaultBranch();
        if (branch) await this.git.setHeadToBranch(branch);
        await this.git.resetMixed(remoteHead);

        await applyMergePlan({
            destDir: this.syncRepoDir,
            plan,
            local,
            remote,
            resolveText: async (filePath, blob) => (await this.resolver.resolveFileConflict(filePath, blob)).content,
        });

        let mergedCommit = remoteHead;
        let backupTag: string | null = null;

        if (await this.git.stageAll(SYNC_IGNORE_NAMES)) {
            // Tag the remote's pre-merge tip and get that tag onto the remote
            // before its branch moves, so the reconcile is one `git reset` away
            // from undo even if this machine dies mid-push.
            backupTag = `sync-backup/${backupTagStamp(new Date())}`;
            await this.git.tag(backupTag, remoteHead);
            await this.git.pushTag(backupTag);

            const message = reconcileCommitMessage({
                localCount: local.size,
                remoteCount: remote.size,
                plan,
            });
            await this.git.commit(message);
            mergedCommit = await this.git.headSha();

            // Deliberately not pushStep(): that swallows failures to retry
            // next tick, but here a failed push must abort before the marker is
            // written, or reconcile would retire having pushed nothing.
            await this.git.push();
            this.logger.info(`Reconcile pushed ${mergedCommit.slice(0, 8)} (backup tag ${backupTag})`);
        } else {
            this.logger.info('Reconcile: local and remote already agree, nothing to push');
        }

        await this.mirror.copyRepoToLocal();

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
}
