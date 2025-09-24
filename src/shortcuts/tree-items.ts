import * as path from 'path';
import * as vscode from 'vscode';

/**
 * Abstract base class for all shortcut tree items
 * Extends vscode.TreeItem to provide common functionality for folders and files
 */
export abstract class ShortcutItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly resourceUri: vscode.Uri,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState
    ) {
        super(label, collapsibleState);
        this.resourceUri = resourceUri;
        this.tooltip = this.resourceUri.fsPath;
    }

    /**
     * Get the file system path for this item
     */
    get fsPath(): string {
        return this.resourceUri.fsPath;
    }

    /**
     * Get the display name for this item
     */
    get displayName(): string {
        return this.label;
    }

    /**
     * Check if this item represents a directory
     */
    abstract isDirectory(): boolean;

    /**
     * Get the appropriate icon for this item
     */
    abstract getIconPath(): vscode.ThemeIcon | { light: string; dark: string } | undefined;
}

/**
 * Tree item representing a folder shortcut
 * Supports expand/collapse functionality and shows appropriate folder icons
 */
export class FolderShortcutItem extends ShortcutItem {
    public readonly contextValue = 'folder';

    constructor(
        label: string,
        resourceUri: vscode.Uri,
        collapsibleState: vscode.TreeItemCollapsibleState = vscode.TreeItemCollapsibleState.Collapsed
    ) {
        super(label, resourceUri, collapsibleState);
        this.iconPath = this.getIconPath();
    }

    /**
     * Folders are always directories
     */
    isDirectory(): boolean {
        return true;
    }

    /**
     * Get folder icon based on collapsed/expanded state
     */
    getIconPath(): vscode.ThemeIcon {
        if (this.collapsibleState === vscode.TreeItemCollapsibleState.Expanded) {
            return new vscode.ThemeIcon('folder-opened');
        } else {
            return new vscode.ThemeIcon('folder');
        }
    }

    /**
     * Create a new folder item with expanded state
     */
    asExpanded(): FolderShortcutItem {
        return new FolderShortcutItem(
            this.label,
            this.resourceUri,
            vscode.TreeItemCollapsibleState.Expanded
        );
    }

    /**
     * Create a new folder item with collapsed state
     */
    asCollapsed(): FolderShortcutItem {
        return new FolderShortcutItem(
            this.label,
            this.resourceUri,
            vscode.TreeItemCollapsibleState.Collapsed
        );
    }
}

/**
 * Tree item representing a file shortcut
 * Configured to open the file when clicked and shows file type-specific icons
 */
export class FileShortcutItem extends ShortcutItem {
    public readonly contextValue = 'file';
    public readonly command: vscode.Command;

    constructor(label: string, resourceUri: vscode.Uri) {
        super(label, resourceUri, vscode.TreeItemCollapsibleState.None);

        // Configure command to open file when clicked
        this.command = {
            command: 'vscode.open',
            title: 'Open File',
            arguments: [this.resourceUri]
        };

        this.iconPath = this.getIconPath();
    }

    /**
     * Files are never directories
     */
    isDirectory(): boolean {
        return false;
    }

    /**
     * Get file type-specific icon based on file extension
     */
    getIconPath(): vscode.ThemeIcon {
        const extension = path.extname(this.resourceUri.fsPath).toLowerCase();

        // Map common file extensions to VS Code theme icons
        const iconMap: { [key: string]: string } = {
            '.js': 'symbol-file',
            '.ts': 'symbol-file',
            '.jsx': 'symbol-file',
            '.tsx': 'symbol-file',
            '.json': 'json',
            '.md': 'markdown',
            '.html': 'symbol-file',
            '.css': 'symbol-file',
            '.scss': 'symbol-file',
            '.less': 'symbol-file',
            '.py': 'symbol-file',
            '.java': 'symbol-file',
            '.cpp': 'symbol-file',
            '.c': 'symbol-file',
            '.h': 'symbol-file',
            '.xml': 'symbol-file',
            '.yaml': 'symbol-file',
            '.yml': 'symbol-file',
            '.txt': 'symbol-file',
            '.log': 'symbol-file',
            '.gitignore': 'symbol-file',
            '.env': 'symbol-file'
        };

        const iconName = iconMap[extension] || 'file';
        return new vscode.ThemeIcon(iconName);
    }

    /**
     * Get the file extension
     */
    get extension(): string {
        return path.extname(this.resourceUri.fsPath);
    }

    /**
     * Get the file name without extension
     */
    get baseName(): string {
        return path.basename(this.resourceUri.fsPath, this.extension);
    }
}