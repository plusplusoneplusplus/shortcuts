import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { ConfigurationManager } from './configuration-manager';
import { FileShortcutItem, FolderShortcutItem, ShortcutItem } from './tree-items';
import { ThemeManager } from './theme-manager';

/**
 * Tree data provider for the shortcuts panel
 * Implements vscode.TreeDataProvider interface to supply data to the tree view
 */
export class ShortcutsTreeDataProvider implements vscode.TreeDataProvider<ShortcutItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<ShortcutItem | undefined | null | void> = new vscode.EventEmitter<ShortcutItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<ShortcutItem | undefined | null | void> = this._onDidChangeTreeData.event;

    private configurationManager: ConfigurationManager;
    private workspaceRoot: string;
    private themeManager: ThemeManager;
    private searchFilter: string = '';

    constructor(workspaceRoot: string) {
        this.workspaceRoot = workspaceRoot;
        this.configurationManager = new ConfigurationManager(workspaceRoot);
        this.themeManager = new ThemeManager();

        // Set up file watcher for configuration changes
        this.configurationManager.watchConfigFile(() => {
            this.refresh();
        });

        // Initialize theme management with refresh callback
        this.themeManager.initialize(() => {
            this.refresh();
        });
    }

    /**
     * Get the tree item representation of an element
     * @param element The element to get the tree item for
     * @returns The tree item representation
     */
    getTreeItem(element: ShortcutItem): vscode.TreeItem {
        return element;
    }

    /**
     * Get the children of an element or root elements if no element is provided
     * @param element The element to get children for, or undefined for root elements
     * @returns Promise resolving to array of child elements
     */
    async getChildren(element?: ShortcutItem): Promise<ShortcutItem[]> {
        try {
            if (!element) {
                // Return root level shortcuts
                return await this.getRootShortcuts();
            } else if (element instanceof FolderShortcutItem) {
                // Return contents of the folder
                return await this.getFolderContents(element);
            } else {
                // Files have no children
                return [];
            }
        } catch (error) {
            const err = error instanceof Error ? error : new Error('Unknown error');
            console.error('Error getting tree children:', err);
            vscode.window.showErrorMessage(`Error loading shortcuts: ${err.message}`);
            return [];
        }
    }

    /**
     * Refresh the tree view
     */
    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    /**
     * Get the configuration manager instance
     */
    getConfigurationManager(): ConfigurationManager {
        return this.configurationManager;
    }

    /**
     * Get the theme manager instance
     */
    getThemeManager(): ThemeManager {
        return this.themeManager;
    }

    /**
     * Set search filter
     */
    setSearchFilter(filter: string): void {
        this.searchFilter = filter.toLowerCase();
        this.refresh();
    }

    /**
     * Clear search filter
     */
    clearSearchFilter(): void {
        this.searchFilter = '';
        this.refresh();
    }

    /**
     * Get current search filter
     */
    getSearchFilter(): string {
        return this.searchFilter;
    }

    /**
     * Dispose of resources
     */
    dispose(): void {
        this.configurationManager.dispose();
        this._onDidChangeTreeData.dispose();
        this.themeManager.dispose();
    }

    /**
     * Get root level shortcut items from configuration
     * @returns Promise resolving to array of root shortcut items
     */
    private async getRootShortcuts(): Promise<ShortcutItem[]> {
        const config = await this.configurationManager.loadConfiguration();
        const shortcuts: ShortcutItem[] = [];

        // If no shortcuts are configured, return empty array to show welcome content
        if (!config.shortcuts || config.shortcuts.length === 0) {
            return [];
        }

        for (const shortcutConfig of config.shortcuts) {
            try {
                const resolvedPath = this.resolvePath(shortcutConfig.path);
                const uri = vscode.Uri.file(resolvedPath);

                // Verify the path exists and is a directory
                if (!fs.existsSync(resolvedPath)) {
                    vscode.window.showWarningMessage(
                        `Shortcut path does not exist: ${resolvedPath}`,
                        'Remove Shortcut',
                        'Open Configuration'
                    ).then((action: string | undefined) => {
                        if (action === 'Remove Shortcut') {
                            this.configurationManager.removeShortcut(resolvedPath);
                            this.refresh();
                        } else if (action === 'Open Configuration') {
                            vscode.commands.executeCommand('vscode.open', vscode.Uri.file(this.configurationManager.getConfigPath()));
                        }
                    });
                    continue;
                }

                const stat = fs.statSync(resolvedPath);
                if (!stat.isDirectory()) {
                    vscode.window.showWarningMessage(
                        `Shortcut path is not a directory: ${resolvedPath}`,
                        'Remove Shortcut'
                    ).then((action: string | undefined) => {
                        if (action === 'Remove Shortcut') {
                            this.configurationManager.removeShortcut(resolvedPath);
                            this.refresh();
                        }
                    });
                    continue;
                }

                // Use configured name or default to folder name
                const displayName = shortcutConfig.name || path.basename(resolvedPath);

                const folderItem = new FolderShortcutItem(
                    displayName,
                    uri,
                    vscode.TreeItemCollapsibleState.Collapsed
                );

                shortcuts.push(folderItem);
            } catch (error) {
                const err = error instanceof Error ? error : new Error('Unknown error');
                console.warn(`Error processing shortcut ${shortcutConfig.path}:`, err);
            }
        }

        return shortcuts;
    }

    /**
     * Get contents of a folder as tree items
     * @param folderItem The folder item to get contents for
     * @returns Promise resolving to array of child items
     */
    private async getFolderContents(folderItem: FolderShortcutItem): Promise<ShortcutItem[]> {
        const folderPath = folderItem.fsPath;
        const items: ShortcutItem[] = [];

        try {
            if (!fs.existsSync(folderPath)) {
                return [];
            }

            const entries = fs.readdirSync(folderPath, { withFileTypes: true });

            // Sort entries: directories first, then files, both alphabetically
            entries.sort((a, b) => {
                if (a.isDirectory() && !b.isDirectory()) {
                    return -1;
                }
                if (!a.isDirectory() && b.isDirectory()) {
                    return 1;
                }
                return a.name.localeCompare(b.name);
            });

            for (const entry of entries) {
                // Skip hidden files and directories (starting with .)
                if (entry.name.startsWith('.')) {
                    continue;
                }

                const entryPath = path.join(folderPath, entry.name);
                const uri = vscode.Uri.file(entryPath);

                // Apply search filter if active
                if (this.searchFilter && !entry.name.toLowerCase().includes(this.searchFilter)) {
                    // If searching, check if folder contains matching items
                    if (entry.isDirectory()) {
                        const hasMatchingChildren = await this.hasMatchingChildren(entryPath, this.searchFilter);
                        if (!hasMatchingChildren) {
                            continue;
                        }
                    } else {
                        continue;
                    }
                }

                if (entry.isDirectory()) {
                    const subfolderItem = new FolderShortcutItem(
                        entry.name,
                        uri,
                        vscode.TreeItemCollapsibleState.Collapsed
                    );
                    items.push(subfolderItem);
                } else if (entry.isFile()) {
                    const fileItem = new FileShortcutItem(entry.name, uri);
                    items.push(fileItem);
                }
            }
        } catch (error) {
            const err = error instanceof Error ? error : new Error('Unknown error');
            console.error(`Error reading folder contents for ${folderPath}:`, err);
            vscode.window.showErrorMessage(`Error reading folder: ${err.message}`);
        }

        return items;
    }

    /**
     * Check if a folder contains items matching the search filter
     */
    private async hasMatchingChildren(folderPath: string, searchFilter: string): Promise<boolean> {
        const MAX_DEPTH = 3;
        const MAX_FILES = 100;
        return this.hasMatchingChildrenWithLimits(folderPath, searchFilter, 0, MAX_DEPTH, MAX_FILES);
    }

    /**
     * Check if a folder contains items matching the search filter with depth and file limits
     */
    private async hasMatchingChildrenWithLimits(
        folderPath: string,
        searchFilter: string,
        currentDepth: number,
        maxDepth: number,
        maxFiles: number
    ): Promise<boolean> {
        if (currentDepth >= maxDepth || maxFiles <= 0) {
            return false;
        }

        try {
            if (!fs.existsSync(folderPath)) {
                return false;
            }

            const entries = fs.readdirSync(folderPath, { withFileTypes: true });
            let filesChecked = 0;

            for (const entry of entries) {
                if (filesChecked >= maxFiles) {
                    break;
                }

                // Skip hidden files
                if (entry.name.startsWith('.')) {
                    continue;
                }

                // Check if entry name matches search
                if (entry.name.toLowerCase().includes(searchFilter)) {
                    return true;
                }

                // Recursively check subdirectories
                if (entry.isDirectory()) {
                    const subFolderPath = path.join(folderPath, entry.name);
                    const hasMatchingInSubfolder = await this.hasMatchingChildrenWithLimits(
                        subFolderPath,
                        searchFilter,
                        currentDepth + 1,
                        maxDepth,
                        maxFiles - filesChecked
                    );
                    if (hasMatchingInSubfolder) {
                        return true;
                    }
                }

                filesChecked++;
            }

            return false;
        } catch (error) {
            console.warn(`Error checking for matching children in ${folderPath}:`, error);
            return false;
        }
    }

    /**
     * Resolve a path relative to the workspace root
     * @param inputPath Path to resolve
     * @returns Absolute path
     */
    private resolvePath(inputPath: string): string {
        if (path.isAbsolute(inputPath)) {
            return inputPath;
        }
        return path.resolve(this.workspaceRoot, inputPath);
    }
}