import * as vscode from 'vscode';
import { GitChangeItem } from './git-change-item';
import { GitService } from './git-service';
import { GitChange, GitChangeCounts, GitChangeStage } from './types';

/**
 * Stage priority for sorting (lower = higher priority)
 */
const STAGE_PRIORITY: Record<GitChangeStage, number> = {
    'staged': 0,
    'unstaged': 1,
    'untracked': 2
};

/**
 * Tree data provider for the Git Changes view
 * Displays all git changes from all repositories in a flat list
 */
export class GitChangesTreeDataProvider
    implements vscode.TreeDataProvider<vscode.TreeItem>, vscode.Disposable {

    private readonly _onDidChangeTreeData = new vscode.EventEmitter<void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    private gitService: GitService;
    private disposables: vscode.Disposable[] = [];
    private initialized = false;

    constructor() {
        this.gitService = new GitService();
    }

    /**
     * Initialize the git service
     * @returns true if git extension is available
     */
    async initialize(): Promise<boolean> {
        const result = await this.gitService.initialize();
        if (result) {
            // Listen to git changes
            this.disposables.push(
                this.gitService.onDidChangeChanges(() => this.refresh())
            );
            this.initialized = true;
        }
        return result;
    }

    /**
     * Refresh the tree view
     */
    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    /**
     * Get the tree item representation
     */
    getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
        return element;
    }

    /**
     * Get children - flat list at root level only
     */
    async getChildren(element?: vscode.TreeItem): Promise<vscode.TreeItem[]> {
        // No children for items (flat list)
        if (element) {
            return [];
        }

        // Not initialized or no git extension
        if (!this.initialized) {
            return [];
        }

        try {
            const changes = this.gitService.getAllChanges();

            // Sort changes: staged first, then by path
            const sortedChanges = this.sortChanges(changes);

            return sortedChanges.map(change => new GitChangeItem(change));
        } catch (error) {
            console.error('Error getting git changes:', error);
            return [];
        }
    }

    /**
     * Sort changes: staged first, then unstaged, then untracked
     * Within each category, sort alphabetically by path
     */
    private sortChanges(changes: GitChange[]): GitChange[] {
        return [...changes].sort((a, b) => {
            // First by stage priority
            const stageDiff = STAGE_PRIORITY[a.stage] - STAGE_PRIORITY[b.stage];
            if (stageDiff !== 0) {
                return stageDiff;
            }

            // Then by path
            return a.path.localeCompare(b.path);
        });
    }

    /**
     * Get change counts for view description
     */
    getChangeCounts(): GitChangeCounts {
        if (!this.initialized) {
            return { staged: 0, unstaged: 0, untracked: 0, total: 0 };
        }

        const changes = this.gitService.getAllChanges();
        const counts = {
            staged: 0,
            unstaged: 0,
            untracked: 0,
            total: changes.length
        };

        for (const change of changes) {
            counts[change.stage]++;
        }

        return counts;
    }

    /**
     * Dispose of resources
     */
    dispose(): void {
        this._onDidChangeTreeData.dispose();
        this.gitService.dispose();
        for (const disposable of this.disposables) {
            disposable.dispose();
        }
        this.disposables = [];
    }
}
