import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { ensureDirectoryExists, safeExists, safeReadDir, safeRename, safeStats, safeWriteFile } from '../shared/file-utils';
import { Task, TasksViewerSettings, TaskSortBy, TaskDocument, TaskDocumentGroup, TaskFolder } from './types';

/**
 * Manages task files stored in the tasks folder
 * Handles CRUD operations and file watching
 */
export class TaskManager implements vscode.Disposable {
    private readonly workspaceRoot: string;
    private fileWatcher?: vscode.FileSystemWatcher;
    private archiveWatcher?: vscode.FileSystemWatcher;
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
     * Delete a task file
     */
    async deleteTask(filePath: string): Promise<void> {
        if (!safeExists(filePath)) {
            throw new Error(`Task file not found: ${filePath}`);
        }

        fs.unlinkSync(filePath);
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
        return {
            enabled: config.get<boolean>('enabled', true),
            folderPath: config.get<string>('folderPath', '.vscode/tasks'),
            showArchived: config.get<boolean>('showArchived', false),
            sortBy: config.get<TaskSortBy>('sortBy', 'modifiedDate'),
            groupRelatedDocuments: config.get<boolean>('groupRelatedDocuments', true)
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

        // Process all documents to create folder structure
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

            // Create folder hierarchy
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

        return rootFolder;
    }

    /**
     * Sanitize a file name to remove invalid characters
     */
    private sanitizeFileName(name: string): string {
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

        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
            this.debounceTimer = undefined;
        }
    }

    /**
     * Dispose all resources
     */
    dispose(): void {
        this.disposeWatchers();
    }
}
