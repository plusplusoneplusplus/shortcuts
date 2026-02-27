import * as vscode from 'vscode';
import { GitLogService as CoreGitLogService } from '@plusplusoneplusplus/pipeline-core';
import { getExtensionLogger, LogCategory } from '../shared';
import { GitCommit, GitCommitFile, CommitLoadOptions, CommitLoadResult } from './types';

/**
 * Git Extension API types (from vscode.git extension)
 * These are simplified versions of the actual API types
 */
interface GitExtension {
    getAPI(version: 1): GitAPI;
}

interface GitAPI {
    repositories: Repository[];
}

interface Repository {
    rootUri: vscode.Uri;
}

/**
 * Service for retrieving git commit history.
 *
 * Delegates pure-git operations to the pipeline-core GitLogService.
 * Keeps VS Code–specific methods (initialize, getRepositories, getAllCommits) in-place.
 */
export class GitLogService implements vscode.Disposable {
    private gitAPI?: GitAPI;
    private disposables: vscode.Disposable[] = [];
    private coreService = new CoreGitLogService();

    /**
     * Initialize the git log service by getting the git extension API
     * @returns true if git extension is available, false otherwise
     */
    async initialize(): Promise<boolean> {
        try {
            const gitExtension = vscode.extensions.getExtension<GitExtension>('vscode.git');
            if (!gitExtension) {
                console.log('Git extension not found');
                return false;
            }

            // Activate the extension if not already active
            if (!gitExtension.isActive) {
                await gitExtension.activate();
            }

            this.gitAPI = gitExtension.exports.getAPI(1);
            if (!this.gitAPI) {
                console.log('Failed to get Git API');
                return false;
            }

            return true;
        } catch (error) {
            getExtensionLogger().error(LogCategory.GIT, 'Failed to initialize git log service', error instanceof Error ? error : undefined);
            return false;
        }
    }

    /**
     * Get all git repositories
     */
    getRepositories(): Repository[] {
        return this.gitAPI?.repositories ?? [];
    }

    /**
     * Get commits from a repository
     */
    getCommits(repoRoot: string, options: CommitLoadOptions): CommitLoadResult {
        return this.coreService.getCommits(repoRoot, options);
    }

    /**
     * Get commits from all repositories
     */
    getAllCommits(options: CommitLoadOptions): CommitLoadResult {
        const allCommits: GitCommit[] = [];
        let anyHasMore = false;

        for (const repo of this.getRepositories()) {
            const result = this.coreService.getCommits(repo.rootUri.fsPath, options);
            allCommits.push(...result.commits);
            if (result.hasMore) {
                anyHasMore = true;
            }
        }

        // Sort all commits by date (newest first)
        allCommits.sort((a, b) => {
            return new Date(b.date).getTime() - new Date(a.date).getTime();
        });

        // Limit to maxCount and update hasMore
        const hasMore = anyHasMore || allCommits.length > options.maxCount;
        const commits = allCommits.slice(0, options.maxCount);

        return { commits, hasMore };
    }

    /**
     * Check if there are more commits available
     */
    hasMoreCommits(repoRoot: string, currentCount: number): boolean {
        return this.coreService.hasMoreCommits(repoRoot, currentCount);
    }

    /**
     * Get a single commit by hash
     */
    getCommit(repoRoot: string, hash: string): GitCommit | undefined {
        return this.coreService.getCommit(repoRoot, hash);
    }

    /**
     * Validate a git ref and return the resolved commit hash
     */
    validateRef(repoRoot: string, ref: string): string | undefined {
        return this.coreService.validateRef(repoRoot, ref);
    }

    /**
     * Get branch names for suggestions (cached, local branches only for speed)
     */
    getBranches(repoRoot: string, forceRefresh = false): string[] {
        return this.coreService.getBranches(repoRoot, forceRefresh);
    }

    /**
     * Get branch names asynchronously (for non-blocking UI)
     */
    getBranchesAsync(repoRoot: string): Promise<string[]> {
        return this.coreService.getBranchesAsync(repoRoot);
    }

    /**
     * Invalidate branch cache for a repository
     */
    invalidateBranchCache(repoRoot?: string): void {
        this.coreService.invalidateBranchCache(repoRoot);
    }

    /**
     * Get files changed in a specific commit
     */
    getCommitFiles(repoRoot: string, commitHash: string): GitCommitFile[] {
        return this.coreService.getCommitFiles(repoRoot, commitHash);
    }

    /**
     * Get the diff for a specific commit
     */
    getCommitDiff(repoRoot: string, commitHash: string): string {
        return this.coreService.getCommitDiff(repoRoot, commitHash);
    }

    /**
     * Get the diff for pending changes (staged + unstaged)
     */
    getPendingChangesDiff(repoRoot: string): string {
        return this.coreService.getPendingChangesDiff(repoRoot);
    }

    /**
     * Get the diff for staged changes only
     */
    getStagedChangesDiff(repoRoot: string): string {
        return this.coreService.getStagedChangesDiff(repoRoot);
    }

    /**
     * Check if there are any pending changes
     */
    hasPendingChanges(repoRoot: string): boolean {
        return this.coreService.hasPendingChanges(repoRoot);
    }

    /**
     * Check if there are any staged changes
     */
    hasStagedChanges(repoRoot: string): boolean {
        return this.coreService.hasStagedChanges(repoRoot);
    }

    /**
     * Get file content at a specific commit
     */
    getFileContentAtCommit(repoRoot: string, commitHash: string, filePath: string): string | undefined {
        return this.coreService.getFileContentAtCommit(repoRoot, commitHash, filePath);
    }

    /**
     * Check if a file exists at a specific commit
     */
    fileExistsAtCommit(repoRoot: string, commitHash: string, filePath: string): boolean {
        return this.coreService.fileExistsAtCommit(repoRoot, commitHash, filePath);
    }

    /**
     * Dispose of all resources
     */
    dispose(): void {
        this.coreService.dispose();
        for (const disposable of this.disposables) {
            disposable.dispose();
        }
        this.disposables = [];
    }
}

