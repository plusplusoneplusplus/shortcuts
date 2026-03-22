/**
 * SessionManager unit tests.
 *
 * Exercises track / untrack / abort / has / count / abortAll in isolation,
 * without any CopilotSDKService dependency.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SessionManager, IAbortableSession } from '../../src/copilot-sdk-wrapper/session-manager';
import { setLogger, nullLogger } from '../../src/logger';

setLogger(nullLogger);

// ── helpers ──────────────────────────────────────────────────────────────────

function makeSession(id: string, destroyError?: Error): IAbortableSession {
    return {
        sessionId: id,
        destroy: destroyError
            ? vi.fn().mockRejectedValue(destroyError)
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

    it('abort destroys the session and untracks it', async () => {
        const s = makeSession('s2');
        manager.track(s);
        const result = await manager.abort('s2');
        expect(result).toBe(true);
        expect(s.destroy).toHaveBeenCalledOnce();
        expect(manager.has('s2')).toBe(false);
        expect(manager.count()).toBe(0);
    });

    it('abort returns false and untracks when destroy throws', async () => {
        const s = makeSession('err', new Error('destroy failed'));
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

    it('abortAll destroys all sessions and clears the map', async () => {
        const sessions = ['a', 'b', 'c'].map(id => makeSession(id));
        sessions.forEach(s => manager.track(s));

        await manager.abortAll();

        for (const s of sessions) {
            expect(s.destroy).toHaveBeenCalledOnce();
        }
        expect(manager.count()).toBe(0);
    });

    it('abortAll is a no-op when there are no sessions', async () => {
        await expect(manager.abortAll()).resolves.not.toThrow();
        expect(manager.count()).toBe(0);
    });

    it('abortAll completes even when some sessions throw on destroy', async () => {
        manager.track(makeSession('ok'));
        manager.track(makeSession('bad', new Error('boom')));
        await expect(manager.abortAll()).resolves.not.toThrow();
        expect(manager.count()).toBe(0);
    });
});
