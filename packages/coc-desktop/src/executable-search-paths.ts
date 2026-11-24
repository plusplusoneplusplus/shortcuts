/**
 * CoC Desktop — executable search paths for the desktop-started CoC server.
 *
 * A Finder/Dock-launched macOS app inherits launchd's minimal PATH
 * (`/usr/bin:/bin:/usr/sbin:/sbin`), so tools such as Homebrew's `gh` are
 * invisible to the server and every process it starts (PR tools, git hooks,
 * agent CLIs). This installation-wide setting lists folders that the forked
 * server's PATH gains. Shell profiles are never executed.
 *
 * Order of the resulting PATH: bundled agent folders, then the inherited PATH,
 * then configured folders not already present. Configured folders only fill
 * gaps; they never override what the user's environment already finds.
 *
 * The setting affects only a server this app forks. An attached external server
 * and remote servers keep their own environment. It imports nothing from
 * `electron` so it stays unit-testable.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export const EXECUTABLE_PATHS_GET_CHANNEL = 'coc-desktop:executable-paths-get';
export const EXECUTABLE_PATHS_SET_CHANNEL = 'coc-desktop:executable-paths-set';
export const EXECUTABLE_PATHS_FILENAME = 'desktop-executable-paths.json';
export const MAX_EXECUTABLE_PATHS = 32;
export const MAX_EXECUTABLE_PATH_LENGTH = 1024;

export interface PlatformOptions {
    platform?: NodeJS.Platform;
    env?: NodeJS.ProcessEnv;
    homeDir?: string;
}

/** A rejected entry, addressed by its index in the submitted list ('' = whole list). */
export interface ExecutablePathError {
    index: number | null;
    message: string;
}

/**
 * OS defaults. They are folders package managers install into but that a GUI
 * launch may not inherit. Windows GUI apps inherit the full user PATH, so its
 * defaults only cover common per-machine/per-user CLI install folders.
 */
export function defaultExecutableSearchPaths(options: PlatformOptions = {}): string[] {
    const platform = options.platform ?? process.platform;
    const env = options.env ?? process.env;
    if (platform === 'darwin') {
        return ['/opt/homebrew/bin', '/opt/homebrew/sbin', '/usr/local/bin', '/usr/local/sbin', '~/.local/bin'];
    }
    if (platform === 'win32') {
        const programFiles = envValue(env, 'ProgramFiles') ?? 'C:\\Program Files';
        const localAppData = envValue(env, 'LOCALAPPDATA');
        return [
            path.win32.join(programFiles, 'GitHub CLI'),
            path.win32.join(programFiles, 'Git', 'cmd'),
            ...(localAppData ? [path.win32.join(localAppData, 'Microsoft', 'WinGet', 'Links')] : []),
        ];
    }
    return ['/usr/local/bin', '/usr/local/sbin', '~/.local/bin', '/home/linuxbrew/.linuxbrew/bin', '/snap/bin'];
}

/** Case-insensitive env lookup (a copied Windows env object keeps the original key spelling). */
function envValue(env: NodeJS.ProcessEnv, name: string): string | undefined {
    const key = Object.keys(env).find((candidate) => candidate.toUpperCase() === name.toUpperCase());
    const value = key ? env[key]?.trim() : undefined;
    return value || undefined;
}

function pathApiFor(platform: NodeJS.Platform): path.PlatformPath {
    return platform === 'win32' ? path.win32 : path.posix;
}

function isHomeRelative(value: string): boolean {
    return value === '~' || value.startsWith('~/') || value.startsWith('~\\');
}

/**
 * Validates a submitted list. Each entry must be one absolute folder for this
 * host or start with `~`. Entries are trimmed, blank rows are dropped, and
 * duplicates are removed.
 */
export function validateExecutableSearchPaths(
    raw: unknown,
    platform: NodeJS.Platform = process.platform,
): { paths: string[]; errors: ExecutablePathError[] } {
    if (!Array.isArray(raw)) {
        return { paths: [], errors: [{ index: null, message: 'Search paths must be a list of folders.' }] };
    }
    const pathApi = pathApiFor(platform);
    const errors: ExecutablePathError[] = [];
    const paths: string[] = [];
    const seen = new Set<string>();
    raw.forEach((entry, index) => {
        if (typeof entry !== 'string') {
            errors.push({ index, message: 'Search path must be text.' });
            return;
        }
        const value = entry.trim();
        if (!value) { return; }
        if (value.length > MAX_EXECUTABLE_PATH_LENGTH) {
            errors.push({ index, message: `Search path is longer than ${MAX_EXECUTABLE_PATH_LENGTH} characters.` });
        } else if (/[\0\r\n]/.test(value)) {
            errors.push({ index, message: 'Search path cannot contain control characters.' });
        } else if (platform === 'win32' ? value.includes(';') : value.includes(':')) {
            errors.push({ index, message: `Add one folder per row; do not join folders with "${pathApi.delimiter}".` });
        } else if (!isHomeRelative(value) && !pathApi.isAbsolute(value)) {
            errors.push({ index, message: 'Use an absolute folder or start with ~.' });
        } else {
            const key = platform === 'win32' ? value.toLowerCase() : value;
            if (!seen.has(key)) {
                seen.add(key);
                paths.push(value);
            }
        }
    });
    if (paths.length > MAX_EXECUTABLE_PATHS) {
        errors.push({ index: null, message: `Use at most ${MAX_EXECUTABLE_PATHS} search paths.` });
    }
    return { paths, errors };
}

/** The saved setting. `custom` is false when the OS defaults are in use. */
export interface ExecutableSearchPathsSetting {
    paths: string[];
    custom: boolean;
}

/**
 * Reads the saved list. A missing, unreadable, or invalid file falls back to
 * the OS defaults so a bad file can never block server start.
 */
export function readExecutableSearchPaths(dataDir: string, options: PlatformOptions = {}): ExecutableSearchPathsSetting {
    const platform = options.platform ?? process.platform;
    const fallback = { paths: defaultExecutableSearchPaths(options), custom: false };
    let raw: unknown;
    try {
        raw = JSON.parse(fs.readFileSync(path.join(dataDir, EXECUTABLE_PATHS_FILENAME), 'utf8'));
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
            console.warn('[coc-desktop] Could not read executable search paths; using OS defaults.');
        }
        return fallback;
    }
    const stored = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as { paths?: unknown }).paths : undefined;
    const { paths, errors } = validateExecutableSearchPaths(stored, platform);
    if (errors.length > 0) {
        console.warn('[coc-desktop] Invalid executable search paths file; using OS defaults.');
        return fallback;
    }
    return { paths, custom: true };
}

/**
 * Saves a list, or restores the OS defaults when `paths` is null. Writes are
 * atomic (temp file + rename). Throws on invalid input; callers validate first.
 */
export function writeExecutableSearchPaths(dataDir: string, paths: readonly string[] | null): void {
    const destination = path.join(dataDir, EXECUTABLE_PATHS_FILENAME);
    if (paths === null) {
        fs.rmSync(destination, { force: true });
        return;
    }
    fs.mkdirSync(dataDir, { recursive: true });
    const temporary = `${destination}.${process.pid}.tmp`;
    try {
        fs.writeFileSync(temporary, JSON.stringify({ version: 1, paths }, null, 2) + '\n');
        fs.renameSync(temporary, destination);
    } finally {
        fs.rmSync(temporary, { force: true });
    }
}

/** The env key that holds PATH: always `PATH` on POSIX, the existing spelling on Windows. */
export function pathEnvKey(env: NodeJS.ProcessEnv, platform: NodeJS.Platform = process.platform): string {
    if (platform !== 'win32') { return 'PATH'; }
    return Object.keys(env).find((key) => key.toUpperCase() === 'PATH') ?? 'Path';
}

/**
 * Appends configured folders (with `~` expanded) to `basePath`, skipping any
 * already present. Comparison is case-insensitive on Windows.
 */
export function appendExecutableSearchPaths(
    basePath: string,
    paths: readonly string[],
    options: PlatformOptions = {},
): string {
    const platform = options.platform ?? process.platform;
    const pathApi = pathApiFor(platform);
    const homeDir = options.homeDir ?? os.homedir();
    const norm = (value: string) => (platform === 'win32' ? value.toLowerCase() : value);
    const existing = basePath.split(pathApi.delimiter).filter(Boolean);
    const seen = new Set(existing.map(norm));
    const added: string[] = [];
    for (const entry of paths) {
        const expanded = entry === '~' ? homeDir : isHomeRelative(entry) ? pathApi.join(homeDir, entry.slice(2)) : entry;
        const key = norm(expanded);
        if (!seen.has(key)) {
            seen.add(key);
            added.push(expanded);
        }
    }
    return [...existing, ...added].join(pathApi.delimiter);
}

/** How the desktop app reached its local server. Only an owned server uses these paths. */
export type DesktopServerOwnership = 'owned' | 'external' | 'starting';

export interface DesktopServerPathsStatus {
    ownership: DesktopServerOwnership;
    /** Paths the owned server started with; null for an external or starting server. */
    appliedPaths: readonly string[] | null;
}

/** What the settings page shows. PATH values themselves never leave the main process. */
export interface ExecutablePathsState {
    paths: string[];
    custom: boolean;
    defaults: string[];
    platform: NodeJS.Platform;
    server: { ownership: DesktopServerOwnership; appliedPaths: string[] | null };
    /** True when the owned server runs with a different list than the saved one. */
    restartRequired: boolean;
}

export type ExecutablePathsSaveResult =
    | { ok: true; state: ExecutablePathsState }
    | { ok: false; reason: 'invalid'; errors: ExecutablePathError[]; message: string }
    | { ok: false; reason: 'storage-failed'; message: string };

function sameList(a: readonly string[], b: readonly string[]): boolean {
    return a.length === b.length && a.every((value, index) => value === b[index]);
}

export function getExecutablePathsState(
    dataDir: string,
    server: DesktopServerPathsStatus,
    options: PlatformOptions = {},
): ExecutablePathsState {
    const saved = readExecutableSearchPaths(dataDir, options);
    const appliedPaths = server.ownership === 'owned' && server.appliedPaths ? [...server.appliedPaths] : null;
    return {
        paths: saved.paths,
        custom: saved.custom,
        defaults: defaultExecutableSearchPaths(options),
        platform: options.platform ?? process.platform,
        server: { ownership: server.ownership, appliedPaths },
        restartRequired: appliedPaths !== null && !sameList(appliedPaths, saved.paths),
    };
}

/** Saves a submitted list (`null` restores the OS defaults) and returns the new state. */
export function saveExecutablePaths(
    dataDir: string,
    raw: unknown,
    server: DesktopServerPathsStatus,
    options: PlatformOptions = {},
): ExecutablePathsSaveResult {
    let next: string[] | null = null;
    if (raw !== null) {
        const { paths, errors } = validateExecutableSearchPaths(raw, options.platform ?? process.platform);
        if (errors.length > 0) {
            return { ok: false, reason: 'invalid', errors, message: 'Fix the highlighted paths and save again. The saved paths are unchanged.' };
        }
        next = paths;
    }
    try {
        writeExecutableSearchPaths(dataDir, next);
    } catch {
        return { ok: false, reason: 'storage-failed', message: 'Could not save executable search paths.' };
    }
    return { ok: true, state: getExecutablePathsState(dataDir, server, options) };
}
