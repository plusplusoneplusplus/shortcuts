import * as vscode from 'vscode';
import { TaskManager } from './task-manager';
import { TasksTreeDataProvider } from './tree-data-provider';
import { TaskItem } from './task-item';
import { TaskDocumentItem } from './task-document-item';
import { TaskDocumentGroupItem } from './task-document-group-item';
import { TaskFolderItem } from './task-folder-item';

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
            vscode.commands.registerCommand('tasksViewer.createSubfolder', (item: TaskFolderItem) => this.createSubfolder(item)),
            vscode.commands.registerCommand('tasksViewer.rename', (item: TaskItem) => this.renameTask(item)),
            vscode.commands.registerCommand('tasksViewer.renameFolder', (item: TaskFolderItem) => this.renameFolder(item)),
            vscode.commands.registerCommand('tasksViewer.renameDocumentGroup', (item: TaskDocumentGroupItem) => this.renameDocumentGroup(item)),
            vscode.commands.registerCommand('tasksViewer.renameDocument', (item: TaskDocumentItem) => this.renameDocument(item)),
            vscode.commands.registerCommand('tasksViewer.delete', (item: TaskItem) => this.deleteTask(item)),
            vscode.commands.registerCommand('tasksViewer.deleteFolder', (item: TaskFolderItem) => this.deleteFolder(item)),
            vscode.commands.registerCommand('tasksViewer.archive', (item: TaskItem) => this.archiveTask(item)),
            vscode.commands.registerCommand('tasksViewer.unarchive', (item: TaskItem) => this.unarchiveTask(item)),
            vscode.commands.registerCommand('tasksViewer.archiveDocument', (item: TaskDocumentItem) => this.archiveDocument(item)),
            vscode.commands.registerCommand('tasksViewer.unarchiveDocument', (item: TaskDocumentItem) => this.unarchiveDocument(item)),
            vscode.commands.registerCommand('tasksViewer.archiveDocumentGroup', (item: TaskDocumentGroupItem) => this.archiveDocumentGroup(item)),
            vscode.commands.registerCommand('tasksViewer.unarchiveDocumentGroup', (item: TaskDocumentGroupItem) => this.unarchiveDocumentGroup(item)),
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
            await this.taskManager.createFeature(name.trim());
            this.treeDataProvider.refresh();
        } catch (error) {
            const err = error instanceof Error ? error : new Error('Unknown error');
            vscode.window.showErrorMessage(`Failed to create feature: ${err.message}`);
        }
    }

    /**
     * Create a new subfolder inside an existing folder
     */
    private async createSubfolder(item: TaskFolderItem): Promise<void> {
        if (!item || !item.folder) {
            return;
        }

        const name = await vscode.window.showInputBox({
            prompt: 'Enter subfolder name',
            placeHolder: 'my-subfolder',
            validateInput: (value) => {
                if (!value || value.trim().length === 0) {
                    return 'Subfolder name cannot be empty';
                }
                if (value.includes('/') || value.includes('\\')) {
                    return 'Subfolder name cannot contain path separators';
                }
                return null;
            }
        });

        if (!name) {
            return;
        }

        try {
            await this.taskManager.createSubfolder(item.folder.folderPath, name.trim());
            this.treeDataProvider.refresh();
        } catch (error) {
            const err = error instanceof Error ? error : new Error('Unknown error');
            vscode.window.showErrorMessage(`Failed to create subfolder: ${err.message}`);
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
     * Rename a folder
     */
    private async renameFolder(item: TaskFolderItem): Promise<void> {
        if (!item || !item.folder) {
            return;
        }

        const currentName = item.folder.name;
        const newName = await vscode.window.showInputBox({
            prompt: 'Enter new folder name',
            value: currentName,
            validateInput: (value) => {
                if (!value || value.trim().length === 0) {
                    return 'Folder name cannot be empty';
                }
                if (value.includes('/') || value.includes('\\')) {
                    return 'Folder name cannot contain path separators';
                }
                return null;
            }
        });

        if (!newName || newName === currentName) {
            return;
        }

        try {
            await this.taskManager.renameFolder(item.folder.folderPath, newName.trim());
            this.treeDataProvider.refresh();
        } catch (error) {
            const err = error instanceof Error ? error : new Error('Unknown error');
            vscode.window.showErrorMessage(`Failed to rename folder: ${err.message}`);
        }
    }

    /**
     * Rename a document group
     */
    private async renameDocumentGroup(item: TaskDocumentGroupItem): Promise<void> {
        if (!item) {
            return;
        }

        const currentName = item.baseName;
        const newName = await vscode.window.showInputBox({
            prompt: 'Enter new name for document group',
            value: currentName,
            validateInput: (value) => {
                if (!value || value.trim().length === 0) {
                    return 'Name cannot be empty';
                }
                if (value.includes('/') || value.includes('\\')) {
                    return 'Name cannot contain path separators';
                }
                return null;
            }
        });

        if (!newName || newName === currentName) {
            return;
        }

        try {
            await this.taskManager.renameDocumentGroup(item.folderPath, currentName, newName.trim());
            this.treeDataProvider.refresh();
        } catch (error) {
            const err = error instanceof Error ? error : new Error('Unknown error');
            vscode.window.showErrorMessage(`Failed to rename document group: ${err.message}`);
        }
    }

    /**
     * Rename a single document
     */
    private async renameDocument(item: TaskDocumentItem): Promise<void> {
        if (!item) {
            return;
        }

        const currentName = item.baseName;
        const newName = await vscode.window.showInputBox({
            prompt: 'Enter new name for document',
            value: currentName,
            validateInput: (value) => {
                if (!value || value.trim().length === 0) {
                    return 'Name cannot be empty';
                }
                if (value.includes('/') || value.includes('\\')) {
                    return 'Name cannot contain path separators';
                }
                return null;
            }
        });

        if (!newName || newName === currentName) {
            return;
        }

        try {
            await this.taskManager.renameDocument(item.filePath, newName.trim());
            this.treeDataProvider.refresh();
        } catch (error) {
            const err = error instanceof Error ? error : new Error('Unknown error');
            vscode.window.showErrorMessage(`Failed to rename document: ${err.message}`);
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
     * Delete a folder and all its contents
     */
    private async deleteFolder(item: TaskFolderItem): Promise<void> {
        if (!item || !item.folder) {
            return;
        }

        const folderName = item.folder.name;
        const confirm = await vscode.window.showWarningMessage(
            `Are you sure you want to delete folder "${folderName}" and all its contents? This action cannot be undone.`,
            { modal: true },
            'Delete'
        );

        if (confirm !== 'Delete') {
            return;
        }

        try {
            await this.taskManager.deleteFolder(item.folder.folderPath);
            this.treeDataProvider.refresh();
        } catch (error) {
            const err = error instanceof Error ? error : new Error('Unknown error');
            vscode.window.showErrorMessage(`Failed to delete folder: ${err.message}`);
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
     * Archive a document
     */
    private async archiveDocument(item: TaskDocumentItem): Promise<void> {
        if (!item) {
            return;
        }

        try {
            await this.taskManager.archiveDocument(item.filePath);
            this.treeDataProvider.refresh();
            vscode.window.showInformationMessage(`Document "${item.baseName}" archived`);
        } catch (error) {
            const err = error instanceof Error ? error : new Error('Unknown error');
            vscode.window.showErrorMessage(`Failed to archive document: ${err.message}`);
        }
    }

    /**
     * Unarchive a document
     */
    private async unarchiveDocument(item: TaskDocumentItem): Promise<void> {
        if (!item) {
            return;
        }

        try {
            await this.taskManager.unarchiveDocument(item.filePath);
            this.treeDataProvider.refresh();
            vscode.window.showInformationMessage(`Document "${item.baseName}" unarchived`);
        } catch (error) {
            const err = error instanceof Error ? error : new Error('Unknown error');
            vscode.window.showErrorMessage(`Failed to unarchive document: ${err.message}`);
        }
    }

    /**
     * Archive a document group
     */
    private async archiveDocumentGroup(item: TaskDocumentGroupItem): Promise<void> {
        if (!item) {
            return;
        }

        try {
            const filePaths = item.documents.map(d => d.filePath);
            await this.taskManager.archiveDocumentGroup(filePaths);
            this.treeDataProvider.refresh();
            vscode.window.showInformationMessage(`Document group "${item.baseName}" archived (${filePaths.length} docs)`);
        } catch (error) {
            const err = error instanceof Error ? error : new Error('Unknown error');
            vscode.window.showErrorMessage(`Failed to archive document group: ${err.message}`);
        }
    }

    /**
     * Unarchive a document group
     */
    private async unarchiveDocumentGroup(item: TaskDocumentGroupItem): Promise<void> {
        if (!item) {
            return;
        }

        try {
            const filePaths = item.documents.map(d => d.filePath);
            await this.taskManager.unarchiveDocumentGroup(filePaths);
            this.treeDataProvider.refresh();
            vscode.window.showInformationMessage(`Document group "${item.baseName}" unarchived (${filePaths.length} docs)`);
        } catch (error) {
            const err = error instanceof Error ? error : new Error('Unknown error');
            vscode.window.showErrorMessage(`Failed to unarchive document group: ${err.message}`);
        }
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
