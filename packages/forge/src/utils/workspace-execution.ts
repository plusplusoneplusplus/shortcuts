/**
 * Workspace execution helpers for routing operations to either the native host
 * environment or WSL.
 */

import { execFileSync } from 'child_process';
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

let defaultWslDistroCache: string | null | undefined;

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
}

export function getDefaultWslDistro(): string | undefined {
    if (process.platform !== 'win32') {
        return undefined;
    }
    if (defaultWslDistroCache !== undefined) {
        return defaultWslDistroCache ?? undefined;
    }

    try {
        const output = execFileSync(
            getWslExecutablePath(),
            ['-e', 'sh', '-lc', 'printf %s "$WSL_DISTRO_NAME"'],
            { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
        ).trim();
        defaultWslDistroCache = output || null;
        return defaultWslDistroCache ?? undefined;
    } catch {
        defaultWslDistroCache = null;
        return undefined;
    }
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

export function normalizeExecutionPath(pathLike: string): string {
    const context = resolveWorkspaceExecutionContext(pathLike);
    if (context.kind === 'wsl') {
        return normalizeWslExecutionPath(context.linuxWorkingDirectory, context.distro);
    }

    let normalized = path.resolve(pathLike);
    normalized = toForwardSlashes(normalized);
    if (process.platform === 'win32') {
        normalized = normalized.toLowerCase();
    }
    return trimTrailingPathSeparators(normalized);
}

export function isWslExecutionContext(context: WorkspaceExecutionContext): context is WslExecutionContext {
    return context.kind === 'wsl';
}

export function isWslPath(pathLike: string): boolean {
    return isWslUncPath(pathLike) || (process.platform === 'win32' && isLinuxAbsolutePath(pathLike));
}
