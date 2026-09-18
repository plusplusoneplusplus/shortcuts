/**
 * The symbol index's answer to the runtime hook: point the definition at the
 * `coc-symbols-lsp` binary CoC ships, and tell it which SQLite index to open.
 *
 * Every other adapter hunts for a server someone else installed. This one is
 * different in two ways. The executable is ours, resolved from the
 * `@plusplusoneplusplus/coc-native` package by the same precedence as the
 * addon, so there is nothing to install and nothing to discover on PATH. And
 * the server needs one piece of host state — the index file for this
 * workspace — which arrives as `--database` here rather than as an
 * `initializationOptions` field, because argv stays server-side while
 * initialization options are visible to anything that reads the session's
 * definition.
 *
 * For the same reason the resolved path never leaves this module in a label:
 * `commandLabel` is the plain binary name and the unavailable note names a
 * command to run, not a directory that was searched.
 */

import { symbolsLspStatus } from '@plusplusoneplusplus/coc-native';
import { getRepoDataPath } from '../paths';
import type { LanguageServerDefinition } from './types';

export type SymbolsRuntimeOrigin = 'bundled' | 'unavailable';

export interface SymbolsRuntime {
    command: string;
    args: string[];
    origin: SymbolsRuntimeOrigin;
    label: string;
    notes?: string[];
    recoveryCommand?: string;
}

export interface SymbolsRuntimeDeps {
    /** Resolved CoC data directory; the index file lives beneath it. */
    dataDir?: string;
    /** Workspace whose index this session serves. */
    workspaceId?: string;
    /** Injectable for tests: absolute path of the bundled server, if present. */
    resolveSymbolsLspBinary?: () => string | undefined;
}

/** File name of the index, shared with the build that produced it. */
export const SYMBOL_INDEX_FILE_NAME = 'symbol-index.sqlite';

/** Safe command a user may run to produce the missing binary. */
export const SYMBOLS_LSP_BUILD_COMMAND = 'npm run build:native -w packages/coc-native';

/**
 * Where this workspace's index lives. The location predates the language
 * server — it is the file the HTTP lane built — so an existing index is
 * reused rather than rebuilt from scratch.
 */
export function symbolIndexDatabasePath(dataDir: string, workspaceId: string): string {
    return getRepoDataPath(dataDir, workspaceId, SYMBOL_INDEX_FILE_NAME);
}

export function resolveSymbolsRuntime(
    definition: LanguageServerDefinition,
    deps: SymbolsRuntimeDeps = {},
): SymbolsRuntime {
    const binary = (deps.resolveSymbolsLspBinary ?? defaultResolveSymbolsLspBinary)();
    if (!binary) {
        return {
            command: definition.command,
            args: definition.args,
            origin: 'unavailable',
            label: 'Server: unavailable',
            notes: ['The bundled symbol index server was not built for this platform.'],
            recoveryCommand: SYMBOLS_LSP_BUILD_COMMAND,
        };
    }
    return {
        command: binary,
        args: [...databaseArgs(deps), ...definition.args],
        origin: 'bundled',
        label: 'Server: bundled with CoC',
    };
}

export function applySymbolsRuntime(
    definition: LanguageServerDefinition,
    runtime: SymbolsRuntime,
): LanguageServerDefinition {
    return {
        ...definition,
        command: runtime.command,
        args: runtime.args,
    };
}

/**
 * Our `--database` comes first so a workspace that repointed `args` still
 * wins: the server takes the last `--database` it is given.
 */
function databaseArgs(deps: SymbolsRuntimeDeps): string[] {
    if (!deps.dataDir || !deps.workspaceId) {
        // Without a workspace there is no shared index to open; the server
        // falls back to one beside the project root rather than failing.
        return [];
    }
    return ['--database', symbolIndexDatabasePath(deps.dataDir, deps.workspaceId)];
}

function defaultResolveSymbolsLspBinary(): string | undefined {
    return symbolsLspStatus().binaryPath;
}
