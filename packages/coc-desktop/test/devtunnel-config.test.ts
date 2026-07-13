/**
 * Unit tests for the DevTunnel preference store (AC-01).
 *
 * `devtunnel-config.ts` is electron-free and routes all filesystem access
 * through injectable seams, so the persistence rules — default tunnel ID, the
 * feature-off default, atomic writes, malformed-file errors, and the
 * Start/Stop/Retry (enable/disable/relaunch) transitions — are asserted here
 * under plain Node with an in-memory fake filesystem.
 */

import { describe, it, expect } from 'vitest';
import * as path from 'path';
import {
    DESKTOP_DEVTUNNEL_FILENAME,
    DESKTOP_DEVTUNNEL_VERSION,
    DevTunnelConfigError,
    DevTunnelConfigStore,
    defaultDevTunnelConfig,
    defaultTunnelId,
    parseDevTunnelConfig,
    readDevTunnelConfig,
    setDevTunnelEnabled,
    setDevTunnelId,
    writeDevTunnelConfig,
} from '../src/devtunnel-config';

const DATA_DIR = '/home/user/.coc';
const CONFIG_PATH = path.join(DATA_DIR, DESKTOP_DEVTUNNEL_FILENAME);

/**
 * A minimal in-memory filesystem exposing the {@link DevTunnelConfigStore} seams.
 * Records the ordered sequence of operations so the atomic write (temp → rename)
 * can be asserted precisely.
 */
function memStore(seed: Record<string, string> = {}): {
    store: DevTunnelConfigStore;
    files: Map<string, string>;
    dirs: Set<string>;
    ops: string[];
} {
    const files = new Map<string, string>(Object.entries(seed));
    const dirs = new Set<string>();
    const ops: string[] = [];
    const store: DevTunnelConfigStore = {
        readText: (p) => {
            if (!files.has(p)) {
                throw Object.assign(new Error(`ENOENT: ${p}`), { code: 'ENOENT' });
            }
            ops.push(`read ${p}`);
            return files.get(p) as string;
        },
        writeText: (p, data) => {
            ops.push(`write ${p}`);
            files.set(p, data);
        },
        rename: (from, to) => {
            ops.push(`rename ${from} -> ${to}`);
            files.set(to, files.get(from) as string);
            files.delete(from);
        },
        ensureDir: (d) => {
            ops.push(`ensureDir ${d}`);
            dirs.add(d);
        },
    };
    return { store, files, dirs, ops };
}

describe('defaultTunnelId', () => {
    it('appends -coc to a lowercased computer name', () => {
        expect(defaultTunnelId('MYBOX')).toBe('mybox-coc');
    });

    it('drops any DNS domain, keeping the leading host label', () => {
        expect(defaultTunnelId('MyBox.corp.example.com')).toBe('mybox-coc');
    });

    it('replaces characters a DevTunnel ID disallows with hyphens', () => {
        expect(defaultTunnelId('My_Box 01')).toBe('my-box-01-coc');
    });

    it('falls back to "desktop-coc" when the name reduces to nothing', () => {
        expect(defaultTunnelId('')).toBe('desktop-coc');
        expect(defaultTunnelId('...')).toBe('desktop-coc');
    });

    it('derives a non-empty default from the real hostname when none is given', () => {
        expect(defaultTunnelId()).toMatch(/-coc$/);
    });
});

describe('defaultDevTunnelConfig', () => {
    it('is feature-off with the default tunnel ID and current version', () => {
        expect(defaultDevTunnelConfig('MyBox')).toEqual({
            tunnelId: 'mybox-coc',
            enabled: false,
            version: DESKTOP_DEVTUNNEL_VERSION,
        });
    });
});

describe('parseDevTunnelConfig', () => {
    it('accepts and trims a valid config', () => {
        expect(parseDevTunnelConfig({ tunnelId: '  box-coc ', enabled: true, version: 1 })).toEqual({
            tunnelId: 'box-coc',
            enabled: true,
            version: 1,
        });
    });

    it.each([
        ['a non-object', 42],
        ['null', null],
        ['a missing tunnelId', { enabled: false, version: 1 }],
        ['a blank tunnelId', { tunnelId: '   ', enabled: false, version: 1 }],
        ['a non-string tunnelId', { tunnelId: 5, enabled: false, version: 1 }],
        ['a non-boolean enabled', { tunnelId: 'box-coc', enabled: 'yes', version: 1 }],
        ['a missing enabled', { tunnelId: 'box-coc', version: 1 }],
        ['a non-integer version', { tunnelId: 'box-coc', enabled: false, version: 1.5 }],
        ['a zero version', { tunnelId: 'box-coc', enabled: false, version: 0 }],
        ['a missing version', { tunnelId: 'box-coc', enabled: false }],
    ])('rejects %s with a DevTunnelConfigError', (_label, raw) => {
        expect(() => parseDevTunnelConfig(raw)).toThrow(DevTunnelConfigError);
    });
});

describe('readDevTunnelConfig', () => {
    it('returns the feature-off default when the file is missing', () => {
        const { store } = memStore();
        const cfg = readDevTunnelConfig(DATA_DIR, store);
        expect(cfg.enabled).toBe(false);
        expect(cfg.version).toBe(DESKTOP_DEVTUNNEL_VERSION);
        expect(cfg.tunnelId).toMatch(/-coc$/);
    });

    it('reads and validates a well-formed file', () => {
        const { store } = memStore({
            [CONFIG_PATH]: JSON.stringify({ tunnelId: 'box-coc', enabled: true, version: 1 }),
        });
        expect(readDevTunnelConfig(DATA_DIR, store)).toEqual({
            tunnelId: 'box-coc',
            enabled: true,
            version: 1,
        });
    });

    it('throws on invalid JSON', () => {
        const { store } = memStore({ [CONFIG_PATH]: '{ not json' });
        expect(() => readDevTunnelConfig(DATA_DIR, store)).toThrow(DevTunnelConfigError);
    });

    it('throws on a structurally invalid file', () => {
        const { store } = memStore({ [CONFIG_PATH]: JSON.stringify({ enabled: true }) });
        expect(() => readDevTunnelConfig(DATA_DIR, store)).toThrow(DevTunnelConfigError);
    });

    it('surfaces a non-ENOENT read error as a config error rather than "off"', () => {
        const store: DevTunnelConfigStore = {
            readText: () => {
                throw Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' });
            },
        };
        expect(() => readDevTunnelConfig(DATA_DIR, store)).toThrow(DevTunnelConfigError);
    });
});

describe('writeDevTunnelConfig', () => {
    it('writes to a temp file then renames it over the target (atomic)', () => {
        const { store, ops, files } = memStore();
        writeDevTunnelConfig(
            DATA_DIR,
            { tunnelId: 'box-coc', enabled: true, version: 1 },
            store,
        );
        expect(ops).toEqual([
            `ensureDir ${DATA_DIR}`,
            `write ${CONFIG_PATH}.tmp`,
            `rename ${CONFIG_PATH}.tmp -> ${CONFIG_PATH}`,
        ]);
        // The temp file is gone and the final file holds valid JSON.
        expect(files.has(`${CONFIG_PATH}.tmp`)).toBe(false);
        expect(JSON.parse(files.get(CONFIG_PATH) as string)).toEqual({
            tunnelId: 'box-coc',
            enabled: true,
            version: 1,
        });
    });

    it('refuses to persist an invalid config', () => {
        const { store, files } = memStore();
        expect(() =>
            writeDevTunnelConfig(DATA_DIR, { tunnelId: '', enabled: true, version: 1 }, store),
        ).toThrow(DevTunnelConfigError);
        expect(files.size).toBe(0); // nothing written on rejection
    });
});

describe('setDevTunnelEnabled / setDevTunnelId — Start/Stop/Configure transitions', () => {
    it('Start persists enabled:true and a relaunch reads it back (auto-start on)', () => {
        const { store } = memStore();
        setDevTunnelId(DATA_DIR, 'box-coc', store); // Configure a tunnel first
        const started = setDevTunnelEnabled(DATA_DIR, true, store);
        expect(started.enabled).toBe(true);
        // Relaunch: a fresh read from the same backing store.
        expect(readDevTunnelConfig(DATA_DIR, store).enabled).toBe(true);
    });

    it('Stop persists enabled:false and a relaunch keeps auto-start off', () => {
        const { store } = memStore({
            [CONFIG_PATH]: JSON.stringify({ tunnelId: 'box-coc', enabled: true, version: 1 }),
        });
        const stopped = setDevTunnelEnabled(DATA_DIR, false, store);
        expect(stopped.enabled).toBe(false);
        expect(readDevTunnelConfig(DATA_DIR, store)).toEqual({
            tunnelId: 'box-coc',
            enabled: false,
            version: 1,
        });
    });

    it('toggling enabled preserves the configured tunnel ID (Retry-style no-op on ID)', () => {
        const { store } = memStore({
            [CONFIG_PATH]: JSON.stringify({ tunnelId: 'custom-id', enabled: false, version: 1 }),
        });
        expect(setDevTunnelEnabled(DATA_DIR, true, store).tunnelId).toBe('custom-id');
    });

    it('Configure Save persists a trimmed tunnel ID and preserves the enabled flag', () => {
        const { store } = memStore({
            [CONFIG_PATH]: JSON.stringify({ tunnelId: 'old-id', enabled: true, version: 1 }),
        });
        const saved = setDevTunnelId(DATA_DIR, '  new-id  ', store);
        expect(saved).toEqual({ tunnelId: 'new-id', enabled: true, version: 1 });
        expect(readDevTunnelConfig(DATA_DIR, store).tunnelId).toBe('new-id');
    });

    it('Configure Save rejects a blank tunnel ID', () => {
        const { store } = memStore();
        expect(() => setDevTunnelId(DATA_DIR, '   ', store)).toThrow(DevTunnelConfigError);
    });

    it('recovers from a corrupt file by writing a fresh valid config on Start', () => {
        const { store, files } = memStore({ [CONFIG_PATH]: 'garbage' });
        const started = setDevTunnelEnabled(DATA_DIR, true, store);
        expect(started.enabled).toBe(true);
        expect(started.tunnelId).toMatch(/-coc$/);
        // The corrupt content has been replaced with a readable config.
        expect(readDevTunnelConfig(DATA_DIR, store)).toEqual(started);
        expect(files.has(`${CONFIG_PATH}.tmp`)).toBe(false);
    });
});
