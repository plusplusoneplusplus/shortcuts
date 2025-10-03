import * as vscode from 'vscode';
import { ShortcutItem, FolderShortcutItem, FileShortcutItem, SearchTreeItem } from './tree-items';

/**
 * Interface for tree data providers that support keyboard navigation
 */
interface NavigableTreeDataProvider {
    refresh(): void;
    getChildren(element?: vscode.TreeItem): Promise<vscode.TreeItem[]>;
}

/**
 * Handles keyboard navigation for the shortcuts tree view
 * Provides accessibility support and enhanced navigation experience
 */
export class KeyboardNavigationHandler {
    private treeView: vscode.TreeView<vscode.TreeItem>;
    private treeDataProvider: NavigableTreeDataProvider;
    private keyListeners: vscode.Disposable[] = [];
    private viewId: string;

    constructor(
        treeView: vscode.TreeView<vscode.TreeItem>,
        treeDataProvider: NavigableTreeDataProvider,
        viewId: string
    ) {
        this.treeView = treeView;
        this.treeDataProvider = treeDataProvider;
        this.viewId = viewId;
        this.setupKeyboardNavigation();
    }

    /**
     * Set up keyboard event listeners for enhanced navigation
     */
    private setupKeyboardNavigation(): void {
        // Register command for Enter key - open file or expand/collapse folder
        const enterCommand = vscode.commands.registerCommand(
            `shortcuts.${this.viewId}.handleEnterKey`,
            async () => {
                await this.handleEnterKey();
            }
        );

        // Register command for Space key - expand/collapse folders
        const spaceCommand = vscode.commands.registerCommand(
            `shortcuts.${this.viewId}.handleSpaceKey`,
            async () => {
                await this.handleSpaceKey();
            }
        );

        // Register command for Home key - navigate to first item
        const homeCommand = vscode.commands.registerCommand(
            `shortcuts.${this.viewId}.handleHomeKey`,
            async () => {
                await this.handleHomeKey();
            }
        );

        // Register command for End key - navigate to last visible item
        const endCommand = vscode.commands.registerCommand(
            `shortcuts.${this.viewId}.handleEndKey`,
            async () => {
                await this.handleEndKey();
            }
        );

        // Register command for Right arrow - expand folder
        const rightArrowCommand = vscode.commands.registerCommand(
            `shortcuts.${this.viewId}.handleRightArrow`,
            async () => {
                await this.handleRightArrow();
            }
        );

        // Register command for Left arrow - collapse folder or navigate to parent
        const leftArrowCommand = vscode.commands.registerCommand(
            `shortcuts.${this.viewId}.handleLeftArrow`,
            async () => {
                await this.handleLeftArrow();
            }
        );

        // Register command for F2 key - rename shortcut
        const f2Command = vscode.commands.registerCommand(
            `shortcuts.${this.viewId}.handleF2Key`,
            async () => {
                await this.handleF2Key();
            }
        );

        // Register command for Delete key - remove shortcut
        const deleteCommand = vscode.commands.registerCommand(
            `shortcuts.${this.viewId}.handleDeleteKey`,
            async () => {
                await this.handleDeleteKey();
            }
        );

        // Store disposables for cleanup
        this.keyListeners.push(
            enterCommand,
            spaceCommand,
            homeCommand,
            endCommand,
            rightArrowCommand,
            leftArrowCommand,
            f2Command,
            deleteCommand
        );

        // Set up tree view selection listener for accessibility
        const selectionListener = this.treeView.onDidChangeSelection(
            (e: vscode.TreeViewSelectionChangeEvent<vscode.TreeItem>) => {
                this.handleSelectionChange(e);
            }
        );

        this.keyListeners.push(selectionListener);
    }

    /**
     * Handle Enter key press
     * - For files: Open the file
     * - For folders: Expand/collapse
     */
    private async handleEnterKey(): Promise<void> {
        const selection = this.treeView.selection;
        if (!selection || selection.length === 0) {
            return;
        }

        const selectedItem = selection[0];

        if (selectedItem instanceof FileShortcutItem) {
            // Open file
            if (selectedItem.command) {
                await vscode.commands.executeCommand(
                    selectedItem.command.command,
                    ...(selectedItem.command.arguments || [])
                );
            }
        } else if (selectedItem instanceof FolderShortcutItem) {
            // Toggle expand/collapse state
            await this.toggleFolderExpansion(selectedItem);
        }
    }

    /**
     * Handle Space key press
     * - For folders: Expand/collapse
     * - For files: Open the file
     */
    private async handleSpaceKey(): Promise<void> {
        const selection = this.treeView.selection;
        if (!selection || selection.length === 0) {
            return;
        }

        const selectedItem = selection[0];

        if (selectedItem instanceof FolderShortcutItem) {
            // Toggle expand/collapse state
            await this.toggleFolderExpansion(selectedItem);
        } else if (selectedItem instanceof FileShortcutItem) {
            // Open file (same as Enter for files)
            if (selectedItem.command) {
                await vscode.commands.executeCommand(
                    selectedItem.command.command,
                    ...(selectedItem.command.arguments || [])
                );
            }
        }
    }

    /**
     * Handle Home key press - navigate to first item
     */
    private async handleHomeKey(): Promise<void> {
        try {
            const rootItems = await this.treeDataProvider.getChildren();
            if (rootItems && rootItems.length > 0) {
                this.treeView.reveal(rootItems[0], {
                    select: true,
                    focus: true,
                    expand: false
                });
            }
        } catch (error) {
            console.error('Error navigating to first item:', error);
        }
    }

    /**
     * Handle End key press - navigate to last visible item
     */
    private async handleEndKey(): Promise<void> {
        try {
            const rootItems = await this.treeDataProvider.getChildren();
            if (rootItems && rootItems.length > 0) {
                const lastItem = rootItems[rootItems.length - 1];

                // If the last item is an expanded folder, find its last visible child
                if (lastItem instanceof FolderShortcutItem &&
                    lastItem.collapsibleState === vscode.TreeItemCollapsibleState.Expanded) {
                    const children = await this.getLastVisibleDescendant(lastItem);
                    if (children) {
                        this.treeView.reveal(children, {
                            select: true,
                            focus: true,
                            expand: false
                        });
                        return;
                    }
                }

                this.treeView.reveal(lastItem, {
                    select: true,
                    focus: true,
                    expand: false
                });
            }
        } catch (error) {
            console.error('Error navigating to last item:', error);
        }
    }

    /**
     * Handle Right arrow key press - expand folder
     */
    private async handleRightArrow(): Promise<void> {
        const selection = this.treeView.selection;
        if (!selection || selection.length === 0) {
            return;
        }

        const selectedItem = selection[0];

        if (selectedItem instanceof FolderShortcutItem &&
            selectedItem.collapsibleState !== vscode.TreeItemCollapsibleState.Expanded) {
            await this.expandFolder(selectedItem);
        }
    }

    /**
     * Handle Left arrow key press - collapse folder or navigate to parent
     */
    private async handleLeftArrow(): Promise<void> {
        const selection = this.treeView.selection;
        if (!selection || selection.length === 0) {
            return;
        }

        const selectedItem = selection[0];

        if (selectedItem instanceof FolderShortcutItem &&
            selectedItem.collapsibleState === vscode.TreeItemCollapsibleState.Expanded) {
            await this.collapseFolder(selectedItem);
        }
    }

    /**
     * Handle F2 key press - rename shortcut (only for root level folders)
     */
    private async handleF2Key(): Promise<void> {
        const selection = this.treeView.selection;
        if (!selection || selection.length === 0) {
            return;
        }

        const selectedItem = selection[0];

        if (selectedItem instanceof FolderShortcutItem) {
            // Check if this is a root level shortcut (can be renamed)
            const rootItems = await this.treeDataProvider.getChildren();
            const isRootItem = rootItems.some((item: vscode.TreeItem) =>
                item instanceof ShortcutItem && item.resourceUri.fsPath === selectedItem.resourceUri.fsPath
            );

            if (isRootItem) {
                await vscode.commands.executeCommand('shortcuts.renameShortcut', selectedItem);
            } else {
                vscode.window.showInformationMessage('Only root-level shortcuts can be renamed.');
            }
        } else if (selectedItem instanceof SearchTreeItem) {
            // Handle F2 for search items - trigger inline editing
            await vscode.commands.executeCommand('shortcuts.editSearchInput', selectedItem);
        }
    }

    /**
     * Handle Delete key press - remove shortcut (only for root level folders)
     */
    private async handleDeleteKey(): Promise<void> {
        const selection = this.treeView.selection;
        if (!selection || selection.length === 0) {
            return;
        }

        const selectedItem = selection[0];

        if (selectedItem instanceof FolderShortcutItem) {
            // Check if this is a root level shortcut (can be removed)
            const rootItems = await this.treeDataProvider.getChildren();
            const isRootItem = rootItems.some((item: vscode.TreeItem) =>
                item instanceof ShortcutItem && item.resourceUri.fsPath === selectedItem.resourceUri.fsPath
            );

            if (isRootItem) {
                await vscode.commands.executeCommand('shortcuts.removeShortcut', selectedItem);
            } else {
                vscode.window.showInformationMessage('Only root-level shortcuts can be removed.');
            }
        }
    }

    /**
     * Handle selection change for accessibility
     */
    private handleSelectionChange(event: vscode.TreeViewSelectionChangeEvent<vscode.TreeItem>): void {
        if (event.selection && event.selection.length > 0) {
            const selectedItem = event.selection[0];

            // Provide context information for screen readers
            let description = '';
            if (selectedItem instanceof FolderShortcutItem) {
                description = selectedItem.collapsibleState === vscode.TreeItemCollapsibleState.Expanded
                    ? 'Expanded folder'
                    : 'Collapsed folder';
            } else if (selectedItem instanceof FileShortcutItem) {
                description = `File: ${selectedItem.extension || 'no extension'}`;
            }

            // Update accessibility information
            selectedItem.description = description;
        }
    }

    /**
     * Toggle folder expansion state
     */
    private async toggleFolderExpansion(item: FolderShortcutItem): Promise<void> {
        if (item.collapsibleState === vscode.TreeItemCollapsibleState.Expanded) {
            await this.collapseFolder(item);
        } else {
            await this.expandFolder(item);
        }
    }

    /**
     * Expand a folder
     */
    private async expandFolder(item: FolderShortcutItem): Promise<void> {
        try {
            await this.treeView.reveal(item, {
                select: true,
                focus: true,
                expand: true
            });
        } catch (error) {
            console.error('Error expanding folder:', error);
        }
    }

    /**
     * Collapse a folder
     */
    private async collapseFolder(item: FolderShortcutItem): Promise<void> {
        try {
            await this.treeView.reveal(item, {
                select: true,
                focus: true,
                expand: false
            });
        } catch (error) {
            console.error('Error collapsing folder:', error);
        }
    }

    /**
     * Find the last visible descendant of a folder
     */
    private async getLastVisibleDescendant(item: FolderShortcutItem): Promise<vscode.TreeItem | null> {
        try {
            const children = await this.treeDataProvider.getChildren(item);
            if (!children || children.length === 0) {
                return item;
            }

            const lastChild = children[children.length - 1];

            // If the last child is an expanded folder, recursively find its last descendant
            if (lastChild instanceof FolderShortcutItem &&
                lastChild.collapsibleState === vscode.TreeItemCollapsibleState.Expanded) {
                return await this.getLastVisibleDescendant(lastChild) || lastChild;
            }

            return lastChild;
        } catch (error) {
            console.error('Error finding last visible descendant:', error);
            return null;
        }
    }

    /**
     * Get keyboard navigation help text
     */
    public static getKeyboardShortcutsHelp(): string {
        return `
Shortcuts Panel Keyboard Navigation:

• Enter: Open file or expand/collapse folder
• Space: Expand/collapse folder or open file
• Right Arrow: Expand folder
• Left Arrow: Collapse folder
• Home: Navigate to first item
• End: Navigate to last visible item
• F2: Rename root-level shortcut
• Delete: Remove root-level shortcut
• Tab/Shift+Tab: Navigate between UI elements
• Arrow Keys: Navigate between tree items

Accessibility:
• Screen reader compatible
• Focus indicators for keyboard navigation
• Context descriptions for selected items
        `.trim();
    }

    /**
     * Dispose of keyboard navigation handlers
     */
    dispose(): void {
        this.keyListeners.forEach(listener => listener.dispose());
        this.keyListeners = [];
    }
}