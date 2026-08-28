/**
 * WorkingTreeService — working-tree operations for the git module.
 *
 * Every git command here runs in the native addon: git runs on a libuv worker
 * and the porcelain parse happens in Rust, so nothing in this file spawns a
 * child process. The one exception is a repository inside a WSL distro, which
 * still reaches git through `wsl.exe` from Node — the addon runs git on the
 * host and never learns that WSL exists.
 *
 * Deleting an untracked file is `fs`, not git, and stays where it is.
 */

import * as fs from 'fs';
import * as path from 'path';
import { loadNativeGit } from '@plusplusoneplusplus/coc-native';
import type { NativeGitAddon, NativeGitStatusEntry } from '@plusplusoneplusplus/coc-native';
import { getLogger } from '../logger';
import { runGitViaWsl, translateWslArgs } from './exec';
import { GitChange, GitChangeStatus, GitChangeStage, GitOperationResult } from './types';
import { resolveWorkspaceExecutionContext } from '../utils/workspace-execution';

// ─────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Milliseconds a working-tree command gets when the caller does not pick one. */
const DEFAULT_TIMEOUT_MS = 30_000;

/** Per-call overrides for one working-tree git command. */
interface RunGitOptions {
    /** Milliseconds before the command is killed. Defaults to 30 000. */
    timeout?: number;
}

/**
 * Coerce a timeout to the unsigned 32-bit integer the native boundary takes.
 *
 * N-API rejects the conversion for a float or a value past 2^32, where Node
 * merely behaved oddly; clamping keeps a sloppy caller working rather than
 * turning it into a new failure mode.
 */
function toUint32(value: number): number {
    if (!Number.isFinite(value) || value < 0) {
        return DEFAULT_TIMEOUT_MS;
    }
    return Math.min(Math.floor(value), 0xffffffff);
}

/**
 * The native git capability, and whether this repository has to take the WSL
 * path to reach git.
 *
 * The addon is loaded on both paths: even a WSL repository parses its porcelain
 * in Rust. Callers that would otherwise swallow a `NativeAddonLoadError` into
 * "no changes" or "no diff" call this before their try/catch, so a stale binary
 * still names the rebuild.
 */
function native(repoRoot: string): { addon: NativeGitAddon; wsl: boolean } {
    return {
        addon: loadNativeGit(),
        wsl: resolveWorkspaceExecutionContext(repoRoot).kind === 'wsl',
    };
}

/**
 * Run one git command against this repository.
 *
 * Native host → the addon's runner, on a libuv worker. WSL → `wsl.exe` from
 * Node, with path-shaped arguments translated into the distro's namespace,
 * because the file paths this service is handed are the absolute host paths
 * `getAllChanges` built. Both paths reject with `git <args> failed: <stderr>`.
 */
async function runGit(repoRoot: string, args: string[], options: RunGitOptions = {}): Promise<string> {
    const { addon, wsl } = native(repoRoot);
    const timeout = options.timeout ?? DEFAULT_TIMEOUT_MS;
    if (wsl) {
        const executionContext = resolveWorkspaceExecutionContext(repoRoot);
        // Unreachable: `native()` just reported `wsl: true`. It exists to keep
        // the narrowing honest rather than cast it away.
        if (executionContext.kind !== 'wsl') {
            throw new Error(`${repoRoot} is not a WSL repository`);
        }
        return runGitViaWsl(
            executionContext,
            translateWslArgs(['-C', repoRoot, ...args], executionContext),
            { timeout, errorArgs: args },
        );
    }
    return addon.execGit(args, repoRoot, { timeout: toUint32(timeout) });
}

// ─────────────────────────────────────────────────────────────────────────────
// Working-tree status
// ─────────────────────────────────────────────────────────────────────────────

/**
 * `git status` arguments for the change list.
 *
 * `--untracked-files=all` lists every untracked file individually instead of
 * collapsing a fully-untracked directory into a single trailing-slash entry
 * (e.g. `Plans/`). Collapsed entries produce empty leaf names in the client's
 * file-tree builder; per-file entries render real filenames and let the
 * delete-untracked action operate per file.
 *
 * Only the WSL path spells them out — the native path knows them itself.
 */
const STATUS_ARGS = ['status', '--porcelain', '--untracked-files=all'];

/** A status this slow is a hang the Git tab should not sit waiting on. */
const STATUS_TIMEOUT_MS = 15_000;

/**
 * Read the working tree's change list, whichever side of WSL the repo is on.
 *
 * The porcelain parser lives in Rust and exists exactly once. A repo inside a
 * WSL distro still runs git through `wsl.exe` from here, then hands the text to
 * the same parser, so the two paths cannot drift.
 */
async function readStatusEntries(
    addon: NativeGitAddon,
    repoRoot: string,
): Promise<NativeGitStatusEntry[]> {
    if (resolveWorkspaceExecutionContext(repoRoot).kind === 'wsl') {
        const stdout = await runGit(repoRoot, STATUS_ARGS, { timeout: STATUS_TIMEOUT_MS });
        return addon.parseGitStatusPorcelain(stdout);
    }
    return addon.gitStatusEntries(repoRoot, { timeout: STATUS_TIMEOUT_MS });
}

/**
 * Turn a native status entry into the `GitChange` the UI consumes.
 *
 * Rust reports the path exactly as git printed it — repository-relative. The
 * join back to an absolute path stays here because `path.join` and
 * `path.basename` are what shaped every path the Git tab has ever shown, and
 * their Windows separator handling is not worth re-deriving in Rust.
 */
function toGitChange(entry: NativeGitStatusEntry, repoRoot: string, repositoryName: string): GitChange {
    const absolute = (value: string): string =>
        path.isAbsolute(value) ? value : path.join(repoRoot, value);
    return {
        filePath: absolute(entry.path),
        originalPath: entry.originalPath ? absolute(entry.originalPath) : undefined,
        status: entry.status as GitChangeStatus,
        stage: entry.stage as GitChangeStage,
        repositoryRoot: repoRoot,
        repositoryName,
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// WorkingTreeService
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Service for working-tree operations: stage, unstage, discard, and query changes.
 */
export class WorkingTreeService {

    /**
     * Get all working-tree changes (staged, unstaged, and untracked).
     */
    async getAllChanges(repoRoot: string): Promise<GitChange[]> {
        const repositoryName = path.basename(repoRoot);
        // Deliberately outside the try: every *git* failure here means "no
        // changes to show", but a missing or capability-stale binary is a
        // NativeAddonLoadError naming the rebuild, and swallowing it would
        // render an empty Git tab for a repository full of changes.
        const addon = loadNativeGit();
        try {
            const entries = await readStatusEntries(addon, repoRoot);
            return entries.map(entry => toGitChange(entry, repoRoot, repositoryName));
        } catch (error) {
            getLogger().error('Git', 'getAllChanges failed', error instanceof Error ? error : undefined);
            return [];
        }
    }

    /**
     * Stage a file (`git add -- <file>`).
     */
    async stageFile(repoRoot: string, filePath: string): Promise<GitOperationResult> {
        try {
            await runGit(repoRoot, ['add', '--', filePath]);
            return { success: true };
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            getLogger().error('Git', `stageFile failed: ${filePath}`, error instanceof Error ? error : undefined);
            return { success: false, error: errorMessage };
        }
    }

    /**
     * Stage multiple files in a single git command (`git add -- <files>`).
     * Falls back to individual staging on error.
     */
    async stageFiles(repoRoot: string, filePaths: string[]): Promise<{ success: boolean; staged: number; errors: string[] }> {
        if (filePaths.length === 0) return { success: true, staged: 0, errors: [] };
        const errors: string[] = [];
        try {
            await runGit(repoRoot, ['add', '--', ...filePaths]);
        } catch {
            for (const filePath of filePaths) {
                try {
                    await runGit(repoRoot, ['add', '--', filePath]);
                } catch (e) {
                    errors.push(`${filePath}: ${e instanceof Error ? e.message : 'Unknown error'}`);
                }
            }
        }
        return { success: errors.length === 0, staged: filePaths.length - errors.length, errors };
    }

    /**
     * Unstage a file (`git reset HEAD -- <file>`).
     * Falls back to `git rm --cached` for repos with no commits yet.
     */
    async unstageFile(repoRoot: string, filePath: string): Promise<GitOperationResult> {
        try {
            await runGit(repoRoot, ['reset', 'HEAD', '--', filePath]);
            return { success: true };
        } catch {
            // No commits yet — fall back to `git rm --cached`
            try {
                await runGit(repoRoot, ['rm', '--cached', '--', filePath]);
                return { success: true };
            } catch (fallbackError) {
                const errorMessage = fallbackError instanceof Error ? fallbackError.message : 'Unknown error';
                getLogger().error('Git', `unstageFile failed: ${filePath}`, fallbackError instanceof Error ? fallbackError : undefined);
                return { success: false, error: errorMessage };
            }
        }
    }

    /**
     * Unstage multiple files in a single git command (`git reset HEAD -- <files>`).
     * Falls back to individual unstaging on error, with `git rm --cached` as last resort.
     */
    async unstageFiles(repoRoot: string, filePaths: string[]): Promise<{ success: boolean; unstaged: number; errors: string[] }> {
        if (filePaths.length === 0) return { success: true, unstaged: 0, errors: [] };
        const errors: string[] = [];
        try {
            await runGit(repoRoot, ['reset', 'HEAD', '--', ...filePaths]);
        } catch {
            for (const filePath of filePaths) {
                try {
                    await runGit(repoRoot, ['reset', 'HEAD', '--', filePath]);
                } catch {
                    try {
                        await runGit(repoRoot, ['rm', '--cached', '--', filePath]);
                    } catch (e) {
                        errors.push(`${filePath}: ${e instanceof Error ? e.message : 'Unknown error'}`);
                    }
                }
            }
        }
        return { success: errors.length === 0, unstaged: filePaths.length - errors.length, errors };
    }

    /**
     * Discard unstaged changes to a tracked file (`git checkout -- <file>`).
     * This is destructive and irreversible.
     */
    async discardChanges(repoRoot: string, filePath: string): Promise<GitOperationResult> {
        try {
            await runGit(repoRoot, ['checkout', '--', filePath]);
            return { success: true };
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            getLogger().error('Git', `discardChanges failed: ${filePath}`, error instanceof Error ? error : undefined);
            return { success: false, error: errorMessage };
        }
    }

    /**
     * Discard tracked modifications/deletions for multiple files
     * (`git checkout -- <files>`), falling back to per-file checkout on batch
     * error so a single bad path does not abort the rest.
     */
    private async discardPaths(repoRoot: string, filePaths: string[]): Promise<{ discarded: number; errors: string[] }> {
        if (filePaths.length === 0) return { discarded: 0, errors: [] };
        const errors: string[] = [];
        try {
            await runGit(repoRoot, ['checkout', '--', ...filePaths]);
        } catch {
            for (const filePath of filePaths) {
                try {
                    await runGit(repoRoot, ['checkout', '--', filePath]);
                } catch (e) {
                    errors.push(`${filePath}: ${e instanceof Error ? e.message : 'Unknown error'}`);
                }
            }
        }
        return { discarded: filePaths.length - errors.length, errors };
    }

    /**
     * Discard ALL working-tree changes, returning the repo to a clean state.
     *
     * Runs three phases and reports each independently so partial failures
     * surface with enough detail to tell which step failed:
     *   1. Unstage every staged path (so its contents can then be discarded).
     *   2. Discard tracked modifications/deletions via `git checkout -- <paths>`.
     *   3. Delete untracked files/directories from disk.
     *
     * A newly-added staged file becomes untracked once unstaged, so the
     * working-tree state is re-read after phase 1 to classify what remains.
     *
     * Destructive and irreversible. Error strings are prefixed with the failing
     * phase (`unstage`/`discard`/`delete`).
     */
    async discardAll(repoRoot: string): Promise<{ success: boolean; discarded: number; errors: string[] }> {
        const initial = await this.getAllChanges(repoRoot);
        if (initial.length === 0) return { success: true, discarded: 0, errors: [] };

        const errors: string[] = [];

        // Phase 1 — unstage every staged path so worktree contents can be reset.
        const stagedPaths = [...new Set(initial.filter(c => c.stage === 'staged').map(c => c.filePath))];
        if (stagedPaths.length > 0) {
            const unstaged = await this.unstageFiles(repoRoot, stagedPaths);
            for (const e of unstaged.errors) errors.push(`unstage ${e}`);
        }

        // Re-read after unstaging: staged "added" files are now untracked.
        const remaining = stagedPaths.length > 0 ? await this.getAllChanges(repoRoot) : initial;
        const trackedPaths = [...new Set(remaining.filter(c => c.stage === 'unstaged').map(c => c.filePath))];
        const untrackedPaths = [...new Set(remaining.filter(c => c.stage === 'untracked').map(c => c.filePath))];

        // Phase 2 — discard tracked modifications/deletions.
        const discardResult = await this.discardPaths(repoRoot, trackedPaths);
        for (const e of discardResult.errors) errors.push(`discard ${e}`);

        // Phase 3 — delete untracked files/directories.
        let deleted = 0;
        for (const filePath of untrackedPaths) {
            const result = await this.deleteUntrackedFile(repoRoot, filePath);
            if (result.success) deleted++;
            else errors.push(`delete ${filePath}: ${result.error ?? 'Unknown error'}`);
        }

        return { success: errors.length === 0, discarded: discardResult.discarded + deleted, errors };
    }

    /**
     * Get the diff for a single file in the working tree.
     * - staged=true  → `git diff --staged -- <file>`
     * - staged=false → `git diff -- <file>`
     * Returns empty string on error or when there is no diff.
     */
    async getFileDiff(repoRoot: string, filePath: string, staged: boolean): Promise<string> {
        // Deliberately outside the try: an empty string here means "no diff",
        // and a missing or capability-stale binary is a NativeAddonLoadError
        // naming the rebuild — rendering it as an empty diff would hide it.
        loadNativeGit();
        try {
            const args = ['diff', '-U99999'];
            if (staged) {
                args.push('--staged');
            }
            args.push('--', filePath);
            return await runGit(repoRoot, args);
        } catch (error) {
            getLogger().error('Git', `getFileDiff failed: ${filePath}`, error instanceof Error ? error : undefined);
            return '';
        }
    }

    /**
     * Delete an untracked file or directory from the filesystem.
     * Directories (e.g. untracked snapshot folders) are removed recursively.
     */
    async deleteUntrackedFile(repoRoot: string, filePath: string): Promise<GitOperationResult> {
        try {
            if (!fs.existsSync(filePath)) {
                return { success: false, error: `File does not exist: ${filePath}` };
            }
            const stat = fs.statSync(filePath);
            if (stat.isDirectory()) {
                fs.rmSync(filePath, { recursive: true });
            } else {
                fs.unlinkSync(filePath);
            }
            return { success: true };
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            getLogger().error('Git', `deleteUntrackedFile failed: ${filePath}`, error instanceof Error ? error : undefined);
            return { success: false, error: errorMessage };
        }
    }
}
