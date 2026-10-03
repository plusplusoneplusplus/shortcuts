import * as fs from 'fs';
import * as path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import type { WorkspaceInfo, ProcessStore } from '@plusplusoneplusplus/forge';
import { execGitAsync, resolveWorkspaceExecutionContext } from '@plusplusoneplusplus/forge';
import { loadNativeRepoFiles } from '@plusplusoneplusplus/coc-native';
import type {
    NativeRepoBlob,
    NativeRepoFiles,
    NativeRepoFilesAddon,
    NativeRepoReplaceFile,
    NativeRepoReplaceOptions,
    NativeRepoReplaceResult,
    NativeRankedFileMatch,
} from '@plusplusoneplusplus/coc-native';

const execFileAsync = promisify(execFile);
import type {
    RepoInfo,
    TreeListResult,
    FileSearchResult,
    SearchFilesResult,
    ContentSearchOptions,
    ContentSearchResult,
} from './types';
import { CONTENT_SEARCH_MAX_RESULTS } from './types';

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
     * How long a whole-repo file index is served before the native handle
     * re-walks it in the background (stale-while-revalidate). Default: 10000 ms.
     */
    fileListCacheTtlMs?: number;

    /** The native repository-file backend, resolved on first use. Tests inject a stub here. */
    nativeRepoFiles?: NativeRepoFilesAddon;
}

/**
 * Strips leading path separators so that absolute-looking relative paths
 * (e.g. "/" or "/src") are treated as repo-relative instead of filesystem root.
 */
function stripLeadingSeparators(p: string): string {
    return p.replace(/^[/\\]+/, '') || '.';
}

/** File-search result limit: 50 by default, clamped to 1..200. */
function clampLimit(limit = 50): number {
    return Math.min(Math.max(limit, 1), 200);
}

/** Trimmed stdout of a short git command, or '' when it fails (not a repo, no remote, no git). */
async function gitOutput(cwd: string, args: string[]): Promise<string> {
    try {
        const { stdout } = await execFileAsync('git', args, { cwd, encoding: 'utf-8', timeout: 5000 });
        return stdout.trim();
    } catch {
        return '';
    }
}

export class TrackedContentSearchUnavailableError extends Error {
    readonly code = 'TRACKED_CONTENT_SEARCH_UNAVAILABLE';
}

export class RepoTreeService {
    private readonly maxEntries: number;
    private readonly fileListMaxEntries: number;
    private readonly fileListCacheTtlMs: number;
    private readonly dataDir: string;
    private readonly store?: ProcessStore;

    private nativeRepoFiles?: NativeRepoFilesAddon;
    /**
     * One native handle per workspace, for the root it was opened on. The
     * handle owns that root's file indexes and their refresh policy; this map
     * only decides when a handle is obsolete.
     */
    private readonly handles = new Map<string, { root: string; files: NativeRepoFiles }>();

    constructor(dataDir: string, options?: RepoTreeServiceOptions, store?: ProcessStore) {
        this.dataDir = dataDir;
        this.maxEntries = options?.maxEntries ?? 5000;
        this.fileListMaxEntries = options?.fileListMaxEntries ?? options?.maxEntries ?? 50000;
        this.fileListCacheTtlMs = options?.fileListCacheTtlMs ?? 10000;
        this.store = store;
        this.nativeRepoFiles = options?.nativeRepoFiles;
    }

    /**
     * Re-walk a repo's file indexes (every repo when none is given) after an
     * outside change, e.g. a git operation that added or deleted files.
     */
    invalidateFileListCache(repoId?: string): void {
        for (const [id, handle] of this.handles) {
            if (repoId === undefined || id === repoId) void handle.files.invalidate().catch(() => {});
        }
    }

    /**
     * Dispose a workspace's handle. Called when the workspace is removed or
     * re-registered (possibly at a new root); the next request opens a fresh one.
     */
    evictWorkspace(repoId: string): void {
        this.handles.get(repoId)?.files.dispose();
        this.handles.delete(repoId);
    }

    /**
     * Keep handles in step with the registry: after the store registers,
     * updates or removes a workspace, drop its handle unless it still matches
     * the workspace's live root.
     */
    trackWorkspaces(store: Pick<ProcessStore, 'registerWorkspace' | 'updateWorkspace' | 'removeWorkspace'>): void {
        for (const method of ['registerWorkspace', 'updateWorkspace', 'removeWorkspace'] as const) {
            const original = store[method].bind(store) as (arg: string | WorkspaceInfo, ...rest: unknown[]) => Promise<unknown>;
            Object.assign(store, {
                [method]: async (arg: string | WorkspaceInfo, ...rest: unknown[]) => {
                    const result = await original(arg, ...rest);
                    const repoId = typeof arg === 'string' ? arg : arg.id;
                    if (this.handles.get(repoId)?.root !== await this.resolveRepoRoot(repoId)) this.evictWorkspace(repoId);
                    return result;
                },
            });
        }
    }

    /** Dispose every handle; called on server shutdown. */
    dispose(): void {
        for (const id of [...this.handles.keys()]) this.evictWorkspace(id);
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
     * List the contents of `relativePath` inside the repo identified by `repoId`:
     * dirs first, locale order, capped at `maxEntries`.
     * @throws if the path escapes the repo, does not exist, or is not a directory.
     */
    async listDirectory(
        repoId: string,
        relativePath: string,
        options?: { showIgnored?: boolean },
    ): Promise<TreeListResult> {
        return this.listDirectoryDeep(repoId, relativePath, 1, options);
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
        return (await this.repoFiles(repoId)).listDirectory(relativePath, {
            depth: Math.max(depth, 1),
            showIgnored: options?.showIgnored ?? false,
            maxEntries: this.maxEntries,
        });
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
        const files = await this.repoFiles(repoId);
        const normalizedRel = stripLeadingSeparators(relativePath === '' || relativePath === '.' ? '.' : relativePath);
        const showIgnored = options?.showIgnored ?? false;
        // The whole repo comes from the warm native index (the hot path behind
        // file search); the cap bounds the payload, not what search can find.
        if (normalizedRel === '.') {
            return files.indexFiles({ showIgnored, maxEntries: this.fileListMaxEntries });
        }
        return files.listFiles(normalizedRel, { showIgnored, maxEntries: this.maxEntries });
    }

    /**
     * The native handle for a repo's live root, or throws `Repo not found`.
     * Every request re-reads the registry, so a removed or re-rooted workspace
     * never reaches its old handle even if an eviction hook was missed.
     */
    private async repoHandle(repoId: string): Promise<{ root: string; files: NativeRepoFiles }> {
        const repoRoot = await this.resolveRepoRoot(repoId);
        const existing = this.handles.get(repoId);
        if (existing && existing.root === repoRoot) return existing;
        this.evictWorkspace(repoId);
        if (!repoRoot) {
            throw new Error(`Repo not found: ${repoId}`);
        }
        this.nativeRepoFiles ??= loadNativeRepoFiles();
        const files = this.nativeRepoFiles.openRepoFiles(repoRoot, this.fileListCacheTtlMs);
        const handle = { root: repoRoot, files };
        this.handles.set(repoId, handle);
        return handle;
    }

    private async repoFiles(repoId: string): Promise<NativeRepoFiles> {
        return (await this.repoHandle(repoId)).files;
    }

    /**
     * Read file content: text or base64, encoding, and mimeType.
     * @throws if file not found, path traversal detected, or file exceeds 1 MB.
     */
    async readBlob(repoId: string, relativePath: string): Promise<NativeRepoBlob> {
        return (await this.repoFiles(repoId)).readBlob(relativePath);
    }

    /**
     * Write text content to a file inside a repo.
     * @throws if repo not found, path traversal detected, or path is a directory.
     */
    async writeBlob(repoId: string, relativePath: string, content: string): Promise<void> {
        // The handle re-walks its indexes after the write before resolving.
        await (await this.repoFiles(repoId)).writeBlob(relativePath, content);
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
        const files = await this.repoFiles(repoId);
        const results: FileSearchResult[] = await files.searchFiles(query, clampLimit(options?.limit), options?.showIgnored ?? false);
        // Nothing was dropped on the way in, so no result is missing.
        return { results, truncated: false };
    }

    /**
     * Fuzzy-search one repo while retaining the native ordering tuple.
     *
     * Server-side aggregators use this to merge independently ranked indexes.
     * The tuple must not be serialized by the single-repo REST endpoint.
     */
    async searchFilesRanked(
        repoId: string,
        query: string,
        options?: { limit?: number; showIgnored?: boolean },
    ): Promise<NativeRankedFileMatch[]> {
        const files = await this.repoFiles(repoId);
        return files.searchFilesRanked(query, clampLimit(options?.limit), options?.showIgnored ?? false);
    }

    /**
     * Search eligible file contents under the repo root.
     *
     * Every query reads current working-tree contents. Tracked single-line
     * literals let Rust use Git to narrow the fresh walk to candidate paths;
     * other modes walk their full eligible file set. There is no content
     * result cache or native cancellation.
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
        const { root, files } = await this.repoHandle(repoId);
        const tracked = options?.fileScope === 'tracked';
        const includeUntracked = options?.includeUntracked ?? false;
        let wslOutput: string | undefined;
        if (tracked && resolveWorkspaceExecutionContext(root).kind === 'wsl') {
            const command = await files.prepareContentCandidates(includeUntracked);
            try {
                wslOutput = await execGitAsync(command.args, root, {
                    timeout: command.timeoutMs,
                    maxBuffer: command.maxBuffer,
                });
            } catch (error) {
                throw new TrackedContentSearchUnavailableError(
                    `Git-tracked search is unavailable: ${error instanceof Error ? error.message : String(error)}`,
                );
            }
        }
        try {
            return await files.searchContent(query, {
                path: options?.path,
                caseSensitive: options?.caseSensitive ?? false,
                wholeWord: options?.wholeWord ?? false,
                regex: options?.regex ?? false,
                showIgnored: options?.showIgnored ?? false,
                include: options?.include,
                exclude: options?.exclude,
                maxResults: Math.min(Math.max(options?.limit ?? CONTENT_SEARCH_MAX_RESULTS, 1), CONTENT_SEARCH_MAX_RESULTS),
            }, tracked, includeUntracked, wslOutput);
        } catch (error) {
            const prefix = '[repo-files:tracked-unavailable]';
            if (error instanceof Error && error.message.startsWith(prefix)) {
                throw new TrackedContentSearchUnavailableError(error.message.slice(prefix.length).trimStart());
            }
            throw error;
        }
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
        files: NativeRepoReplaceFile[],
        options?: NativeRepoReplaceOptions,
    ): Promise<NativeRepoReplaceResult> {
        return (await this.repoFiles(repoId)).replaceContent(query, replacement, files, options);
    }

    /**
     * Build a RepoInfo from a WorkspaceInfo.
     * Pure mapping + git HEAD resolution.
     */
    static async toRepoInfo(workspace: WorkspaceInfo): Promise<RepoInfo> {
        const headSha = await gitOutput(workspace.rootPath, ['rev-parse', '--short', 'HEAD']);
        const remoteUrl = await gitOutput(workspace.rootPath, ['remote', 'get-url', 'origin']);

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
