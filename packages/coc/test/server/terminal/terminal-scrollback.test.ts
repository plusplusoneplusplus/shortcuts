/**
 * AC-03 — server-side scrollback ring buffer.
 *
 * Covers the manager-side buffer: every PTY chunk is retained as raw bytes,
 * the buffer is trimmed from the front once the byte cap is exceeded, and
 * `getScrollback()` decodes the concatenation so a multi-byte UTF-8 sequence
 * split across two chunks survives the round trip.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { IPty, TerminalSession } from '../../../src/server/terminal/types';
import {
    TerminalSessionManager,
    appendToScrollback,
    SCROLLBACK_MAX_BYTES,
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

function createManager(): TerminalSessionManager {
    return new TerminalSessionManager({ nodePtyModule: { spawn: mockSpawn } } as any);
}

/** A bare session object, enough to exercise appendToScrollback directly. */
function createBufferOnlySession(): TerminalSession {
    return { buffer: [], bufferBytes: 0, truncated: false } as unknown as TerminalSession;
}

describe('terminal scrollback (AC-03)', () => {
    let manager: TerminalSessionManager;

    beforeEach(() => {
        mockSpawn.mockClear();
    });

    afterEach(() => {
        if (manager) manager.destroyAll();
    });

    describe('appendToScrollback()', () => {
        it('accumulates chunks and tracks their byte length', () => {
            const session = createBufferOnlySession();
            appendToScrollback(session, 'hello ');
            appendToScrollback(session, 'world');

            expect(session.buffer).toHaveLength(2);
            expect(session.bufferBytes).toBe(11);
            expect(session.truncated).toBe(false);
            expect(Buffer.concat(session.buffer).toString('utf-8')).toBe('hello world');
        });

        it('counts bytes, not characters, for multi-byte output', () => {
            const session = createBufferOnlySession();
            appendToScrollback(session, '日本語');

            expect(session.bufferBytes).toBe(9);
        });

        it('ignores empty chunks', () => {
            const session = createBufferOnlySession();
            appendToScrollback(session, '');

            expect(session.buffer).toHaveLength(0);
            expect(session.bufferBytes).toBe(0);
        });

        it('drops the oldest chunks once the byte cap is exceeded', () => {
            const session = createBufferOnlySession();
            const chunk = 'x'.repeat(64 * 1024);
            // 20 x 64 KiB = 1.25 MiB, comfortably past the 1 MiB cap
            for (let i = 0; i < 20; i++) {
                appendToScrollback(session, chunk);
            }

            expect(session.bufferBytes).toBeLessThanOrEqual(SCROLLBACK_MAX_BYTES);
            expect(session.truncated).toBe(true);
        });

        it('keeps the newest output and drops the oldest', () => {
            const session = createBufferOnlySession();
            appendToScrollback(session, `OLDEST${'x'.repeat(SCROLLBACK_MAX_BYTES - 6)}`);
            appendToScrollback(session, 'NEWEST');

            const retained = Buffer.concat(session.buffer).toString('utf-8');
            expect(retained).toContain('NEWEST');
            expect(retained).not.toContain('OLDEST');
            expect(session.bufferBytes).toBeLessThanOrEqual(SCROLLBACK_MAX_BYTES);
        });

        it('keeps only the tail of a single chunk larger than the cap', () => {
            const session = createBufferOnlySession();
            appendToScrollback(session, `${'a'.repeat(SCROLLBACK_MAX_BYTES + 100)}TAIL`);

            expect(session.bufferBytes).toBe(SCROLLBACK_MAX_BYTES);
            expect(session.truncated).toBe(true);
            expect(Buffer.concat(session.buffer).toString('utf-8').endsWith('TAIL')).toBe(true);
        });
    });

    describe('manager buffering', () => {
        it('buffers PTY output on the session', () => {
            manager = createManager();
            const session = manager.createSession('ws-1', '/tmp/ws-1');

            lastMockPty._emitData('line 1\r\n');
            lastMockPty._emitData('line 2\r\n');

            expect(session.bufferBytes).toBe(16);
            expect(manager.getScrollback(session.id)).toEqual({
                data: 'line 1\r\nline 2\r\n',
                truncated: false,
            });
        });

        it('starts a new session with an empty buffer', () => {
            manager = createManager();
            const session = manager.createSession('ws-1', '/tmp/ws-1');

            expect(session.buffer).toEqual([]);
            expect(session.bufferBytes).toBe(0);
            expect(manager.getScrollback(session.id)).toEqual({ data: '', truncated: false });
        });

        it('stays under the byte cap when more than 1 MiB flows through', () => {
            manager = createManager();
            const session = manager.createSession('ws-1', '/tmp/ws-1');

            const chunk = 'y'.repeat(32 * 1024);
            for (let i = 0; i < 40; i++) {
                lastMockPty._emitData(chunk);
            }

            expect(session.bufferBytes).toBeLessThanOrEqual(SCROLLBACK_MAX_BYTES);
            expect(manager.getScrollback(session.id)?.truncated).toBe(true);
        });

        it('decodes the concatenation, not each chunk, so split UTF-8 survives', () => {
            manager = createManager();
            const session = manager.createSession('ws-1', '/tmp/ws-1');

            // Split "é" (0xC3 0xA9) across two chunks the way a PTY read can.
            appendToScrollback(session, 'é');
            const [whole] = session.buffer;
            session.buffer.length = 0;
            session.buffer.push(whole.subarray(0, 1), whole.subarray(1));

            expect(manager.getScrollback(session.id)?.data).toBe('é');
        });

        it('returns undefined for an unknown session', () => {
            manager = createManager();

            expect(manager.getScrollback('nope')).toBeUndefined();
        });
    });
});
