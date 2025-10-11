/**
 * Azure Blob Storage sync provider
 */

import { BlobServiceClient, ContainerClient } from '@azure/storage-blob';
import * as vscode from 'vscode';
import { CloudSyncProvider } from '../cloud-sync-provider';
import { SyncResult, SyncedConfig } from '../sync-provider';

/**
 * Configuration for Azure Blob provider
 */
export interface AzureBlobConfig {
    container: string;
    accountName: string;
    connectionString?: string;
    sasToken?: string;
}

/**
 * Azure Blob Storage sync provider implementation
 */
export class AzureBlobProvider extends CloudSyncProvider {
    private blobServiceClient?: BlobServiceClient;
    private containerClient?: ContainerClient;
    private readonly blobName = 'shortcuts-config.json';
    private readonly CREDENTIAL_KEY_CONNECTION = 'workspaceShortcuts.azure.connectionString';
    private readonly CREDENTIAL_KEY_SAS = 'workspaceShortcuts.azure.sasToken';

    constructor(
        private readonly config: AzureBlobConfig,
        private readonly secretStorage: vscode.SecretStorage
    ) {
        super();
    }

    /**
     * Get the name of this sync provider
     */
    getName(): string {
        return 'Azure Blob Storage';
    }

    /**
     * Check if the provider is properly configured
     */
    async isConfigured(): Promise<boolean> {
        if (!this.config.container || !this.config.accountName) {
            return false;
        }

        // Check if credentials are available
        const connectionString = await this.getConnectionString();
        const sasToken = await this.getSasToken();

        return !!(connectionString || sasToken);
    }

    /**
     * Get the last modified timestamp from Azure
     */
    async getLastModified(): Promise<number | undefined> {
        try {
            await this.ensureClient();
            if (!this.containerClient) {
                return undefined;
            }

            const blobClient = this.containerClient.getBlobClient(this.blobName);

            const exists = await blobClient.exists();
            if (!exists) {
                return undefined;
            }

            const properties = await blobClient.getProperties();
            return properties.lastModified?.getTime();
        } catch (error) {
            console.error('Error getting last modified from Azure:', error);
            return undefined;
        }
    }

    /**
     * Delete the configuration from Azure
     */
    async delete(): Promise<boolean> {
        try {
            await this.ensureClient();
            if (!this.containerClient) {
                return false;
            }

            const blobClient = this.containerClient.getBlobClient(this.blobName);
            await blobClient.delete();
            return true;
        } catch (error) {
            console.error('Error deleting from Azure:', error);
            return false;
        }
    }

    /**
     * Upload configuration to Azure
     */
    protected async uploadImpl(config: SyncedConfig): Promise<SyncResult> {
        await this.ensureClient();
        if (!this.containerClient) {
            return {
                success: false,
                error: 'Azure client not initialized'
            };
        }

        try {
            const content = JSON.stringify(config, null, 2);
            const checksum = this.calculateChecksum(content);

            const blockBlobClient = this.containerClient.getBlockBlobClient(this.blobName);

            await blockBlobClient.upload(content, content.length, {
                blobHTTPHeaders: {
                    blobContentType: 'application/json'
                },
                metadata: {
                    checksum,
                    deviceId: config.metadata.deviceId,
                    version: config.metadata.version.toString(),
                    lastModified: config.metadata.lastModified.toString()
                }
            });

            return {
                success: true,
                timestamp: config.metadata.lastModified,
                deviceId: config.metadata.deviceId
            };
        } catch (error) {
            const err = error instanceof Error ? error : new Error('Unknown error');
            return {
                success: false,
                error: `Failed to upload to Azure: ${err.message}`
            };
        }
    }

    /**
     * Download configuration from Azure
     */
    protected async downloadImpl(): Promise<SyncResult & { config?: SyncedConfig }> {
        await this.ensureClient();
        if (!this.containerClient) {
            return {
                success: false,
                error: 'Azure client not initialized'
            };
        }

        try {
            const blobClient = this.containerClient.getBlobClient(this.blobName);

            const exists = await blobClient.exists();
            if (!exists) {
                return {
                    success: true,
                    error: 'No configuration found in Azure'
                };
            }

            const downloadResponse = await blobClient.download();

            if (!downloadResponse.readableStreamBody) {
                return {
                    success: false,
                    error: 'Empty response from Azure'
                };
            }

            // Convert stream to string
            const content = await this.streamToString(downloadResponse.readableStreamBody);
            const config: SyncedConfig = JSON.parse(content);

            // Verify checksum if available
            const storedChecksum = downloadResponse.metadata?.checksum;
            if (storedChecksum) {
                const calculatedChecksum = this.calculateChecksum(content);
                if (storedChecksum !== calculatedChecksum) {
                    return {
                        success: false,
                        error: 'Checksum mismatch - data may be corrupted'
                    };
                }
            }

            return {
                success: true,
                config,
                timestamp: config.metadata.lastModified,
                deviceId: config.metadata.deviceId
            };
        } catch (error) {
            const err = error instanceof Error ? error : new Error('Unknown error');
            return {
                success: false,
                error: `Failed to download from Azure: ${err.message}`
            };
        }
    }

    /**
     * Initialize the Azure client
     */
    protected async initializeImpl(): Promise<boolean> {
        try {
            await this.ensureClient();
            return !!this.blobServiceClient;
        } catch (error) {
            console.error('Error initializing Azure provider:', error);
            return false;
        }
    }

    /**
     * Clean up resources
     */
    protected disposeImpl(): void {
        this.blobServiceClient = undefined;
        this.containerClient = undefined;
    }

    /**
     * Ensure Azure client is initialized
     */
    private async ensureClient(): Promise<void> {
        if (this.blobServiceClient && this.containerClient) {
            return;
        }

        const connectionString = await this.getConnectionString();
        const sasToken = await this.getSasToken();

        if (connectionString) {
            this.blobServiceClient = BlobServiceClient.fromConnectionString(connectionString);
        } else if (sasToken) {
            const accountUrl = `https://${this.config.accountName}.blob.core.windows.net`;
            this.blobServiceClient = new BlobServiceClient(`${accountUrl}?${sasToken}`);
        } else {
            throw new Error('Azure credentials not configured');
        }

        this.containerClient = this.blobServiceClient.getContainerClient(this.config.container);

        // Ensure container exists
        await this.containerClient.createIfNotExists();
    }

    /**
     * Get connection string from secure storage or config
     */
    private async getConnectionString(): Promise<string | undefined> {
        // Try secure storage first
        const stored = await this.secretStorage.get(this.CREDENTIAL_KEY_CONNECTION);
        if (stored) {
            return stored;
        }

        // Fall back to config (not recommended for production)
        return this.config.connectionString;
    }

    /**
     * Get SAS token from secure storage or config
     */
    private async getSasToken(): Promise<string | undefined> {
        // Try secure storage first
        const stored = await this.secretStorage.get(this.CREDENTIAL_KEY_SAS);
        if (stored) {
            return stored;
        }

        // Fall back to config (not recommended for production)
        return this.config.sasToken;
    }

    /**
     * Convert a readable stream to string
     */
    private async streamToString(readableStream: NodeJS.ReadableStream): Promise<string> {
        return new Promise((resolve, reject) => {
            const chunks: Buffer[] = [];
            readableStream.on('data', (data) => {
                chunks.push(data instanceof Buffer ? data : Buffer.from(data));
            });
            readableStream.on('end', () => {
                resolve(Buffer.concat(chunks).toString('utf-8'));
            });
            readableStream.on('error', reject);
        });
    }

    /**
     * Store Azure connection string in secure storage
     */
    async storeConnectionString(connectionString: string): Promise<void> {
        await this.secretStorage.store(this.CREDENTIAL_KEY_CONNECTION, connectionString);
    }

    /**
     * Store Azure SAS token in secure storage
     */
    async storeSasToken(sasToken: string): Promise<void> {
        await this.secretStorage.store(this.CREDENTIAL_KEY_SAS, sasToken);
    }

    /**
     * Clear Azure credentials from secure storage
     */
    async clearCredentials(): Promise<void> {
        await this.secretStorage.delete(this.CREDENTIAL_KEY_CONNECTION);
        await this.secretStorage.delete(this.CREDENTIAL_KEY_SAS);
    }
}

