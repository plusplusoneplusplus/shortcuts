import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { ConfigurationManager } from './configuration-manager';
import { ThemeManager } from './theme-manager';
import { CommandShortcutItem, FileShortcutItem, FolderShortcutItem, LogicalGroupChildItem, LogicalGroupItem, ShortcutItem, TaskShortcutItem } from './tree-items';
import { BasePath, LogicalGroup } from './types';

/**
 * Tree data provider for the logical groups panel
 * Handles custom logical groupings of shortcuts
 */
export class LogicalTreeDataProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<vscode.TreeItem | undefined | null | void> = new vscode.EventEmitter<vscode.TreeItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<vscode.TreeItem | undefined | null | void> = this._onDidChangeTreeData.event;

    private configurationManager: ConfigurationManager;
    private workspaceRoot: string;
    private themeManager: ThemeManager;
    private searchFilter: string = '';

    constructor(workspaceRoot: string, configurationManager: ConfigurationManager, themeManager: ThemeManager) {
        this.workspaceRoot = workspaceRoot;
        this.configurationManager = configurationManager;
        this.themeManager = themeManager;
    }

    /**
     * Get the tree item representation of an element
     */
    getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
        return element;
    }

    /**
     * Get the children of an element or root elements if no element is provided
     */
    async getChildren(element?: vscode.TreeItem): Promise<vscode.TreeItem[]> {
        try {
            if (!element) {
                // Return root level logical groups
                return await this.getRootLogicalGroups();
            } else if (element instanceof LogicalGroupItem) {
                // Return contents of the logical group
                return await this.getLogicalGroupContents(element);
            } else if (element instanceof LogicalGroupChildItem && element.itemType === 'folder') {
                // Return filesystem contents of folders within logical groups
                return await this.getFolderContents(element);
            } else if (element instanceof FolderShortcutItem) {
                // Return filesystem contents of expanded folders (nested folders)
                return await this.getFolderContentsFromFolderItem(element);
            } else {
                // Files and other items have no children
                return [];
            }
        } catch (error) {
            const err = error instanceof Error ? error : new Error('Unknown error');
            console.error('Error getting logical tree children:', err);
            vscode.window.showErrorMessage(`Error loading logical groups: ${err.message}`);
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
        this._onDidChangeTreeData.dispose();
    }

    /**
     * Get root level logical groups from configuration
     */
    private async getRootLogicalGroups(): Promise<ShortcutItem[]> {
        const config = await this.configurationManager.loadConfiguration();
        const groups: ShortcutItem[] = [];

        // If no logical groups are configured, return empty array
        if (!config.logicalGroups || config.logicalGroups.length === 0) {
            return [];
        }

        for (const groupConfig of config.logicalGroups) {
            try {
                // Apply search filter to group names and contents
                if (this.searchFilter) {
                    const groupMatches = groupConfig.name.toLowerCase().includes(this.searchFilter) ||
                        (groupConfig.description && groupConfig.description.toLowerCase().includes(this.searchFilter));

                    if (!groupMatches) {
                        // Check if any items in the group match
                        const hasMatchingItems = groupConfig.items.some(item =>
                            item.name.toLowerCase().includes(this.searchFilter) ||
                            (item.path && item.path.toLowerCase().includes(this.searchFilter))
                        );

                        if (!hasMatchingItems) {
                            continue;
                        }
                    }
                }

                // Calculate common path prefix for the group
                const resolvedPaths = groupConfig.items
                    .map(item => item.path ? this.resolvePath(item.path) : '')
                    .filter(p => p);
                const commonPrefix = this.findCommonPathPrefix(resolvedPaths);

                // Show common prefix in description if it exists and there are multiple items
                let groupDescription = groupConfig.description;
                if (commonPrefix && groupConfig.items.length > 1) {
                    groupDescription = groupConfig.description
                        ? `${groupConfig.description} • ${commonPrefix}`
                        : commonPrefix;
                }

                const groupItem = new LogicalGroupItem(
                    groupConfig.name,
                    groupDescription,
                    groupConfig.icon,
                    vscode.TreeItemCollapsibleState.Collapsed
                );

                groups.push(groupItem);
            } catch (error) {
                const err = error instanceof Error ? error : new Error('Unknown error');
                console.warn(`Error processing logical group ${groupConfig.name}:`, err);
            }
        }

        return groups;
    }

    /**
     * Find a group by path (supports nested groups)
     */
    private findGroupByPath(groups: LogicalGroup[], groupPath: string): LogicalGroup | undefined {
        const pathParts = groupPath.split('/');
        let currentGroups = groups;
        let targetGroup: LogicalGroup | undefined;

        for (const part of pathParts) {
            targetGroup = currentGroups.find(g => g.name === part);
            if (!targetGroup) {
                return undefined;
            }
            currentGroups = targetGroup.groups || [];
        }

        return targetGroup;
    }

    /**
     * Get contents of a logical group
     */
    private async getLogicalGroupContents(groupItem: LogicalGroupItem): Promise<vscode.TreeItem[]> {
        const config = await this.configurationManager.loadConfiguration();
        const items: vscode.TreeItem[] = [];

        // Build the full group path
        const groupPath = groupItem.parentGroupPath
            ? `${groupItem.parentGroupPath}/${groupItem.originalName}`
            : groupItem.originalName;

        // Find the logical group configuration using the path
        const groupConfig = this.findGroupByPath(config.logicalGroups, groupPath);
        if (!groupConfig) {
            return [];
        }

        try {
            // Add nested groups first
            if (groupConfig.groups && groupConfig.groups.length > 0) {
                for (const nestedGroup of groupConfig.groups) {
                    // Apply search filter to nested group names
                    if (this.searchFilter) {
                        const groupMatches = nestedGroup.name.toLowerCase().includes(this.searchFilter) ||
                            (nestedGroup.description && nestedGroup.description.toLowerCase().includes(this.searchFilter));

                        if (!groupMatches) {
                            // Check if any items in the nested group match
                            const hasMatchingItems = nestedGroup.items.some(item =>
                                item.name.toLowerCase().includes(this.searchFilter) ||
                                (item.path && item.path.toLowerCase().includes(this.searchFilter))
                            );

                            if (!hasMatchingItems) {
                                continue;
                            }
                        }
                    }

                    const nestedGroupItem = new LogicalGroupItem(
                        nestedGroup.name,
                        nestedGroup.description,
                        nestedGroup.icon,
                        vscode.TreeItemCollapsibleState.Collapsed,
                        groupPath // Pass parent path for nested groups
                    );

                    items.push(nestedGroupItem);
                }
            }

            // Sort items: folders first, then files, then commands/tasks, all alphabetically
            const sortedItems = [...groupConfig.items].sort((a, b) => {
                const typeOrder = { folder: 0, file: 1, command: 2, task: 3 };
                const aOrder = typeOrder[a.type] ?? 4;
                const bOrder = typeOrder[b.type] ?? 4;

                if (aOrder !== bOrder) {
                    return aOrder - bOrder;
                }
                return a.name.localeCompare(b.name);
            });

            // Calculate common path prefix for descriptions (only for file/folder items)
            const fileItems = sortedItems.filter(item => item.type === 'file' || item.type === 'folder');
            const resolvedPaths = fileItems.map(item => item.path ? this.resolvePath(item.path, config.basePaths) : '');
            const commonPrefix = this.findCommonPathPrefix(resolvedPaths.filter(p => p));

            for (const itemConfig of sortedItems) {
                try {
                    // Apply search filter to item names
                    if (this.searchFilter) {
                        const itemMatches = itemConfig.name.toLowerCase().includes(this.searchFilter) ||
                            (itemConfig.path && itemConfig.path.toLowerCase().includes(this.searchFilter)) ||
                            (itemConfig.command && itemConfig.command.toLowerCase().includes(this.searchFilter)) ||
                            (itemConfig.task && itemConfig.task.toLowerCase().includes(this.searchFilter));

                        if (!itemMatches) {
                            // For folders, check if they contain matching items
                            if (itemConfig.type === 'folder' && itemConfig.path) {
                                const resolvedPath = this.resolvePath(itemConfig.path, config.basePaths);
                                const hasMatchingChildren = await this.hasMatchingChildren(resolvedPath, this.searchFilter);
                                if (!hasMatchingChildren) {
                                    continue;
                                }
                            } else {
                                continue;
                            }
                        }
                    }

                    // Handle command items
                    if (itemConfig.type === 'command') {
                        if (!itemConfig.command) {
                            console.warn(`Command item missing command ID: ${itemConfig.name}`);
                            continue;
                        }
                        const commandItem = new CommandShortcutItem(
                            itemConfig.name,
                            itemConfig.command,
                            itemConfig.args,
                            itemConfig.icon
                        );
                        items.push(commandItem);
                        continue;
                    }

                    // Handle task items
                    if (itemConfig.type === 'task') {
                        if (!itemConfig.task) {
                            console.warn(`Task item missing task name: ${itemConfig.name}`);
                            continue;
                        }
                        const taskItem = new TaskShortcutItem(
                            itemConfig.name,
                            itemConfig.task,
                            itemConfig.icon
                        );
                        items.push(taskItem);
                        continue;
                    }

                    // Handle file/folder items
                    if (!itemConfig.path) {
                        console.warn(`File/folder item missing path: ${itemConfig.name}`);
                        continue;
                    }

                    const resolvedPath = this.resolvePath(itemConfig.path, config.basePaths);
                    const uri = vscode.Uri.file(resolvedPath);

                    // Check if path exists
                    if (!fs.existsSync(resolvedPath)) {
                        console.warn(`Logical group item path does not exist: ${resolvedPath}`);
                        continue;
                    }

                    // Verify the item type matches what exists on disk
                    const stat = fs.statSync(resolvedPath);
                    const actualType = stat.isDirectory() ? 'folder' : 'file';

                    if (actualType !== itemConfig.type) {
                        console.warn(`Logical group item type mismatch for ${resolvedPath}: expected ${itemConfig.type}, found ${actualType}`);
                        // Use actual type instead of configured type
                    }

                    // Create child item with configured name
                    const childItem = new LogicalGroupChildItem(
                        itemConfig.name,
                        uri,
                        actualType,
                        groupItem.originalName
                    );

                    // Set description to show relative path from common prefix
                    if (commonPrefix && sortedItems.length > 1) {
                        const relativePath = resolvedPath.substring(commonPrefix.length);
                        if (relativePath) {
                            childItem.description = relativePath;
                        }
                    } else if (sortedItems.length === 1) {
                        // For single items, show the parent directory
                        childItem.description = path.dirname(resolvedPath);
                    }

                    items.push(childItem);
                } catch (error) {
                    const err = error instanceof Error ? error : new Error('Unknown error');
                    console.warn(`Error processing logical group item ${itemConfig.path}:`, err);
                }
            }
        } catch (error) {
            const err = error instanceof Error ? error : new Error('Unknown error');
            console.error(`Error reading logical group contents for ${groupItem.label}:`, err);
            vscode.window.showErrorMessage(`Error reading group: ${err.message}`);
        }

        return items;
    }

    /**
     * Resolve base path aliases in a path string
     * @param inputPath Path that may contain base path aliases (e.g., @myrepo/src/file.ts)
     * @param basePaths Array of base path configurations
     * @returns Path with aliases resolved
     */
    private resolveBasePathAlias(inputPath: string, basePaths?: BasePath[]): string {
        if (!basePaths || basePaths.length === 0) {
            return inputPath;
        }

        // Check if the path starts with an alias (e.g., @myrepo/...)
        const aliasMatch = inputPath.match(/^@([^/\\]+)([\\/].*)?$/);
        if (!aliasMatch) {
            return inputPath;
        }

        const aliasName = `@${aliasMatch[1]}`;
        const remainingPath = aliasMatch[2] || '';

        // Find the matching base path
        const basePath = basePaths.find(bp => bp.alias === aliasName);
        if (!basePath) {
            console.warn(`Base path alias "${aliasName}" not found in configuration`);
            return inputPath;
        }

        // Combine the base path with the remaining path
        const resolvedBasePath = path.isAbsolute(basePath.path)
            ? basePath.path
            : path.resolve(this.workspaceRoot, basePath.path);

        // Handle both forward and backward slashes in the remaining path
        const normalizedRemaining = remainingPath.replace(/^[\\/]+/, '');
        return path.join(resolvedBasePath, normalizedRemaining);
    }

    /**
     * Resolve a path relative to the workspace root, with support for base path aliases
     * @param inputPath Path to resolve (may contain aliases like @myrepo/path)
     * @param basePaths Optional array of base path configurations
     * @returns Absolute path
     */
    private resolvePath(inputPath: string, basePaths?: BasePath[]): string {
        // First resolve any base path aliases
        const pathWithResolvedAlias = this.resolveBasePathAlias(inputPath, basePaths);

        // Then resolve relative paths
        if (path.isAbsolute(pathWithResolvedAlias)) {
            return pathWithResolvedAlias;
        }
        return path.resolve(this.workspaceRoot, pathWithResolvedAlias);
    }

    /**
     * Get all logical groups for management operations
     */
    async getLogicalGroups(): Promise<LogicalGroup[]> {
        const config = await this.configurationManager.loadConfiguration();
        return config.logicalGroups || [];
    }

    /**
     * Find a logical group by name
     */
    async findLogicalGroup(groupName: string): Promise<LogicalGroup | undefined> {
        const groups = await this.getLogicalGroups();
        return groups.find(g => g.name === groupName);
    }

    /**
     * Get filesystem contents of a folder within a logical group
     */
    private async getFolderContents(folderItem: LogicalGroupChildItem): Promise<ShortcutItem[]> {
        return this.getFolderContentsGeneric(folderItem.resourceUri.fsPath, folderItem.fsPath);
    }

    /**
     * Get filesystem contents of a FolderShortcutItem (for nested folder expansion)
     */
    private async getFolderContentsFromFolderItem(folderItem: FolderShortcutItem): Promise<ShortcutItem[]> {
        return this.getFolderContentsGeneric(folderItem.resourceUri.fsPath, folderItem.fsPath);
    }

    /**
     * Generic method to get filesystem contents of any folder
     */
    private async getFolderContentsGeneric(folderPath: string, displayPath: string): Promise<ShortcutItem[]> {
        const items: ShortcutItem[] = [];

        try {
            if (!fs.existsSync(folderPath)) {
                console.warn(`Folder does not exist: ${folderPath}`);
                return [];
            }

            const stat = fs.statSync(folderPath);
            if (!stat.isDirectory()) {
                console.warn(`Path is not a directory: ${folderPath}`);
                return [];
            }

            const dirEntries = fs.readdirSync(folderPath, { withFileTypes: true });

            // Sort entries: directories first, then files, both alphabetically
            const sortedEntries = dirEntries.sort((a, b) => {
                if (a.isDirectory() && !b.isDirectory()) {
                    return -1;
                }
                if (!a.isDirectory() && b.isDirectory()) {
                    return 1;
                }
                return a.name.localeCompare(b.name);
            });

            for (const entry of sortedEntries) {
                try {
                    // Skip hidden files and directories (starting with .)
                    if (entry.name.startsWith('.')) {
                        continue;
                    }

                    const entryPath = path.join(folderPath, entry.name);
                    const entryUri = vscode.Uri.file(entryPath);

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
                        // Create folder item that can be further expanded
                        const folderItem = new FolderShortcutItem(
                            entry.name,
                            entryUri,
                            vscode.TreeItemCollapsibleState.Collapsed
                        );
                        items.push(folderItem);
                    } else if (entry.isFile()) {
                        // Create file item
                        const fileItem = new FileShortcutItem(entry.name, entryUri);
                        items.push(fileItem);
                    }
                } catch (error) {
                    const err = error instanceof Error ? error : new Error('Unknown error');
                    console.warn(`Error processing entry ${entry.name}:`, err);
                }
            }
        } catch (error) {
            const err = error instanceof Error ? error : new Error('Unknown error');
            console.error(`Error reading folder contents for ${displayPath}:`, err);
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
     * Find the common path prefix among multiple paths
     * Returns the longest common directory path, or empty string if no common prefix
     */
    private findCommonPathPrefix(paths: string[]): string {
        if (paths.length === 0) {
            return '';
        }

        if (paths.length === 1) {
            // For a single path, return the directory containing it
            return path.dirname(paths[0]) + path.sep;
        }

        // Split all paths into segments
        const pathSegments = paths.map(p => p.split(path.sep));

        // Find the minimum number of segments
        const minSegments = Math.min(...pathSegments.map(segments => segments.length));

        // Find common prefix segments
        let commonSegments: string[] = [];
        for (let i = 0; i < minSegments; i++) {
            const segment = pathSegments[0][i];
            const allMatch = pathSegments.every(segments => segments[i] === segment);

            if (allMatch) {
                commonSegments.push(segment);
            } else {
                break;
            }
        }

        // If no common segments or only root, return empty
        if (commonSegments.length === 0 || (commonSegments.length === 1 && commonSegments[0] === '')) {
            return '';
        }

        // Build the common path
        const commonPath = commonSegments.join(path.sep);

        // Ensure it ends with a separator for clean relative paths
        return commonPath + path.sep;
    }
}