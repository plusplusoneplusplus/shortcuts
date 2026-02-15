/**
 * TaskManager Facade
 *
 * Composes task-scanner, task-operations, task-parser, and related-items-loader
 * into a single entry point with the same public API as the VS Code TaskManager,
 * but free of all VS Code dependencies.
 *
 * Consumers pass settings at construction time instead of reading from
 * vscode.workspace.getConfiguration(). File watching is left to the consumer;
 * an optional onRefresh callback is stored for internal use (e.g., after batch
 * operations).
 */

import * as path from 'path';
import { ensureDirectoryExists, safeExists, safeReadDir, safeStats } from '../utils';
import {
    Task,
    TaskDocument,
    TaskDocumentGroup,
    TaskFolder,
    TasksViewerSettings,
    TaskStatus,
    RelatedItem,
} from './types';
import {
    parseFileName,
    sanitizeFileName,
    updateTaskStatus as coreUpdateTaskStatus,
} from './task-parser';
import {
    scanTasksRecursively,
    scanDocumentsRecursively,
    groupTaskDocuments,
    buildTaskFolderHierarchy,
} from './task-scanner';
import {
    loadRelatedItems,
    mergeRelatedItems,
} from './related-items-loader';
import * as taskOps from './task-operations';

// ============================================================================
// Options
// ============================================================================

export interface TaskManagerOptions {
    workspaceRoot: string;
    settings: TasksViewerSettings;
    onRefresh?: () => void;
}

// ============================================================================
// TaskManager
// ============================================================================

export class TaskManager {
    private readonly workspaceRoot: string;
    private readonly settings: TasksViewerSettings;
    private readonly onRefresh?: () => void;

    constructor(options: TaskManagerOptions) {
        this.workspaceRoot = options.workspaceRoot;
        this.settings = options.settings;
        this.onRefresh = options.onRefresh;
    }

    // ========================================================================
    // Path helpers
    // ========================================================================

    getTasksFolder(): string {
        const folderPath = this.settings.folderPath || '.vscode/tasks';
        return path.isAbsolute(folderPath)
            ? folderPath
            : path.join(this.workspaceRoot, folderPath);
    }

    getArchiveFolder(): string {
        return path.join(this.getTasksFolder(), 'archive');
    }

    ensureFoldersExist(): void {
        ensureDirectoryExists(this.getTasksFolder());
        ensureDirectoryExists(this.getArchiveFolder());
    }

    getWorkspaceRoot(): string {
        return this.workspaceRoot;
    }

    // ========================================================================
    // Scanning / querying
    // ========================================================================

    async getTasks(): Promise<Task[]> {
        const tasks: Task[] = [];
        const tasksFolder = this.getTasksFolder();

        const activeTasks = scanTasksRecursively(tasksFolder, '', false);
        tasks.push(...activeTasks);

        if (this.settings.showArchived) {
            const archiveFolder = this.getArchiveFolder();
            const archivedTasks = scanTasksRecursively(archiveFolder, '', true);
            tasks.push(...archivedTasks);
        }

        return tasks;
    }

    async getTaskDocuments(): Promise<TaskDocument[]> {
        const documents: TaskDocument[] = [];
        const tasksFolder = this.getTasksFolder();

        const activeDocuments = scanDocumentsRecursively(tasksFolder, '', false);
        documents.push(...activeDocuments);

        if (this.settings.showArchived) {
            const archiveFolder = this.getArchiveFolder();
            const archivedDocuments = scanDocumentsRecursively(archiveFolder, '', true);
            documents.push(...archivedDocuments);
        }

        return documents;
    }

    async getTaskDocumentGroups(): Promise<{ groups: TaskDocumentGroup[]; singles: TaskDocument[] }> {
        const documents = await this.getTaskDocuments();
        return groupTaskDocuments(documents);
    }

    async getTaskFolderHierarchy(): Promise<TaskFolder> {
        const documents = await this.getTaskDocuments();

        const { root, folderMap } = buildTaskFolderHierarchy(
            this.getTasksFolder(),
            documents,
            this.settings.showArchived,
            this.settings.showArchived ? this.getArchiveFolder() : undefined
        );

        // Load related items for all folders if discovery is enabled
        if (this.settings.discovery.enabled && this.settings.discovery.showRelatedInTree) {
            await this.loadRelatedItemsForFolders(folderMap);
        }

        return root;
    }

    async getFeatureFolders(): Promise<Array<{ path: string; displayName: string; relativePath: string }>> {
        const folders: Array<{ path: string; displayName: string; relativePath: string }> = [];
        const tasksFolder = this.getTasksFolder();

        await this.collectFeatureFoldersRecursively(tasksFolder, '', folders);

        return folders;
    }

    // ========================================================================
    // CRUD — Create
    // ========================================================================

    async createTask(name: string): Promise<string> {
        this.ensureFoldersExist();
        return taskOps.createTask(this.getTasksFolder(), name);
    }

    async createFeature(name: string): Promise<string> {
        this.ensureFoldersExist();
        return taskOps.createFeature(this.getTasksFolder(), name);
    }

    async createSubfolder(parentFolderPath: string, name: string): Promise<string> {
        return taskOps.createSubfolder(parentFolderPath, name);
    }

    // ========================================================================
    // CRUD — Rename
    // ========================================================================

    async renameTask(oldPath: string, newName: string): Promise<string> {
        return taskOps.renameTask(oldPath, newName);
    }

    async renameFolder(folderPath: string, newName: string): Promise<string> {
        return taskOps.renameFolder(folderPath, newName);
    }

    async renameDocumentGroup(folderPath: string, oldBaseName: string, newBaseName: string): Promise<string[]> {
        return taskOps.renameDocumentGroup(folderPath, oldBaseName, newBaseName);
    }

    async renameDocument(oldPath: string, newBaseName: string): Promise<string> {
        return taskOps.renameDocument(oldPath, newBaseName);
    }

    // ========================================================================
    // CRUD — Delete
    // ========================================================================

    async deleteTask(filePath: string): Promise<void> {
        return taskOps.deleteTask(filePath);
    }

    async deleteFolder(folderPath: string): Promise<void> {
        return taskOps.deleteFolder(folderPath);
    }

    // ========================================================================
    // Archive / Unarchive
    // ========================================================================

    async archiveTask(filePath: string, preserveStructure: boolean = false): Promise<string> {
        this.ensureFoldersExist();
        return taskOps.archiveTask(filePath, this.getTasksFolder(), this.getArchiveFolder(), preserveStructure);
    }

    async unarchiveTask(filePath: string): Promise<string> {
        return taskOps.unarchiveTask(filePath, this.getTasksFolder());
    }

    async archiveDocument(filePath: string, preserveStructure: boolean = false): Promise<string> {
        return this.archiveTask(filePath, preserveStructure);
    }

    async unarchiveDocument(filePath: string): Promise<string> {
        return this.unarchiveTask(filePath);
    }

    async archiveDocumentGroup(filePaths: string[], preserveStructure: boolean = false): Promise<string[]> {
        this.ensureFoldersExist();
        return taskOps.archiveDocumentGroup(filePaths, this.getTasksFolder(), this.getArchiveFolder(), preserveStructure);
    }

    async unarchiveDocumentGroup(filePaths: string[]): Promise<string[]> {
        return taskOps.unarchiveDocumentGroup(filePaths, this.getTasksFolder());
    }

    // ========================================================================
    // Move
    // ========================================================================

    async moveTask(sourcePath: string, targetFolder: string): Promise<string> {
        return taskOps.moveTask(sourcePath, targetFolder);
    }

    async moveFolder(sourceFolderPath: string, targetParentFolder: string): Promise<string> {
        return taskOps.moveFolder(sourceFolderPath, targetParentFolder);
    }

    async moveTaskGroup(sourcePaths: string[], targetFolder: string): Promise<string[]> {
        return taskOps.moveTaskGroup(sourcePaths, targetFolder);
    }

    // ========================================================================
    // Import / External
    // ========================================================================

    async importTask(sourcePath: string, newName?: string): Promise<string> {
        this.ensureFoldersExist();
        return taskOps.importTask(sourcePath, this.getTasksFolder(), newName);
    }

    async moveExternalTask(sourcePath: string, targetFolder?: string, newName?: string): Promise<string> {
        this.ensureFoldersExist();
        return taskOps.moveExternalTask(sourcePath, this.getTasksFolder(), targetFolder, newName);
    }

    // ========================================================================
    // Query helpers
    // ========================================================================

    taskExists(name: string): boolean {
        return taskOps.taskExists(name, this.getTasksFolder());
    }

    taskExistsInFolder(name: string, folder?: string): boolean {
        return taskOps.taskExistsInFolder(name, this.getTasksFolder(), folder);
    }

    // ========================================================================
    // Filename utilities
    // ========================================================================

    sanitizeFileName(name: string): string {
        return sanitizeFileName(name);
    }

    parseFileName(fileName: string): { baseName: string; docType?: string } {
        return parseFileName(fileName);
    }

    // ========================================================================
    // Frontmatter
    // ========================================================================

    async updateTaskStatus(filePath: string, status: TaskStatus): Promise<void> {
        return coreUpdateTaskStatus(filePath, status);
    }

    // ========================================================================
    // Related items
    // ========================================================================

    async addRelatedItems(folderPath: string, items: RelatedItem[], description?: string): Promise<void> {
        await mergeRelatedItems(folderPath, items, description);
    }

    // ========================================================================
    // Lifecycle
    // ========================================================================

    dispose(): void {
        // No internal timers to clear in the shared version.
        // Consumer is responsible for file-watcher disposal.
    }

    // ========================================================================
    // Private helpers
    // ========================================================================

    private async loadRelatedItemsForFolders(folderMap: Map<string, TaskFolder>): Promise<void> {
        for (const [, folder] of folderMap) {
            if (!folder.relativePath) {
                continue;
            }

            const relatedItems = await loadRelatedItems(folder.folderPath);
            if (relatedItems) {
                folder.relatedItems = relatedItems;
            }
        }
    }

    private async collectFeatureFoldersRecursively(
        dirPath: string,
        relativePath: string,
        folders: Array<{ path: string; displayName: string; relativePath: string }>
    ): Promise<void> {
        const archiveFolderName = 'archive';
        const readResult = safeReadDir(dirPath);

        if (!readResult.success || !readResult.data) {
            return;
        }

        for (const item of readResult.data) {
            if (item === archiveFolderName) {
                continue;
            }

            const itemPath = path.join(dirPath, item);
            const statsResult = safeStats(itemPath);

            if (!statsResult.success || !statsResult.data || !statsResult.data.isDirectory()) {
                continue;
            }

            const itemRelativePath = relativePath ? path.join(relativePath, item) : item;
            const displayName = relativePath ? `${relativePath}/${item}` : item;

            folders.push({
                path: itemPath,
                displayName,
                relativePath: itemRelativePath
            });

            await this.collectFeatureFoldersRecursively(itemPath, itemRelativePath, folders);
        }
    }
}
