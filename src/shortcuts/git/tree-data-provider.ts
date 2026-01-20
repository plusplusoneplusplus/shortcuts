import * as vscode from 'vscode';
import { DiffCommentsManager } from '../git-diff-comments/diff-comments-manager';
import {
    DiffCommentCategoryItem,
    DiffCommentFileItem,
    DiffCommentsTreeDataProvider
} from '../git-diff-comments/diff-comments-tree-provider';
import { getExtensionLogger, LogCategory } from '../shared';
import { BranchChangesSectionItem } from './branch-changes-section-item';
import { BranchItem, BranchStatus } from './branch-item';
import { BranchService, GitBranch } from './branch-service';
import { GitChangeItem } from './git-change-item';
import { GitCommitFileItem } from './git-commit-file-item';
import { GitCommitItem } from './git-commit-item';
import { GitCommitRangeItem } from './git-commit-range-item';
import { GitLogService } from './git-log-service';
import { GitRangeFileItem } from './git-range-file-item';
import { GitRangeService } from './git-range-service';
import { GitService } from './git-service';
import { LoadMoreItem } from './load-more-item';
import { LookedUpCommitItem } from './looked-up-commit-item';
import { SectionHeaderItem } from './section-header-item';
import { StageSectionItem } from './stage-section-item';
import { GitChange, GitChangeCounts, GitChangeStage, GitCommentCounts, GitCommit, GitCommitRange, GitViewCounts } from './types';

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
 * Storage key for persisting looked-up commits
 */
const LOOKED_UP_COMMITS_KEY = 'gitView.lookedUpCommits';

/**
 * Default maximum number of looked-up commits to keep
 */
const DEFAULT_MAX_LOOKED_UP_COMMITS = 10;

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
    private context?: vscode.ExtensionContext;

    // Commit pagination state
    private loadedCommits: GitCommit[] = [];
    private hasMoreCommits = false;

    // Section collapse state
    private changesCollapsed = false;
    private commitsCollapsed = false;

    // Diff comments integration
    private diffCommentsManager?: DiffCommentsManager;
    private diffCommentsTreeProvider?: DiffCommentsTreeDataProvider;

    // Looked-up commits list (empty = none shown)
    private lookedUpCommits: GitCommit[] = [];

    // Set of file paths currently being staged/unstaged (for loading state)
    private loadingFiles: Set<string> = new Set();

    // Commit range service and cached range
    private gitRangeService: GitRangeService;
    private cachedCommitRange: GitCommitRange | null = null;

    // Branch service and cached status
    private branchService: BranchService;
    private cachedBranchStatus: BranchStatus | null = null;

    constructor() {
        this.gitService = new GitService();
        this.gitLogService = new GitLogService();
        this.gitRangeService = new GitRangeService();
        this.branchService = new BranchService();
    }

    /**
     * Set the extension context for state persistence
     */
    setContext(context: vscode.ExtensionContext): void {
        this.context = context;
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
                this.reloadCommitRange();
                this.reloadBranchStatus();
                this.refresh();
            })
        );

        this.initialized = true;

        // Load initial commits
        await this.loadInitialCommits();

        // Load initial commit range
        this.reloadCommitRange();

        // Load initial branch status
        this.reloadBranchStatus();

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
     * Reload commits while preserving the current count
     * This ensures that when the git panel refreshes, the user's expanded commit list is maintained
     */
    private reloadCommits(): void {
        // Preserve the current number of loaded commits (minimum DEFAULT_COMMIT_DISPLAY_COUNT)
        const currentCount = Math.max(this.loadedCommits.length, DEFAULT_COMMIT_DISPLAY_COUNT);

        const repoRoot = this.gitService.getFirstRepositoryRoot();
        if (!repoRoot) {
            this.loadedCommits = [];
            this.hasMoreCommits = false;
            return;
        }

        const result = this.gitLogService.getCommits(repoRoot, {
            maxCount: currentCount,
            skip: 0
        });

        this.loadedCommits = result.commits;
        this.hasMoreCommits = result.hasMore;
    }

    /**
     * Reload the commit range for the current branch
     */
    private reloadCommitRange(): void {
        // Check if feature is enabled
        const config = vscode.workspace.getConfiguration('workspaceShortcuts.git.commitRange');
        const enabled = config.get<boolean>('enabled', true);
        
        if (!enabled) {
            this.cachedCommitRange = null;
            return;
        }

        const repoRoot = this.gitService.getFirstRepositoryRoot();
        if (!repoRoot) {
            this.cachedCommitRange = null;
            return;
        }

        this.cachedCommitRange = this.gitRangeService.detectCommitRange(repoRoot);
    }

    /**
     * Reload the branch status
     */
    private reloadBranchStatus(): void {
        const repoRoot = this.gitService.getFirstRepositoryRoot();
        if (!repoRoot) {
            this.cachedBranchStatus = null;
            return;
        }

        const hasChanges = this.branchService.hasUncommittedChanges(repoRoot);
        this.cachedBranchStatus = this.branchService.getBranchStatus(repoRoot, hasChanges);
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
                    return this.getStageSectionItems();
                } else if (element.sectionType === 'commits') {
                    return this.getCommitItems();
                } else if (element.sectionType === 'comments') {
                    return this.getCommentFileItems();
                }
            }

            // Branch changes section - return commit range items
            if (element instanceof BranchChangesSectionItem) {
                return this.getCommitRangeItems();
            }

            // Commit range item - return files changed in this range
            if (element instanceof GitCommitRangeItem) {
                return this.getCommitRangeFileItems(element.range);
            }

            // Stage section - return change items for that stage
            if (element instanceof StageSectionItem) {
                return this.getChangeItemsForStage(element.stageType);
            }

            // Commit item - return files changed in this commit
            if (element instanceof GitCommitItem) {
                return this.getCommitFileItems(element.commit);
            }

            // Looked-up commit item - return files changed in this commit
            if (element instanceof LookedUpCommitItem) {
                return this.getCommitFileItems(element.commit);
            }

            // Comment category item - return files for this category
            if (element instanceof DiffCommentCategoryItem) {
                return this.getCommentFilesForCategory(element);
            }

            // Comment file item - return comments for this file
            if (element instanceof DiffCommentFileItem) {
                return this.getCommentItems(element.filePath, element.category, element.commitHash);
            }

            // All other items have no children
            return [];
        } catch (error) {
            getExtensionLogger().error(LogCategory.GIT, 'Error getting git tree children', error instanceof Error ? error : undefined);
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

        const items: vscode.TreeItem[] = [];

        // Add branch item at the top if we have branch status
        if (this.cachedBranchStatus) {
            items.push(new BranchItem(this.cachedBranchStatus));
        }

        items.push(new SectionHeaderItem('changes', changeCounts.total, false));

        // Add Branch Changes section if there's a commit range
        if (this.cachedCommitRange) {
            items.push(new BranchChangesSectionItem(1));
        }

        items.push(new SectionHeaderItem('commits', commitCount, this.hasMoreCommits));

        // Only show comments section if there are comments
        if (commentCount > 0) {
            items.push(new SectionHeaderItem('comments', commentCount, false));
        }

        // Looked-up commits at the bottom (newest first)
        for (let i = 0; i < this.lookedUpCommits.length; i++) {
            items.push(new LookedUpCommitItem(this.lookedUpCommits[i], i));
        }

        return items;
    }

    /**
     * Get commit range items for the Branch Changes section
     */
    private getCommitRangeItems(): vscode.TreeItem[] {
        if (!this.cachedCommitRange) {
            return [];
        }
        return [new GitCommitRangeItem(this.cachedCommitRange)];
    }

    /**
     * Get file items for a commit range
     * @param range The commit range to get files for
     * @returns Array of file tree items
     */
    private getCommitRangeFileItems(range: GitCommitRange): vscode.TreeItem[] {
        return range.files.map(file => new GitRangeFileItem(file, range));
    }

    /**
     * Get stage section items (sub-headers for staged, unstaged, untracked)
     * This provides better visual separation between different change types
     */
    private getStageSectionItems(): vscode.TreeItem[] {
        const counts = this.getChangeCounts();
        const items: vscode.TreeItem[] = [];

        // Add sections only if they have items
        if (counts.staged > 0) {
            items.push(new StageSectionItem('staged', counts.staged));
        }
        if (counts.unstaged > 0) {
            items.push(new StageSectionItem('unstaged', counts.unstaged));
        }
        if (counts.untracked > 0) {
            items.push(new StageSectionItem('untracked', counts.untracked));
        }

        return items;
    }

    /**
     * Get change items for a specific stage
     */
    private getChangeItemsForStage(stage: GitChangeStage): vscode.TreeItem[] {
        const changes = this.gitService.getAllChanges();
        const filteredChanges = changes.filter(change => change.stage === stage);
        // Sort alphabetically by path within each stage
        filteredChanges.sort((a, b) => a.path.localeCompare(b.path));
        return filteredChanges.map(change => {
            const isLoading = this.loadingFiles.has(change.path);
            return new GitChangeItem(change, isLoading);
        });
    }

    /**
     * Get all change items (flat list, for backwards compatibility)
     */
    private getChangeItems(): vscode.TreeItem[] {
        const changes = this.gitService.getAllChanges();
        const sortedChanges = this.sortChanges(changes);
        return sortedChanges.map(change => {
            const isLoading = this.loadingFiles.has(change.path);
            return new GitChangeItem(change, isLoading);
        });
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
     * Get comment category items (Pending Changes, Committed groups)
     */
    private async getCommentFileItems(): Promise<vscode.TreeItem[]> {
        if (!this.diffCommentsTreeProvider) {
            return [];
        }
        return this.diffCommentsTreeProvider.getChildren();
    }

    /**
     * Get comment files for a specific category
     */
    private async getCommentFilesForCategory(categoryItem: DiffCommentCategoryItem): Promise<vscode.TreeItem[]> {
        if (!this.diffCommentsTreeProvider) {
            return [];
        }
        return this.diffCommentsTreeProvider.getChildren(categoryItem);
    }

    /**
     * Get comment items for a specific file
     */
    private async getCommentItems(
        filePath: string,
        category?: 'pending' | 'committed',
        commitHash?: string
    ): Promise<vscode.TreeItem[]> {
        if (!this.diffCommentsTreeProvider) {
            return [];
        }
        // Create a file item to get its children
        const comments = this.diffCommentsManager?.getCommentsForFile(filePath) || [];
        const openCount = comments.filter(c => c.status === 'open').length;
        const resolvedCount = comments.filter(c => c.status === 'resolved').length;
        const gitContext = comments[0]?.gitContext;
        const fileItem = new DiffCommentFileItem(filePath, openCount, resolvedCount, gitContext, category, commitHash);
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
     * Mark a file as loading (being staged/unstaged)
     * This will gray out the file in the tree view
     * @param filePath Absolute path to the file
     */
    setFileLoading(filePath: string): void {
        this.loadingFiles.add(filePath);
        this.refresh();
    }

    /**
     * Clear the loading state for a file
     * @param filePath Absolute path to the file
     */
    clearFileLoading(filePath: string): void {
        this.loadingFiles.delete(filePath);
        this.refresh();
    }

    /**
     * Check if a file is currently loading
     * @param filePath Absolute path to the file
     */
    isFileLoading(filePath: string): boolean {
        return this.loadingFiles.has(filePath);
    }

    /**
     * Clear all loading states
     */
    clearAllLoading(): void {
        this.loadingFiles.clear();
        this.refresh();
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
     * Get the maximum number of looked-up commits from settings
     */
    private getMaxLookedUpCommits(): number {
        const config = vscode.workspace.getConfiguration('workspaceShortcuts.gitView');
        return config.get<number>('maxLookedUpCommits', DEFAULT_MAX_LOOKED_UP_COMMITS);
    }

    /**
     * Add a looked-up commit to the list (at the beginning)
     * Removes duplicates and enforces the max limit
     * @param commit The commit to add
     */
    addLookedUpCommit(commit: GitCommit): void {
        // Remove if already exists (to move to front)
        this.lookedUpCommits = this.lookedUpCommits.filter(c => c.hash !== commit.hash);
        
        // Add to the beginning (most recent first)
        this.lookedUpCommits.unshift(commit);
        
        // Enforce max limit
        const maxCommits = this.getMaxLookedUpCommits();
        if (this.lookedUpCommits.length > maxCommits) {
            this.lookedUpCommits = this.lookedUpCommits.slice(0, maxCommits);
        }
        
        this.persistLookedUpCommits();
        this.refresh();
    }

    /**
     * Set the looked-up commit (for backwards compatibility - adds to list)
     * @param commit The commit to display, or null to clear all
     * @deprecated Use addLookedUpCommit() instead
     */
    setLookedUpCommit(commit: GitCommit | null): void {
        if (commit) {
            this.addLookedUpCommit(commit);
        } else {
            this.clearAllLookedUpCommits();
        }
    }

    /**
     * Get all looked-up commits
     */
    getLookedUpCommits(): GitCommit[] {
        return [...this.lookedUpCommits];
    }

    /**
     * Get the current looked-up commit (first one for backwards compatibility)
     * @deprecated Use getLookedUpCommits() instead
     */
    getLookedUpCommit(): GitCommit | null {
        return this.lookedUpCommits.length > 0 ? this.lookedUpCommits[0] : null;
    }

    /**
     * Clear a specific looked-up commit by index
     * @param index The index of the commit to clear
     */
    clearLookedUpCommitByIndex(index: number): void {
        if (index >= 0 && index < this.lookedUpCommits.length) {
            this.lookedUpCommits.splice(index, 1);
            this.persistLookedUpCommits();
            this.refresh();
        }
    }

    /**
     * Clear a specific looked-up commit by hash
     * @param hash The hash of the commit to clear
     */
    clearLookedUpCommitByHash(hash: string): void {
        const index = this.lookedUpCommits.findIndex(c => c.hash === hash);
        if (index >= 0) {
            this.clearLookedUpCommitByIndex(index);
        }
    }

    /**
     * Clear all looked-up commits
     */
    clearAllLookedUpCommits(): void {
        this.lookedUpCommits = [];
        this.persistLookedUpCommits();
        this.refresh();
    }

    /**
     * Clear the looked-up commit (clears all for backwards compatibility)
     * @deprecated Use clearAllLookedUpCommits() or clearLookedUpCommitByIndex() instead
     */
    clearLookedUpCommit(): void {
        this.clearAllLookedUpCommits();
    }

    /**
     * Persist the looked-up commits to workspace state
     */
    private persistLookedUpCommits(): void {
        if (!this.context) {
            return;
        }
        if (this.lookedUpCommits.length > 0) {
            // Store the commit hashes and repo roots for restoration
            const data = this.lookedUpCommits.map(commit => ({
                hash: commit.hash,
                repositoryRoot: commit.repositoryRoot
            }));
            this.context.workspaceState.update(LOOKED_UP_COMMITS_KEY, data);
        } else {
            this.context.workspaceState.update(LOOKED_UP_COMMITS_KEY, undefined);
        }
    }

    /**
     * Restore the looked-up commits from workspace state
     * Should be called after initialization
     */
    async restoreLookedUpCommits(): Promise<void> {
        if (!this.context) {
            return;
        }
        
        // Try to restore from new format first
        const storedList = this.context.workspaceState.get<Array<{ hash: string; repositoryRoot: string }>>(LOOKED_UP_COMMITS_KEY);
        if (storedList && Array.isArray(storedList)) {
            const restoredCommits: GitCommit[] = [];
            for (const stored of storedList) {
                const commit = this.gitLogService.getCommit(stored.repositoryRoot, stored.hash);
                if (commit) {
                    restoredCommits.push(commit);
                }
            }
            if (restoredCommits.length > 0) {
                this.lookedUpCommits = restoredCommits;
                this.refresh();
            } else {
                // No valid commits, clear the stored state
                this.context.workspaceState.update(LOOKED_UP_COMMITS_KEY, undefined);
            }
            return;
        }
    }

    /**
     * Restore the looked-up commit from workspace state (deprecated, calls restoreLookedUpCommits)
     * @deprecated Use restoreLookedUpCommits() instead
     */
    async restoreLookedUpCommit(): Promise<void> {
        return this.restoreLookedUpCommits();
    }

    /**
     * Show the commit lookup quick pick UI
     * Optimized to show dialog immediately and load branches asynchronously
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

        // Default suggestions - show immediately
        const defaultItems: vscode.QuickPickItem[] = [
            { label: 'HEAD~1', description: 'Previous commit' },
            { label: 'HEAD~2', description: '2 commits ago' },
            { label: 'HEAD~5', description: '5 commits ago' },
        ];

        // Show dialog immediately with default items
        quickPick.items = defaultItems;
        quickPick.show();

        // Track branch items for use in callbacks
        let branchItems: vscode.QuickPickItem[] = [];

        // Load branches asynchronously in the background
        this.gitLogService.getBranchesAsync(repoRoot).then(branches => {
            branchItems = branches.map(branch => ({
                label: branch,
                description: 'branch'
            }));
            // Update items if quickPick is still visible and no custom value entered
            if (!quickPick.value) {
                quickPick.items = [...defaultItems, ...branchItems];
            }
        });

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
    }

    /**
     * Get the current commit range (if any)
     */
    getCommitRange(): GitCommitRange | null {
        return this.cachedCommitRange;
    }

    /**
     * Get the git range service
     */
    getGitRangeService(): GitRangeService {
        return this.gitRangeService;
    }

    /**
     * Refresh the commit range
     */
    refreshCommitRange(): void {
        this.reloadCommitRange();
        this.refresh();
    }

    /**
     * Get the branch service
     */
    getBranchService(): BranchService {
        return this.branchService;
    }

    /**
     * Get the current branch status
     */
    getBranchStatus(): BranchStatus | null {
        return this.cachedBranchStatus;
    }

    /**
     * Refresh the branch status
     */
    refreshBranchStatus(): void {
        this.reloadBranchStatus();
        this.refresh();
    }

    /**
     * Get all branches (local and remote)
     */
    getAllBranches(): { local: GitBranch[]; remote: GitBranch[] } {
        const repoRoot = this.gitService.getFirstRepositoryRoot();
        if (!repoRoot) {
            return { local: [], remote: [] };
        }
        return this.branchService.getAllBranches(repoRoot);
    }

    /**
     * Get local branch count
     * @param searchPattern Optional search pattern
     */
    getLocalBranchCount(searchPattern?: string): number {
        const repoRoot = this.gitService.getFirstRepositoryRoot();
        if (!repoRoot) {
            return 0;
        }
        return this.branchService.getLocalBranchCount(repoRoot, searchPattern);
    }

    /**
     * Get remote branch count
     * @param searchPattern Optional search pattern
     */
    getRemoteBranchCount(searchPattern?: string): number {
        const repoRoot = this.gitService.getFirstRepositoryRoot();
        if (!repoRoot) {
            return 0;
        }
        return this.branchService.getRemoteBranchCount(repoRoot, searchPattern);
    }

    /**
     * Get local branches with pagination and search support
     * @param options Pagination and search options
     */
    getLocalBranchesPaginated(options?: { limit?: number; offset?: number; searchPattern?: string }): {
        branches: GitBranch[];
        totalCount: number;
        hasMore: boolean;
    } {
        const repoRoot = this.gitService.getFirstRepositoryRoot();
        if (!repoRoot) {
            return { branches: [], totalCount: 0, hasMore: false };
        }
        return this.branchService.getLocalBranchesPaginated(repoRoot, options);
    }

    /**
     * Get remote branches with pagination and search support
     * @param options Pagination and search options
     */
    getRemoteBranchesPaginated(options?: { limit?: number; offset?: number; searchPattern?: string }): {
        branches: GitBranch[];
        totalCount: number;
        hasMore: boolean;
    } {
        const repoRoot = this.gitService.getFirstRepositoryRoot();
        if (!repoRoot) {
            return { branches: [], totalCount: 0, hasMore: false };
        }
        return this.branchService.getRemoteBranchesPaginated(repoRoot, options);
    }

    /**
     * Search branches by name
     * @param searchPattern Search pattern
     * @param limit Maximum results to return
     */
    searchBranches(searchPattern: string, limit?: number): { local: GitBranch[]; remote: GitBranch[] } {
        const repoRoot = this.gitService.getFirstRepositoryRoot();
        if (!repoRoot) {
            return { local: [], remote: [] };
        }
        return this.branchService.searchBranches(repoRoot, searchPattern, limit);
    }

    /**
     * Switch to a branch with handling for uncommitted changes
     * @param branchName Branch to switch to
     * @param options Options: stashFirst - stash before switch, force - force checkout
     */
    async switchBranch(
        branchName: string,
        options?: { stashFirst?: boolean; force?: boolean }
    ): Promise<{ success: boolean; error?: string; stashed?: boolean }> {
        const repoRoot = this.gitService.getFirstRepositoryRoot();
        if (!repoRoot) {
            return { success: false, error: 'No git repository found' };
        }

        // Check for uncommitted changes
        const hasChanges = this.branchService.hasUncommittedChanges(repoRoot);

        if (hasChanges && options?.stashFirst) {
            const stashResult = await this.branchService.stashChanges(
                repoRoot,
                `Auto-stash before switching to ${branchName}`
            );
            if (!stashResult.success) {
                return { success: false, error: `Failed to stash changes: ${stashResult.error}` };
            }

            const switchResult = await this.branchService.switchBranch(repoRoot, branchName);
            if (!switchResult.success) {
                // Try to restore stash on failure
                await this.branchService.popStash(repoRoot);
                return { success: false, error: switchResult.error };
            }

            this.reloadBranchStatus();
            this.reloadCommits();
            this.reloadCommitRange();
            this.refresh();
            return { success: true, stashed: true };
        }

        const result = await this.branchService.switchBranch(repoRoot, branchName, {
            force: options?.force
        });

        if (result.success) {
            this.reloadBranchStatus();
            this.reloadCommits();
            this.reloadCommitRange();
            this.refresh();
        }

        return result;
    }

    /**
     * Create a new branch
     * @param branchName New branch name
     * @param checkout Whether to checkout the new branch
     */
    async createBranch(branchName: string, checkout: boolean = true): Promise<{ success: boolean; error?: string }> {
        const repoRoot = this.gitService.getFirstRepositoryRoot();
        if (!repoRoot) {
            return { success: false, error: 'No git repository found' };
        }

        const result = await this.branchService.createBranch(repoRoot, branchName, checkout);
        if (result.success && checkout) {
            this.reloadBranchStatus();
            this.refresh();
        }

        return result;
    }

    /**
     * Delete a branch
     * @param branchName Branch to delete
     * @param force Force delete even if not merged
     */
    async deleteBranch(branchName: string, force: boolean = false): Promise<{ success: boolean; error?: string }> {
        const repoRoot = this.gitService.getFirstRepositoryRoot();
        if (!repoRoot) {
            return { success: false, error: 'No git repository found' };
        }

        return this.branchService.deleteBranch(repoRoot, branchName, force);
    }

    /**
     * Rename a branch
     * @param oldName Current branch name
     * @param newName New branch name
     */
    async renameBranch(oldName: string, newName: string): Promise<{ success: boolean; error?: string }> {
        const repoRoot = this.gitService.getFirstRepositoryRoot();
        if (!repoRoot) {
            return { success: false, error: 'No git repository found' };
        }

        const result = await this.branchService.renameBranch(repoRoot, oldName, newName);
        if (result.success) {
            this.reloadBranchStatus();
            this.refresh();
        }

        return result;
    }

    /**
     * Merge a branch into the current branch
     * @param branchName Branch to merge
     */
    async mergeBranch(branchName: string): Promise<{ success: boolean; error?: string }> {
        const repoRoot = this.gitService.getFirstRepositoryRoot();
        if (!repoRoot) {
            return { success: false, error: 'No git repository found' };
        }

        const result = await this.branchService.mergeBranch(repoRoot, branchName);
        if (result.success) {
            this.reloadCommits();
            this.refresh();
        }

        return result;
    }

    /**
     * Push to remote
     * @param setUpstream Set upstream tracking
     */
    async push(setUpstream: boolean = false): Promise<{ success: boolean; error?: string }> {
        const repoRoot = this.gitService.getFirstRepositoryRoot();
        if (!repoRoot) {
            return { success: false, error: 'No git repository found' };
        }

        const result = await this.branchService.push(repoRoot, setUpstream);
        if (result.success) {
            this.reloadBranchStatus();
            this.refresh();
        }

        return result;
    }

    /**
     * Pull from remote
     * @param rebase Use rebase instead of merge
     */
    async pull(rebase: boolean = false): Promise<{ success: boolean; error?: string }> {
        const repoRoot = this.gitService.getFirstRepositoryRoot();
        if (!repoRoot) {
            return { success: false, error: 'No git repository found' };
        }

        const result = await this.branchService.pull(repoRoot, rebase);
        if (result.success) {
            this.reloadBranchStatus();
            this.reloadCommits();
            this.refresh();
        }

        return result;
    }

    /**
     * Fetch from remote
     */
    async fetch(): Promise<{ success: boolean; error?: string }> {
        const repoRoot = this.gitService.getFirstRepositoryRoot();
        if (!repoRoot) {
            return { success: false, error: 'No git repository found' };
        }

        const result = await this.branchService.fetch(repoRoot);
        if (result.success) {
            this.reloadBranchStatus();
            this.refresh();
        }

        return result;
    }

    /**
     * Dispose of resources
     */
    dispose(): void {
        this._onDidChangeTreeData.dispose();
        this.gitService.dispose();
        this.gitLogService.dispose();
        this.gitRangeService.dispose();
        this.branchService.dispose();
        for (const disposable of this.disposables) {
            disposable.dispose();
        }
        this.disposables = [];
    }
}

