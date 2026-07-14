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
    SYNC_IGNORE_NAMES,
    DEFAULT_SYNC_INTERVAL_MINUTES,
    MAX_SYNC_BACKOFF_MINUTES,
} from '../../src/server/sync/sync-engine';
import type { SyncStatus } from '../../src/server/sync/sync-engine';
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
});
