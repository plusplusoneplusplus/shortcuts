import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import * as yaml from 'js-yaml';
import { ensureDirectoryExists, safeExists, safeReadDir, safeStats } from '../shared';
import { Task, TasksViewerSettings, TaskSortBy, TaskDocument, TaskDocumentGroup, TaskFolder, DiscoverySettings, DiscoveryDefaultScope, TaskStatus } from './types';
import { loadRelatedItems, mergeRelatedItems, RELATED_ITEMS_FILENAME } from './related-items-loader';
import { RelatedItem } from './types';
import {
    parseFileName as coreParseFileName,
    scanTasksRecursively as coreScanTasksRecursively,
    scanDocumentsRecursively as coreScanDocumentsRecursively,
    scanFoldersRecursively as coreScanFoldersRecursively,
    groupTaskDocuments as coreGroupTaskDocuments,
    buildTaskFolderHierarchy as coreBuildTaskFolderHierarchy,
} from '@plusplusoneplusplus/pipeline-core';
import * as taskOps from '@plusplusoneplusplus/pipeline-core';


/**
 * Update the status field in a markdown file's frontmatter
 * Creates frontmatter if it doesn't exist
 * @param filePath - Absolute path to the markdown file
 * @param status - New status to set
 */
export async function updateTaskStatus(filePath: string, status: TaskStatus): Promise<void> {
    const content = fs.readFileSync(filePath, 'utf-8');
    
    if (content.startsWith('---')) {
        // Has existing frontmatter - update it
        const endIndex = content.indexOf('---', 3);
        if (endIndex !== -1) {
            const frontmatterContent = content.substring(3, endIndex).trim();
            let frontmatter: Record<string, unknown> = {};
            
            if (frontmatterContent) {
                try {
                    frontmatter = (yaml.load(frontmatterContent) as Record<string, unknown>) || {};
                } catch {
                    frontmatter = {};
                }
            }
            
            // Update status
            frontmatter.status = status;
            
            // Rebuild the file
            const newFrontmatter = yaml.dump(frontmatter, { lineWidth: -1 }).trim();
            const bodyContent = content.substring(endIndex + 3);
            const newContent = `---\n${newFrontmatter}\n---${bodyContent}`;
            
            await fs.promises.writeFile(filePath, newContent, 'utf-8');
            return;
        }
    }
    
    // No frontmatter - add it
    const newFrontmatter = yaml.dump({ status }, { lineWidth: -1 }).trim();
    const newContent = `---\n${newFrontmatter}\n---\n\n${content}`;
    await fs.promises.writeFile(filePath, newContent, 'utf-8');
}

/**
 * Manages task files stored in the tasks folder
 * Handles CRUD operations and file watching
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

    /**
     * Get the tasks folder path from settings
     */
    getTasksFolder(): string {
        const settings = this.getSettings();
        const folderPath = settings.folderPath || '.vscode/tasks';
        return path.isAbsolute(folderPath)
            ? folderPath
            : path.join(this.workspaceRoot, folderPath);
    }

    /**
     * Get the archive folder path
     */
    getArchiveFolder(): string {
        return path.join(this.getTasksFolder(), 'archive');
    }

    /**
     * Ensure the tasks and archive folders exist
     */
    ensureFoldersExist(): void {
        const tasksFolder = this.getTasksFolder();
        const archiveFolder = this.getArchiveFolder();

        ensureDirectoryExists(tasksFolder);
        ensureDirectoryExists(archiveFolder);
    }

    /**
     * Get all tasks from the tasks folder (recursively)
     */
    async getTasks(): Promise<Task[]> {
        const tasks: Task[] = [];
        const settings = this.getSettings();

        // Read active tasks recursively
        const tasksFolder = this.getTasksFolder();
        const activeTasks = this.scanTasksRecursively(tasksFolder, '', false);
        tasks.push(...activeTasks);

        // Read archived tasks if setting enabled
        if (settings.showArchived) {
            const archiveFolder = this.getArchiveFolder();
            const archivedTasks = this.scanTasksRecursively(archiveFolder, '', true);
            tasks.push(...archivedTasks);
        }

        return tasks;
    }

    /**
     * Recursively scan a directory for task files
     * @param dirPath - Absolute path to directory to scan
     * @param relativePath - Relative path from tasks root
     * @param isArchived - Whether files are in archive
     * @returns Array of tasks found
     */
    private scanTasksRecursively(dirPath: string, relativePath: string, isArchived: boolean): Task[] {
        return coreScanTasksRecursively(dirPath, relativePath, isArchived);
    }

    /**
     * Create a new task file
     * @returns The path to the created file
     */
    async createTask(name: string): Promise<string> {
        this.ensureFoldersExist();
        return taskOps.createTask(this.getTasksFolder(), name);
    }

    /**
     * Create a new feature folder
     * @returns The path to the created folder
     */
    async createFeature(name: string): Promise<string> {
        this.ensureFoldersExist();
        return taskOps.createFeature(this.getTasksFolder(), name);
    }

    /**
     * Create a new subfolder inside an existing folder
     * @param parentFolderPath - Absolute path to the parent folder
     * @param name - Name of the subfolder to create
     * @returns The path to the created subfolder
     */
    async createSubfolder(parentFolderPath: string, name: string): Promise<string> {
        return taskOps.createSubfolder(parentFolderPath, name);
    }

    /**
     * Rename a task file
     * @returns The new file path
     */
    async renameTask(oldPath: string, newName: string): Promise<string> {
        return taskOps.renameTask(oldPath, newName);
    }

    /**
     * Rename a folder
     * @param folderPath - Absolute path to the folder
     * @param newName - New folder name
     * @returns The new folder path
     */
    async renameFolder(folderPath: string, newName: string): Promise<string> {
        return taskOps.renameFolder(folderPath, newName);
    }

    /**
     * Rename a document group (all documents sharing the same base name)
     * @param folderPath - Absolute path to the folder containing the documents
     * @param oldBaseName - Current base name of the document group
     * @param newBaseName - New base name for the documents
     * @returns Array of new file paths
     */
    async renameDocumentGroup(folderPath: string, oldBaseName: string, newBaseName: string): Promise<string[]> {
        return taskOps.renameDocumentGroup(folderPath, oldBaseName, newBaseName);
    }

    /**
     * Rename a single document (preserving doc type suffix)
     * @param oldPath - Absolute path to the document
     * @param newBaseName - New base name for the document
     * @returns The new file path
     */
    async renameDocument(oldPath: string, newBaseName: string): Promise<string> {
        return taskOps.renameDocument(oldPath, newBaseName);
    }

    /**
     * Delete a task file
     */
    async deleteTask(filePath: string): Promise<void> {
        return taskOps.deleteTask(filePath);
    }

    /**
     * Delete a folder and all its contents recursively
     * @param folderPath - Absolute path to the folder to delete
     */
    async deleteFolder(folderPath: string): Promise<void> {
        return taskOps.deleteFolder(folderPath);
    }

    /**
     * Archive a task (move to archive folder)
     * @param filePath - Absolute path to the task file
     * @param preserveStructure - If true, preserves the relative folder structure under archive
     * @returns The new file path
     */
    async archiveTask(filePath: string, preserveStructure: boolean = false): Promise<string> {
        this.ensureFoldersExist();
        return taskOps.archiveTask(filePath, this.getTasksFolder(), this.getArchiveFolder(), preserveStructure);
    }

    /**
     * Unarchive a task (move back to main folder)
     * @returns The new file path
     */
    async unarchiveTask(filePath: string): Promise<string> {
        return taskOps.unarchiveTask(filePath, this.getTasksFolder());
    }

    /**
     * Archive a document (move to archive folder)
     * @param filePath - Absolute path to the document file
     * @param preserveStructure - If true, preserves the relative folder structure under archive
     * @returns The new file path
     */
    async archiveDocument(filePath: string, preserveStructure: boolean = false): Promise<string> {
        return this.archiveTask(filePath, preserveStructure);
    }

    /**
     * Unarchive a document (move back to main folder)
     * @returns The new file path
     */
    async unarchiveDocument(filePath: string): Promise<string> {
        return this.unarchiveTask(filePath);
    }

    /**
     * Archive a document group (move all documents to archive folder)
     * @param filePaths - Array of file paths in the group
     * @param preserveStructure - If true, preserves the relative folder structure under archive
     * @returns Array of new file paths
     */
    async archiveDocumentGroup(filePaths: string[], preserveStructure: boolean = false): Promise<string[]> {
        this.ensureFoldersExist();
        return taskOps.archiveDocumentGroup(filePaths, this.getTasksFolder(), this.getArchiveFolder(), preserveStructure);
    }

    /**
     * Unarchive a document group (move all documents back to main folder)
     * @param filePaths - Array of file paths in the group
     * @returns Array of new file paths
     */
    async unarchiveDocumentGroup(filePaths: string[]): Promise<string[]> {
        return taskOps.unarchiveDocumentGroup(filePaths, this.getTasksFolder());
    }

    /**
     * Move a task file to a different folder (feature folder or root)
     * @param sourcePath - Absolute path to the source file
     * @param targetFolder - Absolute path to the target folder
     * @returns The new file path
     */
    async moveTask(sourcePath: string, targetFolder: string): Promise<string> {
        return taskOps.moveTask(sourcePath, targetFolder);
    }

    /**
     * Move an entire folder (and all its contents) into a target folder.
     * Prevents circular moves (moving a folder into its own subtree).
     * Handles name collisions by appending a numeric suffix.
     * @param sourceFolderPath - Absolute path to the folder to move
     * @param targetParentFolder - Absolute path to the destination parent folder
     * @returns The new folder path
     */
    async moveFolder(sourceFolderPath: string, targetParentFolder: string): Promise<string> {
        return taskOps.moveFolder(sourceFolderPath, targetParentFolder);
    }

    /**
     * Move multiple task files to a different folder (for document groups)
     * @param sourcePaths - Array of absolute paths to source files
     * @param targetFolder - Absolute path to the target folder
     * @returns Array of new file paths
     */
    async moveTaskGroup(sourcePaths: string[], targetFolder: string): Promise<string[]> {
        return taskOps.moveTaskGroup(sourcePaths, targetFolder);
    }

    /**
     * Set up file watching for the tasks folder (recursive)
     */
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

    /**
     * Get settings from VSCode configuration
     */
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

    /**
     * Parse a filename to extract base name and document type
     * Examples:
     *   "task1.md" -> { baseName: "task1", docType: undefined }
     *   "task1.plan.md" -> { baseName: "task1", docType: "plan" }
     *   "task1.test.spec.md" -> { baseName: "task1.test", docType: "spec" }
     */
    parseFileName(fileName: string): { baseName: string; docType?: string } {
        return coreParseFileName(fileName);
    }

    /**
     * Get all task documents from the tasks folder (recursively)
     */
    async getTaskDocuments(): Promise<TaskDocument[]> {
        const documents: TaskDocument[] = [];
        const settings = this.getSettings();

        // Read active documents recursively
        const tasksFolder = this.getTasksFolder();
        const activeDocuments = this.scanDocumentsRecursively(tasksFolder, '', false);
        documents.push(...activeDocuments);

        // Read archived documents if setting enabled
        if (settings.showArchived) {
            const archiveFolder = this.getArchiveFolder();
            const archivedDocuments = this.scanDocumentsRecursively(archiveFolder, '', true);
            documents.push(...archivedDocuments);
        }

        return documents;
    }

    /**
     * Recursively scan a directory for task documents
     * @param dirPath - Absolute path to directory to scan
     * @param relativePath - Relative path from tasks root
     * @param isArchived - Whether files are in archive
     * @returns Array of task documents found
     */
    private scanDocumentsRecursively(dirPath: string, relativePath: string, isArchived: boolean): TaskDocument[] {
        return coreScanDocumentsRecursively(dirPath, relativePath, isArchived);
    }

    /**
     * Recursively scan directories to build folder structure (including empty folders)
     * @param dirPath - Absolute path to directory to scan
     * @param relativePath - Relative path from tasks root
     * @param isArchived - Whether folders are in archive
     * @param folderMap - Map to store all folders
     * @param parentFolder - Parent folder to add children to
     */
    private scanFoldersRecursively(
        dirPath: string,
        relativePath: string,
        isArchived: boolean,
        folderMap: Map<string, TaskFolder>,
        parentFolder: TaskFolder
    ): void {
        coreScanFoldersRecursively(dirPath, relativePath, isArchived, folderMap, parentFolder);
    }

    /**
     * Group task documents by base name and relative path
     * Returns groups only for base names that have multiple documents
     * Single documents are returned as-is (not grouped)
     */
    async getTaskDocumentGroups(): Promise<{ groups: TaskDocumentGroup[]; singles: TaskDocument[] }> {
        const documents = await this.getTaskDocuments();
        return coreGroupTaskDocuments(documents);
    }

    /**
     * Build a hierarchical folder structure from task documents
     * @returns Root task folder with nested children
     */
    async getTaskFolderHierarchy(): Promise<TaskFolder> {
        const documents = await this.getTaskDocuments();
        const settings = this.getSettings();

        const { root, folderMap } = coreBuildTaskFolderHierarchy(
            this.getTasksFolder(),
            documents,
            settings.showArchived,
            settings.showArchived ? this.getArchiveFolder() : undefined
        );

        // Load related items for all folders if discovery is enabled
        if (settings.discovery.enabled && settings.discovery.showRelatedInTree) {
            await this.loadRelatedItemsForFolders(folderMap);
        }

        return root;
    }

    /**
     * Load related items for all folders in the hierarchy
     */
    private async loadRelatedItemsForFolders(folderMap: Map<string, TaskFolder>): Promise<void> {
        for (const [, folder] of folderMap) {
            // Skip root folder
            if (!folder.relativePath) {
                continue;
            }
            
            const relatedItems = await loadRelatedItems(folder.folderPath);
            if (relatedItems) {
                folder.relatedItems = relatedItems;
            }
        }
    }

    /**
     * Get workspace root path
     */
    getWorkspaceRoot(): string {
        return this.workspaceRoot;
    }

    /**
     * Import an external markdown file into the tasks folder
     * @param sourcePath - Path to the source file
     * @param newName - Optional new name for the task (without .md extension)
     * @returns The path to the imported file
     */
    async importTask(sourcePath: string, newName?: string): Promise<string> {
        this.ensureFoldersExist();
        return taskOps.importTask(sourcePath, this.getTasksFolder(), newName);
    }

    /**
     * Move an external markdown file into the tasks folder (move semantics - source is deleted)
     * @param sourcePath - Path to the source file
     * @param targetFolder - Absolute path to the target folder (defaults to tasks root)
     * @param newName - Optional new name for the task (without .md extension)
     * @returns The path to the moved file
     */
    async moveExternalTask(sourcePath: string, targetFolder?: string, newName?: string): Promise<string> {
        this.ensureFoldersExist();
        return taskOps.moveExternalTask(sourcePath, this.getTasksFolder(), targetFolder, newName);
    }

    /**
     * Check if a task with the given name exists in a specific folder
     * @param name - Task name (without .md extension)
     * @param folder - Optional folder path (defaults to tasks root)
     */
    taskExistsInFolder(name: string, folder?: string): boolean {
        return taskOps.taskExistsInFolder(name, this.getTasksFolder(), folder);
    }

    /**
     * Check if a task with the given name exists
     * @param name - Task name (without .md extension)
     */
    taskExists(name: string): boolean {
        return taskOps.taskExists(name, this.getTasksFolder());
    }

    /**
     * Sanitize a file name to remove invalid characters
     */
    sanitizeFileName(name: string): string {
        return taskOps.sanitizeFileName(name);
    }

    /**
     * Debounced refresh to avoid excessive updates
     */
    private debounceRefresh(): void {
        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
        }

        this.debounceTimer = setTimeout(() => {
            this.refreshCallback?.();
        }, 300);
    }

    /**
     * Dispose file watchers
     */
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

    /**
     * Add related items to a feature folder
     * Merges with existing items, deduplicating by path/hash
     * @param folderPath Absolute path to the feature folder
     * @param items Items to add
     * @param description Optional description to update
     * @returns The updated config
     */
    async addRelatedItems(
        folderPath: string,
        items: RelatedItem[],
        description?: string
    ): Promise<void> {
        await mergeRelatedItems(folderPath, items, description);
    }

    /**
     * Get all non-archived feature folders (directories in tasks folder)
     * Returns a flat list of folder paths with their display names
     */
    async getFeatureFolders(): Promise<Array<{ path: string; displayName: string; relativePath: string }>> {
        const folders: Array<{ path: string; displayName: string; relativePath: string }> = [];
        const tasksFolder = this.getTasksFolder();
        
        await this.collectFeatureFoldersRecursively(tasksFolder, '', folders);
        
        return folders;
    }

    /**
     * Recursively collect feature folders
     */
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
            // Skip archive folder
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

            // Recursively scan subdirectories
            await this.collectFeatureFoldersRecursively(itemPath, itemRelativePath, folders);
        }
    }

    /**
     * Dispose all resources
     */
    dispose(): void {
        this.disposeWatchers();
    }
}
