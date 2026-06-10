/**
 * RequestRunner — executes SDK requests on behalf of CopilotSDKService.
 *
 * Contains the full sendMessage() and transform() logic, extracted from the
 * service facade so the facade can remain a thin wiring layer.
 *
 * Dependencies are injected at construction time so this class can be tested
 * independently of CopilotSDKService.
 */

import type { CopilotClient, CopilotSession, SessionConfig, AssistantMessageEvent, SessionEvent } from '@github/copilot-sdk';
import { ToolCall } from './tool-call';
import { getAIServiceLogger, createSessionLogger } from './logger';
import { loadEffectiveMcpConfig } from './mcp-config-loader';
import {
    SendMessageOptions,
    TokenUsage,
    SDKInvocationResult,
    SDKAvailabilityResult,
    PermissionRequest,
    PermissionRequestResult,
    ExtendedSdkRequest,
    denyAllPermissions,
    isPermissionApproved,
    Attachment,
    DeliveryMode,
    ToolEvent,
} from './types';
import { StreamingSession, StreamingResult } from './streaming-session';
import type { TransformOptions, TransformResult } from './sdk-service-interface';
import { SessionManager } from './session-manager';
import { isStreamDestroyedError } from './stream-error-guard';
import { isWithinDirectory } from './internal/path-security';
import { resolveWorkspaceExecutionContext, translatePathForExecution } from './internal/workspace-execution';

const DEFAULT_AI_TIMEOUT_MS = 6 * 60 * 60 * 1000;

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
        private readonly createClient: (cwd?: string) => Promise<CopilotClient>,
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
        const throwIfAborted = () => {
            if (options.signal?.aborted) {
                throw new Error('Request aborted');
            }
        };

        const availability = await this.isAvailable();
        if (!availability.available) {
            return { success: false, error: availability.error || 'Copilot SDK is not available' };
        }

        let session: CopilotSession | null = null;
        let client: CopilotClient | null = null;
        let result: SDKInvocationResult | null = null;
        let removeAbortListener: (() => void) | undefined;

        // When the caller provides a pre-created client we reuse it and must
        // NOT stop it in the finally block — the caller owns its lifecycle.
        const clientOwned = !options.client;

        try {
            throwIfAborted();
            client = options.client ?? await this.createClient(options.workingDirectory);
            throwIfAborted();
            const preparedAttachments = this.prepareAttachments(options.attachments, options.workingDirectory);

            // Build session options — start with the required permission handler
            // so we can incrementally add optional fields.
            const effectiveHandler = options.onPermissionRequest || denyAllPermissions;
            const toolCallsMap = new Map<string, ToolCall>();

            const sessionOptions: SessionConfig = {
                onPermissionRequest: (request: PermissionRequest, invocation: { sessionId: string }) => {
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
                                const approved = isPermissionApproved(permResult);
                                tc.permissionResult = {
                                    approved,
                                    timestamp: new Date(),
                                    reason: !approved ? permResult.kind : undefined,
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
                },
            };

            const switchModelAfterSessionCreate = !!(options.model && options.reasoningEffort);

            if (options.model && !switchModelAfterSessionCreate) sessionOptions.model = options.model;
            if (options.streaming) sessionOptions.streaming = options.streaming;
            if (options.tools) sessionOptions.tools = options.tools;
            if (options.systemMessage) sessionOptions.systemMessage = options.systemMessage;
            if (options.reasoningEffort && !switchModelAfterSessionCreate) sessionOptions.reasoningEffort = options.reasoningEffort;
            if (options.availableTools) sessionOptions.availableTools = options.availableTools;
            if (options.excludedTools) sessionOptions.excludedTools = options.excludedTools;
            if (options.skillDirectories?.length) sessionOptions.skillDirectories = options.skillDirectories;
            if (options.disabledSkills?.length) sessionOptions.disabledSkills = options.disabledSkills;
            if (options.infiniteSessions !== undefined) sessionOptions.infiniteSessions = options.infiniteSessions;
            if (options.onUserInputRequest) sessionOptions.onUserInputRequest = options.onUserInputRequest;

            // Load and merge MCP server configurations
            const shouldLoadDefaultMcp = options.loadDefaultMcpConfig !== false;
            if (shouldLoadDefaultMcp || options.mcpServers !== undefined) {
                const effectiveMcpConfig = loadEffectiveMcpConfig({
                    workingDirectory: options.workingDirectory,
                    explicitMcpServers: options.mcpServers,
                    loadDefaultMcpConfig: options.loadDefaultMcpConfig,
                });
                const finalMcpServers = effectiveMcpConfig.mcpServers;
                aiLog.debug({
                    success: effectiveMcpConfig.success,
                    fileExists: effectiveMcpConfig.fileExists,
                    serverCount: Object.keys(finalMcpServers).length,
                }, 'Effective MCP config loaded');
                if (effectiveMcpConfig.error) aiLog.debug({ error: effectiveMcpConfig.error }, 'Effective MCP config error');

                if (finalMcpServers && Object.keys(finalMcpServers).length > 0) {
                    // Forge's MCPLocalServerConfig allows optional `args`; the SDK requires `string[]`.
                    // The SDK treats missing args as [] at runtime, so the cast is safe.
                    sessionOptions.mcpServers = finalMcpServers as SessionConfig['mcpServers'];
                    aiLog.debug({ serverCount: Object.keys(finalMcpServers).length }, 'Using MCP servers');
                } else if (options.mcpServers !== undefined && Object.keys(options.mcpServers).length === 0) {
                    sessionOptions.mcpServers = {};
                    aiLog.debug('MCP servers explicitly disabled');
                }
            }

            const sessionOptionsForLog = Object.fromEntries(
                Object.entries(sessionOptions).map(([key, value]) => [
                    key,
                    key === 'mcpServers' && value && typeof value === 'object'
                        ? { serverCount: Object.keys(value).length }
                        : value,
                ]),
            );
            const sessionOptionsStr = Object.keys(sessionOptions).length > 0
                ? JSON.stringify(sessionOptionsForLog)
                : '(default)';

            // Resume an existing SDK session or create a new one
            if (options.sessionId) {
                aiLog.debug({ cwd: options.workingDirectory, sessionId: options.sessionId, sessionOptionsStr }, 'Resuming session');
                try {
                    session = await client.resumeSession(options.sessionId, sessionOptions);
                    aiLog.debug({ sessionId: session.sessionId }, 'Session resumed');
                } catch (resumeError) {
                    const resumeMsg = resumeError instanceof Error ? resumeError.message : String(resumeError);
                    aiLog.error({ oldSessionId: options.sessionId, error: resumeMsg }, 'Session resume failed — falling back to createSession (conversation history lost)');
                    session = await client.createSession(sessionOptions);
                    aiLog.debug({ oldSessionId: options.sessionId, newSessionId: session.sessionId }, 'Fallback session created');
                }
            } else {
                aiLog.debug({ cwd: options.workingDirectory, sessionOptionsStr }, 'Creating session');
                session = await client.createSession(sessionOptions);
                aiLog.debug({ sessionId: session.sessionId }, 'Session created');
            }

            const sessionLog = createSessionLogger(session.sessionId);
            options.onSessionCreated?.(session.sessionId);

            if (options.onMcpOAuthRequired && typeof session.on === 'function') {
                try {
                    session.on('mcp.oauth_required', (event: { id?: string; data: { requestId: string; serverName: string; serverUrl: string } }) => {
                        const evtData = event.data;
                        sessionLog.info(
                            { serverName: evtData.serverName, serverUrl: evtData.serverUrl, requestId: evtData.requestId },
                            '[MCP OAuth] oauth_required event received',
                        );
                        // Defensive: try the experimental RPC if the SDK exposes it.
                        // The method may not exist on the installed SDK build, so we
                        // probe it dynamically and never let a failure here disrupt
                        // the session.
                        const rpc = (session as unknown as { rpc?: { mcp?: { oauth?: { login?: (p: { serverName: string }) => Promise<{ authorizationUrl?: string }> } } } }).rpc;
                        const loginFn = rpc?.mcp?.oauth?.login;
                        sessionLog.debug(
                            { serverName: evtData.serverName, hasLoginRpc: typeof loginFn === 'function' },
                            '[MCP OAuth] RPC login function probe',
                        );
                        const dispatch = (authorizationUrl?: string) => {
                            sessionLog.debug(
                                { serverName: evtData.serverName, hasAuthorizationUrl: !!authorizationUrl },
                                '[MCP OAuth] Dispatching OAuth event to handler',
                            );
                            try {
                                options.onMcpOAuthRequired!({
                                    serverName: evtData.serverName,
                                    serverUrl: evtData.serverUrl,
                                    authorizationUrl,
                                    requestId: evtData.requestId,
                                    sessionId: session!.sessionId,
                                });
                            } catch (cbErr) {
                                sessionLog.warn({ err: cbErr instanceof Error ? cbErr.message : String(cbErr) }, 'onMcpOAuthRequired callback threw');
                            }
                        };
                        if (typeof loginFn === 'function') {
                            sessionLog.debug({ serverName: evtData.serverName }, '[MCP OAuth] Calling mcp.oauth.login RPC');
                            Promise.resolve()
                                .then(() => loginFn.call(rpc!.mcp!.oauth, { serverName: evtData.serverName }))
                                .then(loginResult => {
                                    sessionLog.debug(
                                        { serverName: evtData.serverName, hasAuthorizationUrl: !!loginResult?.authorizationUrl },
                                        '[MCP OAuth] mcp.oauth.login RPC succeeded',
                                    );
                                    dispatch(loginResult?.authorizationUrl);
                                })
                                .catch(loginErr => {
                                    sessionLog.warn({ serverName: evtData.serverName, err: loginErr instanceof Error ? loginErr.message : String(loginErr) }, 'mcp.oauth.login RPC failed; dispatching without URL');
                                    dispatch(undefined);
                                });
                        } else {
                            sessionLog.debug({ serverName: evtData.serverName }, '[MCP OAuth] No login RPC; dispatching without authorization URL');
                            dispatch(undefined);
                        }
                    });
                    sessionLog.debug('[MCP OAuth] Subscribed to mcp.oauth_required events');
                } catch (subErr) {
                    sessionLog.warn({ err: subErr instanceof Error ? subErr.message : String(subErr) }, 'Failed to subscribe to mcp.oauth_required');
                }
            } else if (options.onMcpOAuthRequired) {
                sessionLog.debug('[MCP OAuth] onMcpOAuthRequired provided but session.on is not available; OAuth events will not be captured');
            }

            // Proactive MCP OAuth probe: after session creation, attempt to call
            // mcp.oauth.login for each remote MCP server. The SDK may silently skip
            // servers that require OAuth during session initialization (never
            // connecting them), so the reactive `mcp.oauth_required` event never
            // fires. By probing login upfront we detect auth requirements early and
            // surface the authorization URL to the user via the existing handler.
            if (options.onMcpOAuthRequired && sessionOptions.mcpServers) {
                const rpc = (session as unknown as { rpc?: { mcp?: { oauth?: { login?: (p: { serverName: string }) => Promise<{ authorizationUrl?: string }> } } } }).rpc;
                const loginFn = rpc?.mcp?.oauth?.login;
                if (typeof loginFn === 'function') {
                    const remoteServers = Object.entries(sessionOptions.mcpServers as Record<string, { type?: string; url?: string }>)
                        .filter(([, cfg]) => cfg.type === 'http' || cfg.type === 'sse');
                    if (remoteServers.length > 0) {
                        sessionLog.debug({ remoteServerCount: remoteServers.length }, '[MCP OAuth] Proactively probing OAuth for remote MCP servers');
                        // Fire-and-forget: don't block the message send
                        for (const [serverName, cfg] of remoteServers) {
                            Promise.resolve()
                                .then(() => loginFn.call(rpc!.mcp!.oauth, { serverName }))
                                .then(loginResult => {
                                    if (loginResult?.authorizationUrl) {
                                        sessionLog.info(
                                            { serverName, hasAuthorizationUrl: true },
                                            '[MCP OAuth] Proactive probe: server requires OAuth',
                                        );
                                        try {
                                            options.onMcpOAuthRequired!({
                                                serverName,
                                                serverUrl: (cfg as { url?: string }).url ?? serverName,
                                                authorizationUrl: loginResult.authorizationUrl,
                                                requestId: `proactive-${serverName}-${Date.now()}`,
                                                sessionId: session!.sessionId,
                                            });
                                        } catch (cbErr) {
                                            sessionLog.warn({ err: cbErr instanceof Error ? cbErr.message : String(cbErr) }, '[MCP OAuth] Proactive probe handler threw');
                                        }
                                    } else {
                                        sessionLog.debug({ serverName }, '[MCP OAuth] Proactive probe: no auth required or already authenticated');
                                    }
                                })
                                .catch(probeErr => {
                                    sessionLog.debug(
                                        { serverName, err: probeErr instanceof Error ? probeErr.message : String(probeErr) },
                                        '[MCP OAuth] Proactive probe failed (non-fatal)',
                                    );
                                });
                        }
                    }
                } else {
                    sessionLog.debug('[MCP OAuth] Proactive probe skipped: mcp.oauth.login RPC not available');
                }
            }

            if (switchModelAfterSessionCreate) {
                await session.setModel(options.model!, { reasoningEffort: options.reasoningEffort });
                sessionLog.debug({ model: options.model, reasoningEffort: options.reasoningEffort }, 'Model set after session creation');
            }

            const abortSession = () => {
                sessionLog.debug('Abort signal received — disconnecting session');
                const disconnect = () => session?.disconnect().catch(() => {});
                const abort = typeof (session as { abort?: () => Promise<void> }).abort === 'function'
                    ? (session as { abort: () => Promise<void> }).abort().catch(() => undefined).then(disconnect)
                    : disconnect();
                Promise.resolve(abort).catch(() => {});
            };
            options.signal?.addEventListener('abort', abortSession, { once: true });
            removeAbortListener = () => options.signal?.removeEventListener('abort', abortSession);
            if (options.signal?.aborted) {
                abortSession();
                throwIfAborted();
            }

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

            if ((options.streaming || options.onStreamingChunk || timeoutMs > 120000) && typeof session.on === 'function' && typeof session.send === 'function') {
                const idleTimeoutMs = options.idleTimeoutMs ?? this.defaultIdleTimeoutMs;
                const streamingResult = await this.sendWithStreaming(session, options.prompt, timeoutMs, options.onStreamingChunk, toolCallsMap, options.onToolEvent, idleTimeoutMs, preparedAttachments, options.deliveryMode, options.sessionId, options.onBackgroundTasksChanged, options.toolResultInterceptors);
                throwIfAborted();
                response = streamingResult.response;
                tokenUsage = streamingResult.tokenUsage;
                turnCount = streamingResult.turnCount;
                capturedToolCalls = streamingResult.toolCalls;
            } else {
                const sendResult = await this.sendWithTimeout(session, options.prompt, timeoutMs, preparedAttachments);
                throwIfAborted();
                response = sendResult?.data?.content || '';
            }

            const durationMs = Date.now() - startTime;
            sessionLog.debug({ durationMs }, 'Request completed');

            if (!response) {
                if (turnCount > 0) {
                    sessionLog.debug({ durationMs, turnCount }, 'Empty text response — treating as success (tool-based execution)');
                    result = { success: true, response: '', sessionId: session.sessionId, effectiveModel: options.model, tokenUsage, toolCalls: capturedToolCalls };
                    return result;
                }
                result = { success: false, error: 'No response received from Copilot SDK', sessionId: session.sessionId, effectiveModel: options.model, tokenUsage, toolCalls: capturedToolCalls };
                return result;
            }

            result = { success: true, response, sessionId: session.sessionId, effectiveModel: options.model, tokenUsage, toolCalls: capturedToolCalls };
            return result;

        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            const durationMs = Date.now() - startTime;

            if (session) {
                createSessionLogger(session.sessionId).error({ durationMs, err: error instanceof Error ? error : undefined }, 'Request failed');
            } else {
                aiLog.error({ durationMs, err: error instanceof Error ? error : undefined }, 'Request failed (no session)');
            }

            if (isStreamDestroyedError(errorMessage) && client && clientOwned) {
                aiLog.debug('Stream destroyed — invalidating client');
                client.stop().catch(() => {});
                client = null;
            }

            result = { success: false, error: `Copilot SDK error: ${errorMessage}`, sessionId: session?.sessionId, effectiveModel: options.model };
            return result;

        } finally {
            removeAbortListener?.();
            if (session) {
                this.sessionManager.untrack(session.sessionId);
                const finalSessionLog = createSessionLogger(session.sessionId);
                try {
                    await session.disconnect();
                    finalSessionLog.debug('Session disconnected');
                } catch (disconnectError) {
                    finalSessionLog.debug({ err: disconnectError }, 'Warning: Error disconnecting session');
                }
                if (client && clientOwned) {
                    try { await client.stop(); } catch { /* ignore */ }
                }
            } else if (client && clientOwned) {
                try { await client.stop(); } catch { /* ignore */ }
            }
        }
    }

    private prepareAttachments(attachments: Attachment[] | undefined, workingDirectory?: string): Attachment[] | undefined {
        if (!attachments || attachments.length === 0) {
            return attachments;
        }

        const executionContext = resolveWorkspaceExecutionContext(workingDirectory);
        if (executionContext.kind !== 'wsl') {
            return attachments;
        }

        return attachments.map(attachment => {
            const translatedPath = translatePathForExecution(attachment.path, executionContext);
            if (!isWithinDirectory(translatedPath, executionContext.linuxWorkingDirectory)) {
                throw new Error(`WSL mode currently only supports attachments inside the working directory: ${attachment.path}`);
            }
            return {
                ...attachment,
                path: translatedPath,
            };
        });
    }

    /**
     * Runs a single isolated transform request and returns a structured result.
     *
     * The request is fresh: it never resumes a session and never reuses a
     * caller-visible client. By default it runs with no MCP servers/tools
     * (`loadDefaultMcpConfig: false`) and denies every permission request, so it
     * cannot perform side effects unless the caller overrides those defaults.
     * The SDK owns no model default — when `options.model` is omitted the
     * provider default applies.
     *
     * @param sendFn - Optional send override (defaults to this.send). Pass
     *   `service.sendMessage.bind(service)` from the facade so tests can spy on sendMessage.
     */
    async transform(
        input: string,
        options?: TransformOptions,
        sendFn?: (opts: SendMessageOptions) => Promise<SDKInvocationResult>,
    ): Promise<TransformResult> {
        const doSend = sendFn ?? ((opts: SendMessageOptions) => this.send(opts));
        const aiLog = getAIServiceLogger();
        try {
            const result = await doSend({
                prompt: input,
                model: options?.model,
                timeoutMs: options?.timeoutMs ?? this.defaultTimeoutMs,
                workingDirectory: options?.cwd,
                signal: options?.signal,
                loadDefaultMcpConfig: options?.loadDefaultMcpConfig ?? false,
                onPermissionRequest: options?.onPermissionRequest ?? denyAllPermissions,
            });
            if (!result.success) {
                return {
                    success: false,
                    text: '',
                    error: result.error || 'AI transform failed',
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
        } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            aiLog.error({ err: error instanceof Error ? error : undefined }, `transform: ${msg}`);
            return { success: false, text: '', error: msg };
        }
    }

    /**
     * Send a message using the streaming path.
     * Delegates to StreamingSession which encapsulates the full state machine.
     */
    sendWithStreaming(
        session: CopilotSession,
        prompt: string,
        timeoutMs: number,
        onStreamingChunk?: (chunk: string) => void,
        toolCallsMap?: Map<string, ToolCall>,
        onToolEvent?: ((event: ToolEvent) => void),
        idleTimeoutMs?: number,
        attachments?: Attachment[],
        deliveryMode?: DeliveryMode,
        callerSessionId?: string,
        onBackgroundTasksChanged?: SendMessageOptions['onBackgroundTasksChanged'],
        toolResultInterceptors?: SendMessageOptions['toolResultInterceptors'],
    ): Promise<StreamingResult> {
        return new StreamingSession().run(session as Parameters<StreamingSession['run']>[0], {
            prompt,
            timeoutMs,
            onStreamingChunk,
            toolCallsMap,
            onToolEvent: onToolEvent as Parameters<StreamingSession['run']>[1]['onToolEvent'],
            onBackgroundTasksChanged,
            idleTimeoutMs,
            attachments,
            deliveryMode,
            callerSessionId,
            toolResultInterceptors,
        });
    }

    /**
     * Send a message without streaming (non-streaming path).
     *
     * Deliberately does NOT use the SDK's `sendAndWait()`: that helper rejects
     * its internal idle promise from a `session.error` handler, but only
     * attaches rejection handling after `await send()` resolves. When the
     * error event outraces the send acknowledgment (observed on slow CI hosts
     * with an unauthenticated CLI), the rejection has no handler attached and
     * surfaces as an unhandled rejection in the host process. This
     * re-implementation attaches all handlers before issuing `send()`.
     */
    private async sendWithTimeout(
        session: CopilotSession,
        prompt: string,
        timeoutMs: number,
        attachments?: Attachment[],
    ): Promise<AssistantMessageEvent | undefined> {
        if (typeof session.on !== 'function' || typeof session.send !== 'function') {
            return session.sendAndWait({ prompt, attachments }, timeoutMs);
        }

        let lastAssistantMessage: AssistantMessageEvent | undefined;
        let unsubscribe: (() => void) | undefined;
        let timeoutId: ReturnType<typeof setTimeout> | undefined;
        try {
            const settled = new Promise<AssistantMessageEvent | undefined>((resolve, reject) => {
                unsubscribe = session.on((event: SessionEvent) => {
                    if (event.type === 'assistant.message') {
                        lastAssistantMessage = event as AssistantMessageEvent;
                    } else if (event.type === 'session.idle') {
                        resolve(lastAssistantMessage);
                    } else if (event.type === 'session.error') {
                        const data = (event as { data?: { message?: string; stack?: string } }).data;
                        const error = new Error(data?.message ?? 'Unknown session error');
                        if (data?.stack) error.stack = data.stack;
                        reject(error);
                    }
                });
                timeoutId = setTimeout(
                    () => reject(new Error(`Timeout after ${timeoutMs}ms waiting for session.idle`)),
                    timeoutMs,
                );
            });
            // Mark `settled` handled before send() is issued so a session.error
            // arriving mid-send can never become an unhandled rejection; the
            // real consumer is the `await settled` below.
            settled.catch(() => { /* consumed below */ });
            await session.send({ prompt, attachments });
            return await settled;
        } finally {
            if (timeoutId !== undefined) clearTimeout(timeoutId);
            unsubscribe?.();
        }
    }
}
