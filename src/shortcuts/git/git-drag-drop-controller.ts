import * as vscode from 'vscode';
import { GitChangeItem } from './git-change-item';
import { GitCommitFileItem } from './git-commit-file-item';

/**
 * Drag and drop controller for the Git tree view
 * Enables dragging files to external targets like Copilot Chat
 */
export class GitDragDropController implements vscode.TreeDragAndDropController<vscode.TreeItem> {
    /**
     * MIME types that can be dragged from this tree
     * text/uri-list is required for Copilot Chat integration
     */
    readonly dragMimeTypes = ['text/uri-list'];

    /**
     * MIME types that can be dropped onto this tree
     * Currently we don't support dropping onto the git tree
     */
    readonly dropMimeTypes: string[] = [];

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
            // Handle GitChangeItem (files in staged/unstaged/untracked sections)
            if (item instanceof GitChangeItem && item.change?.uri) {
                uris.push(item.change.uri);
            }
            // Handle GitCommitFileItem (files in commit history)
            else if (item instanceof GitCommitFileItem && item.resourceUri) {
                uris.push(item.resourceUri);
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
     * Handle drop operation - not implemented for git tree
     * The git tree is read-only and doesn't accept drops
     */
    public async handleDrop(
        _target: vscode.TreeItem | undefined,
        _dataTransfer: vscode.DataTransfer,
        _token: vscode.CancellationToken
    ): Promise<void> {
        // Git tree is read-only, no drop handling needed
    }
}

