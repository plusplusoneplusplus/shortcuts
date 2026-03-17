/**
 * WorkingTreeService — working-tree mutation operations for the git module.
 *
 * Provides stage, unstage, discard, delete-untracked, and getAllChanges
 * using the git CLI (via execGit) and Node's `fs` module.
 *
 * No VS Code dependencies.
 */

import * as fs from 'fs';
import * as path from 'path';
import { execAsync } from '../utils/exec-utils';
import { getLogger } from '../logger';
import { GitChange, GitChangeStatus, GitChangeStage, GitOperationResult } from './types';

// ─────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────────────

interface GitExecOptions {
    cwd: string;
    timeout?: number;
}

/**
 * Wrap a filesystem path in double-quotes for use in a shell command string,
 * stripping any trailing path separator first.
 *
 * Without this, a Windows path like `C:\repo\dir\` would produce `"C:\repo\dir\"`
 * where the trailing backslash escapes the closing quote, corrupting the argument.
 */
function q(p: string): string {
    return `"${p.replace(/[/\\]+$/, '')}"`;
}

async function execGitAsync(command: string, options: GitExecOptions): Promise<string> {
    const { stdout } = await execAsync(command, {
        cwd: options.cwd,
        timeout: options.timeout ?? 30_000,
        shell: process.platform === 'win32' ? 'cmd.exe' : '/bin/sh',
    });
    return stdout;
}

/** Map a single porcelain status character to `GitChangeStatus`. */
function charToStatus(char: string): GitChangeStatus | null {
    switch (char) {
        case 'M': return 'modified';
        case 'A': return 'added';
        case 'D': return 'deleted';
        case 'R': return 'renamed';
        case 'C': return 'copied';
        case 'U': return 'conflict';
        case '?': return 'untracked';
        case '!': return 'ignored';
        default:  return null;
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Porcelain parser
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Parse `git status --porcelain` output into `GitChange[]`.
 *
 * Each porcelain line has the format:
 *   `XY path` or `XY oldpath -> newpath` (for renames/copies)
 *
 * X = staged column, Y = unstaged column.
 * Untracked files use `??`.
 */
export function parsePorcelain(output: string, repoRoot: string): GitChange[] {
    const repoName = path.basename(repoRoot);
    const changes: GitChange[] = [];

    for (const rawLine of output.split('\n')) {
        const line = rawLine.replace(/\r$/, '');
        if (line.length < 4) continue; // must have "XY " and at least one char

        const X = line[0]; // staged status
        const Y = line[1]; // unstaged/worktree status
        // line[2] is always a space
        const rest = line.slice(3);

        // Renames/copies: "oldpath -> newpath"
        const arrowIdx = rest.indexOf(' -> ');
        const filePath = arrowIdx >= 0 ? rest.slice(arrowIdx + 4) : rest;
        const originalPath = arrowIdx >= 0 ? rest.slice(0, arrowIdx) : undefined;

        const absPath = path.isAbsolute(filePath)
            ? filePath
            : path.join(repoRoot, filePath);

        const absOriginalPath = originalPath
            ? path.isAbsolute(originalPath) ? originalPath : path.join(repoRoot, originalPath)
            : undefined;

        // Untracked (both columns are '?')
        if (X === '?' && Y === '?') {
            changes.push({
                filePath: absPath,
                status: 'untracked',
                stage: 'untracked',
                repositoryRoot: repoRoot,
                repositoryName: repoName,
            });
            continue;
        }

        // Ignored (both columns are '!')
        if (X === '!' && Y === '!') {
            continue; // skip ignored files
        }

        // Staged change (X column)
        if (X !== ' ' && X !== '?') {
            const status = charToStatus(X);
            if (status) {
                changes.push({
                    filePath: absPath,
                    originalPath: absOriginalPath,
                    status,
                    stage: 'staged',
                    repositoryRoot: repoRoot,
                    repositoryName: repoName,
                });
            }
        }

        // Unstaged / worktree change (Y column)
        if (Y !== ' ' && Y !== '?') {
            const status = charToStatus(Y);
            if (status) {
                changes.push({
                    filePath: absPath,
                    originalPath: absOriginalPath,
                    status,
                    stage: 'unstaged',
                    repositoryRoot: repoRoot,
                    repositoryName: repoName,
                });
            }
        }
    }

    return changes;
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
        try {
            const { stdout } = await execAsync(
                `git -C ${q(repoRoot)} status --porcelain`,
                { timeout: 15_000 }
            );
            return parsePorcelain(stdout, repoRoot);
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
            await execGitAsync(`git -C ${q(repoRoot)} add -- ${q(filePath)}`, { cwd: repoRoot });
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
            const escaped = filePaths.map(f => q(f)).join(' ');
            await execGitAsync(`git -C ${q(repoRoot)} add -- ${escaped}`, { cwd: repoRoot });
        } catch {
            for (const filePath of filePaths) {
                try {
                    await execGitAsync(`git -C ${q(repoRoot)} add -- ${q(filePath)}`, { cwd: repoRoot });
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
            await execGitAsync(`git -C ${q(repoRoot)} reset HEAD -- ${q(filePath)}`, { cwd: repoRoot });
            return { success: true };
        } catch (firstError) {
            // No commits yet — fall back to `git rm --cached`
            try {
                await execGitAsync(`git -C ${q(repoRoot)} rm --cached -- ${q(filePath)}`, { cwd: repoRoot });
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
            const escaped = filePaths.map(f => q(f)).join(' ');
            await execGitAsync(`git -C ${q(repoRoot)} reset HEAD -- ${escaped}`, { cwd: repoRoot });
        } catch {
            for (const filePath of filePaths) {
                try {
                    await execGitAsync(`git -C ${q(repoRoot)} reset HEAD -- ${q(filePath)}`, { cwd: repoRoot });
                } catch {
                    try {
                        await execGitAsync(`git -C ${q(repoRoot)} rm --cached -- ${q(filePath)}`, { cwd: repoRoot });
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
            await execGitAsync(`git -C ${q(repoRoot)} checkout -- ${q(filePath)}`, { cwd: repoRoot });
            return { success: true };
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            getLogger().error('Git', `discardChanges failed: ${filePath}`, error instanceof Error ? error : undefined);
            return { success: false, error: errorMessage };
        }
    }

    /**
     * Get the diff for a single file in the working tree.
     * - staged=true  → `git diff --staged -- <file>`
     * - staged=false → `git diff -- <file>`
     * Returns empty string on error or when there is no diff.
     */
    async getFileDiff(repoRoot: string, filePath: string, staged: boolean): Promise<string> {
        try {
            const flag = staged ? '--staged ' : '';
            return await execGitAsync(
                `git -C ${q(repoRoot)} diff -U99999 ${flag}-- ${q(filePath)}`,
                { cwd: repoRoot }
            );
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
