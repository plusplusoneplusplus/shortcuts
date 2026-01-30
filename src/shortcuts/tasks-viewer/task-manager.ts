import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { ensureDirectoryExists, safeExists, safeReadDir, safeRename, safeStats, safeWriteFile } from '../shared';
import { Task, TasksViewerSettings, TaskSortBy, TaskDocument, TaskDocumentGroup, TaskFolder, DiscoverySettings, DiscoveryDefaultScope } from './types';
import { loadRelatedItems, mergeRelatedItems, RELATED_ITEMS_FILENAME } from './related-items-loader';
import { RelatedItem } from './types';

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
        const tasks: Task[] = [];
        const archiveFolderName = 'archive';

        const readResult = safeReadDir(dirPath);
        if (!readResult.success || !readResult.data) {
            return tasks;
        }

        for (const item of readResult.data) {
            const itemPath = path.join(dirPath, item);
            const statsResult = safeStats(itemPath);
            
            if (!statsResult.success || !statsResult.data) {
                continue;
            }

            if (statsResult.data.isDirectory()) {
                // Skip archive folder when scanning active tasks
                if (!isArchived && item === archiveFolderName) {
                    continue;
                }
                // Recursively scan subdirectory
                const subRelativePath = relativePath ? path.join(relativePath, item) : item;
                const subTasks = this.scanTasksRecursively(itemPath, subRelativePath, isArchived);
                tasks.push(...subTasks);
            } else if (statsResult.data.isFile() && item.endsWith('.md')) {
                // Found a markdown file
                tasks.push({
                    name: path.basename(item, '.md'),
                    filePath: itemPath,
                    modifiedTime: statsResult.data.mtime,
                    isArchived,
                    relativePath: relativePath || undefined
                });
            }
        }

        return tasks;
    }

    /**
     * Create a new task file
     * @returns The path to the created file
     */
    async createTask(name: string): Promise<string> {
        this.ensureFoldersExist();

        const sanitizedName = this.sanitizeFileName(name);
        const filePath = path.join(this.getTasksFolder(), `${sanitizedName}.md`);

        if (safeExists(filePath)) {
            throw new Error(`Task "${name}" already exists`);
        }

        // Create empty file with task name as header
        const content = `# ${name}\n\n`;
        safeWriteFile(filePath, content);

        return filePath;
    }

    /**
     * Create a new feature folder
     * @returns The path to the created folder
     */
    async createFeature(name: string): Promise<string> {
        this.ensureFoldersExist();

        const sanitizedName = this.sanitizeFileName(name);
        const folderPath = path.join(this.getTasksFolder(), sanitizedName);

        if (safeExists(folderPath)) {
            throw new Error(`Feature "${name}" already exists`);
        }

        ensureDirectoryExists(folderPath);

        // Create placeholder.md file so the feature appears in the tree view
        const placeholderFilePath = path.join(folderPath, 'placeholder.md');
        safeWriteFile(placeholderFilePath, '');

        return folderPath;
    }

    /**
     * Create a new subfolder inside an existing folder
     * @param parentFolderPath - Absolute path to the parent folder
     * @param name - Name of the subfolder to create
     * @returns The path to the created subfolder
     */
    async createSubfolder(parentFolderPath: string, name: string): Promise<string> {
        if (!safeExists(parentFolderPath)) {
            throw new Error(`Parent folder not found: ${parentFolderPath}`);
        }

        const sanitizedName = this.sanitizeFileName(name);
        const subfolderPath = path.join(parentFolderPath, sanitizedName);

        if (safeExists(subfolderPath)) {
            throw new Error(`Subfolder "${name}" already exists`);
        }

        ensureDirectoryExists(subfolderPath);

        // Create placeholder.md file so the subfolder appears in the tree view
        const placeholderFilePath = path.join(subfolderPath, 'placeholder.md');
        safeWriteFile(placeholderFilePath, '');

        return subfolderPath;
    }

    /**
     * Rename a task file
     * @returns The new file path
     */
    async renameTask(oldPath: string, newName: string): Promise<string> {
        if (!safeExists(oldPath)) {
            throw new Error(`Task file not found: ${oldPath}`);
        }

        const sanitizedName = this.sanitizeFileName(newName);
        const directory = path.dirname(oldPath);
        const newPath = path.join(directory, `${sanitizedName}.md`);

        if (oldPath !== newPath && safeExists(newPath)) {
            throw new Error(`Task "${newName}" already exists`);
        }

        safeRename(oldPath, newPath);
        return newPath;
    }

    /**
     * Rename a folder
     * @param folderPath - Absolute path to the folder
     * @param newName - New folder name
     * @returns The new folder path
     */
    async renameFolder(folderPath: string, newName: string): Promise<string> {
        if (!safeExists(folderPath)) {
            throw new Error(`Folder not found: ${folderPath}`);
        }

        const statsResult = safeStats(folderPath);
        if (!statsResult.success || !statsResult.data?.isDirectory()) {
            throw new Error(`Path is not a directory: ${folderPath}`);
        }

        const sanitizedName = this.sanitizeFileName(newName);
        const parentDir = path.dirname(folderPath);
        const newPath = path.join(parentDir, sanitizedName);

        if (folderPath !== newPath && safeExists(newPath)) {
            throw new Error(`Folder "${newName}" already exists`);
        }

        safeRename(folderPath, newPath);
        return newPath;
    }

    /**
     * Rename a document group (all documents sharing the same base name)
     * @param folderPath - Absolute path to the folder containing the documents
     * @param oldBaseName - Current base name of the document group
     * @param newBaseName - New base name for the documents
     * @returns Array of new file paths
     */
    async renameDocumentGroup(folderPath: string, oldBaseName: string, newBaseName: string): Promise<string[]> {
        if (!safeExists(folderPath)) {
            throw new Error(`Folder not found: ${folderPath}`);
        }

        const sanitizedNewBaseName = this.sanitizeFileName(newBaseName);
        const renamedPaths: string[] = [];
        const failedRenames: string[] = [];

        // Find all files with the old base name
        const readResult = safeReadDir(folderPath);
        if (!readResult.success || !readResult.data) {
            throw new Error(`Failed to read folder: ${folderPath}`);
        }

        const filesToRename: Array<{ oldPath: string; newPath: string }> = [];

        for (const fileName of readResult.data) {
            if (!fileName.endsWith('.md')) {
                continue;
            }

            const { baseName, docType } = this.parseFileName(fileName);
            if (baseName !== oldBaseName) {
                continue;
            }

            const oldFilePath = path.join(folderPath, fileName);
            const newFileName = docType
                ? `${sanitizedNewBaseName}.${docType}.md`
                : `${sanitizedNewBaseName}.md`;
            const newFilePath = path.join(folderPath, newFileName);

            // Check for collision before adding to rename list
            if (oldFilePath !== newFilePath && safeExists(newFilePath)) {
                throw new Error(`File "${newFileName}" already exists`);
            }

            filesToRename.push({ oldPath: oldFilePath, newPath: newFilePath });
        }

        if (filesToRename.length === 0) {
            throw new Error(`No documents found with base name "${oldBaseName}"`);
        }

        // Perform the renames
        for (const { oldPath, newPath } of filesToRename) {
            try {
                safeRename(oldPath, newPath);
                renamedPaths.push(newPath);
            } catch (error) {
                failedRenames.push(path.basename(oldPath));
            }
        }

        if (failedRenames.length > 0) {
            throw new Error(`Failed to rename: ${failedRenames.join(', ')}`);
        }

        return renamedPaths;
    }

    /**
     * Rename a single document (preserving doc type suffix)
     * @param oldPath - Absolute path to the document
     * @param newBaseName - New base name for the document
     * @returns The new file path
     */
    async renameDocument(oldPath: string, newBaseName: string): Promise<string> {
        if (!safeExists(oldPath)) {
            throw new Error(`Document not found: ${oldPath}`);
        }

        const fileName = path.basename(oldPath);
        const { docType } = this.parseFileName(fileName);
        const sanitizedNewBaseName = this.sanitizeFileName(newBaseName);
        
        const directory = path.dirname(oldPath);
        const newFileName = docType
            ? `${sanitizedNewBaseName}.${docType}.md`
            : `${sanitizedNewBaseName}.md`;
        const newPath = path.join(directory, newFileName);

        if (oldPath !== newPath && safeExists(newPath)) {
            throw new Error(`Document "${newFileName}" already exists`);
        }

        safeRename(oldPath, newPath);
        return newPath;
    }

    /**
     * Delete a task file
     */
    async deleteTask(filePath: string): Promise<void> {
        if (!safeExists(filePath)) {
            throw new Error(`Task file not found: ${filePath}`);
        }

        fs.unlinkSync(filePath);
    }

    /**
     * Delete a folder and all its contents recursively
     * @param folderPath - Absolute path to the folder to delete
     */
    async deleteFolder(folderPath: string): Promise<void> {
        if (!safeExists(folderPath)) {
            throw new Error(`Folder not found: ${folderPath}`);
        }

        const statsResult = safeStats(folderPath);
        if (!statsResult.success || !statsResult.data?.isDirectory()) {
            throw new Error(`Path is not a directory: ${folderPath}`);
        }

        fs.rmSync(folderPath, { recursive: true, force: true });
    }

    /**
     * Archive a task (move to archive folder)
     * @returns The new file path
     */
    async archiveTask(filePath: string): Promise<string> {
        if (!safeExists(filePath)) {
            throw new Error(`Task file not found: ${filePath}`);
        }

        this.ensureFoldersExist();

        const fileName = path.basename(filePath);
        const newPath = path.join(this.getArchiveFolder(), fileName);

        // Handle name collision in archive
        let finalPath = newPath;
        if (safeExists(newPath)) {
            const baseName = path.basename(fileName, '.md');
            const timestamp = Date.now();
            finalPath = path.join(this.getArchiveFolder(), `${baseName}-${timestamp}.md`);
        }

        safeRename(filePath, finalPath);
        return finalPath;
    }

    /**
     * Unarchive a task (move back to main folder)
     * @returns The new file path
     */
    async unarchiveTask(filePath: string): Promise<string> {
        if (!safeExists(filePath)) {
            throw new Error(`Task file not found: ${filePath}`);
        }

        const fileName = path.basename(filePath);
        const newPath = path.join(this.getTasksFolder(), fileName);

        // Handle name collision
        let finalPath = newPath;
        if (safeExists(newPath)) {
            const baseName = path.basename(fileName, '.md');
            const timestamp = Date.now();
            finalPath = path.join(this.getTasksFolder(), `${baseName}-${timestamp}.md`);
        }

        safeRename(filePath, finalPath);
        return finalPath;
    }

    /**
     * Archive a document (move to archive folder)
     * @returns The new file path
     */
    async archiveDocument(filePath: string): Promise<string> {
        return this.archiveTask(filePath);
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
     * @returns Array of new file paths
     */
    async archiveDocumentGroup(filePaths: string[]): Promise<string[]> {
        const newPaths: string[] = [];
        for (const filePath of filePaths) {
            const newPath = await this.archiveTask(filePath);
            newPaths.push(newPath);
        }
        return newPaths;
    }

    /**
     * Unarchive a document group (move all documents back to main folder)
     * @param filePaths - Array of file paths in the group
     * @returns Array of new file paths
     */
    async unarchiveDocumentGroup(filePaths: string[]): Promise<string[]> {
        const newPaths: string[] = [];
        for (const filePath of filePaths) {
            const newPath = await this.unarchiveTask(filePath);
            newPaths.push(newPath);
        }
        return newPaths;
    }

    /**
     * Move a task file to a different folder (feature folder or root)
     * @param sourcePath - Absolute path to the source file
     * @param targetFolder - Absolute path to the target folder
     * @returns The new file path
     */
    async moveTask(sourcePath: string, targetFolder: string): Promise<string> {
        if (!safeExists(sourcePath)) {
            throw new Error(`Task file not found: ${sourcePath}`);
        }

        // Ensure target folder exists
        ensureDirectoryExists(targetFolder);

        const fileName = path.basename(sourcePath);
        let newPath = path.join(targetFolder, fileName);

        // Handle name collision with suffix
        if (sourcePath !== newPath && safeExists(newPath)) {
            const baseName = path.basename(fileName, '.md');
            let counter = 1;
            while (safeExists(newPath)) {
                newPath = path.join(targetFolder, `${baseName}-${counter}.md`);
                counter++;
            }
        }

        // Don't move if already in target location
        if (sourcePath === newPath) {
            return sourcePath;
        }

        safeRename(sourcePath, newPath);
        return newPath;
    }

    /**
     * Move multiple task files to a different folder (for document groups)
     * @param sourcePaths - Array of absolute paths to source files
     * @param targetFolder - Absolute path to the target folder
     * @returns Array of new file paths
     */
    async moveTaskGroup(sourcePaths: string[], targetFolder: string): Promise<string[]> {
        const newPaths: string[] = [];
        for (const sourcePath of sourcePaths) {
            const newPath = await this.moveTask(sourcePath, targetFolder);
            newPaths.push(newPath);
        }
        return newPaths;
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
        // Remove .md extension
        const withoutMd = fileName.replace(/\.md$/i, '');
        
        // Split by dot to find potential doc type suffix
        const parts = withoutMd.split('.');
        
        if (parts.length >= 2) {
            // Check if the last part looks like a doc type (common types)
            const lastPart = parts[parts.length - 1].toLowerCase();
            const commonDocTypes = [
                'plan', 'spec', 'test', 'notes', 'todo', 'readme', 
                'design', 'impl', 'implementation', 'review', 'checklist',
                'requirements', 'analysis', 'research', 'summary', 'log',
                'draft', 'final', 'v1', 'v2', 'v3', 'old', 'new', 'backup'
            ];
            
            if (commonDocTypes.includes(lastPart) || /^v\d+$/.test(lastPart)) {
                return {
                    baseName: parts.slice(0, -1).join('.'),
                    docType: parts[parts.length - 1]
                };
            }
        }
        
        // No doc type suffix found
        return { baseName: withoutMd, docType: undefined };
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
        const documents: TaskDocument[] = [];
        const archiveFolderName = 'archive';

        const readResult = safeReadDir(dirPath);
        if (!readResult.success || !readResult.data) {
            return documents;
        }

        for (const item of readResult.data) {
            const itemPath = path.join(dirPath, item);
            const statsResult = safeStats(itemPath);
            
            if (!statsResult.success || !statsResult.data) {
                continue;
            }

            if (statsResult.data.isDirectory()) {
                // Skip archive folder when scanning active documents
                if (!isArchived && item === archiveFolderName) {
                    continue;
                }
                // Recursively scan subdirectory
                const subRelativePath = relativePath ? path.join(relativePath, item) : item;
                const subDocuments = this.scanDocumentsRecursively(itemPath, subRelativePath, isArchived);
                documents.push(...subDocuments);
            } else if (statsResult.data.isFile() && item.endsWith('.md')) {
                // Found a markdown file
                const { baseName, docType } = this.parseFileName(item);
                documents.push({
                    baseName,
                    docType,
                    fileName: item,
                    filePath: itemPath,
                    modifiedTime: statsResult.data.mtime,
                    isArchived,
                    relativePath: relativePath || undefined
                });
            }
        }

        return documents;
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
        const archiveFolderName = 'archive';

        const readResult = safeReadDir(dirPath);
        if (!readResult.success || !readResult.data) {
            return;
        }

        for (const item of readResult.data) {
            const itemPath = path.join(dirPath, item);
            const statsResult = safeStats(itemPath);
            
            if (!statsResult.success || !statsResult.data) {
                continue;
            }

            if (statsResult.data.isDirectory()) {
                // Skip archive folder when scanning active folders
                if (!isArchived && item === archiveFolderName) {
                    continue;
                }

                const folderRelativePath = relativePath ? path.join(relativePath, item) : item;

                // Check if folder already exists in map
                if (!folderMap.has(folderRelativePath)) {
                    const newFolder: TaskFolder = {
                        name: item,
                        folderPath: itemPath,
                        relativePath: folderRelativePath,
                        isArchived,
                        children: [],
                        tasks: [],
                        documentGroups: [],
                        singleDocuments: []
                    };

                    folderMap.set(folderRelativePath, newFolder);
                    parentFolder.children.push(newFolder);

                    // Recursively scan subdirectory
                    this.scanFoldersRecursively(itemPath, folderRelativePath, isArchived, folderMap, newFolder);
                } else {
                    // Folder already exists, just recurse into it
                    const existingFolder = folderMap.get(folderRelativePath)!;
                    this.scanFoldersRecursively(itemPath, folderRelativePath, isArchived, folderMap, existingFolder);
                }
            }
        }
    }

    /**
     * Group task documents by base name and relative path
     * Returns groups only for base names that have multiple documents
     * Single documents are returned as-is (not grouped)
     */
    async getTaskDocumentGroups(): Promise<{ groups: TaskDocumentGroup[]; singles: TaskDocument[] }> {
        const documents = await this.getTaskDocuments();
        
        // Group by baseName, isArchived status, and relativePath
        const groupMap = new Map<string, TaskDocument[]>();
        
        for (const doc of documents) {
            // Create key combining baseName, archived status, and relative path
            const relPath = doc.relativePath || '';
            const key = `${doc.baseName}|${doc.isArchived ? 'archived' : 'active'}|${relPath}`;
            const existing = groupMap.get(key) || [];
            existing.push(doc);
            groupMap.set(key, existing);
        }

        const groups: TaskDocumentGroup[] = [];
        const singles: TaskDocument[] = [];

        for (const [key, docs] of groupMap) {
            if (docs.length > 1) {
                // Multiple documents with same base name - create a group
                const latestModifiedTime = docs.reduce(
                    (latest, doc) => doc.modifiedTime > latest ? doc.modifiedTime : latest,
                    docs[0].modifiedTime
                );
                groups.push({
                    baseName: docs[0].baseName,
                    documents: docs,
                    isArchived: docs[0].isArchived,
                    latestModifiedTime
                });
            } else {
                // Single document - don't group
                singles.push(docs[0]);
            }
        }

        return { groups, singles };
    }

    /**
     * Build a hierarchical folder structure from task documents
     * @returns Root task folder with nested children
     */
    async getTaskFolderHierarchy(): Promise<TaskFolder> {
        const { groups, singles } = await this.getTaskDocumentGroups();
        const settings = this.getSettings();
        
        // Create root folder
        const rootFolder: TaskFolder = {
            name: '',
            folderPath: this.getTasksFolder(),
            relativePath: '',
            isArchived: false,
            children: [],
            tasks: [],
            documentGroups: [],
            singleDocuments: []
        };

        // Build folder hierarchy
        const folderMap = new Map<string, TaskFolder>();
        folderMap.set('', rootFolder);

        // First, scan all directories (including empty ones) to build complete folder structure
        this.scanFoldersRecursively(this.getTasksFolder(), '', false, folderMap, rootFolder);

        // Also scan archive folder if showArchived is enabled
        if (settings.showArchived) {
            const archiveFolder = this.getArchiveFolder();
            if (safeExists(archiveFolder)) {
                this.scanFoldersRecursively(archiveFolder, '', true, folderMap, rootFolder);
            }
        }

        // Process all documents to ensure their folder paths exist (for documents in scanned folders)
        const allDocuments = [
            ...groups.flatMap(g => g.documents),
            ...singles
        ];

        for (const doc of allDocuments) {
            if (!doc.relativePath) {
                // Document is in root folder
                continue;
            }

            const pathParts = doc.relativePath.split(path.sep);
            let currentPath = '';

            // Create folder hierarchy (should already exist from directory scan, but ensure it)
            for (const part of pathParts) {
                const parentPath = currentPath;
                currentPath = currentPath ? path.join(currentPath, part) : part;

                if (!folderMap.has(currentPath)) {
                    const newFolder: TaskFolder = {
                        name: part,
                        folderPath: path.join(this.getTasksFolder(), currentPath),
                        relativePath: currentPath,
                        isArchived: doc.isArchived,
                        children: [],
                        tasks: [],
                        documentGroups: [],
                        singleDocuments: []
                    };

                    folderMap.set(currentPath, newFolder);

                    // Add to parent's children
                    const parent = folderMap.get(parentPath);
                    if (parent) {
                        parent.children.push(newFolder);
                    }
                }
            }
        }

        // Assign documents and groups to their folders
        for (const group of groups) {
            const folderPath = group.documents[0].relativePath || '';
            const folder = folderMap.get(folderPath);
            if (folder) {
                folder.documentGroups.push(group);
            }
        }

        for (const doc of singles) {
            const folderPath = doc.relativePath || '';
            const folder = folderMap.get(folderPath);
            if (folder) {
                folder.singleDocuments.push(doc);
            }
        }

        // Load related items for all folders if discovery is enabled
        if (settings.discovery.enabled && settings.discovery.showRelatedInTree) {
            await this.loadRelatedItemsForFolders(folderMap);
        }

        return rootFolder;
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

        const sourceFileName = path.basename(sourcePath);
        const targetName = newName 
            ? this.sanitizeFileName(newName) 
            : path.basename(sourceFileName, '.md');

        const targetPath = path.join(this.getTasksFolder(), `${targetName}.md`);

        if (safeExists(targetPath)) {
            throw new Error(`Task "${targetName}" already exists`);
        }

        // Copy file content (not move, to preserve original)
        const content = fs.readFileSync(sourcePath, 'utf-8');
        safeWriteFile(targetPath, content);

        return targetPath;
    }

    /**
     * Check if a task with the given name exists
     * @param name - Task name (without .md extension)
     */
    taskExists(name: string): boolean {
        const sanitizedName = this.sanitizeFileName(name);
        const filePath = path.join(this.getTasksFolder(), `${sanitizedName}.md`);
        return safeExists(filePath);
    }

    /**
     * Sanitize a file name to remove invalid characters
     */
    sanitizeFileName(name: string): string {
        // Remove/replace characters that are invalid in file names
        return name
            .replace(/[<>:"/\\|?*]/g, '-')
            .replace(/\s+/g, '-')
            .replace(/-+/g, '-')
            .replace(/^-|-$/g, '')
            .trim();
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
