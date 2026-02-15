import * as vscode from 'vscode';
import { safeExists } from '../shared';
import { Task, TasksViewerSettings, TaskSortBy, TaskDocument, TaskDocumentGroup, TaskFolder, DiscoverySettings, DiscoveryDefaultScope, TaskStatus } from './types';
import { RELATED_ITEMS_FILENAME } from './related-items-loader';
import { RelatedItem } from './types';
import { TaskManager as CoreTaskManager } from '@plusplusoneplusplus/pipeline-core';

// Re-export updateTaskStatus from the core package
export { updateTaskStatus } from '@plusplusoneplusplus/pipeline-core';

/**
 * Thin VS Code adapter around the shared CoreTaskManager.
 *
 * All pure file-system / logic operations are delegated to the core class.
 * Only VS Code-specific integration stays here: settings via
 * vscode.workspace.getConfiguration, file watching via
 * vscode.FileSystemWatcher, and vscode.Disposable lifecycle.
 */
export class TaskManager implements vscode.Disposable {
    private readonly workspaceRoot: string;
    private fileWatcher?: vscode.FileSystemWatcher;
    private archiveWatcher?: vscode.FileSystemWatcher;
    private relatedItemsWatcher?: vscode.FileSystemWatcher;
    private debounceTimer?: NodeJS.Timeout;
    private refreshCallback?: () => void;

    constructor(workspaceRoot: string) {
        this.workspaceRoot = workspaceRoot;
    }

    /** Create a CoreTaskManager with current VS Code settings. */
    private createCore(): CoreTaskManager {
        return new CoreTaskManager({
            workspaceRoot: this.workspaceRoot,
            settings: this.getSettings(),
        });
    }

    // ========================================================================
    // Delegated methods — path helpers
    // ========================================================================

    getTasksFolder(): string { return this.createCore().getTasksFolder(); }
    getArchiveFolder(): string { return this.createCore().getArchiveFolder(); }
    ensureFoldersExist(): void { this.createCore().ensureFoldersExist(); }
    getWorkspaceRoot(): string { return this.workspaceRoot; }

    // ========================================================================
    // Delegated methods — scanning / querying
    // ========================================================================

    async getTasks(): Promise<Task[]> { return this.createCore().getTasks(); }
    async getTaskDocuments(): Promise<TaskDocument[]> { return this.createCore().getTaskDocuments(); }
    async getTaskDocumentGroups(): Promise<{ groups: TaskDocumentGroup[]; singles: TaskDocument[] }> { return this.createCore().getTaskDocumentGroups(); }
    async getTaskFolderHierarchy(): Promise<TaskFolder> { return this.createCore().getTaskFolderHierarchy(); }
    async getFeatureFolders(): Promise<Array<{ path: string; displayName: string; relativePath: string }>> { return this.createCore().getFeatureFolders(); }

    // ========================================================================
    // Delegated methods — CRUD
    // ========================================================================

    async createTask(name: string): Promise<string> { return this.createCore().createTask(name); }
    async createFeature(name: string): Promise<string> { return this.createCore().createFeature(name); }
    async createSubfolder(parentFolderPath: string, name: string): Promise<string> { return this.createCore().createSubfolder(parentFolderPath, name); }
    async renameTask(oldPath: string, newName: string): Promise<string> { return this.createCore().renameTask(oldPath, newName); }
    async renameFolder(folderPath: string, newName: string): Promise<string> { return this.createCore().renameFolder(folderPath, newName); }
    async renameDocumentGroup(folderPath: string, oldBaseName: string, newBaseName: string): Promise<string[]> { return this.createCore().renameDocumentGroup(folderPath, oldBaseName, newBaseName); }
    async renameDocument(oldPath: string, newBaseName: string): Promise<string> { return this.createCore().renameDocument(oldPath, newBaseName); }
    async deleteTask(filePath: string): Promise<void> { return this.createCore().deleteTask(filePath); }
    async deleteFolder(folderPath: string): Promise<void> { return this.createCore().deleteFolder(folderPath); }

    // ========================================================================
    // Delegated methods — archive / unarchive
    // ========================================================================

    async archiveTask(filePath: string, preserveStructure: boolean = false): Promise<string> { return this.createCore().archiveTask(filePath, preserveStructure); }
    async unarchiveTask(filePath: string): Promise<string> { return this.createCore().unarchiveTask(filePath); }
    async archiveDocument(filePath: string, preserveStructure: boolean = false): Promise<string> { return this.createCore().archiveDocument(filePath, preserveStructure); }
    async unarchiveDocument(filePath: string): Promise<string> { return this.createCore().unarchiveDocument(filePath); }
    async archiveDocumentGroup(filePaths: string[], preserveStructure: boolean = false): Promise<string[]> { return this.createCore().archiveDocumentGroup(filePaths, preserveStructure); }
    async unarchiveDocumentGroup(filePaths: string[]): Promise<string[]> { return this.createCore().unarchiveDocumentGroup(filePaths); }

    // ========================================================================
    // Delegated methods — move
    // ========================================================================

    async moveTask(sourcePath: string, targetFolder: string): Promise<string> { return this.createCore().moveTask(sourcePath, targetFolder); }
    async moveFolder(sourceFolderPath: string, targetParentFolder: string): Promise<string> { return this.createCore().moveFolder(sourceFolderPath, targetParentFolder); }
    async moveTaskGroup(sourcePaths: string[], targetFolder: string): Promise<string[]> { return this.createCore().moveTaskGroup(sourcePaths, targetFolder); }

    // ========================================================================
    // Delegated methods — import / external
    // ========================================================================

    async importTask(sourcePath: string, newName?: string): Promise<string> { return this.createCore().importTask(sourcePath, newName); }
    async moveExternalTask(sourcePath: string, targetFolder?: string, newName?: string): Promise<string> { return this.createCore().moveExternalTask(sourcePath, targetFolder, newName); }

    // ========================================================================
    // Delegated methods — query helpers
    // ========================================================================

    taskExistsInFolder(name: string, folder?: string): boolean { return this.createCore().taskExistsInFolder(name, folder); }
    taskExists(name: string): boolean { return this.createCore().taskExists(name); }

    // ========================================================================
    // Delegated methods — filename utilities
    // ========================================================================

    parseFileName(fileName: string): { baseName: string; docType?: string } { return this.createCore().parseFileName(fileName); }
    sanitizeFileName(name: string): string { return this.createCore().sanitizeFileName(name); }

    // ========================================================================
    // Delegated methods — related items
    // ========================================================================

    async addRelatedItems(folderPath: string, items: RelatedItem[], description?: string): Promise<void> { return this.createCore().addRelatedItems(folderPath, items, description); }

    // ========================================================================
    // VS Code-specific: settings (reads from vscode.workspace)
    // ========================================================================

    getSettings(): TasksViewerSettings {
        const config = vscode.workspace.getConfiguration('workspaceShortcuts.tasksViewer');
        const discoveryConfig = vscode.workspace.getConfiguration('workspaceShortcuts.tasksViewer.discovery');
        
        const defaultScope: DiscoveryDefaultScope = discoveryConfig.get<DiscoveryDefaultScope>('defaultScope', {
            includeSourceFiles: true,
            includeDocs: true,
            includeConfigFiles: true,
            includeGitHistory: true,
            maxCommits: 50
        });

        const discovery: DiscoverySettings = {
            enabled: discoveryConfig.get<boolean>('enabled', true),
            defaultScope,
            showRelatedInTree: discoveryConfig.get<boolean>('showRelatedInTree', true),
            groupByCategory: discoveryConfig.get<boolean>('groupByCategory', true)
        };

        return {
            enabled: config.get<boolean>('enabled', true),
            folderPath: config.get<string>('folderPath', '.vscode/tasks'),
            showArchived: config.get<boolean>('showArchived', false),
            showFuture: config.get<boolean>('showFuture', true),
            sortBy: config.get<TaskSortBy>('sortBy', 'modifiedDate'),
            groupRelatedDocuments: config.get<boolean>('groupRelatedDocuments', true),
            discovery
        };
    }

    // ========================================================================
    // VS Code-specific: file watchers
    // ========================================================================

    watchTasksFolder(callback: () => void): void {
        this.refreshCallback = callback;
        this.disposeWatchers();

        const tasksFolder = this.getTasksFolder();

        // Create watcher for main tasks folder (recursive pattern)
        if (safeExists(tasksFolder)) {
            const pattern = new vscode.RelativePattern(tasksFolder, '**/*.md');
            this.fileWatcher = vscode.workspace.createFileSystemWatcher(pattern);

            this.fileWatcher.onDidChange(() => this.debounceRefresh());
            this.fileWatcher.onDidCreate(() => this.debounceRefresh());
            this.fileWatcher.onDidDelete(() => this.debounceRefresh());

            // Watch for related.yaml files
            const relatedPattern = new vscode.RelativePattern(tasksFolder, `**/${RELATED_ITEMS_FILENAME}`);
            this.relatedItemsWatcher = vscode.workspace.createFileSystemWatcher(relatedPattern);

            this.relatedItemsWatcher.onDidChange(() => this.debounceRefresh());
            this.relatedItemsWatcher.onDidCreate(() => this.debounceRefresh());
            this.relatedItemsWatcher.onDidDelete(() => this.debounceRefresh());
        }

        // Create watcher for archive folder
        const archiveFolder = this.getArchiveFolder();
        if (safeExists(archiveFolder)) {
            const archivePattern = new vscode.RelativePattern(archiveFolder, '**/*.md');
            this.archiveWatcher = vscode.workspace.createFileSystemWatcher(archivePattern);

            this.archiveWatcher.onDidChange(() => this.debounceRefresh());
            this.archiveWatcher.onDidCreate(() => this.debounceRefresh());
            this.archiveWatcher.onDidDelete(() => this.debounceRefresh());
        }
    }

    // ========================================================================
    // VS Code-specific: debounce & dispose
    // ========================================================================

    private debounceRefresh(): void {
        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
        }

        this.debounceTimer = setTimeout(() => {
            this.refreshCallback?.();
        }, 300);
    }

    private disposeWatchers(): void {
        this.fileWatcher?.dispose();
        this.fileWatcher = undefined;
        this.archiveWatcher?.dispose();
        this.archiveWatcher = undefined;
        this.relatedItemsWatcher?.dispose();
        this.relatedItemsWatcher = undefined;

        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
            this.debounceTimer = undefined;
        }
    }

    dispose(): void {
        this.disposeWatchers();
    }
}
