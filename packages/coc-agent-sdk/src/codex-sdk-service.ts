/**
 * Codex SDK Service
 *
 * Implements ISDKService backed by the optional `@openai/codex-sdk` package.
 * When the package is not installed the service reports itself as unavailable
 * and all method calls return appropriate error results rather than throwing.
 *
 * Thread ↔ session mapping
 * ─────────────────────────
 * Every CoC session ID maps to exactly one Codex thread ID. The mapping is
 * created on the first `sendMessage` call for a session and removed when the
 * session is aborted or the service is disposed.
 *
 * Optional peer dependency
 * ─────────────────────────
 * `@openai/codex-sdk` is declared as an optional peer dependency of forge.
 * The module is loaded lazily with a try/catch so forge works fine without it.
 */

import type { SendMessageOptions } from './types';
import type { ToolEvent } from './types';
import type { ISDKService, IAvailabilityResult, IModelInfo, IInvocationResult } from './sdk-service-interface';
import type { ToolCall } from './tool-call';
import { sdkServiceRegistry, CODEX_PROVIDER } from './sdk-service-registry';
import { dynamicImportModule } from './sdk-esm-loader';
import { execFileAsync } from './internal/exec-utils';
import * as path from 'path';

// ============================================================================
// Install mode detection
// ============================================================================

/**
 * Returns true when forge is running from a global npm install.
 * When installed globally, __dirname contains 'node_modules'.
 */
function isGlobalInstall(): boolean {
    return __dirname.includes('node_modules');
}

// ============================================================================
// Dynamic require.resolve (webpack-safe)
// ============================================================================

/**
 * Resolves a module path at runtime without webpack statically analysing it.
 * Uses the same `new Function` indirection as `dynamicImportModule` in
 * sdk-esm-loader.ts so that webpack does not attempt to bundle optional
 * peer dependencies that may not be installed.
 */
// eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func
const dynamicRequireResolve = new Function('m', 'return require.resolve(m)') as (m: string) => string;

// ============================================================================
// Auth checker injection (AC-08)
// ============================================================================

/**
 * Result returned by the injected auth checker.
 * When `authenticated` is false, `sendMessage` immediately returns an error
 * that includes `authUrl` so the caller can surface a sign-in link.
 */
export interface CodexAuthCheckResult {
    authenticated: boolean;
    /** URL the user should open to authenticate (populated when not authenticated). */
    authUrl?: string;
}

/** Injectable callback used by `CodexSDKService.sendMessage` to gate requests. */
export type CodexAuthChecker = () => CodexAuthCheckResult;

// ============================================================================
// @openai/codex-sdk type stubs
// These mirror the thread-based agent API described in the integration spec.
// They are kept here rather than imported so the file compiles without the
// optional peer dependency being installed.
// ============================================================================

/** A running Codex thread that can be used to send messages and stream output. */
interface CodexThread {
    /** Unique ID assigned by the Codex service after the first turn starts. */
    readonly id: string | null;
    /**
     * Run the thread with a prompt, resolving with the completed turn.
     */
    run(input: string, options?: CodexTurnOptions): Promise<CodexThreadResult>;
    /**
     * Run the thread with a prompt and stream structured events.
     */
    runStreamed(input: string, options?: CodexTurnOptions): Promise<{ events: AsyncGenerator<CodexThreadEvent> }>;
}

interface CodexTurnOptions {
    signal?: AbortSignal;
}

interface CodexThreadResult {
    finalResponse: string;
}

interface CodexThreadStartedEvent {
    type: 'thread.started';
    thread_id: string;
}

interface CodexTurnFailedEvent {
    type: 'turn.failed';
    error?: { message?: string };
}

interface CodexErrorEvent {
    type: 'error';
    message?: string;
}

interface CodexItemEvent {
    type: 'item.started' | 'item.updated' | 'item.completed';
    item?: {
        id?: string;
        type?: string;
        text?: string;
        command?: string;
        aggregated_output?: string;
        exit_code?: number;
        status?: string;
        changes?: Array<{ path?: string; kind?: string }>;
        server?: string;
        tool?: string;
        arguments?: unknown;
        result?: unknown;
        error?: { message?: string };
        query?: string;
    };
}

type CodexThreadEvent = CodexThreadStartedEvent | CodexTurnFailedEvent | CodexErrorEvent | CodexItemEvent;

interface CodexClient {
    startThread(options?: CodexStartThreadOptions): CodexThread;
    resumeThread(threadId: string, options?: CodexStartThreadOptions): CodexThread;
}

/** Subset of the @openai/codex-sdk API used by this adapter. */
interface CodexSDKModule {
    Codex?: new () => CodexClient;
    default?: { Codex?: new () => CodexClient } | (new () => CodexClient);
}

interface CodexStartThreadOptions {
    model?: string;
    workingDirectory?: string;
    skipGitRepoCheck?: boolean;
    sandboxMode?: 'read-only' | 'workspace-write' | 'danger-full-access';
    approvalPolicy?: 'never' | 'on-request' | 'on-failure' | 'untrusted';
    networkAccessEnabled?: boolean;
}

interface CodexCatalogModel {
    slug?: unknown;
    display_name?: unknown;
    visibility?: unknown;
    default_reasoning_level?: unknown;
    supported_reasoning_levels?: unknown;
}

interface CodexReasoningLevel {
    effort?: unknown;
}

// ============================================================================
// Internal active-session record
// ============================================================================

interface ActiveCodexSession {
    threadId: string;
    abortController: AbortController;
}

// ============================================================================
// CodexSDKService
// ============================================================================

/**
 * Provider for the optional `@openai/codex-sdk` package.
 * Registered under the `'codex'` key in `SDKServiceRegistry`.
 *
 * Construction is cheap — no SDK is loaded until the first call to
 * `isAvailable()` or `sendMessage()`.
 */
export class CodexSDKService implements ISDKService {
    private availabilityCache: IAvailabilityResult | null = null;
    private sdk: CodexClient | null = null;
    private disposed = false;
    private authChecker: CodexAuthChecker | null = null;

    /** sessionId → active session metadata */
    private readonly sessions = new Map<string, ActiveCodexSession>();

    // ── Auth checker injection (AC-08) ────────────────────────────────────────

    /**
     * Inject an auth checker. When set, `sendMessage` calls it before each
     * request and returns an auth-required error when not authenticated.
     *
     * Called once during server startup by the codex-auth infrastructure
     * when `codex.enabled` is true.
     */
    public setAuthChecker(checker: CodexAuthChecker): void {
        this.authChecker = checker;
    }

    public clearAuthChecker(): void {
        this.authChecker = null;
    }

    // ── Availability ─────────────────────────────────────────────────────────

    public async isAvailable(): Promise<IAvailabilityResult> {
        if (this.disposed) return { available: false, error: 'CodexSDKService has been disposed' };
        if (this.availabilityCache) return this.availabilityCache;
        try {
            const mod = await dynamicImportModule('@openai/codex-sdk');
            const sdkModule = mod as CodexSDKModule;
            const CodexCtor = sdkModule.Codex
                ?? (typeof sdkModule.default === 'function' ? sdkModule.default : sdkModule.default?.Codex);
            if (!CodexCtor) {
                throw new Error('Codex SDK did not export Codex');
            }
            this.sdk = new CodexCtor();
            this.availabilityCache = { available: true };
        } catch {
            const installCmd = isGlobalInstall()
                ? 'npm install -g @openai/codex-sdk'
                : 'npm install @openai/codex-sdk --no-save  # run from the repo root';
            this.availabilityCache = {
                available: false,
                error:
                    'Codex SDK not installed (~239 MB). To enable Codex, run:\n' +
                    `  ${installCmd}\n` +
                    'Then restart CoC.',
            };
        }
        return this.availabilityCache;
    }

    public clearAvailabilityCache(): void {
        this.availabilityCache = null;
        this.sdk = null;
    }

    // ── Model discovery ───────────────────────────────────────────────────────

    public async listModels(): Promise<IModelInfo[]> {
        if (this.disposed) throw new Error('CodexSDKService has been disposed');
        const avail = await this.isAvailable();
        if (!avail.available) throw new Error(avail.error ?? 'Codex SDK is not available');
        return this.loadModelCatalog();
    }

    private async loadModelCatalog(): Promise<IModelInfo[]> {
        const packageJsonPath = dynamicRequireResolve('@openai/codex/package.json');
        const codexBinPath = path.join(path.dirname(packageJsonPath), 'bin', 'codex.js');
        const { stdout } = await execFileAsync(process.execPath, [codexBinPath, 'debug', 'models'], {
            timeout: 30_000,
            maxBuffer: 50 * 1024 * 1024,
        });
        const parsed = JSON.parse(stdout) as { models?: unknown };
        if (!Array.isArray(parsed.models)) return [];
        const models = parsed.models
            .map(model => this.mapCatalogModel(model as CodexCatalogModel))
            .filter((model): model is IModelInfo => model !== undefined);
        if (models.length > 0) return models;
        return [{ id: 'codex-default', name: 'Codex Provider Default' }];
    }

    private mapCatalogModel(model: CodexCatalogModel): IModelInfo | undefined {
        if (typeof model.slug !== 'string' || !model.slug) return undefined;
        if (model.visibility !== 'list') return undefined;
        const supportedReasoningEfforts = this.normalizeReasoningLevels(model.supported_reasoning_levels);
        const defaultReasoningEffort = typeof model.default_reasoning_level === 'string'
            && supportedReasoningEfforts.includes(model.default_reasoning_level)
            ? model.default_reasoning_level
            : undefined;
        return {
            id: model.slug,
            name: typeof model.display_name === 'string' && model.display_name ? model.display_name : model.slug,
            capabilities: {
                supports: {
                    vision: false,
                    reasoningEffort: supportedReasoningEfforts.length > 0,
                    reasoning_effort: supportedReasoningEfforts,
                },
                limits: { max_context_window_tokens: 0 },
            },
            supportedReasoningEfforts,
            ...(defaultReasoningEffort ? { defaultReasoningEffort } : {}),
        } as IModelInfo;
    }

    private normalizeReasoningLevels(value: unknown): string[] {
        if (!Array.isArray(value)) return [];
        const efforts = new Set<string>();
        for (const level of value as CodexReasoningLevel[]) {
            if (typeof level.effort === 'string' && level.effort) {
                efforts.add(level.effort);
            }
        }
        return ['minimal', 'low', 'medium', 'high', 'xhigh'].filter(effort => efforts.has(effort));
    }

    // ── Message dispatch ──────────────────────────────────────────────────────

    public async sendMessage(options: SendMessageOptions): Promise<IInvocationResult> {
        if (this.disposed) return { success: false, error: 'CodexSDKService has been disposed' };

        // AC-08: Check authentication before proceeding. When the auth checker
        // reports unauthenticated, return a structured error with an authUrl so
        // the caller can surface a sign-in link — no silent fallback to Copilot.
        if (this.authChecker) {
            const authResult = this.authChecker();
            if (!authResult.authenticated) {
                const authMsg = authResult.authUrl
                    ? `Codex (ChatGPT) authentication required. Sign in at: ${authResult.authUrl}`
                    : 'Codex (ChatGPT) authentication required. Use POST /api/codex-auth/start to sign in.';
                return {
                    success: false,
                    error: authMsg,
                    sessionId: options.sessionId,
                };
            }
        }

        if (options.signal?.aborted) {
            return { success: false, error: 'Request aborted', sessionId: options.sessionId };
        }

        const avail = await this.isAvailable();
        if (!avail.available) {
            return { success: false, error: avail.error };
        }

        const sdk = this.sdk!;
        const abortController = new AbortController();

        // Propagate caller's AbortSignal into our internal controller so
        // abortSession() and the caller's signal both terminate the thread.
        let signalCleanup: (() => void) | undefined;
        if (options.signal) {
            const onAbort = () => abortController.abort();
            options.signal.addEventListener('abort', onAbort);
            signalCleanup = () => options.signal!.removeEventListener('abort', onAbort);
        }

        let threadId: string | undefined;
        let sessionCreatedNotified = false;
        const toolCalls = new Map<string, ToolCall>();
        const startedToolCalls = new Set<string>();

        try {
            let thread: CodexThread;
            const threadOptions = this.buildThreadOptions(options);
            if (options.sessionId) {
                // options.sessionId is the Codex thread ID persisted from the previous
                // request via onSessionCreated — resume the existing conversation.
                thread = sdk.resumeThread(options.sessionId, threadOptions);
            } else {
                thread = sdk.startThread(threadOptions);
            }

            const notifySessionCreated = (id: string) => {
                if (sessionCreatedNotified) return;
                threadId = id;
                this.sessions.set(id, { threadId: id, abortController });
                options.onSessionCreated?.(id);
                sessionCreatedNotified = true;
            };

            if (thread.id) notifySessionCreated(thread.id);

            const chunks: string[] = [];
            const streamed = await thread.runStreamed(options.prompt ?? '', { signal: abortController.signal });

            for await (const event of streamed.events) {
                if (event.type === 'thread.started') {
                    notifySessionCreated(event.thread_id);
                    continue;
                }
                if (event.type === 'turn.failed') {
                    throw new Error(event.error?.message ?? 'Codex turn failed');
                }
                if (event.type === 'error') {
                    throw new Error(event.message ?? 'Codex stream error');
                }
                if (event.type === 'item.started') {
                    this.handleCodexToolItem(event.item, 'started', options, toolCalls, startedToolCalls);
                    continue;
                }
                if (event.type === 'item.completed') {
                    if (event.item?.type === 'agent_message' && event.item.text) {
                        chunks.push(event.item.text);
                        options.onStreamingChunk?.(event.item.text);
                        continue;
                    }
                    this.handleCodexToolItem(event.item, 'completed', options, toolCalls, startedToolCalls);
                    continue;
                }
            }

            if (!sessionCreatedNotified && thread.id) notifySessionCreated(thread.id);

            // Empty chunk signals end-of-stream to the executor's streaming consumer.
            options.onStreamingChunk?.('');

            return {
                success: true,
                response: chunks.join(''),
                sessionId: threadId,
                ...(toolCalls.size > 0 ? { toolCalls: Array.from(toolCalls.values()) } : {}),
            } as IInvocationResult;
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return { success: false, error: message, sessionId: options.sessionId ?? threadId };
        } finally {
            signalCleanup?.();
            if (threadId) this.sessions.delete(threadId);
        }
    }

    private handleCodexToolItem(
        item: CodexItemEvent['item'] | undefined,
        phase: 'started' | 'completed',
        options: SendMessageOptions,
        toolCalls: Map<string, ToolCall>,
        startedToolCalls: Set<string>,
    ): void {
        const normalized = this.normalizeCodexToolItem(item);
        if (!normalized) return;

        if (phase === 'started') {
            if (startedToolCalls.has(normalized.id)) return;
            startedToolCalls.add(normalized.id);
            const now = new Date();
            toolCalls.set(normalized.id, {
                id: normalized.id,
                name: normalized.toolName,
                status: 'running',
                startTime: now,
                args: normalized.parameters,
            });
            this.emitToolEvent(options, {
                type: 'tool-start',
                toolCallId: normalized.id,
                toolName: normalized.toolName,
                parameters: normalized.parameters,
            });
            return;
        }

        if (!startedToolCalls.has(normalized.id)) {
            this.handleCodexToolItem(item, 'started', options, toolCalls, startedToolCalls);
        }

        const existing = toolCalls.get(normalized.id);
        const endTime = new Date();
        if (existing) {
            existing.status = normalized.error ? 'failed' : 'completed';
            existing.endTime = endTime;
            existing.args = normalized.parameters;
            if (normalized.error) {
                existing.error = normalized.error;
            } else {
                existing.result = normalized.result;
            }
        }

        this.emitToolEvent(options, normalized.error
            ? {
                type: 'tool-failed',
                toolCallId: normalized.id,
                toolName: normalized.toolName,
                error: normalized.error,
            }
            : {
                type: 'tool-complete',
                toolCallId: normalized.id,
                toolName: normalized.toolName,
                result: normalized.result,
            });
    }

    private emitToolEvent(options: SendMessageOptions, event: ToolEvent): void {
        try {
            options.onToolEvent?.(event);
        } catch {
            // Tool events are observational; never fail the Codex turn because
            // a caller-side renderer/cache handler threw.
        }
    }

    private normalizeCodexToolItem(item: CodexItemEvent['item'] | undefined): {
        id: string;
        toolName: string;
        parameters: Record<string, unknown>;
        result?: string;
        error?: string;
    } | undefined {
        if (!item?.type || !item.id) return undefined;
        switch (item.type) {
            case 'command_execution': {
                const command = typeof item.command === 'string' ? item.command : '';
                const output = typeof item.aggregated_output === 'string' ? item.aggregated_output : '';
                const failed = item.status === 'failed';
                return {
                    id: item.id,
                    toolName: 'shell',
                    parameters: { command },
                    ...(failed ? { error: output || `Command failed${typeof item.exit_code === 'number' ? ` with exit code ${item.exit_code}` : ''}` } : { result: output }),
                };
            }
            case 'file_change': {
                const changes = Array.isArray(item.changes) ? item.changes : [];
                const failed = item.status === 'failed';
                return {
                    id: item.id,
                    toolName: 'apply_patch',
                    parameters: { changes },
                    ...(failed ? { error: 'File change failed' } : { result: this.summarizeFileChanges(changes) }),
                };
            }
            case 'mcp_tool_call': {
                const tool = typeof item.tool === 'string' && item.tool ? item.tool : 'mcp_tool';
                const server = typeof item.server === 'string' ? item.server : undefined;
                const error = item.error?.message;
                return {
                    id: item.id,
                    toolName: tool,
                    parameters: {
                        ...(server ? { server } : {}),
                        arguments: item.arguments ?? {},
                    },
                    ...(error ? { error } : { result: this.stringifyCodexResult(item.result) }),
                };
            }
            case 'web_search': {
                const query = typeof item.query === 'string' ? item.query : '';
                return {
                    id: item.id,
                    toolName: 'web_search',
                    parameters: { query },
                    result: query ? `Searched: ${query}` : 'Search completed',
                };
            }
            default:
                return undefined;
        }
    }

    private summarizeFileChanges(changes: Array<{ path?: string; kind?: string }>): string {
        if (changes.length === 0) return 'File changes applied';
        const byKind = new Map<string, string[]>();
        for (const change of changes) {
            const kind = typeof change.kind === 'string' ? change.kind : 'update';
            const filePath = typeof change.path === 'string' ? change.path : '(unknown)';
            byKind.set(kind, [...(byKind.get(kind) ?? []), filePath]);
        }
        return Array.from(byKind.entries())
            .map(([kind, paths]) => `${kind}: ${paths.join(', ')}`)
            .join('\n');
    }

    private stringifyCodexResult(result: unknown): string | undefined {
        if (result == null) return undefined;
        if (typeof result === 'string') return result;
        if (typeof result === 'object' && Array.isArray((result as { content?: unknown }).content)) {
            const parts = ((result as { content: Array<{ type?: string; text?: string }> }).content)
                .map(block => typeof block.text === 'string' ? block.text : undefined)
                .filter((text): text is string => !!text);
            if (parts.length > 0) return parts.join('\n');
        }
        try {
            return JSON.stringify(result);
        } catch {
            return String(result);
        }
    }

    private buildThreadOptions(options: SendMessageOptions): CodexStartThreadOptions {
        const model = this.normalizeCodexModel(options.model);
        return {
            ...(model ? { model } : {}),
            ...(options.workingDirectory ? { workingDirectory: options.workingDirectory } : {}),
            skipGitRepoCheck: true,
            approvalPolicy: 'never',
            sandboxMode: 'danger-full-access',
            networkAccessEnabled: true,
        };
    }

    private normalizeCodexModel(model: string | undefined): string | undefined {
        if (!model) return undefined;
        const normalized = model.toLowerCase();
        if (normalized === 'codex-default' || normalized === 'provider-default') {
            return undefined;
        }
        // CoC per-repo defaults are shared with Copilot. Do not pass provider-
        // specific Copilot model IDs through to Codex, because ChatGPT-backed
        // Codex accounts reject them before the turn starts.
        if (normalized.startsWith('claude') || normalized.startsWith('gemini')) {
            return undefined;
        }
        return model;
    }

    public async transform<T = string>(
        prompt: string,
        parse?: (raw: string) => T,
        options?: { model?: string; timeoutMs?: number; cwd?: string },
    ): Promise<T> {
        const result = await this.sendMessage({ prompt, model: options?.model });
        if (!result.success) throw new Error(result.error ?? 'Codex transform failed');
        const raw = result.response ?? '';
        return (parse ? parse(raw) : raw) as T;
    }

    // ── Session management ────────────────────────────────────────────────────

    public async forkSession(sessionId: string): Promise<string> {
        if (this.disposed) throw new Error('CodexSDKService has been disposed');

        const avail = await this.isAvailable();
        if (!avail.available) throw new Error(avail.error ?? 'Codex SDK is not available');

        const sdk = this.sdk!;
        // sessionId IS the Codex thread ID (persisted from a previous sendMessage
        // via onSessionCreated). The Codex SDK does not expose fork semantics,
        // so return a resumable thread handle for the same persisted thread.
        const forkedThread = sdk.resumeThread(sessionId, { skipGitRepoCheck: true });
        const newThreadId = forkedThread.id ?? sessionId;
        this.sessions.set(newThreadId, {
            threadId: newThreadId,
            abortController: new AbortController(),
        });
        return newThreadId;
    }

    public async abortSession(sessionId: string): Promise<boolean> {
        const session = this.sessions.get(sessionId);
        if (!session) return false;
        session.abortController.abort();
        this.sessions.delete(sessionId);
        return true;
    }

    public async softAbortSession(sessionId: string): Promise<boolean> {
        // Codex threads do not distinguish soft from hard abort; use the same path.
        return this.abortSession(sessionId);
    }

    public async steerSession(_sessionId: string, _prompt: string): Promise<boolean> {
        // Thread steering is not exposed by the Codex SDK; no-op.
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
        this.sdk = null;
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
 * Register a new `CodexSDKService` instance under `'codex'` in the module-
 * level `sdkServiceRegistry`. Call this once during server startup when the
 * `codex.enabled` feature flag is true.
 *
 * @param authChecker Optional auth checker injected by the codex-auth
 *   infrastructure (AC-08). When provided, sendMessage gates on auth status.
 * @returns The newly created service instance.
 */
export function registerCodexSDKService(authChecker?: CodexAuthChecker): CodexSDKService {
    const svc = new CodexSDKService();
    if (authChecker) svc.setAuthChecker(authChecker);
    sdkServiceRegistry.register(CODEX_PROVIDER, svc);
    return svc;
}
