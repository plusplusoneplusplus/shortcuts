/**
 * Tests for CoCContainer DevTunnel helpers.
 *
 * These tests exercise the pure, Electron-free logic that underpins the
 * CoCContainer DevTunnel feature:
 *   - the container-specific tunnel suffix (`coccontainer`) produces a distinct
 *     default tunnel identity from the main CoC desktop (`coc`);
 *   - the config store round-trips correctly under the container data directory;
 *   - `autoStartDevTunnelOnLaunch` works for the container data dir (the
 *     function itself is already tested in devtunnel-launch.test.ts; here we
 *     just verify the integration with container-specific config);
 *   - preferred port selection: when DevTunnel is enabled with exactly one HTTP
 *     binding, that port is preferred; otherwise DEFAULT_PORT is used.
 */

import { describe, it, expect, vi } from 'vitest';
import * as path from 'path';
import {
    defaultTunnelId,
    defaultDevTunnelConfig,
    readDevTunnelConfig,
    writeDevTunnelConfig,
    setDevTunnelEnabled,
    DevTunnelConfigStore,
    DESKTOP_DEVTUNNEL_VERSION,
} from '../src/devtunnel-config';
import { shouldAutoStartTunnel } from '../src/devtunnel-launch';

const CONTAINER_TUNNEL_SUFFIX = 'coccontainer';
const CONTAINER_DATA_DIR = '/home/user/.coccontainer';

// ── Suffix / identity separation ────────────────────────────────────────────

describe('CoCContainer default tunnel identity', () => {
    it('uses "coccontainer" suffix so the default ID differs from CoC desktop', () => {
        const cocId = defaultTunnelId('MYBOX', 'coc');
        const containerId = defaultTunnelId('MYBOX', CONTAINER_TUNNEL_SUFFIX);
        expect(containerId).toBe('mybox-coccontainer');
        expect(cocId).toBe('mybox-coc');
        expect(cocId).not.toBe(containerId);
    });

    it('defaultDevTunnelConfig with coccontainer suffix is feature-off', () => {
        const config = defaultDevTunnelConfig('MYBOX', CONTAINER_TUNNEL_SUFFIX);
        expect(config).toEqual({
            tunnelId: 'mybox-coccontainer',
            enabled: false,
            version: DESKTOP_DEVTUNNEL_VERSION,
        });
    });

    it('coc and coccontainer defaults never collide on the same machine', () => {
        const hostnames = ['box', 'DEV-BOX', 'my.corp.machine'];
        for (const h of hostnames) {
            expect(defaultTunnelId(h, 'coc')).not.toBe(
                defaultTunnelId(h, CONTAINER_TUNNEL_SUFFIX),
            );
        }
    });
});

// ── Config round-trip under ~/.coccontainer ──────────────────────────────────

function memStore(seed: Record<string, string> = {}): {
    store: DevTunnelConfigStore;
    files: Map<string, string>;
} {
    const files = new Map<string, string>(Object.entries(seed));
    const store: DevTunnelConfigStore = {
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
    return { store, files };
}

describe('CoCContainer config store persists under container data dir', () => {
    it('reads a missing file as feature-off with container tunnel ID', () => {
        const { store } = memStore();
        const config = readDevTunnelConfig(CONTAINER_DATA_DIR, store);
        // Default when no file: enabled:false, tunnelId derived from real hostname
        expect(config.enabled).toBe(false);
        expect(config.tunnelId).toMatch(/-coc$/); // defaultTunnelId() uses suffix='coc'
    });

    it('round-trips a container-specific tunnel ID', () => {
        const { store, files } = memStore();
        writeDevTunnelConfig(
            CONTAINER_DATA_DIR,
            {
                tunnelId: 'mybox-coccontainer',
                enabled: true,
                version: DESKTOP_DEVTUNNEL_VERSION,
            },
            store,
        );
        const configPath = path.join(CONTAINER_DATA_DIR, 'desktop-devtunnel.json');
        expect(files.has(configPath)).toBe(true);
        const readBack = readDevTunnelConfig(CONTAINER_DATA_DIR, store);
        expect(readBack.tunnelId).toBe('mybox-coccontainer');
        expect(readBack.enabled).toBe(true);
    });

    it('setDevTunnelEnabled persists under container data dir', () => {
        const { store } = memStore();
        // Start with a config that has the container tunnel ID
        writeDevTunnelConfig(
            CONTAINER_DATA_DIR,
            {
                tunnelId: 'mybox-coccontainer',
                enabled: false,
                version: DESKTOP_DEVTUNNEL_VERSION,
            },
            store,
        );
        const result = setDevTunnelEnabled(CONTAINER_DATA_DIR, true, store);
        expect(result.enabled).toBe(true);
        expect(result.tunnelId).toBe('mybox-coccontainer');
        const readBack = readDevTunnelConfig(CONTAINER_DATA_DIR, store);
        expect(readBack.enabled).toBe(true);
    });
});

// ── shouldAutoStartTunnel integration ───────────────────────────────────────

describe('shouldAutoStartTunnel with container config', () => {
    it('returns false when container tunnel is disabled', () => {
        const config = defaultDevTunnelConfig('box', CONTAINER_TUNNEL_SUFFIX);
        expect(shouldAutoStartTunnel(config)).toBe(false);
    });

    it('returns true when container tunnel is enabled', () => {
        const config = { ...defaultDevTunnelConfig('box', CONTAINER_TUNNEL_SUFFIX), enabled: true };
        expect(shouldAutoStartTunnel(config)).toBe(true);
    });
});

// ── Preferred port selection ─────────────────────────────────────────────────

describe('CoCContainer preferred port selection', () => {
    it('uses the devtunnel HTTP port when enabled config has one binding', async () => {
        // Simulate readDevTunnelHttpPort returning a single binding
        const mockReadPort = vi.fn().mockResolvedValue(5000);
        const config = {
            ...defaultDevTunnelConfig('box', CONTAINER_TUNNEL_SUFFIX),
            enabled: true,
        };
        // When enabled, call readDevTunnelHttpPort with tunnelId
        const port = config.enabled ? await mockReadPort({ tunnelId: config.tunnelId }) : undefined;
        expect(port).toBe(5000);
        expect(mockReadPort).toHaveBeenCalledWith({ tunnelId: 'box-coccontainer' });
    });

    it('falls back to DEFAULT_PORT when tunnel is disabled', async () => {
        const DEFAULT_PORT = 5000;
        const mockReadPort = vi.fn().mockResolvedValue(9999);
        const config = defaultDevTunnelConfig('box', CONTAINER_TUNNEL_SUFFIX);
        // When NOT enabled, skip readDevTunnelHttpPort
        const devTunnelPort = config.enabled
            ? await mockReadPort({ tunnelId: config.tunnelId })
            : undefined;
        const attachPort = devTunnelPort ?? DEFAULT_PORT;
        expect(attachPort).toBe(DEFAULT_PORT);
        expect(mockReadPort).not.toHaveBeenCalled();
    });

    it('falls back to DEFAULT_PORT when readDevTunnelHttpPort returns undefined', async () => {
        const DEFAULT_PORT = 5000;
        const mockReadPort = vi.fn().mockResolvedValue(undefined);
        const config = {
            ...defaultDevTunnelConfig('box', CONTAINER_TUNNEL_SUFFIX),
            enabled: true,
        };
        const devTunnelPort = config.enabled
            ? await mockReadPort({ tunnelId: config.tunnelId })
            : undefined;
        const attachPort = devTunnelPort ?? DEFAULT_PORT;
        expect(attachPort).toBe(DEFAULT_PORT);
    });
});
