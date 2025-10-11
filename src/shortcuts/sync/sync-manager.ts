/**
 * Sync manager - orchestrates sync operations across providers
 */

import * as os from 'os';
import * as vscode from 'vscode';
import { CURRENT_CONFIG_VERSION } from '../config-migrations';
import { NotificationManager } from '../notification-manager';
import { ShortcutsConfig, SyncConfig } from '../types';
import { AzureBlobProvider } from './providers/azure-blob-provider';
import { ISyncProvider, SyncedConfig, SyncResult, SyncStatus } from './sync-provider';
import { VSCodeSyncProvider } from './vscode-sync-provider';

/**
 * Sync manager orchestrates sync operations across multiple providers
 */
export class SyncManager {
    private providers: Map<string, ISyncProvider> = new Map();
    private syncInProgress = false;
    private debounceTimer?: NodeJS.Timeout;
    private readonly DEBOUNCE_MS = 2000;
    private deviceId: string;
    private periodicSyncTimer?: NodeJS.Timeout;

    constructor(
        private readonly context: vscode.ExtensionContext,
        private syncConfig?: SyncConfig
    ) {
        this.deviceId = this.getOrCreateDeviceId();
    }

    /**
     * Initialize sync manager and providers
     */
    async initialize(): Promise<void> {
        if (!this.syncConfig || !this.syncConfig.enabled) {
            return;
        }

        // Initialize VSCode sync provider
        if (this.syncConfig.providers.vscodeSync?.enabled) {
            const provider = new VSCodeSyncProvider(
                this.context,
                this.syncConfig.providers.vscodeSync.scope
            );
            await provider.initialize();
            this.providers.set('vscode', provider);
        }

        // Initialize Azure provider
        if (this.syncConfig.providers.azure?.enabled) {
            const provider = new AzureBlobProvider(
                this.syncConfig.providers.azure,
                this.context.secrets
            );
            await provider.initialize();
            this.providers.set('azure', provider);
        }

        // Set up periodic sync if configured
        if (this.syncConfig.syncInterval && this.syncConfig.syncInterval > 0) {
            this.startPeriodicSync(this.syncConfig.syncInterval * 1000);
        }
    }

    /**
     * Update sync configuration
     */
    async updateConfig(syncConfig: SyncConfig): Promise<void> {
        this.syncConfig = syncConfig;

        // Dispose existing providers
        this.dispose();

        // Reinitialize with new config
        await this.initialize();
    }

    /**
     * Check if sync is enabled
     */
    isEnabled(): boolean {
        return this.syncConfig?.enabled === true;
    }

    /**
     * Check if auto-sync is enabled
     */
    isAutoSyncEnabled(): boolean {
        return this.syncConfig?.autoSync === true;
    }

    /**
     * Sync configuration to cloud (upload)
     * Triggers sync on all enabled providers
     */
    async syncToCloud(config: ShortcutsConfig): Promise<Map<string, SyncResult>> {
        if (!this.isEnabled()) {
            return new Map();
        }

        if (this.syncInProgress) {
            console.log('Sync already in progress, skipping');
            return new Map();
        }

        this.syncInProgress = true;
        const results = new Map<string, SyncResult>();

        try {
            // Create synced config with metadata
            const syncedConfig: SyncedConfig = {
                config,
                metadata: {
                    lastModified: Date.now(),
                    deviceId: this.deviceId,
                    version: CURRENT_CONFIG_VERSION
                }
            };

            // Upload to all enabled providers
            const uploadPromises = Array.from(this.providers.entries()).map(
                async ([name, provider]) => {
                    try {
                        const result = await provider.upload(syncedConfig);
                        results.set(name, result);

                        if (result.success) {
                            console.log(`Successfully synced to ${name}`);
                        } else {
                            console.error(`Failed to sync to ${name}:`, result.error);
                            NotificationManager.showWarning(
                                `Failed to sync to ${provider.getName()}: ${result.error}`
                            );
                        }
                    } catch (error) {
                        const err = error instanceof Error ? error : new Error('Unknown error');
                        console.error(`Error syncing to ${name}:`, err);
                        results.set(name, {
                            success: false,
                            error: err.message
                        });
                    }
                }
            );

            await Promise.all(uploadPromises);

        } finally {
            this.syncInProgress = false;
        }

        return results;
    }

    /**
     * Sync configuration from cloud (download)
     * Uses last-write-wins conflict resolution
     */
    async syncFromCloud(): Promise<{ config?: ShortcutsConfig; source?: string }> {
        if (!this.isEnabled()) {
            return {};
        }

        if (this.syncInProgress) {
            console.log('Sync already in progress, skipping');
            return {};
        }

        this.syncInProgress = true;

        try {
            // Download from all providers
            const downloadPromises = Array.from(this.providers.entries()).map(
                async ([name, provider]) => {
                    try {
                        const result = await provider.download();
                        return { name, result, provider };
                    } catch (error) {
                        const err = error instanceof Error ? error : new Error('Unknown error');
                        console.error(`Error downloading from ${name}:`, err);
                        return { name, result: { success: false, error: err.message }, provider };
                    }
                }
            );

            const results = await Promise.all(downloadPromises);

            // Find the newest config using last-write-wins
            let newestConfig: SyncedConfig | undefined;
            let newestTimestamp = 0;
            let newestSource: string | undefined;

            for (const { name, result, provider } of results) {
                if (result.success && result.config) {
                    const timestamp = result.config.metadata.lastModified;
                    if (timestamp > newestTimestamp) {
                        newestTimestamp = timestamp;
                        newestConfig = result.config;
                        newestSource = provider.getName();
                    }
                }
            }

            if (newestConfig) {
                console.log(`Using configuration from ${newestSource} (last modified: ${new Date(newestTimestamp)})`);
                return {
                    config: newestConfig.config,
                    source: newestSource
                };
            }

            return {};

        } finally {
            this.syncInProgress = false;
        }
    }

    /**
     * Check if cloud has newer configuration
     * Returns the timestamp of the newest cloud config, or undefined if none found
     */
    async checkForUpdates(): Promise<{ hasUpdates: boolean; timestamp?: number; source?: string }> {
        if (!this.isEnabled()) {
            return { hasUpdates: false };
        }

        try {
            // Get last modified timestamps from all providers
            const timestampPromises = Array.from(this.providers.entries()).map(
                async ([name, provider]) => {
                    try {
                        const timestamp = await provider.getLastModified();
                        return { name, timestamp, providerName: provider.getName() };
                    } catch (error) {
                        console.error(`Error checking updates from ${name}:`, error);
                        return { name, timestamp: undefined, providerName: provider.getName() };
                    }
                }
            );

            const results = await Promise.all(timestampPromises);

            // Find the newest timestamp
            let newestTimestamp = 0;
            let newestSource: string | undefined;

            for (const { timestamp, providerName } of results) {
                if (timestamp && timestamp > newestTimestamp) {
                    newestTimestamp = timestamp;
                    newestSource = providerName;
                }
            }

            return {
                hasUpdates: newestTimestamp > 0,
                timestamp: newestTimestamp || undefined,
                source: newestSource
            };

        } catch (error) {
            console.error('Error checking for updates:', error);
            return { hasUpdates: false };
        }
    }

    /**
     * Schedule a sync to cloud (with debouncing)
     */
    scheduleSyncToCloud(config: ShortcutsConfig): void {
        if (!this.isAutoSyncEnabled()) {
            return;
        }

        // Clear existing timer
        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
        }

        // Schedule new sync
        this.debounceTimer = setTimeout(() => {
            this.syncToCloud(config).catch(error => {
                console.error('Error during scheduled sync:', error);
            });
        }, this.DEBOUNCE_MS);
    }

    /**
     * Get sync status for all providers
     */
    async getSyncStatus(): Promise<Map<string, { status: SyncStatus; name: string }>> {
        const statusMap = new Map<string, { status: SyncStatus; name: string }>();

        for (const [key, provider] of this.providers.entries()) {
            const status = await provider.getStatus();
            statusMap.set(key, {
                status,
                name: provider.getName()
            });
        }

        return statusMap;
    }

    /**
     * Get or create a unique device ID
     */
    private getOrCreateDeviceId(): string {
        const storageKey = 'workspaceShortcuts.deviceId';

        let deviceId = this.context.globalState.get<string>(storageKey);

        if (!deviceId) {
            const hostname = os.hostname();
            const randomPart = Math.random().toString(36).substring(2, 15);
            deviceId = `${hostname}-${randomPart}`;
            this.context.globalState.update(storageKey, deviceId);
        }

        return deviceId;
    }

    /**
     * Start periodic sync
     */
    private startPeriodicSync(intervalMs: number): void {
        this.stopPeriodicSync();

        this.periodicSyncTimer = setInterval(() => {
            this.checkForUpdates().then(result => {
                if (result.hasUpdates) {
                    console.log(`Updates available from ${result.source}, syncing...`);
                    // The actual sync will be handled by the configuration manager
                }
            }).catch(error => {
                console.error('Error during periodic sync check:', error);
            });
        }, intervalMs);
    }

    /**
     * Stop periodic sync
     */
    private stopPeriodicSync(): void {
        if (this.periodicSyncTimer) {
            clearInterval(this.periodicSyncTimer);
            this.periodicSyncTimer = undefined;
        }
    }

    /**
     * Get the device ID
     */
    getDeviceId(): string {
        return this.deviceId;
    }

    /**
     * Get all enabled providers
     */
    getProviders(): Map<string, ISyncProvider> {
        return this.providers;
    }

    /**
     * Dispose all providers and clean up resources
     */
    dispose(): void {
        // Clear timers
        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
        }
        this.stopPeriodicSync();

        // Dispose all providers
        for (const provider of this.providers.values()) {
            provider.dispose();
        }
        this.providers.clear();
    }
}

