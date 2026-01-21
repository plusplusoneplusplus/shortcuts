import * as vscode from 'vscode';
import { TaskManager } from './task-manager';
import { TasksTreeDataProvider } from './tree-data-provider';
import { TaskItem } from './task-item';
import { TaskDocumentItem } from './task-document-item';
import { TaskDocumentGroupItem } from './task-document-group-item';

/**
 * Command handlers for the Tasks Viewer
 */
export class TasksCommands {
    private tasksTreeView?: vscode.TreeView<vscode.TreeItem>;

    constructor(
        private taskManager: TaskManager,
        private treeDataProvider: TasksTreeDataProvider
    ) {}

    /**
     * Set the tree view for multi-selection support
     */
    setTreeView(treeView: vscode.TreeView<vscode.TreeItem>): void {
        this.tasksTreeView = treeView;
    }

    /**
     * Register all tasks viewer commands
     */
    registerCommands(context: vscode.ExtensionContext): vscode.Disposable[] {
        const disposables: vscode.Disposable[] = [];

        disposables.push(
            vscode.commands.registerCommand('tasksViewer.create', () => this.createTask()),
            vscode.commands.registerCommand('tasksViewer.createFeature', () => this.createFeature()),
            vscode.commands.registerCommand('tasksViewer.rename', (item: TaskItem) => this.renameTask(item)),
            vscode.commands.registerCommand('tasksViewer.delete', (item: TaskItem) => this.deleteTask(item)),
            vscode.commands.registerCommand('tasksViewer.archive', (item: TaskItem) => this.archiveTask(item)),
            vscode.commands.registerCommand('tasksViewer.unarchive', (item: TaskItem) => this.unarchiveTask(item)),
            vscode.commands.registerCommand('tasksViewer.filter', () => this.filterTasks()),
            vscode.commands.registerCommand('tasksViewer.clearFilter', () => this.clearFilter()),
            vscode.commands.registerCommand('tasksViewer.refresh', () => this.refreshTasks()),
            vscode.commands.registerCommand('tasksViewer.openFolder', () => this.openTasksFolder()),
            vscode.commands.registerCommand('tasksViewer.copyRelativePath', (item: TaskItem) => this.copyPath(item, false)),
            vscode.commands.registerCommand('tasksViewer.copyFullPath', (item: TaskItem) => this.copyPath(item, true))
        );

        return disposables;
    }

    /**
     * Create a new task
     */
    private async createTask(): Promise<void> {
        const name = await vscode.window.showInputBox({
            prompt: 'Enter task name',
            placeHolder: 'My new task',
            validateInput: (value) => {
                if (!value || value.trim().length === 0) {
                    return 'Task name cannot be empty';
                }
                if (value.includes('/') || value.includes('\\')) {
                    return 'Task name cannot contain path separators';
                }
                return null;
            }
        });

        if (!name) {
            return;
        }

        try {
            const filePath = await this.taskManager.createTask(name.trim());
            this.treeDataProvider.refresh();

            // Open the new task in Markdown Review Editor
            await vscode.commands.executeCommand(
                'vscode.openWith',
                vscode.Uri.file(filePath),
                'reviewEditorView'
            );
        } catch (error) {
            const err = error instanceof Error ? error : new Error('Unknown error');
            vscode.window.showErrorMessage(`Failed to create task: ${err.message}`);
        }
    }

    /**
     * Create a new feature folder
     */
    private async createFeature(): Promise<void> {
        const name = await vscode.window.showInputBox({
            prompt: 'Enter feature name',
            placeHolder: 'my-feature',
            validateInput: (value) => {
                if (!value || value.trim().length === 0) {
                    return 'Feature name cannot be empty';
                }
                if (value.includes('/') || value.includes('\\')) {
                    return 'Feature name cannot contain path separators';
                }
                return null;
            }
        });

        if (!name) {
            return;
        }

        try {
            const folderPath = await this.taskManager.createFeature(name.trim());
            this.treeDataProvider.refresh();

            // Reveal the folder in the file explorer
            await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(folderPath));
        } catch (error) {
            const err = error instanceof Error ? error : new Error('Unknown error');
            vscode.window.showErrorMessage(`Failed to create feature: ${err.message}`);
        }
    }

    /**
     * Rename a task
     */
    private async renameTask(item: TaskItem): Promise<void> {
        if (!item) {
            return;
        }

        const currentName = item.label as string;
        const newName = await vscode.window.showInputBox({
            prompt: 'Enter new task name',
            value: currentName,
            validateInput: (value) => {
                if (!value || value.trim().length === 0) {
                    return 'Task name cannot be empty';
                }
                if (value.includes('/') || value.includes('\\')) {
                    return 'Task name cannot contain path separators';
                }
                return null;
            }
        });

        if (!newName || newName === currentName) {
            return;
        }

        try {
            await this.taskManager.renameTask(item.filePath, newName.trim());
            this.treeDataProvider.refresh();
        } catch (error) {
            const err = error instanceof Error ? error : new Error('Unknown error');
            vscode.window.showErrorMessage(`Failed to rename task: ${err.message}`);
        }
    }

    /**
     * Delete a task
     */
    private async deleteTask(item: TaskItem): Promise<void> {
        if (!item) {
            return;
        }

        const taskName = item.label as string;
        const confirm = await vscode.window.showWarningMessage(
            `Are you sure you want to delete "${taskName}"?`,
            { modal: true },
            'Delete'
        );

        if (confirm !== 'Delete') {
            return;
        }

        try {
            await this.taskManager.deleteTask(item.filePath);
            this.treeDataProvider.refresh();
        } catch (error) {
            const err = error instanceof Error ? error : new Error('Unknown error');
            vscode.window.showErrorMessage(`Failed to delete task: ${err.message}`);
        }
    }

    /**
     * Archive a task
     */
    private async archiveTask(item: TaskItem): Promise<void> {
        if (!item) {
            return;
        }

        try {
            await this.taskManager.archiveTask(item.filePath);
            this.treeDataProvider.refresh();
            vscode.window.showInformationMessage(`Task "${item.label}" archived`);
        } catch (error) {
            const err = error instanceof Error ? error : new Error('Unknown error');
            vscode.window.showErrorMessage(`Failed to archive task: ${err.message}`);
        }
    }

    /**
     * Unarchive a task
     */
    private async unarchiveTask(item: TaskItem): Promise<void> {
        if (!item) {
            return;
        }

        try {
            await this.taskManager.unarchiveTask(item.filePath);
            this.treeDataProvider.refresh();
            vscode.window.showInformationMessage(`Task "${item.label}" unarchived`);
        } catch (error) {
            const err = error instanceof Error ? error : new Error('Unknown error');
            vscode.window.showErrorMessage(`Failed to unarchive task: ${err.message}`);
        }
    }

    /**
     * Filter tasks by name
     */
    private async filterTasks(): Promise<void> {
        const currentFilter = this.treeDataProvider.getFilter();
        const filter = await vscode.window.showInputBox({
            prompt: 'Filter tasks by name',
            value: currentFilter,
            placeHolder: 'Enter filter text'
        });

        if (filter === undefined) {
            return; // User cancelled
        }

        this.treeDataProvider.setFilter(filter);
    }

    /**
     * Clear the filter
     */
    private clearFilter(): void {
        this.treeDataProvider.clearFilter();
    }

    /**
     * Refresh the tasks view
     */
    private refreshTasks(): void {
        this.treeDataProvider.refresh();
    }

    /**
     * Open the tasks folder in the file explorer
     */
    private async openTasksFolder(): Promise<void> {
        const tasksFolder = this.taskManager.getTasksFolder();
        this.taskManager.ensureFoldersExist();

        const uri = vscode.Uri.file(tasksFolder);
        await vscode.commands.executeCommand('revealFileInOS', uri);
    }

    /**
     * Copy the path of a task to clipboard (supports multi-selection)
     * @param item The task item to copy the path from
     * @param absolute Whether to copy absolute or relative path
     */
    private async copyPath(item: TaskItem | TaskDocumentItem | TaskDocumentGroupItem, absolute: boolean): Promise<void> {
        try {
            // Get selected items from tree view for multi-selection support
            const selectedItems = this.tasksTreeView?.selection || [item];

            // Collect all paths from supported item types
            const paths: string[] = [];
            
            for (const selectedItem of selectedItems) {
                if (selectedItem instanceof TaskItem) {
                    paths.push(...this.getPathsFromItem(selectedItem.filePath, absolute));
                } else if (selectedItem instanceof TaskDocumentItem) {
                    paths.push(...this.getPathsFromItem(selectedItem.filePath, absolute));
                } else if (selectedItem instanceof TaskDocumentGroupItem) {
                    // Add all document paths from the group
                    for (const doc of selectedItem.documents) {
                        paths.push(...this.getPathsFromItem(doc.filePath, absolute));
                    }
                }
            }

            if (paths.length === 0) {
                vscode.window.showErrorMessage('No valid paths to copy');
                return;
            }

            // Copy to clipboard
            const textToCopy = paths.join('\n');
            await vscode.env.clipboard.writeText(textToCopy);

            // Show confirmation
            const pathType = absolute ? 'absolute' : 'relative';
            if (paths.length === 1) {
                vscode.window.showInformationMessage(`Copied ${pathType} path to clipboard`);
            } else {
                vscode.window.showInformationMessage(`Copied ${paths.length} ${pathType} paths to clipboard`);
            }
        } catch (error) {
            const err = error instanceof Error ? error : new Error('Unknown error');
            vscode.window.showErrorMessage(`Failed to copy path: ${err.message}`);
        }
    }

    /**
     * Helper to get paths from a file path
     */
    private getPathsFromItem(fsPath: string, absolute: boolean): string[] {
        if (!fsPath) {
            return [];
        }

        let pathToCopy: string;
        if (absolute) {
            pathToCopy = fsPath;
        } else {
            const uri = vscode.Uri.file(fsPath);
            const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);
            if (workspaceFolder) {
                pathToCopy = vscode.workspace.asRelativePath(uri, false);
            } else {
                pathToCopy = fsPath;
            }
        }
        return [pathToCopy];
    }
}
