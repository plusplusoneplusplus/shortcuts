/**
 * CoC Desktop — DevTunnel CLI host-side configuration (AC-02).
 *
 * Ports the host-side algorithm of `scripts/config-devtunnel.ps1` to an
 * Electron-free TypeScript module so Vitest can exercise it under plain Node.
 * Given the active CoC server port and the configured tunnel ID it:
 *
 *   1. Resolves `devtunnel.exe` from PATH, then falls back to
 *      `~/.coc/bin/devtunnel.exe` (never installing it).
 *   2. Creates or reuses the configured tunnel ID (private/authenticated — the
 *      DevTunnel default; no anonymous access command is ever issued).
 *   3. Ensures exactly one HTTP port binding targets the active CoC port:
 *        - no HTTP port  → create one on the active port,
 *        - matching port → reuse it as-is,
 *        - one stale port → delete it and bind the active port,
 *        - many HTTP ports → fail without guessing or deleting any of them.
 *      Unrelated non-HTTP ports are preserved because only the single HTTP
 *      binding is ever touched.
 *
 * Every failure is normalized to a {@link DevTunnelErrorCategory} plus a concise,
 * secret-free `message`, so a failed or ambiguous binding can be surfaced (AC-04)
 * and the caller (AC-03) can refuse to start `devtunnel host`. All process
 * execution flows through the injectable {@link DevTunnelCliRunner} so tests never
 * spawn a real CLI. This module imports nothing from `electron`.
 */

import { execFile } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/** The Windows CLI executable name — the only supported platform for hosting. */
export const DEVTUNNEL_EXE_WIN = 'devtunnel.exe';
/** The POSIX CLI name — used only so the resolver stays testable off Windows. */
export const DEVTUNNEL_EXE_POSIX = 'devtunnel';

/**
 * The normalized DevTunnel failure taxonomy shared across AC-02/03/04. AC-02
 * produces the first five; AC-03 adds `url-timeout` and `unexpected-exit`.
 */
export type DevTunnelErrorCategory =
    | 'cli-missing'
    | 'unauthenticated'
    | 'not-owned'
    | 'multiple-http-ports'
    | 'reconcile-failed'
    | 'url-timeout'
    | 'unexpected-exit';

/** The captured result of one `devtunnel` invocation. */
export interface DevTunnelCliResult {
    /** Process exit code; `-1` when the process could not be spawned at all. */
    exitCode: number;
    stdout: string;
    stderr: string;
    /** Present when the CLI could not be spawned (e.g. ENOENT / EACCES). */
    spawnError?: NodeJS.ErrnoException;
}

/** Injectable process runner so tests drive the algorithm without a real CLI. */
export type DevTunnelCliRunner = (cliPath: string, args: string[]) => Promise<DevTunnelCliResult>;

/** The outcome of reconciling the tunnel's HTTP binding. */
export type DevTunnelConfigureResult =
    | { ok: true; port: number }
    | { ok: false; category: DevTunnelErrorCategory; message: string; detail?: string };

// Output signatures ported from `scripts/devtunnel-utils.ps1` + the forge
// connector. `not-owned` is checked before `unauthenticated` because
// "unauthorized tunnel access" also trips the broader auth regex.
const NOT_OWNED_RE = /(?:tunnel not found|request not permitted|unauthorized tunnel access)/i;
const AUTH_RE = /(?:not logged in|not authenticated|login required|log in|\blogin\b|unauthenticated|unauthorized|\b401\b|forbidden)/i;
const ALREADY_EXISTS_RE = /(?:already exists|conflict with existing entity)/i;

/** Cap raw CLI output written to the process log so nothing unbounded leaks. */
const MAX_DETAIL_CHARS = 2000;
/** execFile buffer cap — matches Node's default; bounds captured output. */
const MAX_OUTPUT_BYTES = 1024 * 1024;

function exeName(platform: NodeJS.Platform): string {
    return platform === 'win32' ? DEVTUNNEL_EXE_WIN : DEVTUNNEL_EXE_POSIX;
}

/** Injectable seams for {@link resolveDevTunnelCliPath}. */
export interface ResolveDevTunnelCliDeps {
    env?: NodeJS.ProcessEnv;
    homeDir?: string;
    platform?: NodeJS.Platform;
    fileExists?: (filePath: string) => boolean;
}

/**
 * Resolve the `devtunnel` executable: first every directory on `PATH`, then the
 * `~/.coc/bin/devtunnel.exe` fallback. Returns the absolute path, or `undefined`
 * when the CLI is not installed (surfaced by callers as `cli-missing`). Desktop
 * never installs the CLI.
 */
export function resolveDevTunnelCliPath(deps: ResolveDevTunnelCliDeps = {}): string | undefined {
    const platform = deps.platform ?? process.platform;
    const env = deps.env ?? process.env;
    const homeDir = deps.homeDir ?? os.homedir();
    const fileExists = deps.fileExists ?? defaultFileExists;
    const name = exeName(platform);

    const pathValue = env.PATH ?? env.Path ?? env.path ?? '';
    const delimiter = platform === 'win32' ? ';' : ':';
    for (const dir of pathValue.split(delimiter)) {
        const trimmed = dir.trim();
        if (!trimmed) {
            continue;
        }
        const candidate = path.join(trimmed, name);
        if (fileExists(candidate)) {
            return candidate;
        }
    }

    const fallback = path.join(homeDir, '.coc', 'bin', name);
    return fileExists(fallback) ? fallback : undefined;
}

function defaultFileExists(filePath: string): boolean {
    try {
        return fs.statSync(filePath).isFile();
    } catch {
        return false;
    }
}

/**
 * Default runner: run the CLI and resolve with its exit code and output, never
 * rejecting — a non-zero exit or a spawn failure both come back as data so the
 * classifier can treat them uniformly (mirrors PowerShell's `Invoke-DevTunnelCli`).
 */
export function defaultDevTunnelCliRunner(cliPath: string, args: string[]): Promise<DevTunnelCliResult> {
    return new Promise((resolve) => {
        execFile(cliPath, args, { windowsHide: true, maxBuffer: MAX_OUTPUT_BYTES }, (error, stdout, stderr) => {
            const err = error as (NodeJS.ErrnoException & { code?: string | number }) | null;
            let exitCode = 0;
            let spawnError: NodeJS.ErrnoException | undefined;
            if (err) {
                if (typeof err.code === 'number') {
                    exitCode = err.code;
                } else {
                    // 'ENOENT'/'EACCES'/signal kill — the process never produced an exit code.
                    exitCode = -1;
                    spawnError = err;
                }
            }
            resolve({
                exitCode,
                stdout: stdout?.toString() ?? '',
                stderr: stderr?.toString() ?? '',
                spawnError,
            });
        });
    });
}

interface DevTunnelPortRow {
    port: number;
    protocol: string;
}

function parseJsonPortRows(output: string): DevTunnelPortRow[] | undefined {
    try {
        const parsed = JSON.parse(output) as unknown;
        const rows = Array.isArray(parsed)
            ? parsed
            : typeof parsed === 'object' && parsed !== null && Array.isArray((parsed as { ports?: unknown }).ports)
                ? (parsed as { ports: unknown[] }).ports
                : typeof parsed === 'object' && parsed !== null && Array.isArray((parsed as { items?: unknown }).items)
                    ? (parsed as { items: unknown[] }).items
                    : undefined;
        if (!rows) {
            return undefined;
        }
        return rows.flatMap((row) => {
            if (typeof row !== 'object' || row === null) {
                return [];
            }
            const item = row as Record<string, unknown>;
            const portValue = item.portNumber ?? item.port ?? item.number;
            const protocolValue = item.protocol ?? item.protocols;
            const port = typeof portValue === 'number' ? portValue : Number(portValue);
            const protocol = Array.isArray(protocolValue)
                ? protocolValue.join(',')
                : typeof protocolValue === 'string'
                    ? protocolValue
                    : '';
            return Number.isInteger(port) && port > 0 && protocol ? [{ port, protocol }] : [];
        });
    } catch {
        return undefined;
    }
}

function parseTextPortRows(output: string): DevTunnelPortRow[] {
    const rows: DevTunnelPortRow[] = [];
    for (const rawLine of output.split(/\r?\n/)) {
        const line = rawLine.trim();
        // Skip blanks, table separators, and the "Port  Protocol ..." header.
        if (!line || /^[-\s|+]+$/.test(line) || (/port/i.test(line) && /protocol/i.test(line))) {
            continue;
        }
        const leadingPort = line.match(/^(\d{1,5})\b/);
        if (!leadingPort) {
            continue;
        }
        const port = Number(leadingPort[1]);
        if (!Number.isInteger(port) || port <= 0 || port > 65535) {
            continue;
        }
        const rest = line.slice(leadingPort[0].length).trim();
        const protocol = (rest.match(/\b(https?|tcp|ssh)\b/i)?.[0] ?? rest.split(/\s+/)[0] ?? '').toLowerCase();
        if (protocol) {
            rows.push({ port, protocol });
        }
    }
    return rows;
}

/**
 * Parse the unique HTTP port numbers from `devtunnel port list` output (JSON or
 * table). Only the exact `http` protocol counts as an HTTP binding — `https`,
 * `tcp`, and `ssh` are unrelated ports we never manage — matching the host-side
 * PowerShell and forge parsers.
 */
export function parseDevTunnelHttpPorts(output: string): number[] {
    const rows = parseJsonPortRows(output) ?? parseTextPortRows(output);
    const httpPorts = rows
        .filter((row) => row.protocol.split(/[,\s]+/).some((proto) => proto.toLowerCase() === 'http'))
        .map((row) => row.port);
    return Array.from(new Set(httpPorts));
}

function combinedOutput(result: DevTunnelCliResult): string {
    return `${result.stdout}\n${result.stderr}`;
}

function boundedDetail(text: string): string {
    const trimmed = text.trim();
    return trimmed.length > MAX_DETAIL_CHARS ? `${trimmed.slice(0, MAX_DETAIL_CHARS)}…` : trimmed;
}

/** Concise, secret-free default guidance per category (AC-04 may refine). */
export function defaultDevTunnelMessage(category: DevTunnelErrorCategory): string {
    switch (category) {
        case 'cli-missing':
            return 'The devtunnel CLI was not found on PATH or in ~/.coc/bin. Install it, then retry.';
        case 'unauthenticated':
            return 'The devtunnel CLI is not signed in. Run "devtunnel user login", then retry.';
        case 'not-owned':
            return 'This tunnel ID is owned by another account or is not accessible. Log in as its owner or choose a different tunnel ID.';
        case 'multiple-http-ports':
            return 'This tunnel has multiple HTTP ports. Remove the extra ports or recreate the tunnel, then retry.';
        case 'reconcile-failed':
            return 'Configuring the dev tunnel failed. See the desktop log for details, then retry.';
        case 'url-timeout':
            return 'Timed out waiting for the tunnel public URL.';
        case 'unexpected-exit':
            return 'The dev tunnel host process exited unexpectedly.';
    }
}

/**
 * Classify an auth/ownership/CLI-missing signal in a command result. Returns
 * `undefined` when nothing well-known is detected (the caller decides whether a
 * non-zero exit is a `reconcile-failed`).
 */
function classifyResult(result: DevTunnelCliResult): DevTunnelErrorCategory | undefined {
    if (result.spawnError && result.spawnError.code === 'ENOENT') {
        return 'cli-missing';
    }
    const text = combinedOutput(result);
    if (NOT_OWNED_RE.test(text)) {
        return 'not-owned';
    }
    if (AUTH_RE.test(text)) {
        return 'unauthenticated';
    }
    return undefined;
}

function fail(
    category: DevTunnelErrorCategory,
    result: DevTunnelCliResult,
    message?: string,
): DevTunnelConfigureResult {
    return {
        ok: false,
        category,
        message: message ?? defaultDevTunnelMessage(category),
        detail: boundedDetail(combinedOutput(result)),
    };
}

/** Options for {@link configureDevTunnel}. */
export interface ConfigureDevTunnelOptions {
    /** The configured, validated tunnel ID (from the AC-01 preference store). */
    tunnelId: string;
    /** The active CoC server port that the single HTTP binding must target. */
    port: number;
    /** The resolved `devtunnel` executable path. */
    cliPath: string;
    runner?: DevTunnelCliRunner;
}

/**
 * Create-or-reuse the tunnel and reconcile exactly one HTTP binding onto the
 * active CoC port. Behaves identically whether Desktop started the embedded CoC
 * server or attached to an external `coc serve` — it only depends on the port.
 */
export async function configureDevTunnel(options: ConfigureDevTunnelOptions): Promise<DevTunnelConfigureResult> {
    const run = options.runner ?? defaultDevTunnelCliRunner;
    const { tunnelId, port, cliPath } = options;

    // 1) Create-or-reuse the tunnel ID (private/authenticated default).
    const created = await run(cliPath, ['create', tunnelId]);
    const createErr = classifyResult(created);
    if (createErr) {
        return fail(createErr, created);
    }
    if (created.exitCode !== 0 && !ALREADY_EXISTS_RE.test(combinedOutput(created))) {
        return fail('reconcile-failed', created, `Failed to create dev tunnel "${tunnelId}".`);
    }

    // 2) List the tunnel's ports.
    const listed = await run(cliPath, ['port', 'list', tunnelId]);
    const listErr = classifyResult(listed);
    if (listErr) {
        return fail(listErr, listed);
    }
    if (listed.exitCode !== 0) {
        return fail('reconcile-failed', listed, `Failed to list dev tunnel ports for "${tunnelId}".`);
    }

    const httpPorts = parseDevTunnelHttpPorts(combinedOutput(listed));

    // 3) Multiple HTTP bindings → refuse to guess or delete any of them.
    if (httpPorts.length > 1) {
        return {
            ok: false,
            category: 'multiple-http-ports',
            message: `Dev tunnel "${tunnelId}" has multiple HTTP ports (${httpPorts.join(', ')}). Remove the extra ports or recreate the tunnel, then retry.`,
            detail: boundedDetail(combinedOutput(listed)),
        };
    }

    // 4) Exactly one HTTP binding: reuse it if it matches, else replace the stale one.
    if (httpPorts.length === 1) {
        const existing = httpPorts[0];
        if (existing === port) {
            return { ok: true, port };
        }
        const deleted = await run(cliPath, ['port', 'delete', tunnelId, '-p', String(existing)]);
        const delErr = classifyResult(deleted);
        if (delErr) {
            return fail(delErr, deleted);
        }
        if (deleted.exitCode !== 0) {
            return fail('reconcile-failed', deleted, `Failed to remove stale HTTP port ${existing} from "${tunnelId}".`);
        }
    }

    // 5) No HTTP binding (or a just-deleted stale one) → bind the active CoC port.
    const bound = await run(cliPath, ['port', 'create', tunnelId, '-p', String(port), '--protocol', 'http']);
    const bindErr = classifyResult(bound);
    if (bindErr) {
        return fail(bindErr, bound);
    }
    if (bound.exitCode !== 0 && !ALREADY_EXISTS_RE.test(combinedOutput(bound))) {
        return fail('reconcile-failed', bound, `Failed to bind HTTP port ${port} on "${tunnelId}".`);
    }

    return { ok: true, port };
}

/** Options for {@link ensureDevTunnelHttpBinding}. */
export interface EnsureDevTunnelOptions {
    tunnelId: string;
    port: number;
    /** Pre-resolved CLI path; when omitted the path is resolved via {@link resolveDevTunnelCliPath}. */
    cliPath?: string;
    resolve?: ResolveDevTunnelCliDeps;
    runner?: DevTunnelCliRunner;
}

/**
 * Resolve the CLI then reconcile the HTTP binding, folding a missing CLI into the
 * same result contract. This is the single entry point AC-03 gates on: it must
 * only start `devtunnel host` when the result is `{ ok: true }`.
 */
export async function ensureDevTunnelHttpBinding(options: EnsureDevTunnelOptions): Promise<DevTunnelConfigureResult> {
    const cliPath = options.cliPath ?? resolveDevTunnelCliPath(options.resolve);
    if (!cliPath) {
        return { ok: false, category: 'cli-missing', message: defaultDevTunnelMessage('cli-missing') };
    }
    return configureDevTunnel({
        tunnelId: options.tunnelId,
        port: options.port,
        cliPath,
        runner: options.runner,
    });
}
