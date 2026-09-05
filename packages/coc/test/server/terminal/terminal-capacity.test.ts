/**
 * AC-08 — capacity limits.
 *
 * Live terminals are effectively unlimited but guarded by a high safety cap
 * that errors instead of reaping; exited tombstones are garbage-collected
 * oldest-`exitedAt`-first, taking their persisted `.json`/`.log` with them.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { IPty } from '../../../src/server/terminal/types';
import {
    TerminalSessionManager,
    TerminalPersistence,
    MAX_LIVE_SESSIONS,
    MAX_CLOSED_SESSIONS,
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

const ptys: MockPty[] = [];
const mockSpawn = vi.fn(() => {
    const pty = createMockPty();
    ptys.push(pty);
    return pty;
});

let dataDir: string;

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
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-terminal-capacity-'));
    ptys.length = 0;
    mockSpawn.mockClear();
});

afterEach(() => {
    fs.rmSync(dataDir, { recursive: true, force: true });
});

// ============================================================================
// Live session cap
// ============================================================================

describe('AC-08 live session cap', () => {
    it('defaults to MAX_LIVE_SESSIONS (100), not the old limit of 10', () => {
        expect(MAX_LIVE_SESSIONS).toBe(100);
        const manager = new TerminalSessionManager({ nodePtyModule: { spawn: mockSpawn } } as any);
        for (let i = 0; i < 11; i++) manager.createSession('ws-a', '/tmp');
        expect(manager.liveSize).toBe(11);
    });

    it('rejects session 101 with an error naming the limit, killing nothing', () => {
        const manager = createManager({ maxSessions: 100 });
        for (let i = 0; i < 100; i++) manager.createSession('ws-a', '/tmp');

        expect(() => manager.createSession('ws-a', '/tmp')).toThrow(/100/);
        expect(() => manager.createSession('ws-a', '/tmp')).toThrow(/Maximum terminal sessions/);
        // The cap errors; it never reaps to make room.
        expect(manager.liveSize).toBe(100);
        expect(ptys.every(p => (p.kill as any).mock.calls.length === 0)).toBe(true);
    });

    it('does not count exited tombstones against the live cap', () => {
        const manager = createManager({ maxSessions: 2 });
        const first = manager.createSession('ws-a', '/tmp');
        manager.createSession('ws-a', '/tmp');
        expect(() => manager.createSession('ws-a', '/tmp')).toThrow(/Maximum terminal sessions/);

        ptys[0]._emitExit(0);
        expect(manager.getSession(first.id)?.status).toBe('exited');
        expect(() => manager.createSession('ws-a', '/tmp')).not.toThrow();
    });
});

// ============================================================================
// Closed session eviction
// ============================================================================

describe('AC-08 closed session eviction', () => {
    it('exports MAX_CLOSED_SESSIONS = 50', () => {
        expect(MAX_CLOSED_SESSIONS).toBe(50);
    });

    it('keeps 50 tombstones and deletes the oldest entry files when the 51st exits', () => {
        const manager = createManager({ maxSessions: 200, maxClosedSessions: 50 });
        const ids: string[] = [];
        for (let i = 0; i < 51; i++) ids.push(manager.createSession('ws-a', '/tmp').id);

        // Exit them oldest-first with strictly increasing `exitedAt`.
        let now = 1_000;
        vi.spyOn(Date, 'now').mockImplementation(() => (now += 10));
        for (let i = 0; i < 51; i++) ptys[i]._emitExit(0);
        vi.restoreAllMocks();

        const remaining = manager.sessionIds;
        expect(remaining).toHaveLength(50);
        expect(remaining).not.toContain(ids[0]);
        expect(remaining).toContain(ids[50]);

        const dir = terminalsDir('ws-a');
        expect(fs.existsSync(path.join(dir, `${ids[0]}.json`))).toBe(false);
        expect(fs.existsSync(path.join(dir, `${ids[0]}.log`))).toBe(false);
        expect(fs.existsSync(path.join(dir, `${ids[1]}.json`))).toBe(true);
        expect(fs.readdirSync(dir).filter(f => f.endsWith('.json'))).toHaveLength(50);
    });

    it('never evicts a running session', () => {
        const manager = createManager({ maxSessions: 200, maxClosedSessions: 2 });
        const live = manager.createSession('ws-a', '/tmp');
        const livePtyIndex = ptys.length - 1;
        for (let i = 0; i < 4; i++) manager.createSession('ws-a', '/tmp');

        let now = 1_000;
        vi.spyOn(Date, 'now').mockImplementation(() => (now += 10));
        ptys.forEach((pty, i) => { if (i !== livePtyIndex) pty._emitExit(0); });
        vi.restoreAllMocks();

        expect(manager.getSession(live.id)?.status).toBe('running');
        expect(manager.liveSize).toBe(1);
        expect(manager.sessionIds).toHaveLength(3); // 1 running + 2 tombstones
    });

    it('treats a tombstone with no exitedAt as the oldest', () => {
        const manager = createManager({ maxSessions: 200, maxClosedSessions: 1 });
        const legacy = manager.createSession('ws-a', '/tmp');
        const recent = manager.createSession('ws-a', '/tmp');

        ptys[0]._emitExit(0);
        // A legacy/corrupt entry can lack exitedAt entirely.
        delete (manager.getSession(legacy.id) as any).exitedAt;
        ptys[1]._emitExit(0);

        expect(manager.sessionIds).toEqual([recent.id]);
    });

    it('evicts on hydrate when the persisted directory is over the limit', () => {
        const persistence = new TerminalPersistence(dataDir);
        const ids: string[] = [];
        for (let i = 0; i < 5; i++) {
            const id = `sess-${i}`;
            ids.push(id);
            persistence.save({
                id,
                workspaceId: 'ws-a',
                shell: '/bin/bash',
                cwd: '/tmp',
                title: 'bash',
                createdAt: 1_000 + i,
                lastActivity: 1_000 + i,
                status: 'exited',
                exitedAt: 1_000 + i,
                exitCode: 0,
                truncated: false,
            }, Buffer.from(`output ${i}`));
        }

        const manager = createManager({ maxClosedSessions: 2 });
        manager.hydrateWorkspace('ws-a');

        expect(manager.sessionIds.sort()).toEqual([ids[3], ids[4]].sort());
        const dir = terminalsDir('ws-a');
        expect(fs.existsSync(path.join(dir, 'sess-0.json'))).toBe(false);
        expect(fs.existsSync(path.join(dir, 'sess-0.log'))).toBe(false);
        expect(fs.existsSync(path.join(dir, 'sess-4.json'))).toBe(true);
    });

    it('does not throw when an evicted session log is already gone', () => {
        const manager = createManager({ maxSessions: 200, maxClosedSessions: 1 });
        const first = manager.createSession('ws-a', '/tmp');
        manager.createSession('ws-a', '/tmp');

        ptys[0]._emitExit(0);
        fs.rmSync(path.join(terminalsDir('ws-a'), `${first.id}.log`), { force: true });

        expect(() => ptys[1]._emitExit(0)).not.toThrow();
        expect(manager.sessionIds).not.toContain(first.id);
    });

    it('runs eviction without persistence configured', () => {
        const manager = new TerminalSessionManager({
            nodePtyModule: { spawn: mockSpawn },
            maxSessions: 200,
            maxClosedSessions: 1,
        } as any);
        manager.createSession('ws-a', '/tmp');
        manager.createSession('ws-a', '/tmp');

        expect(() => { ptys[0]._emitExit(0); ptys[1]._emitExit(0); }).not.toThrow();
        expect(manager.sessionIds).toHaveLength(1);
    });
});
