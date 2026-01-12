import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { Task, TasksViewerSettings, TaskSortBy, TaskDocument, TaskDocumentGroup } from './types';

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

        if (!fs.existsSync(tasksFolder)) {
            fs.mkdirSync(tasksFolder, { recursive: true });
        }
        if (!fs.existsSync(archiveFolder)) {
            fs.mkdirSync(archiveFolder, { recursive: true });
        }
    }

    /**
     * Get all tasks from the tasks folder
     */
    async getTasks(): Promise<Task[]> {
        const tasks: Task[] = [];
        const settings = this.getSettings();

        // Read active tasks
        const tasksFolder = this.getTasksFolder();
        if (fs.existsSync(tasksFolder)) {
            const files = fs.readdirSync(tasksFolder);
            for (const file of files) {
                if (file.endsWith('.md')) {
                    const filePath = path.join(tasksFolder, file);
                    try {
                        const stats = fs.statSync(filePath);
                        if (stats.isFile()) {
                            tasks.push({
                                name: path.basename(file, '.md'),
                                filePath,
                                modifiedTime: stats.mtime,
                                isArchived: false
                            });
                        }
                    } catch (error) {
                        console.warn(`Failed to read task file ${filePath}:`, error);
                    }
                }
            }
        }

        // Read archived tasks if setting enabled
        if (settings.showArchived) {
            const archiveFolder = this.getArchiveFolder();
            if (fs.existsSync(archiveFolder)) {
                const files = fs.readdirSync(archiveFolder);
                for (const file of files) {
                    if (file.endsWith('.md')) {
                        const filePath = path.join(archiveFolder, file);
                        try {
                            const stats = fs.statSync(filePath);
                            if (stats.isFile()) {
                                tasks.push({
                                    name: path.basename(file, '.md'),
                                    filePath,
                                    modifiedTime: stats.mtime,
                                    isArchived: true
                                });
                            }
                        } catch (error) {
                            console.warn(`Failed to read archived task file ${filePath}:`, error);
                        }
                    }
                }
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

        if (fs.existsSync(filePath)) {
            throw new Error(`Task "${name}" already exists`);
        }

        // Create empty file with task name as header
        const content = `# ${name}\n\n`;
        fs.writeFileSync(filePath, content, 'utf8');

        return filePath;
    }

    /**
     * Rename a task file
     * @returns The new file path
     */
    async renameTask(oldPath: string, newName: string): Promise<string> {
        if (!fs.existsSync(oldPath)) {
            throw new Error(`Task file not found: ${oldPath}`);
        }

        const sanitizedName = this.sanitizeFileName(newName);
        const directory = path.dirname(oldPath);
        const newPath = path.join(directory, `${sanitizedName}.md`);

        if (oldPath !== newPath && fs.existsSync(newPath)) {
            throw new Error(`Task "${newName}" already exists`);
        }

        fs.renameSync(oldPath, newPath);
        return newPath;
    }

    /**
     * Delete a task file
     */
    async deleteTask(filePath: string): Promise<void> {
        if (!fs.existsSync(filePath)) {
            throw new Error(`Task file not found: ${filePath}`);
        }

        fs.unlinkSync(filePath);
    }

    /**
     * Archive a task (move to archive folder)
     * @returns The new file path
     */
    async archiveTask(filePath: string): Promise<string> {
        if (!fs.existsSync(filePath)) {
            throw new Error(`Task file not found: ${filePath}`);
        }

        this.ensureFoldersExist();

        const fileName = path.basename(filePath);
        const newPath = path.join(this.getArchiveFolder(), fileName);

        // Handle name collision in archive
        let finalPath = newPath;
        if (fs.existsSync(newPath)) {
            const baseName = path.basename(fileName, '.md');
            const timestamp = Date.now();
            finalPath = path.join(this.getArchiveFolder(), `${baseName}-${timestamp}.md`);
        }

        fs.renameSync(filePath, finalPath);
        return finalPath;
    }

    /**
     * Unarchive a task (move back to main folder)
     * @returns The new file path
     */
    async unarchiveTask(filePath: string): Promise<string> {
        if (!fs.existsSync(filePath)) {
            throw new Error(`Task file not found: ${filePath}`);
        }

        const fileName = path.basename(filePath);
        const newPath = path.join(this.getTasksFolder(), fileName);

        // Handle name collision
        let finalPath = newPath;
        if (fs.existsSync(newPath)) {
            const baseName = path.basename(fileName, '.md');
            const timestamp = Date.now();
            finalPath = path.join(this.getTasksFolder(), `${baseName}-${timestamp}.md`);
        }

        fs.renameSync(filePath, finalPath);
        return finalPath;
    }

    /**
     * Set up file watching for the tasks folder
     */
    watchTasksFolder(callback: () => void): void {
        this.refreshCallback = callback;
        this.disposeWatchers();

        const tasksFolder = this.getTasksFolder();

        // Create watcher for main tasks folder
        if (fs.existsSync(tasksFolder)) {
            const pattern = new vscode.RelativePattern(tasksFolder, '*.md');
            this.fileWatcher = vscode.workspace.createFileSystemWatcher(pattern);

            this.fileWatcher.onDidChange(() => this.debounceRefresh());
            this.fileWatcher.onDidCreate(() => this.debounceRefresh());
            this.fileWatcher.onDidDelete(() => this.debounceRefresh());
        }

        // Create watcher for archive folder
        const archiveFolder = this.getArchiveFolder();
        if (fs.existsSync(archiveFolder)) {
            const archivePattern = new vscode.RelativePattern(archiveFolder, '*.md');
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
     * Get all task documents from the tasks folder
     */
    async getTaskDocuments(): Promise<TaskDocument[]> {
        const documents: TaskDocument[] = [];
        const settings = this.getSettings();

        // Read active documents
        const tasksFolder = this.getTasksFolder();
        if (fs.existsSync(tasksFolder)) {
            const files = fs.readdirSync(tasksFolder);
            for (const file of files) {
                if (file.endsWith('.md')) {
                    const filePath = path.join(tasksFolder, file);
                    try {
                        const stats = fs.statSync(filePath);
                        if (stats.isFile()) {
                            const { baseName, docType } = this.parseFileName(file);
                            documents.push({
                                baseName,
                                docType,
                                fileName: file,
                                filePath,
                                modifiedTime: stats.mtime,
                                isArchived: false
                            });
                        }
                    } catch (error) {
                        console.warn(`Failed to read task file ${filePath}:`, error);
                    }
                }
            }
        }

        // Read archived documents if setting enabled
        if (settings.showArchived) {
            const archiveFolder = this.getArchiveFolder();
            if (fs.existsSync(archiveFolder)) {
                const files = fs.readdirSync(archiveFolder);
                for (const file of files) {
                    if (file.endsWith('.md')) {
                        const filePath = path.join(archiveFolder, file);
                        try {
                            const stats = fs.statSync(filePath);
                            if (stats.isFile()) {
                                const { baseName, docType } = this.parseFileName(file);
                                documents.push({
                                    baseName,
                                    docType,
                                    fileName: file,
                                    filePath,
                                    modifiedTime: stats.mtime,
                                    isArchived: true
                                });
                            }
                        } catch (error) {
                            console.warn(`Failed to read archived task file ${filePath}:`, error);
                        }
                    }
                }
            }
        }

        return documents;
    }

    /**
     * Group task documents by base name
     * Returns groups only for base names that have multiple documents
     * Single documents are returned as-is (not grouped)
     */
    async getTaskDocumentGroups(): Promise<{ groups: TaskDocumentGroup[]; singles: TaskDocument[] }> {
        const documents = await this.getTaskDocuments();
        
        // Group by baseName and isArchived status
        const groupMap = new Map<string, TaskDocument[]>();
        
        for (const doc of documents) {
            // Create key combining baseName and archived status
            const key = `${doc.baseName}|${doc.isArchived ? 'archived' : 'active'}`;
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
