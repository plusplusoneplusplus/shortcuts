/**
 * Tests for terminal session pin/unpin feature in TerminalSessionManager.
 *
 * Covers:
 * - pinSession() / unpinSession() toggle the flag
 * - unpinSession() resets lastActivity
 * - cleanupIdleSessions() skips pinned sessions
 * - createSession() max-session limit excludes pinned sessions
 * - toSessionInfo() includes pinned field
 * - pin/unpin unknown session returns false
 */

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

function createManager(opts?: Record<string, any>): TerminalSessionManager {
    return new TerminalSessionManager({ ...opts, nodePtyModule: createMockNodePty() } as any);
}

// ============================================================================
// Tests
// ============================================================================

describe('TerminalSessionManager pin/unpin', () => {
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
    // pinSession() / unpinSession()
    // ----------------------------------------------------------------

    describe('pinSession()', () => {
        it('should set pinned to true', () => {
            manager = createManager();
            const session = manager.createSession('ws-abc', '/tmp');
            expect(session.pinned).toBe(false);

            const result = manager.pinSession(session.id);
            expect(result).toBe(true);
            expect(session.pinned).toBe(true);
        });

        it('should return false for unknown session', () => {
            manager = createManager();
            expect(manager.pinSession('nonexistent')).toBe(false);
        });

        it('should be idempotent (pinning already-pinned session)', () => {
            manager = createManager();
            const session = manager.createSession('ws-abc', '/tmp');
            manager.pinSession(session.id);
            expect(manager.pinSession(session.id)).toBe(true);
            expect(session.pinned).toBe(true);
        });
    });

    describe('unpinSession()', () => {
        it('should set pinned to false and reset lastActivity', () => {
            manager = createManager();
            const session = manager.createSession('ws-abc', '/tmp');
            manager.pinSession(session.id);
            expect(session.pinned).toBe(true);

            const beforeUnpin = Date.now();
            const result = manager.unpinSession(session.id);
            const afterUnpin = Date.now();

            expect(result).toBe(true);
            expect(session.pinned).toBe(false);
            expect(session.lastActivity).toBeGreaterThanOrEqual(beforeUnpin);
            expect(session.lastActivity).toBeLessThanOrEqual(afterUnpin);
        });

        it('should return false for unknown session', () => {
            manager = createManager();
            expect(manager.unpinSession('nonexistent')).toBe(false);
        });

        it('should reset lastActivity to give fresh idle window', () => {
            vi.useFakeTimers();
            try {
                manager = createManager({ idleTimeoutMs: 1000, cleanupIntervalMs: 999_999 });
                const session = manager.createSession('ws-abc', '/tmp');
                manager.pinSession(session.id);

                // Advance time significantly
                vi.advanceTimersByTime(5000);

                // Unpin — lastActivity should be reset to "now"
                manager.unpinSession(session.id);
                const now = Date.now();
                expect(session.lastActivity).toBe(now);
            } finally {
                vi.useRealTimers();
            }
        });
    });

    // ----------------------------------------------------------------
    // cleanupIdleSessions() skips pinned sessions
    // ----------------------------------------------------------------

    describe('cleanupIdleSessions() with pinned sessions', () => {
        it('should not destroy pinned sessions even when idle', () => {
            vi.useFakeTimers();
            const onExit = vi.fn();
            try {
                manager = createManager({
                    idleTimeoutMs: 50,
                    cleanupIntervalMs: 25,
                    onExit,
                });

                const session = manager.createSession('ws-abc', '/tmp');
                manager.pinSession(session.id);

                // Advance past the idle timeout
                vi.advanceTimersByTime(100);

                // Pinned session should still exist
                expect(manager.getSession(session.id)).toBeDefined();
                expect(manager.size).toBe(1);
                expect(onExit).not.toHaveBeenCalled();
            } finally {
                vi.useRealTimers();
            }
        });

        it('should destroy unpinned idle sessions but keep pinned ones', () => {
            vi.useFakeTimers();
            const onExit = vi.fn();
            try {
                manager = createManager({
                    maxSessions: 10,
                    idleTimeoutMs: 50,
                    cleanupIntervalMs: 25,
                    onExit,
                });

                const pinned = manager.createSession('ws-abc', '/tmp');
                const unpinned = manager.createSession('ws-abc', '/tmp');
                manager.pinSession(pinned.id);

                // Advance past the idle timeout
                vi.advanceTimersByTime(100);

                // Pinned stays, unpinned goes
                expect(manager.getSession(pinned.id)).toBeDefined();
                expect(manager.getSession(unpinned.id)).toBeUndefined();
                expect(manager.size).toBe(1);
                expect(onExit).toHaveBeenCalledWith(unpinned.id, -1);
                expect(onExit).not.toHaveBeenCalledWith(pinned.id, expect.anything());
            } finally {
                vi.useRealTimers();
            }
        });

        it('should destroy previously-pinned session after unpin and idle timeout', () => {
            vi.useFakeTimers();
            const onExit = vi.fn();
            try {
                manager = createManager({
                    idleTimeoutMs: 50,
                    cleanupIntervalMs: 25,
                    onExit,
                });

                const session = manager.createSession('ws-abc', '/tmp');
                manager.pinSession(session.id);

                // Advance past idle timeout — session survives
                vi.advanceTimersByTime(100);
                expect(manager.getSession(session.id)).toBeDefined();

                // Unpin — lastActivity resets
                manager.unpinSession(session.id);

                // Advance past idle timeout again
                vi.advanceTimersByTime(100);

                expect(manager.getSession(session.id)).toBeUndefined();
                expect(onExit).toHaveBeenCalledWith(session.id, -1);
            } finally {
                vi.useRealTimers();
            }
        });
    });

    // ----------------------------------------------------------------
    // createSession() max-session with pinned sessions
    // ----------------------------------------------------------------

    describe('createSession() max-session limit with pinned', () => {
        it('should not count pinned sessions toward the limit', () => {
            manager = createManager({ maxSessions: 2 });
            const s1 = manager.createSession('ws-abc', '/tmp');
            const s2 = manager.createSession('ws-abc', '/tmp');

            // Both slots full — normally would fail
            expect(() => manager.createSession('ws-abc', '/tmp'))
                .toThrow('Maximum terminal sessions (2) reached');

            // Pin one session — frees up a slot
            manager.pinSession(s1.id);
            const s3 = manager.createSession('ws-abc', '/tmp');
            expect(s3).toBeDefined();
            expect(manager.size).toBe(3);
        });

        it('should still enforce limit on unpinned sessions', () => {
            manager = createManager({ maxSessions: 2 });
            const s1 = manager.createSession('ws-abc', '/tmp');
            manager.pinSession(s1.id);

            // 1 pinned + 0 unpinned — can create 2 more unpinned
            manager.createSession('ws-abc', '/tmp');
            manager.createSession('ws-abc', '/tmp');

            // 1 pinned + 2 unpinned — next unpinned should fail
            expect(() => manager.createSession('ws-abc', '/tmp'))
                .toThrow('Maximum terminal sessions (2) reached');
        });

        it('should allow creating sessions when all existing sessions are pinned', () => {
            manager = createManager({ maxSessions: 2 });
            const s1 = manager.createSession('ws-abc', '/tmp');
            const s2 = manager.createSession('ws-abc', '/tmp');
            manager.pinSession(s1.id);
            manager.pinSession(s2.id);

            // 2 pinned + 0 unpinned — should still allow new unpinned
            const s3 = manager.createSession('ws-abc', '/tmp');
            expect(s3).toBeDefined();
            expect(manager.size).toBe(3);
        });
    });

    // ----------------------------------------------------------------
    // toSessionInfo() includes pinned
    // ----------------------------------------------------------------

    describe('toSessionInfo() with pinned', () => {
        it('should include pinned: false for new sessions', () => {
            manager = createManager();
            const session = manager.createSession('ws-abc', '/tmp');
            const info = toSessionInfo(session);
            expect(info.pinned).toBe(false);
        });

        it('should include pinned: true after pinning', () => {
            manager = createManager();
            const session = manager.createSession('ws-abc', '/tmp');
            manager.pinSession(session.id);
            const info = toSessionInfo(session);
            expect(info.pinned).toBe(true);
        });
    });

    // ----------------------------------------------------------------
    // New sessions default to unpinned
    // ----------------------------------------------------------------

    describe('default pinned state', () => {
        it('should create sessions with pinned: false by default', () => {
            manager = createManager();
            const session = manager.createSession('ws-abc', '/tmp');
            expect(session.pinned).toBe(false);
        });
    });
});
