/**
 * Sync Engine Tests
 *
 * Tests for the Git-based notes sync engine: config integration,
 * conflict resolution, status tracking, and folder mapping.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { resolveConflictSimple, resolveConflictWithAI, isSyncEnabled, SyncEngine } from '../../src/server/sync/sync-engine';
import type { SyncStatus } from '../../src/server/sync/sync-engine';
import type { AIInvoker } from '@plusplusoneplusplus/forge';
import type { ResolvedCLIConfig } from '../../src/config';
import { DEFAULT_CONFIG } from '../../src/config';

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

// ── isSyncEnabled ────────────────────────────────────────────────────────────

describe('isSyncEnabled', () => {
    it('returns false when gitRemote is empty', () => {
        const config: ResolvedCLIConfig = {
            ...DEFAULT_CONFIG,
            sync: { gitRemote: '', intervalMinutes: 5 },
        };
        expect(isSyncEnabled(config)).toBe(false);
    });

    it('returns true when gitRemote is configured', () => {
        const config: ResolvedCLIConfig = {
            ...DEFAULT_CONFIG,
            sync: { gitRemote: 'git@github.com:user/notes.git', intervalMinutes: 5 },
        };
        expect(isSyncEnabled(config)).toBe(true);
    });

    it('returns false when sync config uses default empty string', () => {
        expect(isSyncEnabled(DEFAULT_CONFIG)).toBe(false);
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

    it('getStatus returns disabled when no gitRemote', () => {
        engine = new SyncEngine({
            dataDir: tmpDir,
            resolvedConfig: DEFAULT_CONFIG,
            logger: silentLogger,
        });

        const status = engine.getStatus();
        expect(status.enabled).toBe(false);
        expect(status.inProgress).toBe(false);
        expect(status.lastSyncTime).toBeNull();
        expect(status.lastError).toBeNull();
    });

    it('getStatus returns enabled when gitRemote is set', () => {
        const config: ResolvedCLIConfig = {
            ...DEFAULT_CONFIG,
            sync: { gitRemote: 'git@github.com:user/notes.git', intervalMinutes: 5 },
        };
        engine = new SyncEngine({
            dataDir: tmpDir,
            resolvedConfig: config,
            logger: silentLogger,
        });

        expect(engine.getStatus().enabled).toBe(true);
    });

    it('updateConfig transitions enabled state', () => {
        engine = new SyncEngine({
            dataDir: tmpDir,
            resolvedConfig: DEFAULT_CONFIG,
            logger: silentLogger,
        });

        expect(engine.getStatus().enabled).toBe(false);

        const enabledConfig: ResolvedCLIConfig = {
            ...DEFAULT_CONFIG,
            sync: { gitRemote: 'git@github.com:user/notes.git', intervalMinutes: 5 },
        };
        engine.updateConfig(enabledConfig);
        expect(engine.getStatus().enabled).toBe(true);

        engine.updateConfig(DEFAULT_CONFIG);
        expect(engine.getStatus().enabled).toBe(false);
    });

    it('start is a no-op when sync is disabled', async () => {
        engine = new SyncEngine({
            dataDir: tmpDir,
            resolvedConfig: DEFAULT_CONFIG,
            logger: silentLogger,
        });

        // Should not throw
        await engine.start(DEFAULT_CONFIG);
        expect(engine.getStatus().enabled).toBe(false);
    });

    it('status shape conforms to SyncStatus interface', () => {
        engine = new SyncEngine({
            dataDir: tmpDir,
            resolvedConfig: DEFAULT_CONFIG,
            logger: silentLogger,
        });

        const status: SyncStatus = engine.getStatus();
        expect(typeof status.inProgress).toBe('boolean');
        expect(typeof status.enabled).toBe('boolean');
        expect(status.lastSyncTime).toBeNull();
        expect(status.lastError).toBeNull();
    });
});

// ── Config defaults ──────────────────────────────────────────────────────────

describe('sync config defaults', () => {
    it('DEFAULT_CONFIG includes sync with empty gitRemote', () => {
        expect(DEFAULT_CONFIG.sync).toBeDefined();
        expect(DEFAULT_CONFIG.sync.gitRemote).toBe('');
        expect(DEFAULT_CONFIG.sync.intervalMinutes).toBe(5);
    });
});
