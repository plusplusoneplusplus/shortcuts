/**
 * Copilot SDK Service
 *
 * Provides a wrapper around the @github/copilot-sdk for structured AI interactions.
 * This service manages the SDK client lifecycle and provides a clean API for
 * sending messages and managing sessions.
 *
 * Key Features:
 * - Singleton client pattern for efficient resource usage
 * - Lazy initialization with ESM dynamic import workaround
 * - Graceful fallback when SDK is unavailable
 * - Session management for conversation persistence
 * - Session pool for efficient parallel request handling
 *
 * @see https://github.com/github/copilot-sdk
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { AIInvocationResult, AIBackendType } from './types';
import { getExtensionLogger, LogCategory } from './ai-service-logger';
import { SessionPool, IPoolableSession, SessionPoolStats } from './session-pool';

/**
 * Options for sending a message via the SDK
 */
export interface SendMessageOptions {
    /** The prompt to send */
    prompt: string;
    /** Optional model override */
    model?: string;
    /** Optional working directory for context */
    workingDirectory?: string;
    /** Optional timeout in milliseconds (default: 300000 = 5 minutes) */
    timeoutMs?: number;
    /** Use session pool for efficient parallel requests (default: false) */
    usePool?: boolean;
}

/**
 * Result from SDK invocation, extends AIInvocationResult with SDK-specific fields
 */
export interface SDKInvocationResult extends AIInvocationResult {
    /** Session ID used for this request (if session was created) */
    sessionId?: string;
    /** Raw SDK response data */
    rawResponse?: unknown;
}

/**
 * SDK availability check result
 */
export interface SDKAvailabilityResult {
    /** Whether the SDK is available and can be used */
    available: boolean;
    /** Path to the SDK if found */
    sdkPath?: string;
    /** Error message if not available */
    error?: string;
}

/**
 * Interface for the CopilotClient from @github/copilot-sdk
 * We define this interface to avoid direct type dependency on the SDK
 */
interface ICopilotClient {
    createSession(): Promise<ICopilotSession>;
    stop(): Promise<void>;
}

/**
 * Interface for the CopilotSession from @github/copilot-sdk
 */
interface ICopilotSession {
    sessionId: string;
    sendAndWait(options: { prompt: string }): Promise<{ data?: { content?: string } }>;
    destroy(): Promise<void>;
}

/**
 * Singleton service for interacting with the Copilot SDK.
 *
 * Usage:
 * ```typescript
 * const service = CopilotSDKService.getInstance();
 * if (await service.isAvailable()) {
 *     // Simple request (creates and destroys session)
 *     const result = await service.sendMessage({ prompt: 'Hello' });
 *
 *     // Pooled request (reuses sessions for parallel workloads)
 *     const pooledResult = await service.sendMessage({ prompt: 'Hello', usePool: true });
 * }
 * ```
 */
export class CopilotSDKService {
    private static instance: CopilotSDKService | null = null;

    private client: ICopilotClient | null = null;
    private sdkModule: { CopilotClient: new () => ICopilotClient } | null = null;
    private initializationPromise: Promise<void> | null = null;
    private availabilityCache: SDKAvailabilityResult | null = null;
    private sessionPool: SessionPool | null = null;
    private disposed = false;

    /** Default timeout for SDK requests (5 minutes) */
    private static readonly DEFAULT_TIMEOUT_MS = 300000;

    private constructor() {
        // Private constructor for singleton pattern
    }

    /**
     * Get the singleton instance of CopilotSDKService
     */
    public static getInstance(): CopilotSDKService {
        if (!CopilotSDKService.instance) {
            CopilotSDKService.instance = new CopilotSDKService();
        }
        return CopilotSDKService.instance;
    }

    /**
     * Reset the singleton instance (primarily for testing)
     */
    public static resetInstance(): void {
        if (CopilotSDKService.instance) {
            CopilotSDKService.instance.dispose();
            CopilotSDKService.instance = null;
        }
    }

    /**
     * Check if the Copilot SDK is available and can be used.
     * Results are cached after the first check.
     *
     * @returns Availability result with status and optional error
     */
    public async isAvailable(): Promise<SDKAvailabilityResult> {
        if (this.disposed) {
            return { available: false, error: 'Service has been disposed' };
        }

        if (this.availabilityCache) {
            return this.availabilityCache;
        }

        const logger = getExtensionLogger();
        logger.debug(LogCategory.AI, 'CopilotSDKService: Checking SDK availability');

        try {
            const sdkPath = this.findSDKPath();
            if (!sdkPath) {
                this.availabilityCache = {
                    available: false,
                    error: 'Copilot SDK not found. Please ensure @github/copilot-sdk is installed.'
                };
                logger.debug(LogCategory.AI, 'CopilotSDKService: SDK not found');
                return this.availabilityCache;
            }

            // Try to load the SDK module to verify it works
            await this.loadSDKModule(sdkPath);

            this.availabilityCache = {
                available: true,
                sdkPath
            };
            logger.debug(LogCategory.AI, `CopilotSDKService: SDK available at: ${sdkPath}`);
            return this.availabilityCache;

        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.availabilityCache = {
                available: false,
                error: `Failed to load Copilot SDK: ${errorMessage}`
            };
            logger.error(LogCategory.AI, 'CopilotSDKService: SDK availability check failed', error instanceof Error ? error : undefined);
            return this.availabilityCache;
        }
    }

    /**
     * Clear the availability cache, forcing a re-check on next isAvailable() call.
     * Useful when the SDK might have been installed after initial check.
     */
    public clearAvailabilityCache(): void {
        this.availabilityCache = null;
    }

    /**
     * Ensure the SDK client is initialized.
     * Uses lazy initialization to avoid startup overhead.
     *
     * @throws Error if SDK is not available or initialization fails
     */
    public async ensureClient(): Promise<ICopilotClient> {
        if (this.disposed) {
            throw new Error('CopilotSDKService has been disposed');
        }

        if (this.client) {
            return this.client;
        }

        // Use a promise to prevent concurrent initialization
        if (this.initializationPromise) {
            await this.initializationPromise;
            if (this.client) {
                return this.client;
            }
        }

        const logger = getExtensionLogger();
        logger.debug(LogCategory.AI, 'CopilotSDKService: Initializing SDK client');

        this.initializationPromise = this.initializeClient();
        await this.initializationPromise;
        this.initializationPromise = null;

        if (!this.client) {
            throw new Error('Failed to initialize Copilot SDK client');
        }

        return this.client;
    }

    /**
     * Send a message to Copilot via the SDK.
     * By default, creates a new session for each request (session-per-request pattern).
     * When usePool is true, uses the session pool for efficient parallel requests.
     *
     * @param options Message options including prompt and optional settings
     * @returns Invocation result with response or error
     */
    public async sendMessage(options: SendMessageOptions): Promise<SDKInvocationResult> {
        if (options.usePool) {
            return this.sendMessageWithPool(options);
        }
        return this.sendMessageDirect(options);
    }

    /**
     * Send a message using a session from the pool.
     * This is more efficient for parallel workloads as sessions are reused.
     *
     * @param options Message options including prompt and optional settings
     * @returns Invocation result with response or error
     */
    private async sendMessageWithPool(options: SendMessageOptions): Promise<SDKInvocationResult> {
        const logger = getExtensionLogger();
        const startTime = Date.now();

        // Check availability first
        const availability = await this.isAvailable();
        if (!availability.available) {
            return {
                success: false,
                error: availability.error || 'Copilot SDK is not available'
            };
        }

        let session: IPoolableSession | null = null;
        let shouldDestroySession = false;

        try {
            const pool = await this.ensureSessionPool();
            const timeoutMs = options.timeoutMs ?? CopilotSDKService.DEFAULT_TIMEOUT_MS;

            logger.debug(LogCategory.AI, 'CopilotSDKService: Acquiring session from pool');
            session = await pool.acquire(timeoutMs);
            logger.debug(LogCategory.AI, `CopilotSDKService: Acquired session from pool: ${session.sessionId}`);

            // Send the message with timeout
            const result = await this.sendWithTimeout(session, options.prompt, timeoutMs);

            const response = result?.data?.content || '';
            const durationMs = Date.now() - startTime;

            logger.debug(LogCategory.AI, `CopilotSDKService: Pooled request completed in ${durationMs}ms`);

            if (!response) {
                return {
                    success: false,
                    error: 'No response received from Copilot SDK',
                    sessionId: session.sessionId
                };
            }

            return {
                success: true,
                response,
                sessionId: session.sessionId,
                rawResponse: result
            };

        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            const durationMs = Date.now() - startTime;

            logger.error(LogCategory.AI, `CopilotSDKService: Pooled request failed after ${durationMs}ms`, error instanceof Error ? error : undefined);

            // Mark session for destruction on error (don't reuse potentially broken sessions)
            shouldDestroySession = true;

            return {
                success: false,
                error: `Copilot SDK error: ${errorMessage}`,
                sessionId: session?.sessionId
            };

        } finally {
            // Release or destroy session
            if (session && this.sessionPool) {
                if (shouldDestroySession) {
                    try {
                        await this.sessionPool.destroy(session);
                        logger.debug(LogCategory.AI, 'CopilotSDKService: Session destroyed after error');
                    } catch (destroyError) {
                        logger.debug(LogCategory.AI, `CopilotSDKService: Warning: Error destroying session: ${destroyError}`);
                    }
                } else {
                    this.sessionPool.release(session);
                    logger.debug(LogCategory.AI, 'CopilotSDKService: Session released back to pool');
                }
            }
        }
    }

    /**
     * Send a message directly (creates and destroys session).
     * This is the original behavior, suitable for one-off requests.
     *
     * @param options Message options including prompt and optional settings
     * @returns Invocation result with response or error
     */
    private async sendMessageDirect(options: SendMessageOptions): Promise<SDKInvocationResult> {
        const logger = getExtensionLogger();
        const startTime = Date.now();

        // Check availability first
        const availability = await this.isAvailable();
        if (!availability.available) {
            return {
                success: false,
                error: availability.error || 'Copilot SDK is not available'
            };
        }

        let session: ICopilotSession | null = null;

        try {
            const client = await this.ensureClient();

            logger.debug(LogCategory.AI, 'CopilotSDKService: Creating session for request');
            session = await client.createSession();
            logger.debug(LogCategory.AI, `CopilotSDKService: Session created: ${session.sessionId}`);

            // Send the message with timeout
            const timeoutMs = options.timeoutMs ?? CopilotSDKService.DEFAULT_TIMEOUT_MS;
            const result = await this.sendWithTimeout(session, options.prompt, timeoutMs);

            const response = result?.data?.content || '';
            const durationMs = Date.now() - startTime;

            logger.debug(LogCategory.AI, `CopilotSDKService: Request completed in ${durationMs}ms`);

            if (!response) {
                return {
                    success: false,
                    error: 'No response received from Copilot SDK',
                    sessionId: session.sessionId
                };
            }

            return {
                success: true,
                response,
                sessionId: session.sessionId,
                rawResponse: result
            };

        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            const durationMs = Date.now() - startTime;

            logger.error(LogCategory.AI, `CopilotSDKService: Request failed after ${durationMs}ms`, error instanceof Error ? error : undefined);

            return {
                success: false,
                error: `Copilot SDK error: ${errorMessage}`,
                sessionId: session?.sessionId
            };

        } finally {
            // Clean up session
            if (session) {
                try {
                    await session.destroy();
                    logger.debug(LogCategory.AI, 'CopilotSDKService: Session destroyed');
                } catch (destroyError) {
                    logger.debug(LogCategory.AI, `CopilotSDKService: Warning: Error destroying session: ${destroyError}`);
                }
            }
        }
    }

    /**
     * Get the session pool, creating it if necessary.
     * The pool is lazily initialized on first use.
     *
     * @returns The session pool
     * @throws Error if SDK is not available
     */
    private async ensureSessionPool(): Promise<SessionPool> {
        if (this.disposed) {
            throw new Error('CopilotSDKService has been disposed');
        }

        if (this.sessionPool) {
            return this.sessionPool;
        }

        const logger = getExtensionLogger();
        logger.debug(LogCategory.AI, 'CopilotSDKService: Creating session pool');

        // Ensure client is initialized first
        const client = await this.ensureClient();

        // Create the session pool with a factory that creates sessions from the client
        this.sessionPool = new SessionPool(
            async () => {
                const session = await client.createSession();
                return session as IPoolableSession;
            },
            {
                maxSessions: getSDKMaxSessionsSetting(),
                idleTimeoutMs: getSDKSessionTimeoutSetting()
            }
        );

        logger.debug(LogCategory.AI, 'CopilotSDKService: Session pool created');
        return this.sessionPool;
    }

    /**
     * Get statistics about the session pool.
     * Returns null if the pool has not been initialized.
     *
     * @returns Pool statistics or null
     */
    public getPoolStats(): SessionPoolStats | null {
        return this.sessionPool?.getStats() ?? null;
    }

    /**
     * Check if the session pool is active.
     *
     * @returns True if the pool exists and is not disposed
     */
    public hasActivePool(): boolean {
        return this.sessionPool !== null && !this.sessionPool.isDisposed();
    }

    /**
     * Clean up resources. Should be called when the extension deactivates.
     */
    public async cleanup(): Promise<void> {
        const logger = getExtensionLogger();
        logger.debug(LogCategory.AI, 'CopilotSDKService: Cleaning up SDK service');

        // Dispose session pool first
        if (this.sessionPool) {
            try {
                await this.sessionPool.dispose();
                logger.debug(LogCategory.AI, 'CopilotSDKService: Session pool disposed');
            } catch (error) {
                logger.debug(LogCategory.AI, `CopilotSDKService: Warning: Error disposing session pool: ${error}`);
            }
            this.sessionPool = null;
        }

        if (this.client) {
            try {
                await this.client.stop();
                logger.debug(LogCategory.AI, 'CopilotSDKService: Client stopped');
            } catch (error) {
                logger.debug(LogCategory.AI, `CopilotSDKService: Warning: Error stopping client: ${error}`);
            }
            this.client = null;
        }

        this.sdkModule = null;
        this.availabilityCache = null;
    }

    /**
     * Dispose of the service and release all resources.
     */
    public dispose(): void {
        this.disposed = true;
        // Fire and forget cleanup
        this.cleanup().catch(() => {
            // Ignore cleanup errors during dispose
        });
    }

    /**
     * Find the SDK package path by checking multiple possible locations.
     * This handles both development and packaged extension scenarios.
     */
    private findSDKPath(): string | undefined {
        const possiblePaths = [
            // Development: running from dist/
            path.join(__dirname, '..', 'node_modules', '@github', 'copilot-sdk'),
            // Development: running from out/shortcuts/ai-service
            path.join(__dirname, '..', '..', '..', 'node_modules', '@github', 'copilot-sdk'),
            // Packaged extension
            path.join(__dirname, 'node_modules', '@github', 'copilot-sdk'),
            // Workspace root (for development)
            path.join(__dirname, '..', '..', '..', '..', 'node_modules', '@github', 'copilot-sdk'),
        ];

        for (const testPath of possiblePaths) {
            const indexPath = path.join(testPath, 'dist', 'index.js');
            if (fs.existsSync(indexPath)) {
                return testPath;
            }
        }

        return undefined;
    }

    /**
     * Load the SDK module using ESM dynamic import workaround.
     * This is necessary because webpack transforms import() in ways that break ESM loading.
     */
    private async loadSDKModule(sdkPath: string): Promise<void> {
        if (this.sdkModule) {
            return;
        }

        const sdkIndexPath = path.join(sdkPath, 'dist', 'index.js');

        // Import using file URL for ESM compatibility
        // Use Function constructor to bypass webpack's import() transformation
        const { pathToFileURL } = await import('url');
        const sdkUrl = pathToFileURL(sdkIndexPath).href;

        // Bypass webpack's import transformation using Function constructor
        // This is necessary because webpack transforms import() in ways that break ESM loading
        // eslint-disable-next-line @typescript-eslint/no-implied-eval
        const dynamicImport = new Function('specifier', 'return import(specifier)');
        const sdk = await dynamicImport(sdkUrl);

        if (!sdk.CopilotClient) {
            throw new Error('CopilotClient not found in SDK module');
        }

        this.sdkModule = sdk;
    }

    /**
     * Initialize the SDK client.
     */
    private async initializeClient(): Promise<void> {
        const sdkPath = this.findSDKPath();
        if (!sdkPath) {
            throw new Error('Copilot SDK not found');
        }

        await this.loadSDKModule(sdkPath);

        if (!this.sdkModule) {
            throw new Error('SDK module not loaded');
        }

        this.client = new this.sdkModule.CopilotClient();
    }

    /**
     * Send a message with timeout support.
     */
    private async sendWithTimeout(
        session: ICopilotSession,
        prompt: string,
        timeoutMs: number
    ): Promise<{ data?: { content?: string } }> {
        return new Promise((resolve, reject) => {
            const timeoutId = setTimeout(() => {
                reject(new Error(`Request timed out after ${timeoutMs}ms`));
            }, timeoutMs);

            session.sendAndWait({ prompt })
                .then(result => {
                    clearTimeout(timeoutId);
                    resolve(result);
                })
                .catch(error => {
                    clearTimeout(timeoutId);
                    reject(error);
                });
        });
    }
}

// ============================================================================
// Configuration Helpers
// ============================================================================

/**
 * Get the configured AI backend from VS Code settings.
 *
 * @returns The configured backend type
 */
export function getAIBackendSetting(): AIBackendType {
    const config = vscode.workspace.getConfiguration('workspaceShortcuts.aiService');
    const backend = config.get<string>('backend', 'copilot-cli');

    // Validate the backend setting
    if (backend === 'copilot-sdk' || backend === 'copilot-cli' || backend === 'clipboard') {
        return backend;
    }

    // Default to copilot-cli if invalid value
    return 'copilot-cli';
}

/**
 * Get the SDK max sessions setting.
 *
 * @returns Maximum number of concurrent SDK sessions
 */
export function getSDKMaxSessionsSetting(): number {
    const config = vscode.workspace.getConfiguration('workspaceShortcuts.aiService.sdk');
    return config.get<number>('maxSessions', 5);
}

/**
 * Get the SDK session timeout setting.
 *
 * @returns Session timeout in milliseconds
 */
export function getSDKSessionTimeoutSetting(): number {
    const config = vscode.workspace.getConfiguration('workspaceShortcuts.aiService.sdk');
    return config.get<number>('sessionTimeout', 300000);
}

// ============================================================================
// Convenience Functions
// ============================================================================

/**
 * Get the singleton CopilotSDKService instance.
 * Convenience function for cleaner imports.
 */
export function getCopilotSDKService(): CopilotSDKService {
    return CopilotSDKService.getInstance();
}

/**
 * Reset the CopilotSDKService singleton (primarily for testing).
 */
export function resetCopilotSDKService(): void {
    CopilotSDKService.resetInstance();
}
