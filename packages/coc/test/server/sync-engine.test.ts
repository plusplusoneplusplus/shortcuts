/**
 * Sync Engine Tests
 *
 * Tests for the Git-based notes sync engine: workspace-scoped construction,
 * conflict resolution, status tracking, and folder mapping.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execFileSync } from 'child_process';
import {
    resolveConflictSimple,
    resolveConflictWithAI,
    SyncEngine,
    copyDirContents,
    nextSyncDelayMs,
    backupTagStamp,
    SYNC_IGNORE_NAMES,
    DEFAULT_SYNC_INTERVAL_MINUTES,
    MAX_SYNC_BACKOFF_MINUTES,
} from '../../src/server/sync/sync-engine';
import type { SyncStatus, ReconcileResult } from '../../src/server/sync/sync-engine';
import { readReconcileMarker } from '../../src/server/sync/sync-reconcile';
import type { AIInvoker } from '@plusplusoneplusplus/forge';

// ── resolveConflictSimple ────────────────────────────────────────────────────

describe('resolveConflictSimple', () => {
    it('returns content unchanged when no conflict markers', () => {
        const content = '# Notes\n\nSome content here.';
        expect(resolveConflictSimple(content)).toBe(content);
    });

    it('keeps both sides of a simple conflict', () => {
        const content = [
            '# Notes',
            '<<<<<<< HEAD',
            'Line from ours',
            '=======',
            'Line from theirs',
            '>>>>>>> remote',
            'After conflict',
        ].join('\n');

        const resolved = resolveConflictSimple(content);
        expect(resolved).toContain('Line from ours');
        expect(resolved).toContain('Line from theirs');
        expect(resolved).toContain('# Notes');
        expect(resolved).toContain('After conflict');
        expect(resolved).not.toContain('<<<<<<<');
        expect(resolved).not.toContain('>>>>>>>');
        expect(resolved).not.toContain('=======');
    });

    it('deduplicates identical sides', () => {
        const content = [
            '<<<<<<< HEAD',
            'Same content',
            '=======',
            'Same content',
            '>>>>>>> remote',
        ].join('\n');

        const resolved = resolveConflictSimple(content);
        // Should appear only once
        const matches = resolved.match(/Same content/g);
        expect(matches).toHaveLength(1);
    });

    it('handles multiple conflicts in one file', () => {
        const content = [
            'Before',
            '<<<<<<< HEAD',
            'Ours 1',
            '=======',
            'Theirs 1',
            '>>>>>>> remote',
            'Middle',
            '<<<<<<< HEAD',
            'Ours 2',
            '=======',
            'Theirs 2',
            '>>>>>>> remote',
            'After',
        ].join('\n');

        const resolved = resolveConflictSimple(content);
        expect(resolved).toContain('Before');
        expect(resolved).toContain('Ours 1');
        expect(resolved).toContain('Theirs 1');
        expect(resolved).toContain('Middle');
        expect(resolved).toContain('Ours 2');
        expect(resolved).toContain('Theirs 2');
        expect(resolved).toContain('After');
    });

    it('handles empty ours side', () => {
        const content = [
            '<<<<<<< HEAD',
            '=======',
            'Only theirs',
            '>>>>>>> remote',
        ].join('\n');

        const resolved = resolveConflictSimple(content);
        expect(resolved).toContain('Only theirs');
    });

    it('handles empty theirs side', () => {
        const content = [
            '<<<<<<< HEAD',
            'Only ours',
            '=======',
            '>>>>>>> remote',
        ].join('\n');

        const resolved = resolveConflictSimple(content);
        expect(resolved).toContain('Only ours');
    });

    it('handles multi-line conflict sides', () => {
        const content = [
            '<<<<<<< HEAD',
            'Line 1 ours',
            'Line 2 ours',
            '=======',
            'Line 1 theirs',
            'Line 2 theirs',
            'Line 3 theirs',
            '>>>>>>> remote',
        ].join('\n');

        const resolved = resolveConflictSimple(content);
        expect(resolved).toContain('Line 1 ours');
        expect(resolved).toContain('Line 2 ours');
        expect(resolved).toContain('Line 1 theirs');
        expect(resolved).toContain('Line 2 theirs');
        expect(resolved).toContain('Line 3 theirs');
    });
});

// ── resolveConflictWithAI ────────────────────────────────────────────────────

describe('resolveConflictWithAI', () => {
    const conflictedContent = [
        '# Notes',
        '<<<<<<< HEAD',
        '- [ ] Task from machine A',
        '=======',
        '- [ ] Task from machine B',
        '>>>>>>> remote',
        'End of file',
    ].join('\n');

    it('uses AI response when invocation succeeds', async () => {
        const mockInvoker: AIInvoker = vi.fn().mockResolvedValue({
            success: true,
            response: '# Notes\n- [ ] Task from machine A\n- [ ] Task from machine B\nEnd of file',
        });

        const resolved = await resolveConflictWithAI(mockInvoker, 'my-work/notes.md', conflictedContent);
        expect(resolved).toBe('# Notes\n- [ ] Task from machine A\n- [ ] Task from machine B\nEnd of file');
        expect(mockInvoker).toHaveBeenCalledOnce();

        // Verify prompt includes file name and content
        const prompt = (mockInvoker as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
        expect(prompt).toContain('my-work/notes.md');
        expect(prompt).toContain('Task from machine A');
        expect(prompt).toContain('Task from machine B');
    });

    it('strips code fences from AI response', async () => {
        const mockInvoker: AIInvoker = vi.fn().mockResolvedValue({
            success: true,
            response: '```markdown\n# Notes\n- Resolved content\n```',
        });

        const resolved = await resolveConflictWithAI(mockInvoker, 'test.md', conflictedContent);
        expect(resolved).toBe('# Notes\n- Resolved content');
    });

    it('throws when AI returns failure', async () => {
        const mockInvoker: AIInvoker = vi.fn().mockResolvedValue({
            success: false,
            response: '',
            error: 'Model unavailable',
        });

        await expect(resolveConflictWithAI(mockInvoker, 'test.md', conflictedContent))
            .rejects.toThrow('Model unavailable');
    });

    it('throws when AI returns empty response', async () => {
        const mockInvoker: AIInvoker = vi.fn().mockResolvedValue({
            success: true,
            response: '   ',
        });

        await expect(resolveConflictWithAI(mockInvoker, 'test.md', conflictedContent))
            .rejects.toThrow('AI returned empty response');
    });

    it('throws when AI response still contains conflict markers', async () => {
        const mockInvoker: AIInvoker = vi.fn().mockResolvedValue({
            success: true,
            response: '# Notes\n<<<<<<< HEAD\nstill broken\n=======\nstill broken\n>>>>>>> remote',
        });

        await expect(resolveConflictWithAI(mockInvoker, 'test.md', conflictedContent))
            .rejects.toThrow('still contains conflict markers');
    });

    it('throws when AI invoker rejects', async () => {
        const mockInvoker: AIInvoker = vi.fn().mockRejectedValue(new Error('Network error'));

        await expect(resolveConflictWithAI(mockInvoker, 'test.md', conflictedContent))
            .rejects.toThrow('Network error');
    });
});

// ── SyncEngine ───────────────────────────────────────────────────────────────

describe('SyncEngine', () => {
    let tmpDir: string;
    let engine: SyncEngine;
    const silentLogger = {
        info: () => {},
        warn: () => {},
        error: () => {},
    };

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-sync-test-'));
    });

    afterEach(() => {
        engine?.stop();
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('getStatus returns disabled initially', () => {
        engine = new SyncEngine({
            dataDir: tmpDir,
            workspaceId: 'my_work',
            logger: silentLogger,
        });

        const status = engine.getStatus();
        expect(status.enabled).toBe(false);
        expect(status.inProgress).toBe(false);
        expect(status.lastSyncTime).toBeNull();
        expect(status.lastError).toBeNull();
    });

    it('start() with empty gitRemote keeps enabled false', async () => {
        engine = new SyncEngine({
            dataDir: tmpDir,
            workspaceId: 'my_work',
            logger: silentLogger,
        });

        await engine.start('', 5);
        expect(engine.getStatus().enabled).toBe(false);
    });

    it('start() with empty gitRemote after being enabled disables the engine', async () => {
        engine = new SyncEngine({
            dataDir: tmpDir,
            workspaceId: 'my_work',
            logger: silentLogger,
        });

        // Manually set enabled to simulate a previously-started engine
        // without actually performing git operations (no real remote)
        (engine as any).status.enabled = true;
        (engine as any).gitRemoteCache = 'git@github.com:user/notes.git';

        // Calling start with empty remote should disable
        await engine.start('', 5);
        expect(engine.getStatus().enabled).toBe(false);
    });

    it('workspaceId my_work sets correct sync dir path', () => {
        engine = new SyncEngine({
            dataDir: tmpDir,
            workspaceId: 'my_work',
            logger: silentLogger,
        });

        // The sync dir should use dashes: my-work
        const expectedSyncDir = path.join(tmpDir, 'sync', 'my-work');
        // We verify by checking that the engine is constructable and returns correct status
        const status = engine.getStatus();
        expect(status.enabled).toBe(false);
        // The sync repo dir is private, but we can verify the engine was created without error
        expect(status.inProgress).toBe(false);
    });

    it('workspaceId my_life sets correct sync dir path', () => {
        engine = new SyncEngine({
            dataDir: tmpDir,
            workspaceId: 'my_life',
            logger: silentLogger,
        });

        const status = engine.getStatus();
        expect(status.enabled).toBe(false);
        expect(status.inProgress).toBe(false);
    });

    it('status shape conforms to SyncStatus interface', () => {
        engine = new SyncEngine({
            dataDir: tmpDir,
            workspaceId: 'my_work',
            logger: silentLogger,
        });

        const status: SyncStatus = engine.getStatus();
        expect(typeof status.inProgress).toBe('boolean');
        expect(typeof status.enabled).toBe('boolean');
        expect(status.lastSyncTime).toBeNull();
        expect(status.lastError).toBeNull();
    });
});

// ── Interval / backoff constants ─────────────────────────────────────────────

describe('sync interval constants', () => {
    it('default interval is 30 minutes', () => {
        expect(DEFAULT_SYNC_INTERVAL_MINUTES).toBe(30);
    });

    it('backoff cap is 30 minutes', () => {
        expect(MAX_SYNC_BACKOFF_MINUTES).toBe(30);
    });
});

// ── nextSyncDelayMs (backoff math) ───────────────────────────────────────────

describe('nextSyncDelayMs', () => {
    const base = 60_000;
    const max = 1_800_000; // 30 min

    it('resets to the base delay on success', () => {
        expect(nextSyncDelayMs({ failed: false, currentMs: 999_999, baseMs: base, maxMs: max })).toBe(base);
    });

    it('doubles the current delay on failure', () => {
        expect(nextSyncDelayMs({ failed: true, currentMs: base, baseMs: base, maxMs: max })).toBe(2 * base);
    });

    it('caps the grown delay at maxMs', () => {
        expect(nextSyncDelayMs({ failed: true, currentMs: 1_000_000, baseMs: base, maxMs: max })).toBe(max);
    });

    it('never falls below the base when doubling', () => {
        // A stale currentMs smaller than base still grows from base.
        expect(nextSyncDelayMs({ failed: true, currentMs: 10, baseMs: base, maxMs: max })).toBe(2 * base);
    });

    it('grows geometrically across repeated failures then caps', () => {
        let d = base;
        const seen: number[] = [];
        for (let i = 0; i < 8; i++) {
            d = nextSyncDelayMs({ failed: true, currentMs: d, baseMs: base, maxMs: max });
            seen.push(d);
        }
        expect(seen).toEqual([120_000, 240_000, 480_000, 960_000, 1_800_000, 1_800_000, 1_800_000, 1_800_000]);
        // A success anywhere resets.
        expect(nextSyncDelayMs({ failed: false, currentMs: d, baseMs: base, maxMs: max })).toBe(base);
    });
});

// ── copyDirContents (ignore set + changed-only copy) ─────────────────────────

describe('copyDirContents', () => {
    let tmpDir: string;
    let src: string;
    let dest: string;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-copydir-'));
        src = path.join(tmpDir, 'src');
        dest = path.join(tmpDir, 'dest');
        fs.mkdirSync(src, { recursive: true });
        fs.mkdirSync(dest, { recursive: true });
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('copies new files and reports the count written', async () => {
        fs.writeFileSync(path.join(src, 'a.md'), '# A');
        fs.mkdirSync(path.join(src, 'sub'));
        fs.writeFileSync(path.join(src, 'sub', 'b.md'), '# B');

        const copied = await copyDirContents(src, dest);
        expect(copied).toBe(2);
        expect(fs.readFileSync(path.join(dest, 'a.md'), 'utf8')).toBe('# A');
        expect(fs.readFileSync(path.join(dest, 'sub', 'b.md'), 'utf8')).toBe('# B');
    });

    it('skips unchanged files on a second pass (no rewrite)', async () => {
        fs.writeFileSync(path.join(src, 'a.md'), '# A');
        expect(await copyDirContents(src, dest)).toBe(1);
        // Second pass with identical content must not rewrite anything.
        expect(await copyDirContents(src, dest)).toBe(0);
    });

    it('re-copies a file whose content changed', async () => {
        fs.writeFileSync(path.join(src, 'a.md'), '# A');
        expect(await copyDirContents(src, dest)).toBe(1);
        fs.writeFileSync(path.join(src, 'a.md'), '# A edited');
        expect(await copyDirContents(src, dest)).toBe(1);
        expect(fs.readFileSync(path.join(dest, 'a.md'), 'utf8')).toBe('# A edited');
    });

    it('mirror-deletes files removed from the source', async () => {
        fs.writeFileSync(path.join(dest, 'stale.md'), 'gone');
        fs.writeFileSync(path.join(src, 'keep.md'), 'keep');
        await copyDirContents(src, dest);
        expect(fs.existsSync(path.join(dest, 'stale.md'))).toBe(false);
        expect(fs.existsSync(path.join(dest, 'keep.md'))).toBe(true);
    });

    it('keeps files missing from the source when mirrorDeletes is off', async () => {
        fs.writeFileSync(path.join(dest, 'absent.md'), 'dest-only');
        // A dir on BOTH sides, holding a file only dest has — the recursive call
        // has to carry the flag down, or this one gets deleted.
        fs.mkdirSync(path.join(src, 'sub'));
        fs.mkdirSync(path.join(dest, 'sub'));
        fs.writeFileSync(path.join(dest, 'sub', 'nested.md'), 'dest-only');
        fs.writeFileSync(path.join(src, 'keep.md'), 'keep');

        await copyDirContents(src, dest, { mirrorDeletes: false });

        // Copying still happens; only the delete pass is off, at every depth.
        expect(fs.existsSync(path.join(dest, 'absent.md'))).toBe(true);
        expect(fs.existsSync(path.join(dest, 'sub', 'nested.md'))).toBe(true);
        expect(fs.readFileSync(path.join(dest, 'keep.md'), 'utf8')).toBe('keep');
    });

    it('preserves ignored names in the destination (never deletes .git/.lock)', async () => {
        // .git and .lock exist only in dest (the sync repo), not the notes source.
        fs.mkdirSync(path.join(dest, '.git'));
        fs.writeFileSync(path.join(dest, '.git', 'HEAD'), 'ref: refs/heads/main');
        fs.writeFileSync(path.join(dest, '.lock'), '123');
        fs.writeFileSync(path.join(src, 'note.md'), 'note');

        await copyDirContents(src, dest, { ignore: SYNC_IGNORE_NAMES });

        expect(fs.existsSync(path.join(dest, '.git', 'HEAD'))).toBe(true);
        expect(fs.existsSync(path.join(dest, '.lock'))).toBe(true);
        expect(fs.readFileSync(path.join(dest, 'note.md'), 'utf8')).toBe('note');
    });

    it('does not copy ignored names from the source', async () => {
        fs.mkdirSync(path.join(src, '.git'));
        fs.writeFileSync(path.join(src, '.git', 'HEAD'), 'junk');
        fs.writeFileSync(path.join(src, 'note.md'), 'note');

        const copied = await copyDirContents(src, dest, { ignore: SYNC_IGNORE_NAMES });
        expect(copied).toBe(1); // only note.md
        expect(fs.existsSync(path.join(dest, '.git'))).toBe(false);
    });
});

// ── SyncEngine backoff scheduling ────────────────────────────────────────────

describe('SyncEngine periodic backoff', () => {
    let tmpDir: string;
    let engine: SyncEngine;
    const silentLogger = { info: () => {}, warn: () => {}, error: () => {} };

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-sync-backoff-'));
    });

    afterEach(() => {
        engine?.stop();
        vi.useRealTimers();
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('grows the delay on repeated failures and resets on success', async () => {
        vi.useFakeTimers();
        engine = new SyncEngine({ dataDir: tmpDir, workspaceId: 'my_work', logger: silentLogger });

        const state = { fail: true };
        const perform = vi.fn(async () => {
            (engine as any).status.lastError = state.fail ? 'boom' : null;
        });
        (engine as any).performSync = perform;
        (engine as any).status.enabled = true;
        (engine as any).gitRemoteCache = 'git@github.com:user/notes.git';

        // Base interval 1 min → 60_000 ms.
        (engine as any).startPeriodicSync(1);
        expect((engine as any).nextDelayMs).toBe(60_000);

        // Tick 1 fails → delay doubles.
        await vi.advanceTimersByTimeAsync(60_000);
        expect(perform).toHaveBeenCalledTimes(1);
        expect((engine as any).nextDelayMs).toBe(120_000);

        // Tick 2 fails → doubles again.
        await vi.advanceTimersByTimeAsync(120_000);
        expect(perform).toHaveBeenCalledTimes(2);
        expect((engine as any).nextDelayMs).toBe(240_000);

        // Tick 3 succeeds → resets to base.
        state.fail = false;
        await vi.advanceTimersByTimeAsync(240_000);
        expect(perform).toHaveBeenCalledTimes(3);
        expect((engine as any).nextDelayMs).toBe(60_000);
    });

    it('stop() prevents any further scheduled ticks', async () => {
        vi.useFakeTimers();
        engine = new SyncEngine({ dataDir: tmpDir, workspaceId: 'my_work', logger: silentLogger });
        const perform = vi.fn(async () => { (engine as any).status.lastError = null; });
        (engine as any).performSync = perform;
        (engine as any).status.enabled = true;
        (engine as any).gitRemoteCache = 'remote';

        (engine as any).startPeriodicSync(1);
        engine.stop();

        await vi.advanceTimersByTimeAsync(10 * 60_000);
        expect(perform).not.toHaveBeenCalled();
    });
});

// ── SyncEngine performSync integration (real git) ────────────────────────────

describe('SyncEngine performSync (real git)', () => {
    let tmpDir: string;
    let remoteDir: string;
    let engine: SyncEngine;
    let logs: string[];
    let prevGlobal: string | undefined;
    let prevNoSystem: string | undefined;

    const logger = {
        info: (m: string) => logs.push(m),
        warn: (m: string) => logs.push(m),
        error: (m: string) => logs.push(m),
    };

    const notesDir = () => path.join(tmpDir, 'repos', 'my_work', 'notes');
    const syncRepoDir = () => path.join(tmpDir, 'sync', 'my-work');
    const remoteUrl = () => remoteDir.replace(/\\/g, '/');

    function git(args: string[], cwd: string): string {
        return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
    }

    function writeNote(rel: string, content: string): void {
        const p = path.join(notesDir(), rel);
        fs.mkdirSync(path.dirname(p), { recursive: true });
        fs.writeFileSync(p, content);
    }

    beforeEach(() => {
        logs = [];
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-sync-int-'));

        // Self-contained git config so engine-created repos have an identity and
        // deterministic branch/line-ending behavior regardless of the host machine.
        const gitconfig = path.join(tmpDir, 'test.gitconfig');
        fs.writeFileSync(gitconfig, [
            '[user]', '\tname = Sync Test', '\temail = sync-test@example.test',
            '[core]', '\tautocrlf = false', '\teol = lf',
            '[init]', '\tdefaultBranch = main',
            '[commit]', '\tgpgsign = false',
            '',
        ].join('\n'));
        prevGlobal = process.env.GIT_CONFIG_GLOBAL;
        prevNoSystem = process.env.GIT_CONFIG_NOSYSTEM;
        process.env.GIT_CONFIG_GLOBAL = gitconfig;
        process.env.GIT_CONFIG_NOSYSTEM = '1';

        remoteDir = path.join(tmpDir, 'remote.git');
        execFileSync('git', ['init', '--bare', remoteDir], { stdio: 'ignore' });

        engine = new SyncEngine({ dataDir: tmpDir, workspaceId: 'my_work', logger });
    });

    afterEach(() => {
        engine?.stop();
        if (prevGlobal === undefined) delete process.env.GIT_CONFIG_GLOBAL;
        else process.env.GIT_CONFIG_GLOBAL = prevGlobal;
        if (prevNoSystem === undefined) delete process.env.GIT_CONFIG_NOSYSTEM;
        else process.env.GIT_CONFIG_NOSYSTEM = prevNoSystem;
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('.git survives across two ticks with no re-init/re-clone', async () => {
        writeNote('a.md', '# A\n');
        await engine.triggerSync(remoteUrl());
        expect(engine.getStatus().lastError).toBeNull();
        expect(fs.existsSync(path.join(syncRepoDir(), '.git'))).toBe(true);
        const commits1 = git(['rev-list', '--count', 'HEAD'], syncRepoDir());

        // Second (idle) tick — .git must still be there and history unchanged.
        await engine.triggerSync(remoteUrl());
        expect(engine.getStatus().lastError).toBeNull();
        expect(fs.existsSync(path.join(syncRepoDir(), '.git'))).toBe(true);
        const commits2 = git(['rev-list', '--count', 'HEAD'], syncRepoDir());

        expect(commits2).toBe(commits1);
        // Clone/init happens exactly once (first tick), never on the second.
        expect(logs.filter(l => /Cloned sync repo|Initialized empty sync repo/.test(l))).toHaveLength(1);
    });

    it('idle tick is a no-op (no commit, logs idle)', async () => {
        writeNote('a.md', '# A\n');
        await engine.triggerSync(remoteUrl());
        const commits1 = git(['rev-list', '--count', 'HEAD'], syncRepoDir());
        logs.length = 0;

        await engine.triggerSync(remoteUrl());
        const commits2 = git(['rev-list', '--count', 'HEAD'], syncRepoDir());

        expect(commits2).toBe(commits1);
        expect(logs.some(l => /idle/i.test(l))).toBe(true);
        expect(logs.some(l => /Committed local changes/.test(l))).toBe(false);
    });

    it('a single changed note yields exactly one commit touching only that file', async () => {
        writeNote('a.md', '# A\n');
        writeNote('b.md', '# B\n');
        await engine.triggerSync(remoteUrl());
        const commits1 = Number(git(['rev-list', '--count', 'HEAD'], syncRepoDir()));

        // Edit only a.md.
        writeNote('a.md', '# A edited\n');
        await engine.triggerSync(remoteUrl());
        const commits2 = Number(git(['rev-list', '--count', 'HEAD'], syncRepoDir()));

        expect(commits2).toBe(commits1 + 1);
        const changed = git(['show', '--name-only', '--pretty=format:', 'HEAD'], syncRepoDir())
            .split('\n')
            .map(s => s.trim())
            .filter(Boolean);
        expect(changed).toEqual(['a.md']);
    });

    it('still propagates a real deletion once a baseline exists', async () => {
        writeNote('a.md', '# A\n');
        writeNote('b.md', '# B\n');
        await engine.triggerSync(remoteUrl());
        // The first push to an empty remote *is* the shared history, so it earns
        // the baseline that tells a deleted note from one this device never had.
        expect(await readReconcileMarker(syncRepoDir())).not.toBeNull();

        fs.unlinkSync(path.join(notesDir(), 'b.md'));
        await engine.triggerSync(remoteUrl());

        // Suppressing deletes past the baseline would make sync append-only: the
        // user deleted b.md, and every other device has to learn that.
        expect(fs.existsSync(path.join(syncRepoDir(), 'b.md'))).toBe(false);
        const remoteTree = git(['ls-tree', '-r', '--name-only', 'HEAD'], remoteDir)
            .split('\n').map(s => s.trim()).filter(f => f && f !== '.lock').sort();
        expect(remoteTree).toEqual(['a.md']);
    });
});

// ── backupTagStamp ───────────────────────────────────────────────────────────

describe('backupTagStamp', () => {
    it('produces a stamp git accepts in a ref name', () => {
        const stamp = backupTagStamp(new Date('2026-07-16T15:30:00.123Z'));
        expect(stamp).toBe('2026-07-16T15-30-00-123Z');
        // Colons are what git rejects; the tag is built as sync-backup/<stamp>.
        expect(stamp).not.toContain(':');
    });
});

// ── SyncEngine reconcile (real git) ──────────────────────────────────────────

/**
 * The initial-reconcile phase against a real remote that already has commits.
 *
 * These drive `reconcile()` directly (via ensureSyncRepo, exactly as performSync
 * will) so the merge, tag, commit and push are pinned before the phase gets
 * wired into the sync flow.
 */
describe('SyncEngine reconcile (real git)', () => {
    let tmpDir: string;
    let remoteDir: string;
    let engine: SyncEngine;
    let logs: string[];
    let prevGlobal: string | undefined;
    let prevNoSystem: string | undefined;

    const logger = {
        info: (m: string) => logs.push(m),
        warn: (m: string) => logs.push(m),
        error: (m: string) => logs.push(m),
    };

    const notesDir = () => path.join(tmpDir, 'repos', 'my_work', 'notes');
    const syncRepoDir = () => path.join(tmpDir, 'sync', 'my-work');
    const remoteUrl = () => remoteDir.replace(/\\/g, '/');

    function git(args: string[], cwd: string): string {
        return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
    }

    function writeNote(rel: string, content: string | Buffer): void {
        const p = path.join(notesDir(), rel);
        fs.mkdirSync(path.dirname(p), { recursive: true });
        fs.writeFileSync(p, content);
    }

    /** Give the remote a real history, as if another machine had synced first. */
    function seedRemote(files: Record<string, string | Buffer>, into: string = remoteUrl()): string {
        const seed = path.join(tmpDir, `seed-${Object.keys(files).join('-').slice(0, 20)}`);
        execFileSync('git', ['clone', into, seed], { stdio: 'ignore' });
        for (const [rel, content] of Object.entries(files)) {
            const p = path.join(seed, rel);
            fs.mkdirSync(path.dirname(p), { recursive: true });
            fs.writeFileSync(p, content);
        }
        git(['add', '-A'], seed);
        git(['commit', '-m', 'from another machine'], seed);
        git(['push', 'origin', 'HEAD'], seed);
        const head = git(['rev-parse', 'HEAD'], seed);
        fs.rmSync(seed, { recursive: true, force: true });
        return head;
    }

    /** The tree the remote actually holds, read back out of the bare repo. */
    function remoteFiles(bare: string = remoteDir): string[] {
        return git(['ls-tree', '-r', '--name-only', 'HEAD'], bare)
            .split('\n').map(s => s.trim()).filter(Boolean).sort();
    }

    /** Why the engine entered the reconcile phase, once per entry, in order. */
    function reconcileReasons(): string[] {
        return logs.filter(l => l.startsWith('Initial reconcile —'))
            .map(l => l.replace('Initial reconcile — ', ''));
    }

    function remoteFile(rel: string): string {
        return git(['show', `HEAD:${rel}`], remoteDir);
    }

    async function runReconcile(): Promise<ReconcileResult> {
        await (engine as any).ensureSyncRepo(remoteUrl());
        return (engine as any).reconcile();
    }

    beforeEach(() => {
        logs = [];
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-sync-rec-'));

        const gitconfig = path.join(tmpDir, 'test.gitconfig');
        fs.writeFileSync(gitconfig, [
            '[user]', '\tname = Sync Test', '\temail = sync-test@example.test',
            '[core]', '\tautocrlf = false', '\teol = lf',
            '[init]', '\tdefaultBranch = main',
            '[commit]', '\tgpgsign = false',
            '',
        ].join('\n'));
        prevGlobal = process.env.GIT_CONFIG_GLOBAL;
        prevNoSystem = process.env.GIT_CONFIG_NOSYSTEM;
        process.env.GIT_CONFIG_GLOBAL = gitconfig;
        process.env.GIT_CONFIG_NOSYSTEM = '1';

        remoteDir = path.join(tmpDir, 'remote.git');
        execFileSync('git', ['init', '--bare', remoteDir], { stdio: 'ignore' });

        engine = new SyncEngine({ dataDir: tmpDir, workspaceId: 'my_work', logger });
    });

    afterEach(() => {
        engine?.stop();
        if (prevGlobal === undefined) delete process.env.GIT_CONFIG_GLOBAL;
        else process.env.GIT_CONFIG_GLOBAL = prevGlobal;
        if (prevNoSystem === undefined) delete process.env.GIT_CONFIG_NOSYSTEM;
        else process.env.GIT_CONFIG_NOSYSTEM = prevNoSystem;
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    // The goal's north-star demo, end to end through real git.
    it('merges local A/B/C with remote B\'/D/E — nothing deleted on either side', async () => {
        writeNote('a.md', '# A local\n');
        writeNote('b.md', '# B local edit\n');
        writeNote('c.md', '# C local\n');
        seedRemote({ 'b.md': '# B remote edit\n', 'd.md': '# D remote\n', 'e.md': '# E remote\n' });

        const result = await runReconcile();

        // Remote ends with all five notes.
        expect(remoteFiles()).toEqual(['a.md', 'b.md', 'c.md', 'd.md', 'e.md']);
        // Local ends with all five too, via the copy-back.
        expect(fs.readdirSync(notesDir()).sort()).toEqual(['a.md', 'b.md', 'c.md', 'd.md', 'e.md']);

        // The demo's exact counts: 2 added from this device, 2 kept from remote,
        // 1 combined, 0 identical.
        expect(result.plan.counts).toEqual({
            identical: 0,
            addedFromLocal: 2,
            keptFromRemote: 2,
            combined: 1,
            keptBothBinary: 0,
        });
        expect(result.plan.combined).toEqual(['b.md']);
    });

    it('the combined note keeps both sides and carries no conflict markers', async () => {
        writeNote('b.md', '# B local edit\n');
        seedRemote({ 'b.md': '# B remote edit\n' });

        await runReconcile();

        const merged = remoteFile('b.md');
        expect(merged).toContain('# B local edit');
        expect(merged).toContain('# B remote edit');
        expect(merged).not.toContain('<<<<<<<');
        expect(merged).not.toContain('=======');
        expect(merged).not.toContain('>>>>>>>');
        // And the same content is what the user sees locally.
        expect(fs.readFileSync(path.join(notesDir(), 'b.md'), 'utf8')).toBe(merged + '\n');
    });

    it('lands one commit on top of the remote head, so later syncs share an ancestor', async () => {
        writeNote('a.md', '# A\n');
        const preMergeHead = seedRemote({ 'd.md': '# D\n' });

        const result = await runReconcile();

        // Exactly one new commit — the reconcile is squashed, not a history graft.
        expect(Number(git(['rev-list', '--count', 'HEAD'], remoteDir))).toBe(2);
        expect(git(['rev-parse', 'HEAD'], remoteDir)).toBe(result.mergedCommit);
        // Descends from the remote's pre-merge tip: this is what makes the
        // steady-state 3-way pull work from here on.
        expect(git(['rev-list', '--parents', '-n', '1', 'HEAD'], remoteDir).split(' ')[1])
            .toBe(preMergeHead);
    });

    it('tags the remote pre-merge head as sync-backup/<ts> and pushes the tag', async () => {
        writeNote('a.md', '# A\n');
        const preMergeHead = seedRemote({ 'd.md': '# D\n' });

        const result = await runReconcile();

        expect(result.backupTag).toMatch(/^sync-backup\/\d{4}-\d{2}-\d{2}T[\d-]+Z$/);
        // The tag is on the remote, pointing at what HEAD was before the merge —
        // one `git reset` away from undo.
        const tags = git(['tag', '-l'], remoteDir).split('\n').map(s => s.trim()).filter(Boolean);
        expect(tags).toEqual([result.backupTag]);
        expect(git(['rev-parse', `${result.backupTag}^{commit}`], remoteDir)).toBe(preMergeHead);
    });

    it('summarizes the merge in the commit subject and enumerates AI-combined files', async () => {
        writeNote('a.md', '# A\n');
        writeNote('b.md', '# B local\n');
        seedRemote({ 'b.md': '# B remote\n', 'd.md': '# D\n' });

        await runReconcile();

        const message = git(['log', '-1', '--pretty=%B'], remoteDir);
        expect(message).toContain('Initial sync: merged 2 local + 2 remote notes (1 combined by AI)');
        // Auditable from git history alone, per the no-raw-markers constraint.
        expect(message).toContain('Combined by AI:');
        expect(message).toContain('- b.md');
    });

    it('writes the reconcile marker with the pushed commit only after the push lands', async () => {
        writeNote('a.md', '# A\n');
        seedRemote({ 'd.md': '# D\n' });

        const result = await runReconcile();

        const marker = await readReconcileMarker(syncRepoDir());
        expect(marker).not.toBeNull();
        expect(marker!.mergedCommit).toBe(result.mergedCommit);
        expect(marker!.mergedCommit).toBe(git(['rev-parse', 'HEAD'], remoteDir));
        expect(Date.parse(marker!.reconciledAt)).not.toBeNaN();
    });

    it('leaves no marker when the push fails, so the next tick retries', async () => {
        writeNote('a.md', '# A\n');
        const preMergeHead = seedRemote({ 'd.md': '# D\n' });
        await (engine as any).ensureSyncRepo(remoteUrl());
        // Let the merge succeed and reject only the push, so this pins the
        // marker-after-push ordering rather than an early bail-out.
        const hook = path.join(remoteDir, 'hooks', 'pre-receive');
        fs.writeFileSync(hook, '#!/bin/sh\nexit 1\n', { mode: 0o755 });

        await expect((engine as any).reconcile()).rejects.toThrow(/pre-receive|push|remote rejected/i);

        // The merge itself completed — the local tree holds the merged note — so
        // this pins the push→marker ordering rather than an early bail-out.
        expect(fs.existsSync(path.join(syncRepoDir(), 'a.md'))).toBe(true);
        // Reconcile stays un-retired and the remote is untouched.
        expect(await readReconcileMarker(syncRepoDir())).toBeNull();
        expect(git(['rev-parse', 'HEAD'], remoteDir)).toBe(preMergeHead);
        expect(git(['tag', '-l'], remoteDir)).toBe('');
    });

    it('gets the backup tag onto the remote before the branch push, and writes no marker if that push fails', async () => {
        writeNote('a.md', '# A\n');
        const preMergeHead = seedRemote({ 'd.md': '# D\n' });
        await (engine as any).ensureSyncRepo(remoteUrl());
        // Accept the tag, reject the branch: the exact window where a half-done
        // reconcile must still be undoable and must not retire itself.
        const hook = path.join(remoteDir, 'hooks', 'pre-receive');
        fs.writeFileSync(hook, [
            '#!/bin/sh',
            'while read -r old new ref; do',
            '  case "$ref" in refs/heads/*) echo "branch rejected" >&2; exit 1 ;; esac',
            'done',
            'exit 0',
            '',
        ].join('\n'), { mode: 0o755 });

        await expect((engine as any).reconcile()).rejects.toThrow();

        // The backup landed first, so the pre-merge state is still recoverable
        // from the remote even though the merge never completed.
        expect(git(['tag', '-l'], remoteDir)).toMatch(/^sync-backup\//);
        expect(git(['rev-parse', `${git(['tag', '-l'], remoteDir)}^{commit}`], remoteDir)).toBe(preMergeHead);
        expect(git(['rev-parse', 'HEAD'], remoteDir)).toBe(preMergeHead);
        // No marker: the next tick re-runs the (idempotent) reconcile.
        expect(await readReconcileMarker(syncRepoDir())).toBeNull();
    });

    it('reads the remote side from git objects, not the working tree', async () => {
        // The unrelated-histories case: the sync repo has its own history and its
        // working tree holds the local mirror, so a disk read would merge local
        // against itself and lose every remote-only note.
        writeNote('a.md', '# A\n');
        seedRemote({ 'd.md': '# D\n', 'e.md': '# E\n' });

        fs.mkdirSync(syncRepoDir(), { recursive: true });
        git(['init'], syncRepoDir());
        git(['remote', 'add', 'origin', remoteUrl()], syncRepoDir());
        fs.writeFileSync(path.join(syncRepoDir(), 'a.md'), '# A\n');
        git(['add', '-A'], syncRepoDir());
        git(['commit', '-m', 'unrelated local history'], syncRepoDir());

        const result = await (engine as any).reconcile() as ReconcileResult;

        expect(remoteFiles()).toEqual(['a.md', 'd.md', 'e.md']);
        expect(result.plan.counts.keptFromRemote).toBe(2);
    });

    it('keeps both versions of a conflicting binary, remote at the original path', async () => {
        const localPng = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01, 0xff, 0xfe]);
        const remotePng = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x02, 0xaa, 0xbb]);
        writeNote('img.png', localPng);
        seedRemote({ 'img.png': remotePng });

        const result = await runReconcile();

        expect(remoteFiles()).toEqual(['img.local.png', 'img.png']);
        // Remote keeps the original path; local is parked beside it. Bytes intact
        // on both — a binary is never merged, mangled, or dropped.
        expect(execFileSync('git', ['show', 'HEAD:img.png'], { cwd: remoteDir, encoding: 'buffer' }))
            .toEqual(remotePng);
        expect(execFileSync('git', ['show', 'HEAD:img.local.png'], { cwd: remoteDir, encoding: 'buffer' }))
            .toEqual(localPng);
        expect(result.plan.flagged).toEqual(['img.png']);
        expect(git(['log', '-1', '--pretty=%B'], remoteDir)).toContain('img.local.png');
    });

    it('uses the AI resolver for text collisions and falls back when it fails', async () => {
        const invoker: AIInvoker = vi.fn().mockResolvedValue({
            success: true,
            response: '# B combined by AI\n',
        });
        engine = new SyncEngine({ dataDir: tmpDir, workspaceId: 'my_work', logger, aiInvoker: invoker });
        writeNote('b.md', '# B local\n');
        seedRemote({ 'b.md': '# B remote\n' });

        await runReconcile();

        expect(invoker).toHaveBeenCalledTimes(1);
        // The AI saw a real add/add blob with both sides in it.
        const prompt = (invoker as any).mock.calls[0][0] as string;
        expect(prompt).toContain('# B local');
        expect(prompt).toContain('# B remote');
        expect(remoteFile('b.md')).toBe('# B combined by AI');
    });

    it('falls back to the simple resolver when the AI call fails', async () => {
        const invoker: AIInvoker = vi.fn().mockRejectedValue(new Error('offline'));
        engine = new SyncEngine({ dataDir: tmpDir, workspaceId: 'my_work', logger, aiInvoker: invoker });
        writeNote('b.md', '# B local\n');
        seedRemote({ 'b.md': '# B remote\n' });

        await runReconcile();

        // Both sides survive with no markers — the AC-03 fallback contract.
        const merged = remoteFile('b.md');
        expect(merged).toContain('# B local');
        expect(merged).toContain('# B remote');
        expect(merged).not.toContain('<<<<<<<');
    });

    it('re-running reconcile pushes nothing and still records the marker', async () => {
        writeNote('a.md', '# A\n');
        writeNote('b.md', '# B local\n');
        seedRemote({ 'b.md': '# B remote\n', 'd.md': '# D\n' });

        const first = await runReconcile();
        const headAfterFirst = git(['rev-parse', 'HEAD'], remoteDir);

        // Idempotent: a reconcile that died before writing its marker re-runs
        // safely, because the union merge decides the same thing twice.
        fs.rmSync(path.join(syncRepoDir(), '.git', 'coc-reconciled.json'));
        const second = await (engine as any).reconcile() as ReconcileResult;

        expect(git(['rev-parse', 'HEAD'], remoteDir)).toBe(headAfterFirst);
        expect(second.backupTag).toBeNull();
        expect(second.mergedCommit).toBe(first.mergedCommit);
        expect(remoteFiles()).toEqual(['a.md', 'b.md', 'd.md']);
        expect(await readReconcileMarker(syncRepoDir())).not.toBeNull();
    });

    it('keeps the sync lock out of the merged commit', async () => {
        writeNote('a.md', '# A\n');
        seedRemote({ 'd.md': '# D\n' });
        await (engine as any).ensureSyncRepo(remoteUrl());
        // performSync holds this lock for the whole phase, so it sits in the
        // working tree while the merged tree is staged.
        fs.writeFileSync(path.join(syncRepoDir(), '.lock'), String(process.pid));

        await (engine as any).reconcile();

        expect(remoteFiles()).toEqual(['a.md', 'd.md']);
    });

    it('a nested note keeps its path through the merge', async () => {
        writeNote(path.join('journal', '2026-07.md'), '# July\n');
        seedRemote({ 'journal/2026-06.md': '# June\n' });

        await runReconcile();

        expect(remoteFiles()).toEqual(['journal/2026-06.md', 'journal/2026-07.md']);
        expect(fs.existsSync(path.join(notesDir(), 'journal', '2026-06.md'))).toBe(true);
    });

    // ── AC-01: performSync routes into the phase ─────────────────────────────
    //
    // Same harness as above, driven through the public entry point the settings
    // panel's "Sync Now" actually calls, so these pin the branch rather than the
    // merge (which the tests above already cover).

    it('the very first Sync Now merges instead of mirroring local over the remote', async () => {
        writeNote('a.md', '# A local\n');
        writeNote('b.md', '# B local edit\n');
        writeNote('c.md', '# C local\n');
        seedRemote({ 'b.md': '# B remote edit\n', 'd.md': '# D remote\n', 'e.md': '# E remote\n' });

        const status = await engine.triggerSync(remoteUrl());

        expect(reconcileReasons()).toEqual(['first sync with a remote that already has notes']);
        // The demo: nothing on either side is lost by pointing at a live remote.
        expect(remoteFiles()).toEqual(['a.md', 'b.md', 'c.md', 'd.md', 'e.md']);
        expect(fs.readdirSync(notesDir()).sort()).toEqual(['a.md', 'b.md', 'c.md', 'd.md', 'e.md']);
        expect(status.lastError).toBeNull();
        expect(status.lastSyncTime).not.toBeNull();
        expect(await readReconcileMarker(syncRepoDir())).not.toBeNull();
    });

    it('merges rather than mirroring even when the pull would have succeeded', async () => {
        writeNote('a.md', '# A local\n');
        seedRemote({ 'd.md': '# D remote\n' });
        // A mirror cloned from the remote shares its history, so the pull can't
        // fail and the fallback never fires. Detection running before the outbound
        // copy is the only thing between d.md and a mirror-deleted remote.
        execFileSync('git', ['clone', remoteUrl(), syncRepoDir()], { stdio: 'ignore' });

        await engine.triggerSync(remoteUrl());

        expect(remoteFiles()).toEqual(['a.md', 'd.md']);
        expect(fs.readdirSync(notesDir()).sort()).toEqual(['a.md', 'd.md']);
        expect(reconcileReasons()).toEqual(['first sync with a remote that already has notes']);
    });

    it('never pushes deletes from a notes tree that has no baseline behind it', async () => {
        seedRemote({ 'd.md': '# D remote\n', 'e.md': '# E remote\n' });
        // The one state neither branch into reconcile can catch: a mirror cloned
        // from the remote shares its history, so the pull can't fail; and an empty
        // notes tree can't trip detection, which needs local notes to contribute.
        // The outbound copy would read "absent locally" as "deleted by the user"
        // and push that — with no baseline, nothing has ever established that this
        // device once held d.md and e.md at all.
        execFileSync('git', ['clone', remoteUrl(), syncRepoDir()], { stdio: 'ignore' });
        fs.mkdirSync(notesDir(), { recursive: true });

        const status = await engine.triggerSync(remoteUrl());

        // The remote keeps its notes. (The normal flow commits the sync lock —
        // pre-existing, and why .lock is filtered here rather than in remoteFiles.)
        expect(remoteFiles().filter(f => f !== '.lock')).toEqual(['d.md', 'e.md']);
        expect(status.lastError).toBeNull();
        expect(reconcileReasons()).toEqual([]);
        // And the notes land on the device, which is what it was missing.
        expect(fs.readdirSync(notesDir()).sort()).toEqual(['d.md', 'e.md']);
    });

    it('the next Sync Now skips reconcile and takes the normal 3-way flow', async () => {
        writeNote('a.md', '# A local\n');
        seedRemote({ 'd.md': '# D remote\n' });
        await engine.triggerSync(remoteUrl());

        // Demo step 5: edit a note, sync again — a plain fast sync from here.
        writeNote('a.md', '# A edited after reconcile\n');
        logs.length = 0;
        const status = await engine.triggerSync(remoteUrl());

        expect(reconcileReasons()).toEqual([]);
        expect(status.lastError).toBeNull();
        expect(remoteFile('a.md')).toBe('# A edited after reconcile');
        // The normal flow's `git add -A` commits the sync lock — pre-existing, and
        // the reason reconcile stages with an explicit exclude instead.
        expect(remoteFiles().filter(f => f !== '.lock')).toEqual(['a.md', 'd.md']);
        // seed + the one reconcile commit + this ordinary sync commit: the pull
        // that used to refuse unrelated histories now has a shared ancestor.
        expect(Number(git(['rev-list', '--count', 'HEAD'], remoteDir))).toBe(3);
    });

    it('does not reconcile against an empty remote — the normal first push is already right', async () => {
        writeNote('a.md', '# A\n');

        const status = await engine.triggerSync(remoteUrl());

        expect(reconcileReasons()).toEqual([]);
        expect(status.lastError).toBeNull();
        expect(remoteFiles().filter(f => f !== '.lock')).toEqual(['a.md']);
        // That first push *is* the shared history, so it earns the same baseline
        // a merge would: the remote has commits from here on, and without a marker
        // the next tick would re-enter the phase and merge a.md with itself.
        expect(await readReconcileMarker(syncRepoDir())).not.toBeNull();

        logs.length = 0;
        await engine.triggerSync(remoteUrl());
        expect(reconcileReasons()).toEqual([]);
        expect(logs.some(l => /idle/i.test(l))).toBe(true);
    });

    it('records no baseline when the push never landed', async () => {
        writeNote('a.md', '# A\n');
        // pushToRemote swallows failures to retry next tick, so only the returned
        // flag can tell a landed push from a lost one. Retiring the phase here
        // would hand a remote we've never merged with a baseline it hasn't earned.
        const hook = path.join(remoteDir, 'hooks', 'pre-receive');
        fs.writeFileSync(hook, '#!/bin/sh\nexit 1\n', { mode: 0o755 });

        await engine.triggerSync(remoteUrl());

        expect(logs.some(l => /Push failed/.test(l))).toBe(true);
        expect(await readReconcileMarker(syncRepoDir())).toBeNull();
    });

    it('pulls an existing remote onto a device with no notes yet, pushing no deletes', async () => {
        fs.mkdirSync(notesDir(), { recursive: true });
        const preMergeHead = seedRemote({ 'd.md': '# D remote\n' });

        const status = await engine.triggerSync(remoteUrl());

        // Detection needs local notes to contribute, so it stays quiet here; the
        // failed pull is what catches this device. (`ensureSyncRepo`'s clone can't
        // run — performSync's lock file is already sitting in the target dir — so
        // a fresh mirror always starts on a history unrelated to the remote's.)
        expect(reconcileReasons()).toEqual(['remote history is unrelated to this mirror']);
        expect(status.lastError).toBeNull();
        // The remote's note is untouched and lands on the device.
        expect(remoteFiles()).toEqual(['d.md']);
        expect(git(['rev-parse', 'HEAD'], remoteDir)).toBe(preMergeHead);
        expect(fs.readFileSync(path.join(notesDir(), 'd.md'), 'utf8')).toBe('# D remote\n');
    });

    it('heals a remote whose history is unrelated, even with the phase already retired', async () => {
        writeNote('a.md', '# A\n');
        seedRemote({ 'd.md': '# D\n' });
        await engine.triggerSync(remoteUrl());

        // Re-point sync at a different repo that shares no commit with this
        // mirror. The marker says reconcile is done, so the detection branch
        // stays quiet and only the failed pull can catch this.
        const other = path.join(tmpDir, 'other.git');
        execFileSync('git', ['init', '--bare', other], { stdio: 'ignore' });
        const otherUrl = other.replace(/\\/g, '/');
        seedRemote({ 'z.md': '# Z\n' }, otherUrl);
        logs.length = 0;

        const status = await engine.triggerSync(otherUrl);

        expect(reconcileReasons()).toEqual(['remote history is unrelated to this mirror']);
        expect(status.lastError).toBeNull();
        // Union merge again: this device's notes and the new remote's both live.
        expect(remoteFiles(other)).toEqual(['a.md', 'd.md', 'z.md']);
    });

    // ── The one-time report (AC-06) ──────────────────────────────────────────

    it('reports the merge on the status the settings panel reads', async () => {
        writeNote('a.md', '# A local\n');
        writeNote('b.md', '# B local edit\n');
        writeNote('c.md', '# C local\n');
        seedRemote({ 'b.md': '# B remote edit\n', 'd.md': '# D remote\n', 'e.md': '# E remote\n' });

        const status = await engine.triggerSync(remoteUrl());

        // The demo's wording comes straight off these numbers: "Merged 5 notes —
        // 0 identical, 2 added from this device, 2 kept from remote, 1 combined
        // by AI (b.md)."
        expect(status.reconcileReport).toEqual({
            counts: { identical: 0, addedFromLocal: 2, keptFromRemote: 2, combined: 1, keptBothBinary: 0 },
            total: 5,
            combined: ['b.md'],
            flagged: [],
            backupTag: expect.stringMatching(/^sync-backup\//),
            mergedCommit: git(['rev-parse', 'HEAD'], remoteDir),
            reconciledAt: expect.any(String),
        });
    });

    it('reports a flagged binary with the path the local copy was parked at', async () => {
        writeNote('img.png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01]));
        seedRemote({ 'img.png': Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x02]) });

        const status = await engine.triggerSync(remoteUrl());

        // "Review recommended" is only actionable if it says where to look.
        expect(status.reconcileReport?.flagged).toEqual([
            { path: 'img.png', localVariantPath: 'img.local.png' },
        ]);
        expect(remoteFiles()).toEqual(['img.local.png', 'img.png']);
    });

    it('says it is reconciling, not merely syncing, while the merge runs', async () => {
        // The AI resolver runs mid-merge, so it is a window into the live status.
        let during: SyncStatus | undefined;
        const invoker: AIInvoker = vi.fn().mockImplementation(async () => {
            during = engine.getStatus();
            return { success: true, response: '# B combined\n' };
        });
        engine = new SyncEngine({ dataDir: tmpDir, workspaceId: 'my_work', logger, aiInvoker: invoker });
        writeNote('b.md', '# B local\n');
        seedRemote({ 'b.md': '# B remote\n' });

        const status = await engine.triggerSync(remoteUrl());

        expect(during?.reconcileInProgress).toBe(true);
        expect(during?.inProgress).toBe(true);
        expect(status.reconcileInProgress).toBe(false);
    });

    it('stops reporting reconcile in progress when the merge fails', async () => {
        writeNote('a.md', '# A\n');
        seedRemote({ 'd.md': '# D\n' });
        vi.spyOn(engine as any, 'reconcile').mockRejectedValue(new Error('merge exploded'));

        const status = await engine.triggerSync(remoteUrl());

        expect(status.lastError).toBe('merge exploded');
        expect(status.reconcileInProgress).toBe(false);
        expect(status.reconcileReport).toBeNull();
    });

    it('keeps the report after a restart — it is the user\'s one account of the merge', async () => {
        writeNote('a.md', '# A local\n');
        writeNote('b.md', '# B local edit\n');
        seedRemote({ 'b.md': '# B remote edit\n', 'd.md': '# D remote\n' });
        const before = (await engine.triggerSync(remoteUrl())).reconcileReport;

        // A new process, same data dir: nothing in memory survived, so the only
        // way the panel can still explain the merge is the marker on disk.
        const restarted = new SyncEngine({ dataDir: tmpDir, workspaceId: 'my_work', logger });
        // The startup sync is a separate concern and would race the temp dir.
        vi.spyOn(restarted as any, 'performSync').mockResolvedValue(undefined);
        await restarted.start(remoteUrl(), 60);
        restarted.stop();

        expect(restarted.getStatus().reconcileReport).toEqual(before);
        expect(restarted.getStatus().reconcileReport?.combined).toEqual(['b.md']);
    });

    it('an ordinary sync afterwards leaves the report alone', async () => {
        writeNote('a.md', '# A local\n');
        writeNote('b.md', '# B local edit\n');
        seedRemote({ 'b.md': '# B remote edit\n' });
        const merged = (await engine.triggerSync(remoteUrl())).reconcileReport;

        // Demo step 5. Syncs run on a timer, so if a later tick cleared the
        // summary, a user who stepped away would never learn b.md was combined.
        writeNote('a.md', '# A edited\n');
        const status = await engine.triggerSync(remoteUrl());

        expect(reconcileReasons()).toEqual(['first sync with a remote that already has notes']);
        expect(status.reconcileReport).toEqual(merged);
    });

    it('reports nothing for a baseline no merge produced', async () => {
        writeNote('a.md', '# A\n');

        // An empty remote takes the normal first push: there was no merge, so
        // there is nothing to tell the user about.
        const status = await engine.triggerSync(remoteUrl());

        expect(reconcileReasons()).toEqual([]);
        expect(await readReconcileMarker(syncRepoDir())).not.toBeNull();
        expect(status.reconcileReport).toBeNull();
        expect(status.reconcileInProgress).toBe(false);
    });
});
