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
import { getAIServiceLogger } from './logger';
import { createSdkClient } from './sdk-client-factory';
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
import type { ISDKService, TransformOptions, TransformResult, PrewarmOptions } from './sdk-service-interface';
import { sdkServiceRegistry, COPILOT_PROVIDER } from './sdk-service-registry';
import { WarmClientRegistry, makeWarmKey, WarmClientFactory } from './warm-client-registry';
import type { WarmStateChangeListener, WarmStatus } from './warm-client-registry';
import { WarmStatusBroadcaster } from './warm-status-broadcaster';
import { runWithWarmClient } from './warm-client-runner';
import { resolveWarmClientTtlMs } from './warm-client-config';

const DEFAULT_AI_TIMEOUT_MS = 6 * 60 * 60 * 1000;
const DEFAULT_AI_IDLE_TIMEOUT_MS = 60 * 60 * 1000;

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

export { tryConvertImageFileToDataUrl, tryReadImageAsBase64 } from './image-converter';

export interface IAccountQuotaSnapshot {
    isUnlimitedEntitlement: boolean;
    entitlementRequests: number;
    usedRequests: number;
    usageAllowedWithExhaustedQuota: boolean;
    remainingPercentage: number;
    overage: number;
    resetDate?: string;
}

export interface IAccountQuotaResult {
    quotaSnapshots: Record<string, IAccountQuotaSnapshot>;
}

export class CopilotSDKService implements ISDKService {
    private static instance: CopilotSDKService | null = null;

    private availabilityCache: SDKAvailabilityResult | null = null;
    private disposed = false;

    private readonly sessionManager = new SessionManager();
    private readonly streamErrorGuard = new StreamErrorGuard();
    private readonly requestRunner: RequestRunner;
    private readonly warmRegistry: WarmClientRegistry;
    /** Fan-out for warm-client state transitions to external observers (e.g. SSE bridge). */
    private readonly warmStatus = new WarmStatusBroadcaster();

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
        this.warmRegistry = new WarmClientRegistry({
            ttlMs: resolveWarmClientTtlMs(),
            logger: getAIServiceLogger(),
            onStateChange: this.warmStatus.emit,
        });
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
        return createSdkClient({ workingDirectory: cwd });
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

    public async getAccountQuota(gitHubToken?: string): Promise<IAccountQuotaResult> {
        if (this.disposed) throw new Error('CopilotSDKService has been disposed');
        const availability = await this.isAvailable();
        if (!availability.available) throw new Error(availability.error ?? 'Copilot SDK is not available');
        const client = await this.createClient();
        try {
            await client.start();
            const params = gitHubToken ? { gitHubToken } : {};
            const result = await (client as any).rpc.account.getQuota(params);
            return result as IAccountQuotaResult;
        } finally {
            await client.stop();
        }
    }

    public async sendMessage(options: SendMessageOptions): Promise<SDKInvocationResult> {
        // Cold path: the turn did not opt into warming, warming is disabled
        // (TTL <= 0), or the caller supplied its own client (it owns that
        // lifecycle). One-shot jobs (transform/title-gen) never set keepWarm, so
        // they always land here.
        if (!options.keepWarm || !this.warmRegistry.warmingEnabled || options.client) {
            return this.requestRunner.send(options);
        }
        if (!options.warmKey) {
            getAIServiceLogger().warn(
                { provider: COPILOT_PROVIDER, workingDirectory: options.workingDirectory },
                'Warm client requested without warmKey; running cold',
            );
            return this.requestRunner.send(options);
        }
        return this.sendWarm(options);
    }

    /**
     * Run a warm-eligible turn: reuse the live client process for this
     * `(provider, warmKey)` when one is parked, otherwise cold-start
     * and park it for the next turn. The client is injected as
     * `options.client` so `RequestRunner` skips `client.stop()` — a fresh
     * session is still created/resumed and disconnected per turn, so
     * conversation continuity is unaffected.
     */
    private async sendWarm(options: SendMessageOptions): Promise<SDKInvocationResult> {
        const aiLog = getAIServiceLogger();
        const key = makeWarmKey(COPILOT_PROVIDER, options.warmKey);

        return runWithWarmClient({
            registry: this.warmRegistry,
            key,
            factory: this.buildWarmFactory(options.workingDirectory),
            logger: aiLog,
            coldFallback: () => this.requestRunner.send(options),
            run: async (handle, warmHit) => {
                aiLog.debug(
                    { key, provider: COPILOT_PROVIDER, warmKey: options.warmKey, workingDirectory: options.workingDirectory, warmHit },
                    warmHit ? 'Warm client hit — reusing live process' : 'Warm client miss — cold start',
                );
                const result = await this.requestRunner.send({
                    ...options,
                    client: handle.client as CopilotClient,
                });
                // Keep the client warm only on a clean, un-aborted success;
                // abort/interrupt/error tears it down.
                const keepWarm = result.success === true && options.signal?.aborted !== true;
                return { result, keepWarm };
            },
        });
    }

    /**
     * Build the warm-client factory for a working directory. Shared by
     * {@link sendWarm} (cold-miss path) and {@link prewarm} so both spin up an
     * identical client under the same key — guaranteeing a prewarmed process is
     * reused by the next send rather than duplicated.
     */
    private buildWarmFactory(workingDirectory?: string): WarmClientFactory {
        return async () => {
            const client = await this.createClient(workingDirectory);
            // Spawn/connect the process eagerly so the warm client is truly warm
            // (start() is idempotent and is otherwise lazily called by the first
            // createSession()).
            await client.start();
            return { client, stop: async () => { await client.stop(); } };
        };
    }

    /**
     * Pre-warm the Copilot client process for the next turn without creating a
     * session (AC-04). Idempotent and best-effort: no-ops when warming is
     * disabled (TTL <= 0), when the SDK is unavailable, or while a turn is in
     * flight on the same key (handled by the registry). The client is parked
     * under `makeWarmKey(COPILOT_PROVIDER, warmKey)` so the next
     * {@link sendMessage} reuses it; a send arriving mid-warm attaches to the
     * in-flight warming.
     */
    public async prewarm(options: PrewarmOptions): Promise<void> {
        if (this.disposed || !this.warmRegistry.warmingEnabled) return;
        if (!options.warmKey) {
            getAIServiceLogger().warn(
                { provider: COPILOT_PROVIDER, workingDirectory: options.workingDirectory },
                'Prewarm requested without warmKey; skipping',
            );
            return;
        }
        const availability = await this.isAvailable();
        if (!availability.available) return;
        const key = makeWarmKey(COPILOT_PROVIDER, options.warmKey);
        await this.warmRegistry.prewarm(key, this.buildWarmFactory(options.workingDirectory));
    }

    /**
     * Current warm {@link WarmStatus} for a conversation's `(copilot, warmKey)` key —
     * the synchronous snapshot read used by the CoC SSE bridge to emit an initial
     * warm-status frame. Uses the same key as {@link prewarm}, so a freshly
     * subscribed stream sees the live state (`warm`/`active`/`warming`/`cold`).
     */
    public getWarmStatus(options: PrewarmOptions): WarmStatus {
        if (!options.warmKey) return 'cold';
        return this.warmRegistry.getStatus(makeWarmKey(COPILOT_PROVIDER, options.warmKey));
    }

    /**
     * Subscribe to warm-client state transitions for this service's registry.
     * The listener receives `(key, status)` on every change, where `key` is
     * `makeWarmKey(COPILOT_PROVIDER, warmKey)`. Used by the CoC SSE
     * bridge to push warm status to the SPA indicator. Returns an unsubscribe
     * function.
     */
    public onWarmStatusChange(listener: WarmStateChangeListener): () => void {
        return this.warmStatus.subscribe(listener);
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
        // Stop every warm client so no provider child process outlives the service.
        await this.warmRegistry.evictAll();
        // Drop warm-status subscribers so no bridge holds a stale service reference.
        this.warmStatus.clear();
        this.streamErrorGuard.remove();
        this.availabilityCache = null;
    }

    public async transform(
        input: string,
        options?: TransformOptions,
    ): Promise<TransformResult> {
        return this.requestRunner.transform(input, options, this.sendMessage.bind(this));
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
