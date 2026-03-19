import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { ConfigurationManager } from './configuration-manager';
import { NotificationManager } from './notification-manager';
import { getExtensionLogger, LogCategory } from './shared';
import { FilterableTreeDataProvider } from './shared/filterable-tree-data-provider';
import { ThemeManager } from './theme-manager';
import { CommandShortcutItem, CommitFileItem, CommitShortcutItem, FileShortcutItem, FolderShortcutItem, LogicalGroupChildItem, LogicalGroupItem, NoteShortcutItem, ShortcutItem, TaskShortcutItem } from './tree-items';
import { GitLogService } from './git/git-log-service';
import { BasePath, LogicalGroup } from './types';

/**
 * Tree data provider for the logical groups panel
 * Handles custom logical groupings of shortcuts
 */
export class LogicalTreeDataProvider extends FilterableTreeDataProvider<vscode.TreeItem> {
    private configurationManager: ConfigurationManager;
    private workspaceRoot: string;
    private themeManager: ThemeManager;
    private gitLogService: GitLogService | undefined;

    constructor(workspaceRoot: string, configurationManager: ConfigurationManager, themeManager: ThemeManager) {
        super();
        this.workspaceRoot = workspaceRoot;
        this.configurationManager = configurationManager;
        this.themeManager = themeManager;
    }

    /**
     * Set the GitLogService for fetching commit files
     */
    setGitLogService(gitLogService: GitLogService): void {
        this.gitLogService = gitLogService;
    }

    /**
     * Get the tree item representation of an element
     */
    getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
        return element;
    }

    /**
     * Implementation of getChildren logic
     */
    protected async getChildrenImpl(element?: vscode.TreeItem): Promise<vscode.TreeItem[]> {
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
        } else if (element instanceof CommitShortcutItem) {
            // Return files changed in the commit
            return await this.getCommitFiles(element);
        } else {
            // Files and other items have no children
            return [];
        }
    }

    /**
     * Get the configuration manager instance
     */
    getConfigurationManager(): ConfigurationManager {
        return this.configurationManager;
    }

    /**
     * Set search filter (backward compatibility alias)
     */
    setSearchFilter(filter: string): void {
        this.setFilter(filter);
    }

    /**
     * Clear search filter (backward compatibility alias)
     */
    clearSearchFilter(): void {
        this.clearFilter();
    }

    /**
     * Get current search filter (backward compatibility alias)
     */
    getSearchFilter(): string {
        return this.getFilter();
    }

    /**
     * Override to use EXTENSION log category
     */
    protected getLogCategory(): LogCategory {
        return LogCategory.EXTENSION;
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
                if (this.hasFilter) {
                    const groupMatches = groupConfig.name.toLowerCase().includes(this.getFilter()) ||
                        (groupConfig.description && groupConfig.description.toLowerCase().includes(this.getFilter()));

                    if (!groupMatches) {
                        // Check if any items in the group match
                        const hasMatchingItems = groupConfig.items.some(item =>
                            item.name.toLowerCase().includes(this.getFilter()) ||
                            (item.path && item.path.toLowerCase().includes(this.getFilter()))
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
                    if (this.hasFilter) {
                        const groupMatches = nestedGroup.name.toLowerCase().includes(this.getFilter()) ||
                            (nestedGroup.description && nestedGroup.description.toLowerCase().includes(this.getFilter()));

                        if (!groupMatches) {
                            // Check if any items in the nested group match
                            const hasMatchingItems = nestedGroup.items.some(item =>
                                item.name.toLowerCase().includes(this.getFilter()) ||
                                (item.path && item.path.toLowerCase().includes(this.getFilter()))
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

            // Sort items: folders first, then files, then commits, then notes, then commands/tasks, all alphabetically
            const sortedItems = [...groupConfig.items].sort((a, b) => {
                const typeOrder: Record<string, number> = { folder: 0, file: 1, commit: 2, note: 3, command: 4, task: 5 };
                const aOrder = typeOrder[a.type] ?? 6;
                const bOrder = typeOrder[b.type] ?? 6;

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
                    if (this.hasFilter) {
                        const itemMatches = itemConfig.name.toLowerCase().includes(this.getFilter()) ||
                            (itemConfig.path && itemConfig.path.toLowerCase().includes(this.getFilter())) ||
                            (itemConfig.command && itemConfig.command.toLowerCase().includes(this.getFilter())) ||
                            (itemConfig.task && itemConfig.task.toLowerCase().includes(this.getFilter()));

                        if (!itemMatches) {
                            // For folders, check if they contain matching items
                            if (itemConfig.type === 'folder' && itemConfig.path) {
                                const resolvedPath = this.resolvePath(itemConfig.path, config.basePaths);
                                const hasMatchingChildren = await this.hasMatchingChildren(resolvedPath, this.getFilter());
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

                    // Handle note items
                    if (itemConfig.type === 'note') {
                        if (!itemConfig.noteId) {
                            console.warn(`Note item missing note ID: ${itemConfig.name}`);
                            continue;
                        }
                        const noteItem = new NoteShortcutItem(
                            itemConfig.name,
                            itemConfig.noteId,
                            groupPath,
                            itemConfig.icon
                        );
                        items.push(noteItem);
                        continue;
                    }

                    // Handle commit items
                    if (itemConfig.type === 'commit') {
                        console.log(`Processing commit item: ${itemConfig.name}`);
                        if (!itemConfig.commitRef) {
                            console.warn(`Commit item missing commit reference: ${itemConfig.name}`);
                            continue;
                        }
                        console.log(`Creating CommitShortcutItem with hash: ${itemConfig.commitRef.hash}`);
                        const commitItem = new CommitShortcutItem(
                            itemConfig.name,
                            itemConfig.commitRef.hash,
                            itemConfig.commitRef.repositoryRoot,
                            groupPath,
                            itemConfig.icon
                        );
                        items.push(commitItem);
                        console.log(`Added commit item to group: ${groupPath}`);
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
                        groupPath
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
            getExtensionLogger().error(LogCategory.EXTENSION, `Error reading logical group contents for ${groupItem.label}`, err);
            NotificationManager.showError(`Error reading group: ${err.message}`);
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
     * Get files changed in a commit
     */
    private async getCommitFiles(commitItem: CommitShortcutItem): Promise<vscode.TreeItem[]> {
        if (!this.gitLogService) {
            console.warn('GitLogService not available for commit file expansion');
            return [];
        }

        try {
            const files = this.gitLogService.getCommitFiles(
                commitItem.repositoryRoot,
                commitItem.commitHash
            );

            return files.map(file => {
                // Convert GitChangeStatus to single-letter status
                const statusMap: Record<string, 'A' | 'M' | 'D' | 'R' | 'C'> = {
                    'added': 'A',
                    'modified': 'M',
                    'deleted': 'D',
                    'renamed': 'R',
                    'copied': 'C'
                };
                const status = statusMap[file.status] || 'M';

                return new CommitFileItem(
                    file.path,
                    status,
                    file.commitHash,
                    file.parentHash,
                    file.repositoryRoot,
                    file.originalPath
                );
            });
        } catch (error) {
            getExtensionLogger().error(LogCategory.GIT, 'Error getting commit files', error instanceof Error ? error : undefined);
            return [];
        }
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
                    if (this.getFilter() && !entry.name.toLowerCase().includes(this.getFilter())) {
                        // If searching, check if folder contains matching items
                        if (entry.isDirectory()) {
                            const hasMatchingChildren = await this.hasMatchingChildren(entryPath, this.getFilter());
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
            getExtensionLogger().error(LogCategory.FILESYSTEM, `Error reading folder contents for ${displayPath}`, err);
            NotificationManager.showError(`Error reading folder: ${err.message}`);
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