import { execSync } from 'child_process';
import * as path from 'path';
import * as vscode from 'vscode';
import { GitCommit, GitCommitFile, GitChangeStatus, CommitLoadOptions, CommitLoadResult } from './types';

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
            
            // Get the set of commits that are ahead of remote
            const aheadCommits = this.getAheadOfRemoteCommits(repoRoot);
            
            const commits = commitLines.map(line => {
                const commit = this.parseCommitLine(line, repoRoot, repoName);
                commit.isAheadOfRemote = aheadCommits.has(commit.hash);
                return commit;
            });

            return { commits, hasMore };
        } catch (error) {
            console.error(`Failed to get commits for ${repoRoot}:`, error);
            return { commits: [], hasMore: false };
        }
    }

    /**
     * Get the set of commit hashes that are ahead of the remote tracking branch
     * @param repoRoot Repository root path
     * @returns Set of commit hashes that haven't been pushed
     */
    private getAheadOfRemoteCommits(repoRoot: string): Set<string> {
        try {
            // Get the upstream branch for the current branch
            const upstreamCommand = 'git rev-parse --abbrev-ref @{upstream}';
            let upstream: string;
            try {
                upstream = execSync(upstreamCommand, {
                    cwd: repoRoot,
                    encoding: 'utf-8',
                    timeout: 5000
                }).trim();
            } catch {
                // No upstream configured, return empty set
                return new Set();
            }

            // Get commits that are in HEAD but not in upstream
            const aheadCommand = `git log ${upstream}..HEAD --pretty=format:"%H"`;
            const output = execSync(aheadCommand, {
                cwd: repoRoot,
                encoding: 'utf-8',
                timeout: 5000
            });

            if (!output.trim()) {
                return new Set();
            }

            return new Set(output.trim().split('\n').filter(h => h));
        } catch (error) {
            // If anything fails, return empty set (don't break the main functionality)
            return new Set();
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
     * Validate a git ref and return the resolved commit hash
     * Supports: full/short hash, branch names, tags, HEAD~N, etc.
     * @param repoRoot Repository root path
     * @param ref Git reference to validate
     * @returns Resolved full hash or undefined if invalid
     */
    validateRef(repoRoot: string, ref: string): string | undefined {
        try {
            // Use ^{commit} to ensure it's a commit (not a tree or blob)
            const command = `git rev-parse --verify "${ref}^{commit}"`;
            const output = execSync(command, {
                cwd: repoRoot,
                encoding: 'utf-8',
                timeout: 5000,
                stdio: ['pipe', 'pipe', 'pipe']  // Suppress stderr
            });
            return output.trim();
        } catch {
            return undefined;
        }
    }

    /**
     * Get branch names for suggestions
     * @param repoRoot Repository root path
     * @returns Array of branch names (limited to 10)
     */
    getBranches(repoRoot: string): string[] {
        try {
            const output = execSync('git branch -a --format="%(refname:short)"', {
                cwd: repoRoot,
                encoding: 'utf-8',
                timeout: 5000
            });
            return output.trim().split('\n')
                .filter(b => b && !b.includes('HEAD'))
                .slice(0, 10);
        } catch {
            return [];
        }
    }

    /**
     * Empty tree hash for initial commits with no parent
     */
    private static readonly EMPTY_TREE_HASH = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

    /**
     * Get files changed in a specific commit
     * @param repoRoot Repository root path
     * @param commitHash Commit hash
     * @returns Array of files changed in the commit
     */
    getCommitFiles(repoRoot: string, commitHash: string): GitCommitFile[] {
        try {
            // Get the parent hash for diff comparison
            const parentHash = this.getParentHash(repoRoot, commitHash);

            // Use git diff-tree to get files changed
            // --no-commit-id: don't show the commit id
            // --name-status: show status (M/A/D/R/C) and file names
            // -r: recurse into subdirectories
            // -M: detect renames
            // -C: detect copies
            const command = `git diff-tree --no-commit-id --name-status -r -M -C ${commitHash}`;
            
            const output = execSync(command, {
                cwd: repoRoot,
                encoding: 'utf-8',
                timeout: 10000
            });

            if (!output.trim()) {
                return [];
            }

            const files: GitCommitFile[] = [];
            const lines = output.trim().split('\n');

            for (const line of lines) {
                const file = this.parseFileLine(line, commitHash, parentHash, repoRoot);
                if (file) {
                    files.push(file);
                }
            }

            return files;
        } catch (error) {
            console.error(`Failed to get commit files for ${commitHash} from ${repoRoot}:`, error);
            return [];
        }
    }

    /**
     * Get the parent hash for a commit
     * For merge commits, uses the first parent
     * For initial commits, uses the empty tree hash
     */
    private getParentHash(repoRoot: string, commitHash: string): string {
        try {
            const command = `git rev-parse ${commitHash}^`;
            const output = execSync(command, {
                cwd: repoRoot,
                encoding: 'utf-8',
                timeout: 5000
            });
            return output.trim();
        } catch {
            // Initial commit has no parent, use empty tree hash
            return GitLogService.EMPTY_TREE_HASH;
        }
    }

    /**
     * Parse a file line from git diff-tree output
     * Format: STATUS\tPATH or STATUS\tOLD_PATH\tNEW_PATH (for renames/copies)
     */
    private parseFileLine(
        line: string,
        commitHash: string,
        parentHash: string,
        repoRoot: string
    ): GitCommitFile | null {
        if (!line.trim()) {
            return null;
        }

        const parts = line.split('\t');
        if (parts.length < 2) {
            return null;
        }

        const statusCode = parts[0];
        const status = this.parseStatusCode(statusCode);

        // Handle renames and copies (have two paths)
        if (statusCode.startsWith('R') || statusCode.startsWith('C')) {
            if (parts.length >= 3) {
                return {
                    path: parts[2],
                    originalPath: parts[1],
                    status,
                    commitHash,
                    parentHash,
                    repositoryRoot: repoRoot
                };
            }
        }

        return {
            path: parts[1],
            status,
            commitHash,
            parentHash,
            repositoryRoot: repoRoot
        };
    }

    /**
     * Parse git status code to GitChangeStatus
     */
    private parseStatusCode(code: string): GitChangeStatus {
        const firstChar = code.charAt(0).toUpperCase();
        switch (firstChar) {
            case 'M': return 'modified';
            case 'A': return 'added';
            case 'D': return 'deleted';
            case 'R': return 'renamed';
            case 'C': return 'copied';
            case 'U': return 'conflict';
            default: return 'modified';
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

