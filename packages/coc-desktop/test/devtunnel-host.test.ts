/**
 * Unit tests for the DevTunnel host lifecycle (AC-03).
 *
 * `devtunnel-host.ts` is electron-free and drives every `devtunnel host`
 * invocation through an injectable spawner plus injectable timer seams, so the
 * whole state machine — URL parsing, readiness timeout, serialized transitions,
 * duplicate-start prevention, unexpected-exit reconnect with exponential backoff
 * and cap, backoff reset, immediate Retry, Stop, and quit cleanup — is asserted
 * here under plain Node with fakes; no real CLI or timer is ever used.
 */

import { describe, it, expect, vi } from 'vitest';
import {
    DevTunnelHostManager,
    DevTunnelHostProcess,
    DevTunnelHostSpawner,
    DevTunnelHostState,
    computeBackoffMs,
    createDevTunnelHostManager,
    devTunnelUrlMatchesPort,
    killProcessTree,
    resolveUrlTimeoutMs,
    selectDevTunnelUrl,
} from '../src/devtunnel-host';
import type { DevTunnelConfigureResult } from '../src/devtunnel-cli';

const TUNNEL = 'box-coc';
const PORT = 4000;
const URL_TIMEOUT_MS = 5_000;

/** Flush pending microtasks (real setImmediate, unaffected by injected timers). */
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

/** A public URL whose host label encodes the active port. */
function urlFor(port: number): string {
    return `https://${TUNNEL}-${port}.usw2.devtunnels.ms/`;
}

/** A controllable fake `devtunnel host` process. */
class FakeHostProcess implements DevTunnelHostProcess {
    pid: number | undefined = 4321;
    killCount = 0;
    private readonly outputListeners: Array<(chunk: string) => void> = [];
    private readonly exitListeners: Array<(code: number | null, signal: string | null) => void> = [];

    constructor(public readonly cliPath: string, public readonly tunnelId: string) {}

    onOutput(listener: (chunk: string) => void): void {
        this.outputListeners.push(listener);
    }

    onExit(listener: (code: number | null, signal: string | null) => void): void {
        this.exitListeners.push(listener);
    }

    kill(): void {
        this.killCount += 1;
    }

    get killed(): boolean {
        return this.killCount > 0;
    }

    emit(chunk: string): void {
        for (const listener of [...this.outputListeners]) {
            listener(chunk);
        }
    }

    exit(code: number | null = 1, signal: string | null = null): void {
        for (const listener of [...this.exitListeners]) {
            listener(code, signal);
        }
    }
}

function makeSpawner(): { spawner: DevTunnelHostSpawner; procs: FakeHostProcess[]; last: () => FakeHostProcess } {
    const procs: FakeHostProcess[] = [];
    const spawner: DevTunnelHostSpawner = (cliPath, tunnelId) => {
        const proc = new FakeHostProcess(cliPath, tunnelId);
        procs.push(proc);
        return proc;
    };
    return { spawner, procs, last: () => procs[procs.length - 1] };
}

/** Deterministic timer harness: capture, inspect, and fire timers by hand. */
class TimerHarness {
    private seq = 0;
    private readonly timers = new Map<number, { fn: () => void; ms: number }>();

    readonly setTimer = (fn: () => void, ms: number): ReturnType<typeof setTimeout> => {
        const id = ++this.seq;
        this.timers.set(id, { fn, ms });
        return id as unknown as ReturnType<typeof setTimeout>;
    };

    readonly clearTimer = (timer: ReturnType<typeof setTimeout>): void => {
        this.timers.delete(timer as unknown as number);
    };

    pending(): number[] {
        return [...this.timers.values()].map((t) => t.ms);
    }

    /** Assert exactly one pending timer and fire it, returning its delay ms. */
    fireOnly(): number {
        const entries = [...this.timers.entries()];
        expect(entries.length).toBe(1);
        const [id, { fn, ms }] = entries[0];
        this.timers.delete(id);
        fn();
        return ms;
    }
}

const okBinding =
    (port = PORT) =>
    async (): Promise<DevTunnelConfigureResult> => ({ ok: true, port });

const failBinding =
    (category: DevTunnelConfigureResult extends { ok: false; category: infer C } ? C : never, message = 'boom') =>
    async (): Promise<DevTunnelConfigureResult> => ({ ok: false, category, message });

interface Harness {
    manager: DevTunnelHostManager;
    procs: FakeHostProcess[];
    last: () => FakeHostProcess;
    timers: TimerHarness;
    states: DevTunnelHostState[];
    notifications: Array<{ category: string; message: string }>;
}

function makeManager(overrides: Partial<Parameters<typeof createDevTunnelHostManager>[0]> = {}): Harness {
    const { spawner, procs, last } = makeSpawner();
    const timers = new TimerHarness();
    const states: DevTunnelHostState[] = [];
    const notifications: Array<{ category: string; message: string }> = [];
    const manager = createDevTunnelHostManager({
        ensureBinding: okBinding(),
        resolveCliPath: () => '/opt/devtunnel',
        spawn: spawner,
        urlTimeoutMs: URL_TIMEOUT_MS,
        setTimer: timers.setTimer,
        clearTimer: timers.clearTimer,
        onStateChange: (s) => states.push(s),
        onFailureNotification: (e) => notifications.push({ category: e.category, message: e.message }),
        log: () => {},
        ...overrides,
    });
    return { manager, procs, last, timers, states, notifications };
}

/** Start and reach Online; returns the live host process. */
async function bringOnline(h: Harness, port = PORT): Promise<FakeHostProcess> {
    const started = h.manager.start({ tunnelId: TUNNEL, port });
    await flush();
    h.last().emit(`Connect via browser: ${urlFor(port)}\n`);
    const state = await started;
    expect(state.status).toBe('online');
    return h.last();
}

// ── Pure helpers ────────────────────────────────────────────────────────────

describe('selectDevTunnelUrl', () => {
    it('prefers the URL whose host label matches the active port', () => {
        const text = [
            'Hosting port 22 at https://box-coc-22.usw2.devtunnels.ms/',
            'Hosting port 4000 at https://box-coc-4000.usw2.devtunnels.ms/',
        ].join('\n');
        expect(selectDevTunnelUrl(text, 4000)).toBe('https://box-coc-4000.usw2.devtunnels.ms/');
    });

    it('falls back to the first devtunnels URL when none matches the port', () => {
        const text = 'Dashboard: https://box-coc.usw2.devtunnels.ms/ (no port label)';
        expect(selectDevTunnelUrl(text, 4000)).toBe('https://box-coc.usw2.devtunnels.ms/');
    });

    it('strips trailing punctuation from a captured URL', () => {
        const text = 'Open (https://box-coc-4000.usw2.devtunnels.ms/).';
        expect(selectDevTunnelUrl(text, 4000)).toBe('https://box-coc-4000.usw2.devtunnels.ms/');
    });

    it('returns undefined when no devtunnels URL is present', () => {
        expect(selectDevTunnelUrl('starting host...', 4000)).toBeUndefined();
        expect(selectDevTunnelUrl('', 4000)).toBeUndefined();
    });
});

describe('devTunnelUrlMatchesPort', () => {
    it('matches when an explicit URL port equals the active port', () => {
        expect(devTunnelUrlMatchesPort('https://host.devtunnels.ms:4000/', 4000)).toBe(true);
    });

    it('matches when the host label encodes the port', () => {
        expect(devTunnelUrlMatchesPort('https://box-coc-4000.usw2.devtunnels.ms/', 4000)).toBe(true);
    });

    it('does not match an unrelated port or a non-URL', () => {
        expect(devTunnelUrlMatchesPort('https://box-coc-8080.usw2.devtunnels.ms/', 4000)).toBe(false);
        expect(devTunnelUrlMatchesPort('not-a-url', 4000)).toBe(false);
    });
});

describe('resolveUrlTimeoutMs', () => {
    it('defaults to 30 seconds', () => {
        expect(resolveUrlTimeoutMs({})).toBe(30_000);
    });

    it('honors a positive-integer COC_DEVTUNNEL_URL_TIMEOUT override (seconds)', () => {
        expect(resolveUrlTimeoutMs({ COC_DEVTUNNEL_URL_TIMEOUT: '45' })).toBe(45_000);
    });

    it('ignores a zero, negative, or non-numeric override', () => {
        expect(resolveUrlTimeoutMs({ COC_DEVTUNNEL_URL_TIMEOUT: '0' })).toBe(30_000);
        expect(resolveUrlTimeoutMs({ COC_DEVTUNNEL_URL_TIMEOUT: '-5' })).toBe(30_000);
        expect(resolveUrlTimeoutMs({ COC_DEVTUNNEL_URL_TIMEOUT: 'soon' })).toBe(30_000);
    });
});

describe('computeBackoffMs', () => {
    it('doubles from 2s and caps at 30s', () => {
        expect(computeBackoffMs(0)).toBe(2_000);
        expect(computeBackoffMs(1)).toBe(4_000);
        expect(computeBackoffMs(2)).toBe(8_000);
        expect(computeBackoffMs(3)).toBe(16_000);
        expect(computeBackoffMs(4)).toBe(30_000);
        expect(computeBackoffMs(10)).toBe(30_000);
    });
});

describe('killProcessTree', () => {
    it('shells taskkill /T /F on Windows', () => {
        const spawnFn = vi.fn(() => ({ on: () => {} }));
        killProcessTree({ pid: 123, kill: () => {} }, { platform: 'win32', spawn: spawnFn as never });
        expect(spawnFn).toHaveBeenCalledWith('taskkill', ['/pid', '123', '/T', '/F'], { windowsHide: true });
    });

    it('falls back to SIGKILL off Windows', () => {
        const kill = vi.fn();
        const spawnFn = vi.fn();
        killProcessTree({ pid: 123, kill }, { platform: 'linux', spawn: spawnFn as never });
        expect(kill).toHaveBeenCalledWith('SIGKILL');
        expect(spawnFn).not.toHaveBeenCalled();
    });
});

// ── State machine ─────────────────────────────────────────────────────────

describe('DevTunnelHostManager.start', () => {
    it('transitions off → starting → online and exposes the public URL', async () => {
        const h = makeManager();
        expect(h.manager.state.status).toBe('off');
        const proc = await bringOnline(h);
        expect(proc.tunnelId).toBe(TUNNEL);
        expect(h.manager.state.status).toBe('online');
        expect(h.manager.state.publicUrl).toBe(urlFor(PORT));
        expect(h.states.map((s) => s.status)).toEqual(['starting', 'online']);
    });

    it('selects the port-matched URL when several are printed', async () => {
        const h = makeManager();
        const started = h.manager.start({ tunnelId: TUNNEL, port: PORT });
        await flush();
        h.last().emit(`ssh https://box-coc-22.usw2.devtunnels.ms/\nhttp ${urlFor(PORT)}\n`);
        const state = await started;
        expect(state.publicUrl).toBe(urlFor(PORT));
    });

    it('never spawns devtunnel host when the HTTP binding is not ok (failed/ambiguous)', async () => {
        const h = makeManager({ ensureBinding: failBinding('multiple-http-ports', 'two http ports') });
        const state = await h.manager.start({ tunnelId: TUNNEL, port: PORT });
        expect(state.status).toBe('failed');
        expect(state.error?.category).toBe('multiple-http-ports');
        expect(h.procs).toHaveLength(0);
    });

    it('fails as cli-missing when the host CLI cannot be resolved after binding', async () => {
        const h = makeManager({ resolveCliPath: () => undefined });
        const state = await h.manager.start({ tunnelId: TUNNEL, port: PORT });
        expect(state.status).toBe('failed');
        expect(state.error?.category).toBe('cli-missing');
        expect(h.procs).toHaveLength(0);
    });

    it('fails with url-timeout and kills the child when no URL is published in time', async () => {
        const h = makeManager();
        const started = h.manager.start({ tunnelId: TUNNEL, port: PORT });
        await flush();
        const proc = h.last();
        // The only pending timer is the URL-readiness deadline.
        expect(h.timers.fireOnly()).toBe(URL_TIMEOUT_MS);
        const state = await started;
        expect(state.status).toBe('failed');
        expect(state.error?.category).toBe('url-timeout');
        expect(proc.killed).toBe(true);
    });

    it('does not spawn a second host child while an attempt is already awaiting a URL', async () => {
        const h = makeManager();
        const first = h.manager.start({ tunnelId: TUNNEL, port: PORT });
        await flush();
        // A second Start while awaiting-url is a no-op (duplicate prevention).
        await h.manager.start({ tunnelId: TUNNEL, port: PORT });
        expect(h.procs).toHaveLength(1);
        h.last().emit(urlFor(PORT));
        await first;
        expect(h.procs).toHaveLength(1);
    });

    it('does not spawn a second host child once online', async () => {
        const h = makeManager();
        await bringOnline(h);
        await h.manager.start({ tunnelId: TUNNEL, port: PORT });
        expect(h.procs).toHaveLength(1);
    });
});

describe('DevTunnelHostManager reconnect', () => {
    it('reconnects with exponential backoff after an unexpected exit and resets on Online', async () => {
        const h = makeManager();
        const proc0 = await bringOnline(h);

        // Post-online unexpected exit → first reconnect scheduled at 2s.
        proc0.exit(1);
        expect(h.manager.state.status).toBe('failed');
        expect(h.manager.state.error?.category).toBe('unexpected-exit');

        // Escalating backoff on repeated exit-before-URL: 2s, 4s, 8s, 16s, cap 30s.
        const delays: number[] = [];
        for (const _ of [0, 1, 2, 3, 4]) {
            delays.push(h.timers.fireOnly()); // fire the pending backoff timer
            await flush(); // let the reconnect attempt spawn a new child
            h.last().exit(1); // it dies before publishing a URL
        }
        expect(delays).toEqual([2_000, 4_000, 8_000, 16_000, 30_000]);

        // A successful reconnect resets the backoff.
        const delayAfterCap = h.timers.fireOnly();
        expect(delayAfterCap).toBe(30_000);
        await flush();
        h.last().emit(urlFor(PORT));
        await flush();
        expect(h.manager.state.status).toBe('online');

        // The next post-online exit starts the backoff schedule over at 2s.
        h.last().exit(1);
        expect(h.timers.pending()).toEqual([2_000]);
    });

    it('emits a single failure notification across an entire reconnect episode', async () => {
        const h = makeManager();
        const proc0 = await bringOnline(h);
        proc0.exit(1); // opens the episode → one notification
        for (const _ of [0, 1, 2]) {
            h.timers.fireOnly();
            await flush();
            h.last().exit(1); // still failing — must not re-notify
        }
        expect(h.notifications).toHaveLength(1);
        expect(h.notifications[0].category).toBe('unexpected-exit');
    });

    it('immediate Retry cancels a pending backoff and attempts now', async () => {
        const h = makeManager();
        const proc0 = await bringOnline(h);
        proc0.exit(1);
        expect(h.timers.pending()).toEqual([2_000]); // backoff pending

        const retried = h.manager.retry();
        expect(h.timers.pending()).not.toContain(2_000); // backoff cancelled
        await flush();
        expect(h.procs).toHaveLength(2); // a fresh attempt started immediately
        h.last().emit(urlFor(PORT));
        const state = await retried;
        expect(state.status).toBe('online');
    });
});

describe('DevTunnelHostManager.stop / dispose', () => {
    it('stop kills the host tree, cancels timers, and reports off', async () => {
        const h = makeManager();
        const proc0 = await bringOnline(h);
        proc0.exit(1); // schedule a reconnect timer
        expect(h.timers.pending()).toEqual([2_000]);

        const state = await h.manager.stop();
        expect(state.status).toBe('off');
        expect(h.timers.pending()).toEqual([]); // backoff cancelled
    });

    it('a child that exits after Stop does not trigger a reconnect', async () => {
        const h = makeManager();
        const proc0 = await bringOnline(h);
        await h.manager.stop();
        expect(proc0.killed).toBe(true);
        proc0.exit(0); // late exit of the killed child
        expect(h.manager.state.status).toBe('off');
        expect(h.timers.pending()).toEqual([]); // no reconnect scheduled
    });

    it('Stop while awaiting a URL kills the child and settles the pending start', async () => {
        const h = makeManager();
        const started = h.manager.start({ tunnelId: TUNNEL, port: PORT });
        await flush();
        const proc = h.last();
        const stopped = await h.manager.stop();
        expect(stopped.status).toBe('off');
        expect(proc.killed).toBe(true);
        // The in-flight start() resolves rather than hanging.
        const startState = await started;
        expect(startState.status).toBe('off');
        // A late exit of the killed child must not reconnect.
        proc.exit(1);
        expect(h.timers.pending()).toEqual([]);
    });

    it('dispose (quit cleanup) reaps a live host child without reconnecting', async () => {
        const h = makeManager();
        const proc0 = await bringOnline(h);
        h.manager.dispose();
        expect(proc0.killed).toBe(true);
        expect(h.timers.pending()).toEqual([]);
        // A late exit of the reaped child must not schedule a reconnect.
        proc0.exit(0);
        expect(h.timers.pending()).toEqual([]);
    });

    it('dispose cancels a pending reconnect timer left by an unexpected exit', async () => {
        const h = makeManager();
        const proc0 = await bringOnline(h);
        proc0.exit(1); // schedules a backoff reconnect
        expect(h.timers.pending()).toEqual([2_000]);
        h.manager.dispose();
        expect(h.timers.pending()).toEqual([]);
    });

    it('never terminates the CoC server: the manager holds no server reference', async () => {
        const serverChild = { kill: vi.fn() };
        const h = makeManager();
        await bringOnline(h);
        await h.manager.stop();
        h.manager.dispose();
        expect(serverChild.kill).not.toHaveBeenCalled();
    });
});

describe('DevTunnelHostManager failure UX (AC-04 seam)', () => {
    it('a manual Start failure returns the failed state without a notification (modal path)', async () => {
        const h = makeManager({ ensureBinding: failBinding('unauthenticated', 'log in') });
        const state = await h.manager.start({ tunnelId: TUNNEL, port: PORT });
        expect(state.status).toBe('failed');
        expect(state.error?.category).toBe('unauthenticated');
        expect(h.notifications).toHaveLength(0);
    });

    it('a launch (auto) Start failure fires exactly one notification', async () => {
        const h = makeManager({ ensureBinding: failBinding('unauthenticated', 'log in') });
        await h.manager.start({ tunnelId: TUNNEL, port: PORT }, { trigger: 'launch' });
        expect(h.notifications).toHaveLength(1);
        expect(h.notifications[0].category).toBe('unauthenticated');
    });

    it('recovery to Online clears the stale error from the state', async () => {
        const h = makeManager({ ensureBinding: failBinding('unauthenticated', 'log in') });
        await h.manager.start({ tunnelId: TUNNEL, port: PORT });
        expect(h.manager.state.error?.category).toBe('unauthenticated');
        // Fix the binding and retry to success.
        (h.manager as unknown as { _ensureBinding: () => Promise<DevTunnelConfigureResult> })._ensureBinding =
            okBinding();
        const retried = h.manager.retry();
        await flush();
        h.last().emit(urlFor(PORT));
        const state = await retried;
        expect(state.status).toBe('online');
        expect(state.error).toBeUndefined();
    });
});

describe('DevTunnelHostManager.reconfigure', () => {
    it('stops the old host and starts the newly configured tunnel while enabled', async () => {
        const h = makeManager();
        const proc0 = await bringOnline(h);
        const reconfigured = h.manager.reconfigure({ tunnelId: 'other-coc' });
        expect(proc0.killed).toBe(true);
        await flush();
        expect(h.last().tunnelId).toBe('other-coc');
        h.last().emit('https://other-coc-4000.usw2.devtunnels.ms/');
        const state = await reconfigured;
        expect(state.status).toBe('online');
        expect(state.publicUrl).toBe('https://other-coc-4000.usw2.devtunnels.ms/');
    });

    it('while disabled only records the new id and stays off', async () => {
        const h = makeManager();
        const state = await h.manager.reconfigure({ tunnelId: 'other-coc' });
        expect(state.status).toBe('off');
        expect(h.procs).toHaveLength(0);
    });
});
