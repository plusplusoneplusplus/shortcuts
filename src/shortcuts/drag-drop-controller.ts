import * as path from 'path';
import * as vscode from 'vscode';
import { ConfigurationManager } from './configuration-manager';
import { NotificationManager } from './notification-manager';
import { getExtensionLogger, LogCategory } from './shared';
import { FileShortcutItem, FolderShortcutItem, LogicalGroupChildItem, LogicalGroupItem, NoteShortcutItem, ShortcutItem } from './tree-items';

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
    dropMimeTypes = ['application/vnd.code.tree.shortcutsphysical', 'application/vnd.code.tree.shortcutslogical', 'text/uri-list'];
    dragMimeTypes = ['application/vnd.code.tree.shortcutsphysical', 'application/vnd.code.tree.shortcutslogical', 'text/uri-list'];

    private lastMoveOperation: MoveOperation | null = null;
    private static readonly UNDO_TIMEOUT_MS = 60000; // 1 minute timeout for undo
    private refreshCallback?: () => void;
    private configurationManager?: ConfigurationManager;

    /**
     * Set the refresh callback to update the tree view after operations
     */
    public setRefreshCallback(callback: () => void): void {
        this.refreshCallback = callback;
    }

    /**
     * Set the configuration manager for adding items to groups
     */
    public setConfigurationManager(configManager: ConfigurationManager): void {
        this.configurationManager = configManager;
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
        console.log('[DRAG-DROP] handleDrag called:', {
            sourceCount: source.length,
            sourceTypes: source.map(item => item.constructor.name)
        });

        // Only allow dragging files, folders, and notes (not logical groups)
        const draggableItems = source.filter(item =>
            item instanceof FolderShortcutItem ||
            item instanceof FileShortcutItem ||
            item instanceof LogicalGroupChildItem ||
            item instanceof NoteShortcutItem
        );

        console.log('[DRAG-DROP] Draggable items:', {
            count: draggableItems.length,
            types: draggableItems.map(item => item.constructor.name)
        });

        if (draggableItems.length === 0) {
            console.log('[DRAG-DROP] No draggable items, returning');
            return;
        }

        // Store the dragged items as URIs (only for items with resourceUri)
        const uris = draggableItems
            .filter(item => item instanceof FolderShortcutItem ||
                           item instanceof FileShortcutItem ||
                           item instanceof LogicalGroupChildItem)
            .map(item => item.resourceUri);

        if (uris.length > 0) {
            dataTransfer.set('text/uri-list', new vscode.DataTransferItem(uris));
        }

        // Also store internal data for more detailed handling (includes notes)
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
        // Check if dropping onto a logical group or nested group
        if (target instanceof LogicalGroupItem) {
            await this.handleDropOntoLogicalGroup(target, dataTransfer, token);
            return;
        }

        // Get the dragged items from internal tree first
        const physicalData = dataTransfer.get('application/vnd.code.tree.shortcutsphysical');
        const logicalData = dataTransfer.get('application/vnd.code.tree.shortcutslogical');
        const internalData = physicalData || logicalData;

        // If we have internal data, handle as internal move
        if (internalData) {
            const draggedItems = internalData.value as ShortcutItem[];
            if (draggedItems && draggedItems.length > 0) {
                // Handle physical file system moves
                await this.handlePhysicalFileMove(target, draggedItems, token);
                return;
            }
        }

        // Check if dropping external files (from explorer)
        const uriListData = dataTransfer.get('text/uri-list');
        if (uriListData) {
            // Handle external file drops
            await this.handleExternalFileDrop(target, uriListData, token);
            return;
        }
    }

    /**
     * Handle dropping files onto a logical group
     */
    private async handleDropOntoLogicalGroup(
        groupItem: LogicalGroupItem,
        dataTransfer: vscode.DataTransfer,
        token: vscode.CancellationToken
    ): Promise<void> {
        if (!this.configurationManager) {
            NotificationManager.showError('Configuration manager not initialized');
            return;
        }

        // Build the full group path for nested groups (needed early for note moves)
        const targetGroupPath = groupItem.parentGroupPath
            ? `${groupItem.parentGroupPath}/${groupItem.originalName}`
            : groupItem.originalName;

        console.log('[DRAG-DROP] Drop onto logical group:', {
            groupName: groupItem.originalName,
            parentGroupPath: groupItem.parentGroupPath,
            targetGroupPath
        });

        // Check for external files (from explorer)
        const uriListData = dataTransfer.get('text/uri-list');
        let uris: vscode.Uri[] = [];
        let isFromInternalTree = false;
        let sourceGroupItems: LogicalGroupChildItem[] = [];

        if (uriListData) {
            // Handle external URIs (from VS Code explorer or other sources)
            const uriList = uriListData.value;
            console.log('URI list data type:', typeof uriList, 'value:', uriList);

            // Handle different URI formats
            if (typeof uriList === 'string') {
                // String format: parse newline-separated URIs
                const uriStrings = uriList.split('\n').filter(s => s.trim());
                uris = uriStrings.map(s => vscode.Uri.parse(s.trim()));
            } else if (Array.isArray(uriList)) {
                uris = uriList;
            } else if (uriList && typeof uriList === 'object' && 'fsPath' in uriList) {
                // Single URI object
                uris = [uriList as vscode.Uri];
            } else {
                console.warn('Unknown URI list format:', uriList);
            }
        }

        // Check for internal items being moved to a different group
        if (uris.length === 0) {
            const physicalData = dataTransfer.get('application/vnd.code.tree.shortcutsphysical');
            const logicalData = dataTransfer.get('application/vnd.code.tree.shortcutslogical');
            const internalData = physicalData || logicalData;

            console.log('[DRAG-DROP] Checking internal data:', {
                hasPhysicalData: !!physicalData,
                hasLogicalData: !!logicalData,
                hasInternalData: !!internalData
            });

            if (!internalData) {
                console.log('[DRAG-DROP] No internal data found, returning');
                return;
            }

            const draggedItems = internalData.value as ShortcutItem[];
            console.log('[DRAG-DROP] Dragged items:', {
                count: draggedItems?.length || 0,
                types: draggedItems?.map(item => item.constructor.name) || []
            });

            if (!draggedItems || draggedItems.length === 0) {
                console.log('[DRAG-DROP] No dragged items, returning');
                return;
            }

            isFromInternalTree = true;

            // Separate notes from files/folders
            const noteItems = draggedItems.filter(item => item instanceof NoteShortcutItem) as unknown as NoteShortcutItem[];

            console.log('[DRAG-DROP] Note items found:', {
                count: noteItems.length,
                notes: noteItems.map(n => ({ label: n.label, noteId: n.noteId, parentGroup: n.parentGroup }))
            });

            // Handle note moves separately
            if (noteItems.length > 0) {
                console.log('[DRAG-DROP] Calling handleNoteMove');
                await this.handleNoteMove(noteItems, targetGroupPath);
                return;
            }

            // Convert file/folder items to URIs
            uris = draggedItems
                .filter(item => item instanceof LogicalGroupChildItem ||
                    item instanceof FolderShortcutItem ||
                    item instanceof FileShortcutItem)
                .map(item => item.resourceUri);

            // Track source group items for move operations
            sourceGroupItems = draggedItems.filter(item => item instanceof LogicalGroupChildItem) as LogicalGroupChildItem[];
        }

        if (uris.length === 0) {
            console.warn('No URIs to process');
            return;
        }

        // Determine if we should move or copy
        let shouldMove = false;
        if (isFromInternalTree && sourceGroupItems.length > 0) {
            // Check if moving between groups
            for (const sourceItem of sourceGroupItems) {
                if (sourceItem.parentGroup !== targetGroupPath) {
                    // Moving to a different group - always move (remove from source)
                    shouldMove = true;
                    break;
                }
            }
        }

        let addedCount = 0;
        let skippedCount = 0;

        // Add each file/folder to the logical group
        for (const uri of uris) {
            if (token.isCancellationRequested) {
                break;
            }

            try {
                const fs = require('fs');
                const fsPath = uri.fsPath;

                if (!fs.existsSync(fsPath)) {
                    console.warn(`Path does not exist: ${fsPath}`);
                    skippedCount++;
                    continue;
                }

                const stat = fs.statSync(fsPath);
                const itemType = stat.isDirectory() ? 'folder' : 'file';
                const itemName = path.basename(fsPath);

                // Try to add to target group
                await this.configurationManager.addToLogicalGroup(
                    targetGroupPath,
                    fsPath,
                    itemName,
                    itemType
                );

                addedCount++;
            } catch (error) {
                console.warn(`Failed to add ${uri.fsPath} to group:`, error);
                skippedCount++;
            }
        }

        // If we should move, remove from source groups
        if (shouldMove && sourceGroupItems.length > 0) {
            for (const sourceItem of sourceGroupItems) {
                if (sourceItem.parentGroup !== targetGroupPath) {
                    try {
                        await this.configurationManager.removeFromLogicalGroup(
                            sourceItem.parentGroup,
                            sourceItem.fsPath
                        );
                    } catch (error) {
                        console.warn(`Failed to remove item from source group: ${error}`);
                    }
                }
            }
        }

        // Refresh the tree view
        if (this.refreshCallback) {
            this.refreshCallback();
        }

        // Show result notification
        if (addedCount > 0 && skippedCount === 0) {
            const itemText = addedCount === 1 ? 'item' : 'items';
            const action = shouldMove ? 'moved to' : 'added to';
            NotificationManager.showInfo(`${addedCount} ${itemText} ${action} group "${groupItem.originalName}"`);
        } else if (addedCount > 0 && skippedCount > 0) {
            NotificationManager.showWarning(`${addedCount} items added, ${skippedCount} items skipped (may already exist)`);
        } else if (skippedCount > 0) {
            NotificationManager.showWarning('No items were added. They may already exist in the group.');
        }
    }

    /**
     * Handle moving notes between logical groups
     */
    private async handleNoteMove(
        noteItems: NoteShortcutItem[],
        targetGroupPath: string
    ): Promise<void> {
        if (!this.configurationManager) {
            NotificationManager.showError('Configuration manager not initialized');
            return;
        }

        console.log('[DRAG-DROP] handleNoteMove called:', {
            noteCount: noteItems.length,
            targetGroupPath,
            notes: noteItems.map(n => ({
                label: n.label,
                noteId: n.noteId,
                parentGroup: n.parentGroup
            }))
        });

        let movedCount = 0;
        let skippedCount = 0;

        for (const noteItem of noteItems) {
            // Check if moving to a different group
            if (noteItem.parentGroup === targetGroupPath) {
                console.log(`[DRAG-DROP] Note "${noteItem.label}" is already in target group, skipping`);
                skippedCount++;
                continue;
            }

            try {
                console.log(`[DRAG-DROP] Moving note "${noteItem.label}" from "${noteItem.parentGroup}" to "${targetGroupPath}"`);
                // Move the note to the target group
                await this.configurationManager.moveNote(
                    noteItem.parentGroup,
                    targetGroupPath,
                    noteItem.noteId
                );
                console.log(`[DRAG-DROP] Successfully moved note "${noteItem.label}"`);
                movedCount++;
            } catch (error) {
                getExtensionLogger().error(LogCategory.EXTENSION, `[DRAG-DROP] Failed to move note "${noteItem.label}"`, error instanceof Error ? error : undefined);
                skippedCount++;
            }
        }

        // Refresh the tree view
        if (this.refreshCallback) {
            this.refreshCallback();
        }

        // Show result notification
        if (movedCount > 0 && skippedCount === 0) {
            const itemText = movedCount === 1 ? 'note' : 'notes';
            NotificationManager.showInfo(`${movedCount} ${itemText} moved successfully`);
        } else if (movedCount > 0 && skippedCount > 0) {
            NotificationManager.showWarning(`${movedCount} notes moved, ${skippedCount} notes skipped`);
        } else if (skippedCount > 0) {
            NotificationManager.showWarning('No notes were moved. They may already be in the target group.');
        }
    }

    /**
     * Get the parent group path from a full group path
     * E.g., "Parent/Child" -> "Parent", "Parent/Child/Grandchild" -> "Parent/Child"
     */
    private getParentGroupPath(groupPath: string): string | null {
        const parts = groupPath.split('/');
        if (parts.length <= 1) {
            return null; // Top-level group has no parent
        }
        return parts.slice(0, -1).join('/');
    }

    /**
     * Handle dropping external files (from explorer) onto folders
     */
    private async handleExternalFileDrop(
        target: ShortcutItem | undefined,
        uriListData: vscode.DataTransferItem,
        token: vscode.CancellationToken
    ): Promise<void> {
        if (!target) {
            NotificationManager.showWarning('Cannot drop files here. Please drop on a folder or group.');
            return;
        }

        // Determine target folder
        let targetFolder: string | undefined;

        if (target instanceof FolderShortcutItem ||
            (target instanceof LogicalGroupChildItem && target.itemType === 'folder')) {
            targetFolder = target.fsPath;
        } else if (target instanceof FileShortcutItem ||
            (target instanceof LogicalGroupChildItem && target.itemType === 'file')) {
            targetFolder = path.dirname(target.fsPath);
        }

        if (!targetFolder) {
            NotificationManager.showError('Unable to determine target folder.');
            return;
        }

        const uriList = uriListData.value as vscode.Uri[];
        const uris = Array.isArray(uriList) ? uriList : [uriList];

        // Copy files to target folder
        let copiedCount = 0;
        for (const uri of uris) {
            if (token.isCancellationRequested) {
                break;
            }

            const fileName = path.basename(uri.fsPath);
            const targetPath = path.join(targetFolder, fileName);

            try {
                await vscode.workspace.fs.copy(
                    uri,
                    vscode.Uri.file(targetPath),
                    { overwrite: false }
                );
                copiedCount++;
            } catch (error) {
                console.warn(`Failed to copy ${fileName}:`, error);
            }
        }

        if (copiedCount > 0) {
            if (this.refreshCallback) {
                this.refreshCallback();
            }
            const itemText = copiedCount === 1 ? 'file' : 'files';
            NotificationManager.showInfo(`${copiedCount} ${itemText} copied to ${path.basename(targetFolder)}`);
        }
    }

    /**
     * Handle physical file system moves
     */
    private async handlePhysicalFileMove(
        target: ShortcutItem | undefined,
        draggedItems: ShortcutItem[],
        token: vscode.CancellationToken
    ): Promise<void> {
        // Determine the target folder
        let targetFolder: string | undefined;

        if (!target) {
            // Dropped on root - not supported for file moves
            NotificationManager.showWarning('Cannot move files to root. Please drop on a folder.');
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
            NotificationManager.showError('Unable to determine target folder.');
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
                NotificationManager.showWarning(
                    `Cannot move "${fileName}" into itself.`
                );
                continue;
            }

            // Check if target already exists
            try {
                await vscode.workspace.fs.stat(vscode.Uri.file(targetPath));
                const overwrite = await NotificationManager.showWarning(
                    `"${fileName}" already exists in the target location. Do you want to overwrite it?`,
                    { timeout: 0, actions: ['Overwrite', 'Skip'] }
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
                NotificationManager.showInfo(
                    `Moved "${fileName}" to "${path.basename(targetFolder)}" (Ctrl+Z to undo)`
                );
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : 'Unknown error';
                NotificationManager.showError(
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
            NotificationManager.showInfo('No move operation to undo.');
            return;
        }

        // Check if the undo operation is still within the timeout window
        const timeSinceMove = Date.now() - this.lastMoveOperation.timestamp;
        if (timeSinceMove > ShortcutsDragDropController.UNDO_TIMEOUT_MS) {
            NotificationManager.showWarning(
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

            NotificationManager.showInfo(
                `Undid move: "${fileName}" restored to original location`
            );

            // Clear the undo history after successful undo
            this.lastMoveOperation = null;
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            NotificationManager.showError(
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
