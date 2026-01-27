import * as vscode from 'vscode';
import { TaskItem } from './task-item';
import { TaskDocumentItem } from './task-document-item';
import { TaskDocumentGroupItem } from './task-document-group-item';
import { TaskGroupItem } from './task-group-item';
import { TaskManager } from './task-manager';

/**
 * Drag and drop controller for the Tasks tree view
 * Enables dragging task files to external targets like Copilot Chat
 * and dropping external .md files onto the Active Tasks group
 */
export class TasksDragDropController implements vscode.TreeDragAndDropController<vscode.TreeItem> {
    /**
     * MIME types that can be dragged from this tree
     * text/uri-list is required for Copilot Chat integration
     */
    readonly dragMimeTypes = ['text/uri-list'];

    /**
     * MIME types that can be dropped onto this tree
     * text/uri-list enables dropping external files
     */
    readonly dropMimeTypes = ['text/uri-list'];

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

        for (const item of source) {
            // Handle TaskItem (task files)
            if (item instanceof TaskItem) {
                uris.push(vscode.Uri.file(item.filePath));
            }
            // Handle TaskDocumentItem (document within a group)
            else if (item instanceof TaskDocumentItem) {
                uris.push(vscode.Uri.file(item.filePath));
            }
            // Handle TaskDocumentGroupItem (all documents in the group)
            else if (item instanceof TaskDocumentGroupItem) {
                for (const doc of item.documents) {
                    uris.push(vscode.Uri.file(doc.filePath));
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
        }
    }

    /**
     * Handle drop operation - import external .md files into Active Tasks
     * Only accepts drops onto the Active Tasks group
     */
    public async handleDrop(
        target: vscode.TreeItem | undefined,
        dataTransfer: vscode.DataTransfer,
        token: vscode.CancellationToken
    ): Promise<void> {
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

