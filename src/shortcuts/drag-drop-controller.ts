import * as path from 'path';
import * as vscode from 'vscode';
import { FileShortcutItem, FolderShortcutItem, LogicalGroupChildItem, ShortcutItem } from './tree-items';

/**
 * Interface for tracking move operations that can be undone
 */
interface MoveOperation {
    sourcePath: string;
    targetPath: string;
    timestamp: number;
}

/**
 * Drag and drop controller for moving files and folders within the tree views
 * Implements vscode.TreeDragAndDropController interface
 */
export class ShortcutsDragDropController implements vscode.TreeDragAndDropController<ShortcutItem> {
    dropMimeTypes = ['application/vnd.code.tree.shortcutsphysical', 'application/vnd.code.tree.shortcutslogical'];
    dragMimeTypes = ['text/uri-list'];

    private lastMoveOperation: MoveOperation | null = null;
    private static readonly UNDO_TIMEOUT_MS = 60000; // 1 minute timeout for undo
    private refreshCallback?: () => void;

    /**
     * Set the refresh callback to update the tree view after operations
     */
    public setRefreshCallback(callback: () => void): void {
        this.refreshCallback = callback;
    }

    /**
     * Handle drag operation
     * @param source Items being dragged
     * @param dataTransfer Data transfer object to populate
     * @param token Cancellation token
     */
    public async handleDrag(
        source: readonly ShortcutItem[],
        dataTransfer: vscode.DataTransfer,
        token: vscode.CancellationToken
    ): Promise<void> {
        // Only allow dragging files and folders (not logical groups)
        const draggableItems = source.filter(item =>
            item instanceof FolderShortcutItem ||
            item instanceof FileShortcutItem ||
            item instanceof LogicalGroupChildItem
        );

        if (draggableItems.length === 0) {
            return;
        }

        // Store the dragged items as URIs
        const uris = draggableItems.map(item => item.resourceUri);
        dataTransfer.set('text/uri-list', new vscode.DataTransferItem(uris));

        // Also store internal data for more detailed handling
        dataTransfer.set('application/vnd.code.tree.shortcutsphysical',
            new vscode.DataTransferItem(draggableItems));
        dataTransfer.set('application/vnd.code.tree.shortcutslogical',
            new vscode.DataTransferItem(draggableItems));
    }

    /**
     * Handle drop operation
     * @param target Target item where drop occurred (or undefined for root)
     * @param dataTransfer Data transfer object containing dragged data
     * @param token Cancellation token
     */
    public async handleDrop(
        target: ShortcutItem | undefined,
        dataTransfer: vscode.DataTransfer,
        token: vscode.CancellationToken
    ): Promise<void> {
        // Get the dragged items
        const physicalData = dataTransfer.get('application/vnd.code.tree.shortcutsphysical');
        const logicalData = dataTransfer.get('application/vnd.code.tree.shortcutslogical');
        const data = physicalData || logicalData;

        if (!data) {
            return;
        }

        const draggedItems = data.value as ShortcutItem[];
        if (!draggedItems || draggedItems.length === 0) {
            return;
        }

        // Determine the target folder
        let targetFolder: string | undefined;

        if (!target) {
            // Dropped on root - not supported for file moves
            vscode.window.showWarningMessage('Cannot move files to root. Please drop on a folder.');
            return;
        }

        if (target instanceof FolderShortcutItem ||
            (target instanceof LogicalGroupChildItem && target.itemType === 'folder')) {
            // Target is a folder
            targetFolder = target.fsPath;
        } else {
            // Target is a file - use parent folder
            targetFolder = path.dirname(target.fsPath);
        }

        if (!targetFolder) {
            vscode.window.showErrorMessage('Unable to determine target folder.');
            return;
        }

        // Move each dragged item
        for (const item of draggedItems) {
            if (token.isCancellationRequested) {
                break;
            }

            const sourcePath = item.fsPath;
            const fileName = path.basename(sourcePath);
            const targetPath = path.join(targetFolder, fileName);

            // Check if source and target are the same
            if (sourcePath === targetPath) {
                continue;
            }

            // Check if source is parent of target (prevent moving folder into itself)
            if (targetFolder.startsWith(sourcePath + path.sep)) {
                vscode.window.showWarningMessage(
                    `Cannot move "${fileName}" into itself.`
                );
                continue;
            }

            // Check if target already exists
            try {
                await vscode.workspace.fs.stat(vscode.Uri.file(targetPath));
                const overwrite = await vscode.window.showWarningMessage(
                    `"${fileName}" already exists in the target location. Do you want to overwrite it?`,
                    { modal: true },
                    'Overwrite',
                    'Skip'
                );

                if (overwrite !== 'Overwrite') {
                    continue;
                }
            } catch {
                // File doesn't exist, proceed with move
            }

            // Perform the move operation
            try {
                await vscode.workspace.fs.rename(
                    vscode.Uri.file(sourcePath),
                    vscode.Uri.file(targetPath),
                    { overwrite: true }
                );

                // Store the move operation for potential undo
                this.lastMoveOperation = {
                    sourcePath,
                    targetPath,
                    timestamp: Date.now()
                };

                // Refresh the tree view to show changes
                if (this.refreshCallback) {
                    this.refreshCallback();
                }

                // Show success notification with undo hint
                vscode.window.showInformationMessage(
                    `Moved "${fileName}" to "${path.basename(targetFolder)}" (Ctrl+Z to undo)`
                );
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : 'Unknown error';
                vscode.window.showErrorMessage(
                    `Failed to move "${fileName}": ${errorMessage}`
                );
            }
        }
    }

    /**
     * Undo the last move operation if available
     */
    public async undoLastMove(): Promise<void> {
        if (!this.lastMoveOperation) {
            vscode.window.showInformationMessage('No move operation to undo.');
            return;
        }

        // Check if the undo operation is still within the timeout window
        const timeSinceMove = Date.now() - this.lastMoveOperation.timestamp;
        if (timeSinceMove > ShortcutsDragDropController.UNDO_TIMEOUT_MS) {
            vscode.window.showWarningMessage(
                'Cannot undo: Move operation is too old (> 1 minute).'
            );
            this.lastMoveOperation = null;
            return;
        }

        const { sourcePath, targetPath } = this.lastMoveOperation;
        const fileName = path.basename(targetPath);

        try {
            // Check if the target still exists
            await vscode.workspace.fs.stat(vscode.Uri.file(targetPath));

            // Move the file back to its original location
            await vscode.workspace.fs.rename(
                vscode.Uri.file(targetPath),
                vscode.Uri.file(sourcePath),
                { overwrite: true }
            );

            // Refresh the tree view to show changes
            if (this.refreshCallback) {
                this.refreshCallback();
            }

            vscode.window.showInformationMessage(
                `Undid move: "${fileName}" restored to original location`
            );

            // Clear the undo history after successful undo
            this.lastMoveOperation = null;
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            vscode.window.showErrorMessage(
                `Failed to undo move for "${fileName}": ${errorMessage}`
            );
            // Clear the operation since it can't be undone
            this.lastMoveOperation = null;
        }
    }

    /**
     * Check if there's a move operation that can be undone
     */
    public canUndo(): boolean {
        if (!this.lastMoveOperation) {
            return false;
        }
        const timeSinceMove = Date.now() - this.lastMoveOperation.timestamp;
        return timeSinceMove <= ShortcutsDragDropController.UNDO_TIMEOUT_MS;
    }
}
