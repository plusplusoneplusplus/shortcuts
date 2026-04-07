import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { IPty } from '../../../src/server/terminal/types';
import { TerminalSessionManager, toSessionInfo } from '../../../src/server/terminal';

// ============================================================================
// Mock helpers
// ============================================================================

interface MockPty extends IPty {
    _emitData: (data: string) => void;
    _emitExit: (code: number, signal?: number) => void;
}

function createMockPty(overrides?: Partial<IPty>): MockPty {
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
        ...overrides,
    };
}

const mockSpawn = vi.fn((_shell: string, _args: string[], _opts: any) => createMockPty());

function createMockNodePty() {
    return { spawn: mockSpawn };
}

// ============================================================================
// Tests
// ============================================================================

function createManager(opts?: Omit<Parameters<typeof TerminalSessionManager['prototype']['constructor']>[0], 'nodePtyModule'> & Record<string, any>): TerminalSessionManager {
    return new TerminalSessionManager({ ...opts, nodePtyModule: createMockNodePty() } as any);
}

describe('TerminalSessionManager', () => {
    let manager: TerminalSessionManager;

    beforeEach(() => {
        mockSpawn.mockClear();
        mockSpawn.mockImplementation(() => createMockPty());
    });

    afterEach(() => {
        if (manager) {
            manager.destroyAll();
        }
    });

    // ----------------------------------------------------------------
    // isAvailable()
    // ----------------------------------------------------------------

    describe('isAvailable()', () => {
        it('should return true when node-pty is loaded', () => {
            manager = createManager();
            expect(manager.isAvailable()).toBe(true);
        });

        it('should return false when node-pty is not available', () => {
            manager = new TerminalSessionManager({ nodePtyModule: null });
            expect(manager.isAvailable()).toBe(false);
        });

        it('should return unavailable reason when node-pty fails to load', () => {
            // When no nodePtyModule override is given and require fails,
            // loadNodePty captures the error message.
            manager = new TerminalSessionManager();
            // node-pty is not installed in this test env, so loadNodePty will fail
            if (!manager.isAvailable()) {
                expect(manager.getUnavailableReason()).toBeTruthy();
            } else {
                // If node-pty happens to be installed, reason should be null
                expect(manager.getUnavailableReason()).toBeNull();
            }
        });

        it('should throw descriptive error when creating session without node-pty', () => {
            manager = new TerminalSessionManager({ nodePtyModule: null });
            expect(() => manager.createSession('ws-abc', '/tmp'))
                .toThrow('Terminal is not available');
        });
    });

    // ----------------------------------------------------------------
    // createSession()
    // ----------------------------------------------------------------

    describe('createSession()', () => {
        it('should create a session with correct defaults (80x24)', () => {
            manager = createManager();
            const session = manager.createSession('ws-abc', '/tmp/project');

            expect(session.id).toHaveLength(12);
            expect(session.workspaceId).toBe('ws-abc');
            expect(session.cols).toBe(80);
            expect(session.rows).toBe(24);
            expect(session.createdAt).toBeGreaterThan(0);
            expect(session.lastActivity).toBeGreaterThan(0);
            expect(session.pty).toBeDefined();
            expect(session.pty.pid).toBeGreaterThan(0);
        });

        it('should create a session with custom cols/rows', () => {
            manager = createManager();
            const session = manager.createSession('ws-abc', '/tmp/project', 120, 40);

            expect(session.cols).toBe(120);
            expect(session.rows).toBe(40);
            expect(mockSpawn).toHaveBeenCalledWith(
                expect.any(String),
                expect.any(Array),
                expect.objectContaining({ cols: 120, rows: 40 }),
            );
        });

        it('should spawn the correct shell on Windows', () => {
            manager = createManager({ platform: 'win32' });
            manager.createSession('ws-abc', 'C:\\projects');

            expect(mockSpawn).toHaveBeenCalledWith(
                'powershell.exe',
                [],
                expect.objectContaining({ cwd: 'C:\\projects' }),
            );
        });

        it('should spawn $SHELL on Linux', () => {
            const origShell = process.env.SHELL;
            process.env.SHELL = '/usr/bin/zsh';
            try {
                manager = createManager({ platform: 'linux' });
                manager.createSession('ws-abc', '/home/user/project');

                expect(mockSpawn).toHaveBeenCalledWith(
                    '/usr/bin/zsh',
                    ['--login'],
                    expect.any(Object),
                );
            } finally {
                if (origShell !== undefined) {
                    process.env.SHELL = origShell;
                } else {
                    delete process.env.SHELL;
                }
            }
        });

        it('should fallback to /bin/bash when $SHELL is unset', () => {
            const origShell = process.env.SHELL;
            delete process.env.SHELL;
            try {
                manager = createManager({ platform: 'linux' });
                manager.createSession('ws-abc', '/home/user/project');

                expect(mockSpawn).toHaveBeenCalledWith(
                    '/bin/bash',
                    ['--login'],
                    expect.any(Object),
                );
            } finally {
                if (origShell !== undefined) {
                    process.env.SHELL = origShell;
                }
            }
        });

        it('should pass rootPath as cwd to pty.spawn', () => {
            manager = createManager();
            manager.createSession('ws-abc', '/my/root/path');

            expect(mockSpawn).toHaveBeenCalledWith(
                expect.any(String),
                expect.any(Array),
                expect.objectContaining({ cwd: '/my/root/path' }),
            );
        });

        it('should throw when max sessions reached', () => {
            manager = createManager({ maxSessions: 2 });
            manager.createSession('ws-abc', '/tmp');
            manager.createSession('ws-abc', '/tmp');

            expect(() => manager.createSession('ws-abc', '/tmp'))
                .toThrow('Maximum terminal sessions (2) reached');
        });

        it('should generate unique session IDs', () => {
            manager = createManager({ maxSessions: 50 });
            const ids = new Set<string>();
            for (let i = 0; i < 20; i++) {
                const session = manager.createSession('ws-abc', '/tmp');
                ids.add(session.id);
            }
            expect(ids.size).toBe(20);
        });

        it('should set createdAt and lastActivity to current time', () => {
            manager = createManager();
            const before = Date.now();
            const session = manager.createSession('ws-abc', '/tmp');
            const after = Date.now();

            expect(session.createdAt).toBeGreaterThanOrEqual(before);
            expect(session.createdAt).toBeLessThanOrEqual(after);
            expect(session.lastActivity).toBeGreaterThanOrEqual(before);
            expect(session.lastActivity).toBeLessThanOrEqual(after);
        });

        it('should pass custom env to pty.spawn when provided', () => {
            const customEnv = { PATH: '/usr/bin', HOME: '/home/test' };
            manager = createManager({ env: customEnv });
            manager.createSession('ws-abc', '/tmp');

            expect(mockSpawn).toHaveBeenCalledWith(
                expect.any(String),
                expect.any(Array),
                expect.objectContaining({ env: customEnv }),
            );
        });
    });

    // ----------------------------------------------------------------
    // getSession() / getSessionsByWorkspace()
    // ----------------------------------------------------------------

    describe('getSession() / getSessionsByWorkspace()', () => {
        it('should return session by ID', () => {
            manager = createManager();
            const session = manager.createSession('ws-abc', '/tmp');
            const found = manager.getSession(session.id);
            expect(found).toBe(session);
        });

        it('should return undefined for unknown ID', () => {
            manager = createManager();
            expect(manager.getSession('nonexistent')).toBeUndefined();
        });

        it('should filter sessions by workspace ID', () => {
            manager = createManager({ maxSessions: 10 });
            manager.createSession('ws-A', '/tmp');
            manager.createSession('ws-A', '/tmp');
            manager.createSession('ws-B', '/tmp');

            const wsA = manager.getSessionsByWorkspace('ws-A');
            const wsB = manager.getSessionsByWorkspace('ws-B');
            const wsC = manager.getSessionsByWorkspace('ws-C');

            expect(wsA).toHaveLength(2);
            expect(wsB).toHaveLength(1);
            expect(wsC).toHaveLength(0);
            expect(wsA.every(s => s.workspaceId === 'ws-A')).toBe(true);
        });
    });

    // ----------------------------------------------------------------
    // writeToSession()
    // ----------------------------------------------------------------

    describe('writeToSession()', () => {
        it('should call pty.write with the data', () => {
            manager = createManager();
            const session = manager.createSession('ws-abc', '/tmp');
            manager.writeToSession(session.id, 'ls -la\n');
            expect(session.pty.write).toHaveBeenCalledWith('ls -la\n');
        });

        it('should update lastActivity', () => {
            manager = createManager();
            const session = manager.createSession('ws-abc', '/tmp');
            const before = session.lastActivity;

            // Advance time slightly
            vi.spyOn(Date, 'now').mockReturnValue(before + 1000);
            manager.writeToSession(session.id, 'x');
            expect(session.lastActivity).toBe(before + 1000);
            vi.restoreAllMocks();
        });

        it('should throw for unknown session ID', () => {
            manager = createManager();
            expect(() => manager.writeToSession('nonexistent', 'data'))
                .toThrow('Terminal session not found: nonexistent');
        });
    });

    // ----------------------------------------------------------------
    // resizeSession()
    // ----------------------------------------------------------------

    describe('resizeSession()', () => {
        it('should call pty.resize and update stored dimensions', () => {
            manager = createManager();
            const session = manager.createSession('ws-abc', '/tmp');
            manager.resizeSession(session.id, 200, 50);

            expect(session.pty.resize).toHaveBeenCalledWith(200, 50);
            expect(session.cols).toBe(200);
            expect(session.rows).toBe(50);
        });

        it('should throw for unknown session ID', () => {
            manager = createManager();
            expect(() => manager.resizeSession('nonexistent', 80, 24))
                .toThrow('Terminal session not found: nonexistent');
        });
    });

    // ----------------------------------------------------------------
    // destroySession()
    // ----------------------------------------------------------------

    describe('destroySession()', () => {
        it('should kill the PTY and remove session', () => {
            manager = createManager();
            const session = manager.createSession('ws-abc', '/tmp');
            const id = session.id;

            expect(manager.destroySession(id)).toBe(true);
            expect(session.pty.kill).toHaveBeenCalled();
            expect(manager.getSession(id)).toBeUndefined();
            expect(manager.size).toBe(0);
        });

        it('should return false for unknown session', () => {
            manager = createManager();
            expect(manager.destroySession('nonexistent')).toBe(false);
        });

        it('should not throw if pty.kill() throws', () => {
            const mock = createMockPty({ kill: vi.fn(() => { throw new Error('already dead'); }) });
            mockSpawn.mockReturnValueOnce(mock);

            manager = createManager();
            const session = manager.createSession('ws-abc', '/tmp');

            expect(() => manager.destroySession(session.id)).not.toThrow();
            expect(manager.size).toBe(0);
        });
    });

    // ----------------------------------------------------------------
    // destroyAll()
    // ----------------------------------------------------------------

    describe('destroyAll()', () => {
        it('should kill all PTYs and clear sessions', () => {
            manager = createManager({ maxSessions: 10 });
            const sessions = [
                manager.createSession('ws-a', '/tmp'),
                manager.createSession('ws-b', '/tmp'),
                manager.createSession('ws-c', '/tmp'),
            ];

            manager.destroyAll();

            expect(manager.size).toBe(0);
            for (const s of sessions) {
                expect(s.pty.kill).toHaveBeenCalled();
                expect(manager.getSession(s.id)).toBeUndefined();
            }
        });

        it('should clear the cleanup timer', () => {
            vi.useFakeTimers();
            const clearSpy = vi.spyOn(globalThis, 'clearInterval');

            manager = createManager();
            manager.destroyAll();

            expect(clearSpy).toHaveBeenCalled();
            clearSpy.mockRestore();
            vi.useRealTimers();
        });
    });

    // ----------------------------------------------------------------
    // onData / onExit callbacks
    // ----------------------------------------------------------------

    describe('onData / onExit callbacks', () => {
        it('should call onData when PTY produces output', () => {
            const onData = vi.fn();
            manager = createManager({ onData });
            const session = manager.createSession('ws-abc', '/tmp');

            const mock = session.pty as unknown as MockPty;
            mock._emitData('hello world');

            expect(onData).toHaveBeenCalledWith(session.id, 'hello world');
        });

        it('should update lastActivity on data', () => {
            manager = createManager();
            const session = manager.createSession('ws-abc', '/tmp');
            const before = session.lastActivity;

            vi.spyOn(Date, 'now').mockReturnValue(before + 5000);
            const mock = session.pty as unknown as MockPty;
            mock._emitData('output');

            expect(session.lastActivity).toBe(before + 5000);
            vi.restoreAllMocks();
        });

        it('should call onExit when PTY exits', () => {
            const onExit = vi.fn();
            manager = createManager({ onExit });
            const session = manager.createSession('ws-abc', '/tmp');

            const mock = session.pty as unknown as MockPty;
            mock._emitExit(0, 15);

            expect(onExit).toHaveBeenCalledWith(session.id, 0, 15);
        });

        it('should auto-remove session on PTY exit', () => {
            manager = createManager();
            const session = manager.createSession('ws-abc', '/tmp');
            const id = session.id;

            const mock = session.pty as unknown as MockPty;
            mock._emitExit(0);

            expect(manager.getSession(id)).toBeUndefined();
            expect(manager.size).toBe(0);
        });
    });

    // ----------------------------------------------------------------
    // Idle session cleanup
    // ----------------------------------------------------------------

    describe('idle session cleanup', () => {
        it('should destroy sessions idle beyond timeout', () => {
            vi.useFakeTimers();
            const onExit = vi.fn();

            manager = createManager({
                idleTimeoutMs: 50,
                cleanupIntervalMs: 25,
                onExit,
            });

            const session = manager.createSession('ws-abc', '/tmp');
            const id = session.id;

            // Advance past the idle timeout
            vi.advanceTimersByTime(100);

            expect(manager.getSession(id)).toBeUndefined();
            expect(manager.size).toBe(0);
            expect(onExit).toHaveBeenCalledWith(id, -1);
            expect(session.pty.kill).toHaveBeenCalled();

            vi.useRealTimers();
        });

        it('should not destroy recently active sessions', () => {
            vi.useFakeTimers();
            manager = createManager({
                idleTimeoutMs: 200,
                cleanupIntervalMs: 50,
            });

            const session = manager.createSession('ws-abc', '/tmp');

            // Advance part way — not past timeout
            vi.advanceTimersByTime(75);

            expect(manager.getSession(session.id)).toBeDefined();
            expect(manager.size).toBe(1);

            vi.useRealTimers();
        });

        it('should call onExit with exitCode -1 for idle-killed sessions', () => {
            vi.useFakeTimers();
            const onExit = vi.fn();

            manager = createManager({
                idleTimeoutMs: 30,
                cleanupIntervalMs: 20,
                onExit,
            });

            const session = manager.createSession('ws-abc', '/tmp');
            vi.advanceTimersByTime(60);

            expect(onExit).toHaveBeenCalledWith(session.id, -1);

            vi.useRealTimers();
        });
    });

    // ----------------------------------------------------------------
    // toSessionInfo()
    // ----------------------------------------------------------------

    describe('toSessionInfo()', () => {
        it('should produce serializable session info without pty handle', () => {
            manager = createManager();
            const session = manager.createSession('ws-abc', '/tmp');
            const info = toSessionInfo(session);

            expect(info.id).toBe(session.id);
            expect(info.workspaceId).toBe('ws-abc');
            expect(info.cols).toBe(session.cols);
            expect(info.rows).toBe(session.rows);
            expect(info.createdAt).toBe(session.createdAt);
            expect(info.lastActivity).toBe(session.lastActivity);
            expect(info.pid).toBe(session.pty.pid);
            expect((info as any).pty).toBeUndefined();
        });
    });

    // ----------------------------------------------------------------
    // size / sessionIds accessors
    // ----------------------------------------------------------------

    describe('size / sessionIds', () => {
        it('should reflect the number of active sessions', () => {
            manager = createManager({ maxSessions: 10 });
            expect(manager.size).toBe(0);

            const s1 = manager.createSession('ws-a', '/tmp');
            expect(manager.size).toBe(1);

            manager.createSession('ws-b', '/tmp');
            expect(manager.size).toBe(2);

            manager.destroySession(s1.id);
            expect(manager.size).toBe(1);
        });

        it('should return all session IDs', () => {
            manager = createManager({ maxSessions: 10 });
            const s1 = manager.createSession('ws-a', '/tmp');
            const s2 = manager.createSession('ws-b', '/tmp');

            const ids = manager.sessionIds;
            expect(ids).toContain(s1.id);
            expect(ids).toContain(s2.id);
            expect(ids).toHaveLength(2);
        });
    });
});
