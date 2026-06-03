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

import type { SendMessageOptions, SystemMessageConfig, TokenUsage } from './types';
import type { ToolEvent } from './types';
import type { ISDKService, IAvailabilityResult, IModelInfo, IInvocationResult } from './sdk-service-interface';
import type { IAccountQuotaResult, IAccountQuotaSnapshot } from './copilot-sdk-service';
import type { ToolCall } from './tool-call';
import { sdkServiceRegistry, CODEX_PROVIDER } from './sdk-service-registry';
import { dynamicImportModule } from './sdk-esm-loader';
import { execFileAsync } from './internal/exec-utils';
import { CocToolRuntime } from './llm-tools/coc-tool-runtime';
import { cocToolBridgeServer } from './llm-tools/bridge-server';
import { buildCocLlmToolsMcpConfig, COC_LLM_TOOLS_MCP_SERVER_NAME } from './llm-tools/mcp-config';
import { isSupportedCodexImagePath } from './image-converter';
import { spawn } from 'child_process';
import { createRequire } from 'module';
import * as readline from 'readline';
import * as path from 'path';
import * as os from 'os';

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
// Runtime module resolution
// ============================================================================

/**
 * Resolves optional runtime dependencies relative to this package instead of
 * the process entrypoint. This keeps globally installed CoC and workspace-linked
 * development installs from resolving against different node_modules trees.
 */
const runtimeRequire = createRequire(__filename);

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
type CodexUserInput = { type: 'text'; text: string } | { type: 'local_image'; path: string };
type CodexInput = string | CodexUserInput[];

interface CodexThread {
    /** Unique ID assigned by the Codex service after the first turn starts. */
    readonly id: string | null;
    /**
     * Run the thread with a prompt, resolving with the completed turn.
     */
    run(input: CodexInput, options?: CodexTurnOptions): Promise<CodexThreadResult>;
    /**
     * Run the thread with a prompt and stream structured events.
     */
    runStreamed(input: CodexInput, options?: CodexTurnOptions): Promise<{ events: AsyncGenerator<CodexThreadEvent> }>;
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

interface CodexUsage {
    input_tokens?: number;
    cached_input_tokens?: number;
    output_tokens?: number;
    reasoning_output_tokens?: number;
}

interface CodexTurnCompletedEvent {
    type: 'turn.completed';
    usage?: CodexUsage;
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

type CodexThreadEvent = CodexThreadStartedEvent | CodexTurnCompletedEvent | CodexTurnFailedEvent | CodexErrorEvent | CodexItemEvent;

interface CodexClient {
    startThread(options?: CodexStartThreadOptions): CodexThread;
    resumeThread(threadId: string, options?: CodexStartThreadOptions): CodexThread;
}

/**
 * Constructor options accepted by the `Codex` client. Only `config` is used by
 * this adapter — to inject `mcp_servers` CLI overrides for the CoC LLM-tool
 * bridge. Mirrors `CodexOptions.config` (a JSON object flattened by the SDK into
 * `--config key=value` TOML overrides).
 */
interface CodexConstructorOptions {
    config?: Record<string, unknown>;
}

/** Constructs a Codex client. The published SDK accepts optional `CodexOptions`. */
type CodexClientCtor = new (options?: CodexConstructorOptions) => CodexClient;

/** Subset of the @openai/codex-sdk API used by this adapter. */
interface CodexSDKModule {
    Codex?: CodexClientCtor;
    default?: { Codex?: CodexClientCtor } | CodexClientCtor;
}

interface CodexStartThreadOptions {
    model?: string;
    workingDirectory?: string;
    additionalDirectories?: string[];
    skipGitRepoCheck?: boolean;
    sandboxMode?: 'read-only' | 'workspace-write' | 'danger-full-access';
    approvalPolicy?: 'never' | 'on-request' | 'on-failure' | 'untrusted';
    networkAccessEnabled?: boolean;
    /** Reasoning level passed to the Codex backend (e.g. 'low', 'medium', 'high', 'xhigh'). */
    reasoningLevel?: string;
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
// Codex app-server RPC response types
// ============================================================================

interface CodexRateLimitWindow {
    usedPercent: number;
    windowDurationMins: number;
    resetsAt: number;
}

interface CodexCredits {
    hasCredits: boolean;
    unlimited: boolean;
    balance: string;
}

interface CodexRateLimitEntry {
    limitId: string;
    limitName: string | null;
    primary: CodexRateLimitWindow;
    secondary: CodexRateLimitWindow;
    credits: CodexCredits;
    planType: string;
    rateLimitReachedType: string | null;
}

interface CodexRateLimitsResult {
    rateLimits: CodexRateLimitEntry;
    rateLimitsByLimitId?: Record<string, CodexRateLimitEntry>;
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
    /** Cached Codex constructor, used to build per-request clients carrying MCP config. */
    private codexCtor: CodexClientCtor | null = null;
    private disposed = false;
    private authChecker: CodexAuthChecker | null = null;

    /** sessionId → active session metadata */
    private readonly sessions = new Map<string, ActiveCodexSession>();

    // ── Auth checker injection (AC-08) ────────────────────────────────────────

    /**
     * Inject an auth checker. When set, `sendMessage` calls it before each
     * request and returns an auth-required error when not authenticated.
     *
     * Host applications can use this to block calls before the Codex SDK is
     * loaded. CoC itself does not inject a checker; Codex CLI/SDK auth is used.
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
            this.codexCtor = CodexCtor;
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
        this.codexCtor = null;
    }

    /**
     * Resolve the Codex client to use for a single request.
     *
     * When the caller supplies CoC LLM tools, those are exposed to Codex through
     * an MCP bridge: a per-invocation {@link CocToolRuntime} is registered on the
     * loopback {@link cocToolBridgeServer}, and a fresh Codex client is built with
     * `config.mcp_servers` pointing at the bridge. The returned `cleanup` disposes
     * the runtime and unregisters the bridge route after the turn — no caching.
     *
     * With no tools (the common case) the shared `this.sdk` client is reused.
     */
    private async resolveRequestClient(
        options: SendMessageOptions,
    ): Promise<{ client: CodexClient; cleanup: () => void }> {
        const tools = options.tools;
        if (!tools || tools.length === 0 || !this.codexCtor) {
            return { client: this.sdk!, cleanup: () => {} };
        }

        const runtime = new CocToolRuntime(tools, { sessionId: options.sessionId });
        const registration = await cocToolBridgeServer.register(runtime);
        const mcpConfig = buildCocLlmToolsMcpConfig({
            endpoint: registration.endpoint,
            token: registration.token,
            enabledTools: Array.from(new Set(tools.map(tool => tool.name).filter(Boolean))),
        });
        const serverConfig = {
            command: mcpConfig.command,
            args: mcpConfig.args,
            env: mcpConfig.env,
            ...(mcpConfig.enabled_tools ? { enabled_tools: mcpConfig.enabled_tools } : {}),
        };
        const client = new this.codexCtor({
            config: {
                mcp_servers: {
                    [COC_LLM_TOOLS_MCP_SERVER_NAME]: serverConfig,
                },
            },
        });
        return {
            client,
            cleanup: () => {
                registration.unregister();
                runtime.dispose();
            },
        };
    }

    // ── Model discovery ───────────────────────────────────────────────────────

    public async listModels(): Promise<IModelInfo[]> {
        if (this.disposed) throw new Error('CodexSDKService has been disposed');
        const avail = await this.isAvailable();
        if (!avail.available) throw new Error(avail.error ?? 'Codex SDK is not available');
        return this.loadModelCatalog();
    }

    private async loadModelCatalog(): Promise<IModelInfo[]> {
        const codexBinPath = this.resolveCodexBinPath();
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

    // ── Account quota via codex app-server RPC ────────────────────────────────

    /**
     * Fetch Codex account quota by spawning `codex app-server` and reading
     * rate limits via JSON-RPC over stdin/stdout.
     */
    public async getAccountQuota(): Promise<IAccountQuotaResult> {
        if (this.disposed) throw new Error('CodexSDKService has been disposed');

        const codexBinPath = this.resolveCodexBinPath();
        const rpcResult = await this.fetchRateLimitsViaRpc(codexBinPath);
        return this.mapRateLimitsToQuota(rpcResult);
    }

    private resolveCodexBinPath(): string {
        try {
            return runtimeRequire.resolve('@openai/codex/bin/codex.js');
        } catch {
            // Older package layouts did not expose the bin file as a resolvable
            // subpath, but did allow resolving package.json.
        }

        try {
            const packageJsonPath = runtimeRequire.resolve('@openai/codex/package.json');
            return path.join(path.dirname(packageJsonPath), 'bin', 'codex.js');
        } catch {
            throw new Error('Codex CLI (@openai/codex) is not installed');
        }
    }

    /** Spawn `codex app-server`, send RPC messages, and return rate limits. */
    private fetchRateLimitsViaRpc(codexBinPath: string): Promise<CodexRateLimitsResult> {
        return new Promise<CodexRateLimitsResult>((resolve, reject) => {
            const child = spawn(process.execPath, [codexBinPath, 'app-server'], {
                stdio: ['pipe', 'pipe', 'ignore'],
                windowsHide: true,
            });

            const rl = readline.createInterface({ input: child.stdout! });
            let settled = false;

            const cleanup = () => {
                if (settled) return;
                settled = true;
                rl.close();
                child.kill('SIGTERM');
            };

            const timer = setTimeout(() => {
                cleanup();
                reject(new Error('Codex app-server RPC timed out'));
            }, 10_000);

            child.on('error', (err) => {
                clearTimeout(timer);
                cleanup();
                reject(err);
            });

            child.on('exit', () => {
                clearTimeout(timer);
                if (!settled) {
                    settled = true;
                    reject(new Error('Codex app-server exited before returning rate limits'));
                }
            });

            rl.on('line', (line) => {
                try {
                    const msg = JSON.parse(line) as { id?: number; result?: unknown; error?: { message?: string } };
                    // Wait for the rateLimits response (id: 2)
                    if (msg.id === 2) {
                        clearTimeout(timer);
                        if (msg.error) {
                            cleanup();
                            reject(new Error(msg.error.message ?? 'Codex RPC error'));
                        } else {
                            cleanup();
                            resolve(msg.result as CodexRateLimitsResult);
                        }
                    }
                } catch {
                    // Ignore non-JSON lines
                }
            });

            const send = (msg: Record<string, unknown>) => {
                child.stdin!.write(JSON.stringify(msg) + '\n');
            };

            send({
                method: 'initialize',
                id: 0,
                params: {
                    clientInfo: { name: 'coc', title: 'Copilot of Copilot', version: '0.1.0' },
                },
            });
            send({ method: 'initialized', params: {} });
            send({ method: 'account/rateLimits/read', id: 2, params: {} });
        });
    }

    /** Map Codex rate limits response to the IAccountQuotaResult format. */
    private mapRateLimitsToQuota(result: CodexRateLimitsResult): IAccountQuotaResult {
        return mapCodexRateLimitsToQuota(result);
    }

    private buildCodexInput(options: SendMessageOptions): CodexInput {
        const text = this.applyCodexSystemMessage(options.prompt ?? '', options.systemMessage);
        const imagePaths = (options.attachments ?? [])
            .filter(attachment => attachment.type === 'file' && isSupportedCodexImagePath(attachment.path))
            .map(attachment => attachment.path);

        if (imagePaths.length === 0) return text;

        return [
            ...(text ? [{ type: 'text' as const, text }] : []),
            ...imagePaths.map(imagePath => ({ type: 'local_image' as const, path: imagePath })),
        ];
    }

    /**
     * Codex's `ThreadOptions` has no native system-prompt field, so honour
     * `SendMessageOptions.systemMessage` by prepending the content to the user
     * prompt. Both `append` and `replace` modes use the same prepend format.
     */
    private applyCodexSystemMessage(prompt: string, systemMessage?: SystemMessageConfig): string {
        if (!systemMessage?.content) return prompt;
        return `[System instructions]:\n${systemMessage.content}\n\n${prompt}`;
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
                    : 'Codex (ChatGPT) authentication required. Run the Codex executable sign-in flow.';
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
        // Releases the per-invocation CoC LLM-tool MCP bridge (no-op when no tools).
        let mcpCleanup: () => void = () => {};

        try {
            // Resolve the client for this request. With CoC LLM tools present this
            // builds a fresh client carrying the bridge's mcp_servers config.
            const effectiveModel = this.normalizeCodexModel(options.model);
            const { client: sdk, cleanup } = await this.resolveRequestClient(options);
            mcpCleanup = cleanup;

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
            let tokenUsage: TokenUsage | undefined;
            const streamed = await thread.runStreamed(this.buildCodexInput(options), { signal: abortController.signal });

            for await (const event of streamed.events) {
                if (event.type === 'thread.started') {
                    notifySessionCreated(event.thread_id);
                    continue;
                }
                if (event.type === 'turn.completed') {
                    tokenUsage = addCodexUsage(tokenUsage, event.usage);
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
                ...(tokenUsage ? { tokenUsage } : {}),
                effectiveModel,
                ...(toolCalls.size > 0 ? { toolCalls: Array.from(toolCalls.values()) } : {}),
            } as IInvocationResult;
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return { success: false, error: message, sessionId: options.sessionId ?? threadId, effectiveModel: this.normalizeCodexModel(options.model) };
        } finally {
            signalCleanup?.();
            mcpCleanup();
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
        const additionalDirectories = this.resolveCodexAdditionalDirectories(options);
        return {
            ...(model ? { model } : {}),
            ...(options.workingDirectory ? { workingDirectory: options.workingDirectory } : {}),
            ...(additionalDirectories.length ? { additionalDirectories } : {}),
            ...(options.reasoningEffort ? { reasoningLevel: options.reasoningEffort } : {}),
            skipGitRepoCheck: true,
            ...this.resolveCodexModeOptions(options.mode),
        };
    }

    /**
     * Builds the list of directories Codex may access beyond its working
     * directory. Always includes `~/.coc` (CoC's data/skills dir) so out-of-repo
     * skill and data files are reachable, plus any caller-provided skill or
     * additional directories. Caller-provided paths are preserved verbatim;
     * `~/.coc` is only appended when not already present (compared
     * case-insensitively on Windows).
     */
    private resolveCodexAdditionalDirectories(options: SendMessageOptions): string[] {
        const dirs = [
            ...(options.skillDirectories ?? []),
            ...(options.additionalDirectories ?? []),
        ].filter((dir): dir is string => !!dir);

        const cocDir = path.join(os.homedir(), '.coc');
        const sameDir = (a: string, b: string): boolean => {
            const ra = path.resolve(a);
            const rb = path.resolve(b);
            return process.platform === 'win32' ? ra.toLowerCase() === rb.toLowerCase() : ra === rb;
        };
        if (!dirs.some(dir => sameDir(dir, cocDir))) {
            dirs.push(cocDir);
        }
        return dirs;
    }

    private resolveCodexModeOptions(
        mode: SendMessageOptions['mode'],
    ): Pick<CodexStartThreadOptions, 'approvalPolicy' | 'sandboxMode' | 'networkAccessEnabled'> {
        if (mode === 'plan' || mode === 'autopilot') {
            return {
                approvalPolicy: 'never',
                sandboxMode: 'danger-full-access',
                networkAccessEnabled: true,
            };
        }
        // Interactive (ask) mode is constrained at the prompt level by
        // READ_ONLY_SYSTEM_MESSAGE, which permits writing only the plan file,
        // the attached note file, and .goal.md specs. Use `workspace-write` so
        // those permitted writes (within the workspace and additionalDirectories
        // such as ~/.coc) succeed, while network access stays disabled.
        return {
            approvalPolicy: 'never',
            sandboxMode: 'workspace-write',
            networkAccessEnabled: false,
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
        this.codexCtor = null;
    }

    public dispose(): void {
        this.disposed = true;
        this.cleanup().catch(() => {});
    }
}

// ============================================================================
// Mapping helpers (testable without spawning a process)
// ============================================================================

function emptyCodexTokenUsage(): TokenUsage {
    return {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        totalTokens: 0,
        turnCount: 0,
    };
}

function codexUsageNumber(value: number | undefined): number {
    return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function addCodexUsage(current: TokenUsage | undefined, usage: CodexUsage | undefined): TokenUsage | undefined {
    if (!usage) return current;

    const result = current ? { ...current } : emptyCodexTokenUsage();
    result.inputTokens += codexUsageNumber(usage.input_tokens);
    result.outputTokens += codexUsageNumber(usage.output_tokens);
    result.cacheReadTokens += codexUsageNumber(usage.cached_input_tokens);
    result.totalTokens = result.inputTokens + result.outputTokens;
    result.turnCount += 1;
    return result;
}

/** Map a Codex rate limits RPC response to the IAccountQuotaResult format. */
export function mapCodexRateLimitsToQuota(result: CodexRateLimitsResult): IAccountQuotaResult {
    const snapshots: Record<string, IAccountQuotaSnapshot> = {};
    const entries = result.rateLimitsByLimitId
        ? Object.entries(result.rateLimitsByLimitId)
        : [[result.rateLimits.limitId || 'codex', result.rateLimits] as const];

    for (const [limitId, entry] of entries) {
        const primary = entry.primary;
        const remaining = Math.max(0, Math.min(1, (100 - primary.usedPercent) / 100));
        const resetDate = primary.resetsAt
            ? new Date(primary.resetsAt * 1000).toISOString()
            : undefined;

        snapshots[limitId] = {
            isUnlimitedEntitlement: entry.credits?.unlimited ?? false,
            entitlementRequests: 100,
            usedRequests: primary.usedPercent,
            remainingPercentage: remaining,
            usageAllowedWithExhaustedQuota: entry.credits?.hasCredits ?? false,
            overage: 0,
            resetDate,
        };
    }

    return { quotaSnapshots: snapshots };
}

// ============================================================================
// Registration helper
// ============================================================================

/**
 * Register a new `CodexSDKService` instance under `'codex'` in the module-
 * level `sdkServiceRegistry`. CoC registers this at server startup so live
 * config can enable Codex without recreating server infrastructure.
 *
 * @param authChecker Optional host-provided auth checker. When provided,
 *   sendMessage gates on auth status before loading the Codex SDK.
 * @returns The newly created service instance.
 */
export function registerCodexSDKService(authChecker?: CodexAuthChecker): CodexSDKService {
    const svc = new CodexSDKService();
    if (authChecker) svc.setAuthChecker(authChecker);
    sdkServiceRegistry.register(CODEX_PROVIDER, svc);
    return svc;
}
