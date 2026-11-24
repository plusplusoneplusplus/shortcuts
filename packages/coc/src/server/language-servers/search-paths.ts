/**
 * Workspace executable search paths for language servers.
 *
 * A desktop app often starts with a short inherited PATH that lacks per-user
 * tool folders such as `~/.cargo/bin`. A workspace may list extra folders.
 * They go in front of the inherited PATH for executable discovery and for
 * every server process, so the server's own child tools (cargo, rustup
 * proxies) resolve the same way. The inherited PATH is kept, never replaced.
 */

import * as os from 'os';
import * as path from 'path';
import type { LanguageServerDefinitionError } from './types';

export const MAX_SEARCH_PATHS = 32;
export const MAX_SEARCH_PATH_LENGTH = 1024;

export interface SearchPathPlatform {
    platform?: NodeJS.Platform;
}

export interface LanguageServerEnvOptions extends SearchPathPlatform {
    /** Inherited environment. Defaults to `process.env`. */
    env?: NodeJS.ProcessEnv;
    /** Home folder used to expand `~`. Defaults to `os.homedir()`. */
    homeDir?: string;
}

function pathApiFor(platform: NodeJS.Platform): path.PlatformPath {
    return platform === 'win32' ? path.win32 : path.posix;
}

function isHomeRelative(value: string): boolean {
    return value === '~' || value.startsWith('~/') || value.startsWith('~\\');
}

/**
 * Validates and normalizes a stored or submitted list. Each entry must be an
 * absolute folder for the owning host or start with `~`. Entries are trimmed
 * and duplicates are dropped. Errors are addressed by index.
 */
export function validateSearchPaths(
    raw: unknown,
    options: SearchPathPlatform = {},
): { searchPaths: string[]; errors: LanguageServerDefinitionError[] } {
    if (!Array.isArray(raw)) {
        return { searchPaths: [], errors: [{ field: '', message: 'Search paths must be a list of folders' }] };
    }
    const platform = options.platform ?? process.platform;
    const pathApi = pathApiFor(platform);
    const errors: LanguageServerDefinitionError[] = [];
    const searchPaths: string[] = [];
    if (raw.length > MAX_SEARCH_PATHS) {
        errors.push({ field: '', message: `Use at most ${MAX_SEARCH_PATHS} search paths` });
    }
    raw.forEach((entry, index) => {
        const field = String(index);
        if (typeof entry !== 'string') {
            errors.push({ field, message: 'Search path must be text' });
            return;
        }
        const value = entry.trim();
        if (!value) {
            errors.push({ field, message: 'Search path cannot be empty' });
        } else if (value.length > MAX_SEARCH_PATH_LENGTH) {
            errors.push({ field, message: `Search path is longer than ${MAX_SEARCH_PATH_LENGTH} characters` });
        } else if (/[\0\r\n]/.test(value)) {
            errors.push({ field, message: 'Search path cannot contain control characters' });
        } else if (hasDelimiter(value, platform)) {
            errors.push({ field, message: `Add one folder per entry; do not join folders with "${pathApi.delimiter}"` });
        } else if (!isHomeRelative(value) && !pathApi.isAbsolute(value)) {
            errors.push({ field, message: 'Search path must be an absolute folder or start with ~' });
        } else if (!searchPaths.includes(value)) {
            searchPaths.push(value);
        }
    });
    return { searchPaths, errors };
}

/** A Windows drive prefix (`C:`) is not a delimiter; any other `;` or POSIX `:` is. */
function hasDelimiter(value: string, platform: NodeJS.Platform): boolean {
    if (platform === 'win32') {
        return value.includes(';');
    }
    return value.includes(':');
}

/**
 * Environment for discovery and server processes. Returns `undefined` when
 * the workspace adds nothing, so callers inherit the environment unchanged.
 *
 * The PATH key keeps the inherited spelling (`Path` on Windows). Inherited
 * PATH entries follow the configured ones, and a missing inherited PATH yields
 * just the configured folders.
 */
export function buildLanguageServerEnv(
    searchPaths: readonly string[] | undefined,
    options: LanguageServerEnvOptions = {},
): NodeJS.ProcessEnv | undefined {
    if (!searchPaths || searchPaths.length === 0) {
        return undefined;
    }
    const platform = options.platform ?? process.platform;
    const pathApi = pathApiFor(platform);
    const baseEnv = options.env ?? process.env;
    const homeDir = options.homeDir ?? os.homedir();
    const key = pathKey(baseEnv, platform);
    const inherited = baseEnv[key];
    const prepended = searchPaths.map((entry) => expandHome(entry, homeDir, pathApi));
    const value = [...prepended, ...(inherited ? [inherited] : [])].join(pathApi.delimiter);
    return { ...baseEnv, [key]: value };
}

function pathKey(env: NodeJS.ProcessEnv, platform: NodeJS.Platform): string {
    if (platform !== 'win32') {
        return 'PATH';
    }
    return Object.keys(env).find((key) => key.toUpperCase() === 'PATH') ?? 'Path';
}

function expandHome(value: string, homeDir: string, pathApi: path.PlatformPath): string {
    if (value === '~') {
        return homeDir;
    }
    if (isHomeRelative(value)) {
        return pathApi.join(homeDir, value.slice(2));
    }
    return value;
}
