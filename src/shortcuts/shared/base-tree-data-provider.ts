import * as vscode from 'vscode';
import { getExtensionLogger, LogCategory } from './extension-logger';
import { NotificationManager } from '../notification-manager';

/**
 * Base class for all tree data providers in the extension.
 * Provides common functionality: EventEmitter setup, disposal, error handling.
 */
export abstract class BaseTreeDataProvider<T extends vscode.TreeItem> 
    implements vscode.TreeDataProvider<T>, vscode.Disposable {
    
    private readonly _onDidChangeTreeData = new vscode.EventEmitter<T | undefined | null | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
    
    protected disposables: vscode.Disposable[] = [];
    
    constructor() {
        this.disposables.push(this._onDidChangeTreeData);
    }
    
    /**
     * Triggers a refresh of the tree view.
     * @param element Optional element to refresh (undefined refreshes entire tree)
     */
    refresh(element?: T): void {
        this._onDidChangeTreeData.fire(element);
    }
    
    /**
     * Gets children with error handling wrapper.
     * Subclasses should implement getChildrenImpl instead.
     */
    async getChildren(element?: T): Promise<T[]> {
        try {
            return await this.getChildrenImpl(element);
        } catch (error) {
            return this.handleError('getChildren', error);
        }
    }
    
    /**
     * Implementation of getChildren logic.
     * Subclasses must implement this method.
     */
    protected abstract getChildrenImpl(element?: T): Promise<T[]>;
    
    /**
     * Handles errors that occur in tree operations.
     * Logs error and shows user notification.
     * @returns Empty array as fallback
     */
    protected handleError(context: string, error: unknown): T[] {
        const err = error instanceof Error ? error : new Error('Unknown error');
        getExtensionLogger().error(
            this.getLogCategory(), 
            `${context} error in ${this.constructor.name}`, 
            err
        );
        NotificationManager.showError(`Error: ${err.message}`);
        return [];
    }
    
    /**
     * Gets the log category for this provider.
     * Subclasses can override to use specific categories.
     */
    protected getLogCategory(): LogCategory {
        return LogCategory.EXTENSION;
    }
    
    /**
     * Disposes all resources held by this provider.
     */
    dispose(): void {
        this.disposables.forEach(d => d.dispose());
        this.disposables = [];
    }
    
    /**
     * Gets the tree item representation for an element.
     * Subclasses must implement this method.
     */
    abstract getTreeItem(element: T): vscode.TreeItem | Thenable<vscode.TreeItem>;
}
