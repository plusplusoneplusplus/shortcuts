import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { ConfigurationManager } from './configuration-manager';
import { getExtensionLogger, LogCategory } from './shared';
import { BasePath } from './types';

/**
 * Manages file system watchers for all folders referenced in shortcuts configuration.
 * Automatically refreshes the tree view when underlying folders change.
 */
export class FileSystemWatcherManager implements vscode.Disposable {
    private watchers: vscode.FileSystemWatcher[] = [];
    private configurationManager: ConfigurationManager;
    private workspaceRoot: string;
    private refreshCallback: () => void;

    constructor(
        workspaceRoot: string,
        configurationManager: ConfigurationManager,
        refreshCallback: () => void
    ) {
        this.workspaceRoot = workspaceRoot;
        this.configurationManager = configurationManager;
        this.refreshCallback = refreshCallback;
    }

    /**
     * Initialize watchers for all folders in the shortcuts configuration
     */
    async initialize(): Promise<void> {
        await this.updateWatchers();
    }

    /**
     * Update watchers to match current configuration
     * Disposes old watchers and creates new ones
     */
    async updateWatchers(): Promise<void> {
        // Dispose all existing watchers
        this.disposeAllWatchers();

        try {
            const config = await this.configurationManager.loadConfiguration();
            const watchedPaths = new Set<string>();

            // Extract all folder paths from logical groups
            if (config.logicalGroups) {
                for (const group of config.logicalGroups) {
                    for (const item of group.items) {
                        if (item.type === 'folder' && item.path) {
                            const resolvedPath = this.resolvePath(item.path, config.basePaths);
                            if (fs.existsSync(resolvedPath) && fs.statSync(resolvedPath).isDirectory()) {
                                watchedPaths.add(resolvedPath);
                            }
                        }
                    }
                }
            }

            // Create watchers for each unique path
            for (const folderPath of watchedPaths) {
                this.createWatcherForPath(folderPath);
            }

            console.log(`Created ${this.watchers.length} file system watchers for shortcuts`);
        } catch (error) {
            getExtensionLogger().error(LogCategory.FILESYSTEM, 'Error updating file system watchers', error instanceof Error ? error : undefined);
        }
    }

    /**
     * Create a watcher for a specific path
     */
    private createWatcherForPath(folderPath: string): void {
        try {
            // Create a glob pattern for this folder and its contents
            const pattern = new vscode.RelativePattern(folderPath, '**/*');
            const watcher = vscode.workspace.createFileSystemWatcher(pattern);

            // Refresh on any file system changes within watched folders
            watcher.onDidChange(() => {
                this.debounceRefresh();
            });

            watcher.onDidCreate(() => {
                this.debounceRefresh();
            });

            watcher.onDidDelete(() => {
                this.debounceRefresh();
            });

            this.watchers.push(watcher);
        } catch (error) {
            console.warn(`Failed to create watcher for ${folderPath}:`, error);
        }
    }

    private debounceTimer?: NodeJS.Timeout;

    /**
     * Debounced refresh to avoid excessive updates
     */
    private debounceRefresh(): void {
        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
        }

        this.debounceTimer = setTimeout(() => {
            this.refreshCallback();
        }, 300); // 300ms debounce
    }

    /**
     * Resolve a path relative to the workspace root, with support for base path aliases
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
     * Resolve base path aliases in a path string
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
     * Dispose all watchers
     */
    private disposeAllWatchers(): void {
        for (const watcher of this.watchers) {
            watcher.dispose();
        }
        this.watchers = [];

        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
            this.debounceTimer = undefined;
        }
    }

    /**
     * Dispose of all resources
     */
    dispose(): void {
        this.disposeAllWatchers();
    }
}
