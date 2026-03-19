import { execSync } from 'child_process';
import * as fs from 'fs';
import * as yaml from 'js-yaml';
import * as path from 'path';
import * as vscode from 'vscode';
import { CURRENT_CONFIG_VERSION, detectConfigVersion, migrateConfig } from './config-migrations';
import { NotificationManager } from './notification-manager';
import { getExtensionLogger, LogCategory } from './shared/extension-logger';
import { ensureDirectoryExists, readYAML, safeExists, safeIsDirectory, safeStats, safeWriteFile, writeYAML } from './shared';
import { SyncManager } from './sync/sync-manager';
import { BasePath, CONFIG_DIRECTORY, CONFIG_FILE_NAME, DEFAULT_SHORTCUTS_CONFIG, GlobalNote, LogicalGroup, LogicalGroupItem, ShortcutsConfig, SyncConfig } from './types';

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
    private syncManager?: SyncManager;
    private extensionContext?: vscode.ExtensionContext;

    constructor(workspaceRoot: string, context?: vscode.ExtensionContext) {
        this.workspaceRoot = workspaceRoot;
        this.configPath = path.join(workspaceRoot, CONFIG_DIRECTORY, CONFIG_FILE_NAME);
        this.extensionContext = context;
    }

    /**
     * Invalidate the in-memory configuration cache. Useful for tests to force reloads.
     */
    public invalidateCache(): void {
        this.configCache = undefined;
    }

    /**
     * Initialize sync manager
     */
    async initializeSyncManager(): Promise<void> {
        if (!this.extensionContext) {
            return;
        }

        // Read sync settings from VSCode settings
        const syncConfig = this.getSyncConfigFromSettings();

        if (syncConfig?.enabled) {
            this.syncManager = new SyncManager(this.extensionContext, syncConfig);
            await this.syncManager.initialize();

            // Check for cloud updates on initialization
            await this.checkAndSyncFromCloud();
        }
    }

    /**
     * Get sync configuration from VSCode settings
     */
    private getSyncConfigFromSettings(): SyncConfig | undefined {
        const config = vscode.workspace.getConfiguration('workspaceShortcuts.sync');

        const enabled = config.get<boolean>('enabled', false);
        if (!enabled) {
            return undefined;
        }

        const provider = config.get<string>('provider', 'vscode');
        const autoSync = config.get<boolean>('autoSync', true);
        const syncInterval = config.get<number>('syncInterval', 300);

        const syncConfig: SyncConfig = {
            enabled,
            autoSync,
            syncInterval,
            providers: {}
        };

        // Configure VSCode sync provider
        if (provider === 'vscode') {
            const scope = config.get<'global' | 'workspace'>('vscode.scope', 'global');
            syncConfig.providers.vscodeSync = {
                enabled: true,
                scope
            };
        }

        return syncConfig;
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

            // Check for cloud updates if sync is enabled
            if (this.syncManager?.isEnabled()) {
                const cloudUpdate = await this.checkAndSyncFromCloud();
                if (cloudUpdate) {
                    // Cache the cloud configuration
                    this.configCache = { config: cloudUpdate, timestamp: Date.now() };
                    return cloudUpdate;
                }
            }

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
            if (this.isWorkspaceConfig() && safeExists(this.configPath)) {
                const workspaceResult = readYAML<any>(this.configPath);
                if (workspaceResult.success) {
                    try {
                        const workspaceConfig = this.validateConfiguration(workspaceResult.data);
                        getExtensionLogger().info(LogCategory.CONFIG, 'Using workspace configuration');
                        return workspaceConfig;
                    } catch (error) {
                        const err = error instanceof Error ? error : new Error(String(error));
                        getExtensionLogger().warn(LogCategory.CONFIG, 'Error validating workspace config, falling back to global', { error: err.message });
                    }
                } else {
                    getExtensionLogger().warn(LogCategory.CONFIG, 'Error loading workspace config, falling back to global', { error: workspaceResult.error?.message });
                }
            }

            // Fallback to global config if workspace doesn't exist or failed to load
            const globalConfigPath = this.getGlobalConfigPath();
            if (safeExists(globalConfigPath)) {
                const globalResult = readYAML<any>(globalConfigPath);
                if (globalResult.success) {
                    try {
                        const globalConfig = this.validateConfiguration(globalResult.data);
                        getExtensionLogger().info(LogCategory.CONFIG, 'Using global configuration');
                        return globalConfig;
                    } catch (error) {
                        const err = error instanceof Error ? error : new Error(String(error));
                        getExtensionLogger().warn(LogCategory.CONFIG, 'Error validating global config', { error: err.message });
                    }
                } else {
                    getExtensionLogger().warn(LogCategory.CONFIG, 'Error loading global config', { error: globalResult.error?.message });
                }
            }

            // If no configuration exists, create default in appropriate location
            getExtensionLogger().info(LogCategory.CONFIG, 'No configuration found, creating default');
            await this.saveConfiguration(DEFAULT_SHORTCUTS_CONFIG);
            return DEFAULT_SHORTCUTS_CONFIG;

        } catch (error) {
            const err = error instanceof Error ? error : new Error('Unknown error');
            getExtensionLogger().error(LogCategory.CONFIG, 'Configuration load error', err);

            let userMessage: string;
            if (err.message.includes('ENOENT') || err.message.includes('no such file')) {
                userMessage = 'Configuration file not found. A default configuration will be created.';
            } else if (err.message.includes('EACCES') || err.message.includes('permission denied')) {
                userMessage = 'Permission denied accessing configuration file. Please check file permissions.';
                NotificationManager.showWarning(userMessage);
            } else if (err.message.includes('YAMLException') || err.message.includes('invalid yaml') || err.message.includes('YAML parse error')) {
                userMessage = 'Configuration file contains invalid YAML syntax. Please check the file format.';
                NotificationManager.showWarning(userMessage, { timeout: 0, actions: ['Open Configuration File'] }).then(action => {
                    if (action === 'Open Configuration File') {
                        vscode.commands.executeCommand('vscode.open', vscode.Uri.file(this.configPath));
                    }
                });
            } else {
                userMessage = 'Failed to load configuration file. Using default settings.';
                NotificationManager.showWarning(userMessage);
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

            // Add version number to config before saving
            const versionedConfig = {
                version: CURRENT_CONFIG_VERSION,
                ...config
            };

            // Write YAML to file (ensureDirectoryExists is handled by writeYAML)
            const result = writeYAML(this.configPath, versionedConfig);
            if (!result.success) {
                throw result.error || new Error('Failed to write configuration file');
            }

            // Sync to cloud if enabled
            if (this.syncManager?.isAutoSyncEnabled()) {
                this.syncManager.scheduleSyncToCloud(config);
            }

        } catch (error) {
            const err = error instanceof Error ? error : new Error('Unknown error');
            getExtensionLogger().error(LogCategory.CONFIG, 'Configuration save error', err);

            let userMessage: string;
            if (err.message.includes('EACCES') || err.message.includes('permission denied')) {
                userMessage = 'Permission denied saving configuration file. Please check file permissions.';
            } else if (err.message.includes('ENOSPC') || err.message.includes('no space left')) {
                userMessage = 'Not enough disk space to save configuration file.';
            } else {
                userMessage = 'Failed to save configuration file. Changes may not be persisted.';
            }

            NotificationManager.showError(userMessage);
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
     * Get information about which configuration source is currently active
     * @returns Object with source type and path
     */
    getActiveConfigSource(): { source: 'workspace' | 'global' | 'default'; path: string; exists: boolean } {
        // Check workspace config first
        if (this.isWorkspaceConfig() && safeExists(this.configPath)) {
            return {
                source: 'workspace',
                path: this.configPath,
                exists: true
            };
        }

        // Check global config
        const globalConfigPath = this.getGlobalConfigPath();
        if (safeExists(globalConfigPath)) {
            return {
                source: 'global',
                path: globalConfigPath,
                exists: true
            };
        }

        // No config exists yet - will use default
        return {
            source: 'default',
            path: this.configPath,
            exists: false
        };
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
            getExtensionLogger().debug(LogCategory.CONFIG, 'Shortcuts configuration file changed externally');
            this.handleConfigFileChange();
        });

        this.fileWatcher.onDidCreate(() => {
            getExtensionLogger().debug(LogCategory.CONFIG, 'Shortcuts configuration file created externally');
            this.handleConfigFileChange();
        });

        this.fileWatcher.onDidDelete(() => {
            getExtensionLogger().debug(LogCategory.CONFIG, 'Shortcuts configuration file deleted externally');
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
            getExtensionLogger().info(LogCategory.CONFIG, 'Migrating physical shortcuts to logical groups...');

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
                    if (!safeExists(resolvedPath)) {
                        getExtensionLogger().warn(LogCategory.CONFIG, `Skipping migration of shortcut with non-existent path: ${shortcut.path}`);
                        continue;
                    }

                    if (!safeIsDirectory(resolvedPath)) {
                        getExtensionLogger().warn(LogCategory.CONFIG, `Skipping migration of shortcut with non-directory path: ${shortcut.path}`);
                        continue;
                    }

                    const groupName = shortcut.name || path.basename(resolvedPath);

                    // Check if group with this name already exists
                    const existingGroup = config.logicalGroups.find((g: any) => g.name === groupName);
                    if (existingGroup) {
                        getExtensionLogger().warn(LogCategory.CONFIG, `Group "${groupName}" already exists, skipping migration of shortcut`);
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
                    getExtensionLogger().warn(LogCategory.CONFIG, `Error migrating shortcut ${shortcut.path}`, { error: err.message });
                }
            }

            // Remove the old shortcuts array
            delete config.shortcuts;
            getExtensionLogger().info(LogCategory.CONFIG, 'Migration complete. Physical shortcuts have been converted to logical groups.');
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

        // Detect version and migrate if needed
        const configVersion = detectConfigVersion(config);
        if (configVersion < CURRENT_CONFIG_VERSION) {
            const migrationResult = migrateConfig(config, {
                workspaceRoot: this.workspaceRoot,
                verbose: true
            });

            if (migrationResult.migrated) {
                getExtensionLogger().info(LogCategory.CONFIG, `Configuration migrated from v${migrationResult.fromVersion} to v${migrationResult.toVersion}`);

                if (migrationResult.warnings.length > 0) {
                    getExtensionLogger().warn(LogCategory.CONFIG, 'Migration warnings', { warnings: migrationResult.warnings });
                    NotificationManager.showWarning(
                        `Configuration migrated with ${migrationResult.warnings.length} warning(s). Check console for details.`,
                        { timeout: 5000 }
                    );
                }
            }

            config = migrationResult.config;
        }

        // Validate base paths
        let validBasePaths: BasePath[] = [];
        if (config.basePaths && Array.isArray(config.basePaths)) {
            for (const basePath of config.basePaths) {
                if (!basePath || typeof basePath !== 'object') {
                    getExtensionLogger().warn(LogCategory.CONFIG, 'Skipping invalid base path', { basePath });
                    continue;
                }

                if (typeof basePath.alias !== 'string' || !basePath.alias.trim()) {
                    getExtensionLogger().warn(LogCategory.CONFIG, 'Skipping base path with invalid alias', { basePath });
                    continue;
                }

                // Ensure alias starts with @
                const normalizedAlias = basePath.alias.startsWith('@')
                    ? basePath.alias
                    : `@${basePath.alias}`;

                if (typeof basePath.path !== 'string' || !basePath.path.trim()) {
                    getExtensionLogger().warn(LogCategory.CONFIG, 'Skipping base path with invalid path', { basePath });
                    continue;
                }

                // Validate type if provided
                const validTypes = ['git', 'workspace', 'docs', 'build', 'config', 'custom'];
                const type = basePath.type && validTypes.includes(basePath.type) ? basePath.type : undefined;

                validBasePaths.push({
                    alias: normalizedAlias,
                    path: basePath.path,
                    type,
                    description: typeof basePath.description === 'string' ? basePath.description : undefined
                });
            }
        }

        // Validate logical groups
        let validLogicalGroups: LogicalGroup[] = [];
        if (config.logicalGroups && Array.isArray(config.logicalGroups)) {
            for (const group of config.logicalGroups) {
                if (!group || typeof group !== 'object') {
                    getExtensionLogger().warn(LogCategory.CONFIG, 'Skipping invalid logical group', { group });
                    continue;
                }

                if (typeof group.name !== 'string' || !group.name.trim()) {
                    getExtensionLogger().warn(LogCategory.CONFIG, 'Skipping logical group with invalid name', { group });
                    continue;
                }

                if (!Array.isArray(group.items)) {
                    getExtensionLogger().warn(LogCategory.CONFIG, 'Skipping logical group with invalid items array', { group });
                    continue;
                }

                const validItems: LogicalGroupItem[] = [];
                for (const item of group.items) {
                    if (!item || typeof item !== 'object') {
                        getExtensionLogger().warn(LogCategory.CONFIG, 'Skipping invalid logical group item', { item });
                        continue;
                    }

                    if (typeof item.name !== 'string' || !item.name.trim()) {
                        getExtensionLogger().warn(LogCategory.CONFIG, 'Skipping logical group item with invalid name', { item });
                        continue;
                    }

                    if (item.type !== 'folder' && item.type !== 'file' && item.type !== 'command' && item.type !== 'task' && item.type !== 'note' && item.type !== 'commit') {
                        getExtensionLogger().warn(LogCategory.CONFIG, 'Skipping logical group item with invalid type', { item });
                        continue;
                    }

                    // Handle command items
                    if (item.type === 'command') {
                        if (typeof item.command !== 'string' || !item.command.trim()) {
                            getExtensionLogger().warn(LogCategory.CONFIG, 'Skipping command item with invalid command ID', { item });
                            continue;
                        }
                        validItems.push({
                            name: item.name,
                            type: 'command',
                            command: item.command,
                            args: item.args,
                            icon: typeof item.icon === 'string' ? item.icon : undefined
                        });
                        continue;
                    }

                    // Handle task items
                    if (item.type === 'task') {
                        if (typeof item.task !== 'string' || !item.task.trim()) {
                            getExtensionLogger().warn(LogCategory.CONFIG, 'Skipping task item with invalid task name', { item });
                            continue;
                        }
                        validItems.push({
                            name: item.name,
                            type: 'task',
                            task: item.task,
                            icon: typeof item.icon === 'string' ? item.icon : undefined
                        });
                        continue;
                    }

                    // Handle note items
                    if (item.type === 'note') {
                        if (typeof item.noteId !== 'string' || !item.noteId.trim()) {
                            getExtensionLogger().warn(LogCategory.CONFIG, 'Skipping note item with invalid note ID', { item });
                            continue;
                        }
                        validItems.push({
                            name: item.name,
                            type: 'note',
                            noteId: item.noteId,
                            icon: typeof item.icon === 'string' ? item.icon : undefined
                        });
                        continue;
                    }

                    // Handle commit items
                    if (item.type === 'commit') {
                        if (!item.commitRef || typeof item.commitRef !== 'object') {
                            getExtensionLogger().warn(LogCategory.CONFIG, 'Skipping commit item with invalid commitRef', { item });
                            continue;
                        }
                        if (typeof item.commitRef.hash !== 'string' || !item.commitRef.hash.trim()) {
                            getExtensionLogger().warn(LogCategory.CONFIG, 'Skipping commit item with invalid hash', { item });
                            continue;
                        }
                        if (typeof item.commitRef.repositoryRoot !== 'string' || !item.commitRef.repositoryRoot.trim()) {
                            getExtensionLogger().warn(LogCategory.CONFIG, 'Skipping commit item with invalid repositoryRoot', { item });
                            continue;
                        }
                        validItems.push({
                            name: item.name,
                            type: 'commit',
                            commitRef: {
                                hash: item.commitRef.hash,
                                repositoryRoot: item.commitRef.repositoryRoot
                            },
                            icon: typeof item.icon === 'string' ? item.icon : undefined
                        });
                        continue;
                    }

                    // Handle folder and file items (require path)
                    if (typeof item.path !== 'string' || !item.path.trim()) {
                        getExtensionLogger().warn(LogCategory.CONFIG, 'Skipping logical group item with invalid path', { item });
                        continue;
                    }

                    // Validate that the path exists
                    const resolvedPath = this.resolvePath(item.path, validBasePaths);
                    if (!safeExists(resolvedPath)) {
                        getExtensionLogger().warn(LogCategory.CONFIG, `Skipping logical group item with non-existent path: ${item.path}`);
                        continue;
                    }

                    const statResult = safeStats(resolvedPath);
                    if (!statResult.success || !statResult.data) {
                        getExtensionLogger().warn(LogCategory.CONFIG, `Skipping logical group item with invalid path: ${item.path}`, { error: statResult.error?.message });
                        continue;
                    }

                    const actualType = statResult.data.isDirectory() ? 'folder' : 'file';
                    if (actualType !== item.type) {
                        getExtensionLogger().warn(LogCategory.CONFIG, `Logical group item type mismatch for ${item.path}: expected ${item.type}, found ${actualType}. Using actual type.`);
                    }

                    validItems.push({
                        path: item.path,
                        name: item.name,
                        type: actualType as 'folder' | 'file'
                    });
                }

                // Recursively validate nested groups
                let validNestedGroups: LogicalGroup[] | undefined;
                if (group.groups && Array.isArray(group.groups)) {
                    validNestedGroups = this.validateNestedGroups(group.groups, validBasePaths);
                }

                validLogicalGroups.push({
                    name: group.name,
                    description: typeof group.description === 'string' ? group.description : undefined,
                    items: validItems,
                    icon: typeof group.icon === 'string' ? group.icon : undefined,
                    groups: validNestedGroups
                });
            }
        }

        // Validate global notes
        let validGlobalNotes: GlobalNote[] = [];
        if (config.globalNotes && Array.isArray(config.globalNotes)) {
            for (const note of config.globalNotes) {
                if (!note || typeof note !== 'object') {
                    getExtensionLogger().warn(LogCategory.CONFIG, 'Skipping invalid global note', { note });
                    continue;
                }

                if (typeof note.name !== 'string' || !note.name.trim()) {
                    getExtensionLogger().warn(LogCategory.CONFIG, 'Skipping global note with invalid name', { note });
                    continue;
                }

                if (typeof note.noteId !== 'string' || !note.noteId.trim()) {
                    getExtensionLogger().warn(LogCategory.CONFIG, 'Skipping global note with invalid noteId', { note });
                    continue;
                }

                validGlobalNotes.push({
                    name: note.name,
                    noteId: note.noteId,
                    icon: typeof note.icon === 'string' ? note.icon : undefined
                });
            }
        }

        const result: ShortcutsConfig = {
            logicalGroups: validLogicalGroups
        };
        if (validBasePaths.length > 0) {
            result.basePaths = validBasePaths;
        }
        if (validGlobalNotes.length > 0) {
            result.globalNotes = validGlobalNotes;
        }
        return result;
    }

    /**
     * Recursively validate nested groups
     * @param groups Array of nested groups to validate
     * @param validBasePaths Valid base paths for path resolution
     * @returns Array of validated nested groups
     */
    private validateNestedGroups(groups: any[], validBasePaths: BasePath[]): LogicalGroup[] {
        const validGroups: LogicalGroup[] = [];

        for (const group of groups) {
            if (!group || typeof group !== 'object') {
                getExtensionLogger().warn(LogCategory.CONFIG, 'Skipping invalid nested group', { group });
                continue;
            }

            if (typeof group.name !== 'string' || !group.name.trim()) {
                getExtensionLogger().warn(LogCategory.CONFIG, 'Skipping nested group with invalid name', { group });
                continue;
            }

            if (!Array.isArray(group.items)) {
                getExtensionLogger().warn(LogCategory.CONFIG, 'Skipping nested group with invalid items array', { group });
                continue;
            }

            const validItems: LogicalGroupItem[] = [];
            for (const item of group.items) {
                if (!item || typeof item !== 'object') {
                    getExtensionLogger().warn(LogCategory.CONFIG, 'Skipping invalid nested group item', { item });
                    continue;
                }

                // Items can be files/folders or commands/tasks
                if (item.type === 'command' || item.type === 'task') {
                    // Validate command or task items
                    if (item.type === 'command' && typeof item.command !== 'string') {
                        getExtensionLogger().warn(LogCategory.CONFIG, 'Skipping command item with invalid command', { item });
                        continue;
                    }
                    if (item.type === 'task' && typeof item.task !== 'string') {
                        getExtensionLogger().warn(LogCategory.CONFIG, 'Skipping task item with invalid task name', { item });
                        continue;
                    }
                    if (typeof item.name !== 'string' || !item.name.trim()) {
                        getExtensionLogger().warn(LogCategory.CONFIG, 'Skipping command/task item with invalid name', { item });
                        continue;
                    }

                    validItems.push({
                        name: item.name,
                        type: item.type,
                        command: item.command,
                        task: item.task,
                        args: item.args,
                        icon: typeof item.icon === 'string' ? item.icon : undefined
                    } as LogicalGroupItem);
                    continue;
                }

                // Handle note items
                if (item.type === 'note') {
                    if (typeof item.noteId !== 'string' || !item.noteId.trim()) {
                        getExtensionLogger().warn(LogCategory.CONFIG, 'Skipping note item with invalid note ID', { item });
                        continue;
                    }
                    if (typeof item.name !== 'string' || !item.name.trim()) {
                        getExtensionLogger().warn(LogCategory.CONFIG, 'Skipping note item with invalid name', { item });
                        continue;
                    }
                    validItems.push({
                        name: item.name,
                        type: 'note',
                        noteId: item.noteId,
                        icon: typeof item.icon === 'string' ? item.icon : undefined
                    });
                    continue;
                }

                // Handle commit items
                if (item.type === 'commit') {
                    if (!item.commitRef || typeof item.commitRef !== 'object') {
                        getExtensionLogger().warn(LogCategory.CONFIG, 'Skipping commit item with invalid commitRef', { item });
                        continue;
                    }
                    if (typeof item.commitRef.hash !== 'string' || !item.commitRef.hash.trim()) {
                        getExtensionLogger().warn(LogCategory.CONFIG, 'Skipping commit item with invalid hash', { item });
                        continue;
                    }
                    if (typeof item.commitRef.repositoryRoot !== 'string' || !item.commitRef.repositoryRoot.trim()) {
                        getExtensionLogger().warn(LogCategory.CONFIG, 'Skipping commit item with invalid repositoryRoot', { item });
                        continue;
                    }
                    if (typeof item.name !== 'string' || !item.name.trim()) {
                        getExtensionLogger().warn(LogCategory.CONFIG, 'Skipping commit item with invalid name', { item });
                        continue;
                    }
                    validItems.push({
                        name: item.name,
                        type: 'commit',
                        commitRef: {
                            hash: item.commitRef.hash,
                            repositoryRoot: item.commitRef.repositoryRoot
                        },
                        icon: typeof item.icon === 'string' ? item.icon : undefined
                    });
                    continue;
                }

                // Validate file/folder items
                if (typeof item.path !== 'string' || !item.path.trim()) {
                    getExtensionLogger().warn(LogCategory.CONFIG, 'Skipping nested group item with invalid path', { item });
                    continue;
                }

                if (typeof item.name !== 'string' || !item.name.trim()) {
                    getExtensionLogger().warn(LogCategory.CONFIG, 'Skipping nested group item with invalid name', { item });
                    continue;
                }

                if (item.type !== 'folder' && item.type !== 'file') {
                    getExtensionLogger().warn(LogCategory.CONFIG, 'Skipping nested group item with invalid type', { item });
                    continue;
                }

                // Validate that the path exists
                const resolvedPath = this.resolvePath(item.path, validBasePaths);
                if (!safeExists(resolvedPath)) {
                    getExtensionLogger().warn(LogCategory.CONFIG, `Skipping nested group item with non-existent path: ${item.path}`);
                    continue;
                }

                const statResult = safeStats(resolvedPath);
                if (!statResult.success || !statResult.data) {
                    getExtensionLogger().warn(LogCategory.CONFIG, `Skipping nested group item with invalid path: ${item.path}`, { error: statResult.error?.message });
                    continue;
                }

                const actualType = statResult.data.isDirectory() ? 'folder' : 'file';
                if (actualType !== item.type) {
                    getExtensionLogger().warn(LogCategory.CONFIG, `Nested group item type mismatch for ${item.path}: expected ${item.type}, found ${actualType}. Using actual type.`);
                }

                validItems.push({
                    path: item.path,
                    name: item.name,
                    type: actualType as 'folder' | 'file'
                });
            }

            // Recursively validate deeper nested groups
            let validNestedGroups: LogicalGroup[] | undefined;
            if (group.groups && Array.isArray(group.groups)) {
                validNestedGroups = this.validateNestedGroups(group.groups, validBasePaths);
            }

            validGroups.push({
                name: group.name,
                description: typeof group.description === 'string' ? group.description : undefined,
                items: validItems,
                icon: typeof group.icon === 'string' ? group.icon : undefined,
                groups: validNestedGroups
            });
        }

        return validGroups;
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
            getExtensionLogger().warn(LogCategory.CONFIG, `Base path alias "${aliasName}" not found in configuration`);
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
            const directory = safeIsDirectory(filePath) ? filePath : path.dirname(filePath);
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
                NotificationManager.showWarning('A logical group with this name already exists.');
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
            getExtensionLogger().error(LogCategory.CONFIG, 'Error creating logical group', err);
            NotificationManager.showError(`Failed to create logical group: ${err.message}`);
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
                    NotificationManager.showError(`Parent group "${parentGroupPath}" not found.`);
                    return;
                }
                currentGroups = targetGroup.groups || [];
            }

            // Final check to ensure targetGroup is defined (TypeScript safety)
            if (!targetGroup) {
                NotificationManager.showError(`Parent group "${parentGroupPath}" not found.`);
                return;
            }

            // Check if nested group already exists in parent
            if (targetGroup.groups && targetGroup.groups.some(g => g.name === groupName)) {
                NotificationManager.showWarning(`A nested group with the name "${groupName}" already exists in this group.`);
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
            getExtensionLogger().error(LogCategory.CONFIG, 'Error creating nested logical group', err);
            NotificationManager.showError(`Failed to create nested group: ${err.message}`);
            throw error;
        }
    }

    /**
     * Find a group by path (supports nested groups)
     * @param groups Array of groups to search
     * @param groupPath Path to the group (e.g., "parent/child")
     * @returns The found group or undefined
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
     * Add an item to a logical group with automatic alias detection
     * @param groupPath Path to the group (supports nested groups like "parent/child")
     * @param itemPath Path to the item
     * @param itemName Display name for the item
     * @param itemType Type of the item (folder or file)
     */
    async addToLogicalGroup(groupPath: string, itemPath: string, itemName: string, itemType: 'folder' | 'file'): Promise<void> {
        try {
            const config = await this.loadConfiguration();

            // Find the group (supports nested groups)
            if (!config.logicalGroups) {
                config.logicalGroups = [];
            }

            const group = this.findGroupByPath(config.logicalGroups, groupPath);
            if (!group) {
                NotificationManager.showError(`Logical group not found: ${groupPath}`);
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
                NotificationManager.showWarning('This item is already in the logical group.');
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
                getExtensionLogger().debug(LogCategory.CONFIG, `Using existing alias for path: ${pathToStore}`);
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
                        getExtensionLogger().debug(LogCategory.CONFIG, `Using git root alias for path: ${pathToStore}`);
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
            getExtensionLogger().error(LogCategory.CONFIG, 'Error adding to logical group', err);
            NotificationManager.showError(`Failed to add to logical group: ${err.message}`);
            throw error;
        }
    }

    /**
     * Remove an item from a logical group
     * @param groupPath Path to the group (supports nested groups like "parent/child")
     * @param itemPath Path to the item to remove
     */
    async removeFromLogicalGroup(groupPath: string, itemPath: string): Promise<void> {
        try {
            const config = await this.loadConfiguration();

            if (!config.logicalGroups) {
                return;
            }

            const group = this.findGroupByPath(config.logicalGroups, groupPath);
            if (!group) {
                NotificationManager.showError(`Logical group not found: ${groupPath}`);
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
                NotificationManager.showWarning('Item not found in logical group.');
                return;
            }

            await this.saveConfiguration(config);

        } catch (error) {
            const err = error instanceof Error ? error : new Error('Unknown error');
            getExtensionLogger().error(LogCategory.CONFIG, 'Error removing from logical group', err);
            NotificationManager.showError(`Failed to remove from logical group: ${err.message}`);
            throw error;
        }
    }

    /**
     * Remove a commit from a logical group
     * @param groupPath Path to the group (supports nested groups like "parent/child")
     * @param commitHash Hash of the commit to remove
     */
    async removeCommitFromLogicalGroup(groupPath: string, commitHash: string): Promise<void> {
        try {
            const config = await this.loadConfiguration();

            if (!config.logicalGroups) {
                return;
            }

            const group = this.findGroupByPath(config.logicalGroups, groupPath);
            if (!group) {
                NotificationManager.showError(`Logical group not found: ${groupPath}`);
                return;
            }

            // Find and remove the commit item
            const initialLength = group.items.length;
            group.items = group.items.filter(item => {
                if (item.type !== 'commit' || !item.commitRef) {
                    return true; // Keep non-commit items
                }
                return item.commitRef.hash !== commitHash;
            });

            if (group.items.length === initialLength) {
                NotificationManager.showWarning('Commit not found in logical group.');
                return;
            }

            await this.saveConfiguration(config);

        } catch (error) {
            const err = error instanceof Error ? error : new Error('Unknown error');
            getExtensionLogger().error(LogCategory.CONFIG, 'Error removing commit from logical group', err);
            NotificationManager.showError(`Failed to remove commit from logical group: ${err.message}`);
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
                NotificationManager.showWarning('A logical group with this name already exists.');
                return;
            }

            const group = config.logicalGroups.find(g => g.name === oldName);
            if (!group) {
                NotificationManager.showError('Logical group not found.');
                return;
            }

            group.name = newName;
            await this.saveConfiguration(config);

        } catch (error) {
            const err = error instanceof Error ? error : new Error('Unknown error');
            getExtensionLogger().error(LogCategory.CONFIG, 'Error renaming logical group', err);
            NotificationManager.showError(`Failed to rename logical group: ${err.message}`);
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
                NotificationManager.showWarning('Logical group not found.');
                return;
            }

            await this.saveConfiguration(config);

        } catch (error) {
            const err = error instanceof Error ? error : new Error('Unknown error');
            getExtensionLogger().error(LogCategory.CONFIG, 'Error deleting logical group', err);
            NotificationManager.showError(`Failed to delete logical group: ${err.message}`);
            throw error;
        }
    }

    /**
     * Create a new note in a logical group
     * @param groupPath Path to the group (supports nested groups)
     * @param noteName Name of the note
     */
    async createNote(groupPath: string, noteName: string): Promise<string> {
        if (!this.extensionContext) {
            throw new Error('Extension context not available for note storage');
        }

        try {
            const config = await this.loadConfiguration();

            // Find the group
            if (!config.logicalGroups) {
                config.logicalGroups = [];
            }

            const group = this.findGroupByPath(config.logicalGroups, groupPath);
            if (!group) {
                throw new Error(`Logical group not found: ${groupPath}`);
            }

            // Generate unique note ID
            const noteId = `note_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

            // Add note to group configuration
            const newItem: LogicalGroupItem = {
                name: noteName,
                type: 'note',
                noteId: noteId
            };

            group.items.push(newItem);
            await this.saveConfiguration(config);

            // Initialize note content in storage
            await this.saveNoteContent(noteId, '');

            return noteId;
        } catch (error) {
            const err = error instanceof Error ? error : new Error('Unknown error');
            getExtensionLogger().error(LogCategory.CONFIG, 'Error creating note', err);
            NotificationManager.showError(`Failed to create note: ${err.message}`);
            throw error;
        }
    }

    /**
     * Check if a note exists in the configuration
     * @param noteId ID of the note
     */
    async noteExists(noteId: string): Promise<boolean> {
        try {
            const config = await this.loadConfiguration();

            // Check global notes first
            if (config.globalNotes && config.globalNotes.some(note => note.noteId === noteId)) {
                return true;
            }

            // Helper function to check if note exists in a group
            const checkGroup = (group: any): boolean => {
                // Check items in this group
                if (group.items) {
                    for (const item of group.items) {
                        if (item.type === 'note' && item.noteId === noteId) {
                            return true;
                        }
                    }
                }

                // Check nested groups
                if (group.groups) {
                    for (const nestedGroup of group.groups) {
                        if (checkGroup(nestedGroup)) {
                            return true;
                        }
                    }
                }

                return false;
            };

            // Check all logical groups
            for (const group of config.logicalGroups) {
                if (checkGroup(group)) {
                    return true;
                }
            }

            return false;
        } catch (error) {
            const err = error instanceof Error ? error : new Error(String(error));
            getExtensionLogger().error(LogCategory.CONFIG, 'Error checking note existence', err);
            return false;
        }
    }

    /**
     * Get note content from VSCode storage
     * @param noteId ID of the note
     */
    async getNoteContent(noteId: string): Promise<string> {
        if (!this.extensionContext) {
            throw new Error('Extension context not available for note storage');
        }

        try {
            const content = this.extensionContext.globalState.get<string>(`note_${noteId}`, '');
            return content;
        } catch (error) {
            const err = error instanceof Error ? error : new Error('Unknown error');
            getExtensionLogger().error(LogCategory.CONFIG, 'Error getting note content', err);
            return '';
        }
    }

    /**
     * Save note content to VSCode storage
     * @param noteId ID of the note
     * @param content Note content
     */
    async saveNoteContent(noteId: string, content: string): Promise<void> {
        if (!this.extensionContext) {
            throw new Error('Extension context not available for note storage');
        }

        try {
            await this.extensionContext.globalState.update(`note_${noteId}`, content);
        } catch (error) {
            const err = error instanceof Error ? error : new Error('Unknown error');
            getExtensionLogger().error(LogCategory.CONFIG, 'Error saving note content', err);
            NotificationManager.showError(`Failed to save note: ${err.message}`);
            throw error;
        }
    }

    /**
     * Delete a note from a logical group and storage
     * @param groupPath Path to the group (supports nested groups)
     * @param noteId ID of the note to delete
     */
    async deleteNote(groupPath: string, noteId: string): Promise<void> {
        if (!this.extensionContext) {
            throw new Error('Extension context not available for note storage');
        }

        try {
            const config = await this.loadConfiguration();

            if (!config.logicalGroups) {
                return;
            }

            const group = this.findGroupByPath(config.logicalGroups, groupPath);
            if (!group) {
                NotificationManager.showError(`Logical group not found: ${groupPath}`);
                return;
            }

            // Remove note from group
            const initialLength = group.items.length;
            group.items = group.items.filter(item => item.noteId !== noteId);

            if (group.items.length === initialLength) {
                NotificationManager.showWarning('Note not found in logical group.');
                return;
            }

            await this.saveConfiguration(config);

            // Delete note content from storage
            await this.extensionContext.globalState.update(`note_${noteId}`, undefined);

        } catch (error) {
            const err = error instanceof Error ? error : new Error('Unknown error');
            getExtensionLogger().error(LogCategory.CONFIG, 'Error deleting note', err);
            NotificationManager.showError(`Failed to delete note: ${err.message}`);
            throw error;
        }
    }

    /**
     * Move a note between logical groups
     * @param sourceGroupPath Source group path
     * @param targetGroupPath Target group path
     * @param noteId ID of the note to move
     */
    async moveNote(sourceGroupPath: string, targetGroupPath: string, noteId: string): Promise<void> {
        getExtensionLogger().debug(LogCategory.CONFIG, '[CONFIG-MANAGER] moveNote called', {
            sourceGroupPath,
            targetGroupPath,
            noteId
        });

        try {
            const config = await this.loadConfiguration();
            getExtensionLogger().debug(LogCategory.CONFIG, `[CONFIG-MANAGER] Config loaded, has ${config.logicalGroups.length} logical groups`);

            if (!config.logicalGroups) {
                throw new Error('No logical groups found in configuration');
            }

            // Find source and target groups
            getExtensionLogger().debug(LogCategory.CONFIG, `[CONFIG-MANAGER] Finding source group: "${sourceGroupPath}"`);
            const sourceGroup = this.findGroupByPath(config.logicalGroups, sourceGroupPath);
            getExtensionLogger().debug(LogCategory.CONFIG, `[CONFIG-MANAGER] Source group found: ${sourceGroup ? 'YES' : 'NO'}`);
            if (sourceGroup) {
                getExtensionLogger().debug(LogCategory.CONFIG, `[CONFIG-MANAGER] Source group has ${sourceGroup.items.length} items`);
            }

            getExtensionLogger().debug(LogCategory.CONFIG, `[CONFIG-MANAGER] Finding target group: "${targetGroupPath}"`);
            const targetGroup = this.findGroupByPath(config.logicalGroups, targetGroupPath);
            getExtensionLogger().debug(LogCategory.CONFIG, `[CONFIG-MANAGER] Target group found: ${targetGroup ? 'YES' : 'NO'}`);
            if (targetGroup) {
                getExtensionLogger().debug(LogCategory.CONFIG, `[CONFIG-MANAGER] Target group has ${targetGroup.items.length} items`);
            }

            if (!sourceGroup) {
                const error = `Source group not found: ${sourceGroupPath}`;
                getExtensionLogger().error(LogCategory.CONFIG, `[CONFIG-MANAGER] ERROR: ${error}`);
                NotificationManager.showError(error);
                throw new Error(error);
            }

            if (!targetGroup) {
                const error = `Target group not found: ${targetGroupPath}`;
                getExtensionLogger().error(LogCategory.CONFIG, `[CONFIG-MANAGER] ERROR: ${error}`);
                NotificationManager.showError(error);
                throw new Error(error);
            }

            // Find and remove note from source group
            getExtensionLogger().debug(LogCategory.CONFIG, `[CONFIG-MANAGER] Looking for note with ID: ${noteId} in source group`);
            const noteItem = sourceGroup.items.find(item => item.noteId === noteId);
            getExtensionLogger().debug(LogCategory.CONFIG, `[CONFIG-MANAGER] Note item found: ${noteItem ? 'YES' : 'NO'}`);
            if (noteItem) {
                getExtensionLogger().debug(LogCategory.CONFIG, '[CONFIG-MANAGER] Note item', { noteItem });
            }

            if (!noteItem) {
                const availableNotes = sourceGroup.items.filter(i => i.type === 'note').map(i => ({
                    name: i.name,
                    noteId: i.noteId
                }));
                const errorMsg = `Note not found in source group "${sourceGroupPath}"`;
                getExtensionLogger().error(LogCategory.CONFIG, `[CONFIG-MANAGER] ERROR: ${errorMsg}`, new Error(errorMsg));
                getExtensionLogger().debug(LogCategory.CONFIG, '[CONFIG-MANAGER] Available notes in source', { availableNotes });
                NotificationManager.showError(errorMsg);
                throw new Error(errorMsg);
            }

            getExtensionLogger().debug(LogCategory.CONFIG, '[CONFIG-MANAGER] Removing note from source group');
            // Remove from source and add to target
            sourceGroup.items = sourceGroup.items.filter(item => item.noteId !== noteId);
            getExtensionLogger().debug(LogCategory.CONFIG, `[CONFIG-MANAGER] Source group now has ${sourceGroup.items.length} items`);

            getExtensionLogger().debug(LogCategory.CONFIG, '[CONFIG-MANAGER] Adding note to target group');
            targetGroup.items.push(noteItem);
            getExtensionLogger().debug(LogCategory.CONFIG, `[CONFIG-MANAGER] Target group now has ${targetGroup.items.length} items`);

            getExtensionLogger().debug(LogCategory.CONFIG, '[CONFIG-MANAGER] Saving configuration...');
            await this.saveConfiguration(config);
            getExtensionLogger().debug(LogCategory.CONFIG, '[CONFIG-MANAGER] Configuration saved successfully');

        } catch (error) {
            const err = error instanceof Error ? error : new Error('Unknown error');
            getExtensionLogger().error(LogCategory.CONFIG, 'Error moving note', err);
            if (!err.message.includes('not found')) {
                NotificationManager.showError(`Failed to move note: ${err.message}`);
            }
            throw error;
        }
    }

    /**
     * Create a new global note (not tied to any group)
     * @param noteName Name of the note
     * @returns The note ID
     */
    async createGlobalNote(noteName: string): Promise<string> {
        if (!this.extensionContext) {
            throw new Error('Extension context not available for note storage');
        }

        try {
            const config = await this.loadConfiguration();

            // Initialize globalNotes array if it doesn't exist
            if (!config.globalNotes) {
                config.globalNotes = [];
            }

            // Check if note with same name already exists
            if (config.globalNotes.some(n => n.name === noteName)) {
                throw new Error('A global note with this name already exists');
            }

            // Generate unique note ID
            const noteId = `note_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

            // Add note to configuration
            const newNote: GlobalNote = {
                name: noteName,
                noteId: noteId
            };

            config.globalNotes.push(newNote);
            await this.saveConfiguration(config);

            // Initialize note content in storage
            await this.saveNoteContent(noteId, '');

            return noteId;
        } catch (error) {
            const err = error instanceof Error ? error : new Error('Unknown error');
            getExtensionLogger().error(LogCategory.CONFIG, 'Error creating global note', err);
            throw error;
        }
    }

    /**
     * Delete a global note
     * @param noteId ID of the note to delete
     */
    async deleteGlobalNote(noteId: string): Promise<void> {
        if (!this.extensionContext) {
            throw new Error('Extension context not available for note storage');
        }

        try {
            const config = await this.loadConfiguration();

            if (!config.globalNotes) {
                return;
            }

            // Remove note from configuration
            const initialLength = config.globalNotes.length;
            config.globalNotes = config.globalNotes.filter(note => note.noteId !== noteId);

            if (config.globalNotes.length === initialLength) {
                NotificationManager.showWarning('Global note not found.');
                return;
            }

            await this.saveConfiguration(config);

            // Delete note content from storage
            await this.extensionContext.globalState.update(`note_${noteId}`, undefined);

        } catch (error) {
            const err = error instanceof Error ? error : new Error('Unknown error');
            getExtensionLogger().error(LogCategory.CONFIG, 'Error deleting global note', err);
            NotificationManager.showError(`Failed to delete note: ${err.message}`);
            throw error;
        }
    }

    /**
     * Rename a global note
     * @param noteId ID of the note to rename
     * @param newName New name for the note
     */
    async renameGlobalNote(noteId: string, newName: string): Promise<void> {
        try {
            const config = await this.loadConfiguration();

            if (!config.globalNotes) {
                throw new Error('No global notes found');
            }

            // Find the note
            const note = config.globalNotes.find(n => n.noteId === noteId);
            if (!note) {
                throw new Error('Global note not found');
            }

            // Check if new name already exists
            if (config.globalNotes.some(n => n.name === newName && n.noteId !== noteId)) {
                throw new Error('A global note with this name already exists');
            }

            // Update the name
            note.name = newName;
            await this.saveConfiguration(config);

        } catch (error) {
            const err = error instanceof Error ? error : new Error('Unknown error');
            getExtensionLogger().error(LogCategory.CONFIG, 'Error renaming global note', err);
            NotificationManager.showError(`Failed to rename note: ${err.message}`);
            throw error;
        }
    }

    /**
     * Get all global notes
     */
    async getGlobalNotes(): Promise<GlobalNote[]> {
        try {
            const config = await this.loadConfiguration();
            return config.globalNotes || [];
        } catch (error) {
            const err = error instanceof Error ? error : new Error(String(error));
            getExtensionLogger().error(LogCategory.CONFIG, 'Error getting global notes', err);
            return [];
        }
    }

    /**
     * Check for cloud updates and sync if newer
     * @returns The cloud configuration if newer, undefined otherwise
     */
    private async checkAndSyncFromCloud(): Promise<ShortcutsConfig | undefined> {
        if (!this.syncManager?.isEnabled()) {
            return undefined;
        }

        try {
            const result = await this.syncManager.checkForUpdates();

            if (!result.hasUpdates) {
                return undefined;
            }

            // Get local file timestamp
            const statsResult = safeStats(this.configPath);
            const localTimestamp = statsResult.success && statsResult.data
                ? statsResult.data.mtimeMs
                : 0;

            // If cloud is newer, download and use it
            if (result.timestamp && result.timestamp > localTimestamp) {
                getExtensionLogger().info(LogCategory.SYNC, `Cloud configuration is newer (${result.source}), syncing...`);
                const syncResult = await this.syncManager.syncFromCloud();

                if (syncResult.config) {
                    // Save the cloud config locally
                    await this.saveConfigurationWithoutSync(syncResult.config);
                    NotificationManager.showInfo(
                        `Configuration updated from ${syncResult.source}`,
                        { timeout: 3000 }
                    );
                    return syncResult.config;
                }
            }

            return undefined;
        } catch (error) {
            const err = error instanceof Error ? error : new Error(String(error));
            getExtensionLogger().error(LogCategory.SYNC, 'Error checking for cloud updates', err);
            return undefined;
        }
    }

    /**
     * Save configuration to disk without triggering sync
     * Used when saving cloud-synced config to avoid circular sync
     */
    private async saveConfigurationWithoutSync(config: ShortcutsConfig): Promise<void> {
        try {
            // Invalidate cache before saving
            this.configCache = undefined;

            // Add version number to config before saving
            const versionedConfig = {
                version: CURRENT_CONFIG_VERSION,
                ...config
            };

            // Write YAML to file (ensureDirectoryExists is handled by writeYAML)
            const result = writeYAML(this.configPath, versionedConfig);
            if (!result.success) {
                throw result.error || new Error('Failed to write configuration file');
            }

        } catch (error) {
            const err = error instanceof Error ? error : new Error(String(error));
            getExtensionLogger().error(LogCategory.SYNC, 'Error saving configuration from cloud', err);
        }
    }

    /**
     * Manually trigger sync to cloud
     */
    async syncToCloud(): Promise<void> {
        if (!this.syncManager?.isEnabled()) {
            NotificationManager.showWarning('Cloud sync is not enabled');
            return;
        }

        try {
            const config = await this.loadConfiguration();
            const results = await this.syncManager.syncToCloud(config);

            const successCount = Array.from(results.values()).filter(r => r.success).length;
            const totalCount = results.size;

            if (successCount === totalCount) {
                NotificationManager.showInfo(`Successfully synced to ${totalCount} provider(s)`);
            } else {
                NotificationManager.showWarning(
                    `Synced to ${successCount}/${totalCount} provider(s). Check console for details.`
                );
            }
        } catch (error) {
            const err = error instanceof Error ? error : new Error('Unknown error');
            getExtensionLogger().error(LogCategory.SYNC, 'Error syncing to cloud', err);
            NotificationManager.showError(`Failed to sync: ${err.message}`);
        }
    }

    /**
     * Manually trigger sync from cloud
     */
    async syncFromCloud(): Promise<void> {
        if (!this.syncManager?.isEnabled()) {
            NotificationManager.showWarning('Cloud sync is not enabled');
            return;
        }

        try {
            const result = await this.syncManager.syncFromCloud();

            if (result.config) {
                await this.saveConfigurationWithoutSync(result.config);
                NotificationManager.showInfo(`Configuration synced from ${result.source}`);

                // Trigger reload callback
                if (this.reloadCallback) {
                    this.reloadCallback();
                }
            } else {
                NotificationManager.showInfo('No cloud configuration found');
            }
        } catch (error) {
            const err = error instanceof Error ? error : new Error('Unknown error');
            getExtensionLogger().error(LogCategory.SYNC, 'Error syncing from cloud', err);
            NotificationManager.showError(`Failed to sync: ${err.message}`);
        }
    }

    /**
     * Get sync status
     */
    async getSyncStatus(): Promise<string> {
        if (!this.syncManager?.isEnabled()) {
            return 'Cloud sync is not enabled';
        }

        const statusMap = await this.syncManager.getSyncStatus();
        const lines: string[] = ['Cloud Sync Status:', ''];

        for (const [key, info] of statusMap.entries()) {
            lines.push(`${info.name}: ${info.status}`);
        }

        const updateCheck = await this.syncManager.checkForUpdates();
        if (updateCheck.hasUpdates) {
            lines.push('');
            lines.push(`Updates available from ${updateCheck.source}`);
        }

        return lines.join('\n');
    }

    /**
     * Get the sync manager instance
     */
    getSyncManager(): SyncManager | undefined {
        return this.syncManager;
    }

    /**
     * Reinitialize sync manager when settings change
     */
    async reinitializeSyncManager(): Promise<void> {
        // Dispose existing sync manager
        if (this.syncManager) {
            this.syncManager.dispose();
            this.syncManager = undefined;
        }

        // Reinitialize with new settings
        await this.initializeSyncManager();
    }
}