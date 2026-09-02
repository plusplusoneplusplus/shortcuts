/**
 * Unit coverage for the kernels the sync engine was split into — exercised in
 * isolation from the full git-backed transaction:
 *   - SyncMirrorCopier: ignore semantics and baseline-gated mirror deletes
 *   - SyncConflictResolver.resolveFileConflict: AI → simple fallback strategy
 *   - acquireLock / releaseLock: cross-tick lock skip
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
    SyncMirrorCopier,
    SyncConflictResolver,
    resolveConflictSimple,
    SYNC_IGNORE_NAMES,
} from '../../src/server/sync/sync-engine';
import { acquireLock, releaseLock } from '../../src/server/sync/sync-lock';
import type { SyncGitRepository } from '../../src/server/sync/sync-git';
import type { AIInvoker } from '@plusplusoneplusplus/forge';

const silentLogger = { info: () => {}, warn: () => {}, error: () => {} };

// ── SyncMirrorCopier ──────────────────────────────────────────────────────────

describe('SyncMirrorCopier', () => {
    let tmpDir: string;
    let localDir: string;
    let repoDir: string;
    let mirror: SyncMirrorCopier;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-mirror-'));
        localDir = path.join(tmpDir, 'notes');
        repoDir = path.join(tmpDir, 'repo');
        fs.mkdirSync(localDir, { recursive: true });
        fs.mkdirSync(repoDir, { recursive: true });
        // The sync repo always carries the two names a mirror must never touch.
        fs.mkdirSync(path.join(repoDir, '.git'), { recursive: true });
        fs.writeFileSync(path.join(repoDir, '.git', 'HEAD'), 'ref: refs/heads/main\n');
        fs.writeFileSync(path.join(repoDir, '.lock'), '123');
        mirror = new SyncMirrorCopier(localDir, repoDir);
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('copyLocalToRepo without a baseline keeps remote-only notes (no mirror delete)', async () => {
        fs.writeFileSync(path.join(localDir, 'local.md'), '# local');
        fs.writeFileSync(path.join(repoDir, 'remote-only.md'), '# remote');

        await mirror.copyLocalToRepo(false);

        expect(fs.existsSync(path.join(repoDir, 'local.md'))).toBe(true);
        // No baseline → "absent locally" is not "deleted", so the remote note stays.
        expect(fs.existsSync(path.join(repoDir, 'remote-only.md'))).toBe(true);
        // The repo's own git dir / lock are never disturbed.
        expect(fs.existsSync(path.join(repoDir, '.git', 'HEAD'))).toBe(true);
        expect(fs.existsSync(path.join(repoDir, '.lock'))).toBe(true);
    });

    it('copyLocalToRepo with a baseline mirror-deletes remote-only notes but spares .git/.lock', async () => {
        fs.writeFileSync(path.join(localDir, 'local.md'), '# local');
        fs.writeFileSync(path.join(repoDir, 'remote-only.md'), '# remote');

        await mirror.copyLocalToRepo(true);

        expect(fs.existsSync(path.join(repoDir, 'local.md'))).toBe(true);
        // Baseline established → a note the local tree lacks is a real deletion.
        expect(fs.existsSync(path.join(repoDir, 'remote-only.md'))).toBe(false);
        expect(fs.existsSync(path.join(repoDir, '.git', 'HEAD'))).toBe(true);
        expect(fs.existsSync(path.join(repoDir, '.lock'))).toBe(true);
    });

    it('copyRepoToLocal copies notes back but never .git/.lock', async () => {
        fs.writeFileSync(path.join(repoDir, 'a.md'), '# a');
        fs.mkdirSync(path.join(repoDir, 'sub'), { recursive: true });
        fs.writeFileSync(path.join(repoDir, 'sub', 'b.md'), '# b');

        await mirror.copyRepoToLocal(false, 0);

        expect(fs.readFileSync(path.join(localDir, 'a.md'), 'utf8')).toBe('# a');
        expect(fs.readFileSync(path.join(localDir, 'sub', 'b.md'), 'utf8')).toBe('# b');
        expect(fs.existsSync(path.join(localDir, '.git'))).toBe(false);
        expect(fs.existsSync(path.join(localDir, '.lock'))).toBe(false);
    });

    // A cutoff far past every real file mtime → nothing falls in the preserve
    // window, so a genuine deletion is mirror-deleted (the steady-state case
    // where the deleted note predates the tick).
    const FUTURE_CUTOFF = 10_000_000_000_000;

    it('copyRepoToLocal with a baseline mirror-deletes a local-only top-level note', async () => {
        // The clone (repoDir) no longer has this note — a deletion pulled from
        // the remote. A baseline means it must reach local, not survive.
        fs.writeFileSync(path.join(localDir, 'stale.md'), '# stale');
        fs.writeFileSync(path.join(repoDir, 'keep.md'), '# keep');

        await mirror.copyRepoToLocal(true, FUTURE_CUTOFF);

        expect(fs.existsSync(path.join(localDir, 'stale.md'))).toBe(false);
        expect(fs.readFileSync(path.join(localDir, 'keep.md'), 'utf8')).toBe('# keep');
    });

    it('copyRepoToLocal with a baseline mirror-deletes a local-only top-level folder', async () => {
        fs.mkdirSync(path.join(localDir, 'gone'), { recursive: true });
        fs.writeFileSync(path.join(localDir, 'gone', 'inner.md'), '# inner');
        fs.writeFileSync(path.join(repoDir, 'keep.md'), '# keep');

        await mirror.copyRepoToLocal(true, FUTURE_CUTOFF);

        expect(fs.existsSync(path.join(localDir, 'gone'))).toBe(false);
        expect(fs.readFileSync(path.join(localDir, 'keep.md'), 'utf8')).toBe('# keep');
    });

    it('copyRepoToLocal without a baseline never deletes local-only notes (inbound gate)', async () => {
        fs.writeFileSync(path.join(localDir, 'local-only.md'), '# local-only');
        fs.writeFileSync(path.join(repoDir, 'keep.md'), '# keep');

        await mirror.copyRepoToLocal(false, 0);

        // No baseline → "absent in the clone" is not proven to be a deletion.
        expect(fs.existsSync(path.join(localDir, 'local-only.md'))).toBe(true);
        expect(fs.readFileSync(path.join(localDir, 'keep.md'), 'utf8')).toBe('# keep');
    });

    it('copyRepoToLocal spares a local note freshened at/after the tick cutoff', async () => {
        // A note written mid-tick (after the clone was snapshotted) is absent
        // from the clone but is not a deletion; the cutoff must preserve it while
        // still deleting a note that predates the tick.
        fs.writeFileSync(path.join(localDir, 'fresh.md'), '# fresh');
        fs.writeFileSync(path.join(localDir, 'old.md'), '# old');
        const cutoff = 5_000_000;
        // fresh: mtime at/after cutoff → preserved; old: before cutoff → deleted.
        fs.utimesSync(path.join(localDir, 'fresh.md'), cutoff / 1000, cutoff / 1000);
        fs.utimesSync(path.join(localDir, 'old.md'), (cutoff - 60_000) / 1000, (cutoff - 60_000) / 1000);

        await mirror.copyRepoToLocal(true, cutoff);

        expect(fs.existsSync(path.join(localDir, 'fresh.md'))).toBe(true);
        expect(fs.existsSync(path.join(localDir, 'old.md'))).toBe(false);
    });
});

// ── SyncConflictResolver.resolveFileConflict ─────────────────────────────────

describe('SyncConflictResolver.resolveFileConflict', () => {
    const conflicted = '<<<<<<< HEAD\n# ours\n=======\n# theirs\n>>>>>>> other\n';
    // resolveFileConflict never touches git; a bare stub stands in for the repo.
    const stubGit = {} as SyncGitRepository;

    it('uses the simple resolver and reports "simple" when no AI invoker is set', async () => {
        const resolver = new SyncConflictResolver(stubGit, '/nope', silentLogger);
        const outcome = await resolver.resolveFileConflict('a.md', conflicted);
        expect(outcome.strategy).toBe('simple');
        expect(outcome.content).toBe(resolveConflictSimple(conflicted));
    });

    it('uses the AI response and reports "ai" when the invoker succeeds', async () => {
        const invoker: AIInvoker = vi.fn(async () => ({ success: true, response: '# merged' }));
        const resolver = new SyncConflictResolver(stubGit, '/nope', silentLogger, invoker);
        const outcome = await resolver.resolveFileConflict('a.md', conflicted);
        expect(invoker).toHaveBeenCalledOnce();
        expect(outcome.strategy).toBe('ai');
        expect(outcome.content).toBe('# merged');
    });

    it('falls back to the simple resolver (strategy "simple") when the AI call fails', async () => {
        const invoker: AIInvoker = vi.fn(async () => ({ success: false, error: 'boom' }));
        const resolver = new SyncConflictResolver(stubGit, '/nope', silentLogger, invoker);
        const outcome = await resolver.resolveFileConflict('a.md', conflicted);
        expect(outcome.strategy).toBe('simple');
        expect(outcome.content).toBe(resolveConflictSimple(conflicted));
    });
});

// ── Sync lock ────────────────────────────────────────────────────────────────

describe('sync lock', () => {
    let tmpDir: string;
    let lockPath: string;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-lock-'));
        lockPath = path.join(tmpDir, 'nested', 'my-work.lock');
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('grants the lock once, skips a second holder, and re-grants after release', async () => {
        expect(await acquireLock(lockPath)).toBe(true);
        // A concurrent tick (live PID recorded) is skipped rather than stealing it.
        expect(await acquireLock(lockPath)).toBe(false);
        await releaseLock(lockPath);
        expect(await acquireLock(lockPath)).toBe(true);
        await releaseLock(lockPath);
    });

    it('reclaims a stale lock left by a process that is no longer running', async () => {
        await fs.promises.mkdir(path.dirname(lockPath), { recursive: true });
        // PID that cannot be alive → the lock is stale and may be reclaimed.
        fs.writeFileSync(lockPath, '2147483646');
        expect(await acquireLock(lockPath)).toBe(true);
        await releaseLock(lockPath);
    });
});
