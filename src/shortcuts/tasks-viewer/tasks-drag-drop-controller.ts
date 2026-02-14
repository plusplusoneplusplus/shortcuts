import * as vscode from 'vscode';
import * as path from 'path';
import { safeExists, safeRename } from '../shared';
import { TaskItem } from './task-item';
import { TaskDocumentItem } from './task-document-item';
import { TaskDocumentGroupItem } from './task-document-group-item';
import { TaskGroupItem } from './task-group-item';
import { TaskFolderItem } from './task-folder-item';
import { TaskManager } from './task-manager';

/**
 * Custom MIME type for internal drag operations within the tasks tree
 */
const INTERNAL_DRAG_MIME_TYPE = 'application/vnd.code.tree.tasksView';

/**
 * Internal drag data structure
 */
interface InternalDragData {
    type: 'task' | 'document' | 'documentGroup' | 'folder';
    filePaths: string[];
    sourceFolderPath: string;
    /** For folder drags: the absolute path of the folder being dragged */
    draggedFolderPath?: string;
}

/**
 * Represents a single move operation that can be undone.
 * For file moves: sourcePath is the original file, targetPath is where it was moved.
 * For folder moves: sourcePath is the original folder, targetPath is the new folder location.
 */
interface TaskMoveOperation {
    type: 'file' | 'folder';
    /** Original path before the move */
    sourcePath: string;
    /** Path after the move */
    targetPath: string;
    /** Timestamp when the move occurred */
    timestamp: number;
}

/**
 * Represents a batch of move operations from a single drag-and-drop action.
 * All operations in a batch are undone together.
 */
interface TaskMoveUndoEntry {
    operations: TaskMoveOperation[];
    timestamp: number;
}

/**
 * Drag and drop controller for the Tasks tree view
 * Enables dragging task files to external targets like Copilot Chat,
 * dropping external .md files onto the Active Tasks group,
 * and moving tasks between folders within the tree
 */
export class TasksDragDropController implements vscode.TreeDragAndDropController<vscode.TreeItem> {
    /**
     * MIME types that can be dragged from this tree
     * text/uri-list is required for Copilot Chat integration
     * Custom MIME type for internal drag operations
     */
    readonly dragMimeTypes = ['text/uri-list', INTERNAL_DRAG_MIME_TYPE];

    /**
     * MIME types that can be dropped onto this tree
     * text/uri-list enables dropping external files
     * Custom MIME type for internal drag operations
     */
    readonly dropMimeTypes = ['text/uri-list', INTERNAL_DRAG_MIME_TYPE];

    /** Undo timeout: operations older than this cannot be undone */
    private static readonly UNDO_TIMEOUT_MS = 60000; // 1 minute

    /** Last move batch that can be undone */
    private lastUndoEntry: TaskMoveUndoEntry | null = null;

    constructor(private taskManager: TaskManager, private refreshCallback: () => void) {}

    /**
     * Handle drag operation - populate data transfer with file URIs
     * @param source Items being dragged
     * @param dataTransfer Data transfer object to populate
     * @param token Cancellation token
     */
    public async handleDrag(
        source: readonly vscode.TreeItem[],
        dataTransfer: vscode.DataTransfer,
        _token: vscode.CancellationToken
    ): Promise<void> {
        // Collect URIs from draggable items
        const uris: vscode.Uri[] = [];
        const internalDragData: InternalDragData[] = [];

        for (const item of source) {
            // Handle TaskItem (task files)
            if (item instanceof TaskItem) {
                uris.push(vscode.Uri.file(item.filePath));
                internalDragData.push({
                    type: 'task',
                    filePaths: [item.filePath],
                    sourceFolderPath: this.getParentFolder(item.filePath)
                });
            }
            // Handle TaskDocumentItem (document within a group)
            else if (item instanceof TaskDocumentItem) {
                uris.push(vscode.Uri.file(item.filePath));
                internalDragData.push({
                    type: 'document',
                    filePaths: [item.filePath],
                    sourceFolderPath: this.getParentFolder(item.filePath)
                });
            }
            // Handle TaskDocumentGroupItem (all documents in the group)
            else if (item instanceof TaskDocumentGroupItem) {
                const filePaths = item.documents.map(doc => doc.filePath);
                for (const doc of item.documents) {
                    uris.push(vscode.Uri.file(doc.filePath));
                }
                internalDragData.push({
                    type: 'documentGroup',
                    filePaths,
                    sourceFolderPath: item.folderPath
                });
            }
            // Handle TaskFolderItem (entire folder)
            else if (item instanceof TaskFolderItem) {
                // Only allow dragging non-archived folders
                if (!item.folder.isArchived) {
                    uris.push(vscode.Uri.file(item.folder.folderPath));
                    internalDragData.push({
                        type: 'folder',
                        filePaths: [],
                        sourceFolderPath: this.getParentFolder(item.folder.folderPath),
                        draggedFolderPath: item.folder.folderPath
                    });
                }
            }
            // Handle any item with resourceUri (fallback)
            else if (item.resourceUri) {
                uris.push(item.resourceUri);
            }
        }

        if (uris.length > 0) {
            // Set text/uri-list for compatibility with Copilot Chat and other drop targets
            // The uri-list format is one URI per line
            const uriListString = uris.map(uri => uri.toString()).join('\r\n');
            dataTransfer.set('text/uri-list', new vscode.DataTransferItem(uriListString));

            // Set internal drag data for tree rearrangement
            if (internalDragData.length > 0) {
                dataTransfer.set(INTERNAL_DRAG_MIME_TYPE, new vscode.DataTransferItem(JSON.stringify(internalDragData)));
            }
        }
    }

    /**
     * Get the parent folder path from a file path
     */
    private getParentFolder(filePath: string): string {
        const parts = filePath.split(/[/\\]/);
        parts.pop(); // Remove filename
        return parts.join('/');
    }

    /**
     * Handle drop operation - move external .md files or move internal tasks
     * Accepts drops onto:
     * - Active Tasks group: move external files to root or move internal tasks to root
     * - TaskFolderItem (non-archived): move external/internal files into feature folder
     */
    public async handleDrop(
        target: vscode.TreeItem | undefined,
        dataTransfer: vscode.DataTransfer,
        token: vscode.CancellationToken
    ): Promise<void> {
        // Check for internal drag first
        const internalData = dataTransfer.get(INTERNAL_DRAG_MIME_TYPE);
        if (internalData) {
            await this.handleInternalDrop(target, internalData, token);
            return;
        }

        // Determine target folder for external drops
        let targetFolder: string | undefined;

        if (target instanceof TaskGroupItem && target.groupType === 'active') {
            // Drop on Active Tasks group → tasks root
            targetFolder = this.taskManager.getTasksFolder();
        } else if (target instanceof TaskFolderItem && !target.folder.isArchived) {
            // Drop on non-archived feature folder
            targetFolder = target.folder.folderPath;
        } else {
            // Reject drops on archived folders, archived group, or other targets
            return;
        }

        // Get dropped URIs
        const uriListItem = dataTransfer.get('text/uri-list');
        if (!uriListItem) {
            return;
        }

        const uriListString = await uriListItem.asString();
        if (!uriListString) {
            return;
        }

        // Parse URIs from text/uri-list format (one URI per line)
        const uris = uriListString
            .split(/\r?\n/)
            .filter(line => line.trim().length > 0)
            .map(line => {
                try {
                    return vscode.Uri.parse(line.trim());
                } catch {
                    return null;
                }
            })
            .filter((uri): uri is vscode.Uri => uri !== null);

        // Filter to only .md files with file scheme
        const mdFiles = uris.filter(uri => 
            uri.scheme === 'file' && uri.fsPath.toLowerCase().endsWith('.md')
        );

        if (mdFiles.length === 0) {
            vscode.window.showInformationMessage('No markdown files found in the dropped items.');
            return;
        }

        // Move each file (move semantics - source is deleted)
        let successCount = 0;
        let skippedCount = 0;

        for (const uri of mdFiles) {
            if (token.isCancellationRequested) {
                break;
            }

            const result = await this.moveFileWithCollisionHandling(uri.fsPath, targetFolder);
            if (result === 'success') {
                successCount++;
            } else if (result === 'skipped') {
                skippedCount++;
            }
        }

        // Show result notification
        if (successCount > 0) {
            this.refreshCallback();
            const message = successCount === 1
                ? '1 task moved successfully.'
                : `${successCount} tasks moved successfully.`;
            vscode.window.showInformationMessage(message);
        } else if (skippedCount > 0 && successCount === 0) {
            vscode.window.showInformationMessage('All files were skipped.');
        }
    }

    /**
     * Handle internal drop - move tasks/folders between folders or archive tasks
     */
    private async handleInternalDrop(
        target: vscode.TreeItem | undefined,
        internalDataItem: vscode.DataTransferItem,
        token: vscode.CancellationToken
    ): Promise<void> {
        // Determine if this is an archive drop or a regular move
        const isArchiveDrop = this.isArchiveDropTarget(target);
        
        // Determine target folder
        let targetFolder: string | undefined;
        
        if (target instanceof TaskFolderItem) {
            if (target.folder.isArchived && !isArchiveDrop) {
                // Should not happen since isArchiveDrop checks this, but safety check
                vscode.window.showWarningMessage('Cannot move tasks to archived folders. Use the archive command instead.');
                return;
            }
            targetFolder = target.folder.folderPath;
        } else if (target instanceof TaskGroupItem) {
            if (target.groupType === 'active') {
                // Move to tasks root
                targetFolder = this.taskManager.getTasksFolder();
            } else if (target.groupType === 'archived') {
                // Archive drop - target is archive root
                targetFolder = this.taskManager.getArchiveFolder();
            }
        }
        
        if (!targetFolder) {
            // Invalid drop target
            return;
        }

        // Parse internal drag data
        const dataString = await internalDataItem.asString();
        if (!dataString) {
            return;
        }

        let dragDataArray: InternalDragData[];
        try {
            dragDataArray = JSON.parse(dataString);
        } catch {
            return;
        }

        // Separate folder drags from file drags
        const folderDrags = dragDataArray.filter(d => d.type === 'folder' && d.draggedFolderPath);
        const fileDrags = dragDataArray.filter(d => d.type !== 'folder');

        let successCount = 0;
        const completedOperations: TaskMoveOperation[] = [];

        // Process folder drags
        for (const dragData of folderDrags) {
            if (token.isCancellationRequested) {
                break;
            }

            const folderPath = dragData.draggedFolderPath!;

            // Archiving folders via drag is not supported — use the archive command
            if (isArchiveDrop) {
                vscode.window.showWarningMessage('Archiving folders via drag-and-drop is not supported. Use the archive command instead.');
                continue;
            }

            // Skip if source parent and target are the same (no-op)
            if (this.normalizePath(dragData.sourceFolderPath) === this.normalizePath(targetFolder)) {
                continue;
            }

            try {
                const newPath = await this.taskManager.moveFolder(folderPath, targetFolder);
                completedOperations.push({
                    type: 'folder',
                    sourcePath: folderPath,
                    targetPath: newPath,
                    timestamp: Date.now()
                });
                successCount++;
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : String(error);
                if (errorMessage.includes('Cannot move a folder into itself')) {
                    vscode.window.showWarningMessage('Cannot move a folder into itself or its own subfolder.');
                } else {
                    console.error(`Failed to move folder ${folderPath}:`, error);
                    vscode.window.showErrorMessage(`Failed to move folder: ${errorMessage}`);
                }
            }
        }

        // Collect all file paths to process
        const filesToProcess: string[] = [];
        for (const dragData of fileDrags) {
            // For archive drops, skip files already in archive
            if (isArchiveDrop) {
                const archiveFolder = this.taskManager.getArchiveFolder();
                const normalizedSource = this.normalizePath(dragData.sourceFolderPath);
                const normalizedArchive = this.normalizePath(archiveFolder);
                if (normalizedSource.startsWith(normalizedArchive) || normalizedSource === normalizedArchive) {
                    continue; // Already archived
                }
            } else {
                // For regular moves, skip if source and target are the same
                if (this.normalizePath(dragData.sourceFolderPath) === this.normalizePath(targetFolder)) {
                    continue;
                }
            }
            filesToProcess.push(...dragData.filePaths);
        }

        // Process files
        for (const filePath of filesToProcess) {
            if (token.isCancellationRequested) {
                break;
            }

            try {
                if (isArchiveDrop) {
                    // Archive the task, preserving folder structure
                    // Note: archive operations are not undoable via this mechanism
                    await this.taskManager.archiveTask(filePath, true);
                } else {
                    // Regular move — track for undo
                    const newPath = await this.taskManager.moveTask(filePath, targetFolder);
                    completedOperations.push({
                        type: 'file',
                        sourcePath: filePath,
                        targetPath: newPath,
                        timestamp: Date.now()
                    });
                }
                successCount++;
            } catch (error) {
                // Log error but continue with other files
                console.error(`Failed to ${isArchiveDrop ? 'archive' : 'move'} ${filePath}:`, error);
            }
        }

        // Store completed non-archive operations for undo
        if (completedOperations.length > 0) {
            this.lastUndoEntry = {
                operations: completedOperations,
                timestamp: Date.now()
            };
        }

        if (successCount > 0) {
            this.refreshCallback();
            if (isArchiveDrop) {
                const message = successCount === 1
                    ? '1 item archived successfully.'
                    : `${successCount} items archived successfully.`;
                vscode.window.showInformationMessage(message);
            } else {
                const message = successCount === 1
                    ? '1 item moved successfully.'
                    : `${successCount} items moved successfully.`;
                vscode.window.showInformationMessage(message);
            }
        }
    }
    
    /**
     * Check if the drop target is an archive target (Archived group or archived folder)
     */
    private isArchiveDropTarget(target: vscode.TreeItem | undefined): boolean {
        if (target instanceof TaskGroupItem && target.groupType === 'archived') {
            return true;
        }
        if (target instanceof TaskFolderItem && target.folder.isArchived) {
            return true;
        }
        return false;
    }

    /**
     * Normalize a path for comparison
     */
    private normalizePath(filePath: string): string {
        return filePath.replace(/\\/g, '/').toLowerCase();
    }

    /**
     * Move a file into the tasks folder with collision handling
     * Uses move semantics (source file is deleted after successful move)
     * @param sourcePath - Path to the source file
     * @param targetFolder - Absolute path to the target folder
     * @returns 'success', 'skipped', or 'error'
     */
    private async moveFileWithCollisionHandling(sourcePath: string, targetFolder: string): Promise<'success' | 'skipped' | 'error'> {
        try {
            // Try to move with original name
            await this.taskManager.moveExternalTask(sourcePath, targetFolder);
            return 'success';
        } catch (error) {
            // Check if it's a name collision error
            if (error instanceof Error && error.message.includes('already exists')) {
                // Prompt user for new name
                const newName = await vscode.window.showInputBox({
                    prompt: `A task with this name already exists. Enter a new name:`,
                    placeHolder: 'New task name',
                    validateInput: async (value) => {
                        if (!value || value.trim().length === 0) {
                            return 'Name cannot be empty';
                        }
                        // Check if the new name also conflicts
                        if (this.taskManager.taskExistsInFolder(value.trim(), targetFolder)) {
                            return `Task "${value.trim()}" already exists`;
                        }
                        return null;
                    }
                });

                if (!newName) {
                    // User cancelled
                    return 'skipped';
                }

                try {
                    await this.taskManager.moveExternalTask(sourcePath, targetFolder, newName.trim());
                    return 'success';
                } catch {
                    return 'error';
                }
            }
            return 'error';
        }
    }

    // =========================================================================
    // Undo Support
    // =========================================================================

    /**
     * Check whether the last move operation can be undone.
     * Returns false if there is no recorded operation or if it has expired.
     */
    public canUndo(): boolean {
        if (!this.lastUndoEntry) {
            return false;
        }
        const elapsed = Date.now() - this.lastUndoEntry.timestamp;
        return elapsed <= TasksDragDropController.UNDO_TIMEOUT_MS;
    }

    /**
     * Undo the last move operation (or batch of operations).
     * Moves are reversed in reverse order so that dependencies are satisfied
     * (e.g., a folder that was moved first is moved back last).
     */
    public async undoLastMove(): Promise<void> {
        if (!this.lastUndoEntry) {
            vscode.window.showInformationMessage('No move operation to undo.');
            return;
        }

        const elapsed = Date.now() - this.lastUndoEntry.timestamp;
        if (elapsed > TasksDragDropController.UNDO_TIMEOUT_MS) {
            vscode.window.showWarningMessage('Cannot undo: the move operation is too old (> 1 minute).');
            this.lastUndoEntry = null;
            return;
        }

        const { operations } = this.lastUndoEntry;
        let successCount = 0;
        let failCount = 0;

        // Reverse the operations so the last move is undone first
        for (let i = operations.length - 1; i >= 0; i--) {
            const op = operations[i];

            try {
                // Verify the target (current location) still exists
                if (!safeExists(op.targetPath)) {
                    console.warn(`Undo skipped: target no longer exists at ${op.targetPath}`);
                    failCount++;
                    continue;
                }

                // Verify the original location's parent directory still exists
                const sourceParent = path.dirname(op.sourcePath);
                if (!safeExists(sourceParent)) {
                    // Recreate the parent directory if it was removed
                    const { ensureDirectoryExists } = await import('../shared');
                    ensureDirectoryExists(sourceParent);
                }

                // Move back to original location
                safeRename(op.targetPath, op.sourcePath);
                successCount++;
            } catch (error) {
                console.error(`Failed to undo move of ${op.targetPath} → ${op.sourcePath}:`, error);
                failCount++;
            }
        }

        // Clear the undo entry regardless of outcome
        this.lastUndoEntry = null;

        if (successCount > 0) {
            this.refreshCallback();
            if (failCount > 0) {
                vscode.window.showWarningMessage(
                    `Undo partially completed: ${successCount} item(s) restored, ${failCount} failed.`
                );
            } else {
                const message = successCount === 1
                    ? 'Move undone — 1 item restored to its original location.'
                    : `Move undone — ${successCount} items restored to their original locations.`;
                vscode.window.showInformationMessage(message);
            }
        } else if (failCount > 0) {
            vscode.window.showErrorMessage('Undo failed: could not restore any items to their original locations.');
        }
    }
}

