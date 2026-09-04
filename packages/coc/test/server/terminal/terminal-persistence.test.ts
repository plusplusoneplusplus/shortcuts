/**
 * AC-04 — terminal metadata + scrollback persisted to disk.
 *
 * Covers the `TerminalPersistence` file layer (paths, atomic writes, corrupt
 * entries, permissions) and the manager lifecycle that drives it: persist on
 * create, debounced while output flows, on PTY exit, and on shutdown; delete
 * the files when the user explicitly kills a terminal.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { IPty } from '../../../src/server/terminal/types';
import {
    TerminalSessionManager,
    TerminalPersistence,
    SERVER_SHUTDOWN_EXIT_CODE,
    PERSIST_DEBOUNCE_MS,
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
const mockSpawn = vi.fn(() => {
    lastMockPty = createMockPty();
    return lastMockPty;
});

let dataDir: string;

function terminalsDir(workspaceId: string): string {
    return path.join(dataDir, 'repos', workspaceId, 'terminals');
}

function readMeta(workspaceId: string, sessionId: string): Record<string, unknown> {
    return JSON.parse(
        fs.readFileSync(path.join(terminalsDir(workspaceId), `${sessionId}.json`), 'utf-8'),
    );
}

function createManager(opts: Record<string, unknown> = {}): TerminalSessionManager {
    return new TerminalSessionManager({
        nodePtyModule: { spawn: mockSpawn },
        dataDir,
        ...opts,
    } as any);
}

beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-terminal-persist-'));
    mockSpawn.mockClear();
});

afterEach(() => {
    vi.useRealTimers();
    fs.rmSync(dataDir, { recursive: true, force: true });
});

// ============================================================================
// TerminalPersistence — file layer
// ============================================================================

describe('TerminalPersistence', () => {
    const meta = {
        id: 'sess1',
        workspaceId: 'ws-a',
        shell: '/bin/bash',
        cwd: '/tmp/project',
        title: 'bash',
        createdAt: 1000,
        lastActivity: 2000,
        status: 'exited' as const,
        exitedAt: 3000,
        exitCode: 0,
        truncated: false,
    };

    it('writes metadata and log under <dataDir>/repos/<workspaceId>/terminals', () => {
        const p = new TerminalPersistence(dataDir);
        p.save(meta, Buffer.from('hello world'));

        expect(p.dirFor('ws-a')).toBe(terminalsDir('ws-a'));
        expect(fs.existsSync(p.metaPath('ws-a', 'sess1'))).toBe(true);
        expect(readMeta('ws-a', 'sess1')).toEqual(meta);
        expect(fs.readFileSync(p.logPath('ws-a', 'sess1'), 'utf-8')).toBe('hello world');
    });

    it('creates the directory lazily and leaves no .tmp files behind', () => {
        const p = new TerminalPersistence(dataDir);
        expect(fs.existsSync(terminalsDir('ws-a'))).toBe(false);

        p.save(meta, Buffer.from('a'));
        p.save(meta, Buffer.from('bb'));

        const entries = fs.readdirSync(terminalsDir('ws-a')).sort();
        expect(entries).toEqual(['sess1.json', 'sess1.log']);
        expect(fs.readFileSync(p.logPath('ws-a', 'sess1'), 'utf-8')).toBe('bb');
    });

    it.runIf(process.platform !== 'win32')('restricts the directory to 0700 and files to 0600', () => {
        const p = new TerminalPersistence(dataDir);
        p.save(meta, Buffer.from('secret'));

        expect(fs.statSync(terminalsDir('ws-a')).mode & 0o777).toBe(0o700);
        expect(fs.statSync(p.metaPath('ws-a', 'sess1')).mode & 0o777).toBe(0o600);
        expect(fs.statSync(p.logPath('ws-a', 'sess1')).mode & 0o777).toBe(0o600);
    });

    it('loads persisted sessions back as exited', () => {
        const p = new TerminalPersistence(dataDir);
        p.save({ ...meta, status: 'running', exitedAt: undefined }, Buffer.from('output'));

        const loaded = p.load('ws-a');
        expect(loaded).toHaveLength(1);
        expect(loaded[0].meta.status).toBe('exited');
        expect(loaded[0].meta.cwd).toBe('/tmp/project');
        expect(loaded[0].meta.title).toBe('bash');
        // A running entry has no exitedAt, so lastActivity stands in for ordering.
        expect(loaded[0].meta.exitedAt).toBe(2000);
        expect(loaded[0].scrollback.toString('utf-8')).toBe('output');
    });

    it('returns an empty list when the directory does not exist', () => {
        expect(new TerminalPersistence(dataDir).load('never-used')).toEqual([]);
    });

    it('skips malformed JSON without throwing', () => {
        const p = new TerminalPersistence(dataDir);
        p.save(meta, Buffer.from('good'));
        fs.writeFileSync(path.join(terminalsDir('ws-a'), 'broken.json'), '{ not json');
        fs.writeFileSync(path.join(terminalsDir('ws-a'), 'wrongshape.json'), '"a string"');
        fs.writeFileSync(path.join(terminalsDir('ws-a'), 'nows.json'), JSON.stringify({ id: 'nows' }));

        let loaded: ReturnType<typeof p.load> = [];
        expect(() => { loaded = p.load('ws-a'); }).not.toThrow();
        expect(loaded.map(l => l.meta.id)).toEqual(['sess1']);
    });

    it('loads an entry with an empty scrollback when the .log is missing', () => {
        const p = new TerminalPersistence(dataDir);
        p.save(meta, Buffer.from('gone'));
        fs.rmSync(p.logPath('ws-a', 'sess1'));

        const loaded = p.load('ws-a');
        expect(loaded).toHaveLength(1);
        expect(loaded[0].scrollback.length).toBe(0);
    });

    it('removes both files and tolerates missing ones', () => {
        const p = new TerminalPersistence(dataDir);
        p.save(meta, Buffer.from('x'));
        p.remove('ws-a', 'sess1');

        expect(fs.existsSync(p.metaPath('ws-a', 'sess1'))).toBe(false);
        expect(fs.existsSync(p.logPath('ws-a', 'sess1'))).toBe(false);
        expect(() => p.remove('ws-a', 'sess1')).not.toThrow();
        expect(() => p.remove('unknown-ws', 'nope')).not.toThrow();
    });
});

// ============================================================================
// Manager lifecycle
// ============================================================================

describe('TerminalSessionManager persistence', () => {
    it('is disabled when no dataDir is configured', () => {
        const manager = new TerminalSessionManager({ nodePtyModule: { spawn: mockSpawn } } as any);
        expect(manager.persistenceEnabled).toBe(false);

        const session = manager.createSession('ws-a', '/tmp/project');
        lastMockPty._emitData('hi');
        manager.flushSession(session.id);

        expect(fs.existsSync(terminalsDir('ws-a'))).toBe(false);
        expect(manager.loadPersistedSessions('ws-a')).toEqual([]);
    });

    it('persists metadata on session create', () => {
        const manager = createManager();
        const session = manager.createSession('ws-a', '/tmp/project', 100, 40);

        const meta = readMeta('ws-a', session.id);
        expect(meta).toMatchObject({
            id: session.id,
            workspaceId: 'ws-a',
            cwd: '/tmp/project',
            status: 'running',
            truncated: false,
        });
        expect(typeof meta.shell).toBe('string');
        expect(meta.title).toBe(path.basename(session.shell));
    });

    it('flushes scrollback to the .log after the debounce settles', () => {
        vi.useFakeTimers();
        const manager = createManager();
        const session = manager.createSession('ws-a', '/tmp/project');
        const logPath = path.join(terminalsDir('ws-a'), `${session.id}.log`);

        lastMockPty._emitData('line one\n');
        lastMockPty._emitData('line two\n');
        expect(fs.readFileSync(logPath, 'utf-8')).toBe('');

        vi.advanceTimersByTime(PERSIST_DEBOUNCE_MS);
        expect(fs.readFileSync(logPath, 'utf-8')).toBe('line one\nline two\n');
    });

    it('flushSession() writes immediately, bypassing the debounce', () => {
        vi.useFakeTimers();
        const manager = createManager();
        const session = manager.createSession('ws-a', '/tmp/project');

        lastMockPty._emitData('now');
        manager.flushSession(session.id);

        const logPath = path.join(terminalsDir('ws-a'), `${session.id}.log`);
        expect(fs.readFileSync(logPath, 'utf-8')).toBe('now');
        expect(vi.getTimerCount()).toBe(0);
    });

    it('records status exited with the PTY exit code when the shell ends', () => {
        const manager = createManager();
        const session = manager.createSession('ws-a', '/tmp/project');
        lastMockPty._emitData('bye\n');
        lastMockPty._emitExit(3);

        const meta = readMeta('ws-a', session.id);
        expect(meta.status).toBe('exited');
        expect(meta.exitCode).toBe(3);
        expect(typeof meta.exitedAt).toBe('number');
        expect(fs.readFileSync(path.join(terminalsDir('ws-a'), `${session.id}.log`), 'utf-8')).toBe('bye\n');
    });

    it('records a distinguishable exit code on shutdown and still kills the PTY', () => {
        const manager = createManager();
        const session = manager.createSession('ws-a', '/tmp/project');
        const pty = lastMockPty;
        pty._emitData('work in progress\n');

        manager.destroyAll();

        expect(pty.kill).toHaveBeenCalled();
        expect(manager.size).toBe(0);
        const meta = readMeta('ws-a', session.id);
        expect(meta.status).toBe('exited');
        expect(meta.exitCode).toBe(SERVER_SHUTDOWN_EXIT_CODE);
        expect(fs.readFileSync(path.join(terminalsDir('ws-a'), `${session.id}.log`), 'utf-8'))
            .toBe('work in progress\n');
    });

    it('deletes the persisted files when the user explicitly kills a session', () => {
        const manager = createManager();
        const session = manager.createSession('ws-a', '/tmp/project');
        expect(fs.existsSync(path.join(terminalsDir('ws-a'), `${session.id}.json`))).toBe(true);

        manager.destroySession(session.id);

        expect(fs.existsSync(path.join(terminalsDir('ws-a'), `${session.id}.json`))).toBe(false);
        expect(fs.existsSync(path.join(terminalsDir('ws-a'), `${session.id}.log`))).toBe(false);
    });

    it('holds no pending flush timers after destroyAll()', () => {
        vi.useFakeTimers();
        const manager = createManager();
        manager.createSession('ws-a', '/tmp/project');
        lastMockPty._emitData('pending');
        expect(vi.getTimerCount()).toBe(1);

        manager.destroyAll();
        expect(vi.getTimerCount()).toBe(0);
    });

    it('reloads persisted sessions as exited in a fresh manager', () => {
        const manager = createManager();
        const a = manager.createSession('ws-a', '/tmp/project');
        lastMockPty._emitData('from a\n');
        const b = manager.createSession('ws-a', '/tmp/project');
        lastMockPty._emitData('from b\n');
        manager.destroyAll();

        const revived = createManager();
        const loaded = revived.loadPersistedSessions('ws-a');
        expect(loaded.map(l => l.meta.id).sort()).toEqual([a.id, b.id].sort());
        expect(loaded.every(l => l.meta.status === 'exited')).toBe(true);
        expect(loaded.every(l => l.meta.cwd === '/tmp/project')).toBe(true);
        const fromA = loaded.find(l => l.meta.id === a.id)!;
        expect(fromA.scrollback.toString('utf-8')).toBe('from a\n');
    });

    it('does not leak sessions across workspaces', () => {
        const manager = createManager();
        manager.createSession('ws-a', '/tmp/a');
        manager.createSession('ws-b', '/tmp/b');
        manager.destroyAll();

        expect(manager.loadPersistedSessions('ws-a')).toHaveLength(1);
        expect(manager.loadPersistedSessions('ws-b')).toHaveLength(1);
    });

    it('rejects input to a session that has exited', () => {
        const manager = createManager();
        const session = manager.createSession('ws-a', '/tmp/project');
        session.status = 'exited';

        expect(() => manager.writeToSession(session.id, 'ls\n')).toThrow(/exited/);
        expect(lastMockPty.write).not.toHaveBeenCalled();
    });

    it('keeps a live terminal running when the data dir is unwritable', () => {
        const manager = createManager({ dataDir: path.join(dataDir, 'file-not-a-dir') });
        fs.writeFileSync(path.join(dataDir, 'file-not-a-dir'), 'blocker');

        const session = manager.createSession('ws-a', '/tmp/project');
        expect(() => lastMockPty._emitData('still fine')).not.toThrow();
        expect(manager.getSession(session.id)).toBeDefined();
        expect(manager.getScrollback(session.id)?.data).toBe('still fine');
    });
});
