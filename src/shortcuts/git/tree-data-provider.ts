import * as vscode from 'vscode';
import {
    DiffCommentFileItem,
    DiffCommentItem,
    DiffCommentsTreeDataProvider
} from '../git-diff-comments/diff-comments-tree-provider';
import { DiffCommentsManager } from '../git-diff-comments/diff-comments-manager';
import { GitChangeItem } from './git-change-item';
import { GitCommitFileItem } from './git-commit-file-item';
import { GitCommitItem } from './git-commit-item';
import { GitLogService } from './git-log-service';
import { GitService } from './git-service';
import { LoadMoreItem } from './load-more-item';
import { LookedUpCommitItem } from './looked-up-commit-item';
import { SectionHeaderItem } from './section-header-item';
import { GitChange, GitChangeCounts, GitChangeStage, GitCommentCounts, GitCommit, GitViewCounts } from './types';

/**
 * Stage priority for sorting (lower = higher priority)
 */
const STAGE_PRIORITY: Record<GitChangeStage, number> = {
    'staged': 0,
    'unstaged': 1,
    'untracked': 2
};

/**
 * Default number of commits to display in the view
 */
const DEFAULT_COMMIT_DISPLAY_COUNT = 5;

/**
 * Number of commits to load per "load more" action
 */
const DEFAULT_COMMIT_LOAD_COUNT = 20;

/**
 * Tree data provider for the unified Git view
 * Displays both changes and commits in a sectioned tree structure
 */
export class GitTreeDataProvider
    implements vscode.TreeDataProvider<vscode.TreeItem>, vscode.Disposable {

    private readonly _onDidChangeTreeData = new vscode.EventEmitter<void | vscode.TreeItem | null>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    private gitService: GitService;
    private gitLogService: GitLogService;
    private disposables: vscode.Disposable[] = [];
    private initialized = false;

    // Commit pagination state
    private loadedCommits: GitCommit[] = [];
    private hasMoreCommits = false;

    // Section collapse state
    private changesCollapsed = false;
    private commitsCollapsed = false;

    // Diff comments integration
    private diffCommentsManager?: DiffCommentsManager;
    private diffCommentsTreeProvider?: DiffCommentsTreeDataProvider;

    // Looked-up commit (null = none shown)
    private lookedUpCommit: GitCommit | null = null;

    constructor() {
        this.gitService = new GitService();
        this.gitLogService = new GitLogService();
    }

    /**
     * Set the diff comments manager for displaying comments in the tree
     */
    setDiffCommentsManager(manager: DiffCommentsManager): void {
        this.diffCommentsManager = manager;
        this.diffCommentsTreeProvider = new DiffCommentsTreeDataProvider(manager);
        
        // Listen for comment changes to refresh the tree
        this.disposables.push(
            manager.onDidChangeComments(() => {
                this.refresh();
            })
        );
    }

    /**
     * Get the diff comments tree provider for external use
     */
    getDiffCommentsTreeProvider(): DiffCommentsTreeDataProvider | undefined {
        return this.diffCommentsTreeProvider;
    }

    /**
     * Initialize the git services
     * @returns true if git extension is available
     */
    async initialize(): Promise<boolean> {
        const gitResult = await this.gitService.initialize();
        if (!gitResult) {
            return false;
        }

        const logResult = await this.gitLogService.initialize();
        if (!logResult) {
            console.log('Git log service initialization failed, commits will be unavailable');
        }

        // Listen to git changes
        this.disposables.push(
            this.gitService.onDidChangeChanges(() => {
                // When changes occur, also reload commits (HEAD might have changed)
                this.reloadCommits();
                this.refresh();
            })
        );

        this.initialized = true;

        // Load initial commits
        await this.loadInitialCommits();

        return true;
    }

    /**
     * Load the initial set of commits
     */
    private async loadInitialCommits(): Promise<void> {
        const repoRoot = this.gitService.getFirstRepositoryRoot();
        if (!repoRoot) {
            this.loadedCommits = [];
            this.hasMoreCommits = false;
            return;
        }

        const result = this.gitLogService.getCommits(repoRoot, {
            maxCount: DEFAULT_COMMIT_DISPLAY_COUNT,
            skip: 0
        });

        this.loadedCommits = result.commits;
        this.hasMoreCommits = result.hasMore;
    }

    /**
     * Reload commits from scratch (e.g., after a new commit)
     */
    private reloadCommits(): void {
        // Reset to initial state and reload
        this.loadedCommits = [];
        this.hasMoreCommits = false;
        this.loadInitialCommits();
    }

    /**
     * Load more commits (pagination)
     * @param count Number of additional commits to load
     */
    async loadMoreCommits(count: number = DEFAULT_COMMIT_LOAD_COUNT): Promise<void> {
        const repoRoot = this.gitService.getFirstRepositoryRoot();
        if (!repoRoot) {
            return;
        }

        const result = this.gitLogService.getCommits(repoRoot, {
            maxCount: count,
            skip: this.loadedCommits.length
        });

        this.loadedCommits.push(...result.commits);
        this.hasMoreCommits = result.hasMore;

        this.refresh();
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
     * Get children for an element
     */
    async getChildren(element?: vscode.TreeItem): Promise<vscode.TreeItem[]> {
        // Not initialized or no git extension
        if (!this.initialized) {
            return [];
        }

        try {
            // Root level - return section headers
            if (!element) {
                return this.getRootItems();
            }

            // Section header - return section contents
            if (element instanceof SectionHeaderItem) {
                if (element.sectionType === 'changes') {
                    return this.getChangeItems();
                } else if (element.sectionType === 'commits') {
                    return this.getCommitItems();
                } else if (element.sectionType === 'comments') {
                    return this.getCommentFileItems();
                }
            }

            // Commit item - return files changed in this commit
            if (element instanceof GitCommitItem) {
                return this.getCommitFileItems(element.commit);
            }

            // Looked-up commit item - return files changed in this commit
            if (element instanceof LookedUpCommitItem) {
                return this.getCommitFileItems(element.commit);
            }

            // Comment file item - return comments for this file
            if (element instanceof DiffCommentFileItem) {
                return this.getCommentItems(element.filePath);
            }

            // All other items have no children
            return [];
        } catch (error) {
            console.error('Error getting git tree children:', error);
            return [];
        }
    }

    /**
     * Get root level items (section headers)
     */
    private getRootItems(): vscode.TreeItem[] {
        const changeCounts = this.getChangeCounts();
        const commitCount = this.loadedCommits.length;
        const commentCount = this.getCommentCount();

        const items: vscode.TreeItem[] = [
            new SectionHeaderItem('changes', changeCounts.total, false),
            new SectionHeaderItem('commits', commitCount, this.hasMoreCommits)
        ];

        // Only show comments section if there are comments
        if (commentCount > 0) {
            items.push(new SectionHeaderItem('comments', commentCount, false));
        }

        // Looked-up commit at the bottom
        if (this.lookedUpCommit) {
            items.push(new LookedUpCommitItem(this.lookedUpCommit));
        }

        return items;
    }

    /**
     * Get change items for the Changes section
     */
    private getChangeItems(): vscode.TreeItem[] {
        const changes = this.gitService.getAllChanges();
        const sortedChanges = this.sortChanges(changes);
        return sortedChanges.map(change => new GitChangeItem(change));
    }

    /**
     * Get commit items for the Commits section
     */
    private getCommitItems(): vscode.TreeItem[] {
        const items: vscode.TreeItem[] = this.loadedCommits.map(
            commit => new GitCommitItem(commit)
        );

        // Add "Load More" button if there are more commits
        if (this.hasMoreCommits) {
            items.push(new LoadMoreItem(DEFAULT_COMMIT_LOAD_COUNT));
        }

        return items;
    }

    /**
     * Get file items for a commit
     * @param commit The commit to get files for
     * @returns Array of file tree items
     */
    private getCommitFileItems(commit: GitCommit): vscode.TreeItem[] {
        const files = this.gitLogService.getCommitFiles(
            commit.repositoryRoot,
            commit.hash
        );
        return files.map(file => new GitCommitFileItem(file));
    }

    /**
     * Get comment file items (files with comments)
     */
    private async getCommentFileItems(): Promise<vscode.TreeItem[]> {
        if (!this.diffCommentsTreeProvider) {
            return [];
        }
        return this.diffCommentsTreeProvider.getChildren();
    }

    /**
     * Get comment items for a specific file
     */
    private async getCommentItems(filePath: string): Promise<vscode.TreeItem[]> {
        if (!this.diffCommentsTreeProvider) {
            return [];
        }
        // Create a temporary file item to get its children
        const comments = this.diffCommentsManager?.getCommentsForFile(filePath) || [];
        const openCount = comments.filter(c => c.status === 'open').length;
        const resolvedCount = comments.filter(c => c.status === 'resolved').length;
        const gitContext = comments[0]?.gitContext;
        const fileItem = new DiffCommentFileItem(filePath, openCount, resolvedCount, gitContext);
        return this.diffCommentsTreeProvider.getChildren(fileItem);
    }

    /**
     * Get the total number of diff comments
     */
    getCommentCount(): number {
        return this.diffCommentsTreeProvider?.getTotalCommentCount() ?? 0;
    }

    /**
     * Get the number of open diff comments
     */
    getOpenCommentCount(): number {
        return this.diffCommentsTreeProvider?.getOpenCommentCount() ?? 0;
    }

    /**
     * Get the number of resolved diff comments
     */
    getResolvedCommentCount(): number {
        return this.diffCommentsTreeProvider?.getResolvedCommentCount() ?? 0;
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
     * Get comment counts for display
     */
    getCommentCounts(): GitCommentCounts {
        return {
            open: this.getOpenCommentCount(),
            resolved: this.getResolvedCommentCount(),
            total: this.getCommentCount()
        };
    }

    /**
     * Get combined counts for the view description
     */
    getViewCounts(): GitViewCounts {
        return {
            changes: this.getChangeCounts(),
            commitCount: this.loadedCommits.length,
            hasMoreCommits: this.hasMoreCommits,
            comments: this.getCommentCounts()
        };
    }

    /**
     * Get the number of loaded commits
     */
    getCommitCount(): number {
        return this.loadedCommits.length;
    }

    /**
     * Check if there are more commits to load
     */
    getHasMoreCommits(): boolean {
        return this.hasMoreCommits;
    }

    /**
     * Copy a commit hash to the clipboard
     * @param hash The commit hash to copy
     */
    async copyCommitHash(hash: string): Promise<void> {
        await vscode.env.clipboard.writeText(hash);
        vscode.window.showInformationMessage(`Copied commit hash: ${hash}`);
    }

    /**
     * Set the looked-up commit (replaces any previous one)
     * @param commit The commit to display, or null to clear
     */
    setLookedUpCommit(commit: GitCommit | null): void {
        this.lookedUpCommit = commit;
        this.refresh();
    }

    /**
     * Get the current looked-up commit
     */
    getLookedUpCommit(): GitCommit | null {
        return this.lookedUpCommit;
    }

    /**
     * Clear the looked-up commit
     */
    clearLookedUpCommit(): void {
        this.lookedUpCommit = null;
        this.refresh();
    }

    /**
     * Show the commit lookup quick pick UI
     */
    async showCommitLookup(): Promise<void> {
        const repoRoot = this.gitService.getFirstRepositoryRoot();
        if (!repoRoot) {
            vscode.window.showWarningMessage('No git repository found');
            return;
        }

        const quickPick = vscode.window.createQuickPick();
        quickPick.placeholder = 'Enter commit hash, branch, tag, or ref (e.g., HEAD~3)';
        quickPick.title = 'Lookup Commit';

        // Default suggestions
        const defaultItems: vscode.QuickPickItem[] = [
            { label: 'HEAD~1', description: 'Previous commit' },
            { label: 'HEAD~2', description: '2 commits ago' },
            { label: 'HEAD~5', description: '5 commits ago' },
        ];

        // Get branch suggestions
        const branches = this.gitLogService.getBranches(repoRoot);
        const branchItems: vscode.QuickPickItem[] = branches.map(branch => ({
            label: branch,
            description: 'branch'
        }));

        quickPick.items = [...defaultItems, ...branchItems];

        quickPick.onDidChangeValue(value => {
            if (value && !quickPick.items.some(i => i.label === value)) {
                quickPick.items = [
                    { label: value, description: 'Press Enter to lookup' },
                    ...defaultItems,
                    ...branchItems
                ];
            }
        });

        quickPick.onDidAccept(async () => {
            const selected = quickPick.selectedItems[0]?.label || quickPick.value;
            quickPick.hide();

            if (!selected) {
                return;
            }

            // Validate and resolve the ref
            const resolvedHash = this.gitLogService.validateRef(repoRoot, selected);
            if (!resolvedHash) {
                vscode.window.showErrorMessage(`Invalid commit reference: ${selected}`);
                return;
            }

            // Get full commit info
            const commit = this.gitLogService.getCommit(repoRoot, resolvedHash);
            if (!commit) {
                vscode.window.showErrorMessage(`Could not load commit: ${selected}`);
                return;
            }

            this.setLookedUpCommit(commit);
        });

        quickPick.onDidHide(() => {
            quickPick.dispose();
        });

        quickPick.show();
    }

    /**
     * Dispose of resources
     */
    dispose(): void {
        this._onDidChangeTreeData.dispose();
        this.gitService.dispose();
        this.gitLogService.dispose();
        for (const disposable of this.disposables) {
            disposable.dispose();
        }
        this.disposables = [];
    }
}

