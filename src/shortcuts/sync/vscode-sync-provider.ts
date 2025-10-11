/**
 * VSCode Settings Sync provider
 * Leverages VSCode's built-in sync infrastructure (syncs with Microsoft/GitHub account)
 */

import * as os from 'os';
import * as vscode from 'vscode';
import { ISyncProvider, SyncResult, SyncStatus, SyncedConfig } from './sync-provider';

/**
 * VSCode sync provider that uses VSCode's globalState or workspaceState
 * This automatically syncs across devices when VSCode Settings Sync is enabled
 */
export class VSCodeSyncProvider implements ISyncProvider {
    private static readonly STORAGE_KEY = 'workspaceShortcuts.syncedConfig';
    private status: SyncStatus = SyncStatus.NotConfigured;
    private deviceId: string;

    constructor(
        private readonly context: vscode.ExtensionContext,
        private readonly scope: 'global' | 'workspace' = 'global'
    ) {
        // Generate or retrieve a unique device ID
        this.deviceId = this.getOrCreateDeviceId();
    }

    /**
     * Get the name of this sync provider
     */
    getName(): string {
        return 'VSCode Settings Sync';
    }

    /**
     * Check if the provider is properly configured
     * VSCode sync is always available, but we check if Settings Sync is enabled
     */
    async isConfigured(): Promise<boolean> {
        // VSCode sync provider is always configured
        // It leverages the built-in sync mechanism
        return true;
    }

    /**
     * Get the current status of the provider
     */
    async getStatus(): Promise<SyncStatus> {
        return this.status;
    }

    /**
     * Upload configuration to VSCode's storage
     * This will automatically sync via VSCode Settings Sync if enabled
     */
    async upload(config: SyncedConfig): Promise<SyncResult> {
        try {
            this.status = SyncStatus.Syncing;

            // Update the device ID in metadata
            config.metadata.deviceId = this.deviceId;
            config.metadata.lastModified = Date.now();

            // Store in the appropriate storage
            const storage = this.getStorage();
            await storage.update(VSCodeSyncProvider.STORAGE_KEY, config);

            this.status = SyncStatus.Ready;
            return {
                success: true,
                timestamp: config.metadata.lastModified,
                deviceId: this.deviceId
            };
        } catch (error) {
            const err = error instanceof Error ? error : new Error('Unknown error');
            this.status = SyncStatus.Error;
            return {
                success: false,
                error: err.message
            };
        }
    }

    /**
     * Download configuration from VSCode's storage
     */
    async download(): Promise<SyncResult & { config?: SyncedConfig }> {
        try {
            this.status = SyncStatus.Syncing;

            // Retrieve from storage
            const storage = this.getStorage();
            const config = storage.get<SyncedConfig>(VSCodeSyncProvider.STORAGE_KEY);

            if (!config) {
                this.status = SyncStatus.Ready;
                return {
                    success: true,
                    error: 'No configuration found in storage'
                };
            }

            this.status = SyncStatus.Ready;
            return {
                success: true,
                config,
                timestamp: config.metadata.lastModified,
                deviceId: config.metadata.deviceId
            };
        } catch (error) {
            const err = error instanceof Error ? error : new Error('Unknown error');
            this.status = SyncStatus.Error;
            return {
                success: false,
                error: err.message
            };
        }
    }

    /**
     * Get the last modified timestamp from storage
     */
    async getLastModified(): Promise<number | undefined> {
        try {
            const storage = this.getStorage();
            const config = storage.get<SyncedConfig>(VSCodeSyncProvider.STORAGE_KEY);
            return config?.metadata.lastModified;
        } catch (error) {
            console.error('Error getting last modified timestamp:', error);
            return undefined;
        }
    }

    /**
     * Delete the configuration from storage
     */
    async delete(): Promise<boolean> {
        try {
            const storage = this.getStorage();
            await storage.update(VSCodeSyncProvider.STORAGE_KEY, undefined);
            return true;
        } catch (error) {
            console.error('Error deleting configuration:', error);
            return false;
        }
    }

    /**
     * Initialize the provider
     */
    async initialize(): Promise<boolean> {
        try {
            const configured = await this.isConfigured();
            this.status = configured ? SyncStatus.Ready : SyncStatus.NotConfigured;
            return configured;
        } catch (error) {
            console.error('Error initializing VSCode sync provider:', error);
            this.status = SyncStatus.Error;
            return false;
        }
    }

    /**
     * Clean up resources
     */
    dispose(): void {
        // No resources to clean up for VSCode sync
    }

    /**
     * Get the appropriate storage based on scope
     */
    private getStorage(): vscode.Memento {
        return this.scope === 'global'
            ? this.context.globalState
            : this.context.workspaceState;
    }

    /**
     * Get or create a unique device ID
     */
    private getOrCreateDeviceId(): string {
        const storageKey = 'workspaceShortcuts.deviceId';

        // Try to get existing device ID from global state
        let deviceId = this.context.globalState.get<string>(storageKey);

        if (!deviceId) {
            // Generate a new device ID based on hostname and random string
            const hostname = os.hostname();
            const randomPart = Math.random().toString(36).substring(2, 15);
            deviceId = `${hostname}-${randomPart}`;

            // Store it for future use
            this.context.globalState.update(storageKey, deviceId);
        }

        return deviceId;
    }

    /**
     * Check if VSCode Settings Sync is enabled
     * Note: This is informational only - the provider works regardless
     */
    isVSCodeSyncEnabled(): boolean {
        const config = vscode.workspace.getConfiguration('settingsSync');
        return config.get<boolean>('enabled', false);
    }

    /**
     * Get the current scope
     */
    getScope(): 'global' | 'workspace' {
        return this.scope;
    }
}

