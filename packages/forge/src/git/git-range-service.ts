/**
 * Branch-range ref resolution and public metadata conversion.
 * Rust owns patch planning, execution and processing; TypeScript runs the
 * shared command plan through WSL and preserves localeCompare file ordering.
 */

import * as fs from 'fs';
import * as path from 'path';
import { loadNativeGit } from '@plusplusoneplusplus/coc-native';
import type {
    NativeGitAddon,
    NativeGitRangeDefaultBranch,
} from '@plusplusoneplusplus/coc-native';
import { getLogger, LogCategory } from '../logger';
import { resolveWorkspaceExecutionContext } from '../utils/workspace-execution';
import { execGitAsync } from './exec';
import { loadRangePatch } from '../diff/local-patch';
import { GitCommitRange, GitCommitRangeFile, GitRangeBaseMode, GitRangeConfig } from './types';

/**
 * Options for {@link GitRangeService.detectCommitRange}.
 */
export interface DetectCommitRangeOptions {
    /** Which ref to diff against. Defaults to `'default-branch'`. */
    baseMode?: GitRangeBaseMode;
    signal?: AbortSignal;
}

/**
 * Internal resolved config with all defaults applied.
 */
interface ResolvedGitRangeConfig {
    maxFiles: number;
    showOnDefaultBranch: boolean;
}

const DEFAULT_CONFIG: ResolvedGitRangeConfig = {
    maxFiles: 100,
    showOnDefaultBranch: false,
};

export class GitRangeService {
    private config: ResolvedGitRangeConfig;

    /** Cache for default branch detection */
    private defaultBranchCache: Map<string, { branch: string; timestamp: number }> = new Map();
    private static readonly DEFAULT_BRANCH_CACHE_TTL = 60000; // 1 minute

    constructor(config?: GitRangeConfig) {
        this.config = {
            maxFiles: config?.maxFiles ?? DEFAULT_CONFIG.maxFiles,
            showOnDefaultBranch: config?.showOnDefaultBranch ?? DEFAULT_CONFIG.showOnDefaultBranch,
        };
    }

    /**
     * The native git capability, and whether this repository has to take the
     * WSL path to reach git.
     *
     * Deliberately called outside the try/catch in every method below: a
     * missing or capability-stale binary is a `NativeAddonLoadError` naming the
     * rebuild, and catching it as "no default branch" would hide it behind an
     * empty range view. The addon is loaded on the WSL path too — the commands
     * run through `wsl.exe`, but the parsers are still Rust's.
     */
    private native(repoRoot: string): { addon: NativeGitAddon; wsl: boolean } {
        return {
            addon: loadNativeGit(),
            wsl: resolveWorkspaceExecutionContext(repoRoot).kind === 'wsl',
        };
    }

    /**
     * Get the current branch name.
     *
     * `'HEAD'` stands in for a detached HEAD and for a repository with no
     * commits yet — the two cases `rev-parse --abbrev-ref HEAD` answered with
     * that literal string or with a non-zero exit.
     *
     * @returns Current branch name or 'HEAD' if detached
     */
    async getCurrentBranch(repoRoot: string): Promise<string> {
        const { addon, wsl } = this.native(repoRoot);
        try {
            if (!wsl) {
                return (await addon.gitCurrentBranchName(repoRoot)) || 'HEAD';
            }
            const branch = await execGitAsync(['rev-parse', '--abbrev-ref', 'HEAD'], repoRoot);
            return branch || 'HEAD';
        } catch (error) {
            getLogger().error(LogCategory.GIT, 'Failed to get current branch', error instanceof Error ? error : undefined);
            return 'HEAD';
        }
    }

    /**
     * Ask the five default-branch questions through `wsl.exe`.
     *
     * The WSL twin of the addon's `gitRangeDefaultBranch`, in the same order
     * and reporting the same `fromRemote` flag, so both paths feed the cache
     * below identically. Rust's tests pin the order the two share.
     */
    private async defaultBranchViaCli(repoRoot: string): Promise<NativeGitRangeDefaultBranch | null> {
        for (const candidate of ['origin/main', 'origin/master']) {
            try {
                await execGitAsync(['rev-parse', '--verify', candidate], repoRoot);
                return { name: candidate, fromRemote: true };
            } catch {
                // This remote branch does not exist.
            }
        }

        try {
            const remoteHead = await execGitAsync(['symbolic-ref', 'refs/remotes/origin/HEAD'], repoRoot);
            if (remoteHead) {
                return { name: remoteHead.replace('refs/remotes/', ''), fromRemote: true };
            }
        } catch {
            // No remote HEAD.
        }

        for (const candidate of ['main', 'master']) {
            try {
                await execGitAsync(['rev-parse', '--verify', candidate], repoRoot);
                return { name: candidate, fromRemote: false };
            } catch {
                // This local branch does not exist.
            }
        }

        return null;
    }

    /**
     * Detect the default remote branch (origin/main or origin/master).
     * @returns Default remote branch name or null if not found
     */
    async getDefaultRemoteBranch(repoRoot: string): Promise<string | null> {
        if (!fs.existsSync(repoRoot)) {
            return null;
        }
        // Check cache first
        const cached = this.defaultBranchCache.get(repoRoot);
        if (cached && Date.now() - cached.timestamp < GitRangeService.DEFAULT_BRANCH_CACHE_TTL) {
            return cached.branch;
        }

        const { addon, wsl } = this.native(repoRoot);
        try {
            const found = wsl
                ? await this.defaultBranchViaCli(repoRoot)
                : await addon.gitRangeDefaultBranch(repoRoot);
            if (!found) {
                return null;
            }
            // Only the remote-derived answers are memoised, which is the split
            // this cache has always had — a local `main` fallback means the
            // remote refs are not there yet, and caching it would keep the
            // range view pointing at the wrong base for a minute after a fetch.
            if (found.fromRemote) {
                this.defaultBranchCache.set(repoRoot, { branch: found.name, timestamp: Date.now() });
            }
            return found.name;
        } catch (error) {
            getLogger().error(LogCategory.GIT, 'Failed to detect default branch', error instanceof Error ? error : undefined);
            return null;
        }
    }

    /**
     * Resolve the current branch's upstream (tracking) ref, e.g. `origin/my-feature`.
     *
     * Deliberately uncached: the upstream changes whenever the branch changes, and
     * this is a single cheap ref read.
     *
     * @returns The upstream ref, or null when the branch has no upstream.
     */
    async getUpstreamBranch(repoRoot: string): Promise<string | null> {
        if (!fs.existsSync(repoRoot)) {
            return null;
        }
        const { addon, wsl } = this.native(repoRoot);
        try {
            if (!wsl) {
                return await addon.gitRangeUpstreamBranch(repoRoot);
            }
            const upstream = await execGitAsync(
                ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'],
                repoRoot
            );
            return upstream || null;
        } catch {
            // No upstream configured for this branch (or detached HEAD).
            return null;
        }
    }

    /**
     * Get the merge base between two refs.
     */
    async getMergeBase(repoRoot: string, ref1: string, ref2: string): Promise<string | null> {
        const { addon, wsl } = this.native(repoRoot);
        try {
            if (!wsl) {
                return await addon.gitRangeMergeBase(repoRoot, ref1, ref2);
            }
            return (await execGitAsync(['merge-base', ref1, ref2], repoRoot)) || null;
        } catch (error) {
            getLogger().error(LogCategory.GIT, `Failed to get merge base for ${ref1}..${ref2}`, error instanceof Error ? error : undefined);
            return null;
        }
    }

    /**
     * Count commits ahead of the base ref.
     */
    async countCommitsAhead(repoRoot: string, baseRef: string, headRef: string): Promise<number> {
        const { addon, wsl } = this.native(repoRoot);
        try {
            if (!wsl) {
                return await addon.gitRangeCountAhead(repoRoot, baseRef, headRef);
            }
            const count = await execGitAsync(['rev-list', '--count', `${baseRef}..${headRef}`], repoRoot);
            return parseInt(count, 10) || 0;
        } catch (error) {
            getLogger().error(LogCategory.GIT, `Failed to count commits ahead for ${baseRef}..${headRef}`, error instanceof Error ? error : undefined);
            return 0;
        }
    }

    /** Get files changed in a commit range through the shared patch backend. */
    async getChangedFiles(repoRoot: string, baseRef: string, headRef: string, signal?: AbortSignal): Promise<GitCommitRangeFile[]> {
        return (await this.getRangeMetadata(repoRoot, baseRef, headRef, signal)).files;
    }

    /** Get complete patch statistics, including files beyond the display cap. */
    async getDiffStats(repoRoot: string, baseRef: string, headRef: string, signal?: AbortSignal): Promise<{ additions: number; deletions: number }> {
        const { additions, deletions } = await this.getRangeMetadata(repoRoot, baseRef, headRef, signal);
        return { additions, deletions };
    }

    private async getRangeMetadata(repoRoot: string, baseRef: string, headRef: string, signal?: AbortSignal) {
        signal?.throwIfAborted();
        loadNativeGit();
        try {
            const { files, summary } = await loadRangePatch(repoRoot, baseRef, headRef, undefined, { signal });
            return {
                files: files.map(file => ({
                    path: file.path,
                    status: file.status,
                    additions: file.additions ?? 0,
                    deletions: file.deletions ?? 0,
                    oldPath: file.originalPath,
                    repositoryRoot: repoRoot,
                })),
                additions: summary.additions,
                deletions: summary.deletions,
            };
        } catch (error) {
            signal?.throwIfAborted();
            getLogger().error(LogCategory.GIT, `Failed to get range metadata for ${baseRef}...${headRef}`, error instanceof Error ? error : undefined);
            return { files: [], additions: 0, deletions: 0 };
        }
    }

    /**
     * Resolve the base ref for a requested base mode.
     *
     * `upstream` silently degrades to the default branch when the current branch
     * has no upstream — the caller learns about it from `baseModeFallback`.
     */
    async resolveBaseRef(
        repoRoot: string,
        baseMode: GitRangeBaseMode = 'default-branch'
    ): Promise<{ baseRef: string | null; baseMode: GitRangeBaseMode; baseModeFallback?: true }> {
        const { addon, wsl } = this.native(repoRoot);
        if (!wsl) {
            try {
                const resolved = await addon.gitRangeResolveBaseRef(repoRoot, baseMode);
                return {
                    baseRef: resolved.baseRef ?? null,
                    baseMode: resolved.baseMode as GitRangeBaseMode,
                    ...(resolved.baseModeFallback && { baseModeFallback: true as const }),
                };
            } catch (error) {
                getLogger().error(LogCategory.GIT, 'Failed to resolve base ref', error instanceof Error ? error : undefined);
                // Nothing resolved, but the mode still has to be reported the
                // way it would have been: an `upstream` request that produced
                // no upstream is a fallback, whether it failed or was absent.
                return baseMode === 'upstream'
                    ? { baseRef: null, baseMode: 'default-branch', baseModeFallback: true }
                    : { baseRef: null, baseMode: 'default-branch' };
            }
        }

        // WSL: the same two questions, asked through `wsl.exe`. Both callees
        // already swallow their own failures, so this cannot throw.
        if (baseMode === 'upstream') {
            const upstream = await this.getUpstreamBranch(repoRoot);
            if (upstream) {
                return { baseRef: upstream, baseMode: 'upstream' };
            }
            return {
                baseRef: await this.getDefaultRemoteBranch(repoRoot),
                baseMode: 'default-branch',
                baseModeFallback: true,
            };
        }
        return { baseRef: await this.getDefaultRemoteBranch(repoRoot), baseMode: 'default-branch' };
    }

    /**
     * Detect and return the commit range for the current branch.
     *
     * @param options.baseMode `'default-branch'` (default) diffs against the repo's
     *   default remote branch; `'upstream'` diffs against `@{upstream}` so only
     *   unpushed commits show. In `upstream` mode an empty range is still returned
     *   (there is nothing unpushed) so callers can keep the range view open.
     * @returns GitCommitRange or null if no range detected
     */
    async detectCommitRange(repoRoot: string, options?: DetectCommitRangeOptions): Promise<GitCommitRange | null> {
        const signal = options?.signal;
        signal?.throwIfAborted();
        if (!fs.existsSync(repoRoot)) {
            return null;
        }
        // Load before the try. Everything below turns a git failure into a null
        // range, which is the right answer for a repository with no base branch
        // and the wrong one for a missing addon — that has to arrive with its
        // rebuild instruction rather than as "no range here".
        this.native(repoRoot);
        try {
            const currentBranch = await this.getCurrentBranch(repoRoot);
            signal?.throwIfAborted();

            const resolved = await this.resolveBaseRef(repoRoot, options?.baseMode);
            signal?.throwIfAborted();
            const baseRef = resolved.baseRef;
            if (!baseRef) {
                return null;
            }

            const mergeBase = await this.getMergeBase(repoRoot, 'HEAD', baseRef);
            signal?.throwIfAborted();
            if (!mergeBase) {
                return null;
            }

            const commitCount = await this.countCommitsAhead(repoRoot, baseRef, 'HEAD');
            signal?.throwIfAborted();

            // If no commits ahead, don't show the range — except in upstream mode,
            // where "nothing unpushed" is a valid, informative result and hiding
            // the range would also hide the base-mode toggle.
            if (commitCount === 0 && resolved.baseMode !== 'upstream') {
                return null;
            }

            const { files, additions, deletions } = await this.getRangeMetadata(repoRoot, baseRef, 'HEAD', signal);

            return {
                baseRef,
                headRef: 'HEAD',
                commitCount,
                files: files.length > this.config.maxFiles ? files.slice(0, this.config.maxFiles) : files,
                additions,
                deletions,
                mergeBase,
                branchName: currentBranch !== 'HEAD' ? currentBranch : undefined,
                repositoryRoot: repoRoot,
                repositoryName: path.basename(repoRoot),
                baseMode: resolved.baseMode,
                ...(resolved.baseModeFallback && { baseModeFallback: true as const })
            };
        } catch (error) {
            signal?.throwIfAborted();
            getLogger().error(LogCategory.GIT, 'Failed to detect commit range', error instanceof Error ? error : undefined);
            return null;
        }
    }

    /**
     * Get the diff content for a specific file in a commit range.
     */
    async getFileDiff(repoRoot: string, baseRef: string, headRef: string, filePath: string, signal?: AbortSignal): Promise<string> {
        signal?.throwIfAborted();
        loadNativeGit();
        try {
            const gitPath = filePath.replace(/\\/g, '/');
            return (await loadRangePatch(repoRoot, baseRef, headRef, gitPath, { contextLines: 99999, signal })).content.raw;
        } catch (error) {
            signal?.throwIfAborted();
            getLogger().error(LogCategory.GIT, `Failed to get file diff for ${filePath}`, error instanceof Error ? error : undefined);
            return '';
        }
    }

    /**
     * Get file content at a specific ref.
     *
     * On the native path the blob is read out of the object database, so the
     * content keeps the trailing newline `git show` loses on the way across —
     * the review pane splits on `\n`, so the only visible difference is that a
     * file which genuinely ends without one is no longer spelled the same as
     * one that does. A ref or path that names nothing answers with the empty
     * string, which is what the non-zero exit already meant here.
     */
    async getFileAtRef(repoRoot: string, ref: string, filePath: string): Promise<string> {
        const { addon, wsl } = this.native(repoRoot);
        try {
            const gitPath = filePath.replace(/\\/g, '/');
            if (!wsl) {
                return (await addon.gitFileContentAtCommit(repoRoot, ref, gitPath)) ?? '';
            }
            return await execGitAsync(['show', `${ref}:${gitPath}`], repoRoot);
        } catch {
            return '';
        }
    }

    /**
     * Get the full diff for a commit range.
     */
    async getRangeDiff(repoRoot: string, baseRef: string, headRef: string, signal?: AbortSignal): Promise<string> {
        signal?.throwIfAborted();
        loadNativeGit();
        try {
            return (await loadRangePatch(repoRoot, baseRef, headRef, undefined, { signal })).content.raw;
        } catch (error) {
            signal?.throwIfAborted();
            getLogger().error(LogCategory.GIT, `Failed to get range diff for ${baseRef}...${headRef}`, error instanceof Error ? error : undefined);
            return '';
        }
    }

    /**
     * Invalidate the default branch cache.
     * @param repoRoot If provided, clears only that repo; otherwise clears all.
     */
    invalidateCache(repoRoot?: string): void {
        if (repoRoot) {
            this.defaultBranchCache.delete(repoRoot);
        } else {
            this.defaultBranchCache.clear();
        }
    }

    /**
     * Dispose of resources.
     */
    dispose(): void {
        this.defaultBranchCache.clear();
    }
}
