/**
 * TypeScript-specific runtime resolution.
 *
 * Everything TypeScript knows about how to start a server lives here rather
 * than in the shared session, manager, or transport code. Two questions are
 * answered for a project root:
 *
 * 1. Which `typescript-language-server` runs — the one installed in the
 *    workspace, the one packaged with CoC, or whatever is on `PATH`.
 * 2. Which TypeScript library it drives — a compatible workspace TypeScript
 *    when there is one, otherwise the packaged fallback.
 *
 * Both are resolved by walking up from the project root, so a monorepo package
 * gets its own copy when it has one and the repository root's otherwise. The
 * resolved paths are host paths: they belong in the definition handed to the
 * session, never in a payload sent to the browser. What the browser may see is
 * the short `runtimeLabel`.
 */

import { createRequire } from 'module';
import * as fs from 'fs';
import * as path from 'path';
import type { JsonValue, LanguageServerDefinition } from './types';

/** Oldest TypeScript the language server is known to drive correctly. */
export const MIN_WORKSPACE_TYPESCRIPT_VERSION = '4.8.0';

const SERVER_CLI_SPECIFIER = 'typescript-language-server/lib/cli.mjs';
const SERVER_CLI_RELATIVE = path.join('node_modules', 'typescript-language-server', 'lib', 'cli.mjs');
const TYPESCRIPT_MANIFEST_RELATIVE = path.join('node_modules', 'typescript', 'package.json');
const TSSERVER_FILE = 'tsserver.js';

/** Where a resolved executable or library came from. */
export type TypeScriptRuntimeOrigin = 'workspace' | 'bundled' | 'path' | 'server-default';

export interface TypeScriptRuntime {
    /** Executable to spawn. */
    command: string;
    /** Argument vector for that executable. */
    args: string[];
    /** Where the language server itself came from. */
    server: TypeScriptRuntimeOrigin;
    /** Where the TypeScript library came from. */
    typescript: TypeScriptRuntimeOrigin;
    /** Version of the chosen TypeScript library, when it could be read. */
    typescriptVersion?: string;
    /** Absolute path to the chosen `tsserver.js`. A host path — never sent out. */
    tsserverPath?: string;
    /** Short, user-facing summary with no host paths in it. */
    label: string;
    /** User-facing notes, e.g. why a workspace TypeScript was rejected. */
    notes: string[];
}

export interface TypeScriptRuntimeDeps {
    /** Existence check, injectable so tests need no fixture tree on disk. */
    exists?: (candidate: string) => boolean;
    /** Reads and parses a JSON file, returning undefined when unusable. */
    readJson?: (file: string) => unknown;
    /** Resolves a specifier against CoC's own installation. */
    resolveBundled?: (specifier: string) => string | undefined;
    /** Node executable used to run a resolved `.mjs` entry point. */
    nodePath?: string;
}

// `__filename` rather than `import.meta.url`: this package compiles to CommonJS.
const bundledRequire = createRequire(__filename);

/**
 * Picks the language server and TypeScript library for one project root.
 *
 * The server is run through Node with its JavaScript entry point rather than
 * through a `node_modules/.bin` shim: the shim is a shell script on POSIX and a
 * `.cmd` file on Windows, and spawning either without a shell is exactly what
 * the definition contract forbids.
 */
export function resolveTypeScriptRuntime(
    definition: LanguageServerDefinition,
    rootPath: string,
    deps: TypeScriptRuntimeDeps = {},
): TypeScriptRuntime {
    const exists = deps.exists ?? defaultExists;
    const readJson = deps.readJson ?? defaultReadJson;
    const resolveBundled = deps.resolveBundled ?? defaultResolveBundled;
    const nodePath = deps.nodePath ?? process.execPath;
    const notes: string[] = [];

    const server = resolveServer(definition, rootPath, { exists, resolveBundled, nodePath });
    const typescript = resolveTypeScriptLibrary(rootPath, { exists, readJson, resolveBundled }, notes);

    return {
        command: server.command,
        args: server.args,
        server: server.origin,
        typescript: typescript.origin,
        typescriptVersion: typescript.version,
        tsserverPath: typescript.tsserverPath,
        label: describeRuntime(server.origin, typescript),
        notes,
    };
}

/**
 * Applies a resolved runtime to a definition.
 *
 * `tsserver.path` is only filled in when the configuration does not already
 * name one, so a user who points the preset at a specific TypeScript keeps it.
 */
export function applyTypeScriptRuntime(
    definition: LanguageServerDefinition,
    runtime: TypeScriptRuntime,
): LanguageServerDefinition {
    const prepared: LanguageServerDefinition = {
        ...definition,
        command: runtime.command,
        args: runtime.args,
    };
    if (!runtime.tsserverPath) {
        return prepared;
    }
    const options = definition.initializationOptions;
    if (options !== undefined && !isPlainObject(options)) {
        // Something we do not understand; leave the user's value alone.
        return prepared;
    }
    const base = isPlainObject(options) ? options : {};
    const tsserver = isPlainObject(base.tsserver) ? base.tsserver : {};
    if (typeof tsserver.path === 'string' && tsserver.path.length > 0) {
        return prepared;
    }
    prepared.initializationOptions = {
        ...base,
        tsserver: { ...tsserver, path: runtime.tsserverPath },
    };
    return prepared;
}

function resolveServer(
    definition: LanguageServerDefinition,
    rootPath: string,
    deps: {
        exists: (candidate: string) => boolean;
        resolveBundled: (specifier: string) => string | undefined;
        nodePath: string;
    },
): { command: string; args: string[]; origin: TypeScriptRuntimeOrigin } {
    const stdioArgs = definition.args.length > 0 ? definition.args : ['--stdio'];
    const workspaceCli = findUp(rootPath, SERVER_CLI_RELATIVE, deps.exists);
    if (workspaceCli) {
        return { command: deps.nodePath, args: [workspaceCli, ...stdioArgs], origin: 'workspace' };
    }
    const bundledCli = deps.resolveBundled(SERVER_CLI_SPECIFIER);
    if (bundledCli) {
        return { command: deps.nodePath, args: [bundledCli, ...stdioArgs], origin: 'bundled' };
    }
    // Nothing installed on this host: keep the configured executable and let a
    // missing one surface as the session's `unavailable` status.
    return { command: definition.command, args: definition.args, origin: 'path' };
}

function resolveTypeScriptLibrary(
    rootPath: string,
    deps: {
        exists: (candidate: string) => boolean;
        readJson: (file: string) => unknown;
        resolveBundled: (specifier: string) => string | undefined;
    },
    notes: string[],
): { origin: TypeScriptRuntimeOrigin; version?: string; tsserverPath?: string } {
    const workspaceManifest = findUp(rootPath, TYPESCRIPT_MANIFEST_RELATIVE, deps.exists);
    let rejected: string | undefined;
    if (workspaceManifest) {
        const version = readVersion(deps.readJson(workspaceManifest));
        const tsserverPath = path.join(path.dirname(workspaceManifest), 'lib', TSSERVER_FILE);
        if (!deps.exists(tsserverPath)) {
            rejected = 'The workspace TypeScript installation has no tsserver.';
        } else if (version && !isAtLeast(version, MIN_WORKSPACE_TYPESCRIPT_VERSION)) {
            rejected = `Workspace TypeScript ${version} is older than ${MIN_WORKSPACE_TYPESCRIPT_VERSION}.`;
        } else {
            return { origin: 'workspace', version, tsserverPath };
        }
    }

    const bundledManifest = deps.resolveBundled('typescript/package.json');
    if (bundledManifest) {
        const version = readVersion(deps.readJson(bundledManifest));
        const tsserverPath = path.join(path.dirname(bundledManifest), 'lib', TSSERVER_FILE);
        if (deps.exists(tsserverPath)) {
            if (rejected) {
                notes.push(`${rejected} Using the TypeScript packaged with CoC${version ? ` (${version})` : ''}.`);
            }
            return { origin: 'bundled', version, tsserverPath };
        }
    }
    if (rejected) {
        notes.push(`${rejected} The language server will choose its own TypeScript.`);
    }
    return { origin: 'server-default' };
}

/** Walks up from a directory looking for a relative path that exists. */
export function findUp(from: string, relative: string, exists: (candidate: string) => boolean): string | undefined {
    let dir = path.resolve(from);
    for (;;) {
        const candidate = path.join(dir, relative);
        if (exists(candidate)) {
            return candidate;
        }
        const parent = path.dirname(dir);
        if (parent === dir) {
            return undefined;
        }
        dir = parent;
    }
}

/** True when `version` is at least `minimum`, comparing numeric parts only. */
export function isAtLeast(version: string, minimum: string): boolean {
    const left = numericParts(version);
    const right = numericParts(minimum);
    for (let index = 0; index < Math.max(left.length, right.length); index++) {
        const a = left[index] ?? 0;
        const b = right[index] ?? 0;
        if (a !== b) {
            return a > b;
        }
    }
    return true;
}

function numericParts(version: string): number[] {
    return version
        .split('-')[0]
        .split('.')
        .map((part) => Number.parseInt(part, 10))
        .map((value) => (Number.isFinite(value) ? value : 0));
}

function describeRuntime(
    server: TypeScriptRuntimeOrigin,
    typescript: { origin: TypeScriptRuntimeOrigin; version?: string },
): string {
    const parts = [`Server: ${originLabel(server)}`];
    if (typescript.origin === 'server-default') {
        parts.push('TypeScript: chosen by the server');
    } else {
        const version = typescript.version ? ` ${typescript.version}` : '';
        parts.push(`TypeScript${version}: ${originLabel(typescript.origin)}`);
    }
    return parts.join(' · ');
}

function originLabel(origin: TypeScriptRuntimeOrigin): string {
    switch (origin) {
        case 'workspace':
            return 'workspace';
        case 'bundled':
            return 'packaged with CoC';
        case 'path':
            return 'system PATH';
        default:
            return 'server default';
    }
}

function isPlainObject(value: unknown): value is Record<string, JsonValue> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readVersion(manifest: unknown): string | undefined {
    if (!isPlainObject(manifest)) {
        return undefined;
    }
    const version = manifest.version;
    return typeof version === 'string' && version.length > 0 ? version : undefined;
}

function defaultExists(candidate: string): boolean {
    try {
        return fs.existsSync(candidate);
    } catch {
        return false;
    }
}

function defaultReadJson(file: string): unknown {
    try {
        return JSON.parse(fs.readFileSync(file, 'utf8'));
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
