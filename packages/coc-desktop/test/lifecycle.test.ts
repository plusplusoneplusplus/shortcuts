/**
 * Unit tests for the AC-05 lifecycle helpers.
 *
 * The drain guard and external-link routing are electron-free and take
 * injectable timer seams + a fake child process, so we can assert the
 * started-vs-attached behaviour and the open-in-browser decision without an
 * Electron runtime or a real forked server.
 */

import { EventEmitter } from 'events';
import type { ChildProcess } from 'child_process';
import { describe, it, expect } from 'vitest';
import { shutdownServer, shouldOpenExternally } from '../src/lifecycle';
import type { ServerHandle } from '../src/server-controller';

/** Minimal stand-in for the forked child: records sends/kills, emits `exit`. */
class FakeChild extends EventEmitter {
    killed = false;
    sent: unknown[] = [];
    killSignals: Array<NodeJS.Signals | undefined> = [];
    /** Optional hook to simulate a closed IPC channel (send throws). */
    sendImpl?: (message: unknown) => void;

    send(message: unknown): boolean {
        if (this.sendImpl) {
            this.sendImpl(message);
        }
        this.sent.push(message);
        return true;
    }

    kill(signal?: NodeJS.Signals): boolean {
        this.killed = true;
        this.killSignals.push(signal);
        return true;
    }
}

function handleWith(overrides: Partial<ServerHandle>): ServerHandle {
    return {
        host: '127.0.0.1',
        port: 51234,
        url: 'http://127.0.0.1:51234',
        started: true,
        ...overrides,
    };
}

/** A timer seam that captures the scheduled callback so the test can fire it. */
function manualTimer() {
    const calls: Array<{ fn: () => void; ms: number }> = [];
    let cleared = false;
    return {
        calls,
        get cleared() {
            return cleared;
        },
        setTimer: (fn: () => void, ms: number) => {
            calls.push({ fn, ms });
            return 1 as unknown as ReturnType<typeof setTimeout>;
        },
        clearTimer: () => {
            cleared = true;
        },
        fire: () => calls[0]?.fn(),
    };
}

describe('shutdownServer — started-vs-attached guard', () => {
    it('returns noop when there is no server handle', async () => {
        expect(await shutdownServer(null)).toBe('noop');
    });

    it('detaches (never touches the child) when we only attached to an external server', async () => {
        const child = new FakeChild();
        const handle = handleWith({ started: false, child: child as unknown as ChildProcess });

        const outcome = await shutdownServer(handle);

        expect(outcome).toBe('detached');
        expect(child.sent).toEqual([]); // external/CLI server is left running
        expect(child.killed).toBe(false);
    });

    it('returns noop when started but there is no live child', async () => {
        expect(await shutdownServer(handleWith({ started: true, child: undefined }))).toBe('noop');

        const dead = new FakeChild();
        dead.killed = true;
        const outcome = await shutdownServer(
            handleWith({ started: true, child: dead as unknown as ChildProcess }),
        );
        expect(outcome).toBe('noop');
    });

    it('drains the forked child: sends shutdown+drain, resolves on exit', async () => {
        const child = new FakeChild();
        const timer = manualTimer();
        const handle = handleWith({ started: true, child: child as unknown as ChildProcess });

        const promise = shutdownServer(handle, {
            setTimer: timer.setTimer,
            clearTimer: timer.clearTimer,
        });

        // The child is asked to close({ drain: true }) over IPC.
        expect(child.sent).toEqual([{ type: 'shutdown', drain: true }]);

        // It drains and exits → outcome `drained`, and the kill timer is cleared.
        child.emit('exit', 0, null);
        expect(await promise).toBe('drained');
        expect(timer.cleared).toBe(true);
        expect(child.killed).toBe(false);
    });

    it('force-kills the child when the drain overruns the timeout', async () => {
        const child = new FakeChild();
        const timer = manualTimer();
        const handle = handleWith({ started: true, child: child as unknown as ChildProcess });

        const promise = shutdownServer(handle, {
            timeoutMs: 5_000,
            setTimer: timer.setTimer,
            clearTimer: timer.clearTimer,
        });

        expect(timer.calls[0]?.ms).toBe(5_000);
        timer.fire(); // drain never completes → timeout fires

        expect(await promise).toBe('killed');
        expect(child.killed).toBe(true);
        expect(child.killSignals).toContain('SIGKILL');
    });

    it('kills the child when the IPC channel is already closed (send throws)', async () => {
        const child = new FakeChild();
        child.sendImpl = () => {
            throw new Error('ERR_IPC_CHANNEL_CLOSED');
        };
        const timer = manualTimer();
        const handle = handleWith({ started: true, child: child as unknown as ChildProcess });

        const outcome = await shutdownServer(handle, {
            setTimer: timer.setTimer,
            clearTimer: timer.clearTimer,
        });

        expect(outcome).toBe('killed');
        expect(child.killed).toBe(true);
        expect(timer.cleared).toBe(true);
    });
});

describe('shouldOpenExternally — external-link routing', () => {
    const appOrigin = 'http://127.0.0.1:51234';

    it('keeps same-origin navigation in-window', () => {
        expect(shouldOpenExternally('http://127.0.0.1:51234/', appOrigin)).toBe(false);
        expect(shouldOpenExternally('http://127.0.0.1:51234/workspaces/abc', appOrigin)).toBe(false);
    });

    it('routes external http(s) links to the system browser', () => {
        expect(shouldOpenExternally('https://github.com/owner/repo/pull/1', appOrigin)).toBe(true);
        expect(shouldOpenExternally('http://example.com', appOrigin)).toBe(true);
    });

    it('treats a different port on the same host as external', () => {
        expect(shouldOpenExternally('http://127.0.0.1:4000/', appOrigin)).toBe(true);
    });

    it('leaves non-http(s) schemes to the window default', () => {
        expect(shouldOpenExternally('mailto:dev@example.com', appOrigin)).toBe(false);
        expect(shouldOpenExternally('data:text/html,<h1>hi</h1>', appOrigin)).toBe(false);
        expect(shouldOpenExternally('devtools://devtools/bundled/x.html', appOrigin)).toBe(false);
        expect(shouldOpenExternally('about:blank', appOrigin)).toBe(false);
    });

    it('does not route a non-absolute / unparseable URL', () => {
        expect(shouldOpenExternally('/relative/path', appOrigin)).toBe(false);
        expect(shouldOpenExternally('not a url', appOrigin)).toBe(false);
    });

    it('normalizes an app origin given as a full URL with a path', () => {
        expect(shouldOpenExternally('http://127.0.0.1:51234/x', 'http://127.0.0.1:51234/index.html')).toBe(false);
    });
});
