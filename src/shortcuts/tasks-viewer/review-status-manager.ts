import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { getExtensionLogger, LogCategory, safeExists, safeReadFile } from '../shared';
import { ReviewStatus, ReviewStatusRecord, ReviewStatusStore } from './types';

/**
 * Storage key for review status in workspace state
 */
const STORAGE_KEY = 'taskReviewStatus';

/**
 * Manages review status for task documents
 * Uses workspace state (Memento) for persistence
 */
export class ReviewStatusManager implements vscode.Disposable {
    private context?: vscode.ExtensionContext;
    private statusStore: ReviewStatusStore = {};
    private tasksRoot: string;
    private initialized = false;
    private readonly _onDidChangeStatus = new vscode.EventEmitter<string[]>();
    
    /**
     * Event fired when review status changes for one or more files
     * Payload is array of relative paths that changed
     */
    readonly onDidChangeStatus = this._onDidChangeStatus.event;

    constructor(tasksRoot: string) {
        this.tasksRoot = tasksRoot;
    }

    /**
     * Initialize the manager with extension context
     * Must be called before using other methods
     */
    async initialize(context: vscode.ExtensionContext): Promise<void> {
        this.context = context;
        await this.loadFromStorage();
        this.initialized = true;
    }

    /**
     * Check if the manager is initialized
     */
    isInitialized(): boolean {
        return this.initialized;
    }

    /**
     * Get the review status for a file
     * @param filePath Absolute path to the file
     * @returns The effective review status (considering file modifications)
     */
    getStatus(filePath: string): ReviewStatus {
        const relativePath = this.getRelativePath(filePath);
        const record = this.statusStore[relativePath];

        if (!record || record.status === 'unreviewed') {
            return 'unreviewed';
        }

        // Check if file has been modified since review
        const currentHash = this.computeFileHash(filePath);
        if (currentHash && currentHash !== record.fileHashAtReview) {
            return 'needs-re-review';
        }

        return 'reviewed';
    }

    /**
     * Get the raw status record for a file (without modification check)
     * @param filePath Absolute path to the file
     */
    getStatusRecord(filePath: string): ReviewStatusRecord | undefined {
        const relativePath = this.getRelativePath(filePath);
        return this.statusStore[relativePath];
    }

    /**
     * Mark a file as reviewed
     * @param filePath Absolute path to the file
     */
    async markAsReviewed(filePath: string): Promise<void> {
        const relativePath = this.getRelativePath(filePath);
        const fileHash = this.computeFileHash(filePath);

        if (!fileHash) {
            const logger = getExtensionLogger();
            logger.warn(LogCategory.TASKS, `Cannot compute hash for file: ${filePath}`);
            return;
        }

        this.statusStore[relativePath] = {
            status: 'reviewed',
            reviewedAt: new Date().toISOString(),
            fileHashAtReview: fileHash
        };

        await this.saveToStorage();
        this._onDidChangeStatus.fire([relativePath]);
    }

    /**
     * Mark a file as unreviewed
     * @param filePath Absolute path to the file
     */
    async markAsUnreviewed(filePath: string): Promise<void> {
        const relativePath = this.getRelativePath(filePath);
        
        if (this.statusStore[relativePath]) {
            delete this.statusStore[relativePath];
            await this.saveToStorage();
            this._onDidChangeStatus.fire([relativePath]);
        }
    }

    /**
     * Mark all files in a folder as reviewed
     * @param folderPath Absolute path to the folder
     * @param recursive Whether to include files in subfolders
     * @returns Array of file paths that were marked as reviewed
     */
    async markFolderAsReviewed(folderPath: string, recursive: boolean = true): Promise<string[]> {
        const markedFiles: string[] = [];
        const changedPaths: string[] = [];

        const processDirectory = (dirPath: string) => {
            if (!safeExists(dirPath)) {
                return;
            }

            const entries = fs.readdirSync(dirPath, { withFileTypes: true });

            for (const entry of entries) {
                const fullPath = path.join(dirPath, entry.name);

                if (entry.isFile() && entry.name.endsWith('.md')) {
                    const relativePath = this.getRelativePath(fullPath);
                    const fileHash = this.computeFileHash(fullPath);

                    if (fileHash) {
                        this.statusStore[relativePath] = {
                            status: 'reviewed',
                            reviewedAt: new Date().toISOString(),
                            fileHashAtReview: fileHash
                        };
                        markedFiles.push(fullPath);
                        changedPaths.push(relativePath);
                    }
                } else if (entry.isDirectory() && recursive && entry.name !== 'archive') {
                    processDirectory(fullPath);
                }
            }
        };

        processDirectory(folderPath);

        if (changedPaths.length > 0) {
            await this.saveToStorage();
            this._onDidChangeStatus.fire(changedPaths);
        }

        return markedFiles;
    }

    /**
     * Get all files that need re-review (modified after being marked reviewed)
     * @returns Array of absolute file paths
     */
    getFilesNeedingReReview(): string[] {
        const files: string[] = [];

        for (const [relativePath, record] of Object.entries(this.statusStore)) {
            if (record.status === 'reviewed') {
                const absolutePath = path.join(this.tasksRoot, relativePath);
                if (safeExists(absolutePath)) {
                    const currentHash = this.computeFileHash(absolutePath);
                    if (currentHash && currentHash !== record.fileHashAtReview) {
                        files.push(absolutePath);
                    }
                }
            }
        }

        return files;
    }

    /**
     * Get statistics about review status
     */
    getStatistics(): { reviewed: number; unreviewed: number; needsReReview: number } {
        let reviewed = 0;
        let needsReReview = 0;

        for (const [relativePath, record] of Object.entries(this.statusStore)) {
            if (record.status === 'reviewed') {
                const absolutePath = path.join(this.tasksRoot, relativePath);
                if (safeExists(absolutePath)) {
                    const currentHash = this.computeFileHash(absolutePath);
                    if (currentHash && currentHash !== record.fileHashAtReview) {
                        needsReReview++;
                    } else {
                        reviewed++;
                    }
                }
            }
        }

        // Note: unreviewed count would require scanning all files, which is expensive
        // Return 0 for now - caller can compute if needed
        return { reviewed, unreviewed: 0, needsReReview };
    }

    /**
     * Clean up orphaned entries (files that no longer exist)
     */
    async cleanupOrphanedEntries(): Promise<number> {
        const orphanedPaths: string[] = [];

        for (const relativePath of Object.keys(this.statusStore)) {
            const absolutePath = path.join(this.tasksRoot, relativePath);
            if (!safeExists(absolutePath)) {
                orphanedPaths.push(relativePath);
            }
        }

        if (orphanedPaths.length > 0) {
            for (const relativePath of orphanedPaths) {
                delete this.statusStore[relativePath];
            }
            await this.saveToStorage();
        }

        return orphanedPaths.length;
    }

    /**
     * Update the tasks root path (e.g., when settings change)
     */
    setTasksRoot(tasksRoot: string): void {
        this.tasksRoot = tasksRoot;
    }

    /**
     * Get relative path from tasks root
     */
    private getRelativePath(absolutePath: string): string {
        // Normalize paths for cross-platform compatibility
        const normalizedAbsolute = path.normalize(absolutePath);
        const normalizedRoot = path.normalize(this.tasksRoot);
        
        if (normalizedAbsolute.startsWith(normalizedRoot)) {
            let relative = normalizedAbsolute.slice(normalizedRoot.length);
            // Remove leading path separator
            if (relative.startsWith(path.sep)) {
                relative = relative.slice(1);
            }
            // Normalize to forward slashes for consistent storage
            return relative.split(path.sep).join('/');
        }
        
        // If not under tasks root, use the full path
        return normalizedAbsolute.split(path.sep).join('/');
    }

    /**
     * Compute MD5 hash of file content
     */
    private computeFileHash(filePath: string): string | null {
        const result = safeReadFile(filePath);
        if (!result.success || result.data === null || result.data === undefined) {
            return null;
        }

        return crypto.createHash('md5').update(result.data).digest('hex');
    }

    /**
     * Load status store from workspace state
     */
    private async loadFromStorage(): Promise<void> {
        if (!this.context) {
            return;
        }

        try {
            const stored = this.context.workspaceState.get<ReviewStatusStore>(STORAGE_KEY, {});
            this.statusStore = stored;
        } catch (error) {
            const logger = getExtensionLogger();
            logger.error(LogCategory.TASKS, 'Failed to load review status from storage', error instanceof Error ? error : new Error(String(error)));
            this.statusStore = {};
        }
    }

    /**
     * Save status store to workspace state
     */
    private async saveToStorage(): Promise<void> {
        if (!this.context) {
            return;
        }

        try {
            await this.context.workspaceState.update(STORAGE_KEY, this.statusStore);
        } catch (error) {
            const logger = getExtensionLogger();
            logger.error(LogCategory.TASKS, 'Failed to save review status to storage', error instanceof Error ? error : new Error(String(error)));
        }
    }

    /**
     * Dispose resources
     */
    dispose(): void {
        this._onDidChangeStatus.dispose();
    }
}
