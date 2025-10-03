import { execSync } from 'child_process';
import * as fs from 'fs';
import * as yaml from 'js-yaml';
import * as path from 'path';
import * as vscode from 'vscode';
import { BasePath, CONFIG_DIRECTORY, CONFIG_FILE_NAME, DEFAULT_SHORTCUTS_CONFIG, LogicalGroup, LogicalGroupItem, ShortcutsConfig } from './types';

/**
 * Manages loading, saving, and validation of shortcuts configuration
 *
 * Configuration Override Hierarchy:
 * 1. Project config: {workspace}/.vscode/shortcuts.yaml (complete override)
 * 2. Global config: ~/.vscode-shortcuts/.vscode/shortcuts.yaml (fallback only)
 *
 * Simple override behavior:
 * - If project config exists → use ONLY project config
 * - If no project config → use global config as fallback
 * - No merging - project config completely overrides global when present
 */
export class ConfigurationManager {
    private readonly configPath: string;
    private readonly workspaceRoot: string;
    private fileWatcher?: vscode.FileSystemWatcher;
    private reloadCallback?: () => void;
    private debounceTimer?: NodeJS.Timeout;
    private configCache?: { config: ShortcutsConfig; timestamp: number };
    private readonly CACHE_TTL = 5000; // 5 seconds

    constructor(workspaceRoot: string) {
        this.workspaceRoot = workspaceRoot;
        this.configPath = path.join(workspaceRoot, CONFIG_DIRECTORY, CONFIG_FILE_NAME);
    }

    /**
     * Load configuration from YAML file with override hierarchy
     * Project config completely overrides global config when both exist
     * @returns Promise resolving to ShortcutsConfig
     */
    async loadConfiguration(): Promise<ShortcutsConfig> {
        // Check cache first
        if (this.configCache && Date.now() - this.configCache.timestamp < this.CACHE_TTL) {
            return this.configCache.config;
        }

        try {
            const config = await this.loadConfigurationFromDisk();

            // Cache the configuration
            this.configCache = { config, timestamp: Date.now() };

            return config;
        } catch (error) {
            // If caching fails, return the configuration anyway
            return this.loadConfigurationFromDisk();
        }
    }

    /**
     * Load configuration from disk without caching
     */
    private async loadConfigurationFromDisk(): Promise<ShortcutsConfig> {
        try {
            // Try to load workspace-specific config first (highest priority)
            if (this.isWorkspaceConfig() && fs.existsSync(this.configPath)) {
                try {
                    const workspaceContent = fs.readFileSync(this.configPath, 'utf8');
                    const parsedWorkspaceConfig = yaml.load(workspaceContent) as any;
                    const workspaceConfig = this.validateConfiguration(parsedWorkspaceConfig);
                    console.log('Using workspace configuration');
                    return workspaceConfig;
                } catch (error) {
                    console.warn('Error loading workspace config, falling back to global:', error);
                }
            }

            // Fallback to global config if workspace doesn't exist or failed to load
            const globalConfigPath = this.getGlobalConfigPath();
            if (fs.existsSync(globalConfigPath)) {
                try {
                    const globalContent = fs.readFileSync(globalConfigPath, 'utf8');
                    const parsedGlobalConfig = yaml.load(globalContent) as any;
                    const globalConfig = this.validateConfiguration(parsedGlobalConfig);
                    console.log('Using global configuration');
                    return globalConfig;
                } catch (error) {
                    console.warn('Error loading global config:', error);
                }
            }

            // If no configuration exists, create default in appropriate location
            console.log('No configuration found, creating default');
            await this.saveConfiguration(DEFAULT_SHORTCUTS_CONFIG);
            return DEFAULT_SHORTCUTS_CONFIG;

        } catch (error) {
            const err = error instanceof Error ? error : new Error('Unknown error');
            console.error('Configuration load error:', err);

            let userMessage: string;
            if (err.message.includes('ENOENT') || err.message.includes('no such file')) {
                userMessage = 'Configuration file not found. A default configuration will be created.';
            } else if (err.message.includes('EACCES') || err.message.includes('permission denied')) {
                userMessage = 'Permission denied accessing configuration file. Please check file permissions.';
                vscode.window.showWarningMessage(userMessage);
            } else if (err.message.includes('YAMLException') || err.message.includes('invalid yaml')) {
                userMessage = 'Configuration file contains invalid YAML syntax. Please check the file format.';
                vscode.window.showWarningMessage(userMessage, 'Open Configuration File').then(action => {
                    if (action === 'Open Configuration File') {
                        vscode.commands.executeCommand('vscode.open', vscode.Uri.file(this.configPath));
                    }
                });
            } else {
                userMessage = 'Failed to load configuration file. Using default settings.';
                vscode.window.showWarningMessage(userMessage);
            }

            return DEFAULT_SHORTCUTS_CONFIG;
        }
    }

    /**
     * Save configuration to YAML file
     * @param config Configuration to save
     */
    async saveConfiguration(config: ShortcutsConfig): Promise<void> {
        try {
            // Invalidate cache before saving
            this.configCache = undefined;

            // Ensure .vscode directory exists
            const configDir = path.dirname(this.configPath);
            if (!fs.existsSync(configDir)) {
                fs.mkdirSync(configDir, { recursive: true });
            }

            // Convert to YAML and write to file
            const yamlContent = yaml.dump(config, {
                indent: 2,
                lineWidth: -1,
                noRefs: true
            });

            fs.writeFileSync(this.configPath, yamlContent, 'utf8');

        } catch (error) {
            const err = error instanceof Error ? error : new Error('Unknown error');
            console.error('Configuration save error:', err);

            let userMessage: string;
            if (err.message.includes('EACCES') || err.message.includes('permission denied')) {
                userMessage = 'Permission denied saving configuration file. Please check file permissions.';
            } else if (err.message.includes('ENOSPC') || err.message.includes('no space left')) {
                userMessage = 'Not enough disk space to save configuration file.';
            } else {
                userMessage = 'Failed to save configuration file. Changes may not be persisted.';
            }

            vscode.window.showErrorMessage(userMessage);
            throw error;
        }
    }

    /**
     * Get the full path to the configuration file
     */
    getConfigPath(): string {
        return this.configPath;
    }

    /**
     * Get the global configuration path
     */
    private getGlobalConfigPath(): string {
        const os = require('os');
        return path.join(os.homedir(), '.vscode-shortcuts', CONFIG_DIRECTORY, CONFIG_FILE_NAME);
    }

    /**
     * Check if current config is workspace-specific
     */
    private isWorkspaceConfig(): boolean {
        return !this.workspaceRoot.includes('.vscode-shortcuts');
    }


    /**
     * Start watching the configuration file for external changes
     * @param callback Function to call when file changes
     * @returns FileSystemWatcher instance
     */
    watchConfigFile(callback: () => void): vscode.FileSystemWatcher {
        // Dispose existing watcher if any
        this.dispose();

        this.reloadCallback = callback;

        // Create file watcher for the configuration file
        const pattern = new vscode.RelativePattern(
            path.dirname(this.configPath),
            CONFIG_FILE_NAME
        );

        this.fileWatcher = vscode.workspace.createFileSystemWatcher(pattern);

        // Watch for file changes, creation, and deletion
        this.fileWatcher.onDidChange(() => {
            console.log('Shortcuts configuration file changed externally');
            this.handleConfigFileChange();
        });

        this.fileWatcher.onDidCreate(() => {
            console.log('Shortcuts configuration file created externally');
            this.handleConfigFileChange();
        });

        this.fileWatcher.onDidDelete(() => {
            console.log('Shortcuts configuration file deleted externally');
            this.handleConfigFileChange();
        });

        return this.fileWatcher;
    }

    /**
     * Stop watching the configuration file and dispose resources
     */
    dispose(): void {
        if (this.fileWatcher) {
            this.fileWatcher.dispose();
            this.fileWatcher = undefined;
        }
        this.reloadCallback = undefined;
    }

    /**
     * Migrate old physical shortcuts to logical groups
     * @param config Configuration with possible old shortcuts array
     * @returns Configuration with shortcuts migrated to logical groups
     */
    private migratePhysicalShortcuts(config: any): any {
        // If there are old physical shortcuts, migrate them to logical groups
        if (config.shortcuts && Array.isArray(config.shortcuts) && config.shortcuts.length > 0) {
            console.log('Migrating physical shortcuts to logical groups...');

            if (!config.logicalGroups) {
                config.logicalGroups = [];
            }

            // Convert each physical shortcut to a logical group
            for (const shortcut of config.shortcuts) {
                if (!shortcut || typeof shortcut !== 'object') {
                    continue;
                }

                if (typeof shortcut.path !== 'string' || !shortcut.path.trim()) {
                    continue;
                }

                // Validate that the path exists (no basePaths during migration as they're from old config)
                try {
                    const resolvedPath = this.resolvePath(shortcut.path, config.basePaths);
                    if (!fs.existsSync(resolvedPath)) {
                        console.warn(`Skipping migration of shortcut with non-existent path: ${shortcut.path}`);
                        continue;
                    }

                    if (!fs.statSync(resolvedPath).isDirectory()) {
                        console.warn(`Skipping migration of shortcut with non-directory path: ${shortcut.path}`);
                        continue;
                    }

                    const groupName = shortcut.name || path.basename(resolvedPath);

                    // Check if group with this name already exists
                    const existingGroup = config.logicalGroups.find((g: any) => g.name === groupName);
                    if (existingGroup) {
                        console.warn(`Group "${groupName}" already exists, skipping migration of shortcut`);
                        continue;
                    }

                    // Create a new logical group with this single folder
                    const newGroup: LogicalGroup = {
                        name: groupName,
                        items: [
                            {
                                path: shortcut.path,
                                name: path.basename(resolvedPath),
                                type: 'folder'
                            }
                        ]
                    };

                    config.logicalGroups.push(newGroup);
                } catch (error) {
                    const err = error instanceof Error ? error : new Error('Unknown error');
                    console.warn(`Error migrating shortcut ${shortcut.path}:`, err);
                }
            }

            // Remove the old shortcuts array
            delete config.shortcuts;
            console.log('Migration complete. Physical shortcuts have been converted to logical groups.');
        }

        return config;
    }

    /**
     * Validate and normalize configuration object
     * @param config Raw configuration object
     * @returns Validated ShortcutsConfig
     */
    private validateConfiguration(config: any): ShortcutsConfig {
        if (!config || typeof config !== 'object') {
            throw new Error('Configuration must be an object');
        }

        // Migrate old physical shortcuts to logical groups if they exist
        config = this.migratePhysicalShortcuts(config);

        // Validate base paths
        let validBasePaths: BasePath[] = [];
        if (config.basePaths && Array.isArray(config.basePaths)) {
            for (const basePath of config.basePaths) {
                if (!basePath || typeof basePath !== 'object') {
                    console.warn('Skipping invalid base path:', basePath);
                    continue;
                }

                if (typeof basePath.alias !== 'string' || !basePath.alias.trim()) {
                    console.warn('Skipping base path with invalid alias:', basePath);
                    continue;
                }

                // Ensure alias starts with @
                const normalizedAlias = basePath.alias.startsWith('@')
                    ? basePath.alias
                    : `@${basePath.alias}`;

                if (typeof basePath.path !== 'string' || !basePath.path.trim()) {
                    console.warn('Skipping base path with invalid path:', basePath);
                    continue;
                }

                validBasePaths.push({
                    alias: normalizedAlias,
                    path: basePath.path
                });
            }
        }

        // Validate logical groups
        let validLogicalGroups: LogicalGroup[] = [];
        if (config.logicalGroups && Array.isArray(config.logicalGroups)) {
            for (const group of config.logicalGroups) {
                if (!group || typeof group !== 'object') {
                    console.warn('Skipping invalid logical group:', group);
                    continue;
                }

                if (typeof group.name !== 'string' || !group.name.trim()) {
                    console.warn('Skipping logical group with invalid name:', group);
                    continue;
                }

                if (!Array.isArray(group.items)) {
                    console.warn('Skipping logical group with invalid items array:', group);
                    continue;
                }

                const validItems: LogicalGroupItem[] = [];
                for (const item of group.items) {
                    if (!item || typeof item !== 'object') {
                        console.warn('Skipping invalid logical group item:', item);
                        continue;
                    }

                    if (typeof item.path !== 'string' || !item.path.trim()) {
                        console.warn('Skipping logical group item with invalid path:', item);
                        continue;
                    }

                    if (typeof item.name !== 'string' || !item.name.trim()) {
                        console.warn('Skipping logical group item with invalid name:', item);
                        continue;
                    }

                    if (item.type !== 'folder' && item.type !== 'file') {
                        console.warn('Skipping logical group item with invalid type:', item);
                        continue;
                    }

                    // Validate that the path exists
                    try {
                        const resolvedPath = this.resolvePath(item.path, validBasePaths);
                        if (!fs.existsSync(resolvedPath)) {
                            console.warn(`Skipping logical group item with non-existent path: ${item.path}`);
                            continue;
                        }

                        const stat = fs.statSync(resolvedPath);
                        const actualType = stat.isDirectory() ? 'folder' : 'file';
                        if (actualType !== item.type) {
                            console.warn(`Logical group item type mismatch for ${item.path}: expected ${item.type}, found ${actualType}. Using actual type.`);
                        }

                        validItems.push({
                            path: item.path,
                            name: item.name,
                            type: actualType as 'folder' | 'file'
                        });
                    } catch (error) {
                        const err = error instanceof Error ? error : new Error('Unknown error');
                        console.warn(`Skipping logical group item with invalid path: ${item.path}`, err);
                        continue;
                    }
                }

                validLogicalGroups.push({
                    name: group.name,
                    description: typeof group.description === 'string' ? group.description : undefined,
                    items: validItems,
                    icon: typeof group.icon === 'string' ? group.icon : undefined
                });
            }
        }

        return {
            basePaths: validBasePaths.length > 0 ? validBasePaths : undefined,
            logicalGroups: validLogicalGroups
        };
    }

    /**
     * Handle configuration file changes with debouncing
     */
    private handleConfigFileChange(): void {
        // Invalidate cache when config file changes
        this.configCache = undefined;

        // Debounce rapid file changes (e.g., during save operations)
        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
        }

        this.debounceTimer = setTimeout(() => {
            if (this.reloadCallback) {
                this.reloadCallback();
            }
        }, 300); // 300ms debounce
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
     * Normalize a path for cross-platform comparison
     * Converts to lowercase on Windows and normalizes separators
     * @param filePath Path to normalize
     * @returns Normalized path
     */
    private normalizePath(filePath: string): string {
        const normalized = path.normalize(filePath);
        // On Windows, paths are case-insensitive, so normalize case for comparison
        return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
    }

    /**
     * Find the git root directory for a given path
     * @param filePath Path to find git root for
     * @returns Git root path or undefined if not in a git repository
     */
    private findGitRoot(filePath: string): string | undefined {
        try {
            const directory = fs.statSync(filePath).isDirectory() ? filePath : path.dirname(filePath);
            const gitRoot = execSync('git rev-parse --show-toplevel', {
                cwd: directory,
                encoding: 'utf8',
                stdio: ['pipe', 'pipe', 'ignore'] // Suppress stderr
            }).trim();
            return gitRoot;
        } catch (error) {
            // Not in a git repository or git not available
            return undefined;
        }
    }

    /**
     * Find a matching base path alias for a given file path
     * @param filePath Path to find alias for
     * @param basePaths Array of base path configurations
     * @returns Matching alias or undefined if no match found
     */
    private findMatchingAlias(filePath: string, basePaths?: BasePath[]): { alias: string; relativePath: string } | undefined {
        if (!basePaths || basePaths.length === 0) {
            return undefined;
        }

        const absolutePath = path.isAbsolute(filePath) ? filePath : path.resolve(this.workspaceRoot, filePath);
        const normalizedPath = this.normalizePath(absolutePath);

        // Try to find a base path that contains this file
        for (const basePath of basePaths) {
            const resolvedBasePath = path.isAbsolute(basePath.path)
                ? basePath.path
                : path.resolve(this.workspaceRoot, basePath.path);
            const normalizedBasePath = this.normalizePath(resolvedBasePath);

            // Check if the file is within this base path
            if (normalizedPath.startsWith(normalizedBasePath)) {
                const relativePath = path.relative(resolvedBasePath, absolutePath);
                // Make sure it's actually a relative path (not starting with ..)
                if (!relativePath.startsWith('..')) {
                    return {
                        alias: basePath.alias,
                        relativePath: relativePath
                    };
                }
            }
        }

        return undefined;
    }

    /**
     * Convert an absolute path to use an alias if available
     * @param filePath Path to convert
     * @param basePaths Array of base path configurations
     * @returns Path using alias if available, or original path
     */
    private convertPathToAlias(filePath: string, basePaths?: BasePath[]): string {
        const match = this.findMatchingAlias(filePath, basePaths);
        if (match) {
            // Use forward slashes for consistency in config files
            const normalizedRelative = match.relativePath.replace(/\\/g, '/');
            return `${match.alias}/${normalizedRelative}`;
        }
        return filePath;
    }

    /**
     * Create a new logical group
     * @param groupName Name of the group
     * @param description Optional description
     */
    async createLogicalGroup(groupName: string, description?: string): Promise<void> {
        try {
            const config = await this.loadConfiguration();

            // Check if group already exists
            if (config.logicalGroups && config.logicalGroups.some(g => g.name === groupName)) {
                vscode.window.showWarningMessage('A logical group with this name already exists.');
                return;
            }

            // Initialize logicalGroups if it doesn't exist
            if (!config.logicalGroups) {
                config.logicalGroups = [];
            }

            // Add new group
            const newGroup: LogicalGroup = {
                name: groupName,
                description: description,
                items: []
            };

            config.logicalGroups.push(newGroup);
            await this.saveConfiguration(config);

        } catch (error) {
            const err = error instanceof Error ? error : new Error('Unknown error');
            console.error('Error creating logical group:', err);
            vscode.window.showErrorMessage(`Failed to create logical group: ${err.message}`);
            throw error;
        }
    }

    /**
     * Create a nested logical group within a parent group
     * @param parentGroupPath Path to the parent group (e.g., "parent" or "parent/child")
     * @param groupName Name of the new nested group
     * @param description Optional description
     */
    async createNestedLogicalGroup(parentGroupPath: string, groupName: string, description?: string): Promise<void> {
        try {
            const config = await this.loadConfiguration();

            // Find the parent group
            const pathParts = parentGroupPath.split('/');
            let currentGroups = config.logicalGroups;
            let targetGroup: LogicalGroup | undefined;

            for (const part of pathParts) {
                targetGroup = currentGroups.find(g => g.name === part);
                if (!targetGroup) {
                    vscode.window.showErrorMessage(`Parent group "${parentGroupPath}" not found.`);
                    return;
                }
                currentGroups = targetGroup.groups || [];
            }

            // Final check to ensure targetGroup is defined (TypeScript safety)
            if (!targetGroup) {
                vscode.window.showErrorMessage(`Parent group "${parentGroupPath}" not found.`);
                return;
            }

            // Check if nested group already exists in parent
            if (targetGroup.groups && targetGroup.groups.some(g => g.name === groupName)) {
                vscode.window.showWarningMessage(`A nested group with the name "${groupName}" already exists in this group.`);
                return;
            }

            // Initialize groups array if it doesn't exist
            if (!targetGroup.groups) {
                targetGroup.groups = [];
            }

            // Add new nested group
            const newGroup: LogicalGroup = {
                name: groupName,
                description: description,
                items: []
            };

            targetGroup.groups.push(newGroup);
            await this.saveConfiguration(config);

        } catch (error) {
            const err = error instanceof Error ? error : new Error('Unknown error');
            console.error('Error creating nested logical group:', err);
            vscode.window.showErrorMessage(`Failed to create nested group: ${err.message}`);
            throw error;
        }
    }

    /**
     * Add an item to a logical group with automatic alias detection
     * @param groupName Name of the group
     * @param itemPath Path to the item
     * @param itemName Display name for the item
     * @param itemType Type of the item (folder or file)
     */
    async addToLogicalGroup(groupName: string, itemPath: string, itemName: string, itemType: 'folder' | 'file'): Promise<void> {
        try {
            const config = await this.loadConfiguration();

            // Find the group
            if (!config.logicalGroups) {
                config.logicalGroups = [];
            }

            const group = config.logicalGroups.find(g => g.name === groupName);
            if (!group) {
                vscode.window.showErrorMessage('Logical group not found.');
                return;
            }

            // Resolve and validate the path
            const resolvedPath = this.resolvePath(itemPath, config.basePaths);

            // Check if item already exists in group
            // Use normalized paths for cross-platform comparison (Windows is case-insensitive)
            const normalizedResolvedPath = this.normalizePath(resolvedPath);
            const existingItem = group.items.find(item => {
                if (!item.path) {
                    return false; // Skip command/task items
                }
                const itemResolvedPath = this.resolvePath(item.path, config.basePaths);
                return this.normalizePath(itemResolvedPath) === normalizedResolvedPath;
            });

            if (existingItem) {
                vscode.window.showWarningMessage('This item is already in the logical group.');
                return;
            }

            // Try to use an alias if available
            let pathToStore: string;

            // First, try to find an existing alias that matches
            const aliasMatch = this.findMatchingAlias(resolvedPath, config.basePaths);
            if (aliasMatch) {
                // Use forward slashes for consistency
                const normalizedRelative = aliasMatch.relativePath.replace(/\\/g, '/');
                pathToStore = `${aliasMatch.alias}/${normalizedRelative}`;
                console.log(`Using existing alias for path: ${pathToStore}`);
            } else {
                // Check if file is in a git repository
                const gitRoot = this.findGitRoot(resolvedPath);

                if (gitRoot && config.basePaths) {
                    // Check if this git root already has an alias
                    const normalizedGitRoot = this.normalizePath(gitRoot);
                    const existingAliasForGitRoot = config.basePaths.find(bp => {
                        const resolvedBasePath = path.isAbsolute(bp.path)
                            ? bp.path
                            : path.resolve(this.workspaceRoot, bp.path);
                        return this.normalizePath(resolvedBasePath) === normalizedGitRoot;
                    });

                    if (existingAliasForGitRoot) {
                        // Use the existing alias
                        const relativePath = path.relative(gitRoot, resolvedPath);
                        const normalizedRelative = relativePath.replace(/\\/g, '/');
                        pathToStore = `${existingAliasForGitRoot.alias}/${normalizedRelative}`;
                        console.log(`Using git root alias for path: ${pathToStore}`);
                    } else {
                        // Use relative or absolute path as before
                        const relativePath = path.relative(this.workspaceRoot, resolvedPath);
                        pathToStore = relativePath.startsWith('..') ? resolvedPath : relativePath;
                    }
                } else {
                    // Use relative or absolute path as before
                    const relativePath = path.relative(this.workspaceRoot, resolvedPath);
                    pathToStore = relativePath.startsWith('..') ? resolvedPath : relativePath;
                }
            }

            // Add new item
            const newItem: LogicalGroupItem = {
                path: pathToStore,
                name: itemName,
                type: itemType
            };

            group.items.push(newItem);
            await this.saveConfiguration(config);

        } catch (error) {
            const err = error instanceof Error ? error : new Error('Unknown error');
            console.error('Error adding to logical group:', err);
            vscode.window.showErrorMessage(`Failed to add to logical group: ${err.message}`);
            throw error;
        }
    }

    /**
     * Remove an item from a logical group
     * @param groupName Name of the group
     * @param itemPath Path to the item to remove
     */
    async removeFromLogicalGroup(groupName: string, itemPath: string): Promise<void> {
        try {
            const config = await this.loadConfiguration();

            if (!config.logicalGroups) {
                return;
            }

            const group = config.logicalGroups.find(g => g.name === groupName);
            if (!group) {
                vscode.window.showErrorMessage('Logical group not found.');
                return;
            }

            const resolvedPath = this.resolvePath(itemPath, config.basePaths);

            // Find and remove the item
            // Use normalized paths for cross-platform comparison (Windows is case-insensitive)
            const normalizedResolvedPath = this.normalizePath(resolvedPath);
            const initialLength = group.items.length;
            group.items = group.items.filter(item => {
                if (!item.path) {
                    return true; // Keep command/task items
                }
                const itemResolvedPath = this.resolvePath(item.path, config.basePaths);
                return this.normalizePath(itemResolvedPath) !== normalizedResolvedPath;
            });

            if (group.items.length === initialLength) {
                vscode.window.showWarningMessage('Item not found in logical group.');
                return;
            }

            await this.saveConfiguration(config);

        } catch (error) {
            const err = error instanceof Error ? error : new Error('Unknown error');
            console.error('Error removing from logical group:', err);
            vscode.window.showErrorMessage(`Failed to remove from logical group: ${err.message}`);
            throw error;
        }
    }

    /**
     * Rename a logical group
     * @param oldName Current name of the group
     * @param newName New name for the group
     */
    async renameLogicalGroup(oldName: string, newName: string): Promise<void> {
        try {
            const config = await this.loadConfiguration();

            if (!config.logicalGroups) {
                return;
            }

            // Check if new name already exists
            if (config.logicalGroups.some(g => g.name === newName)) {
                vscode.window.showWarningMessage('A logical group with this name already exists.');
                return;
            }

            const group = config.logicalGroups.find(g => g.name === oldName);
            if (!group) {
                vscode.window.showErrorMessage('Logical group not found.');
                return;
            }

            group.name = newName;
            await this.saveConfiguration(config);

        } catch (error) {
            const err = error instanceof Error ? error : new Error('Unknown error');
            console.error('Error renaming logical group:', err);
            vscode.window.showErrorMessage(`Failed to rename logical group: ${err.message}`);
            throw error;
        }
    }

    /**
     * Delete a logical group
     * @param groupName Name of the group to delete
     */
    async deleteLogicalGroup(groupName: string): Promise<void> {
        try {
            const config = await this.loadConfiguration();

            if (!config.logicalGroups) {
                return;
            }

            // Find and remove the group
            const initialLength = config.logicalGroups.length;
            config.logicalGroups = config.logicalGroups.filter(g => g.name !== groupName);

            if (config.logicalGroups.length === initialLength) {
                vscode.window.showWarningMessage('Logical group not found.');
                return;
            }

            await this.saveConfiguration(config);

        } catch (error) {
            const err = error instanceof Error ? error : new Error('Unknown error');
            console.error('Error deleting logical group:', err);
            vscode.window.showErrorMessage(`Failed to delete logical group: ${err.message}`);
            throw error;
        }
    }
}