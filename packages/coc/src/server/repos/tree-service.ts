import * as fs from 'fs';
import * as path from 'path';
import * as childProcess from 'child_process';
import { execFile } from 'child_process';
import { promisify } from 'util';
import type { WorkspaceInfo, ProcessStore } from '@plusplusoneplusplus/forge';
import { loadNativeContentSearch, loadNativeFileIndex } from '@plusplusoneplusplus/coc-native';
import type { NativeContentSearchAddon, NativeFileIndex, NativeFileIndexAddon } from '@plusplusoneplusplus/coc-native';

const execFileAsync = promisify(execFile);
import type {
    RepoInfo,
    TreeEntry,
    TreeListResult,
    FileSearchResult,
    SearchFilesResult,
    ContentSearchOptions,
    ContentSearchResult,
} from './types';
import { CONTENT_SEARCH_MAX_RESULTS } from './types';
import { applyReplacements, buildReplaceMatcher } from './content-replace';
import type {
    ContentReplaceFile,
    ContentReplaceOptions,
    ContentReplaceResult,
    ContentReplaceSkip,
} from './content-replace';

export interface RepoTreeServiceOptions {
    /**
     * Maximum entries returned per directory listing.
     * Listings exceeding this are truncated and `truncated: true` is set.
     * Default: 5000.
     */
    maxEntries?: number;

    /**
     * Maximum entries returned by a whole-repo file listing (`listFilesRecursive`).
     * Defaults to `maxEntries` when that is set explicitly, otherwise 50000 —
     * a per-directory cap of 5000 is generous, but the same cap applied to a
     * whole repo hides most files in any large repo from file search.
     */
    fileListMaxEntries?: number;

    /**
     * How long a cached whole-repo file list is served before it is refreshed.
     * Stale entries are still returned immediately while the refresh runs in the
     * background. Default: 10000 ms.
     */
    fileListCacheTtlMs?: number;

    /**
     * The native file-index addon.
     *
     * Defaults to `loadNativeFileIndex()`, which throws when no binary could be
     * loaded — the addon is required, with no JavaScript path behind it. Tests
     * inject a stub here; there is no way to ask for a non-native listing.
     */
    nativeFileIndex?: NativeFileIndexAddon;

    /**
     * The native content-search addon.
     *
     * Resolved lazily on the first content search rather than in the
     * constructor: every other route works without it, and eagerly loading
     * would make an unrelated test that injects a stub file index need a real
     * binary too. Tests inject a stub here.
     */
    nativeContentSearch?: NativeContentSearchAddon;
}

/** A native index kept warm for one repo + showIgnored combination. */
interface NativeIndexEntry {
    /** Resolves once the initial parallel walk finishes. */
    index: Promise<NativeFileIndex>;
    /** Epoch ms of the last completed build or refresh. */
    at: number;
    /** In-flight background refresh, so only one runs per entry. */
    refreshing?: Promise<void>;
}

/** Extension → MIME type map for common file types. */
const MIME_MAP: Record<string, string> = {
    '.js': 'application/javascript',
    '.mjs': 'application/javascript',
    '.cjs': 'application/javascript',
    '.ts': 'application/typescript',
    '.tsx': 'application/typescript',
    '.jsx': 'application/javascript',
    '.json': 'application/json',
    '.html': 'text/html',
    '.htm': 'text/html',
    '.css': 'text/css',
    '.md': 'text/markdown',
    '.markdown': 'text/markdown',
    '.txt': 'text/plain',
    '.xml': 'application/xml',
    '.yaml': 'application/x-yaml',
    '.yml': 'application/x-yaml',
    '.toml': 'application/toml',
    '.sh': 'application/x-sh',
    '.bash': 'application/x-sh',
    '.py': 'text/x-python',
    '.rb': 'text/x-ruby',
    '.go': 'text/x-go',
    '.rs': 'text/x-rust',
    '.java': 'text/x-java',
    '.c': 'text/x-c',
    '.cpp': 'text/x-c++',
    '.h': 'text/x-c',
    '.hpp': 'text/x-c++',
    '.cs': 'text/x-csharp',
    '.swift': 'text/x-swift',
    '.kt': 'text/x-kotlin',
    '.scala': 'text/x-scala',
    '.php': 'text/x-php',
    '.sql': 'application/sql',
    '.graphql': 'application/graphql',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.ico': 'image/x-icon',
    '.pdf': 'application/pdf',
    '.zip': 'application/zip',
    '.gz': 'application/gzip',
    '.tar': 'application/x-tar',
    '.wasm': 'application/wasm',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.ttf': 'font/ttf',
    '.eot': 'application/vnd.ms-fontobject',
    '.env': 'text/plain',
    '.log': 'text/plain',
    '.csv': 'text/csv',
    '.lock': 'text/plain',
};

/** Maximum file size for readBlob (1 MB). */
const MAX_BLOB_SIZE = 1 * 1024 * 1024;

/** Number of bytes to scan for binary detection. */
const BINARY_PROBE_SIZE = 8192;

function getMimeType(filePath: string): string {
    const ext = path.extname(filePath).toLowerCase();
    return MIME_MAP[ext] ?? 'application/octet-stream';
}

/**
 * Returns true if the buffer likely represents binary content
 * (contains null bytes in the first 8 KB).
 */
function isBinary(buffer: Buffer): boolean {
    const limit = Math.min(buffer.length, BINARY_PROBE_SIZE);
    for (let i = 0; i < limit; i++) {
        if (buffer[i] === 0) return true;
    }
    return false;
}

/**
 * Strips leading path separators so that absolute-looking relative paths
 * (e.g. "/" or "/src") are treated as repo-relative instead of filesystem root.
 */
function stripLeadingSeparators(p: string): string {
    return p.replace(/^[/\\]+/, '') || '.';
}

/**
 * Validates that resolvedPath is inside repoRoot (path traversal guard).
 * Throws if the path escapes the repo root.
 */
function assertInsideRepo(repoRoot: string, resolvedPath: string): void {
    const normalizedRoot = path.resolve(repoRoot);
    const normalizedTarget = path.resolve(resolvedPath);
    if (normalizedTarget !== normalizedRoot && !normalizedTarget.startsWith(normalizedRoot + path.sep)) {
        throw new Error(`Path traversal detected: path escapes repo root`);
    }
}

/**
 * Spawns `git check-ignore --stdin` asynchronously and returns stdout.
 * Resolves to empty string on error or timeout.
 */
function spawnGitCheckIgnore(repoRoot: string, input: string): Promise<string> {
    return new Promise<string>((resolve) => {
        let stdout = '';
        let settled = false;
        const settle = () => {
            if (!settled) {
                settled = true;
                clearTimeout(timer);
                resolve(stdout);
            }
        };
        const child = childProcess.spawn('git', ['check-ignore', '--stdin'], {
            cwd: repoRoot,
            stdio: ['pipe', 'pipe', 'pipe'],
        });
        child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString('utf-8'); });
        child.stdin.on('error', () => {}); // ignore broken pipe errors
        child.stdin.write(input, 'utf-8');
        child.stdin.end();
        const timer = setTimeout(() => { try { child.kill(); } catch {} settle(); }, 5000);
        child.on('close', settle);
        child.on('error', settle);
    });
}

/**
 * Runs `git check-ignore --stdin` asynchronously to determine which entries are gitignored.
 * Accepts entries as { name, isDir } pairs relative to `dirPath`.
 * Returns a Set of entry names that are ignored.
 * Falls back to an empty set if git is unavailable or the directory is not a git repo.
 */
async function getGitIgnoredNames(
    repoRoot: string,
    dirPath: string,
    entries: Array<{ name: string; isDir: boolean }>,
): Promise<Set<string>> {
    if (entries.length === 0) return new Set();
    try {
        // Build relative paths from repoRoot, using forward slashes.
        // Directories get a trailing '/' so that gitignore patterns like "dist/" match.
        const relDir = path.relative(repoRoot, dirPath).split(path.sep).join('/');
        const lines: string[] = [];
        const nameByLine: string[] = [];
        for (const entry of entries) {
            const rel = relDir ? `${relDir}/${entry.name}` : entry.name;
            lines.push(entry.isDir ? `${rel}/` : rel);
            nameByLine.push(entry.name);
        }
        const input = lines.join('\n') + '\n';
        const stdout = await spawnGitCheckIgnore(repoRoot, input);
        // Parse output — each ignored line corresponds to the input path.
        // git outputs the matched paths (with possible trailing '/').
        const ignoredPaths = new Set<string>();
        for (const line of stdout.split('\n')) {
            const trimmed = line.trim();
            if (trimmed) ignoredPaths.add(trimmed.replace(/\/$/, ''));
        }
        // Map back to entry names
        const ignoredNames = new Set<string>();
        for (let i = 0; i < lines.length; i++) {
            const cleanLine = lines[i].replace(/\/$/, '');
            if (ignoredPaths.has(cleanLine)) {
                ignoredNames.add(nameByLine[i]);
            }
        }
        return ignoredNames;
    } catch {
        // git not available, not a git repo, or empty input — treat nothing as ignored
        return new Set();
    }
}

export class RepoTreeService {
    private readonly maxEntries: number;
    private readonly fileListMaxEntries: number;
    private readonly fileListCacheTtlMs: number;
    private readonly dataDir: string;
    private readonly store?: ProcessStore;

    /** The native addon backing every whole-repo listing and file search. */
    private readonly native: NativeFileIndexAddon;
    /** Live native indexes, keyed by repoId + showIgnored. */
    private readonly nativeIndexes = new Map<string, NativeIndexEntry>();
    /**
     * The native addon backing content search, resolved on first use.
     *
     * Unlike the file index there is nothing to keep warm — every query is a
     * fresh walk — so this holds the addon itself, not per-repo state.
     */
    private nativeContent?: NativeContentSearchAddon;

    private static rgAvailable: boolean | undefined;

    private static async checkRipgrepAvailable(): Promise<boolean> {
        if (RepoTreeService.rgAvailable !== undefined) return RepoTreeService.rgAvailable;
        try {
            await execFileAsync('rg', ['--version']);
            RepoTreeService.rgAvailable = true;
        } catch {
            RepoTreeService.rgAvailable = false;
        }
        return RepoTreeService.rgAvailable;
    }

    /**
     * Uses `rg --files --hidden --max-depth 1` to determine which file entries are gitignored.
     * rg natively respects .gitignore, so files absent from its output are ignored.
     * Directories are not handled here (rg --files never lists them).
     * Returns null if rg is unavailable or encounters an error (caller should fall back).
     */
    private static async getIgnoredNamesViaRipgrep(
        absPath: string,
        entries: Array<{ name: string; isDir: boolean }>,
    ): Promise<Set<string> | null> {
        const available = await RepoTreeService.checkRipgrepAvailable();
        if (!available) return null;
        try {
            const result = await execFileAsync('rg', ['--files', '--hidden', '--max-depth', '1', '--', absPath], {
                encoding: 'utf-8',
                maxBuffer: 50 * 1024 * 1024,
            });
            const listedFiles = new Set(
                result.stdout.split('\n')
                    .map((l: string) => path.basename(l.trim()))
                    .filter(Boolean),
            );
            // Anything not listed by rg is a gitignored file
            const ignoredNames = new Set<string>();
            for (const entry of entries) {
                if (!entry.isDir && !listedFiles.has(entry.name)) {
                    ignoredNames.add(entry.name);
                }
            }
            return ignoredNames;
        } catch (err: any) {
            if (err.code === 1) return new Set(); // no files found — nothing ignored
            return null; // rg error → fall back
        }
    }

    /**
     * Returns the set of entry names that should be hidden from directory listings.
     * Primary path: rg for files (non-blocking) + async git check-ignore for dirs.
     * Fallback: async git check-ignore for all entries when rg is unavailable.
     */
    private static async getIgnoredNames(
        repoRoot: string,
        absPath: string,
        entries: Array<{ name: string; isDir: boolean }>,
    ): Promise<Set<string>> {
        if (entries.length === 0) return new Set();
        const dirEntries = entries.filter(e => e.isDir);

        const rgResult = await RepoTreeService.getIgnoredNamesViaRipgrep(absPath, entries);
        if (rgResult === null) {
            // rg unavailable — fall back to async git check-ignore for everything
            return getGitIgnoredNames(repoRoot, absPath, entries);
        }
        // rg available — handle dirs via async git check-ignore, files already covered by rg
        const dirIgnored = dirEntries.length > 0
            ? await getGitIgnoredNames(repoRoot, absPath, dirEntries)
            : new Set<string>();
        return new Set([...rgResult, ...dirIgnored]);
    }

    constructor(dataDir: string, options?: RepoTreeServiceOptions, store?: ProcessStore) {
        this.dataDir = dataDir;
        this.maxEntries = options?.maxEntries ?? 5000;
        this.fileListMaxEntries = options?.fileListMaxEntries ?? options?.maxEntries ?? 50000;
        this.fileListCacheTtlMs = options?.fileListCacheTtlMs ?? 10000;
        this.store = store;
        this.native = options?.nativeFileIndex ?? loadNativeFileIndex();
        this.nativeContent = options?.nativeContentSearch;
    }

    /**
     * The native index for a repo + showIgnored combination, built on first use
     * and kept warm afterwards.
     *
     * The index itself is never capped: the path list stays in this process, so
     * `fileListMaxEntries` only bounds what the `/files` response carries, not
     * what search can find.
     */
    private nativeIndexFor(key: string, repoRoot: string, showIgnored: boolean): NativeIndexEntry {
        const existing = this.nativeIndexes.get(key);
        if (existing) {
            this.maybeRefreshNativeIndex(existing);
            return existing;
        }

        const entry: NativeIndexEntry = {
            at: Date.now(),
            index: this.native.buildFileIndex(repoRoot, { includeIgnored: showIgnored }),
        };
        entry.index.then(
            () => {
                entry.at = Date.now();
            },
            () => {
                // A failed walk must not be cached, or the repo stays broken
                // until the process restarts.
                if (this.nativeIndexes.get(key) === entry) this.nativeIndexes.delete(key);
            },
        );
        this.nativeIndexes.set(key, entry);
        return entry;
    }

    /**
     * Re-walk in the background once the entry is older than the TTL. Callers
     * keep reading the current snapshot meanwhile — files appear from agents,
     * git and installs without going through {@link writeBlob}, so an index
     * cannot be trusted forever.
     */
    private maybeRefreshNativeIndex(entry: NativeIndexEntry): void {
        if (entry.refreshing) return;
        if (Date.now() - entry.at < this.fileListCacheTtlMs) return;
        void this.refreshNativeIndex(entry);
    }

    /**
     * Re-walk this entry, queueing behind any refresh already in flight.
     *
     * Queueing rather than skipping matters for {@link writeBlob}: a caller that
     * awaits this has to get a walk that started *after* its write, not one that
     * was already running and cannot have seen it.
     */
    private refreshNativeIndex(entry: NativeIndexEntry): Promise<void> {
        const next = (entry.refreshing ?? Promise.resolve())
            .then(() => entry.index)
            .then(index => index.refresh())
            .then(() => {
                entry.at = Date.now();
            })
            .catch(() => {
                // Keep serving the previous snapshot; the next call retries.
            });
        entry.refreshing = next;
        void next.then(() => {
            if (entry.refreshing === next) entry.refreshing = undefined;
        });
        return next;
    }

    /** Native index entries for a repo, or for every repo when none is given. */
    private nativeEntriesFor(repoId?: string): NativeIndexEntry[] {
        if (repoId === undefined) return [...this.nativeIndexes.values()];
        const entries: NativeIndexEntry[] = [];
        for (const showIgnored of [true, false]) {
            const entry = this.nativeIndexes.get(RepoTreeService.fileListKey(repoId, showIgnored));
            if (entry) entries.push(entry);
        }
        return entries;
    }

    /** Cache key for a whole-repo file listing. */
    private static fileListKey(repoId: string, showIgnored: boolean): string {
        return `${repoId} ${showIgnored ? 1 : 0}`;
    }

    /**
     * Drop cached whole-repo file listings.
     * Called after writes; pass a repoId to scope the invalidation to one repo.
     *
     * A native index is refreshed rather than dropped: re-walking in parallel is
     * cheap, and discarding it would make the next keystroke pay for a full
     * rebuild.
     */
    invalidateFileListCache(repoId?: string): void {
        void this.invalidateFileListCacheAndWait(repoId);
    }

    /**
     * {@link invalidateFileListCache}, but resolving only once native indexes
     * have finished re-walking — so a caller that just wrote a file can promise
     * the file is searchable by the time it returns.
     */
    private invalidateFileListCacheAndWait(repoId?: string): Promise<void> {
        const refreshes = this.nativeEntriesFor(repoId).map(entry => this.refreshNativeIndex(entry));
        return Promise.all(refreshes).then(() => undefined);
    }

    /**
     * List all registered repos from workspaces.json.
     * @returns Array of RepoInfo with headSha resolved from git.
     */
    async listRepos(): Promise<RepoInfo[]> {
        const workspaces = await this.readWorkspaces();
        return Promise.all(workspaces.map(ws => RepoTreeService.toRepoInfo(ws)));
    }

    /**
     * Resolve a repo by ID. Returns undefined if not found.
     *
     * Populates git metadata (headSha, remoteUrl) via subprocesses. Callers that
     * only need the on-disk location must use {@link resolveRepoRoot} instead.
     */
    async resolveRepo(repoId: string): Promise<RepoInfo | undefined> {
        const workspaces = await this.readWorkspaces();
        const ws = workspaces.find(w => w.id === repoId);
        return ws ? RepoTreeService.toRepoInfo(ws) : undefined;
    }

    /**
     * Resolve just the on-disk root path for a repo, without spawning git.
     *
     * `resolveRepo` runs `git rev-parse` and `git remote get-url` to build a full
     * RepoInfo; file-tree operations need none of that, so they use this instead.
     * Returns undefined if the repo is not registered.
     */
    async resolveRepoRoot(repoId: string): Promise<string | undefined> {
        const workspaces = await this.readWorkspaces();
        return workspaces.find(w => w.id === repoId)?.rootPath;
    }

    /**
     * List the contents of `relativePath` inside the repo identified by `repoId`.
     *
     * @param repoId       Stable workspace ID.
     * @param relativePath Path relative to repo root ('.' or '' = root).
     * @param options      Optional listing options.
     * @returns TreeListResult with entries (dirs-first, alpha-sorted), or throws if
     *          path is outside repo root (traversal guard) or does not exist.
     */
    async listDirectory(
        repoId: string,
        relativePath: string,
        options?: { showIgnored?: boolean },
    ): Promise<TreeListResult> {
        const repoRoot = await this.resolveRepoRoot(repoId);
        if (!repoRoot) {
            throw new Error(`Repo not found: ${repoId}`);
        }

        const normalizedRel = stripLeadingSeparators(relativePath === '' || relativePath === '.' ? '.' : relativePath);
        const absPath = path.resolve(repoRoot, normalizedRel);
        assertInsideRepo(repoRoot, absPath);

        let stat: fs.Stats;
        try {
            stat = await fs.promises.stat(absPath);
        } catch {
            throw new Error(`Path does not exist: ${relativePath}`);
        }
        if (!stat.isDirectory()) {
            throw new Error(`Not a directory: ${relativePath}`);
        }

        const dirents = await fs.promises.readdir(absPath, { withFileTypes: true });

        // Resolve symlinks and filter out broken ones
        const resolvedEntries: { dirent: fs.Dirent; isDir: boolean }[] = [];
        for (const dirent of dirents) {
            const fullPath = path.join(absPath, dirent.name);
            if (dirent.isSymbolicLink()) {
                try {
                    const targetStat = await fs.promises.stat(fullPath);
                    resolvedEntries.push({ dirent, isDir: targetStat.isDirectory() });
                } catch {
                    // Broken symlink — skip
                    continue;
                }
            } else {
                resolvedEntries.push({ dirent, isDir: dirent.isDirectory() });
            }
        }

        // Gitignore filtering
        const showIgnored = options?.showIgnored ?? false;
        let filteredEntries = resolvedEntries;
        if (!showIgnored) {
            const entryInfos = resolvedEntries.map(e => ({ name: e.dirent.name, isDir: e.isDir }));
            const ignoredNames = await RepoTreeService.getIgnoredNames(repoRoot, absPath, entryInfos);
            if (ignoredNames.size > 0) {
                filteredEntries = resolvedEntries.filter(e => !ignoredNames.has(e.dirent.name));
            }
        }

        // Sort: dirs first, then alphabetical
        filteredEntries.sort((a, b) => {
            if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
            return a.dirent.name.localeCompare(b.dirent.name);
        });

        // Size guard
        const truncated = filteredEntries.length > this.maxEntries;
        const sliced = truncated ? filteredEntries.slice(0, this.maxEntries) : filteredEntries;

        const entries: TreeEntry[] = [];
        for (const { dirent, isDir } of sliced) {
            const fullPath = path.join(absPath, dirent.name);
            const relPath = path.relative(repoRoot, fullPath).split(path.sep).join('/');
            let size: number | undefined;
            if (!isDir) {
                try {
                    const fileStat = await fs.promises.stat(fullPath);
                    size = fileStat.size;
                } catch {
                    // Broken symlink or permission error — size stays undefined
                }
            }
            entries.push({
                name: dirent.name,
                type: isDir ? 'dir' : 'file',
                size,
                path: relPath,
            });
        }

        return { entries, truncated };
    }

    /**
     * List the contents of `relativePath` to the given depth.
     * depth=1 returns the same flat TreeListResult as listDirectory().
     * depth>1 populates `children` on directory entries recursively.
     * Truncated directories are not recursed into.
     */
    async listDirectoryDeep(
        repoId: string,
        relativePath: string,
        depth: number,
        options?: { showIgnored?: boolean },
    ): Promise<TreeListResult> {
        const result = await this.listDirectory(repoId, relativePath, options);
        if (depth <= 1) {
            return result;
        }
        for (const entry of result.entries) {
            if (entry.type === 'dir' && !result.truncated) {
                const child = await this.listDirectoryDeep(repoId, entry.path, depth - 1, options);
                entry.children = child.entries;
            }
        }
        return result;
    }

    /**
     * Recursively list all files under `relativePath` inside the repo.
     * Returns a flat array of relative paths (files only, no directories).
     * Respects gitignore unless `showIgnored` is set. Capped by `maxEntries`.
     */
    async listFilesRecursive(
        repoId: string,
        relativePath: string,
        options?: { showIgnored?: boolean },
    ): Promise<{ files: string[]; truncated: boolean }> {
        const repoRoot = await this.resolveRepoRoot(repoId);
        if (!repoRoot) {
            throw new Error(`Repo not found: ${repoId}`);
        }

        const normalizedRel = stripLeadingSeparators(relativePath === '' || relativePath === '.' ? '.' : relativePath);
        const absRoot = path.resolve(repoRoot, normalizedRel);
        assertInsideRepo(repoRoot, absRoot);

        const showIgnored = options?.showIgnored ?? false;

        // Whole-repo listing: served from cache, stale-while-revalidate.
        // This is the hot path behind file search, where the same listing was
        // otherwise recomputed (a full ripgrep walk) on every keystroke.
        if (normalizedRel === '.' || normalizedRel === '') {
            const key = RepoTreeService.fileListKey(repoId, showIgnored);

            const index = await this.nativeIndexFor(key, repoRoot, showIgnored).index;
            // The cap applies to the response payload only — the index keeps
            // every path so search still reaches them.
            return {
                files: index.files(0, this.fileListMaxEntries),
                truncated: index.len() > this.fileListMaxEntries,
            };
        }

        return this.walkFiles(repoRoot, absRoot, showIgnored, this.maxEntries);
    }

    /**
     * Depth-first walk collecting file paths relative to `repoRoot`.
     * Respects gitignore unless `showIgnored`. Stops at `maxEntries`.
     */
    private async walkFiles(
        repoRoot: string,
        absRoot: string,
        showIgnored: boolean,
        maxEntries: number,
    ): Promise<{ files: string[]; truncated: boolean }> {
        const files: string[] = [];

        const walk = async (dir: string): Promise<void> => {
            if (files.length >= maxEntries) return;

            let dirents: fs.Dirent[];
            try {
                dirents = await fs.promises.readdir(dir, { withFileTypes: true });
            } catch {
                return;
            }

            // Resolve symlinks and filter broken ones
            const resolved: { name: string; isDir: boolean }[] = [];
            for (const dirent of dirents) {
                const fullPath = path.join(dir, dirent.name);
                if (dirent.isSymbolicLink()) {
                    try {
                        const targetStat = await fs.promises.stat(fullPath);
                        resolved.push({ name: dirent.name, isDir: targetStat.isDirectory() });
                    } catch {
                        continue;
                    }
                } else {
                    resolved.push({ name: dirent.name, isDir: dirent.isDirectory() });
                }
            }

            // `.git` is never a useful file-index entry, and its object database
            // would crowd out real source files against maxEntries. Excluded
            // unconditionally here, in the native walker, and in the rg path.
            let filtered = resolved.filter(e => !(e.isDir && e.name === '.git'));

            // Gitignore filtering
            if (!showIgnored) {
                const entryInfos = filtered.map(e => ({ name: e.name, isDir: e.isDir }));
                const ignoredNames = await RepoTreeService.getIgnoredNames(repoRoot, dir, entryInfos);
                if (ignoredNames.size > 0) {
                    filtered = filtered.filter(e => !ignoredNames.has(e.name));
                }
            }

            // Sort alphabetically for deterministic output
            filtered.sort((a, b) => a.name.localeCompare(b.name));

            for (const entry of filtered) {
                if (files.length >= maxEntries) return;
                const fullPath = path.join(dir, entry.name);
                if (entry.isDir) {
                    await walk(fullPath);
                } else {
                    const relPath = path.relative(repoRoot, fullPath).split(path.sep).join('/');
                    files.push(relPath);
                }
            }
        };

        await walk(absRoot);
        const truncated = files.length >= maxEntries;
        return { files: truncated ? files.slice(0, maxEntries) : files, truncated };
    }

    /**
     * Read file content.
     * @returns content (text or base64), encoding, and mimeType.
     * @throws if file not found, path traversal detected, or file exceeds 1 MB.
     */
    async readBlob(
        repoId: string,
        relativePath: string,
    ): Promise<{ content: string; encoding: 'utf-8' | 'base64'; mimeType: string }> {
        const repoRoot = await this.resolveRepoRoot(repoId);
        if (!repoRoot) {
            throw new Error(`Repo not found: ${repoId}`);
        }

        const absPath = path.resolve(repoRoot, stripLeadingSeparators(relativePath));
        assertInsideRepo(repoRoot, absPath);

        let stat: fs.Stats;
        try {
            stat = await fs.promises.stat(absPath);
        } catch {
            throw new Error(`File not found: ${relativePath}`);
        }

        if (!stat.isFile()) {
            throw new Error(`Not a file: ${relativePath}`);
        }

        if (stat.size > MAX_BLOB_SIZE) {
            throw new Error(`File exceeds maximum size of ${MAX_BLOB_SIZE} bytes: ${relativePath}`);
        }

        const buffer = await fs.promises.readFile(absPath);
        const mimeType = getMimeType(absPath);

        if (isBinary(buffer)) {
            return {
                content: buffer.toString('base64'),
                encoding: 'base64',
                mimeType,
            };
        }

        return {
            content: buffer.toString('utf-8'),
            encoding: 'utf-8',
            mimeType,
        };
    }

    /**
     * Write text content to a file inside a repo.
     * @throws if repo not found, path traversal detected, or path is a directory.
     */
    async writeBlob(repoId: string, relativePath: string, content: string): Promise<void> {
        const repoRoot = await this.resolveRepoRoot(repoId);
        if (!repoRoot) {
            throw new Error(`Repo not found: ${repoId}`);
        }

        const absPath = path.resolve(repoRoot, stripLeadingSeparators(relativePath));
        assertInsideRepo(repoRoot, absPath);

        // Ensure parent directory exists
        const parentDir = path.dirname(absPath);
        await fs.promises.mkdir(parentDir, { recursive: true });

        await fs.promises.writeFile(absPath, content, 'utf-8');

        // A write may have created a file that is not in the cached listing.
        await this.invalidateFileListCacheAndWait(repoId);
    }

    /**
     * Fuzzy-search all files under the repo root.
     * Returns results sorted by score descending, limited to `options.limit`.
     *
     * @param repoId   Stable workspace ID.
     * @param query    Search query (min 1 character).
     * @param options  Optional: limit (default 50, max 200), showIgnored (default false).
     */
    async searchFiles(
        repoId: string,
        query: string,
        options?: { limit?: number; showIgnored?: boolean },
    ): Promise<SearchFilesResult> {
        const rawLimit = options?.limit ?? 50;
        const limit = Math.min(Math.max(rawLimit, 1), 200);
        const showIgnored = options?.showIgnored ?? false;

        const repoRoot = await this.resolveRepoRoot(repoId);
        if (!repoRoot) {
            throw new Error(`Repo not found: ${repoId}`);
        }
        const key = RepoTreeService.fileListKey(repoId, showIgnored);
        const index = await this.nativeIndexFor(key, repoRoot, showIgnored).index;
        const results: FileSearchResult[] = await index.search(query, limit);
        // Nothing was dropped on the way in, so no result is missing.
        return { results, truncated: false };
    }

    /**
     * Search the contents of every non-ignored file under the repo root.
     *
     * Every query is a fresh parallel walk — there is no content index to keep
     * warm and no cancellation, so the caps in `options` are the only bound on
     * what one query costs.
     *
     * Rejects with a `Repo not found` error for an unregistered repo or a root
     * that has since disappeared from disk, and passes the addon's own
     * `InvalidArg` errors (bad regex, escaping path) through untouched so the
     * route can turn them into 400s.
     *
     * @param repoId  Stable workspace ID.
     * @param query   Literal text, or a regular expression when `options.regex`.
     * @param options Query modes, subfolder scoping and the result cap.
     */
    async searchContent(
        repoId: string,
        query: string,
        options?: ContentSearchOptions,
    ): Promise<ContentSearchResult> {
        const repoRoot = await this.resolveRepoRoot(repoId);
        if (!repoRoot) {
            throw new Error(`Repo not found: ${repoId}`);
        }
        // A registered workspace whose folder was deleted is a missing repo,
        // not a search failure — without this the walk just returns nothing.
        try {
            if (!(await fs.promises.stat(repoRoot)).isDirectory()) {
                throw new Error('not a directory');
            }
        } catch {
            throw new Error(`Repo not found on disk: ${repoRoot}`);
        }

        const rawLimit = options?.limit ?? CONTENT_SEARCH_MAX_RESULTS;
        const limit = Math.min(Math.max(rawLimit, 1), CONTENT_SEARCH_MAX_RESULTS);

        // '.' is how every other repo route spells "the root", but handing it
        // to the addon as a subfolder would prefix every result path with './'.
        const scope = stripLeadingSeparators(options?.path ?? '').replace(/^\.(?:\/|$)/, '');

        this.nativeContent ??= loadNativeContentSearch();
        return this.nativeContent.searchContent(repoRoot, query, {
            path: scope || undefined,
            caseSensitive: options?.caseSensitive ?? false,
            wholeWord: options?.wholeWord ?? false,
            regex: options?.regex ?? false,
            showIgnored: options?.showIgnored ?? false,
            include: options?.include,
            exclude: options?.exclude,
            maxResults: limit,
        });
    }

    /**
     * Rewrite the matched spans a content search returned.
     *
     * Writes only what the caller lists — this never re-searches the repo, so
     * nothing outside the result set the user is looking at can be touched. A
     * file whose lines no longer read the way they did when the search ran is
     * skipped whole and reported, never half-written.
     *
     * Rejects with a `Repo not found` error for an unregistered repo, and
     * throws `InvalidArg`-coded errors for a bad query so the route can turn
     * them into 400s.
     *
     * @param repoId      Stable workspace ID.
     * @param query       The query the search ran with.
     * @param replacement Replacement text; `$1` backrefs apply under `regex`.
     * @param files       The matched spans, grouped by repo-relative path.
     * @param options     The same query modes the search used, plus preserveCase.
     */
    async replaceContent(
        repoId: string,
        query: string,
        replacement: string,
        files: readonly ContentReplaceFile[],
        options?: ContentReplaceOptions,
    ): Promise<ContentReplaceResult> {
        const repoRoot = await this.resolveRepoRoot(repoId);
        if (!repoRoot) {
            throw new Error(`Repo not found: ${repoId}`);
        }

        // Built once, and before any file is touched: a bad regex must fail the
        // whole request rather than write the files it happened to reach first.
        const matcher = buildReplaceMatcher(query, options);

        const skipped: ContentReplaceSkip[] = [];
        let replacedMatches = 0;
        let replacedFiles = 0;

        for (const file of files) {
            const absPath = path.resolve(repoRoot, stripLeadingSeparators(file.path));
            assertInsideRepo(repoRoot, absPath);

            let buffer: Buffer;
            try {
                const stat = await fs.promises.stat(absPath);
                if (!stat.isFile()) {
                    skipped.push({ path: file.path, reason: 'unreadable', message: 'Not a file' });
                    continue;
                }
                if (stat.size > MAX_BLOB_SIZE) {
                    skipped.push({ path: file.path, reason: 'unreadable', message: 'File is too large to replace in' });
                    continue;
                }
                buffer = await fs.promises.readFile(absPath);
            } catch {
                skipped.push({ path: file.path, reason: 'missing', message: 'File no longer exists' });
                continue;
            }

            if (isBinary(buffer)) {
                skipped.push({ path: file.path, reason: 'unreadable', message: 'File is binary' });
                continue;
            }

            const outcome = applyReplacements(buffer.toString('utf-8'), file.targets, matcher, replacement, options);
            if (!outcome.ok) {
                skipped.push({ path: file.path, reason: outcome.reason, message: outcome.message });
                continue;
            }
            if (outcome.replaced === 0) continue;

            await fs.promises.writeFile(absPath, outcome.content, 'utf-8');
            replacedMatches += outcome.replaced;
            replacedFiles++;
        }

        return { replacedMatches, replacedFiles, skipped };
    }

    /**
     * Build a RepoInfo from a WorkspaceInfo.
     * Pure mapping + git HEAD resolution.
     */
    static async toRepoInfo(workspace: WorkspaceInfo): Promise<RepoInfo> {
        let headSha = '';
        try {
            const { stdout } = await execFileAsync('git', ['rev-parse', '--short', 'HEAD'], {
                cwd: workspace.rootPath,
                encoding: 'utf-8',
                timeout: 5000,
            });
            headSha = stdout.trim();
        } catch {
            // Not a git repo or git not available
        }

        let remoteUrl: string | undefined;
        try {
            const { stdout } = await execFileAsync('git', ['remote', 'get-url', 'origin'], {
                cwd: workspace.rootPath,
                encoding: 'utf-8',
                timeout: 5000,
            });
            const url = stdout.trim();
            if (url) remoteUrl = url;
        } catch {
            // No origin remote or not a git repo
        }

        return {
            id: workspace.id,
            name: workspace.name,
            localPath: workspace.rootPath,
            headSha,
            clonedAt: new Date().toISOString(),
            ...(remoteUrl ? { remoteUrl } : {}),
            ...(workspace.remoteUrl ? { remoteUrl: workspace.remoteUrl } : {}),
        };
    }

    private async readWorkspaces(): Promise<WorkspaceInfo[]> {
        if (this.store) {
            return this.store.getWorkspaces();
        }
        const workspacesPath = path.join(this.dataDir, 'workspaces.json');
        try {
            const data = await fs.promises.readFile(workspacesPath, 'utf-8');
            return JSON.parse(data) as WorkspaceInfo[];
        } catch {
            return [];
        }
    }
}
