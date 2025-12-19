import { execSync } from 'child_process';
import * as path from 'path';
import * as vscode from 'vscode';
import { GitCommit, CommitLoadOptions, CommitLoadResult } from './types';

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
 * Service for retrieving git commit history
 */
export class GitLogService implements vscode.Disposable {
    private gitAPI?: GitAPI;
    private disposables: vscode.Disposable[] = [];

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
            console.error('Failed to initialize git log service:', error);
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
     * @param repoRoot Repository root path
     * @param options Load options (maxCount, skip)
     * @returns Commit load result with commits and hasMore flag
     */
    getCommits(repoRoot: string, options: CommitLoadOptions): CommitLoadResult {
        try {
            const { maxCount, skip } = options;
            
            // Request one extra commit to determine if there are more
            const requestCount = maxCount + 1;
            
            // Format: hash|shortHash|subject|authorName|authorEmail|date|relativeDate|parentHashes|refs
            const format = '%H|%h|%s|%an|%ae|%aI|%ar|%P|%D';
            
            const command = `git log --pretty=format:"${format}" -n ${requestCount} --skip ${skip}`;
            
            const output = execSync(command, {
                cwd: repoRoot,
                encoding: 'utf-8',
                maxBuffer: 10 * 1024 * 1024, // 10MB buffer for large histories
                timeout: 30000 // 30 second timeout
            });

            if (!output.trim()) {
                return { commits: [], hasMore: false };
            }

            const lines = output.trim().split('\n');
            const repoName = path.basename(repoRoot);
            
            // Check if we got more than maxCount (indicating there are more)
            const hasMore = lines.length > maxCount;
            
            // Only take maxCount commits
            const commitLines = hasMore ? lines.slice(0, maxCount) : lines;
            
            const commits = commitLines.map(line => this.parseCommitLine(line, repoRoot, repoName));

            return { commits, hasMore };
        } catch (error) {
            console.error(`Failed to get commits for ${repoRoot}:`, error);
            return { commits: [], hasMore: false };
        }
    }

    /**
     * Get commits from all repositories
     * @param options Load options (maxCount, skip)
     * @returns Combined commit load result
     */
    getAllCommits(options: CommitLoadOptions): CommitLoadResult {
        const allCommits: GitCommit[] = [];
        let anyHasMore = false;

        for (const repo of this.getRepositories()) {
            const result = this.getCommits(repo.rootUri.fsPath, options);
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
     * @param repoRoot Repository root path
     * @param currentCount Number of commits already loaded
     * @returns true if more commits exist
     */
    hasMoreCommits(repoRoot: string, currentCount: number): boolean {
        try {
            // Check if there's at least one more commit beyond what we've loaded
            const command = `git rev-list --count HEAD`;
            const output = execSync(command, {
                cwd: repoRoot,
                encoding: 'utf-8',
                timeout: 5000
            });

            const totalCount = parseInt(output.trim(), 10);
            return totalCount > currentCount;
        } catch (error) {
            console.error(`Failed to check for more commits in ${repoRoot}:`, error);
            return false;
        }
    }

    /**
     * Parse a single commit line from git log output
     */
    private parseCommitLine(line: string, repoRoot: string, repoName: string): GitCommit {
        const parts = line.split('|');
        
        // Parse refs (branch names, tags)
        const refsString = parts[8] || '';
        const refs = refsString
            .split(',')
            .map(ref => ref.trim())
            .filter(ref => ref.length > 0);

        return {
            hash: parts[0] || '',
            shortHash: parts[1] || '',
            subject: parts[2] || '',
            authorName: parts[3] || '',
            authorEmail: parts[4] || '',
            date: parts[5] || '',
            relativeDate: parts[6] || '',
            parentHashes: parts[7] || '',
            refs,
            repositoryRoot: repoRoot,
            repositoryName: repoName
        };
    }

    /**
     * Get a single commit by hash
     * @param repoRoot Repository root path
     * @param hash Commit hash (full or abbreviated)
     * @returns The commit or undefined if not found
     */
    getCommit(repoRoot: string, hash: string): GitCommit | undefined {
        try {
            const format = '%H|%h|%s|%an|%ae|%aI|%ar|%P|%D';
            const command = `git log --pretty=format:"${format}" -n 1 ${hash}`;
            
            const output = execSync(command, {
                cwd: repoRoot,
                encoding: 'utf-8',
                timeout: 5000
            });

            if (!output.trim()) {
                return undefined;
            }

            const repoName = path.basename(repoRoot);
            return this.parseCommitLine(output.trim(), repoRoot, repoName);
        } catch (error) {
            console.error(`Failed to get commit ${hash} from ${repoRoot}:`, error);
            return undefined;
        }
    }

    /**
     * Dispose of all resources
     */
    dispose(): void {
        for (const disposable of this.disposables) {
            disposable.dispose();
        }
        this.disposables = [];
    }
}

