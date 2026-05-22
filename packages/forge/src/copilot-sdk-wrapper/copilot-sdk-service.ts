/**
 * Copilot SDK Service — Facade
 *
 * Singleton lifecycle, constructor wiring, and single-delegation public stubs.
 * All business logic lives in the collaborator classes imported below.
 *
 * @see sdk-loader.ts        — SDK availability check
 * @see sdk-client-factory.ts — per-request CopilotClient spawning
 * @see session-manager.ts   — active-session tracking / abort
 * @see streaming-session.ts  — streaming state machine
 * @see model-registry.ts    — model definitions and live listing
 * @see stream-error-guard.ts — process-level ERR_STREAM_DESTROYED guard
 * @see request-runner.ts    — sendMessage / transform execution logic
 * @see image-converter.ts   — image-file → data-URL conversion
 */

import type { CopilotClient } from '@github/copilot-sdk';
import { findSdkBinaryPath } from './sdk-loader';
import { loadCopilotSdk } from './sdk-esm-loader';
import { getAIServiceLogger } from '../ai-logger';
import { createSdkClient } from './sdk-client-factory';
import { DEFAULT_AI_TIMEOUT_MS } from '../ai/timeouts';
import { DEFAULT_AI_IDLE_TIMEOUT_MS } from '../config/defaults';
import {
    SendMessageOptions,
    SDKInvocationResult,
    SDKAvailabilityResult,
    approveAllPermissions,
    denyAllPermissions,
} from './types';
import { ModelInfo } from './model-info';
import { fetchModelsFromClient } from './model-registry';
export type { StreamingResult, IStreamableSession, StreamingState, StreamingSessionRunOptions, BackgroundTasksInfo } from './streaming-session';
import { SessionManager } from './session-manager';
import { StreamErrorGuard, isStreamDestroyedError } from './stream-error-guard';
import { RequestRunner } from './request-runner';
import type { ISDKService } from './sdk-service-interface';
import { sdkServiceRegistry, COPILOT_PROVIDER } from './sdk-service-registry';

// Re-export types that were previously exported from this file
export {
    MCPServerConfigBase,
    MCPLocalServerConfig,
    MCPRemoteServerConfig,
    MCPServerConfig,
    MCPControlOptions,
    ReasoningEffort,
    SendMessageOptions,
    TokenUsage,
    SDKInvocationResult,
    SDKAvailabilityResult,
    PermissionRequest,
    PermissionRequestResult,
    PermissionHandler,
    approveAllPermissions,
    denyAllPermissions,
} from './types';

export { tryConvertImageFileToDataUrl } from './image-converter';

export class CopilotSDKService implements ISDKService {
    private static instance: CopilotSDKService | null = null;

    private availabilityCache: SDKAvailabilityResult | null = null;
    private disposed = false;

    private readonly sessionManager = new SessionManager();
    private readonly streamErrorGuard = new StreamErrorGuard();
    private readonly requestRunner: RequestRunner;

    private static readonly DEFAULT_TIMEOUT_MS = DEFAULT_AI_TIMEOUT_MS;
    private static readonly DEFAULT_IDLE_TIMEOUT_MS = DEFAULT_AI_IDLE_TIMEOUT_MS;

    private constructor() {
        this.requestRunner = new RequestRunner(
            () => this.isAvailable(),
            (cwd) => this.createClient(cwd),
            this.sessionManager,
            CopilotSDKService.DEFAULT_TIMEOUT_MS,
            CopilotSDKService.DEFAULT_IDLE_TIMEOUT_MS,
        );
    }

    public static getInstance(): CopilotSDKService {
        if (!CopilotSDKService.instance) {
            CopilotSDKService.instance = new CopilotSDKService();
        }
        if (!sdkServiceRegistry.has(COPILOT_PROVIDER)) {
            sdkServiceRegistry.register(COPILOT_PROVIDER, CopilotSDKService.instance);
        }
        return CopilotSDKService.instance;
    }

    public static resetInstance(): void {
        if (CopilotSDKService.instance) {
            CopilotSDKService.instance.dispose();
            CopilotSDKService.instance = null;
            sdkServiceRegistry.unregister(COPILOT_PROVIDER);
        }
        // Re-register a fresh instance immediately so callers can always resolve
        // the provider via sdkServiceRegistry.getOrThrow(COPILOT_PROVIDER) after
        // a reset without needing to call getInstance() first.
        CopilotSDKService.getInstance();
    }

    public async isAvailable(): Promise<SDKAvailabilityResult> {
        if (this.disposed) return { available: false, error: 'Service has been disposed' };
        if (this.availabilityCache) return this.availabilityCache;
        const aiLog = getAIServiceLogger();
        aiLog.debug('Checking SDK availability');
        const sdkPath = findSdkBinaryPath();
        if (!sdkPath) {
            this.availabilityCache = { available: false, error: 'Copilot SDK not found. Please ensure @github/copilot-sdk is installed.' };
            aiLog.debug('SDK not found');
            return this.availabilityCache;
        }
        try {
            await loadCopilotSdk();
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            this.availabilityCache = { available: false, error: `Failed to load Copilot SDK: ${msg}` };
            aiLog.error({ err }, 'Failed to load Copilot SDK ESM module');
            return this.availabilityCache;
        }
        this.streamErrorGuard.install();
        this.availabilityCache = { available: true, sdkPath };
        aiLog.debug({ sdkPath }, 'SDK available');
        return this.availabilityCache;
    }

    public clearAvailabilityCache(): void { this.availabilityCache = null; }

    public static isStreamDestroyedError(errorMessage: string): boolean {
        return isStreamDestroyedError(errorMessage);
    }

    public async createClient(cwd?: string): Promise<CopilotClient> {
        if (this.disposed) throw new Error('CopilotSDKService has been disposed');
        return createSdkClient({ cwd });
    }

    /**
     * Fork an existing SDK session, creating a new session pre-loaded with
     * the full conversation history of the source.
     * @returns The new forked session ID.
     */
    public async forkSession(sdkSessionId: string): Promise<string> {
        if (this.disposed) throw new Error('CopilotSDKService has been disposed');
        const client = await this.createClient();
        try {
            await client.start();
            const result = await (client as any).rpc.sessions.fork({ sessionId: sdkSessionId });
            return result.sessionId;
        } finally {
            await client.stop();
        }
    }

    public async listModels(): Promise<ModelInfo[]> {
        if (this.disposed) throw new Error('CopilotSDKService has been disposed');
        const availability = await this.isAvailable();
        if (!availability.available) throw new Error(availability.error ?? 'Copilot SDK is not available');
        return fetchModelsFromClient(await this.createClient());
    }

    public async sendMessage(options: SendMessageOptions): Promise<SDKInvocationResult> {
        return this.requestRunner.send(options);
    }

    public async abortSession(sessionId: string): Promise<boolean> {
        return this.sessionManager.abort(sessionId);
    }

    /**
     * Soft-abort a running session (Esc+Esc equivalent).
     * Calls session.abort() to stop in-flight work, then the streaming promise
     * settles with a partial result. The session stays alive for potential reuse.
     */
    public async softAbortSession(sessionId: string): Promise<boolean> {
        return this.sessionManager.softAbort(sessionId);
    }

    /**
     * Steer a running session by injecting an immediate message.
     * Returns true if the session was found and the message was sent.
     */
    public async steerSession(sessionId: string, prompt: string): Promise<boolean> {
        const session = this.sessionManager.getSession(sessionId);
        if (!session?.send) return false;
        await session.send({ prompt, mode: 'immediate' });
        return true;
    }

    public hasActiveSession(sessionId: string): boolean { return this.sessionManager.has(sessionId); }

    public getActiveSessionCount(): number { return this.sessionManager.count(); }

    public async cleanup(): Promise<void> {
        const aiLog = getAIServiceLogger();
        aiLog.debug('Cleaning up SDK service');
        await this.sessionManager.abortAll();
        this.streamErrorGuard.remove();
        this.availabilityCache = null;
    }

    public async transform<T = string>(
        prompt: string,
        parse?: (raw: string) => T,
        options?: { model?: string; timeoutMs?: number; cwd?: string },
    ): Promise<T> {
        return this.requestRunner.transform(prompt, parse, options, this.sendMessage.bind(this));
    }

    public dispose(): void {
        this.disposed = true;
        this.streamErrorGuard.remove();
        this.cleanup().catch(() => {});
    }
}

// ============================================================================
// Convenience Functions
// ============================================================================

export function resetCopilotSDKService(): void {
    CopilotSDKService.resetInstance();
}

// Make the default provider available to fresh CLI processes that import Forge
// and then resolve providers through sdkServiceRegistry.
CopilotSDKService.getInstance();
