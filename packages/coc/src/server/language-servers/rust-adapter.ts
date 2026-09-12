import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { normalizeRelativePath } from './file-match';
import { resolveServerRoot } from './selection';
import type { LanguageServerDefinition } from './types';

export const RUSTUP_RESOLUTION_TIMEOUT_MS = 3_000;
export const RUST_ANALYZER_INSTALL_GUIDANCE = 'Install with: rustup component add rust-analyzer';
export const RUST_ANALYZER_RECOVERY_COMMAND = 'rustup component add rust-analyzer';

export type RustRuntimeOrigin = 'rustup' | 'path' | 'unavailable';

export interface RustRuntime {
    command: string;
    args: string[];
    origin: RustRuntimeOrigin;
    label: string;
    notes: string[];
    recoveryCommand?: string;
}

export interface RustRuntimeDeps {
    runRustupWhich?: (rootPath: string, timeoutMs: number) => string | undefined;
    resolveOnPath?: (command: string) => string | undefined;
    isRustupProxy?: (candidate: string) => boolean;
    /** Reads a Cargo manifest for workspace-root discovery. */
    readFile?: (file: string) => string | undefined;
}

export interface PathResolutionOptions {
    env?: NodeJS.ProcessEnv;
    platform?: NodeJS.Platform;
    isExecutable?: (candidate: string) => boolean;
}

export function resolveRustRuntime(
    definition: LanguageServerDefinition,
    rootPath: string,
    deps: RustRuntimeDeps = {},
): RustRuntime {
    const rustupPath = (deps.runRustupWhich ?? defaultRunRustupWhich)(rootPath, RUSTUP_RESOLUTION_TIMEOUT_MS);
    if (rustupPath) {
        return {
            command: rustupPath,
            args: definition.args,
            origin: 'rustup',
            label: rustupRuntimeLabel(rustupPath),
            notes: [],
        };
    }

    const pathCommand = (deps.resolveOnPath ?? findExecutableOnPath)(definition.command);
    if (pathCommand) {
        const rustupProxy = (deps.isRustupProxy ?? defaultIsRustupProxy)(pathCommand);
        return {
            command: pathCommand,
            args: definition.args,
            origin: rustupProxy ? 'rustup' : 'path',
            label: rustupProxy ? 'Server: rustup proxy' : 'Server: system PATH',
            notes: rustupProxy ? [RUST_ANALYZER_INSTALL_GUIDANCE] : [],
            ...(rustupProxy ? { recoveryCommand: RUST_ANALYZER_RECOVERY_COMMAND } : {}),
        };
    }

    return {
        command: definition.command,
        args: definition.args,
        origin: 'unavailable',
        label: 'Server: unavailable',
        notes: [RUST_ANALYZER_INSTALL_GUIDANCE],
        recoveryCommand: RUST_ANALYZER_RECOVERY_COMMAND,
    };
}

/**
 * Resolves a Rust project to its outermost Cargo workspace, falling back to
 * the nearest Cargo manifest when no readable workspace manifest is present.
 */
export function resolveRustServerRoot(
    definition: LanguageServerDefinition,
    workspaceRoot: string,
    relativePath: string,
    deps: Pick<RustRuntimeDeps, 'readFile'> & { exists?: (candidate: string) => boolean } = {},
): string {
    const exists = deps.exists ?? fs.existsSync;
    const readFile = deps.readFile ?? defaultReadFile;
    const root = path.resolve(workspaceRoot);
    const fallback = resolveServerRoot(definition, root, relativePath, exists);
    let dir = path.dirname(path.resolve(root, normalizeRelativePath(relativePath)));
    let cargoWorkspace: string | undefined;

    while (dir === root || dir.startsWith(`${root}${path.sep}`)) {
        const manifest = path.join(dir, 'Cargo.toml');
        if (exists(manifest) && declaresCargoWorkspace(manifest, readFile)) {
            cargoWorkspace = dir;
        }
        const parent = path.dirname(dir);
        if (parent === dir) {
            break;
        }
        dir = parent;
    }

    return cargoWorkspace ?? fallback;
}

export function applyRustRuntime(
    definition: LanguageServerDefinition,
    runtime: RustRuntime,
): LanguageServerDefinition {
    return {
        ...definition,
        command: runtime.command,
        args: runtime.args,
    };
}

export function findExecutableOnPath(
    command: string,
    options: PathResolutionOptions = {},
): string | undefined {
    const env = options.env ?? process.env;
    const platform = options.platform ?? process.platform;
    const isExecutable = options.isExecutable ?? defaultIsExecutable;
    const pathValue = env.PATH ?? env.Path ?? env.path;
    if (!pathValue) {
        return undefined;
    }

    const pathApi = platform === 'win32' ? path.win32 : path.posix;
    const names = executableNames(command, platform, env.PATHEXT, pathApi);
    for (const entry of pathValue.split(pathApi.delimiter)) {
        const directory = stripSurroundingQuotes(entry.trim());
        if (!directory) {
            continue;
        }
        for (const name of names) {
            const candidate = pathApi.resolve(directory, name);
            if (isExecutable(candidate)) {
                return candidate;
            }
        }
    }
    return undefined;
}

function defaultRunRustupWhich(rootPath: string, timeoutMs: number): string | undefined {
    const result = spawnSync('rustup', ['which', 'rust-analyzer'], {
        cwd: rootPath,
        timeout: timeoutMs,
        shell: false,
        encoding: 'utf8',
        windowsHide: true,
    });
    if (result.status !== 0 || typeof result.stdout !== 'string') {
        return undefined;
    }
    const resolved = result.stdout.trim().split(/\r?\n/, 1)[0];
    return resolved && path.isAbsolute(resolved) ? resolved : undefined;
}

function defaultReadFile(file: string): string | undefined {
    try {
        return fs.readFileSync(file, 'utf8');
    } catch {
        return undefined;
    }
}

function declaresCargoWorkspace(file: string, readFile: (file: string) => string | undefined): boolean {
    try {
        const content = readFile(file);
        return content !== undefined && content.split(/\r?\n/).some(line => (
            /^\s*\[\s*(?:workspace|"workspace"|'workspace')\s*\]\s*(?:#.*)?$/.test(line)
        ));
    } catch {
        return false;
    }
}

function executableNames(
    command: string,
    platform: NodeJS.Platform,
    pathExt: string | undefined,
    pathApi: path.PlatformPath,
): string[] {
    if (platform !== 'win32' || pathApi.extname(command)) {
        return [command];
    }
    const extensions = (pathExt || '.COM;.EXE;.BAT;.CMD')
        .split(';')
        .filter(Boolean)
        .map((extension) => extension.toLowerCase());
    return extensions.map((extension) => `${command}${extension}`);
}

function stripSurroundingQuotes(value: string): string {
    return value.length >= 2 && value.startsWith('"') && value.endsWith('"') ? value.slice(1, -1) : value;
}

function defaultIsExecutable(candidate: string): boolean {
    try {
        fs.accessSync(candidate, process.platform === 'win32' ? fs.constants.F_OK : fs.constants.X_OK);
        return fs.statSync(candidate).isFile();
    } catch {
        return false;
    }
}

function defaultIsRustupProxy(candidate: string): boolean {
    try {
        const resolved = fs.realpathSync(candidate);
        if (/^rustup(?:\.exe)?$/i.test(path.basename(resolved))) {
            return true;
        }
        const rustup = findExecutableOnPath('rustup');
        if (!rustup) {
            return false;
        }
        const candidateStat = fs.statSync(candidate);
        const rustupStat = fs.statSync(rustup);
        return candidateStat.ino !== 0
            && candidateStat.dev === rustupStat.dev
            && candidateStat.ino === rustupStat.ino;
    } catch {
        return false;
    }
}

function rustupRuntimeLabel(resolvedPath: string): string {
    const match = resolvedPath.match(/[\\/]toolchains[\\/]([^\\/]+)[\\/]/);
    const channel = match?.[1].match(/^(stable|beta|nightly)(?:-|$)/)?.[1];
    return channel ? `Server: rustup (${channel})` : 'Server: rustup';
}
