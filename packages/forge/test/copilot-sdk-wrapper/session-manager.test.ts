/**
 * SessionManager unit tests.
 *
 * Exercises track / untrack / abort / has / count / abortAll in isolation,
 * without any CopilotSDKService dependency.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SessionManager, IAbortableSession } from '@plusplusoneplusplus/coc-agent-sdk';
import { setLogger, nullLogger } from '../../src/logger';

setLogger(nullLogger);

// ── helpers ──────────────────────────────────────────────────────────────────

function makeSession(id: string, disconnectError?: Error): IAbortableSession {
    return {
        sessionId: id,
        disconnect: disconnectError
            ? vi.fn().mockRejectedValue(disconnectError)
            : vi.fn().mockResolvedValue(undefined),
    };
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe('SessionManager', () => {
    let manager: SessionManager;

    beforeEach(() => {
        manager = new SessionManager();
    });

    // ── track / has / count ──────────────────────────────────────────────────

    it('starts empty', () => {
        expect(manager.count()).toBe(0);
        expect(manager.has('any')).toBe(false);
    });

    it('tracks a session', () => {
        const s = makeSession('s1');
        manager.track(s);
        expect(manager.has('s1')).toBe(true);
        expect(manager.count()).toBe(1);
    });

    it('tracks multiple sessions', () => {
        manager.track(makeSession('a'));
        manager.track(makeSession('b'));
        manager.track(makeSession('c'));
        expect(manager.count()).toBe(3);
        expect(manager.has('b')).toBe(true);
    });

    it('overwriting a session ID replaces the entry', () => {
        const s1 = makeSession('dup');
        const s2 = makeSession('dup');
        manager.track(s1);
        manager.track(s2);
        expect(manager.count()).toBe(1);
    });

    // ── untrack ───────────────────────────────────────────────────────────────

    it('untracks a session', () => {
        manager.track(makeSession('x'));
        manager.untrack('x');
        expect(manager.has('x')).toBe(false);
        expect(manager.count()).toBe(0);
    });

    it('untrack of an unknown ID is a no-op', () => {
        manager.track(makeSession('y'));
        manager.untrack('unknown');
        expect(manager.count()).toBe(1);
    });

    // ── abort ─────────────────────────────────────────────────────────────────

    it('abort returns false for unknown session', async () => {
        const result = await manager.abort('ghost');
        expect(result).toBe(false);
    });

    it('abort disconnects the session and untracks it', async () => {
        const s = makeSession('s2');
        manager.track(s);
        const result = await manager.abort('s2');
        expect(result).toBe(true);
        expect(s.disconnect).toHaveBeenCalledOnce();
        expect(manager.has('s2')).toBe(false);
        expect(manager.count()).toBe(0);
    });

    it('abort returns false and untracks when disconnect throws', async () => {
        const s = makeSession('err', new Error('disconnect failed'));
        manager.track(s);
        const result = await manager.abort('err');
        expect(result).toBe(false);
        expect(manager.has('err')).toBe(false);
    });

    it('aborting one session does not affect others', async () => {
        manager.track(makeSession('keep'));
        manager.track(makeSession('remove'));
        await manager.abort('remove');
        expect(manager.has('keep')).toBe(true);
        expect(manager.has('remove')).toBe(false);
    });

    // ── abortAll ──────────────────────────────────────────────────────────────

    it('abortAll disconnects all sessions and clears the map', async () => {
        const sessions = ['a', 'b', 'c'].map(id => makeSession(id));
        sessions.forEach(s => manager.track(s));

        await manager.abortAll();

        for (const s of sessions) {
            expect(s.disconnect).toHaveBeenCalledOnce();
        }
        expect(manager.count()).toBe(0);
    });

    it('abortAll is a no-op when there are no sessions', async () => {
        await expect(manager.abortAll()).resolves.not.toThrow();
        expect(manager.count()).toBe(0);
    });

    it('abortAll completes even when some sessions throw on disconnect', async () => {
        manager.track(makeSession('ok'));
        manager.track(makeSession('bad', new Error('boom')));
        await expect(manager.abortAll()).resolves.not.toThrow();
        expect(manager.count()).toBe(0);
    });

    it('abortAll calls disconnect on every session even when one throws', async () => {
        const good = makeSession('good');
        const bad = makeSession('bad', new Error('disconnect failed'));
        manager.track(bad);
        manager.track(good);
        await manager.abortAll();
        expect(good.disconnect).toHaveBeenCalledOnce();
        expect(bad.disconnect).toHaveBeenCalledOnce();
    });

    it('abortAll initiates all disconnects concurrently via allSettled', async () => {
        const order: string[] = [];
        const slow = {
            sessionId: 'slow',
            disconnect: vi.fn(async () => {
                order.push('slow-start');
                await new Promise(r => setTimeout(r, 20));
                order.push('slow-end');
            }),
        };
        const fast = {
            sessionId: 'fast',
            disconnect: vi.fn(async () => {
                order.push('fast-start');
                order.push('fast-end');
            }),
        };
        manager.track(slow);
        manager.track(fast);
        await manager.abortAll();
        // Both should have started before slow finished
        const slowEndIdx = order.indexOf('slow-end');
        const fastStartIdx = order.indexOf('fast-start');
        expect(fastStartIdx).toBeLessThan(slowEndIdx);
    });

    // ── count accuracy across lifecycle ─────────────────────────────────────

    it('count reflects track, abort, untrack sequence correctly', async () => {
        expect(manager.count()).toBe(0);
        manager.track(makeSession('a'));
        expect(manager.count()).toBe(1);
        manager.track(makeSession('b'));
        expect(manager.count()).toBe(2);
        await manager.abort('a');
        expect(manager.count()).toBe(1);
        manager.untrack('b');
        expect(manager.count()).toBe(0);
        manager.track(makeSession('c'));
        expect(manager.count()).toBe(1);
    });

    // ── double abort ─────────────────────────────────────────────────────────

    it('aborting the same session twice returns false on the second call', async () => {
        const s = makeSession('once');
        manager.track(s);
        expect(await manager.abort('once')).toBe(true);
        expect(await manager.abort('once')).toBe(false);
        expect(s.disconnect).toHaveBeenCalledOnce();
    });

    // ── untrack after abort ──────────────────────────────────────────────────

    it('untrack after abort is a no-op (no throw)', async () => {
        const s = makeSession('gone');
        manager.track(s);
        await manager.abort('gone');
        expect(() => manager.untrack('gone')).not.toThrow();
        expect(manager.count()).toBe(0);
    });

    // ── re-track after abort ─────────────────────────────────────────────────

    it('a session ID can be re-tracked after being aborted', async () => {
        const s1 = makeSession('reuse');
        manager.track(s1);
        await manager.abort('reuse');
        expect(manager.has('reuse')).toBe(false);

        const s2 = makeSession('reuse');
        manager.track(s2);
        expect(manager.has('reuse')).toBe(true);
        expect(manager.count()).toBe(1);
    });

    // ── softAbort ─────────────────────────────────────────────────────────────

    it('softAbort returns false for unknown session', async () => {
        const result = await manager.softAbort('ghost');
        expect(result).toBe(false);
    });

    it('softAbort calls session.abort() when available', async () => {
        const abortFn = vi.fn().mockResolvedValue(undefined);
        const s = {
            sessionId: 'soft1',
            disconnect: vi.fn().mockResolvedValue(undefined),
            abort: abortFn,
        };
        manager.track(s);
        const result = await manager.softAbort('soft1');
        expect(result).toBe(true);
        expect(abortFn).toHaveBeenCalledOnce();
        // Does NOT call disconnect — request-runner finally block handles that
        expect(s.disconnect).not.toHaveBeenCalled();
        // Does NOT untrack — request-runner finally block handles that
        expect(manager.has('soft1')).toBe(true);
    });

    it('softAbort falls back to disconnect when abort() is not available', async () => {
        const s = makeSession('no-abort');
        manager.track(s);
        const result = await manager.softAbort('no-abort');
        expect(result).toBe(true);
        expect(s.disconnect).toHaveBeenCalledOnce();
        expect(manager.has('no-abort')).toBe(false);
    });

    it('softAbort falls back to disconnect when abort() throws', async () => {
        const s = {
            sessionId: 'bad-abort',
            disconnect: vi.fn().mockResolvedValue(undefined),
            abort: vi.fn().mockRejectedValue(new Error('abort failed')),
        };
        manager.track(s);
        const result = await manager.softAbort('bad-abort');
        expect(result).toBe(false);
        expect(s.disconnect).toHaveBeenCalledOnce();
        expect(manager.has('bad-abort')).toBe(false);
    });

    it('softAbort handles both abort() and disconnect() failing', async () => {
        const s = {
            sessionId: 'double-fail',
            disconnect: vi.fn().mockRejectedValue(new Error('disconnect failed')),
            abort: vi.fn().mockRejectedValue(new Error('abort failed')),
        };
        manager.track(s);
        const result = await manager.softAbort('double-fail');
        expect(result).toBe(false);
        expect(manager.has('double-fail')).toBe(false);
    });

    // ── stale session (disconnect already resolved) ─────────────────────────────

    it('abortAll handles a session whose disconnect was already resolved gracefully', async () => {
        // Simulate a "stale" session whose disconnect resolves immediately
        const stale = makeSession('stale');
        const fresh = makeSession('fresh');
        manager.track(stale);
        manager.track(fresh);

        // Manually call disconnect to simulate staleness (session already done)
        await stale.disconnect();

        await expect(manager.abortAll()).resolves.not.toThrow();
        // disconnect called twice on stale (once manually, once by abortAll)
        expect(stale.disconnect).toHaveBeenCalledTimes(2);
        expect(fresh.disconnect).toHaveBeenCalledOnce();
        expect(manager.count()).toBe(0);
    });

    // ── getSession ─────────────────────────────────────────────────────────

    it('getSession returns undefined for unknown ID', () => {
        expect(manager.getSession('ghost')).toBeUndefined();
    });

    it('getSession returns undefined for a session without send()', () => {
        const s = makeSession('no-send');
        manager.track(s);
        expect(manager.getSession('no-send')).toBeUndefined();
    });

    it('getSession returns the session when it has a send() method', () => {
        const s = {
            sessionId: 'streamable',
            disconnect: vi.fn().mockResolvedValue(undefined),
            send: vi.fn().mockResolvedValue(undefined),
        };
        manager.track(s);
        const result = manager.getSession('streamable');
        expect(result).toBeDefined();
        expect(result!.sessionId).toBe('streamable');
        expect(result!.send).toBe(s.send);
    });
});
