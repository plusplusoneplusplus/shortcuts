import * as fs from 'fs';
import * as yaml from 'js-yaml';
import * as path from 'path';
import * as vscode from 'vscode';
import { CONFIG_DIRECTORY, CONFIG_FILE_NAME, DEFAULT_SHORTCUTS_CONFIG, ShortcutConfig, ShortcutsConfig } from './types';

/**
 * Manages loading, saving, and validation of shortcuts configuration
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
     * Load configuration from YAML file
     * @returns Promise resolving to ShortcutsConfig
     */
    async loadConfiguration(): Promise<ShortcutsConfig> {
        try {
            // Check if config file exists
            if (!fs.existsSync(this.configPath)) {
                // Create default configuration if file doesn't exist
                await this.saveConfiguration(DEFAULT_SHORTCUTS_CONFIG);
                return DEFAULT_SHORTCUTS_CONFIG;
            }

            // Read and parse YAML file
            const fileContent = fs.readFileSync(this.configPath, 'utf8');
            const parsedConfig = yaml.load(fileContent) as any;

            // Validate and normalize configuration
            const config = this.validateConfiguration(parsedConfig);
            return config;

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

        return {
            shortcuts: validShortcuts
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
}