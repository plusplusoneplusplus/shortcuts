/**
 * AC-05 — exited terminals are listed as tombstones and can be respawned.
 *
 * Covers hydration of persisted sessions into the manager's map, the read-only
 * behaviour of a tombstone, and `restartSession()`: new id, carried-over
 * scrollback with a separator, cwd fallback, and the still-running guard.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { IPty } from '../../../src/server/terminal/types';
import {
    TerminalSessionManager,
    TerminalSessionRunningError,
    toSessionInfo,
} from '../../../src/server/terminal';

interface MockPty extends IPty {
    _emitData: (data: string) => void;
    _emitExit: (code: number, signal?: number) => void;
}

function createMockPty(): MockPty {
    const dataListeners: Array<(data: string) => void> = [];
    const exitListeners: Array<(e: { exitCode: number; signal?: number }) => void> = [];
    return {
        pid: Math.floor(Math.random() * 10000) + 1000,
        cols: 80,
        rows: 24,
        write: vi.fn(),
        resize: vi.fn(),
        kill: vi.fn(),
        onData: vi.fn((cb: (data: string) => void) => {
            dataListeners.push(cb);
            return { dispose: () => { dataListeners.splice(dataListeners.indexOf(cb), 1); } };
        }),
        onExit: vi.fn((cb: (e: { exitCode: number; signal?: number }) => void) => {
            exitListeners.push(cb);
            return { dispose: () => { exitListeners.splice(exitListeners.indexOf(cb), 1); } };
        }),
        _emitData: (data: string) => dataListeners.forEach(cb => cb(data)),
        _emitExit: (code: number, signal?: number) =>
            exitListeners.forEach(cb => cb({ exitCode: code, signal })),
    };
}

let lastMockPty: MockPty;
let lastSpawnCwd: string | undefined;
const mockSpawn = vi.fn((_shell: string, _args: string[], opts: any) => {
    lastSpawnCwd = opts?.cwd;
    lastMockPty = createMockPty();
    return lastMockPty;
});

let dataDir: string;
let workspaceRoot: string;

function terminalsDir(workspaceId: string): string {
    return path.join(dataDir, 'repos', workspaceId, 'terminals');
}

function createManager(opts: Record<string, unknown> = {}): TerminalSessionManager {
    return new TerminalSessionManager({
        nodePtyModule: { spawn: mockSpawn },
        dataDir,
        ...opts,
    } as any);
}

beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-terminal-restart-'));
    workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-terminal-root-'));
    mockSpawn.mockClear();
    lastSpawnCwd = undefined;
});

afterEach(() => {
    fs.rmSync(dataDir, { recursive: true, force: true });
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
});

// ============================================================================
// Tombstones
// ============================================================================

describe('exited session tombstones', () => {
    it('lists an exited session alongside live ones', () => {
        const manager = createManager();
        const dead = manager.createSession('ws-a', workspaceRoot);
        const deadPty = lastMockPty;
        manager.createSession('ws-a', workspaceRoot);

        deadPty._emitExit(0);

        const sessions = manager.getSessionsByWorkspace('ws-a');
        expect(sessions).toHaveLength(2);
        expect(manager.liveSize).toBe(1);
        const info = toSessionInfo(sessions.find(s => s.id === dead.id)!);
        expect(info.status).toBe('exited');
        expect(info.pid).toBeNull();
        expect(info.cwd).toBe(workspaceRoot);
        expect(info.title).toBeTruthy();
    });

    it('keeps a tombstone read-only for input and resize', () => {
        const manager = createManager();
        const session = manager.createSession('ws-a', workspaceRoot);
        lastMockPty._emitExit(0);

        expect(() => manager.writeToSession(session.id, 'ls\n')).toThrow(/exited/);
        expect(() => manager.resizeSession(session.id, 100, 30)).toThrow(/exited/);
    });

    it('still replays the scrollback of an exited session', () => {
        const manager = createManager();
        const session = manager.createSession('ws-a', workspaceRoot);
        lastMockPty._emitData('hello\r\n');
        lastMockPty._emitExit(0);

        expect(manager.getScrollback(session.id)?.data).toBe('hello\r\n');
    });

    it('hydrates persisted sessions from disk as exited, once per workspace', () => {
        const first = createManager();
        const session = first.createSession('ws-a', workspaceRoot);
        lastMockPty._emitData('from a previous life\r\n');
        first.destroyAll();

        const second = createManager();
        const sessions = second.getSessionsByWorkspace('ws-a');
        expect(sessions).toHaveLength(1);
        expect(sessions[0].id).toBe(session.id);
        expect(sessions[0].status).toBe('exited');
        expect(sessions[0].pty).toBeNull();
        expect(second.getScrollback(session.id)?.data).toBe('from a previous life\r\n');

        // A second read must not duplicate the entry.
        expect(second.getSessionsByWorkspace('ws-a')).toHaveLength(1);
    });

    it('never overwrites a live session while hydrating', () => {
        const first = createManager();
        first.createSession('ws-a', workspaceRoot);
        first.destroyAll();

        const second = createManager();
        const live = second.createSession('ws-a', workspaceRoot);
        second.hydrateWorkspace('ws-a');

        expect(second.getSession(live.id)!.status).toBe('running');
        expect(second.liveSize).toBe(1);
    });
});

// ============================================================================
// restartSession
// ============================================================================

describe('restartSession', () => {
    it('respawns in the recorded cwd with a new id, the old title, and carried scrollback', () => {
        const manager = createManager();
        const original = manager.createSession('ws-a', workspaceRoot);
        original.title = 'build';
        lastMockPty._emitData('old output\r\n');
        lastMockPty._emitExit(0);

        const { session, cwdFallback } = manager.restartSession(original.id, '/some/other/root');

        expect(session.id).not.toBe(original.id);
        expect(session.status).toBe('running');
        expect(session.title).toBe('build');
        expect(cwdFallback).toBe(false);
        expect(lastSpawnCwd).toBe(workspaceRoot);

        const scrollback = manager.getScrollback(session.id)!.data;
        expect(scrollback).toContain('old output');
        expect(scrollback).toContain('restarted ');
    });

    it('replaces the old tombstone and deletes its persisted files', () => {
        const manager = createManager();
        const original = manager.createSession('ws-a', workspaceRoot);
        lastMockPty._emitExit(0);

        const { session } = manager.restartSession(original.id, workspaceRoot);

        expect(manager.getSession(original.id)).toBeUndefined();
        expect(manager.getSessionsByWorkspace('ws-a').map(s => s.id)).toEqual([session.id]);
        expect(fs.existsSync(path.join(terminalsDir('ws-a'), `${original.id}.json`))).toBe(false);
        expect(fs.existsSync(path.join(terminalsDir('ws-a'), `${original.id}.log`))).toBe(false);
        expect(fs.existsSync(path.join(terminalsDir('ws-a'), `${session.id}.json`))).toBe(true);
    });

    it('falls back to the workspace root when the recorded cwd is gone', () => {
        const goneDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-terminal-gone-'));
        const manager = createManager();
        const original = manager.createSession('ws-a', goneDir);
        lastMockPty._emitExit(0);
        fs.rmSync(goneDir, { recursive: true, force: true });

        const { session, cwdFallback } = manager.restartSession(original.id, workspaceRoot);

        expect(cwdFallback).toBe(true);
        expect(lastSpawnCwd).toBe(workspaceRoot);
        expect(session.cwd).toBe(workspaceRoot);
    });

    it('refuses to restart a session that is still running', () => {
        const manager = createManager();
        const session = manager.createSession('ws-a', workspaceRoot);

        expect(() => manager.restartSession(session.id, workspaceRoot)).toThrow(TerminalSessionRunningError);
        expect(manager.getSession(session.id)!.status).toBe('running');
        expect(mockSpawn).toHaveBeenCalledTimes(1);
    });

    it('throws for an unknown session', () => {
        const manager = createManager();
        expect(() => manager.restartSession('nope', workspaceRoot)).toThrow(/not found/);
    });

    it('surfaces the create-path error when node-pty is unavailable', () => {
        const manager = createManager();
        const original = manager.createSession('ws-a', workspaceRoot);
        lastMockPty._emitExit(0);

        const unavailable = new TerminalSessionManager({ nodePtyModule: null, dataDir } as any);
        unavailable.hydrateWorkspace('ws-a');
        expect(() => unavailable.restartSession(original.id, workspaceRoot))
            .toThrow(/not available/);
    });
});
