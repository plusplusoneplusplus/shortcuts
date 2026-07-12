/**
 * CoC Desktop — DevTunnel launch orchestration (AC-01 auto-start, AC-04 non-blocking).
 *
 * The Electron-free glue between the persisted preference (`devtunnel-config.ts`),
 * the host manager (`devtunnel-host.ts`), and `main.ts`'s bootstrap. Keeping the
 * launch-time decision here — not inline in `main.ts` — lets Vitest prove two
 * guarantees under plain Node without an Electron runtime:
 *
 *   - AC-01 DoD#2 relaunch: Start persists `enabled: true` so a later launch
 *     auto-starts; Stop persists `enabled: false` so a later launch stays off.
 *     {@link shouldAutoStartTunnel} is the single launch-time gate, reading only
 *     the persisted `enabled` flag (Retry never changes it).
 *   - AC-04 non-blocking startup: a DevTunnel config/host failure never blocks or
 *     delays the local SPA. {@link autoStartDevTunnelOnLaunch} is invoked AFTER
 *     the window is already shown; it reads the preference and, when enabled,
 *     fires `manager.start(..., { trigger: 'launch' })` fire-and-forget. It never
 *     awaits the manager and never throws, so a malformed config or a manager
 *     that rejects can never interrupt the bootstrap path.
 *
 * This module imports nothing from `electron`.
 */

import type { DevTunnelConfig } from './devtunnel-config';
import type { DevTunnelHostState } from './devtunnel-host';

/**
 * The single launch-time gate: should Desktop auto-start the tunnel this launch?
 *
 * Reads ONLY the persisted `enabled` flag. Start persists `true`, Stop persists
 * `false`, and Retry never changes it — so a relaunch after Start auto-starts and
 * a relaunch after Stop stays off (AC-01 DoD#2). A missing preference reads as
 * `enabled: false`, so a never-configured machine also stays off.
 */
export function shouldAutoStartTunnel(config: DevTunnelConfig): boolean {
    return config.enabled === true;
}

/** The subset of the host manager the launch path drives. */
export interface DevTunnelLaunchManager {
    start(
        params: { tunnelId: string; port: number },
        opts: { trigger?: 'manual' | 'launch' },
    ): Promise<DevTunnelHostState>;
}

/** Injectable seams for {@link autoStartDevTunnelOnLaunch}. */
export interface AutoStartDevTunnelDeps {
    /** The active CoC server port the tunnel must expose (loopback-bound). */
    port: number;
    /**
     * Read the persisted preference. May throw (e.g. `DevTunnelConfigError` on a
     * malformed file); that must NOT block startup, so it is caught here.
     */
    readConfig: () => DevTunnelConfig;
    /** The host manager to kick — `start` is fired fire-and-forget. */
    manager: DevTunnelLaunchManager;
    /** Bounded diagnostic sink (defaults to the desktop process stderr). */
    log?: (message: string) => void;
}

function errMessage(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
}

/**
 * Auto-start the tunnel on launch when enabled — the AC-04 non-blocking guarantee
 * in code form. It is called AFTER the local SPA is already shown, reads the
 * persisted preference, and when enabled fires `manager.start(..., { trigger:
 * 'launch' })` fire-and-forget.
 *
 * Contract: this NEVER blocks (it does not await the manager) and NEVER throws (a
 * malformed config, or a manager that rejects OR throws synchronously, is
 * swallowed and logged). So a DevTunnel failure can never delay or crash the
 * desktop window. Returns `true` when a launch attempt was initiated, `false`
 * when the feature is off or the preference was unreadable.
 */
export function autoStartDevTunnelOnLaunch(deps: AutoStartDevTunnelDeps): boolean {
    const log = deps.log ?? ((message) => process.stderr.write(`${message}\n`));
    let config: DevTunnelConfig;
    try {
        config = deps.readConfig();
    } catch (err) {
        // A corrupt/unreadable preference must never wedge startup — stay off.
        log(`[devtunnel] auto-start skipped (config unreadable): ${errMessage(err)}`);
        return false;
    }
    if (!shouldAutoStartTunnel(config)) {
        return false;
    }
    // Fire-and-forget in a microtask so that even a manager mock which throws
    // synchronously becomes a caught rejection — the bootstrap path is never
    // interrupted, and the returned boolean is produced without awaiting start().
    void Promise.resolve()
        .then(() => deps.manager.start(
            { tunnelId: config.tunnelId, port: deps.port },
            { trigger: 'launch' },
        ))
        .catch((err) => {
            log(`[devtunnel] auto-start failed: ${errMessage(err)}`);
        });
    return true;
}
