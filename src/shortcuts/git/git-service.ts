import * as path from 'path';
import * as vscode from 'vscode';
import { GitChange, GitChangeStatus, GitChangeStage } from './types';

/**
 * Git Extension API types (from vscode.git extension)
 * These are simplified versions of the actual API types
 */
interface GitExtension {
    getAPI(version: 1): GitAPI;
}

interface GitAPI {
    repositories: Repository[];
    onDidOpenRepository: vscode.Event<Repository>;
    onDidCloseRepository: vscode.Event<Repository>;
}

interface Repository {
    rootUri: vscode.Uri;
    state: RepositoryState;
}

interface RepositoryState {
    indexChanges: Change[];
    workingTreeChanges: Change[];
    mergeChanges: Change[];
    onDidChange: vscode.Event<void>;
}

interface Change {
    uri: vscode.Uri;
    originalUri: vscode.Uri;
    renameUri?: vscode.Uri;
    status: Status;
}

/**
 * Git status enum matching VSCode's git extension
 */
enum Status {
    INDEX_MODIFIED,
    INDEX_ADDED,
    INDEX_DELETED,
    INDEX_RENAMED,
    INDEX_COPIED,
    MODIFIED,
    DELETED,
    UNTRACKED,
    IGNORED,
    INTENT_TO_ADD,
    INTENT_TO_RENAME,
    TYPE_CHANGED,
    ADDED_BY_US,
    ADDED_BY_THEM,
    DELETED_BY_US,
    DELETED_BY_THEM,
    BOTH_ADDED,
    BOTH_DELETED,
    BOTH_MODIFIED
}

/**
 * Service for interacting with VSCode's git extension
 */
export class GitService implements vscode.Disposable {
    private gitAPI?: GitAPI;
    private disposables: vscode.Disposable[] = [];
    private _onDidChangeChanges = new vscode.EventEmitter<void>();
    readonly onDidChangeChanges = this._onDidChangeChanges.event;

    /**
     * Initialize the git service by activating the git extension
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

            // Subscribe to repository events
            this.disposables.push(
                this.gitAPI.onDidOpenRepository(repo => this.onRepositoryOpened(repo)),
                this.gitAPI.onDidCloseRepository(() => this._onDidChangeChanges.fire())
            );

            // Subscribe to existing repositories
            for (const repo of this.gitAPI.repositories) {
                this.subscribeToRepository(repo);
            }

            return true;
        } catch (error) {
            console.error('Failed to initialize git service:', error);
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
     * Get the first repository root path (for single-repo scenarios)
     */
    getFirstRepositoryRoot(): string | undefined {
        const repos = this.getRepositories();
        return repos.length > 0 ? repos[0].rootUri.fsPath : undefined;
    }

    /**
     * Get all changes from all repositories
     */
    getAllChanges(): GitChange[] {
        const changes: GitChange[] = [];

        for (const repo of this.getRepositories()) {
            const repoRoot = repo.rootUri.fsPath;
            const repoName = path.basename(repoRoot);

            // Process staged changes (index)
            for (const change of repo.state.indexChanges) {
                const gitChange = this.convertChange(change, 'staged', repoRoot, repoName);
                if (gitChange) {
                    changes.push(gitChange);
                }
            }

            // Process unstaged/untracked changes (working tree)
            for (const change of repo.state.workingTreeChanges) {
                const stage: GitChangeStage = change.status === Status.UNTRACKED ? 'untracked' : 'unstaged';
                const gitChange = this.convertChange(change, stage, repoRoot, repoName);
                if (gitChange) {
                    changes.push(gitChange);
                }
            }

            // Process merge conflicts
            for (const change of repo.state.mergeChanges) {
                const gitChange = this.convertChange(change, 'unstaged', repoRoot, repoName);
                if (gitChange) {
                    gitChange.status = 'conflict';
                    changes.push(gitChange);
                }
            }
        }

        return changes;
    }

    /**
     * Convert a VSCode git Change to our GitChange type
     */
    private convertChange(
        change: Change,
        stage: GitChangeStage,
        repoRoot: string,
        repoName: string
    ): GitChange | null {
        const status = this.mapStatus(change.status, stage);
        if (!status) {
            return null;
        }

        return {
            path: change.uri.fsPath,
            originalPath: change.originalUri?.fsPath,
            status,
            stage,
            repositoryRoot: repoRoot,
            repositoryName: repoName,
            uri: change.uri
        };
    }

    /**
     * Map VSCode git Status to our GitChangeStatus
     */
    private mapStatus(status: Status, stage: GitChangeStage): GitChangeStatus | null {
        switch (status) {
            case Status.INDEX_MODIFIED:
            case Status.MODIFIED:
                return 'modified';
            case Status.INDEX_ADDED:
            case Status.INTENT_TO_ADD:
                return 'added';
            case Status.INDEX_DELETED:
            case Status.DELETED:
                return 'deleted';
            case Status.INDEX_RENAMED:
            case Status.INTENT_TO_RENAME:
                return 'renamed';
            case Status.INDEX_COPIED:
                return 'copied';
            case Status.UNTRACKED:
                return 'untracked';
            case Status.IGNORED:
                return 'ignored';
            case Status.TYPE_CHANGED:
                return 'modified';
            case Status.ADDED_BY_US:
            case Status.ADDED_BY_THEM:
            case Status.DELETED_BY_US:
            case Status.DELETED_BY_THEM:
            case Status.BOTH_ADDED:
            case Status.BOTH_DELETED:
            case Status.BOTH_MODIFIED:
                return 'conflict';
            default:
                return null;
        }
    }

    /**
     * Handle repository opened event
     */
    private onRepositoryOpened(repo: Repository): void {
        this.subscribeToRepository(repo);
        this._onDidChangeChanges.fire();
    }

    /**
     * Subscribe to repository state changes
     */
    private subscribeToRepository(repo: Repository): void {
        this.disposables.push(
            repo.state.onDidChange(() => {
                this._onDidChangeChanges.fire();
            })
        );
    }

    /**
     * Dispose of all resources
     */
    dispose(): void {
        this._onDidChangeChanges.dispose();
        for (const disposable of this.disposables) {
            disposable.dispose();
        }
        this.disposables = [];
    }
}

