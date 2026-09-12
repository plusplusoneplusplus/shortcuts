/**
 * Python-specific Pyright runtime resolution.
 *
 * JavaScript entry points are run through Node rather than npm shell shims, so
 * the same command vector works with `shell: false` on every supported host.
 */

import { createRequire } from 'module';
import * as fs from 'fs';
import * as path from 'path';
import { findExecutableOnPath } from './rust-adapter';
import type { LanguageServerDefinition } from './types';

const PYRIGHT_SERVER_SPECIFIER = 'pyright/langserver.index.js';
const PYRIGHT_SERVER_RELATIVE = path.join('node_modules', 'pyright', 'langserver.index.js');

export type PythonRuntimeOrigin = 'project' | 'bundled' | 'path' | 'unavailable';

export interface PythonRuntime {
    command: string;
    args: string[];
    origin: PythonRuntimeOrigin;
    label: string;
}

export interface PythonRuntimeDeps {
    exists?: (candidate: string) => boolean;
    resolveBundled?: (specifier: string) => string | undefined;
    resolveOnPath?: (command: string) => string | undefined;
    nodePath?: string;
    pathApi?: path.PlatformPath;
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
    const projectServer = findUp(rootPath, PYRIGHT_SERVER_RELATIVE, exists, pathApi);
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
): LanguageServerDefinition {
    return {
        ...definition,
        command: runtime.command,
        args: runtime.args,
    };
}

function findUp(
    from: string,
    relative: string,
    exists: (candidate: string) => boolean,
    pathApi: path.PlatformPath,
): string | undefined {
    let dir = pathApi.resolve(from);
    for (;;) {
        const candidate = pathApi.join(dir, relative);
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

function defaultResolveBundled(specifier: string): string | undefined {
    try {
        return bundledRequire.resolve(specifier);
    } catch {
        return undefined;
    }
}
