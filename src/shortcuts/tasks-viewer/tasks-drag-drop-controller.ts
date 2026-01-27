import * as vscode from 'vscode';
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
    type: 'task' | 'document' | 'documentGroup';
    filePaths: string[];
    sourceFolderPath: string;
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
     * Handle drop operation - import external .md files or move internal tasks
     * Accepts drops onto:
     * - Active Tasks group: import external files or move internal tasks to root
     * - TaskFolderItem (non-archived): move internal tasks into feature folder
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

        // Handle external drop (existing behavior)
        // Only allow drops on Active Tasks group
        if (!(target instanceof TaskGroupItem) || target.groupType !== 'active') {
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

        // Import each file
        let successCount = 0;
        let skippedCount = 0;

        for (const uri of mdFiles) {
            if (token.isCancellationRequested) {
                break;
            }

            const result = await this.importFileWithCollisionHandling(uri.fsPath);
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
                ? '1 task imported successfully.'
                : `${successCount} tasks imported successfully.`;
            vscode.window.showInformationMessage(message);
        } else if (skippedCount > 0 && successCount === 0) {
            vscode.window.showInformationMessage('All files were skipped.');
        }
    }

    /**
     * Handle internal drop - move tasks between folders
     */
    private async handleInternalDrop(
        target: vscode.TreeItem | undefined,
        internalDataItem: vscode.DataTransferItem,
        token: vscode.CancellationToken
    ): Promise<void> {
        // Determine target folder
        let targetFolder: string;
        
        if (target instanceof TaskFolderItem) {
            // Reject drops on archived folders
            if (target.folder.isArchived) {
                vscode.window.showWarningMessage('Cannot move tasks to archived folders. Use the archive command instead.');
                return;
            }
            targetFolder = target.folder.folderPath;
        } else if (target instanceof TaskGroupItem && target.groupType === 'active') {
            // Move to tasks root
            targetFolder = this.taskManager.getTasksFolder();
        } else {
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

        // Collect all file paths to move
        const filesToMove: string[] = [];
        for (const dragData of dragDataArray) {
            // Skip if source and target are the same
            if (this.normalizePath(dragData.sourceFolderPath) === this.normalizePath(targetFolder)) {
                continue;
            }
            filesToMove.push(...dragData.filePaths);
        }

        if (filesToMove.length === 0) {
            return;
        }

        // Move files
        let successCount = 0;
        for (const filePath of filesToMove) {
            if (token.isCancellationRequested) {
                break;
            }

            try {
                await this.taskManager.moveTask(filePath, targetFolder);
                successCount++;
            } catch (error) {
                // Log error but continue with other files
                console.error(`Failed to move ${filePath}:`, error);
            }
        }

        if (successCount > 0) {
            this.refreshCallback();
            const message = successCount === 1
                ? '1 task moved successfully.'
                : `${successCount} tasks moved successfully.`;
            vscode.window.showInformationMessage(message);
        }
    }

    /**
     * Normalize a path for comparison
     */
    private normalizePath(filePath: string): string {
        return filePath.replace(/\\/g, '/').toLowerCase();
    }

    /**
     * Import a file with collision handling
     * @returns 'success', 'skipped', or 'error'
     */
    private async importFileWithCollisionHandling(sourcePath: string): Promise<'success' | 'skipped' | 'error'> {
        try {
            // Try to import with original name
            await this.taskManager.importTask(sourcePath);
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
                        if (this.taskManager.taskExists(value.trim())) {
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
                    await this.taskManager.importTask(sourcePath, newName.trim());
                    return 'success';
                } catch {
                    return 'error';
                }
            }
            return 'error';
        }
    }
}

