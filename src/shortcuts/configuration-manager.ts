import * as fs from 'fs';
import * as yaml from 'js-yaml';
import * as path from 'path';
import * as vscode from 'vscode';
import { CONFIG_DIRECTORY, CONFIG_FILE_NAME, DEFAULT_SHORTCUTS_CONFIG, ShortcutConfig, ShortcutsConfig, LogicalGroup, LogicalGroupItem } from './types';

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
     * Add a new folder shortcut to the configuration
     * @param folderPath Path to the folder
     * @param displayName Optional display name
     */
    async addShortcut(folderPath: string, displayName?: string): Promise<void> {
        try {
            const config = await this.loadConfiguration();

            // Resolve and validate the path
            const resolvedPath = this.resolvePath(folderPath);

            // Check if shortcut already exists
            const existingShortcut = config.shortcuts.find(s =>
                path.resolve(this.workspaceRoot, s.path) === resolvedPath
            );

            if (existingShortcut) {
                vscode.window.showWarningMessage('This folder is already added as a shortcut.');
                return;
            }

            // Create relative path from workspace root
            const relativePath = path.relative(this.workspaceRoot, resolvedPath);

            // Add new shortcut
            const newShortcut: ShortcutConfig = {
                path: relativePath.startsWith('..') ? resolvedPath : relativePath,
                name: displayName || path.basename(resolvedPath)
            };

            config.shortcuts.push(newShortcut);
            await this.saveConfiguration(config);

        } catch (error) {
            const err = error instanceof Error ? error : new Error('Unknown error');
            console.error('Error adding shortcut:', err);
            vscode.window.showErrorMessage(`Failed to add shortcut: ${err.message}`);
            throw error;
        }
    }

    /**
     * Remove a shortcut from the configuration
     * @param folderPath Path to the folder to remove
     */
    async removeShortcut(folderPath: string): Promise<void> {
        try {
            const config = await this.loadConfiguration();

            const resolvedPath = this.resolvePath(folderPath);

            // Find and remove the shortcut
            const initialLength = config.shortcuts.length;
            config.shortcuts = config.shortcuts.filter(s =>
                path.resolve(this.workspaceRoot, s.path) !== resolvedPath
            );

            if (config.shortcuts.length === initialLength) {
                vscode.window.showWarningMessage('Shortcut not found.');
                return;
            }

            await this.saveConfiguration(config);

        } catch (error) {
            const err = error instanceof Error ? error : new Error('Unknown error');
            console.error('Error removing shortcut:', err);
            vscode.window.showErrorMessage(`Failed to remove shortcut: ${err.message}`);
            throw error;
        }
    }

    /**
     * Rename a shortcut in the configuration
     * @param folderPath Path to the folder
     * @param newName New display name
     */
    async renameShortcut(folderPath: string, newName: string): Promise<void> {
        try {
            const config = await this.loadConfiguration();

            const resolvedPath = this.resolvePath(folderPath);

            // Find and update the shortcut
            const shortcut = config.shortcuts.find(s =>
                path.resolve(this.workspaceRoot, s.path) === resolvedPath
            );

            if (!shortcut) {
                vscode.window.showWarningMessage('Shortcut not found.');
                return;
            }

            shortcut.name = newName;
            await this.saveConfiguration(config);

        } catch (error) {
            const err = error instanceof Error ? error : new Error('Unknown error');
            console.error('Error renaming shortcut:', err);
            vscode.window.showErrorMessage(`Failed to rename shortcut: ${err.message}`);
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
     * Validate and normalize configuration object
     * @param config Raw configuration object
     * @returns Validated ShortcutsConfig
     */
    private validateConfiguration(config: any): ShortcutsConfig {
        if (!config || typeof config !== 'object') {
            throw new Error('Configuration must be an object');
        }

        if (!Array.isArray(config.shortcuts)) {
            throw new Error('Configuration must contain a "shortcuts" array');
        }

        // Validate each shortcut entry
        const validShortcuts: ShortcutConfig[] = [];

        for (const shortcut of config.shortcuts) {
            if (!shortcut || typeof shortcut !== 'object') {
                console.warn('Skipping invalid shortcut entry:', shortcut);
                continue;
            }

            if (typeof shortcut.path !== 'string' || !shortcut.path.trim()) {
                console.warn('Skipping shortcut with invalid path:', shortcut);
                continue;
            }

            // Validate that the path exists
            try {
                const resolvedPath = this.resolvePath(shortcut.path);
                if (!fs.existsSync(resolvedPath)) {
                    console.warn(`Skipping shortcut with non-existent path: ${shortcut.path}`);
                    continue;
                }

                if (!fs.statSync(resolvedPath).isDirectory()) {
                    console.warn(`Skipping shortcut with non-directory path: ${shortcut.path}`);
                    continue;
                }
            } catch (error) {
                const err = error instanceof Error ? error : new Error('Unknown error');
                console.warn(`Skipping shortcut with invalid path: ${shortcut.path}`, err);
                continue;
            }

            validShortcuts.push({
                path: shortcut.path,
                name: typeof shortcut.name === 'string' ? shortcut.name : undefined
            });
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
                        const resolvedPath = this.resolvePath(item.path);
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
            shortcuts: validShortcuts,
            logicalGroups: validLogicalGroups
        };
    }

    /**
     * Handle configuration file changes with debouncing
     */
    private handleConfigFileChange(): void {
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
     * Add an item to a logical group
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
            const resolvedPath = this.resolvePath(itemPath);

            // Check if item already exists in group
            const existingItem = group.items.find(item =>
                path.resolve(this.workspaceRoot, item.path) === resolvedPath
            );

            if (existingItem) {
                vscode.window.showWarningMessage('This item is already in the logical group.');
                return;
            }

            // Create relative path from workspace root
            const relativePath = path.relative(this.workspaceRoot, resolvedPath);

            // Add new item
            const newItem: LogicalGroupItem = {
                path: relativePath.startsWith('..') ? resolvedPath : relativePath,
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

            const resolvedPath = this.resolvePath(itemPath);

            // Find and remove the item
            const initialLength = group.items.length;
            group.items = group.items.filter(item =>
                path.resolve(this.workspaceRoot, item.path) !== resolvedPath
            );

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