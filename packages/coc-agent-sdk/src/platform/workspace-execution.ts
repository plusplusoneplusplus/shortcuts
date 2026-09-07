/**
 * Workspace execution helpers for routing operations to either the native host
 * environment or WSL.
 */

import { execFile } from 'child_process';
import * as path from 'path';
import {
    isLinuxAbsolutePath,
    isWindowsDrivePath,
    isWslUncPath,
    parseWslUncPath,
    toForwardSlashes,
    trimTrailingPathSeparators,
    windowsPathToWslPath,
} from './path-utils';

export interface WindowsExecutionContext {
    kind: 'windows';
    workingDirectory?: string;
}

export interface WslExecutionContext {
    kind: 'wsl';
    linuxWorkingDirectory: string;
    distro?: string;
    originalWorkingDirectory: string;
}

export type WorkspaceExecutionContext = WindowsExecutionContext | WslExecutionContext;

/**
 * The resolved default distro: a name, `null` when WSL is definitively absent,
 * or `undefined` while unknown. Only a definitive answer is cached; a transient
 * spawn failure (WSL still booting) leaves this `undefined` so the next caller
 * retries, because caching that failure would disable host-path translation for
 * the rest of the process lifetime.
 */
let defaultWslDistroCache: string | null | undefined;

/**
 * The in-flight lookup, shared by every concurrent caller. Caching the promise
 * rather than only the value is what keeps a cold cache to exactly one
 * `wsl.exe` spawn instead of one per waiting caller.
 */
let defaultWslDistroLookup: Promise<string | undefined> | undefined;

function parseDefaultWslDistro(output: string): string | undefined {
    const normalized = output.replace(/^\uFEFF/, '').replace(/\u0000/g, '');
    for (const rawLine of normalized.split(/\r?\n/)) {
        const line = rawLine.trimEnd();
        const match = line.match(/^\s*\*\s+(.+?)\s{2,}\S+\s+\d+\s*$/);
        if (match) {
            return match[1].trim();
        }
    }
    return undefined;
}

function normalizeLinuxPath(input: string): string {
    const normalized = trimTrailingPathSeparators(toForwardSlashes(input));
    return normalized.length === 0 ? '/' : normalized;
}

function linuxPathToWslUncPath(linuxPath: string, distro: string): string {
    const normalizedLinuxPath = normalizeLinuxPath(linuxPath);
    const suffix = normalizedLinuxPath === '/'
        ? ''
        : normalizedLinuxPath.replace(/\//g, '\\');
    return path.win32.normalize(`\\\\wsl$\\${distro}${suffix}`);
}

export function getWslExecutablePath(): string {
    const systemRoot = process.env['SystemRoot'];
    if (!systemRoot) {
        throw new Error('SystemRoot environment variable is not set. Cannot locate wsl.exe.');
    }
    return path.win32.join(systemRoot, 'System32', 'wsl.exe');
}

export function clearWorkspaceExecutionCaches(): void {
    defaultWslDistroCache = undefined;
    defaultWslDistroLookup = undefined;
}

function runWslList(executable: string): Promise<string> {
    return new Promise((resolve, reject) => {
        execFile(executable, ['-l', '-v'], { encoding: 'utf8' }, (error, stdout) => {
            if (error) {
                reject(error);
                return;
            }
            resolve(stdout);
        });
    });
}

/**
 * The default WSL distro, if it has already been resolved.
 *
 * This never spawns anything: it is a cache read, so it answers `undefined`
 * until {@link getDefaultWslDistroAsync} has run. Callers that must have the
 * real name — anything establishing a workspace identity or translating a bare
 * Linux path to a host path — should use the async variant. Callers that only
 * compare two contexts can stay synchronous: an unresolved distro compares
 * unequal to a named one, which denies rather than permits.
 */
export function getDefaultWslDistro(): string | undefined {
    if (process.platform !== 'win32') {
        return undefined;
    }
    return defaultWslDistroCache ?? undefined;
}

/**
 * Resolve the default WSL distro, spawning `wsl.exe -l -v` at most once.
 *
 * Concurrent callers share one in-flight lookup. A definitive answer — not
 * win32, no `wsl.exe`, or no distros installed — is cached forever; a transient
 * spawn failure is not, so a call made while WSL is still starting does not
 * poison the cache for the process lifetime.
 */
export function getDefaultWslDistroAsync(): Promise<string | undefined> {
    if (process.platform !== 'win32') {
        defaultWslDistroCache = null;
        return Promise.resolve(undefined);
    }
    if (defaultWslDistroCache !== undefined) {
        return Promise.resolve(defaultWslDistroCache ?? undefined);
    }
    if (defaultWslDistroLookup) {
        return defaultWslDistroLookup;
    }

    const lookup = (async (): Promise<string | undefined> => {
        let executable: string;
        try {
            executable = getWslExecutablePath();
        } catch {
            // No SystemRoot means there is no wsl.exe to find on this host.
            defaultWslDistroCache = null;
            return undefined;
        }

        try {
            const output = await runWslList(executable);
            // No starred line means WSL answered but has no distros installed —
            // a definitive absence, cacheable like a resolved name.
            defaultWslDistroCache = parseDefaultWslDistro(output) || null;
            return defaultWslDistroCache ?? undefined;
        } catch (error) {
            // ENOENT is wsl.exe itself missing, which will not change. Any other
            // failure (WSL not started yet, service busy) may well succeed on a
            // later call, so leave the cache unset.
            if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') {
                defaultWslDistroCache = null;
            }
            return undefined;
        }
    })().finally(() => {
        defaultWslDistroLookup = undefined;
    });

    defaultWslDistroLookup = lookup;
    return lookup;
}

/**
 * Populate the distro cache so the synchronous readers answer correctly.
 *
 * Call this once during startup, before any path is normalized into a workspace
 * identity: it is what stops `normalizeExecutionPath` from returning
 * `wsl://default/...` for a path early and `wsl://ubuntu-24.04/...` for the same
 * path later.
 */
export async function warmWslDistroCache(): Promise<void> {
    await getDefaultWslDistroAsync();
}

export function resolveWorkspaceExecutionContext(workingDirectory?: string): WorkspaceExecutionContext {
    if (!workingDirectory) {
        return { kind: 'windows' };
    }

    const unc = parseWslUncPath(workingDirectory);
    if (unc) {
        return {
            kind: 'wsl',
            distro: unc.distro,
            linuxWorkingDirectory: normalizeLinuxPath(unc.linuxPath),
            originalWorkingDirectory: workingDirectory,
        };
    }

    if (process.platform === 'win32' && isLinuxAbsolutePath(workingDirectory)) {
        return {
            kind: 'wsl',
            distro: getDefaultWslDistro(),
            linuxWorkingDirectory: normalizeLinuxPath(workingDirectory),
            originalWorkingDirectory: workingDirectory,
        };
    }

    return { kind: 'windows', workingDirectory };
}

/**
 * {@link resolveWorkspaceExecutionContext}, but resolving the default distro for
 * a bare Linux path on win32 instead of leaving it unset.
 *
 * Use this whenever the distro name itself matters. A WSL UNC path carries its
 * own distro and a non-Windows host has none, so this only differs from the
 * synchronous form for the bare-Linux-path-on-Windows case.
 */
export async function resolveWorkspaceExecutionContextAsync(
    workingDirectory?: string,
): Promise<WorkspaceExecutionContext> {
    const context = resolveWorkspaceExecutionContext(workingDirectory);
    if (context.kind !== 'wsl' || context.distro) {
        return context;
    }
    return { ...context, distro: await getDefaultWslDistroAsync() };
}

export function translatePathForExecution(targetPath: string, context: WorkspaceExecutionContext): string {
    if (context.kind !== 'wsl') {
        return targetPath;
    }

    const unc = parseWslUncPath(targetPath);
    if (unc) {
        if (context.distro && unc.distro.toLowerCase() !== context.distro.toLowerCase()) {
            throw new Error(`WSL path belongs to distro "${unc.distro}", expected "${context.distro}"`);
        }
        return normalizeLinuxPath(unc.linuxPath);
    }

    if (isLinuxAbsolutePath(targetPath)) {
        return normalizeLinuxPath(targetPath);
    }

    if (isWindowsDrivePath(targetPath)) {
        const translated = windowsPathToWslPath(targetPath);
        if (translated) {
            return normalizeLinuxPath(translated);
        }
    }

    throw new Error(`Path is not accessible from the active WSL execution context: ${targetPath}`);
}

export function translatePathForHostFilesystem(
    targetPath: string,
    context?: WorkspaceExecutionContext,
): string {
    if (process.platform !== 'win32') {
        return targetPath;
    }

    const effectiveContext = context ?? resolveWorkspaceExecutionContext(targetPath);
    if (effectiveContext.kind !== 'wsl') {
        return targetPath;
    }

    const unc = parseWslUncPath(targetPath);
    if (unc) {
        return linuxPathToWslUncPath(unc.linuxPath, unc.distro);
    }

    if (isLinuxAbsolutePath(targetPath)) {
        const distro = effectiveContext.distro ?? getDefaultWslDistro();
        if (!distro) {
            throw new Error(`Cannot translate Linux path to Windows filesystem path without a WSL distro: ${targetPath}`);
        }
        return linuxPathToWslUncPath(targetPath, distro);
    }

    return targetPath;
}

/** {@link translatePathForHostFilesystem}, resolving the default distro on demand. */
export async function translatePathForHostFilesystemAsync(
    targetPath: string,
    context?: WorkspaceExecutionContext,
): Promise<string> {
    if (process.platform !== 'win32') {
        return targetPath;
    }

    const effectiveContext = context ?? await resolveWorkspaceExecutionContextAsync(targetPath);
    if (effectiveContext.kind !== 'wsl') {
        return targetPath;
    }

    const unc = parseWslUncPath(targetPath);
    if (unc) {
        return linuxPathToWslUncPath(unc.linuxPath, unc.distro);
    }

    if (isLinuxAbsolutePath(targetPath)) {
        const distro = effectiveContext.distro ?? await getDefaultWslDistroAsync();
        if (!distro) {
            throw new Error(`Cannot translate Linux path to Windows filesystem path without a WSL distro: ${targetPath}`);
        }
        return linuxPathToWslUncPath(targetPath, distro);
    }

    return targetPath;
}

export function resolvePathInExecutionContext(basePath: string, ...segments: string[]): string {
    const context = resolveWorkspaceExecutionContext(basePath);
    if (context.kind === 'wsl') {
        let current = context.linuxWorkingDirectory;
        for (const segment of segments) {
            const normalizedSegment = toForwardSlashes(segment).replace(/^\/+/, '');
            current = current === '/'
                ? `/${normalizedSegment}`
                : `${current}/${normalizedSegment}`;
        }
        return normalizeLinuxPath(current);
    }

    return path.resolve(basePath, ...segments);
}

export function resolvePathForHostFilesystem(basePath: string, ...segments: string[]): string {
    const baseContext = resolveWorkspaceExecutionContext(basePath);
    const sourcePath = segments.length > 0
        ? resolvePathInExecutionContext(basePath, ...segments)
        : basePath;
    return translatePathForHostFilesystem(sourcePath, baseContext.kind === 'wsl' ? baseContext : undefined);
}

/** {@link resolvePathForHostFilesystem}, resolving the default distro on demand. */
export async function resolvePathForHostFilesystemAsync(basePath: string, ...segments: string[]): Promise<string> {
    const baseContext = await resolveWorkspaceExecutionContextAsync(basePath);
    const sourcePath = segments.length > 0
        ? resolvePathInExecutionContext(basePath, ...segments)
        : basePath;
    return translatePathForHostFilesystemAsync(sourcePath, baseContext.kind === 'wsl' ? baseContext : undefined);
}

export function buildWslCommandArgs(context: WslExecutionContext, argv: string[]): string[] {
    const args: string[] = [];
    if (context.distro) {
        args.push('-d', context.distro);
    }
    args.push('--cd', context.linuxWorkingDirectory, '--', ...argv);
    return args;
}

export function normalizeWslExecutionPath(linuxPath: string, distro?: string): string {
    const normalizedLinuxPath = normalizeLinuxPath(linuxPath);
    const normalizedDistro = (distro ?? 'default').toLowerCase();
    return `wsl://${normalizedDistro}${normalizedLinuxPath}`;
}

function normalizeHostExecutionPath(pathLike: string): string {
    let normalized = toForwardSlashes(path.resolve(pathLike));
    if (process.platform === 'win32') {
        normalized = normalized.toLowerCase();
    }
    return trimTrailingPathSeparators(normalized);
}

export function normalizeExecutionPath(pathLike: string): string {
    const context = resolveWorkspaceExecutionContext(pathLike);
    if (context.kind === 'wsl') {
        return normalizeWslExecutionPath(context.linuxWorkingDirectory, context.distro);
    }
    return normalizeHostExecutionPath(pathLike);
}

/**
 * {@link normalizeExecutionPath}, resolving the default distro on demand.
 *
 * Prefer this wherever the result becomes a workspace identity: the synchronous
 * form falls back to `wsl://default/...` before the cache is warm, which would
 * key one repository under two identities across a warm-up.
 */
export async function normalizeExecutionPathAsync(pathLike: string): Promise<string> {
    const context = await resolveWorkspaceExecutionContextAsync(pathLike);
    if (context.kind === 'wsl') {
        return normalizeWslExecutionPath(context.linuxWorkingDirectory, context.distro);
    }
    return normalizeHostExecutionPath(pathLike);
}

export function isWslExecutionContext(context: WorkspaceExecutionContext): context is WslExecutionContext {
    return context.kind === 'wsl';
}

export function isWslPath(pathLike: string): boolean {
    return isWslUncPath(pathLike) || (process.platform === 'win32' && isLinuxAbsolutePath(pathLike));
}
