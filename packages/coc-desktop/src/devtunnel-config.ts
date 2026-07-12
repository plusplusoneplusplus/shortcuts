/**
 * CoC Desktop — DevTunnel preference store (AC-01).
 *
 * The machine-global, opt-in DevTunnel exposure preference. It is persisted in a
 * dedicated versioned `desktop-devtunnel.json` under the shared `~/.coc` data dir
 * (never workspace- or repository-scoped) with three fields — `tunnelId`,
 * `enabled`, and `version` — written atomically (temp file + rename) so a crash
 * mid-write can never leave a half-written config behind.
 *
 * Semantics (AC-01):
 *   - Missing configuration means the feature is off (`enabled: false`).
 *   - Choosing **Start** persists `enabled: true`; **Stop** persists
 *     `enabled: false`; **Retry** does not change the enabled state.
 *   - The default tunnel ID is `<computer-name>-coc`, matching the PowerShell
 *     `config-devtunnel.ps1` default of `$env:COMPUTERNAME.ToLower()-coc`.
 *   - Malformed persisted content is surfaced as a {@link DevTunnelConfigError}
 *     rather than being silently treated as "off", so the caller can decide how
 *     to present it (AC-04) instead of masking a corrupted file.
 *
 * Like `update-check.ts` and `app-menu.ts`, this module imports NOTHING from
 * `electron`, so the config math stays unit-testable under plain Node. All
 * filesystem access flows through injectable seams so tests never touch disk.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/** The on-disk schema version for `desktop-devtunnel.json`. */
export const DESKTOP_DEVTUNNEL_VERSION = 1;

/** The dedicated preference file name under the shared `~/.coc` data dir. */
export const DESKTOP_DEVTUNNEL_FILENAME = 'desktop-devtunnel.json';

/** The persisted, machine-global DevTunnel exposure preference. */
export interface DevTunnelConfig {
    /** The stable DevTunnel ID to host (e.g. `<computer-name>-coc`). */
    tunnelId: string;
    /** The feature gate — off by default; toggled by Start/Stop. */
    enabled: boolean;
    /** On-disk schema version, for future migrations. */
    version: number;
}

/**
 * A malformed or unreadable `desktop-devtunnel.json`. Distinct from a *missing*
 * file (which is a valid "feature off" state), so callers can present a corrupt
 * config as an error rather than silently defaulting to off.
 */
export class DevTunnelConfigError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'DevTunnelConfigError';
    }
}

/** Injectable filesystem seams so the store is testable without touching disk. */
export interface DevTunnelConfigStore {
    readText?: (filePath: string) => string;
    writeText?: (filePath: string, data: string) => void;
    rename?: (from: string, to: string) => void;
    ensureDir?: (dir: string) => void;
}

function configPath(dataDir: string): string {
    return path.join(dataDir, DESKTOP_DEVTUNNEL_FILENAME);
}

/**
 * Derive the default tunnel ID `<computer-name>-coc` from a machine name.
 *
 * The name is reduced to the leading host label (dropping any DNS domain),
 * lowercased, and stripped down to the `[a-z0-9-]` characters a DevTunnel ID
 * allows. This mirrors `config-devtunnel.ps1`'s `$env:COMPUTERNAME.ToLower()-coc`
 * while staying safe for the arbitrary values `os.hostname()` can return.
 */
export function defaultTunnelId(computerName: string = os.hostname()): string {
    const base = (computerName || '')
        .split('.')[0]
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9-]+/g, '-')
        .replace(/^-+|-+$/g, '');
    return `${base || 'desktop'}-coc`;
}

/** The default, feature-off config for a machine with no saved preference. */
export function defaultDevTunnelConfig(computerName?: string): DevTunnelConfig {
    return {
        tunnelId: defaultTunnelId(computerName),
        enabled: false,
        version: DESKTOP_DEVTUNNEL_VERSION,
    };
}

/**
 * Validate and normalize an arbitrary parsed value into a {@link DevTunnelConfig}.
 * Throws {@link DevTunnelConfigError} when a required field is missing or has the
 * wrong type, so a truncated or hand-edited file is rejected rather than partly
 * honored.
 */
export function parseDevTunnelConfig(raw: unknown): DevTunnelConfig {
    if (!raw || typeof raw !== 'object') {
        throw new DevTunnelConfigError(`${DESKTOP_DEVTUNNEL_FILENAME} is not a JSON object`);
    }
    const obj = raw as Record<string, unknown>;
    if (typeof obj.tunnelId !== 'string' || obj.tunnelId.trim() === '') {
        throw new DevTunnelConfigError(`${DESKTOP_DEVTUNNEL_FILENAME} is missing a valid "tunnelId"`);
    }
    if (typeof obj.enabled !== 'boolean') {
        throw new DevTunnelConfigError(`${DESKTOP_DEVTUNNEL_FILENAME} is missing a valid "enabled" flag`);
    }
    if (typeof obj.version !== 'number' || !Number.isInteger(obj.version) || obj.version < 1) {
        throw new DevTunnelConfigError(`${DESKTOP_DEVTUNNEL_FILENAME} has an invalid "version"`);
    }
    return { tunnelId: obj.tunnelId.trim(), enabled: obj.enabled, version: obj.version };
}

/**
 * Read the persisted preference.
 *
 *   - A *missing* file resolves to the default, feature-off config — this is the
 *     normal "never configured" state, not an error.
 *   - A file that exists but is unreadable, not valid JSON, or missing/mistyped
 *     fields throws {@link DevTunnelConfigError}.
 */
export function readDevTunnelConfig(
    dataDir: string,
    store: DevTunnelConfigStore = {},
): DevTunnelConfig {
    const readText = store.readText ?? ((p) => fs.readFileSync(p, 'utf8'));
    let text: string;
    try {
        text = readText(configPath(dataDir));
    } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
            return defaultDevTunnelConfig();
        }
        throw new DevTunnelConfigError(
            `Failed to read ${DESKTOP_DEVTUNNEL_FILENAME}: ${(err as Error).message}`,
        );
    }
    let parsed: unknown;
    try {
        parsed = JSON.parse(text);
    } catch {
        throw new DevTunnelConfigError(`${DESKTOP_DEVTUNNEL_FILENAME} contains invalid JSON`);
    }
    return parseDevTunnelConfig(parsed);
}

/**
 * Lenient read used by the setters below: returns the current config, or the
 * default when the file is missing OR corrupt. A corrupt file must never wedge
 * Start/Stop/Configure — writing a fresh valid config recovers from it.
 */
function currentOrDefault(dataDir: string, store: DevTunnelConfigStore): DevTunnelConfig {
    try {
        return readDevTunnelConfig(dataDir, store);
    } catch {
        return defaultDevTunnelConfig();
    }
}

/**
 * Persist `config` atomically: write a sibling `*.tmp` then rename it over the
 * target, so a reader never observes a partially written file. The config is
 * validated first, so an invalid value is rejected before any file is touched.
 */
export function writeDevTunnelConfig(
    dataDir: string,
    config: DevTunnelConfig,
    store: DevTunnelConfigStore = {},
): void {
    const normalized = parseDevTunnelConfig(config);
    const ensureDir = store.ensureDir ?? ((d) => { fs.mkdirSync(d, { recursive: true }); });
    const writeText = store.writeText ?? ((p, data) => fs.writeFileSync(p, data));
    const rename = store.rename ?? ((from, to) => fs.renameSync(from, to));
    ensureDir(dataDir);
    const finalPath = configPath(dataDir);
    const tmpPath = `${finalPath}.tmp`;
    writeText(tmpPath, `${JSON.stringify(normalized, null, 2)}\n`);
    rename(tmpPath, finalPath);
}

/**
 * Persist the enabled flag (Start → `true`, Stop → `false`) while keeping the
 * current tunnel ID. Returns the persisted config.
 */
export function setDevTunnelEnabled(
    dataDir: string,
    enabled: boolean,
    store: DevTunnelConfigStore = {},
): DevTunnelConfig {
    const next: DevTunnelConfig = {
        ...currentOrDefault(dataDir, store),
        enabled,
        version: DESKTOP_DEVTUNNEL_VERSION,
    };
    writeDevTunnelConfig(dataDir, next, store);
    return next;
}

/**
 * Persist a new tunnel ID (from the Configure… modal Save) while preserving the
 * current enabled flag. Returns the persisted config. Throws when the ID is
 * blank.
 */
export function setDevTunnelId(
    dataDir: string,
    tunnelId: string,
    store: DevTunnelConfigStore = {},
): DevTunnelConfig {
    const trimmed = tunnelId.trim();
    if (!trimmed) {
        throw new DevTunnelConfigError('Tunnel ID cannot be empty');
    }
    const next: DevTunnelConfig = {
        ...currentOrDefault(dataDir, store),
        tunnelId: trimmed,
        version: DESKTOP_DEVTUNNEL_VERSION,
    };
    writeDevTunnelConfig(dataDir, next, store);
    return next;
}
