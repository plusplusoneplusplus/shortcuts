/**
 * Claude SDK Service
 *
 * Implements ISDKService backed by the optional `@anthropic-ai/claude-agent-sdk` package.
 * When the package is not installed the service reports itself as unavailable
 * and all method calls return appropriate error results rather than throwing.
 *
 * Session mapping
 * ─────────────────────────
 * CoC persists Claude Code session IDs returned by the SDK. New sessions are
 * created with a caller-visible UUID, and follow-up calls pass that UUID back to
 * Claude Code via `resume` so the transcript is restored by the provider.
 * Active sessions also map to an AbortController used to cancel in-flight
 * queries.
 *
 * Optional peer dependency
 * ─────────────────────────
 * `@anthropic-ai/claude-agent-sdk` is declared as an optional peer dependency.
 * The module is loaded lazily with a try/catch so the rest of the SDK works
 * fine without it.
 *
 * Authentication detection
 * ─────────────────────────
 * Claude credentials are managed entirely outside CoC (via the `claude` CLI or
 * the `@anthropic-ai/claude-agent-sdk` SDK's own auth mechanism). CoC does not store
 * or retrieve any Anthropic API key or OAuth token. Availability checks detect
 * whether Claude auth exists on the server without touching the credentials
 * themselves.
 */

import type { SendMessageOptions } from './types';
import type { ToolEvent } from './types';
import type { ISDKService, IAvailabilityResult, IModelInfo, IInvocationResult } from './sdk-service-interface';
import type { IAccountQuotaResult, IAccountQuotaSnapshot } from './copilot-sdk-service';
import type { ToolCall } from './tool-call';
import { sdkServiceRegistry, CLAUDE_PROVIDER } from './sdk-service-registry';
import { dynamicImportModule } from './sdk-esm-loader';
import { getSDKLogger } from './logger';
import * as crypto from 'crypto';

// ============================================================================
// @anthropic-ai/claude-agent-sdk type stubs
// These mirror the streaming query API published by the package.
// Kept here so the file compiles without the optional peer dependency.
// ============================================================================

interface ClaudeTextBlock {
    type: 'text';
    text: string;
}

interface ClaudeToolUseBlock {
    type: 'tool_use';
    id: string;
    name: string;
    input: unknown;
}

type ClaudeContentBlock = ClaudeTextBlock | ClaudeToolUseBlock;

interface ClaudeAssistantMessage {
    type: 'assistant';
    message: {
        content: ClaudeContentBlock[];
    };
    session_id?: string;
}

interface ClaudeResultMessage {
    type: 'result';
    subtype: 'success' | 'error_max_turns' | 'error_during_execution';
    result?: string;
    is_error?: boolean;
    /** Total cost of the request in USD */
    total_cost_usd?: number;
    /** Total input/output token counts */
    usage?: {
        input_tokens?: number;
        output_tokens?: number;
        cache_creation_input_tokens?: number;
        cache_read_input_tokens?: number;
    };
    session_id?: string;
}

interface ClaudeSystemMessage {
    type: 'system';
    subtype: string;
    session_id?: string;
    [key: string]: unknown;
}

export interface ClaudeRateLimitInfo {
    status: 'allowed' | 'allowed_warning' | 'rejected';
    resetsAt?: number;
    rateLimitType?: 'five_hour' | 'seven_day' | 'seven_day_opus' | 'seven_day_sonnet' | 'overage' | string;
    utilization?: number;
    overageStatus?: 'allowed' | 'allowed_warning' | 'rejected';
    overageResetsAt?: number;
    isUsingOverage?: boolean;
    surpassedThreshold?: number;
}

interface ClaudeRateLimitEvent {
    type: 'rate_limit_event';
    rate_limit_info: ClaudeRateLimitInfo;
    session_id?: string;
}

type ClaudeSDKMessage = ClaudeAssistantMessage | ClaudeResultMessage | ClaudeSystemMessage | ClaudeRateLimitEvent | Record<string, unknown>;
type ClaudePermissionMode = 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan' | 'dontAsk' | 'auto';

interface ClaudeQueryOptions {
    prompt: string;
    abortController?: AbortController;
    options?: {
        cwd?: string;
        model?: string;
        customSystemPrompt?: string;
        appendSystemPrompt?: string;
        permissionMode?: ClaudePermissionMode;
        allowDangerouslySkipPermissions?: boolean;
        /** Resume a persisted Claude Code transcript session. */
        resume?: string;
        /** Use a stable UUID for a newly-created Claude Code transcript session. */
        sessionId?: string;
    };
}

/**
 * Account information returned by the SDK's accountInfo() control method.
 * Available on the Query handle returned by the claude-agent-sdk query() function.
 */
export interface ClaudeAccountInfo {
    email?: string;
    organization?: string;
    subscriptionType?: string;
    tokenSource?: string;
    apiKeySource?: string;
    apiProvider?: string;
}

/**
 * The real SDK's query() return value extends AsyncGenerator with extra control
 * methods (accountInfo, interrupt, etc.).
 */
interface ClaudeQueryHandle extends AsyncIterable<ClaudeSDKMessage> {
    accountInfo?(): Promise<ClaudeAccountInfo>;
    supportedModels?(): Promise<Array<{ value?: string; displayName?: string; description?: string }>>;
    return?(value?: unknown): Promise<{ done: true; value: unknown }>;
}

interface ClaudeSDKModule {
    query?: (options: ClaudeQueryOptions) => ClaudeQueryHandle;
    forkSession?: (sessionId: string, options?: { dir?: string }) => Promise<{ sessionId: string }>;
    default?: {
        query?: (options: ClaudeQueryOptions) => ClaudeQueryHandle;
        forkSession?: (sessionId: string, options?: { dir?: string }) => Promise<{ sessionId: string }>;
    } | ((options: ClaudeQueryOptions) => ClaudeQueryHandle);
}

// ============================================================================
// Internal active-session record
// ============================================================================

interface ActiveClaudeSession {
    sessionId: string;
    abortController: AbortController;
}

// ============================================================================
// ClaudeSDKService
// ============================================================================

const CLAUDE_AGENT_SDK_PACKAGE = '@anthropic-ai/claude-agent-sdk';

/**
 * Provider for the optional `@anthropic-ai/claude-agent-sdk` package.
 * Registered under the `'claude'` key in `SDKServiceRegistry`.
 *
 * Construction is cheap — no SDK is loaded until the first call to
 * `isAvailable()` or `sendMessage()`.
 */
export class ClaudeSDKService implements ISDKService {
    private availabilityCache: IAvailabilityResult | null = null;
    private queryFn: ((options: ClaudeQueryOptions) => ClaudeQueryHandle) | null = null;
    private forkSessionFn: ((sessionId: string, options?: { dir?: string }) => Promise<{ sessionId: string }>) | null = null;
    private lastRateLimitInfo: ClaudeRateLimitInfo | null = null;
    private lastAccountInfo: ClaudeAccountInfo | null = null;
    private disposed = false;

    /** sessionId → active session metadata (request/active-session state only) */
    private readonly sessions = new Map<string, ActiveClaudeSession>();

    // ── Availability ─────────────────────────────────────────────────────────

    public async isAvailable(): Promise<IAvailabilityResult> {
        if (this.disposed) return { available: false, error: 'ClaudeSDKService has been disposed' };
        if (this.availabilityCache) return this.availabilityCache;

        try {
            const mod = await dynamicImportModule<ClaudeSDKModule>(CLAUDE_AGENT_SDK_PACKAGE);
            const queryFn = this.resolveQueryFn(mod);
            if (!queryFn) {
                throw new Error(
                    `${CLAUDE_AGENT_SDK_PACKAGE} loaded but did not export a \`query\` function. ` +
                    'Ensure you have a compatible version installed:\n' +
                    `  npm install ${CLAUDE_AGENT_SDK_PACKAGE}`,
                );
            }
            this.queryFn = queryFn;
            this.forkSessionFn = this.resolveForkSessionFn(mod) ?? null;
            this.availabilityCache = { available: true };
        } catch (err) {
            const isNotInstalled = err instanceof Error && (
                err.message.includes('Cannot find module') ||
                err.message.includes('MODULE_NOT_FOUND')
            );
            if (isNotInstalled) {
                this.availabilityCache = {
                    available: false,
                    error:
                        'Claude Agent SDK not installed. To enable Claude, run:\n' +
                        `  npm install ${CLAUDE_AGENT_SDK_PACKAGE}\n` +
                        'Then authenticate with `claude` and restart CoC.',
                };
            } else {
                const msg = err instanceof Error ? err.message : String(err);
                this.availabilityCache = {
                    available: false,
                    error: `Claude Agent SDK failed to load: ${msg}\n` +
                        `Ensure ${CLAUDE_AGENT_SDK_PACKAGE} is installed and \`claude\` is authenticated.`,
                };
            }
        }
        return this.availabilityCache;
    }

    private resolveQueryFn(
        mod: ClaudeSDKModule,
    ): ((options: ClaudeQueryOptions) => ClaudeQueryHandle) | undefined {
        if (typeof mod.query === 'function') return mod.query;
        if (typeof mod.default === 'function') {
            return mod.default as unknown as (options: ClaudeQueryOptions) => ClaudeQueryHandle;
        }
        if (mod.default && typeof (mod.default as { query?: unknown }).query === 'function') {
            return (mod.default as { query: (options: ClaudeQueryOptions) => ClaudeQueryHandle }).query;
        }
        return undefined;
    }

    private resolveForkSessionFn(
        mod: ClaudeSDKModule,
    ): ((sessionId: string, options?: { dir?: string }) => Promise<{ sessionId: string }>) | undefined {
        if (typeof mod.forkSession === 'function') return mod.forkSession;
        if (mod.default && typeof mod.default !== 'function' && typeof mod.default.forkSession === 'function') {
            return mod.default.forkSession;
        }
        return undefined;
    }

    public clearAvailabilityCache(): void {
        this.availabilityCache = null;
        this.queryFn = null;
        this.forkSessionFn = null;
        this.lastRateLimitInfo = null;
        this.lastAccountInfo = null;
    }

    // ── Model discovery ───────────────────────────────────────────────────────

    /**
     * Return available Claude models from the SDK control API when possible.
     * Falls back to a curated baseline list if dynamic model discovery fails.
     */
    public async listModels(): Promise<IModelInfo[]> {
        if (this.disposed) throw new Error('ClaudeSDKService has been disposed');
        const avail = await this.isAvailable();
        if (!avail.available) throw new Error(avail.error ?? 'Claude Code SDK is not available');

        const fallbackModels: IModelInfo[] = [
            { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6' },
            { id: 'claude-opus-4-7', name: 'Claude Opus 4.7' },
            { id: 'claude-opus-4-6', name: 'Claude Opus 4.6' },
            { id: 'claude-haiku-4-5', name: 'Claude Haiku 4.5' },
            { id: 'claude-provider-default', name: 'Claude Provider Default' },
        ];

        const queryFn = this.queryFn;
        if (!queryFn) return fallbackModels;

        try {
            const handle = queryFn({ prompt: '' });
            const sdkModels = await handle.supportedModels?.();
            await handle.return?.();

            if (!sdkModels || sdkModels.length === 0) return fallbackModels;

            const mapped = sdkModels
                .map(model => {
                    const value = model.value?.trim();
                    const displayName = model.displayName?.trim();
                    if (!value || !displayName) return null;
                    return { id: value, name: displayName } as IModelInfo;
                })
                .filter((model): model is IModelInfo => model !== null);

            return mapped.length > 0 ? mapped : fallbackModels;
        } catch {
            return fallbackModels;
        }
    }

    // ── Account quota from Claude rate-limit events ───────────────────────────

    public async getAccountQuota(): Promise<IAccountQuotaResult> {
        if (this.disposed) throw new Error('ClaudeSDKService has been disposed');
        const avail = await this.isAvailable();
        if (!avail.available) throw new Error(avail.error ?? 'Claude Code SDK is not available');
        if (this.lastRateLimitInfo) return mapClaudeRateLimitInfoToQuota(this.lastRateLimitInfo);
        if (this.lastAccountInfo) return mapClaudeAccountInfoToQuota(this.lastAccountInfo);
        return { quotaSnapshots: {} };
    }

    // ── Message dispatch ──────────────────────────────────────────────────────

    public async sendMessage(options: SendMessageOptions): Promise<IInvocationResult> {
        if (this.disposed) return { success: false, error: 'ClaudeSDKService has been disposed' };

        if (options.signal?.aborted) {
            return { success: false, error: 'Request aborted', sessionId: options.sessionId };
        }

        const avail = await this.isAvailable();
        if (!avail.available) {
            return { success: false, error: avail.error };
        }

        const queryFn = this.queryFn!;
        const sessionId = options.sessionId ?? crypto.randomUUID();
        let currentSessionId = sessionId;
        const abortController = new AbortController();

        // Propagate caller's AbortSignal into our internal controller.
        let signalCleanup: (() => void) | undefined;
        if (options.signal) {
            const onAbort = () => abortController.abort();
            options.signal.addEventListener('abort', onAbort);
            signalCleanup = () => options.signal!.removeEventListener('abort', onAbort);
        }

        this.sessions.set(sessionId, { sessionId, abortController });

        // Notify caller of session ID immediately so abort can be wired up.
        options.onSessionCreated?.(sessionId);

        const chunks: string[] = [];
        const toolCalls = new Map<string, ToolCall>();
        const startedToolCalls = new Set<string>();

        const publishProviderSessionId = (providerSessionId: string | undefined) => {
            if (!providerSessionId || providerSessionId === currentSessionId) return;
            const active = this.sessions.get(currentSessionId);
            if (active) {
                this.sessions.delete(currentSessionId);
                active.sessionId = providerSessionId;
                this.sessions.set(providerSessionId, active);
            }
            currentSessionId = providerSessionId;
            options.onSessionCreated?.(providerSessionId);
        };

        try {
            const model = this.normalizeClaudeModel(options.model);
            const permissionOptions = this.resolveClaudePermissionOptions(options.mode);
            const queryOptions: ClaudeQueryOptions = {
                prompt: options.prompt ?? '',
                abortController,
                options: {
                    ...(options.workingDirectory ? { cwd: options.workingDirectory } : {}),
                    ...(model ? { model } : {}),
                    ...(options.systemMessage?.mode === 'append' ? { appendSystemPrompt: options.systemMessage.content } : {}),
                    ...(options.systemMessage?.mode === 'replace' ? { customSystemPrompt: options.systemMessage.content } : {}),
                    ...(options.sessionId ? { resume: options.sessionId } : { sessionId }),
                    ...permissionOptions,
                },
            };

            const handle = queryFn(queryOptions);
            handle.accountInfo?.().then(info => { this.lastAccountInfo = info; }).catch(() => {});
            for await (const msg of handle) {
                if (abortController.signal.aborted) break;
                publishProviderSessionId(this.extractSessionId(msg));
                if (this.isAssistantMessage(msg)) {
                    for (const block of msg.message.content) {
                        if (block.type === 'text') {
                            chunks.push(block.text);
                            options.onStreamingChunk?.(block.text);
                        } else if (block.type === 'tool_use') {
                            this.handleClaudeToolUse(block, options, toolCalls, startedToolCalls);
                        }
                    }
                } else if (this.isResultMessage(msg)) {
                    if (msg.subtype !== 'success' || msg.is_error) {
                        const errText = typeof msg.result === 'string' && msg.result
                            ? msg.result
                            : `Claude returned ${msg.subtype}`;
                        return {
                            success: false,
                            error: errText,
                            sessionId: currentSessionId,
                        };
                    }
                    // If the result contains text not yet emitted, add it.
                    if (typeof msg.result === 'string' && msg.result && chunks.join('') === '') {
                        chunks.push(msg.result);
                        options.onStreamingChunk?.(msg.result);
                    }
                } else if (this.isRateLimitEvent(msg)) {
                    getSDKLogger().debug(
                        '[ClaudeQuota] session rate_limit_event — status=%s type=%s utilization=%s',
                        msg.rate_limit_info.status,
                        msg.rate_limit_info.rateLimitType ?? '(none)',
                        msg.rate_limit_info.utilization ?? msg.rate_limit_info.surpassedThreshold ?? '(none)',
                    );
                    this.lastRateLimitInfo = msg.rate_limit_info;
                }
            }

            // Empty chunk signals end-of-stream.
            options.onStreamingChunk?.('');

            return {
                success: true,
                response: chunks.join(''),
                sessionId: currentSessionId,
                ...(toolCalls.size > 0 ? { toolCalls: Array.from(toolCalls.values()) } : {}),
            } as IInvocationResult;
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return { success: false, error: message, sessionId: currentSessionId };
        } finally {
            signalCleanup?.();
            this.sessions.delete(currentSessionId);
            if (currentSessionId !== sessionId) this.sessions.delete(sessionId);
        }
    }

    private extractSessionId(msg: ClaudeSDKMessage): string | undefined {
        if (typeof msg !== 'object' || msg === null) return undefined;
        const sessionId = (msg as Record<string, unknown>).session_id;
        return typeof sessionId === 'string' && sessionId.trim() ? sessionId : undefined;
    }

    private isAssistantMessage(msg: ClaudeSDKMessage): msg is ClaudeAssistantMessage {
        return (
            typeof msg === 'object' &&
            msg !== null &&
            (msg as Record<string, unknown>).type === 'assistant' &&
            typeof (msg as ClaudeAssistantMessage).message === 'object' &&
            Array.isArray((msg as ClaudeAssistantMessage).message.content)
        );
    }

    private isResultMessage(msg: ClaudeSDKMessage): msg is ClaudeResultMessage {
        return (
            typeof msg === 'object' &&
            msg !== null &&
            (msg as Record<string, unknown>).type === 'result'
        );
    }

    private isRateLimitEvent(msg: ClaudeSDKMessage): msg is ClaudeRateLimitEvent {
        return (
            typeof msg === 'object' &&
            msg !== null &&
            (msg as Record<string, unknown>).type === 'rate_limit_event' &&
            typeof (msg as ClaudeRateLimitEvent).rate_limit_info === 'object' &&
            (msg as ClaudeRateLimitEvent).rate_limit_info !== null
        );
    }

    private handleClaudeToolUse(
        block: ClaudeToolUseBlock,
        options: SendMessageOptions,
        toolCalls: Map<string, ToolCall>,
        startedToolCalls: Set<string>,
    ): void {
        const id = block.id ?? crypto.randomUUID();
        const toolName = block.name ?? 'unknown_tool';
        const parameters = (typeof block.input === 'object' && block.input !== null)
            ? (block.input as Record<string, unknown>)
            : {};

        if (!startedToolCalls.has(id)) {
            startedToolCalls.add(id);
            const now = new Date();
            toolCalls.set(id, {
                id,
                name: toolName,
                status: 'running',
                startTime: now,
                args: parameters,
            });
            this.emitToolEvent(options, {
                type: 'tool-start',
                toolCallId: id,
                toolName,
                parameters,
            });
        }

        // Claude Code SDK emits tool_use blocks in assistant messages when the tool
        // completes. Mark it complete immediately.
        const existing = toolCalls.get(id);
        if (existing) {
            existing.status = 'completed';
            existing.endTime = new Date();
        }
        this.emitToolEvent(options, {
            type: 'tool-complete',
            toolCallId: id,
            toolName,
            result: JSON.stringify(parameters),
        });
    }

    private emitToolEvent(options: SendMessageOptions, event: ToolEvent): void {
        try {
            options.onToolEvent?.(event);
        } catch {
            // Tool events are observational; never fail the Claude turn because
            // a caller-side renderer/cache handler threw.
        }
    }

    /**
     * Normalize model ID for Claude Code.
     *
     * CoC's shared model registry uses dotted marketing IDs such as
     * `claude-sonnet-4.6`, while Claude Code expects the CLI model form
     * `claude-sonnet-4-6`. Translate that narrow alias shape at the provider
     * boundary so stored process metadata and UI preferences can remain
     * provider-agnostic.
     */
    private normalizeClaudeModel(model: string | undefined): string | undefined {
        if (!model) return undefined;
        const trimmed = model.trim();
        if (!trimmed) return undefined;
        const normalized = trimmed.toLowerCase();
        if (normalized === 'claude-provider-default' || normalized === 'provider-default') {
            return undefined;
        }
        const dottedMarketingId = normalized.match(/^claude-(sonnet|opus|haiku)-(\d+)\.(\d+)$/);
        if (dottedMarketingId) {
            const [, family, major, minor] = dottedMarketingId;
            return `claude-${family}-${major}-${minor}`;
        }
        // Only pass through Claude model IDs; reject Copilot/Codex model IDs.
        if (normalized.startsWith('claude')) return trimmed;
        return undefined;
    }

    private resolveClaudePermissionOptions(
        mode: SendMessageOptions['mode'],
    ): Pick<NonNullable<ClaudeQueryOptions['options']>, 'permissionMode' | 'allowDangerouslySkipPermissions'> {
        if (mode === 'autopilot') {
            return {
                permissionMode: 'bypassPermissions',
                allowDangerouslySkipPermissions: true,
            };
        }
        if (mode === 'plan') {
            return { permissionMode: 'plan' };
        }
        return {};
    }

    public async transform<T = string>(
        prompt: string,
        parse?: (raw: string) => T,
        options?: { model?: string; timeoutMs?: number; cwd?: string },
    ): Promise<T> {
        const result = await this.sendMessage({
            prompt,
            model: options?.model,
            workingDirectory: options?.cwd,
        });
        if (!result.success) throw new Error(result.error ?? 'Claude transform failed');
        const raw = result.response ?? '';
        return (parse ? parse(raw) : raw) as T;
    }

    // ── Session management ────────────────────────────────────────────────────

    public async forkSession(sessionId: string): Promise<string> {
        if (this.disposed) throw new Error('ClaudeSDKService has been disposed');
        const avail = await this.isAvailable();
        if (!avail.available) throw new Error(avail.error ?? 'Claude Code SDK is not available');
        if (!this.forkSessionFn) {
            throw new Error(
                'ClaudeSDKService cannot fork sessions because the installed ' +
                `${CLAUDE_AGENT_SDK_PACKAGE} package does not export forkSession.`,
            );
        }
        const result = await this.forkSessionFn(sessionId);
        return result.sessionId;
    }

    public async abortSession(sessionId: string): Promise<boolean> {
        const session = this.sessions.get(sessionId);
        if (!session) return false;
        session.abortController.abort();
        this.sessions.delete(sessionId);
        return true;
    }

    public async softAbortSession(sessionId: string): Promise<boolean> {
        // Claude Code SDK does not distinguish soft from hard abort.
        return this.abortSession(sessionId);
    }

    public async steerSession(_sessionId: string, _prompt: string): Promise<boolean> {
        // Steering is not supported by the Claude Code SDK.
        return false;
    }

    public hasActiveSession(sessionId: string): boolean {
        return this.sessions.has(sessionId);
    }

    public getActiveSessionCount(): number {
        return this.sessions.size;
    }

    // ── Lifecycle ─────────────────────────────────────────────────────────────

    public async cleanup(): Promise<void> {
        for (const [, session] of this.sessions) {
            session.abortController.abort();
        }
        this.sessions.clear();
        this.availabilityCache = null;
        this.queryFn = null;
        this.forkSessionFn = null;
        this.lastRateLimitInfo = null;
        this.lastAccountInfo = null;
    }

    public dispose(): void {
        this.disposed = true;
        this.cleanup().catch(() => {});
    }
}

// ============================================================================
// Registration helper
// ============================================================================

/**
 * Register a new `ClaudeSDKService` instance under `'claude'` in the module-
 * level `sdkServiceRegistry`. Call this once during server startup, regardless
 * of whether `claude.enabled` is true — live config gates actual usage.
 *
 * @returns The newly created service instance.
 */
export function registerClaudeSDKService(): ClaudeSDKService {
    const svc = new ClaudeSDKService();
    sdkServiceRegistry.register(CLAUDE_PROVIDER, svc);
    return svc;
}

export function mapClaudeRateLimitInfoToQuota(info: ClaudeRateLimitInfo): IAccountQuotaResult {
    const quotaType = info.rateLimitType && info.rateLimitType.trim() ? info.rateLimitType : 'claude';
    return {
        quotaSnapshots: {
            [quotaType]: mapClaudeRateLimitSnapshot(info),
        },
    };
}

/**
 * Build a synthetic "subscription active, well under all thresholds" snapshot
 * from Claude's `accountInfo()`. Used as a fallback when no `rate_limit_event`
 * has been observed yet (i.e. the user is comfortably under every utilisation
 * threshold), so the UI still shows Claude as a real provider instead of
 * hiding it entirely.
 *
 * The snapshot key is derived from `subscriptionType` (e.g. `pro`, `max`,
 * `team`, `enterprise`, `claude_pro`, `claude_max`, `free`) and falls back to
 * the API provider for 3P-auth setups (`bedrock`, `vertex`, etc.). When
 * neither is known the generic `subscription` key is used.
 *
 * The numeric fields encode "0 of 100 used, 100% remaining" so the UI shows a
 * full-green bar — accurate, since the absence of a `rate_limit_event`
 * implies utilisation is below every warning threshold.
 */
export function mapClaudeAccountInfoToQuota(info: ClaudeAccountInfo): IAccountQuotaResult {
    const subscription = info.subscriptionType?.trim();
    const provider = info.apiProvider?.trim();
    const quotaType = subscription && subscription.length > 0
        ? subscription
        : provider && provider.length > 0 && provider !== 'firstParty'
            ? provider
            : 'subscription';
    return {
        quotaSnapshots: {
            [quotaType]: {
                isUnlimitedEntitlement: false,
                entitlementRequests: 100,
                usedRequests: 0,
                usageAllowedWithExhaustedQuota: false,
                remainingPercentage: 1,
                overage: 0,
            },
        },
    };
}

function mapClaudeRateLimitSnapshot(info: ClaudeRateLimitInfo): IAccountQuotaSnapshot {
    const utilization = normalizeUtilization(info.utilization ?? info.surpassedThreshold, info.status);
    const entitlementRequests = 100;
    const usedRequests = Math.round(utilization * entitlementRequests);
    const resetDate = toResetDate(info.resetsAt);
    const usageAllowedWithExhaustedQuota = info.isUsingOverage === true
        || info.overageStatus === 'allowed'
        || info.overageStatus === 'allowed_warning';
    return {
        isUnlimitedEntitlement: false,
        entitlementRequests,
        usedRequests,
        usageAllowedWithExhaustedQuota,
        remainingPercentage: clamp01(1 - utilization),
        overage: Math.max(0, usedRequests - entitlementRequests),
        ...(resetDate ? { resetDate } : {}),
    };
}

function normalizeUtilization(value: number | undefined, status: ClaudeRateLimitInfo['status']): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        return status === 'rejected' ? 1 : 0;
    }
    return clamp01(value > 1 ? value / 100 : value);
}

function clamp01(value: number): number {
    if (value < 0) return 0;
    if (value > 1) return 1;
    return value;
}

function toResetDate(value: number | undefined): string | undefined {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return undefined;
    const millis = value < 10_000_000_000 ? value * 1000 : value;
    const date = new Date(millis);
    return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}
