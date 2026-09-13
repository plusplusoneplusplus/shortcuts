import * as fs from 'fs';
import * as path from 'path';
import { findExecutableOnPath } from './rust-adapter';
import { resolveServerRoot } from './selection';
import type { LanguageServerDefinition } from './types';

export type ClangdRuntimeOrigin = 'path' | 'well-known' | 'unavailable';

export interface ClangdRuntime {
    command: string;
    args: string[];
    origin: ClangdRuntimeOrigin;
    label: string;
    notes?: string[];
    recoveryCommand?: string;
}

export interface ClangdRuntimeDeps {
    exists?: (candidate: string) => boolean;
    isExecutable?: (candidate: string) => boolean;
    readDir?: (directory: string) => string[];
    resolveOnPath?: (command: string) => string | undefined;
    platform?: NodeJS.Platform;
    env?: NodeJS.ProcessEnv;
}

export function resolveClangdRuntime(
    definition: LanguageServerDefinition,
    deps: ClangdRuntimeDeps = {},
): ClangdRuntime {
    const pathCommand = (deps.resolveOnPath ?? findExecutableOnPath)(definition.command);
    if (pathCommand) {
        return {
            command: pathCommand,
            args: definition.args,
            origin: 'path',
            label: 'Server: system PATH',
        };
    }

    const wellKnown = findWellKnownClangd(deps);
    if (wellKnown) {
        return {
            command: wellKnown,
            args: definition.args,
            origin: 'well-known',
            label: 'Server: system installation',
        };
    }

    return {
        command: definition.command,
        args: definition.args,
        origin: 'unavailable',
        label: 'Server: unavailable',
        notes: [`Install with: ${clangdInstallCommand(deps.platform ?? process.platform)}`],
        recoveryCommand: clangdInstallCommand(deps.platform ?? process.platform),
    };
}

export function clangdInstallCommand(platform: NodeJS.Platform): string {
    if (platform === 'darwin') {
        return 'brew install llvm';
    }
    if (platform === 'win32') {
        return 'winget install LLVM.LLVM';
    }
    return 'apt install clangd';
}

export function applyClangdRuntime(
    definition: LanguageServerDefinition,
    runtime: ClangdRuntime,
): LanguageServerDefinition {
    return {
        ...definition,
        command: runtime.command,
        args: runtime.args,
    };
}

export function resolveClangdServerRoot(
    definition: LanguageServerDefinition,
    workspaceRoot: string,
    relativePath: string,
    deps: Pick<ClangdRuntimeDeps, 'exists'> = {},
): string {
    return resolveServerRoot(definition, workspaceRoot, relativePath, deps.exists);
}

function findWellKnownClangd(deps: ClangdRuntimeDeps): string | undefined {
    const platform = deps.platform ?? process.platform;
    const env = deps.env ?? process.env;
    const isExecutable = deps.isExecutable ?? defaultIsExecutable;
    const candidates: string[] = [];

    if (platform === 'darwin') {
        candidates.push(
            '/opt/homebrew/opt/llvm/bin/clangd',
            '/usr/local/opt/llvm/bin/clangd',
        );
    } else if (platform === 'win32') {
        for (const programFiles of [env.ProgramFiles, env['ProgramFiles(x86)']]) {
            if (programFiles) {
                candidates.push(path.win32.join(programFiles, 'LLVM', 'bin', 'clangd.exe'));
            }
        }
    } else if (platform === 'linux') {
        const versions = safeReadDir('/usr/lib', deps.readDir ?? defaultReadDir)
            .filter(entry => /^llvm-\d+$/.test(entry))
            .sort((left, right) => Number(right.slice(5)) - Number(left.slice(5)));
        candidates.push(...versions.map(entry => path.posix.join('/usr/lib', entry, 'bin', 'clangd')));
    }

    return candidates.find(isExecutable);
}

function defaultReadDir(directory: string): string[] {
    return fs.readdirSync(directory);
}

function safeReadDir(directory: string, readDir: (directory: string) => string[]): string[] {
    try {
        return readDir(directory);
    } catch {
        return [];
    }
}

function defaultIsExecutable(candidate: string): boolean {
    try {
        fs.accessSync(candidate, process.platform === 'win32' ? fs.constants.F_OK : fs.constants.X_OK);
        return fs.statSync(candidate).isFile();
    } catch {
        return false;
    }
}
