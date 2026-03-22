/**
 * RequestRunner — executes SDK requests on behalf of CopilotSDKService.
 *
 * Contains the full sendMessage() and transform() logic, extracted from the
 * service facade so the facade can remain a thin wiring layer.
 *
 * Dependencies are injected at construction time so this class can be tested
 * independently of CopilotSDKService.
 */

import { ToolCall } from '../ai/process-types';
import { getAIServiceLogger, createSessionLogger } from '../ai-logger';
import { loadDefaultMcpConfig, mergeMcpConfigs } from './mcp-config-loader';
import { DEFAULT_AI_TIMEOUT_MS } from '../ai/timeouts';
import {
    MCPServerConfig,
    ReasoningEffort,
    SendMessageOptions,
    SystemMessageConfig,
    TokenUsage,
    SDKInvocationResult,
    SDKAvailabilityResult,
    PermissionRequest,
    PermissionRequestResult,
    PermissionHandler,
    ExtendedSdkRequest,
    denyAllPermissions,
    Attachment,
    DeliveryMode,
    ToolEvent,
} from './types';
import { StreamingSession, StreamingResult } from './streaming-session';
import { SessionManager } from './session-manager';
import { isStreamDestroyedError } from './stream-error-guard';

// ============================================================================
// Internal SDK interface shapes (not part of public API)
// ============================================================================

interface ISessionOptions {
    model?: string;
    streaming?: boolean;
    availableTools?: string[];
    excludedTools?: string[];
    mcpServers?: Record<string, MCPServerConfig>;
    onPermissionRequest?: PermissionHandler;
    tools?: unknown[];
    skillDirectories?: string[];
    disabledSkills?: string[];
    systemMessage?: SystemMessageConfig;
    reasoningEffort?: ReasoningEffort;
}

interface ICopilotClient {
    start(): Promise<void>;
    createSession(options?: ISessionOptions): Promise<ICopilotSession>;
    resumeSession?(sessionId: string, options?: ISessionOptions): Promise<ICopilotSession>;
    stop(): Promise<void>;
}

interface ICopilotSession {
    sessionId: string;
    sendAndWait(options: { prompt: string; attachments?: Attachment[] }, timeout?: number): Promise<{ data?: { content?: string } }>;
    destroy(): Promise<void>;
    on?(handler: (event: { type: string; data?: unknown }) => void): (() => void);
    send?(options: { prompt: string; attachments?: Attachment[]; deliveryMode?: DeliveryMode }): Promise<void>;
    rpc?: {
        mode: {
            get(): Promise<{ mode: string }>;
            set(options: { mode: string }): Promise<void>;
        };
    };
}

// ============================================================================
// RequestRunner
// ============================================================================

/**
 * Executes Copilot SDK requests.  Receives all external dependencies at
 * construction time so it can be instantiated and tested in isolation.
 */
export class RequestRunner {
    constructor(
        private readonly isAvailable: () => Promise<SDKAvailabilityResult>,
        private readonly createClient: (cwd?: string) => Promise<ICopilotClient>,
        private readonly sessionManager: SessionManager,
        private readonly defaultTimeoutMs: number = DEFAULT_AI_TIMEOUT_MS,
        private readonly defaultIdleTimeoutMs: number = 3_600_000,
    ) {}

    /**
     * Send a message to Copilot via the SDK.
     * Creates a new session for each request (session-per-request pattern).
     */
    async send(options: SendMessageOptions): Promise<SDKInvocationResult> {
        const aiLog = getAIServiceLogger();
        const startTime = Date.now();

        const availability = await this.isAvailable();
        if (!availability.available) {
            return { success: false, error: availability.error || 'Copilot SDK is not available' };
        }

        let session: ICopilotSession | null = null;
        let client: ICopilotClient | null = null;
        let result: SDKInvocationResult | null = null;

        try {
            client = await this.createClient(options.workingDirectory);

            // Build session options
            const sessionOptions: ISessionOptions = {};
            if (options.model) sessionOptions.model = options.model;
            if (options.streaming) sessionOptions.streaming = options.streaming;
            if (options.tools) sessionOptions.tools = options.tools;
            if (options.systemMessage) sessionOptions.systemMessage = options.systemMessage;
            if (options.reasoningEffort) sessionOptions.reasoningEffort = options.reasoningEffort;
            if (options.availableTools) sessionOptions.availableTools = options.availableTools;
            if (options.excludedTools) sessionOptions.excludedTools = options.excludedTools;
            if (options.skillDirectories?.length) sessionOptions.skillDirectories = options.skillDirectories;
            if (options.disabledSkills?.length) sessionOptions.disabledSkills = options.disabledSkills;

            // Load and merge MCP server configurations
            const shouldLoadDefaultMcp = options.loadDefaultMcpConfig !== false;
            if (shouldLoadDefaultMcp || options.mcpServers !== undefined) {
                let finalMcpServers: Record<string, MCPServerConfig> | undefined;
                if (shouldLoadDefaultMcp) {
                    const defaultConfig = loadDefaultMcpConfig();
                    aiLog.debug({ success: defaultConfig.success, fileExists: defaultConfig.fileExists, serverCount: Object.keys(defaultConfig.mcpServers).length }, 'Default MCP config loaded');
                    if (defaultConfig.error) aiLog.debug({ error: defaultConfig.error }, 'Default MCP config error');
                    if (defaultConfig.success && Object.keys(defaultConfig.mcpServers).length > 0) {
                        aiLog.debug({ serverCount: Object.keys(defaultConfig.mcpServers).length }, 'Default MCP servers loaded');
                    }
                    finalMcpServers = mergeMcpConfigs(defaultConfig.mcpServers, options.mcpServers);
                } else if (options.mcpServers !== undefined) {
                    finalMcpServers = options.mcpServers;
                }

                if (finalMcpServers && Object.keys(finalMcpServers).length > 0) {
                    sessionOptions.mcpServers = finalMcpServers;
                    aiLog.debug({ serverCount: Object.keys(finalMcpServers).length, serverNames: Object.keys(finalMcpServers) }, 'Using MCP servers');
                } else if (options.mcpServers !== undefined && Object.keys(options.mcpServers).length === 0) {
                    sessionOptions.mcpServers = {};
                    aiLog.debug('MCP servers explicitly disabled');
                }
            }

            // Shared tool calls map — bridged between permission handler and sendWithStreaming
            const toolCallsMap = new Map<string, ToolCall>();

            // Permission handler — wrap with logging to track permission requests.
            const effectiveHandler = options.onPermissionRequest || denyAllPermissions;
            sessionOptions.onPermissionRequest = (request: PermissionRequest, invocation: { sessionId: string }) => {
                const sessionLog = createSessionLogger(invocation.sessionId);
                sessionLog.debug({ kind: request.kind, toolCallId: request.toolCallId || undefined, resource: (request as ExtendedSdkRequest).resource, operation: (request as ExtendedSdkRequest).operation }, 'Permission request');
                const capturePermission = (permResult: PermissionRequestResult) => {
                    if (request.toolCallId) {
                        const tc = toolCallsMap.get(request.toolCallId);
                        if (tc) {
                            tc.permissionRequest = {
                                kind: request.kind,
                                timestamp: new Date(),
                                resource: (request as ExtendedSdkRequest).resource,
                                operation: (request as ExtendedSdkRequest).operation,
                            };
                            tc.permissionResult = {
                                approved: permResult.kind === 'approved',
                                timestamp: new Date(),
                                reason: permResult.kind !== 'approved' ? permResult.kind : undefined,
                            };
                        }
                    }
                };
                const handlerResult = effectiveHandler(request, invocation);
                if (handlerResult && typeof (handlerResult as Promise<PermissionRequestResult>).then === 'function') {
                    return (handlerResult as Promise<PermissionRequestResult>).then(r => {
                        createSessionLogger(invocation.sessionId).debug({ kind: r.kind, requestKind: request.kind }, 'Permission result');
                        capturePermission(r);
                        return r;
                    });
                }
                createSessionLogger(invocation.sessionId).debug({ kind: (handlerResult as PermissionRequestResult).kind, requestKind: request.kind }, 'Permission result');
                capturePermission(handlerResult as PermissionRequestResult);
                return handlerResult;
            };

            const sessionOptionsStr = Object.keys(sessionOptions).length > 0
                ? JSON.stringify(sessionOptions)
                : '(default)';

            // Resume an existing SDK session or create a new one
            if (options.sessionId && client.resumeSession) {
                aiLog.debug({ cwd: options.workingDirectory, sessionId: options.sessionId, sessionOptionsStr }, 'Resuming session');
                try {
                    session = await client.resumeSession(options.sessionId, sessionOptions);
                    aiLog.debug({ sessionId: session.sessionId }, 'Session resumed');
                } catch (resumeError) {
                    const resumeMsg = resumeError instanceof Error ? resumeError.message : String(resumeError);
                    aiLog.warn({ sessionId: options.sessionId, error: resumeMsg }, 'Session resume failed — falling back to createSession');
                    session = await client.createSession(sessionOptions);
                    aiLog.debug({ sessionId: session.sessionId }, 'Fallback session created');
                }
            } else {
                aiLog.debug({ cwd: options.workingDirectory, sessionOptionsStr }, 'Creating session');
                session = await client.createSession(sessionOptions);
                aiLog.debug({ sessionId: session.sessionId }, 'Session created');
            }

            const sessionLog = createSessionLogger(session.sessionId);
            options.onSessionCreated?.(session.sessionId);

            if (options.mode && session.rpc?.mode) {
                await session.rpc.mode.set({ mode: options.mode });
                sessionLog.debug({ mode: options.mode }, 'Mode set');
            }

            this.sessionManager.track(session);

            const timeoutMs = options.timeoutMs ?? this.defaultTimeoutMs;
            let response: string;
            let tokenUsage: TokenUsage | undefined;
            let turnCount = 0;
            let capturedToolCalls: ToolCall[] | undefined;

            if ((options.streaming || options.onStreamingChunk || timeoutMs > 120000) && session.on && session.send) {
                const idleTimeoutMs = options.idleTimeoutMs ?? this.defaultIdleTimeoutMs;
                const streamingResult = await this.sendWithStreaming(session, options.prompt, timeoutMs, options.onStreamingChunk, toolCallsMap, options.onToolEvent, idleTimeoutMs, options.attachments, options.deliveryMode, options.sessionId);
                response = streamingResult.response;
                tokenUsage = streamingResult.tokenUsage;
                turnCount = streamingResult.turnCount;
                capturedToolCalls = streamingResult.toolCalls;
            } else {
                const sendResult = await this.sendWithTimeout(session, options.prompt, timeoutMs, options.attachments);
                response = sendResult?.data?.content || '';
            }

            const durationMs = Date.now() - startTime;
            sessionLog.debug({ durationMs }, 'Request completed');

            if (!response) {
                if (turnCount > 0) {
                    sessionLog.debug({ durationMs, turnCount }, 'Empty text response — treating as success (tool-based execution)');
                    result = { success: true, response: '', sessionId: session.sessionId, tokenUsage, toolCalls: capturedToolCalls };
                    return result;
                }
                result = { success: false, error: 'No response received from Copilot SDK', sessionId: session.sessionId, tokenUsage, toolCalls: capturedToolCalls };
                return result;
            }

            result = { success: true, response, sessionId: session.sessionId, tokenUsage, toolCalls: capturedToolCalls };
            return result;

        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            const durationMs = Date.now() - startTime;

            if (session) {
                createSessionLogger(session.sessionId).error({ durationMs, err: error instanceof Error ? error : undefined }, 'Request failed');
            } else {
                aiLog.error({ durationMs, err: error instanceof Error ? error : undefined }, 'Request failed (no session)');
            }

            if (isStreamDestroyedError(errorMessage) && client) {
                aiLog.debug('Stream destroyed — invalidating client');
                client.stop().catch(() => {});
                client = null;
            }

            result = { success: false, error: `Copilot SDK error: ${errorMessage}`, sessionId: session?.sessionId };
            return result;

        } finally {
            if (session) {
                this.sessionManager.untrack(session.sessionId);
                const finalSessionLog = createSessionLogger(session.sessionId);
                try {
                    await session.destroy();
                    finalSessionLog.debug('Session destroyed');
                } catch (destroyError) {
                    finalSessionLog.debug({ err: destroyError }, 'Warning: Error destroying session');
                }
                if (client) {
                    try { await client.stop(); } catch { /* ignore */ }
                }
            } else if (client) {
                try { await client.stop(); } catch { /* ignore */ }
            }
        }
    }

    /**
     * Sends a one-shot prompt and returns a parsed value of type T.
     * Uses `gpt-4.1` by default. Throws on AI unavailability or parse failure.
     *
     * @param sendFn - Optional send override (defaults to this.send). Pass
     *   `service.sendMessage.bind(service)` from the facade so tests can spy on sendMessage.
     */
    async transform<T = string>(
        prompt: string,
        parse?: (raw: string) => T,
        options?: { model?: string; timeoutMs?: number; cwd?: string },
        sendFn?: (opts: SendMessageOptions) => Promise<SDKInvocationResult>,
    ): Promise<T> {
        const doSend = sendFn ?? ((opts: SendMessageOptions) => this.send(opts));
        const aiLog = getAIServiceLogger();
        try {
            const result = await doSend({
                prompt,
                model: options?.model ?? 'gpt-4.1',
                timeoutMs: options?.timeoutMs ?? this.defaultTimeoutMs,
                workingDirectory: options?.cwd,
            });
            if (!result.success) throw new Error(result.error || 'AI transform failed');
            const raw = result.response ?? '';
            return parse ? parse(raw) : raw as unknown as T;
        } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            aiLog.error({ err: error instanceof Error ? error : undefined }, `transform: ${msg}`);
            throw error instanceof Error ? error : new Error(msg);
        }
    }

    /**
     * Send a message using the streaming path.
     * Delegates to StreamingSession which encapsulates the full state machine.
     */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    sendWithStreaming(
        session: ICopilotSession,
        prompt: string,
        timeoutMs: number,
        onStreamingChunk?: (chunk: string) => void,
        toolCallsMap?: Map<string, ToolCall>,
        onToolEvent?: ((event: ToolEvent) => void),
        idleTimeoutMs?: number,
        attachments?: Attachment[],
        deliveryMode?: DeliveryMode,
        callerSessionId?: string,
    ): Promise<StreamingResult> {
        return new StreamingSession().run(session as Parameters<StreamingSession['run']>[0], {
            prompt,
            timeoutMs,
            onStreamingChunk,
            toolCallsMap,
            onToolEvent: onToolEvent as Parameters<StreamingSession['run']>[1]['onToolEvent'],
            idleTimeoutMs,
            attachments,
            deliveryMode,
            callerSessionId,
        });
    }

    /** Send a message without streaming (non-streaming path). */
    private sendWithTimeout(
        session: ICopilotSession,
        prompt: string,
        timeoutMs: number,
        attachments?: Attachment[],
    ): Promise<{ data?: { content?: string } }> {
        return session.sendAndWait({ prompt, attachments }, timeoutMs);
    }
}
