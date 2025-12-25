/**
 * Base Tree Data Provider for Comments
 * 
 * Provides shared functionality for both markdown and diff comments tree views:
 * - Event handling for tree refresh
 * - Show/hide resolved comments toggle
 * - Status filtering
 * - Common count methods
 */

import * as vscode from 'vscode';
import { BaseCommentStatus } from '../markdown-comments/base-types';
import { CommentsManagerBase } from '../markdown-comments/comments-manager-base';

/**
 * Abstract base class for comments tree data providers.
 * Provides common functionality for managing tree views of comments.
 */
export abstract class CommentsTreeProviderBase<
    TManager extends CommentsManagerBase<any, any, any, any, any, any>
> implements vscode.TreeDataProvider<vscode.TreeItem>, vscode.Disposable {
    
    protected readonly _onDidChangeTreeData = new vscode.EventEmitter<vscode.TreeItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<vscode.TreeItem | undefined | null | void> = this._onDidChangeTreeData.event;

    protected showResolved: boolean = true;
    protected filterStatus?: BaseCommentStatus;
    protected disposables: vscode.Disposable[] = [];

    constructor(protected readonly commentsManager: TManager) {
        // Listen for comment changes
        this.disposables.push(
            commentsManager.onDidChangeComments(() => {
                this.refresh();
            })
        );
    }

    /**
     * Refresh the tree view
     */
    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    /**
     * Toggle showing resolved comments
     */
    toggleShowResolved(): void {
        this.showResolved = !this.showResolved;
        this.refresh();
    }

    /**
     * Set whether to show resolved comments
     */
    setShowResolved(show: boolean): void {
        this.showResolved = show;
        this.refresh();
    }

    /**
     * Get whether resolved comments are shown
     */
    getShowResolved(): boolean {
        return this.showResolved;
    }

    /**
     * Set status filter
     */
    setFilterStatus(status?: BaseCommentStatus): void {
        this.filterStatus = status;
        this.refresh();
    }

    /**
     * Get tree item representation
     */
    getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
        return element;
    }

    /**
     * Get the total number of open comments
     */
    getOpenCommentCount(): number {
        return this.commentsManager.getOpenCommentCount();
    }

    /**
     * Get the total number of resolved comments
     */
    getResolvedCommentCount(): number {
        return this.commentsManager.getResolvedCommentCount();
    }

    /**
     * Filter comments based on current settings
     */
    protected filterComments<T extends { status: BaseCommentStatus }>(comments: T[]): T[] {
        let filtered = comments;
        
        if (!this.showResolved) {
            filtered = filtered.filter(c => c.status !== 'resolved');
        }
        
        if (this.filterStatus) {
            filtered = filtered.filter(c => c.status === this.filterStatus);
        }
        
        return filtered;
    }

    /**
     * Count open and resolved comments
     */
    protected countByStatus<T extends { status: BaseCommentStatus }>(
        comments: T[]
    ): { openCount: number; resolvedCount: number } {
        return {
            openCount: comments.filter(c => c.status === 'open').length,
            resolvedCount: comments.filter(c => c.status === 'resolved')!.length
        };
    }

    /**
     * Dispose of resources
     */
    dispose(): void {
        this._onDidChangeTreeData.dispose();
        for (const disposable of this.disposables) {
            disposable.dispose();
        }
    }

    // Abstract methods that subclasses must implement

    /**
     * Get children of an element
     */
    abstract getChildren(element?: vscode.TreeItem): Promise<vscode.TreeItem[]>;

    /**
     * Get parent of an element (for reveal support)
     */
    abstract getParent(element: vscode.TreeItem): vscode.TreeItem | undefined;
}

