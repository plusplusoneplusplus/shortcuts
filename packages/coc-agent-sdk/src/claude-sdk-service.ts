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

import type { SendMessageOptions, MCPServerConfig, MCPLocalServerConfig, ReasoningEffort } from './types';
import type { ToolEvent } from './types';
import type { ISDKService, IAvailabilityResult, IModelInfo, IInvocationResult } from './sdk-service-interface';
import type { IAccountQuotaResult, IAccountQuotaSnapshot } from './copilot-sdk-service';
import type { ToolCall } from './tool-call';
import type { ClaudeImageSource } from './image-converter';
import { sdkServiceRegistry, CLAUDE_PROVIDER } from './sdk-service-registry';
import { dynamicImportModule } from './sdk-esm-loader';
import { getSDKLogger } from './logger';
import { CocToolRuntime } from './llm-tools/coc-tool-runtime';
import { cocToolBridgeServer } from './llm-tools/bridge-server';
import { buildCocLlmToolsMcpConfig, COC_LLM_TOOLS_MCP_SERVER_NAME } from './llm-tools/mcp-config';
import { tryReadImageAsBase64 } from './image-converter';
import { spawn } from 'child_process';
import { createRequire } from 'module';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as readline from 'readline';

// ============================================================================
// @anthropic-ai/claude-agent-sdk type stubs
// These mirror the streaming query API published by the package.
// Kept here so the file compiles without the optional peer dependency.
// ============================================================================

interface ClaudeTextBlock {
    type: 'text';
    text: string;
}

interface ClaudeImageBlock {
    type: 'image';
    source: {
        type: 'base64';
        media_type: ClaudeImageSource['media_type'];
        data: string;
    };
}

interface ClaudeToolUseBlock {
    type: 'tool_use';
    id: string;
    name: string;
    input: unknown;
}

interface ClaudeToolResultBlock {
    type: 'tool_result';
    tool_use_id: string;
    content?: unknown;
    is_error?: boolean;
}

type ClaudeContentBlock = ClaudeTextBlock | ClaudeToolUseBlock | ClaudeToolResultBlock | Record<string, unknown>;

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

interface ClaudeUserMessage {
    type: 'user';
    message?: {
        content?: unknown;
    };
    parent_tool_use_id?: string | null;
    tool_use_result?: unknown;
    session_id?: string;
}

interface ClaudeStreamingUserMessage {
    type: 'user';
    message: {
        role: 'user';
        content: Array<ClaudeTextBlock | ClaudeImageBlock>;
    };
    parent_tool_use_id: null;
    session_id?: string;
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

type ClaudeSDKMessage = ClaudeAssistantMessage | ClaudeUserMessage | ClaudeResultMessage | ClaudeSystemMessage | ClaudeRateLimitEvent | Record<string, unknown>;
type ClaudePermissionMode = 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan' | 'dontAsk' | 'auto';

/**
 * MCP server config accepted by Claude Code's `query({ options: { mcpServers } })`.
 * Mirrors the published `McpStdioServerConfig | McpHttpServerConfig | McpSSEServerConfig`
 * union (the in-process SDK-server variant is not used here — CoC tools are
 * exposed through the stdio bridge so they round-trip raw JSON Schema).
 */
type ClaudeMcpServerConfig =
    | { type?: 'stdio'; command: string; args?: string[]; env?: Record<string, string>; alwaysLoad?: boolean }
    | { type: 'http'; url: string; headers?: Record<string, string> }
    | { type: 'sse'; url: string; headers?: Record<string, string> };

interface ClaudeQueryOptions {
    prompt: string | AsyncIterable<ClaudeStreamingUserMessage>;
    abortController?: AbortController;
    options?: {
        cwd?: string;
        model?: string;
        /**
         * Reasoning-effort level guiding how much thinking Claude applies.
         * Mirrors the SDK's `EffortLevel`; the SDK silently downgrades a level
         * the selected model does not support. (`'max'` is accepted by the SDK
         * but not yet surfaced by CoC.)
         */
        effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
        /** Extra absolute directories Claude may access beyond `cwd`. */
        additionalDirectories?: string[];
        customSystemPrompt?: string;
        appendSystemPrompt?: string;
        permissionMode?: ClaudePermissionMode;
        allowDangerouslySkipPermissions?: boolean;
        /** Tool names auto-allowed without a permission prompt (CoC bridge tools). */
        allowedTools?: string[];
        /** MCP servers to expose to the Claude Code session (CoC LLM-tool bridge + caller servers). */
        mcpServers?: Record<string, ClaudeMcpServerConfig>;
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
const CLAUDE_MODEL_DISCOVERY_TIMEOUT_MS = 15_000;
/** Reasoning-effort levels CoC forwards to Claude Code's `effort` option. */
const CLAUDE_EFFORT_LEVELS: readonly ReasoningEffort[] = ['low', 'medium', 'high', 'xhigh'];
const runtimeRequire = createRequire(__filename);

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
     * Return available Claude models from Claude Code's stream protocol when possible.
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

        try {
            const cliModels = await this.listModelsViaClaudeCli();
            return cliModels && cliModels.length > 0 ? cliModels : fallbackModels;
        } catch {
            return fallbackModels;
        }
    }

    private async listModelsViaClaudeCli(): Promise<IModelInfo[] | null> {
        const cli = this.resolveClaudeCliCommand();
        return new Promise<IModelInfo[]>((resolve, reject) => {
            const child = spawn(cli.command, [
                ...cli.args,
                '--output-format',
                'stream-json',
                '--verbose',
                '--input-format',
                'stream-json',
                '--setting-sources=',
                '--tools',
                '',
            ], {
                stdio: ['pipe', 'pipe', 'ignore'],
                windowsHide: true,
            });

            if (!child.stdout || !child.stdin) {
                child.kill('SIGTERM');
                reject(new Error('Claude CLI did not expose stdio pipes'));
                return;
            }

            const rl = readline.createInterface({ input: child.stdout });
            let settled = false;

            const cleanup = () => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                rl.close();
                child.stdin?.destroy();
                child.kill('SIGTERM');
            };

            const fail = (err: Error) => {
                cleanup();
                reject(err);
            };

            const succeed = (models: IModelInfo[]) => {
                cleanup();
                resolve(models);
            };

            const timer = setTimeout(() => {
                fail(new Error('Claude model discovery timed out'));
            }, CLAUDE_MODEL_DISCOVERY_TIMEOUT_MS);

            child.on('error', fail);
            child.on('exit', () => {
                if (!settled) fail(new Error('Claude CLI exited before returning model metadata'));
            });

            rl.on('line', (line) => {
                let msg: unknown;
                try {
                    msg = JSON.parse(line);
                } catch {
                    return;
                }

                if (!this.isClaudeInitializeResponse(msg)) return;
                const models = this.mapClaudeCliModels(msg.response.response.models);
                if (!models) {
                    fail(new Error('Claude CLI initialize response did not include valid model metadata'));
                    return;
                }
                succeed(models);
            });

            try {
                child.stdin.write(JSON.stringify({
                    type: 'control_request',
                    request_id: 'init-1',
                    request: { subtype: 'initialize' },
                }) + '\n');
                child.stdin.end();
            } catch (err) {
                fail(err instanceof Error ? err : new Error(String(err)));
            }
        });
    }

    private resolveClaudeCliCommand(): { command: string; args: string[] } {
        const binaryName = process.platform === 'win32' ? 'claude.exe' : 'claude';
        const nativePackageName = `${CLAUDE_AGENT_SDK_PACKAGE}-${process.platform}-${process.arch}`;
        try {
            const packageJsonPath = runtimeRequire.resolve(`${nativePackageName}/package.json`);
            const packageDir = path.dirname(packageJsonPath);
            for (const candidate of [
                path.join(packageDir, binaryName),
                path.join(packageDir, 'bin', binaryName),
            ]) {
                if (fs.existsSync(candidate)) {
                    return { command: candidate, args: [] };
                }
            }
        } catch {
            // Fall through to PATH lookup below.
        }

        return { command: 'claude', args: [] };
    }

    private isClaudeInitializeResponse(msg: unknown): msg is {
        type: 'control_response';
        response: { response: { models: unknown } };
    } {
        if (typeof msg !== 'object' || msg === null) return false;
        const record = msg as Record<string, unknown>;
        if (record.type !== 'control_response') return false;
        const response = record.response;
        if (typeof response !== 'object' || response === null) return false;
        const responseRecord = response as Record<string, unknown>;
        // The Claude CLI nests `request_id` inside `response`; older builds placed
        // it at the top level. Accept the init-1 reply in either location.
        const requestId = record.request_id ?? responseRecord.request_id;
        if (requestId !== 'init-1') return false;
        const nested = responseRecord.response;
        return typeof nested === 'object' && nested !== null && 'models' in nested;
    }

    private mapClaudeCliModels(models: unknown): IModelInfo[] | null {
        if (!Array.isArray(models)) return null;
        const mapped = models
            .map(model => {
                if (typeof model !== 'object' || model === null) return null;
                const record = model as Record<string, unknown>;
                const value = typeof record.value === 'string' ? record.value.trim() : '';
                const displayName = typeof record.displayName === 'string' ? record.displayName.trim() : '';
                if (!value || !displayName) return null;
                return { id: value, name: displayName } as IModelInfo;
            })
            .filter((model): model is IModelInfo => model !== null);
        return mapped.length > 0 ? mapped : null;
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

        // Releases the per-invocation CoC LLM-tool MCP bridge (no-op when no tools).
        let mcpCleanup: () => void = () => {};

        try {
            const model = this.normalizeClaudeModel(options.model);
            const effort = this.normalizeClaudeEffort(options.reasoningEffort);
            const permissionOptions = this.resolveClaudePermissionOptions(options.mode);
            const { servers: mcpServers, allowedTools, cleanup } = await this.buildClaudeMcpServers(options);
            mcpCleanup = cleanup;
            const queryOptions: ClaudeQueryOptions = {
                prompt: this.buildClaudePrompt(options),
                abortController,
                options: {
                    ...(options.workingDirectory ? { cwd: options.workingDirectory } : {}),
                    additionalDirectories: this.resolveAdditionalDirectories(options),
                    ...(model ? { model } : {}),
                    ...(effort ? { effort } : {}),
                    ...(options.systemMessage?.mode === 'append' ? { appendSystemPrompt: options.systemMessage.content } : {}),
                    ...(options.systemMessage?.mode === 'replace' ? { customSystemPrompt: options.systemMessage.content } : {}),
                    ...(Object.keys(mcpServers).length > 0 ? { mcpServers } : {}),
                    ...(allowedTools.length > 0 ? { allowedTools } : {}),
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
                        if (this.isClaudeTextBlock(block)) {
                            chunks.push(block.text);
                            options.onStreamingChunk?.(block.text);
                        } else if (this.isClaudeToolUseBlock(block)) {
                            this.handleClaudeToolUse(block, options, toolCalls, startedToolCalls);
                        }
                    }
                } else if (this.isUserMessage(msg)) {
                    this.handleClaudeUserToolResults(msg, options, toolCalls);
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
            mcpCleanup();
            this.sessions.delete(currentSessionId);
            if (currentSessionId !== sessionId) this.sessions.delete(sessionId);
        }
    }

    private buildClaudePrompt(options: SendMessageOptions): string | AsyncIterable<ClaudeStreamingUserMessage> {
        const text = options.prompt ?? '';
        const images = (options.attachments ?? [])
            .filter(attachment => attachment.type === 'file')
            .map(attachment => tryReadImageAsBase64(attachment.path))
            .filter((image): image is ClaudeImageSource => image !== null);

        if (images.length === 0) return text;

        const content: Array<ClaudeTextBlock | ClaudeImageBlock> = [
            ...(text ? [{ type: 'text' as const, text }] : []),
            ...images.map(image => ({
                type: 'image' as const,
                source: {
                    type: 'base64' as const,
                    media_type: image.media_type,
                    data: image.data,
                },
            })),
        ];
        const message: ClaudeStreamingUserMessage = {
            type: 'user',
            message: { role: 'user', content },
            parent_tool_use_id: null,
        };

        return (async function* () {
            yield message;
        })();
    }

    /**
     * Build the `mcpServers` map for the Claude Code session.
     *
     * Combines any caller-provided `options.mcpServers` (normalized from forge's
     * MCP config shape to Claude Code's) with the CoC LLM-tool bridge: when the
     * caller supplies CoC tools, a per-invocation {@link CocToolRuntime} is
     * registered on the loopback {@link cocToolBridgeServer} and exposed as a
     * stdio MCP server (`alwaysLoad: true` so the tools are not deferred behind
     * tool search). The returned `cleanup` disposes the runtime and unregisters
     * the bridge route after the turn — no caching.
     */
    private async buildClaudeMcpServers(
        options: SendMessageOptions,
    ): Promise<{ servers: Record<string, ClaudeMcpServerConfig>; allowedTools: string[]; cleanup: () => void }> {
        const servers: Record<string, ClaudeMcpServerConfig> = {};

        if (options.mcpServers) {
            for (const [name, cfg] of Object.entries(options.mcpServers)) {
                const mapped = mapForgeMcpServerToClaude(cfg);
                if (mapped) servers[name] = mapped;
            }
        }

        const tools = options.tools;
        if (!tools || tools.length === 0) {
            return { servers, allowedTools: [], cleanup: () => {} };
        }

        const runtime = new CocToolRuntime(tools, { sessionId: options.sessionId });
        const registration = await cocToolBridgeServer.register(runtime);
        const mcpConfig = buildCocLlmToolsMcpConfig({
            endpoint: registration.endpoint,
            token: registration.token,
        });
        servers[COC_LLM_TOOLS_MCP_SERVER_NAME] = {
            type: 'stdio',
            command: mcpConfig.command,
            args: mcpConfig.args,
            env: mcpConfig.env,
            alwaysLoad: true,
        };
        // Pre-approve CoC's own first-party tools so Claude Code does not prompt
        // for (or block) them — parity with Copilot, which runs the same bundle
        // without permission prompts. Each tool is allowed under its namespaced
        // MCP name (`mcp__<server>__<tool>`).
        const allowedTools = runtime.listTools().map(
            tool => `mcp__${COC_LLM_TOOLS_MCP_SERVER_NAME}__${tool.name}`,
        );
        return {
            servers,
            allowedTools,
            cleanup: () => {
                registration.unregister();
                runtime.dispose();
            },
        };
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

    private isClaudeTextBlock(block: ClaudeContentBlock): block is ClaudeTextBlock {
        return (
            typeof block === 'object' &&
            block !== null &&
            (block as Record<string, unknown>).type === 'text' &&
            typeof (block as Record<string, unknown>).text === 'string'
        );
    }

    private isClaudeToolUseBlock(block: ClaudeContentBlock): block is ClaudeToolUseBlock {
        return (
            typeof block === 'object' &&
            block !== null &&
            (block as Record<string, unknown>).type === 'tool_use' &&
            typeof (block as Record<string, unknown>).id === 'string' &&
            typeof (block as Record<string, unknown>).name === 'string'
        );
    }

    private isUserMessage(msg: ClaudeSDKMessage): msg is ClaudeUserMessage {
        return (
            typeof msg === 'object' &&
            msg !== null &&
            (msg as Record<string, unknown>).type === 'user'
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
        const toolName = normalizeBridgedToolName(block.name ?? 'unknown_tool');
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
    }

    private handleClaudeUserToolResults(
        msg: ClaudeUserMessage,
        options: SendMessageOptions,
        toolCalls: Map<string, ToolCall>,
    ): void {
        const handledIds = new Set<string>();
        for (const block of this.getToolResultBlocks(msg)) {
            handledIds.add(block.tool_use_id);
            this.handleClaudeToolResult(block.tool_use_id, block.content, !!block.is_error, options, toolCalls);
        }

        const fallbackId = typeof msg.parent_tool_use_id === 'string' && msg.parent_tool_use_id
            ? msg.parent_tool_use_id
            : undefined;
        if (fallbackId && !handledIds.has(fallbackId) && msg.tool_use_result !== undefined) {
            this.handleClaudeToolResult(fallbackId, msg.tool_use_result, false, options, toolCalls);
        }
    }

    private getToolResultBlocks(msg: ClaudeUserMessage): ClaudeToolResultBlock[] {
        const content = msg.message?.content;
        if (!Array.isArray(content)) return [];
        return content.filter((block): block is ClaudeToolResultBlock => (
            typeof block === 'object' &&
            block !== null &&
            (block as Record<string, unknown>).type === 'tool_result' &&
            typeof (block as Record<string, unknown>).tool_use_id === 'string'
        ));
    }

    private handleClaudeToolResult(
        toolCallId: string,
        content: unknown,
        isError: boolean,
        options: SendMessageOptions,
        toolCalls: Map<string, ToolCall>,
    ): void {
        const existing = toolCalls.get(toolCallId);
        const toolName = existing?.name ?? 'unknown_tool';
        const result = this.stringifyClaudeToolResult(content);
        const now = new Date();

        if (existing) {
            existing.status = isError ? 'failed' : 'completed';
            existing.endTime = now;
            if (isError) {
                existing.error = result || 'Claude tool failed';
            } else {
                existing.result = result;
            }
        } else {
            toolCalls.set(toolCallId, {
                id: toolCallId,
                name: toolName,
                status: isError ? 'failed' : 'completed',
                startTime: now,
                endTime: now,
                args: {},
                ...(isError ? { error: result || 'Claude tool failed' } : { result }),
            });
        }

        this.emitToolEvent(options, isError
            ? {
                type: 'tool-failed',
                toolCallId,
                toolName,
                error: result || 'Claude tool failed',
            }
            : {
                type: 'tool-complete',
                toolCallId,
                toolName,
                result,
            });
    }

    private stringifyClaudeToolResult(content: unknown): string {
        if (content == null) return '';
        if (typeof content === 'string') return content;
        if (Array.isArray(content)) {
            return content
                .map(item => this.stringifyClaudeToolResult(item))
                .filter(text => text.length > 0)
                .join('\n');
        }
        if (typeof content === 'object') {
            const record = content as Record<string, unknown>;
            if (record.type === 'text' && typeof record.text === 'string') return record.text;
            const stdout = typeof record.stdout === 'string' ? record.stdout : '';
            const stderr = typeof record.stderr === 'string' ? record.stderr : '';
            if (stdout || stderr) return [stdout, stderr].filter(Boolean).join('\n');
            if (typeof record.output === 'string') return record.output;
            if (typeof record.result === 'string') return record.result;
        }
        try {
            return JSON.stringify(content);
        } catch {
            return String(content);
        }
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
        // Pass through short family aliases returned by Claude Code's supportedModels().
        if (/^(opus|sonnet|haiku)$/.test(normalized)) return trimmed;
        // Only pass through Claude model IDs; reject Copilot/Codex model IDs.
        if (normalized.startsWith('claude')) return trimmed;
        return undefined;
    }

    /**
     * Normalize a requested reasoning effort for Claude Code's `effort` option.
     *
     * CoC's {@link ReasoningEffort} (`low`/`medium`/`high`/`xhigh`) is a subset of
     * the SDK's `EffortLevel`, so recognized values pass straight through; the SDK
     * silently downgrades a level the selected model does not support. Unknown or
     * absent values (including `max`, which CoC does not yet surface) return
     * `undefined` so no `effort` is sent and Claude's adaptive thinking decides.
     */
    private normalizeClaudeEffort(effort: string | undefined): ReasoningEffort | undefined {
        if (!effort) return undefined;
        const normalized = effort.trim().toLowerCase();
        return (CLAUDE_EFFORT_LEVELS as readonly string[]).includes(normalized)
            ? (normalized as ReasoningEffort)
            : undefined;
    }

    /**
     * Builds the list of absolute directories Claude may access beyond its
     * working directory. Always includes `~/.coc` (CoC's data/skills dir) and
     * the system temp directory so out-of-repo skill files and temp artifacts
     * are readable, plus any caller-provided directories. Paths are resolved
     * to absolute form and de-duplicated (case-insensitively on Windows).
     */
    private resolveAdditionalDirectories(options: SendMessageOptions): string[] {
        const candidates = [
            ...(options.additionalDirectories ?? []),
            path.join(os.homedir(), '.coc'),
            os.tmpdir(),
        ];

        const seen = new Set<string>();
        const result: string[] = [];
        for (const dir of candidates) {
            if (!dir) continue;
            const resolved = path.resolve(dir);
            const key = process.platform === 'win32' ? resolved.toLowerCase() : resolved;
            if (seen.has(key)) continue;
            seen.add(key);
            result.push(resolved);
        }
        return result;
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
        return { permissionMode: 'acceptEdits' };
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

/**
 * Strip the `mcp__<server>__` prefix Claude Code prepends to MCP tool names so
 * CoC's bridged tools (e.g. `mcp__coc_llm_tools__ask_user`) surface to
 * `onToolEvent`, tool-call capture, and the process timeline as their bare names
 * (`ask_user`) — matching how Copilot and Codex report the same tools.
 */
function normalizeBridgedToolName(name: string): string {
    const prefix = `mcp__${COC_LLM_TOOLS_MCP_SERVER_NAME}__`;
    return name.startsWith(prefix) ? name.slice(prefix.length) : name;
}

/**
 * Normalize a forge `MCPServerConfig` into the Claude Code `mcpServers` shape.
 * Returns `undefined` for configs missing the fields Claude requires.
 */
function mapForgeMcpServerToClaude(cfg: MCPServerConfig): ClaudeMcpServerConfig | undefined {
    if (cfg.type === 'http' || cfg.type === 'sse') {
        if (!cfg.url) return undefined;
        return { type: cfg.type, url: cfg.url, ...(cfg.headers ? { headers: cfg.headers } : {}) };
    }
    const local = cfg as MCPLocalServerConfig;
    if (!local.command) return undefined;
    return {
        type: 'stdio',
        command: local.command,
        args: local.args ?? [],
        ...(local.env ? { env: local.env } : {}),
    };
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
