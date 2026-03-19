/**
 * Sync provider interface and types for cloud synchronization
 */

/**
 * Result of a sync operation
 */
export interface SyncResult {
    /** Whether the sync was successful */
    success: boolean;
    /** Timestamp of the synced configuration */
    timestamp?: number;
    /** Error message if sync failed */
    error?: string;
    /** Whether a conflict was detected */
    conflict?: boolean;
    /** Device ID that last modified the config */
    deviceId?: string;
}

/**
 * Metadata for synced configuration
 */
export interface SyncMetadata {
    /** Timestamp when configuration was last modified */
    lastModified: number;
    /** Unique identifier for the device that made the change */
    deviceId: string;
    /** Version of the configuration format */
    version: number;
    /** Optional checksum for integrity verification */
    checksum?: string;
}

/**
 * Configuration data with sync metadata
 */
export interface SyncedConfig {
    /** The actual configuration data */
    config: any;
    /** Metadata about the sync */
    metadata: SyncMetadata;
}

/**
 * Sync provider status
 */
export enum SyncStatus {
    /** Provider is not configured */
    NotConfigured = 'not_configured',
    /** Provider is configured and ready */
    Ready = 'ready',
    /** Currently syncing */
    Syncing = 'syncing',
    /** Last sync failed */
    Error = 'error',
    /** Authentication required */
    AuthRequired = 'auth_required'
}

/**
 * Interface for sync providers
 */
export interface ISyncProvider {
    /**
     * Get the name of this sync provider
     */
    getName(): string;

    /**
     * Check if the provider is properly configured
     */
    isConfigured(): Promise<boolean>;

    /**
     * Get the current status of the provider
     */
    getStatus(): Promise<SyncStatus>;

    /**
     * Upload configuration to the cloud
     * @param config Configuration data to upload
     * @returns Result of the upload operation
     */
    upload(config: SyncedConfig): Promise<SyncResult>;

    /**
     * Download configuration from the cloud
     * @returns Result containing the downloaded configuration
     */
    download(): Promise<SyncResult & { config?: SyncedConfig }>;

    /**
     * Get the last modified timestamp from the cloud
     * @returns Timestamp of the last modification, or undefined if not available
     */
    getLastModified(): Promise<number | undefined>;

    /**
     * Delete the configuration from the cloud
     * @returns Whether the deletion was successful
     */
    delete(): Promise<boolean>;

    /**
     * Initialize the provider (e.g., create buckets, authenticate)
     * @returns Whether initialization was successful
     */
    initialize(): Promise<boolean>;

    /**
     * Clean up resources (e.g., close connections)
     */
    dispose(): void;
}

/**
 * Base configuration for all sync providers
 */
export interface BaseSyncProviderConfig {
    /** Whether this provider is enabled */
    enabled: boolean;
}

