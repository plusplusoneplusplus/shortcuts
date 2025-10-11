/**
 * Base class for cloud-based sync providers with common functionality
 */

import { ISyncProvider, SyncResult, SyncStatus, SyncedConfig } from './sync-provider';

/**
 * Retry configuration for network operations
 */
interface RetryConfig {
    maxAttempts: number;
    delayMs: number;
    backoffMultiplier: number;
}

/**
 * Abstract base class for cloud sync providers
 */
export abstract class CloudSyncProvider implements ISyncProvider {
    protected status: SyncStatus = SyncStatus.NotConfigured;
    protected lastError?: string;

    private readonly retryConfig: RetryConfig = {
        maxAttempts: 3,
        delayMs: 1000,
        backoffMultiplier: 2
    };

    /**
     * Get the name of this sync provider
     */
    abstract getName(): string;

    /**
     * Check if the provider is properly configured
     */
    abstract isConfigured(): Promise<boolean>;

    /**
     * Get the current status of the provider
     */
    async getStatus(): Promise<SyncStatus> {
        return this.status;
    }

    /**
     * Upload configuration to the cloud with retry logic
     */
    async upload(config: SyncedConfig): Promise<SyncResult> {
        try {
            this.status = SyncStatus.Syncing;
            const result = await this.retryOperation(() => this.uploadImpl(config));
            this.status = result.success ? SyncStatus.Ready : SyncStatus.Error;
            if (!result.success) {
                this.lastError = result.error;
            }
            return result;
        } catch (error) {
            const err = error instanceof Error ? error : new Error('Unknown error');
            this.status = SyncStatus.Error;
            this.lastError = err.message;
            return {
                success: false,
                error: err.message
            };
        }
    }

    /**
     * Download configuration from the cloud with retry logic
     */
    async download(): Promise<SyncResult & { config?: SyncedConfig }> {
        try {
            this.status = SyncStatus.Syncing;
            const result = await this.retryOperation(() => this.downloadImpl());
            this.status = result.success ? SyncStatus.Ready : SyncStatus.Error;
            if (!result.success) {
                this.lastError = result.error;
            }
            return result;
        } catch (error) {
            const err = error instanceof Error ? error : new Error('Unknown error');
            this.status = SyncStatus.Error;
            this.lastError = err.message;
            return {
                success: false,
                error: err.message
            };
        }
    }

    /**
     * Get the last modified timestamp from the cloud
     */
    abstract getLastModified(): Promise<number | undefined>;

    /**
     * Delete the configuration from the cloud
     */
    abstract delete(): Promise<boolean>;

    /**
     * Initialize the provider
     */
    async initialize(): Promise<boolean> {
        try {
            const configured = await this.isConfigured();
            if (!configured) {
                this.status = SyncStatus.NotConfigured;
                return false;
            }

            const initResult = await this.initializeImpl();
            this.status = initResult ? SyncStatus.Ready : SyncStatus.Error;
            return initResult;
        } catch (error) {
            const err = error instanceof Error ? error : new Error('Unknown error');
            this.status = SyncStatus.Error;
            this.lastError = err.message;
            return false;
        }
    }

    /**
     * Clean up resources
     */
    dispose(): void {
        this.disposeImpl();
    }

    /**
     * Actual implementation of upload (to be implemented by subclasses)
     */
    protected abstract uploadImpl(config: SyncedConfig): Promise<SyncResult>;

    /**
     * Actual implementation of download (to be implemented by subclasses)
     */
    protected abstract downloadImpl(): Promise<SyncResult & { config?: SyncedConfig }>;

    /**
     * Actual implementation of initialization (to be implemented by subclasses)
     */
    protected abstract initializeImpl(): Promise<boolean>;

    /**
     * Actual implementation of disposal (to be implemented by subclasses)
     */
    protected abstract disposeImpl(): void;

    /**
     * Retry an operation with exponential backoff
     */
    protected async retryOperation<T>(
        operation: () => Promise<T>,
        config: RetryConfig = this.retryConfig
    ): Promise<T> {
        let lastError: Error | undefined;
        let delay = config.delayMs;

        for (let attempt = 1; attempt <= config.maxAttempts; attempt++) {
            try {
                return await operation();
            } catch (error) {
                lastError = error instanceof Error ? error : new Error('Unknown error');

                // Don't retry on authentication errors
                if (this.isAuthError(error)) {
                    this.status = SyncStatus.AuthRequired;
                    throw error;
                }

                // If this was the last attempt, throw the error
                if (attempt === config.maxAttempts) {
                    throw lastError;
                }

                // Wait before retrying
                await this.sleep(delay);
                delay *= config.backoffMultiplier;
            }
        }

        // Should never reach here, but TypeScript needs it
        throw lastError || new Error('Operation failed after retries');
    }

    /**
     * Check if an error is an authentication error
     */
    protected isAuthError(error: any): boolean {
        const message = error?.message?.toLowerCase() || '';
        const code = error?.code?.toLowerCase() || '';
        return (
            message.includes('auth') ||
            message.includes('unauthorized') ||
            message.includes('forbidden') ||
            message.includes('credential') ||
            code === 'unauthorised' ||
            code === 'forbidden' ||
            code === '401' ||
            code === '403'
        );
    }

    /**
     * Sleep for a specified duration
     */
    protected sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Calculate a simple checksum for data integrity
     */
    protected calculateChecksum(data: string): string {
        let hash = 0;
        for (let i = 0; i < data.length; i++) {
            const char = data.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash; // Convert to 32-bit integer
        }
        return Math.abs(hash).toString(36);
    }

    /**
     * Get the last error message
     */
    getLastError(): string | undefined {
        return this.lastError;
    }
}

