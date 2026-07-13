/**
 * Unit tests for the DevTunnel launch orchestration (AC-01 auto-start, AC-04
 * non-blocking).
 *
 * `devtunnel-launch.ts` is electron-free, so the two guarantees it encodes are
 * asserted here under plain Node:
 *
 *   - AC-01 DoD#2 relaunch: Start persists `enabled: true` → a later launch
 *     auto-starts; Stop persists `enabled: false` → a later launch stays off.
 *     Proven end-to-end through the real preference store round-trip.
 *   - AC-04 non-blocking startup: injecting a config/host failure never blocks or
 *     throws out of the launch path, so the local SPA bootstrap is never delayed
 *     or crashed by a DevTunnel problem.
 */

import { describe, it, expect, vi } from 'vitest';
import {
    DevTunnelConfig,
    DevTunnelConfigStore,
    defaultDevTunnelConfig,
    readDevTunnelConfig,
    setDevTunnelEnabled,
} from '../src/devtunnel-config';
import {
    AutoStartDevTunnelDeps,
    DevTunnelLaunchManager,
    autoStartDevTunnelOnLaunch,
    shouldAutoStartTunnel,
} from '../src/devtunnel-launch';
import type { DevTunnelHostState } from '../src/devtunnel-host';

const DATA_DIR = '/home/user/.coc';

/** Flush the microtask queue (and one macrotask) so fire-and-forget work runs. */
function flush(): Promise<void> {
    return new Promise((resolve) => setImmediate(resolve));
}

/** A minimal in-memory {@link DevTunnelConfigStore} for the relaunch round-trip. */
function memStore(seed: Record<string, string> = {}): DevTunnelConfigStore {
    const files = new Map<string, string>(Object.entries(seed));
    return {
        readText: (p) => {
            if (!files.has(p)) {
                throw Object.assign(new Error(`ENOENT: ${p}`), { code: 'ENOENT' });
            }
            return files.get(p) as string;
        },
        writeText: (p, data) => { files.set(p, data); },
        rename: (from, to) => {
            files.set(to, files.get(from) as string);
            files.delete(from);
        },
        ensureDir: () => { /* no-op */ },
    };
}

/** A launch manager that records how `start` was called. */
function recordingManager(
    startImpl: DevTunnelLaunchManager['start'] = () => Promise.resolve({ status: 'online', publicUrl: 'https://x-4000.devtunnels.ms' } as DevTunnelHostState),
): { manager: DevTunnelLaunchManager; calls: Array<{ params: { tunnelId: string; port: number }; opts: { trigger?: 'manual' | 'launch' } }> } {
    const calls: Array<{ params: { tunnelId: string; port: number }; opts: { trigger?: 'manual' | 'launch' } }> = [];
    const manager: DevTunnelLaunchManager = {
        start: (params, opts) => {
            calls.push({ params, opts });
            return startImpl(params, opts);
        },
    };
    return { manager, calls };
}

function baseDeps(overrides: Partial<AutoStartDevTunnelDeps> = {}): AutoStartDevTunnelDeps {
    return {
        port: 4000,
        readConfig: () => ({ tunnelId: 'mybox-coc', enabled: true, version: 1 }),
        manager: recordingManager().manager,
        log: () => { /* silent */ },
        ...overrides,
    };
}

describe('shouldAutoStartTunnel', () => {
    it('auto-starts only when the persisted preference is enabled', () => {
        expect(shouldAutoStartTunnel({ tunnelId: 'a-coc', enabled: true, version: 1 })).toBe(true);
        expect(shouldAutoStartTunnel({ tunnelId: 'a-coc', enabled: false, version: 1 })).toBe(false);
    });

    it('stays off for the default (never-configured) preference', () => {
        expect(shouldAutoStartTunnel(defaultDevTunnelConfig('mybox'))).toBe(false);
    });
});

describe('autoStartDevTunnelOnLaunch — enabled path', () => {
    it('fires manager.start with the launch trigger, configured id, and active port', async () => {
        const { manager, calls } = recordingManager();
        const initiated = autoStartDevTunnelOnLaunch(baseDeps({
            port: 4321,
            readConfig: () => ({ tunnelId: 'mybox-coc', enabled: true, version: 1 }),
            manager,
        }));

        expect(initiated).toBe(true);
        // Fire-and-forget: start() is deferred to a microtask, not called inline.
        expect(calls).toHaveLength(0);
        await flush();
        expect(calls).toHaveLength(1);
        expect(calls[0].params).toEqual({ tunnelId: 'mybox-coc', port: 4321 });
        expect(calls[0].opts).toEqual({ trigger: 'launch' });
    });
});

describe('autoStartDevTunnelOnLaunch — off path', () => {
    it('does nothing when the preference is disabled', async () => {
        const { manager, calls } = recordingManager();
        const initiated = autoStartDevTunnelOnLaunch(baseDeps({
            readConfig: () => ({ tunnelId: 'mybox-coc', enabled: false, version: 1 }),
            manager,
        }));

        expect(initiated).toBe(false);
        await flush();
        expect(calls).toHaveLength(0);
    });

    it('stays off (never starts) when the preference is unreadable, logging once', async () => {
        const { manager, calls } = recordingManager();
        const log = vi.fn();
        const initiated = autoStartDevTunnelOnLaunch(baseDeps({
            readConfig: () => { throw new Error('desktop-devtunnel.json contains invalid JSON'); },
            manager,
            log,
        }));

        expect(initiated).toBe(false);
        await flush();
        expect(calls).toHaveLength(0);
        expect(log).toHaveBeenCalledTimes(1);
        expect(log.mock.calls[0][0]).toContain('config unreadable');
    });
});

describe('autoStartDevTunnelOnLaunch — non-blocking / never-throws (AC-04)', () => {
    it('returns synchronously without awaiting a manager whose start never resolves', () => {
        const { manager, calls } = recordingManager(() => new Promise<DevTunnelHostState>(() => { /* never resolves */ }));
        // No await: the call must complete even though start() hangs forever.
        const initiated = autoStartDevTunnelOnLaunch(baseDeps({ manager }));
        expect(initiated).toBe(true);
        // Not called synchronously (deferred), and crucially the call above returned.
        expect(calls).toHaveLength(0);
    });

    it('does not throw and logs when the manager start throws synchronously', async () => {
        const log = vi.fn();
        const manager: DevTunnelLaunchManager = {
            start: () => { throw new Error('spawn boom'); },
        };
        expect(() => autoStartDevTunnelOnLaunch(baseDeps({ manager, log }))).not.toThrow();
        await flush();
        expect(log).toHaveBeenCalledTimes(1);
        expect(log.mock.calls[0][0]).toContain('auto-start failed');
        expect(log.mock.calls[0][0]).toContain('spawn boom');
    });

    it('swallows a rejected manager start (no unhandled rejection) and logs', async () => {
        const log = vi.fn();
        const rejection = vi.fn();
        process.on('unhandledRejection', rejection);
        try {
            const manager: DevTunnelLaunchManager = {
                start: () => Promise.reject(new Error('host exited')),
            };
            autoStartDevTunnelOnLaunch(baseDeps({ manager, log }));
            await flush();
        } finally {
            process.off('unhandledRejection', rejection);
        }
        expect(rejection).not.toHaveBeenCalled();
        expect(log).toHaveBeenCalledTimes(1);
        expect(log.mock.calls[0][0]).toContain('auto-start failed');
        expect(log.mock.calls[0][0]).toContain('host exited');
    });
});

describe('relaunch auto-start decision through the real preference store (AC-01 DoD#2)', () => {
    it('Start enables later auto-start; Stop prevents it', () => {
        // Fresh machine, no saved preference → next launch stays off.
        const store = memStore();
        expect(shouldAutoStartTunnel(readDevTunnelConfig(DATA_DIR, store))).toBe(false);

        // Choosing Start persists enabled → a later launch auto-starts.
        setDevTunnelEnabled(DATA_DIR, true, store);
        const afterStart: DevTunnelConfig = readDevTunnelConfig(DATA_DIR, store);
        expect(afterStart.enabled).toBe(true);
        expect(shouldAutoStartTunnel(afterStart)).toBe(true);

        // Choosing Stop persists disabled → a later launch stays off.
        setDevTunnelEnabled(DATA_DIR, false, store);
        const afterStop: DevTunnelConfig = readDevTunnelConfig(DATA_DIR, store);
        expect(afterStop.enabled).toBe(false);
        expect(shouldAutoStartTunnel(afterStop)).toBe(false);
    });

    it('a relaunch after Start actually fires a launch attempt with the persisted id', async () => {
        const store = memStore();
        setDevTunnelEnabled(DATA_DIR, true, store);

        const { manager, calls } = recordingManager();
        const initiated = autoStartDevTunnelOnLaunch({
            port: 5000,
            readConfig: () => readDevTunnelConfig(DATA_DIR, store),
            manager,
            log: () => { /* silent */ },
        });

        expect(initiated).toBe(true);
        await flush();
        expect(calls).toHaveLength(1);
        expect(calls[0].opts.trigger).toBe('launch');
        expect(calls[0].params.port).toBe(5000);
        // The persisted default id round-trips through the store.
        expect(calls[0].params.tunnelId).toMatch(/-coc$/);
    });

    it('a relaunch after Stop fires no launch attempt', async () => {
        const store = memStore();
        setDevTunnelEnabled(DATA_DIR, true, store);
        setDevTunnelEnabled(DATA_DIR, false, store);

        const { manager, calls } = recordingManager();
        const initiated = autoStartDevTunnelOnLaunch({
            port: 5000,
            readConfig: () => readDevTunnelConfig(DATA_DIR, store),
            manager,
            log: () => { /* silent */ },
        });

        expect(initiated).toBe(false);
        await flush();
        expect(calls).toHaveLength(0);
    });
});
