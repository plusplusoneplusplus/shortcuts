/**
 * NotesGitTimerManager — Unit Tests
 *
 * Tests for workspace-scoped timer management: start, stop, update, startAll, dispose.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { NotesGitTimerManager, DEFAULT_AUTOCOMMIT_INTERVAL_MS } from '../../src/server/notes/git/notes-git-timer-manager';
import { getRepoDataPath } from '@plusplusoneplusplus/forge';
import { writeRepoPreferences } from '../../src/server/preferences-handler';

// ============================================================================
// Tests
// ============================================================================

describe('NotesGitTimerManager', () => {
    let tmpDir: string;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'timer-manager-test-'));
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('startForWorkspace creates and starts a timer', () => {
        const mgr = new NotesGitTimerManager();
        mgr.startForWorkspace('ws1', '/tmp/notes', 60_000);

        const timer = mgr.getTimer('ws1');
        expect(timer).toBeDefined();

        mgr.dispose();
    });

    it('stopForWorkspace removes the timer', () => {
        const mgr = new NotesGitTimerManager();
        mgr.startForWorkspace('ws1', '/tmp/notes', 60_000);
        mgr.stopForWorkspace('ws1');

        expect(mgr.getTimer('ws1')).toBeUndefined();
    });

    it('stopForWorkspace is safe to call on unknown workspace', () => {
        const mgr = new NotesGitTimerManager();
        expect(() => mgr.stopForWorkspace('nonexistent')).not.toThrow();
    });

    it('startForWorkspace replaces existing timer (idempotent restart)', () => {
        const mgr = new NotesGitTimerManager();
        mgr.startForWorkspace('ws1', '/tmp/notes', 60_000);
        const first = mgr.getTimer('ws1');

        mgr.startForWorkspace('ws1', '/tmp/notes', 120_000);
        const second = mgr.getTimer('ws1');

        expect(second).toBeDefined();
        expect(second).not.toBe(first);

        mgr.dispose();
    });

    it('updateInterval replaces timer with new interval', () => {
        const mgr = new NotesGitTimerManager();
        mgr.startForWorkspace('ws1', '/tmp/notes', 60_000);
        const before = mgr.getTimer('ws1');

        mgr.updateInterval('ws1', '/tmp/notes', 300_000);
        const after = mgr.getTimer('ws1');

        expect(after).toBeDefined();
        expect(after).not.toBe(before);

        mgr.dispose();
    });

    it('dispose stops all timers', () => {
        const mgr = new NotesGitTimerManager();
        mgr.startForWorkspace('ws1', '/tmp/notes', 60_000);
        mgr.startForWorkspace('ws2', '/tmp/notes2', 60_000);

        mgr.dispose();

        expect(mgr.getTimer('ws1')).toBeUndefined();
        expect(mgr.getTimer('ws2')).toBeUndefined();
    });

    it('startAll restores timers for workspaces with enabled autocommit', async () => {
        const wsId = 'ws-startall';
        const notesDir = getRepoDataPath(tmpDir, wsId, 'notes');
        fs.mkdirSync(notesDir, { recursive: true });

        writeRepoPreferences(tmpDir, wsId, {
            notesGit: {
                enabled: true,
                autoCommit: { enabled: true, intervalMs: 300_000 },
            },
        });

        const mockStore: any = {
            getWorkspaces: vi.fn().mockResolvedValue([
                { id: wsId, rootPath: '/some/path' },
            ]),
        };

        const mgr = new NotesGitTimerManager();
        await mgr.startAll(mockStore, tmpDir);

        expect(mgr.getTimer(wsId)).toBeDefined();

        mgr.dispose();
    });

    it('startAll skips workspaces without autocommit enabled', async () => {
        const wsId = 'ws-no-autocommit';
        writeRepoPreferences(tmpDir, wsId, {
            notesGit: { enabled: false },
        });

        const mockStore: any = {
            getWorkspaces: vi.fn().mockResolvedValue([
                { id: wsId, rootPath: '/some/path' },
            ]),
        };

        const mgr = new NotesGitTimerManager();
        await mgr.startAll(mockStore, tmpDir);

        expect(mgr.getTimer(wsId)).toBeUndefined();

        mgr.dispose();
    });

    it('startAll uses DEFAULT_AUTOCOMMIT_INTERVAL_MS when intervalMs not set', async () => {
        const wsId = 'ws-default-interval';
        const notesDir = getRepoDataPath(tmpDir, wsId, 'notes');
        fs.mkdirSync(notesDir, { recursive: true });

        writeRepoPreferences(tmpDir, wsId, {
            notesGit: {
                enabled: true,
                autoCommit: { enabled: true },
            },
        });

        const mockStore: any = {
            getWorkspaces: vi.fn().mockResolvedValue([
                { id: wsId, rootPath: '/some/path' },
            ]),
        };

        const mgr = new NotesGitTimerManager();
        await mgr.startAll(mockStore, tmpDir);

        const timer = mgr.getTimer(wsId);
        expect(timer).toBeDefined();
        expect(DEFAULT_AUTOCOMMIT_INTERVAL_MS).toBe(30 * 60 * 1_000);

        mgr.dispose();
    });
});
