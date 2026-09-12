/**
 * Python-specific Pyright runtime resolution.
 *
 * JavaScript entry points are run through Node rather than npm shell shims, so
 * the same command vector works with `shell: false` on every supported host.
 */

import { createRequire } from 'module';
import * as fs from 'fs';
import * as path from 'path';
import { normalizeRelativePath } from './file-match';
import { findExecutableOnPath } from './rust-adapter';
import type { JsonValue, LanguageServerDefinition } from './types';

const PYRIGHT_SERVER_SPECIFIER = 'pyright/langserver.index.js';
const PYRIGHT_SERVER_PARTS = ['node_modules', 'pyright', 'langserver.index.js'] as const;

export type PythonRuntimeOrigin = 'project' | 'bundled' | 'path' | 'unavailable';

export interface PythonRuntime {
    command: string;
    args: string[];
    origin: PythonRuntimeOrigin;
    label: string;
}

export interface PythonRuntimeDeps {
    exists?: (candidate: string) => boolean;
    isExecutable?: (candidate: string) => boolean;
    realpath?: (candidate: string) => string | undefined;
    resolveBundled?: (specifier: string) => string | undefined;
    resolveOnPath?: (command: string) => string | undefined;
    nodePath?: string;
    pathApi?: path.PlatformPath;
    platform?: NodeJS.Platform;
}

const bundledRequire = createRequire(__filename);

export function resolvePythonRuntime(
    definition: LanguageServerDefinition,
    rootPath: string,
    deps: PythonRuntimeDeps = {},
): PythonRuntime {
    const exists = deps.exists ?? defaultExists;
    const pathApi = deps.pathApi ?? path;
    const nodePath = deps.nodePath ?? process.execPath;
    const stdioArgs = definition.args.length > 0 ? definition.args : ['--stdio'];
    const projectServer = findUp(rootPath, PYRIGHT_SERVER_PARTS, exists, pathApi);
    if (projectServer) {
        return {
            command: nodePath,
            args: [projectServer, ...stdioArgs],
            origin: 'project',
            label: 'Server: project',
        };
    }

    const bundledServer = (deps.resolveBundled ?? defaultResolveBundled)(PYRIGHT_SERVER_SPECIFIER);
    if (bundledServer) {
        return {
            command: nodePath,
            args: [bundledServer, ...stdioArgs],
            origin: 'bundled',
            label: 'Server: packaged with CoC',
        };
    }

    const pathCommand = (deps.resolveOnPath ?? findExecutableOnPath)(definition.command);
    if (pathCommand) {
        return {
            command: pathCommand,
            args: definition.args,
            origin: 'path',
            label: 'Server: system PATH',
        };
    }

    return {
        command: definition.command,
        args: definition.args,
        origin: 'unavailable',
        label: 'Server: unavailable',
    };
}

export function applyPythonRuntime(
    definition: LanguageServerDefinition,
    runtime: PythonRuntime,
    rootPath?: string,
    deps: Pick<PythonRuntimeDeps, 'isExecutable' | 'pathApi' | 'platform'> = {},
): LanguageServerDefinition {
    const prepared: LanguageServerDefinition = {
        ...definition,
        command: runtime.command,
        args: runtime.args,
    };
    if (!rootPath) {
        return prepared;
    }
    const settings = definition.settings;
    if (settings !== undefined && !isPlainObject(settings)) {
        return prepared;
    }
    const base = isPlainObject(settings) ? settings : {};
    if (base.python !== undefined && !isPlainObject(base.python)) {
        return prepared;
    }
    const python = isPlainObject(base.python) ? base.python : {};
    if (Object.prototype.hasOwnProperty.call(python, 'pythonPath')) {
        return prepared;
    }
    const pythonPath = resolvePythonInterpreter(rootPath, deps);
    if (!pythonPath) {
        return prepared;
    }
    prepared.settings = {
        ...base,
        python: {
            ...python,
            pythonPath,
        },
    };
    return prepared;
}

/**
 * Resolves Python's nearest project marker while checking canonical paths so a
 * symlink cannot move the project outside its owning workspace.
 */
export function resolvePythonServerRoot(
    definition: LanguageServerDefinition,
    workspaceRoot: string,
    relativePath: string,
    deps: Pick<PythonRuntimeDeps, 'exists' | 'pathApi' | 'realpath'> = {},
): string {
    const pathApi = deps.pathApi ?? path;
    const exists = deps.exists ?? defaultExists;
    const realpath = deps.realpath ?? defaultRealpath;
    const lexicalRoot = pathApi.resolve(workspaceRoot);
    const lexicalDirectory = pathApi.dirname(pathApi.resolve(lexicalRoot, normalizeRelativePath(relativePath)));
    if (!isWithin(lexicalRoot, lexicalDirectory, pathApi)) {
        return lexicalRoot;
    }
    const canonicalRoot = realpath(lexicalRoot) ?? lexicalRoot;
    const canonicalDirectory = realpath(lexicalDirectory) ?? lexicalDirectory;
    if (!isWithin(canonicalRoot, canonicalDirectory, pathApi)) {
        return lexicalRoot;
    }

    let current = lexicalDirectory;
    while (isWithin(lexicalRoot, current, pathApi)) {
        for (const marker of definition.rootMarkers) {
            if (exists(pathApi.join(current, marker))) {
                return current;
            }
        }
        const parent = pathApi.dirname(current);
        if (parent === current) {
            break;
        }
        current = parent;
    }
    return lexicalRoot;
}

/**
 * Finds a usable project-local interpreter. Explicit `python.pythonPath`
 * settings are handled by `applyPythonRuntime` and are never replaced.
 */
export function resolvePythonInterpreter(
    rootPath: string,
    deps: Pick<PythonRuntimeDeps, 'isExecutable' | 'pathApi' | 'platform'> = {},
): string | undefined {
    const pathApi = deps.pathApi ?? path;
    const platform = deps.platform ?? process.platform;
    const isExecutable = deps.isExecutable ?? defaultIsExecutable;
    const interpreter = platform === 'win32'
        ? ['Scripts', 'python.exe']
        : ['bin', 'python'];
    for (const environment of ['.venv', 'venv']) {
        const candidate = pathApi.join(rootPath, environment, ...interpreter);
        if (isExecutable(candidate)) {
            return candidate;
        }
    }
    return undefined;
}

function findUp(
    from: string,
    relativeParts: readonly string[],
    exists: (candidate: string) => boolean,
    pathApi: path.PlatformPath,
): string | undefined {
    let dir = pathApi.resolve(from);
    for (;;) {
        const candidate = pathApi.join(dir, ...relativeParts);
        if (exists(candidate)) {
            return candidate;
        }
        const parent = pathApi.dirname(dir);
        if (parent === dir) {
            return undefined;
        }
        dir = parent;
    }
}

function defaultExists(candidate: string): boolean {
    try {
        return fs.existsSync(candidate);
    } catch {
        return false;
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

function defaultRealpath(candidate: string): string | undefined {
    try {
        return fs.realpathSync.native(candidate);
    } catch {
        return undefined;
    }
}

function defaultResolveBundled(specifier: string): string | undefined {
    try {
        return bundledRequire.resolve(specifier);
    } catch {
        return undefined;
    }
}

function isWithin(root: string, candidate: string, pathApi: path.PlatformPath): boolean {
    const relative = pathApi.relative(root, candidate);
    return relative === ''
        || (!pathApi.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${pathApi.sep}`));
}

function isPlainObject(value: JsonValue | undefined): value is { [key: string]: JsonValue } {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
