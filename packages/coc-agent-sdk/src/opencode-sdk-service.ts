/**
 * OpenCode SDK Service
 *
 * Implements ISDKService backed by the optional `@opencode-ai/sdk` package.
 * When the package is not installed the service reports itself as unavailable
 * and all method calls return appropriate error results rather than throwing.
 *
 * Architecture
 * ─────────────────────────
 * OpenCode is a server-backed provider: the SDK starts a local HTTP server
 * (or connects to an existing one) and all interactions go through REST APIs
 * and SSE event streams.
 *
 *   ISDKService
 *     -> OpenCodeSDKService
 *         -> @opencode-ai/sdk client
 *             -> opencode HTTP server
 *                 -> opencode agent runtime
 *
 * Session mapping
 * ─────────────────────────
 * CoC persists OpenCode session IDs returned by the SDK. New sessions are
 * created via the session API, and follow-up calls pass the ID back so the
 * conversation is resumed by the provider. Active sessions map to an
 * AbortController used to cancel in-flight prompts.
 *
 * Optional peer dependency
 * ─────────────────────────
 * `@opencode-ai/sdk` is declared as an optional peer dependency.
 * The module is loaded lazily with a try/catch so the rest of the SDK works
 * fine without it.
 *
 * Streaming
 * ─────────────────────────
 * OpenCode exposes SSE event streams. The adapter subscribes to the event
 * stream and correlates events by session/message ID to translate them into
 * the callback-style `onStreamingChunk` and `onToolEvent` shapes.
 *
 * Known limitations
 * ─────────────────────────
 * - `softAbortSession` delegates to `abortSession` (no Esc-equivalent API).
 * - `steerSession` returns false (no mid-turn injection API).
 * - Warm client is not supported (server-backed, no process to keep warm).
 */

import type { SendMessageOptions, TokenUsage } from './types';
import type { ToolEvent } from './types';
import { denyAllPermissions } from './types';
import type { ISDKService, IAvailabilityResult, IModelInfo, IInvocationResult, TransformOptions, TransformResult } from './sdk-service-interface';
import { sdkServiceRegistry, OPENCODE_PROVIDER } from './sdk-service-registry';
import { dynamicImportModule } from './sdk-esm-loader';
import { getSDKLogger } from './logger';
import { CocToolRuntime } from './llm-tools/coc-tool-runtime';
import { cocToolBridgeServer } from './llm-tools/bridge-server';
import { buildCocLlmToolsMcpConfig, COC_LLM_TOOLS_MCP_SERVER_NAME } from './llm-tools/mcp-config';
import * as crypto from 'crypto';

// ============================================================================
// @opencode-ai/sdk type stubs
// These mirror the opencode server API types published by the package.
// Kept here so the file compiles without the optional peer dependency.
// ============================================================================

interface OpenCodeClient {
    global: {
        health(): Promise<{ data: { healthy: boolean; version?: string } }>;
    };
    config: {
        get(): Promise<{ data: OpenCodeConfig }>;
        providers(): Promise<{ data: OpenCodeProvidersResult }>;
    };
    session: {
        list(): Promise<{ data: OpenCodeSession[] }>;
        get(opts: { path: { id: string } }): Promise<{ data: OpenCodeSession }>;
        create(opts: { body: { title?: string } }): Promise<{ data: OpenCodeSession }>;
        delete(opts: { path: { id: string } }): Promise<{ data: boolean }>;
        abort(opts: { path: { id: string } }): Promise<{ data: boolean }>;
        prompt(opts: { path: { id: string }; body: OpenCodePromptBody }): Promise<{ data: OpenCodePromptResult }>;
        messages(opts: { path: { id: string } }): Promise<{ data: OpenCodeMessageEnvelope[] }>;
    };
    event: {
        subscribe(): Promise<{ stream: AsyncIterable<OpenCodeEvent> }>;
    };
    app: {
        agents(): Promise<{ data: OpenCodeAgent[] }>;
    };
}

interface OpenCodeConfig {
    model?: string;
    [key: string]: unknown;
}

interface OpenCodeProvidersResult {
    providers: OpenCodeProvider[];
    default: Record<string, string>;
}

interface OpenCodeProvider {
    id: string;
    name?: string;
    models?: OpenCodeProviderModel[];
}

interface OpenCodeProviderModel {
    id: string;
    name?: string;
}

interface OpenCodeSession {
    id: string;
    title?: string;
    parentID?: string;
    [key: string]: unknown;
}

interface OpenCodePromptBody {
    parts: OpenCodePart[];
    model?: OpenCodeModelRef;
    agent?: string;
    system?: string;
    noReply?: boolean;
    tools?: string[];
    format?: unknown;
}

interface OpenCodeModelRef {
    providerID: string;
    modelID: string;
}

interface OpenCodePart {
    type: 'text';
    text: string;
}

interface OpenCodePromptResult {
    info: OpenCodeMessage;
    parts: OpenCodeResponsePart[];
}

interface OpenCodeMessage {
    id: string;
    sessionID: string;
    role: 'user' | 'assistant';
    [key: string]: unknown;
}

interface OpenCodeResponsePart {
    type: string;
    text?: string;
    toolCallID?: string;
    toolName?: string;
    state?: string;
    input?: unknown;
    output?: string;
    error?: string;
    [key: string]: unknown;
}

interface OpenCodeMessageEnvelope {
    info: OpenCodeMessage;
    parts: OpenCodeResponsePart[];
}

interface OpenCodeEvent {
    type: string;
    properties?: Record<string, unknown>;
    /** Session ID associated with this event, if any */
    sessionID?: string;
    /** Message ID associated with this event, if any */
    messageID?: string;
    /** Content part for streaming text events */
    part?: OpenCodeResponsePart;
    /** Incremental text delta for chunk events */
    content?: string;
}

interface OpenCodeAgent {
    id: string;
    name?: string;
    [key: string]: unknown;
}

interface OpenCodeServer {
    url: string;
    close(): void;
}

interface OpenCodeSDKModule {
    createOpencode?: (options?: {
        hostname?: string;
        port?: number;
        signal?: AbortSignal;
        timeout?: number;
        config?: Record<string, unknown>;
    }) => Promise<{ client: OpenCodeClient; server: OpenCodeServer }>;
    createOpencodeClient?: (options?: {
        baseUrl?: string;
        throwOnError?: boolean;
    }) => OpenCodeClient;
    default?: {
        createOpencode?: OpenCodeSDKModule['createOpencode'];
        createOpencodeClient?: OpenCodeSDKModule['createOpencodeClient'];
    };
}

// ============================================================================
// Internal types
// ============================================================================

interface ActiveOpenCodeSession {
    sessionId: string;
    abortController: AbortController;
}

// ============================================================================
// Constants
// ============================================================================

const OPENCODE_SDK_PACKAGE = '@opencode-ai/sdk';
const OPENCODE_DEFAULT_PORT = 4096;
const OPENCODE_DEFAULT_HOSTNAME = '127.0.0.1';

// ============================================================================
// OpenCodeSDKService
// ============================================================================

/**
 * Provider for the optional `@opencode-ai/sdk` package.
 * Registered under the `'opencode'` key in `SDKServiceRegistry`.
 *
 * Construction is cheap — no SDK is loaded until the first call to
 * `isAvailable()` or `sendMessage()`.
 */
export class OpenCodeSDKService implements ISDKService {
    private availabilityCache: IAvailabilityResult | null = null;
    private client: OpenCodeClient | null = null;
    private server: OpenCodeServer | null = null;
    private createOpencodeClientFn: OpenCodeSDKModule['createOpencodeClient'] | null = null;
    private createOpencodeFn: OpenCodeSDKModule['createOpencode'] | null = null;
    private disposed = false;

    /** sessionId → active session metadata */
    private readonly sessions = new Map<string, ActiveOpenCodeSession>();

    // ── Availability ─────────────────────────────────────────────────────────

    public async isAvailable(): Promise<IAvailabilityResult> {
        if (this.disposed) return { available: false, error: 'OpenCodeSDKService has been disposed' };
        if (this.availabilityCache) return this.availabilityCache;

        try {
            const mod = await dynamicImportModule<OpenCodeSDKModule>(OPENCODE_SDK_PACKAGE);
            const createOpencodeFn = mod.createOpencode
                ?? mod.default?.createOpencode;
            const createOpencodeClientFn = mod.createOpencodeClient
                ?? mod.default?.createOpencodeClient;
            if (!createOpencodeFn && !createOpencodeClientFn) {
                throw new Error(
                    `${OPENCODE_SDK_PACKAGE} loaded but did not export createOpencode or createOpencodeClient. ` +
                    'Ensure you have a compatible version installed:\n' +
                    `  npm install ${OPENCODE_SDK_PACKAGE}`,
                );
            }
            this.createOpencodeFn = createOpencodeFn ?? null;
            this.createOpencodeClientFn = createOpencodeClientFn ?? null;
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
                        'OpenCode SDK not installed. To enable OpenCode, run:\n' +
                        `  npm install ${OPENCODE_SDK_PACKAGE}\n` +
                        'Then restart CoC.',
                };
            } else {
                const msg = err instanceof Error ? err.message : String(err);
                this.availabilityCache = {
                    available: false,
                    error: `OpenCode SDK failed to load: ${msg}\n` +
                        `Ensure ${OPENCODE_SDK_PACKAGE} is installed.`,
                };
            }
        }
        return this.availabilityCache;
    }

    public clearAvailabilityCache(): void {
        this.availabilityCache = null;
        this.client = null;
        this.createOpencodeFn = null;
        this.createOpencodeClientFn = null;
    }

    // ── Client lifecycle ──────────────────────────────────────────────────────

    /**
     * Ensure a connected opencode client is available. Tries to connect to an
     * existing server first; if that fails, starts a new server+client pair.
     */
    private async ensureClient(): Promise<OpenCodeClient> {
        if (this.client) return this.client;

        const avail = await this.isAvailable();
        if (!avail.available) throw new Error(avail.error ?? 'OpenCode SDK is not available');

        // Try connecting to an existing server first via client-only mode
        if (this.createOpencodeClientFn) {
            try {
                const baseUrl = `http://${OPENCODE_DEFAULT_HOSTNAME}:${OPENCODE_DEFAULT_PORT}`;
                const client = this.createOpencodeClientFn({ baseUrl, throwOnError: false });
                const health = await client.global.health();
                if (health.data?.healthy) {
                    this.client = client;
                    return client;
                }
            } catch {
                // Fall through to start a new server
            }
        }

        // Start a new server+client pair
        if (this.createOpencodeFn) {
            const result = await this.createOpencodeFn({
                hostname: OPENCODE_DEFAULT_HOSTNAME,
                port: OPENCODE_DEFAULT_PORT,
            });
            this.client = result.client;
            this.server = result.server;
            return result.client;
        }

        throw new Error('OpenCode SDK: neither createOpencode nor createOpencodeClient is available');
    }

    // ── Model discovery ───────────────────────────────────────────────────────

    public async listModels(): Promise<IModelInfo[]> {
        if (this.disposed) throw new Error('OpenCodeSDKService has been disposed');
        const client = await this.ensureClient();

        try {
            const result = await client.config.providers();
            const providers = result.data?.providers;
            if (!Array.isArray(providers)) {
                return [{ id: 'opencode-default', name: 'OpenCode Provider Default' }];
            }
            return flattenOpenCodeProvidersToModelInfo(providers);
        } catch (err) {
            getSDKLogger().warn(
                { provider: OPENCODE_PROVIDER, error: err instanceof Error ? err.message : String(err) },
                'OpenCode model discovery failed; returning fallback',
            );
            return [{ id: 'opencode-default', name: 'OpenCode Provider Default' }];
        }
    }

    // ── Message dispatch ──────────────────────────────────────────────────────

    public async sendMessage(options: SendMessageOptions): Promise<IInvocationResult> {
        if (this.disposed) return { success: false, error: 'OpenCodeSDKService has been disposed' };

        if (options.signal?.aborted) {
            return { success: false, error: 'Request aborted', sessionId: options.sessionId };
        }

        const avail = await this.isAvailable();
        if (!avail.available) {
            return { success: false, error: avail.error };
        }

        const client = await this.ensureClient();
        const abortController = new AbortController();
        let sessionId: string | undefined;
        let timeoutTimer: ReturnType<typeof setTimeout> | undefined;

        let signalCleanup: (() => void) | undefined;
        if (options.signal) {
            const onAbort = () => abortController.abort();
            options.signal.addEventListener('abort', onAbort);
            signalCleanup = () => options.signal!.removeEventListener('abort', onAbort);
        }

        if (options.timeoutMs && options.timeoutMs > 0) {
            timeoutTimer = setTimeout(() => {
                abortController.abort();
            }, options.timeoutMs);
        }

        let mcpCleanup: () => void = () => {};
        const chunks: string[] = [];
        let tokenUsage: TokenUsage | undefined;

        try {
            // Create or resume session
            if (options.sessionId) {
                sessionId = options.sessionId;
                if (options.strictSessionResume) {
                    try {
                        await client.session.get({ path: { id: sessionId } });
                    } catch {
                        return { success: false, error: `Session ${sessionId} not found and strictSessionResume is enabled`, sessionId };
                    }
                }
            } else {
                const session = await client.session.create({ body: {} });
                sessionId = session.data.id;
            }

            this.sessions.set(sessionId, { sessionId, abortController });
            options.onSessionCreated?.(sessionId);

            // Build MCP bridge for CoC LLM tools when tools are provided
            const mcpConfig = await this.buildMcpConfig(options);
            mcpCleanup = mcpConfig.cleanup;
            const toolNames = mcpConfig.toolNames;

            // Build prompt text with working directory context and attachments
            let promptText = options.prompt;
            if (options.workingDirectory) {
                promptText = `Working directory: ${options.workingDirectory}\n\n${promptText}`;
            }
            if (options.attachments && options.attachments.length > 0) {
                const attachmentRefs = options.attachments
                    .map(a => 'filePath' in a ? a.filePath : ('directory' in a ? a.directory : ''))
                    .filter(Boolean);
                if (attachmentRefs.length > 0) {
                    promptText += `\n\nAttached files/directories:\n${attachmentRefs.map(r => `- ${r}`).join('\n')}`;
                }
            }

            // Build the prompt body
            const modelRef = parseOpenCodeModelRef(options.model);
            const systemMsg = resolveOpenCodeSystemMessage(options.systemMessage);
            const promptBody: OpenCodePromptBody = {
                parts: [{ type: 'text', text: promptText }],
                ...(modelRef ? { model: modelRef } : {}),
                ...(systemMsg ? { system: systemMsg } : {}),
                ...(options.mode ? { agent: mapAgentMode(options.mode) } : {}),
                ...(toolNames.length > 0 ? { tools: toolNames } : {}),
            };

            if (abortController.signal.aborted) {
                return { success: false, error: 'Request aborted', sessionId };
            }

            // Subscribe to SSE events for real-time streaming when callbacks are provided
            const useStreaming = Boolean(options.onStreamingChunk || options.onToolEvent);
            let eventStreamPromise: Promise<void> | undefined;
            if (useStreaming) {
                eventStreamPromise = this.consumeEventStream(
                    client, sessionId, abortController.signal, options, chunks,
                );
            }

            const result = await client.session.prompt({
                path: { id: sessionId },
                body: promptBody,
            });

            // If streaming, wait for the event stream to finish processing
            if (eventStreamPromise) {
                await eventStreamPromise;
            }

            // If SSE streaming produced no chunks, fall back to response parts
            if (chunks.length === 0) {
                const responseParts = result.data?.parts ?? [];
                for (const part of responseParts) {
                    if (part.type === 'text' && part.text) {
                        chunks.push(part.text);
                        options.onStreamingChunk?.(part.text);
                    } else if (part.type === 'tool-invocation' || part.type === 'tool_use') {
                        this.emitToolEvent(part, options);
                    }
                }
            }

            // Signal end-of-stream
            options.onStreamingChunk?.('');

            const response = chunks.join('');
            const effectiveModel = resolveEffectiveModel(options.model, result.data?.info);
            return {
                success: true,
                response,
                sessionId,
                effectiveModel,
                ...(tokenUsage ? { tokenUsage } : {}),
            };
        } catch (err) {
            const isAbort = err instanceof Error && (err.name === 'AbortError' || abortController.signal.aborted);
            if (isAbort) {
                return { success: false, error: 'Request aborted', sessionId };
            }
            getSDKLogger().error(
                {
                    provider: OPENCODE_PROVIDER,
                    error: err instanceof Error ? err.message : String(err),
                    sessionId,
                    workingDirectory: options.workingDirectory,
                    model: options.model,
                },
                'OpenCode SDK sendMessage threw',
            );
            const message = err instanceof Error ? err.message : String(err);
            return { success: false, error: `OpenCode SDK error: ${message}`, sessionId };
        } finally {
            if (timeoutTimer) clearTimeout(timeoutTimer);
            signalCleanup?.();
            mcpCleanup();
            if (sessionId) this.sessions.delete(sessionId);
        }
    }

    private emitToolEvent(part: OpenCodeResponsePart, options: SendMessageOptions): void {
        if (!options.onToolEvent) return;

        const toolCallId = part.toolCallID ?? crypto.randomUUID();
        const toolName = part.toolName;

        if (part.state === 'pending' || part.state === 'running' || !part.state) {
            const event: ToolEvent = {
                type: 'tool-start',
                toolCallId,
                toolName,
                parameters: typeof part.input === 'object' && part.input !== null
                    ? part.input as Record<string, unknown>
                    : undefined,
            };
            options.onToolEvent(event);
        }

        if (part.state === 'completed' || part.state === 'done') {
            const event: ToolEvent = {
                type: 'tool-complete',
                toolCallId,
                toolName,
                result: part.output ?? part.text,
            };
            options.onToolEvent(event);
        }

        if (part.state === 'error' || part.error) {
            const event: ToolEvent = {
                type: 'tool-failed',
                toolCallId,
                toolName,
                error: part.error ?? 'Tool execution failed',
            };
            options.onToolEvent(event);
        }
    }

    /**
     * Subscribe to the OpenCode SSE event stream and correlate events for the
     * given session. Emits incremental text chunks and normalized tool events
     * to the caller's callbacks. Resolves when the stream signals completion
     * for this session or when aborted.
     */
    private async consumeEventStream(
        client: OpenCodeClient,
        sessionId: string,
        signal: AbortSignal,
        options: SendMessageOptions,
        chunks: string[],
    ): Promise<void> {
        try {
            const { stream } = await client.event.subscribe();
            for await (const event of stream) {
                if (signal.aborted) break;

                // Only process events for our session
                const eventSessionId = event.sessionID ?? event.properties?.['sessionID'] as string | undefined;
                if (eventSessionId && eventSessionId !== sessionId) continue;

                switch (event.type) {
                    case 'message.chunk':
                    case 'content.delta':
                    case 'text': {
                        const delta = event.content
                            ?? (event.properties?.['content'] as string | undefined)
                            ?? event.part?.text;
                        if (delta) {
                            chunks.push(delta);
                            options.onStreamingChunk?.(delta);
                        }
                        break;
                    }
                    case 'tool.start':
                    case 'tool-invocation': {
                        const part = event.part ?? event.properties as unknown as OpenCodeResponsePart | undefined;
                        if (part) this.emitToolEvent({ ...part, state: part.state ?? 'running' }, options);
                        break;
                    }
                    case 'tool.complete':
                    case 'tool.done': {
                        const part = event.part ?? event.properties as unknown as OpenCodeResponsePart | undefined;
                        if (part) this.emitToolEvent({ ...part, state: 'completed' }, options);
                        break;
                    }
                    case 'tool.error': {
                        const part = event.part ?? event.properties as unknown as OpenCodeResponsePart | undefined;
                        if (part) this.emitToolEvent({ ...part, state: 'error' }, options);
                        break;
                    }
                    case 'message.complete':
                    case 'done':
                    case 'session.complete':
                        return;
                    default:
                        break;
                }
            }
        } catch (err) {
            if (signal.aborted) return;
            getSDKLogger().warn(
                { provider: OPENCODE_PROVIDER, error: err instanceof Error ? err.message : String(err), sessionId },
                'OpenCode SSE event stream error; falling back to response parts',
            );
        }
    }

    /**
     * Build MCP configuration for CoC LLM tools when custom tools are provided.
     * Registers a per-turn CocToolRuntime on the loopback bridge server and
     * returns the tool names plus a cleanup function.
     *
     * OpenCode manages its own MCP server connections, so the bridge is exposed
     * as a CoC tools endpoint that the opencode agent can reach during the turn.
     * The tool names are surfaced in the prompt body so the model knows they exist.
     */
    private async buildMcpConfig(
        options: SendMessageOptions,
    ): Promise<{ toolNames: string[]; cleanup: () => void }> {
        const tools = options.tools;
        if (!tools || tools.length === 0) return { toolNames: [], cleanup: () => {} };

        const runtime = new CocToolRuntime(tools, { sessionId: options.sessionId });
        const registration = await cocToolBridgeServer.register(runtime);
        const enabledTools = Array.from(new Set(tools.map(tool => tool.name).filter(Boolean)));
        buildCocLlmToolsMcpConfig({
            endpoint: registration.endpoint,
            token: registration.token,
            enabledTools,
        });

        return {
            toolNames: enabledTools,
            cleanup: () => {
                registration.unregister();
                runtime.dispose();
            },
        };
    }

    // ── Transform ────────────────────────────────────────────────────────────

    public async transform(
        input: string,
        options?: TransformOptions,
    ): Promise<TransformResult> {
        const result = await this.sendMessage({
            prompt: input,
            model: options?.model,
            workingDirectory: options?.cwd,
            timeoutMs: options?.timeoutMs,
            signal: options?.signal,
            loadDefaultMcpConfig: options?.loadDefaultMcpConfig ?? false,
            onPermissionRequest: options?.onPermissionRequest ?? denyAllPermissions,
        });
        if (!result.success) {
            return {
                success: false,
                text: '',
                error: result.error ?? 'OpenCode transform failed',
                effectiveModel: result.effectiveModel,
                tokenUsage: result.tokenUsage,
            };
        }
        return {
            success: true,
            text: result.response ?? '',
            effectiveModel: result.effectiveModel,
            tokenUsage: result.tokenUsage,
        };
    }

    // ── Session management ────────────────────────────────────────────────────

    public async forkSession(sessionId: string): Promise<string> {
        if (this.disposed) throw new Error('OpenCodeSDKService has been disposed');
        const client = await this.ensureClient();

        // OpenCode does not expose a native fork API. Create a new session and
        // copy the conversation history from the original session as context.
        const newSession = await client.session.create({ body: {} });
        const newId = newSession.data.id;
        try {
            const messages = await client.session.messages({ path: { id: sessionId } });
            const history = (messages.data ?? [])
                .flatMap(env => env.parts
                    .filter((p): p is OpenCodeResponsePart & { type: 'text'; text: string } =>
                        p.type === 'text' && typeof p.text === 'string' && p.text.length > 0)
                    .map(p => p.text),
                )
                .join('\n\n');

            if (history) {
                await client.session.prompt({
                    path: { id: newId },
                    body: {
                        parts: [{ type: 'text', text: `Previous conversation context:\n\n${history}` }],
                        noReply: true,
                    },
                });
            }
        } catch {
            getSDKLogger().warn(
                { provider: OPENCODE_PROVIDER, originalSessionId: sessionId },
                'Failed to copy session history during fork; continuing with empty session',
            );
        }
        return newId;
    }

    public async abortSession(sessionId: string): Promise<boolean> {
        const session = this.sessions.get(sessionId);
        if (session) {
            session.abortController.abort();
            this.sessions.delete(sessionId);
        }
        try {
            const client = await this.ensureClient();
            const result = await client.session.abort({ path: { id: sessionId } });
            return Boolean(result.data);
        } catch {
            return session !== undefined;
        }
    }

    public async softAbortSession(sessionId: string): Promise<boolean> {
        // OpenCode does not expose a soft-abort (Esc-equivalent) API.
        return this.abortSession(sessionId);
    }

    public async steerSession(_sessionId: string, _prompt: string): Promise<boolean> {
        // Steering (injecting into an active turn) is not supported by OpenCode.
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
        this.client = null;
        this.createOpencodeFn = null;
        this.createOpencodeClientFn = null;
    }

    public dispose(): void {
        this.disposed = true;
        this.cleanup().catch(() => {});
        this.server?.close();
        this.server = null;
    }
}

// ============================================================================
// Mapping helpers
// ============================================================================

/**
 * Flatten opencode providers/models into the IModelInfo[] shape.
 * Each model gets a composite id of `provider/model` matching opencode's
 * model reference format.
 */
export function flattenOpenCodeProvidersToModelInfo(providers: OpenCodeProvider[]): IModelInfo[] {
    const models: IModelInfo[] = [];
    for (const provider of providers) {
        if (!provider.models || !Array.isArray(provider.models)) continue;
        for (const model of provider.models) {
            if (!model.id) continue;
            models.push({
                id: `${provider.id}/${model.id}`,
                name: model.name ?? model.id,
            });
        }
    }
    if (models.length === 0) {
        models.push({ id: 'opencode-default', name: 'OpenCode Provider Default' });
    }
    return models;
}

/**
 * Parse a model string into the opencode `{ providerID, modelID }` ref format.
 * Expects `provider/model` (e.g. `anthropic/claude-3-5-sonnet-20241022`).
 * Returns undefined for empty/default model strings so the server picks its own default.
 */
export function parseOpenCodeModelRef(model: string | undefined): OpenCodeModelRef | undefined {
    if (!model) return undefined;
    const trimmed = model.trim();
    if (!trimmed || trimmed === 'opencode-default' || trimmed === 'provider-default' || trimmed === 'default') {
        return undefined;
    }
    const slashIndex = trimmed.indexOf('/');
    if (slashIndex > 0 && slashIndex < trimmed.length - 1) {
        return {
            providerID: trimmed.slice(0, slashIndex),
            modelID: trimmed.slice(slashIndex + 1),
        };
    }
    // No slash — pass the raw model and let the server resolve the provider
    return { providerID: '', modelID: trimmed };
}

/**
 * Resolve the system message from SendMessageOptions into a plain string.
 */
function resolveOpenCodeSystemMessage(
    systemMessage: SendMessageOptions['systemMessage'],
): string | undefined {
    if (!systemMessage) return undefined;
    if (typeof systemMessage === 'string') return systemMessage;
    if (typeof systemMessage === 'object' && 'content' in systemMessage && typeof systemMessage.content === 'string') {
        return systemMessage.content;
    }
    return undefined;
}

/**
 * Resolve the model actually used by the server. If the response metadata
 * contains a model field use that; otherwise fall back to the request model.
 */
function resolveEffectiveModel(requestedModel: string | undefined, info?: OpenCodeMessage): string | undefined {
    const serverModel = info?.model ?? info?.['modelID'];
    if (typeof serverModel === 'string' && serverModel) return serverModel;
    return requestedModel;
}

/**
 * Map a CoC AgentMode to an opencode agent identifier.
 * OpenCode uses agent names rather than mode enums.
 */
function mapAgentMode(mode: SendMessageOptions['mode']): string | undefined {
    switch (mode) {
        case 'autopilot':
            return 'coder';
        case 'plan':
            return 'coder';
        case 'interactive':
            return 'coder';
        default:
            return undefined;
    }
}

// ============================================================================
// Registration helper
// ============================================================================

/**
 * Register a new `OpenCodeSDKService` instance under `'opencode'` in the
 * module-level `sdkServiceRegistry`. Call this once during server startup.
 *
 * @returns The newly created service instance.
 */
export function registerOpenCodeSDKService(): OpenCodeSDKService {
    const svc = new OpenCodeSDKService();
    sdkServiceRegistry.register(OPENCODE_PROVIDER, svc);
    return svc;
}
