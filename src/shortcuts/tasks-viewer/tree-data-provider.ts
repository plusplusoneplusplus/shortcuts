import * as vscode from 'vscode';
import { TaskManager } from './task-manager';
import { TaskItem } from './task-item';
import { Task } from './types';

/**
 * Tree data provider for the Tasks Viewer
 * Displays task markdown files from the configured tasks folder
 */
export class TasksTreeDataProvider implements vscode.TreeDataProvider<vscode.TreeItem>, vscode.Disposable {
    private _onDidChangeTreeData: vscode.EventEmitter<vscode.TreeItem | undefined | null | void> =
        new vscode.EventEmitter<vscode.TreeItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<vscode.TreeItem | undefined | null | void> =
        this._onDidChangeTreeData.event;

    private filterText: string = '';

    constructor(private taskManager: TaskManager) {}

    /**
     * Get the tree item representation of an element
     */
    getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
        return element;
    }

    /**
     * Get the children of an element or root elements if no element is provided
     */
    async getChildren(element?: vscode.TreeItem): Promise<vscode.TreeItem[]> {
        try {
            if (!element) {
                // Return root level tasks
                return await this.getTasks();
            } else {
                // Tasks have no children
                return [];
            }
        } catch (error) {
            const err = error instanceof Error ? error : new Error('Unknown error');
            console.error('Error getting tasks:', err);
            vscode.window.showErrorMessage(`Error loading tasks: ${err.message}`);
            return [];
        }
    }

    /**
     * Refresh the tree view
     */
    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    /**
     * Set filter text
     */
    setFilter(text: string): void {
        this.filterText = text.toLowerCase();
        this.refresh();
    }

    /**
     * Clear the filter
     */
    clearFilter(): void {
        this.filterText = '';
        this.refresh();
    }

    /**
     * Get current filter text
     */
    getFilter(): string {
        return this.filterText;
    }

    /**
     * Get the task manager instance
     */
    getTaskManager(): TaskManager {
        return this.taskManager;
    }

    /**
     * Dispose of resources
     */
    dispose(): void {
        this._onDidChangeTreeData.dispose();
    }

    /**
     * Get tasks and create tree items
     */
    private async getTasks(): Promise<TaskItem[]> {
        let tasks = await this.taskManager.getTasks();

        // Apply filter
        if (this.filterText) {
            tasks = tasks.filter(task =>
                task.name.toLowerCase().includes(this.filterText)
            );
        }

        // Sort tasks
        tasks = this.sortTasks(tasks);

        return tasks.map(task => new TaskItem(task));
    }

    /**
     * Sort tasks according to settings
     */
    private sortTasks(tasks: Task[]): Task[] {
        const settings = this.taskManager.getSettings();

        return [...tasks].sort((a, b) => {
            // Archived tasks always at bottom
            if (a.isArchived !== b.isArchived) {
                return a.isArchived ? 1 : -1;
            }

            if (settings.sortBy === 'name') {
                return a.name.localeCompare(b.name);
            } else {
                // modifiedDate - newest first
                return b.modifiedTime.getTime() - a.modifiedTime.getTime();
            }
        });
    }
}
