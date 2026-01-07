import * as vscode from 'vscode';
import { getExtensionLogger, LogCategory } from '../shared';
import { TaskManager } from './task-manager';
import { TaskItem } from './task-item';
import { TaskGroupItem } from './task-group-item';
import { Task } from './types';

/**
 * Tree data provider for the Tasks Viewer
 * Displays task markdown files from the configured tasks folder
 * Groups tasks into Active/Archived sections when Show Archived is enabled
 */
export class TasksTreeDataProvider implements vscode.TreeDataProvider<vscode.TreeItem>, vscode.Disposable {
    private _onDidChangeTreeData: vscode.EventEmitter<vscode.TreeItem | undefined | null | void> =
        new vscode.EventEmitter<vscode.TreeItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<vscode.TreeItem | undefined | null | void> =
        this._onDidChangeTreeData.event;

    private filterText: string = '';
    private cachedTasks: Task[] = [];
    private tasksByGroup: Map<'active' | 'archived', Task[]> = new Map();

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
                // Return root level - either groups or flat list
                return await this.getRootItems();
            } else if (element instanceof TaskGroupItem) {
                // Return tasks for this group
                return this.getGroupTasks(element.groupType);
            } else {
                // Tasks have no children
                return [];
            }
        } catch (error) {
            const err = error instanceof Error ? error : new Error('Unknown error');
            getExtensionLogger().error(LogCategory.TASKS, 'Error getting tasks', err);
            vscode.window.showErrorMessage(`Error loading tasks: ${err.message}`);
            return [];
        }
    }

    /**
     * Get the parent of an element
     */
    getParent(element: vscode.TreeItem): vscode.ProviderResult<vscode.TreeItem> {
        // TaskGroupItems have no parent (they are root items)
        if (element instanceof TaskGroupItem) {
            return undefined;
        }
        // TaskItems might have a TaskGroupItem parent when showArchived is enabled
        // But since we don't store the parent reference, return undefined
        return undefined;
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
     * Get root items - either groups or flat list based on settings
     */
    private async getRootItems(): Promise<vscode.TreeItem[]> {
        const settings = this.taskManager.getSettings();
        let tasks = await this.taskManager.getTasks();

        // Apply filter
        if (this.filterText) {
            tasks = tasks.filter(task =>
                task.name.toLowerCase().includes(this.filterText)
            );
        }

        // Cache tasks for group children
        this.cachedTasks = tasks;

        // When showArchived is enabled, use grouped view
        if (settings.showArchived) {
            return this.getGroupedRootItems(tasks);
        }

        // Otherwise, return flat list (only active tasks)
        return this.getFlatTaskItems(tasks);
    }

    /**
     * Get grouped root items (Active Tasks / Archived Tasks headers)
     */
    private getGroupedRootItems(tasks: Task[]): vscode.TreeItem[] {
        const activeTasks = tasks.filter(t => !t.isArchived);
        const archivedTasks = tasks.filter(t => t.isArchived);

        // Cache tasks by group for getChildren
        this.tasksByGroup.set('active', this.sortTasks(activeTasks));
        this.tasksByGroup.set('archived', this.sortTasks(archivedTasks));

        const items: vscode.TreeItem[] = [];

        // Always show Active Tasks group (even if empty)
        items.push(new TaskGroupItem('active', activeTasks.length));

        // Always show Archived Tasks group (even if empty)
        items.push(new TaskGroupItem('archived', archivedTasks.length));

        return items;
    }

    /**
     * Get flat task items (when showArchived is disabled)
     */
    private getFlatTaskItems(tasks: Task[]): TaskItem[] {
        // Sort tasks
        tasks = this.sortTasks(tasks);
        return tasks.map(task => new TaskItem(task));
    }

    /**
     * Get tasks for a specific group
     */
    private getGroupTasks(groupType: 'active' | 'archived'): TaskItem[] {
        const tasks = this.tasksByGroup.get(groupType) || [];
        return tasks.map(task => new TaskItem(task));
    }

    /**
     * Sort tasks according to settings
     */
    private sortTasks(tasks: Task[]): Task[] {
        const settings = this.taskManager.getSettings();

        return [...tasks].sort((a, b) => {
            if (settings.sortBy === 'name') {
                return a.name.localeCompare(b.name);
            } else {
                // modifiedDate - newest first
                return b.modifiedTime.getTime() - a.modifiedTime.getTime();
            }
        });
    }
}
