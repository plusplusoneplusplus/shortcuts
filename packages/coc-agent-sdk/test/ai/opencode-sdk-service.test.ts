/**
 * Unit tests for the OpenCode SDK provider adapter, covering:
 * - Availability detection when SDK is not installed
 * - Availability detection when SDK is installed
 * - sendMessage basic flow
 * - sendMessage with streaming chunks
 * - sendMessage tool events
 * - sendMessage abort
 * - transform delegates to sendMessage with safe defaults
 * - forkSession creates a new session
 * - rewindSession via the native staged revert (chat-only, files never restored)
 * - abortSession / softAbortSession
 * - steerSession returns false
 * - Session tracking (hasActiveSession / getActiveSessionCount)
 * - Lifecycle (cleanup / dispose)
 * - listModels via config.providers()
 * - Registry export and constants
 * - Helper functions (flattenOpenCodeProvidersToModelInfo, parseOpenCodeModelRef)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
    OpenCodeSDKService,
    registerOpenCodeSDKService,
    flattenOpenCodeProvidersToModelInfo,
    parseOpenCodeModelRef,
} from '../../src/opencode-sdk-service';
import {
    OPENCODE_PROVIDER,
    SDK_PROVIDER_OPENCODE,
    sdkServiceRegistry,
} from '../../src/sdk-service-registry';

// ============================================================================
// Module mock for @opencode-ai/sdk
// ============================================================================

vi.mock('../../src/sdk-esm-loader', () => ({
    dynamicImportModule: vi.fn(),
}));

import { dynamicImportModule } from '../../src/sdk-esm-loader';
const mockDynamicImport = vi.mocked(dynamicImportModule);

// ============================================================================
// Mock client builder
// ============================================================================

function createMockClient(overrides: Partial<ReturnType<typeof buildDefaultClient>> = {}) {
    const client = buildDefaultClient();
    return { ...client, ...overrides };
}

function buildDefaultClient() {
    return {
        global: {
            health: vi.fn().mockResolvedValue({ data: { healthy: true, version: '1.0.0' } }),
        },
        config: {
            get: vi.fn().mockResolvedValue({ data: { model: 'anthropic/claude-3-5-sonnet' } }),
            providers: vi.fn().mockResolvedValue({
                data: {
                    providers: [
                        {
                            id: 'anthropic',
                            name: 'Anthropic',
                            models: [
                                { id: 'claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet' },
                                { id: 'claude-3-haiku-20240307', name: 'Claude 3 Haiku' },
                            ],
                        },
                        {
                            id: 'openai',
                            name: 'OpenAI',
                            models: [
                                { id: 'gpt-4o', name: 'GPT-4o' },
                            ],
                        },
                    ],
                    default: { anthropic: 'claude-3-5-sonnet-20241022' },
                },
            }),
        },
        session: {
            list: vi.fn().mockResolvedValue({ data: [] }),
            get: vi.fn().mockResolvedValue({ data: { id: 'session-1' } }),
            create: vi.fn().mockResolvedValue({ data: { id: 'new-session-1' } }),
            delete: vi.fn().mockResolvedValue({ data: true }),
            abort: vi.fn().mockResolvedValue({ data: true }),
            prompt: vi.fn().mockResolvedValue({
                data: {
                    info: { id: 'msg-1', sessionID: 'new-session-1', role: 'assistant' },
                    parts: [{ type: 'text', text: 'Hello from OpenCode!' }],
                },
            }),
            messages: vi.fn().mockResolvedValue({
                data: [
                    {
                        info: { id: 'msg-1', sessionID: 'session-1', role: 'user' },
                        parts: [{ type: 'text', text: 'Hi' }],
                    },
                    {
                        info: { id: 'msg-2', sessionID: 'session-1', role: 'assistant' },
                        parts: [{ type: 'text', text: 'Hello!' }],
                    },
                ],
            }),
        },
        event: {
            subscribe: vi.fn().mockResolvedValue({ stream: (async function* () {})() }),
        },
        app: {
            agents: vi.fn().mockResolvedValue({ data: [{ id: 'coder', name: 'Coder' }] }),
        },
    };
}

function stubSDKWithClient(client: ReturnType<typeof createMockClient>) {
    const createOpencodeClient = vi.fn().mockReturnValue(client);
    const createOpencode = vi.fn().mockResolvedValue({
        client,
        server: { url: 'http://127.0.0.1:4096', close: vi.fn() },
    });
    mockDynamicImport.mockResolvedValue({
        createOpencode,
        createOpencodeClient,
    });
    return { createOpencode, createOpencodeClient };
}

function stubSDKNotInstalled() {
    mockDynamicImport.mockRejectedValue(new Error('Cannot find module \'@opencode-ai/sdk\''));
}

// ============================================================================
// Tests
// ============================================================================

describe('OpenCodeSDKService', () => {
    let svc: OpenCodeSDKService;

    beforeEach(() => {
        svc = new OpenCodeSDKService();
        vi.clearAllMocks();
    });

    afterEach(() => {
        svc.dispose();
    });

    // ── Availability ──────────────────────────────────────────────────────

    describe('isAvailable', () => {
        it('returns available when SDK is installed and exports createOpencode', async () => {
            const client = createMockClient();
            stubSDKWithClient(client);

            const result = await svc.isAvailable();
            expect(result.available).toBe(true);
            expect(result.error).toBeUndefined();
        });

        it('returns unavailable when SDK is not installed', async () => {
            stubSDKNotInstalled();

            const result = await svc.isAvailable();
            expect(result.available).toBe(false);
            expect(result.error).toContain('OpenCode SDK not installed');
        });

        it('returns unavailable when SDK exports nothing useful', async () => {
            mockDynamicImport.mockResolvedValue({});

            const result = await svc.isAvailable();
            expect(result.available).toBe(false);
            expect(result.error).toContain('did not export createOpencode or createOpencodeClient');
        });

        it('caches availability result', async () => {
            const client = createMockClient();
            stubSDKWithClient(client);

            const r1 = await svc.isAvailable();
            const r2 = await svc.isAvailable();
            expect(r1).toBe(r2);
            expect(mockDynamicImport).toHaveBeenCalledTimes(1);
        });

        it('clearAvailabilityCache forces re-check', async () => {
            const client = createMockClient();
            stubSDKWithClient(client);

            await svc.isAvailable();
            svc.clearAvailabilityCache();
            stubSDKNotInstalled();
            const result = await svc.isAvailable();
            expect(result.available).toBe(false);
        });

        it('returns unavailable after dispose', async () => {
            const client = createMockClient();
            stubSDKWithClient(client);

            svc.dispose();
            const result = await svc.isAvailable();
            expect(result.available).toBe(false);
            expect(result.error).toContain('disposed');
        });

        it('resolves SDK from default export', async () => {
            mockDynamicImport.mockResolvedValue({
                default: {
                    createOpencode: vi.fn(),
                    createOpencodeClient: vi.fn(),
                },
            });

            const result = await svc.isAvailable();
            expect(result.available).toBe(true);
        });
    });

    // ── listModels ────────────────────────────────────────────────────────

    describe('listModels', () => {
        it('returns models from providers API', async () => {
            const client = createMockClient();
            stubSDKWithClient(client);

            const models = await svc.listModels();
            expect(models).toEqual([
                { id: 'anthropic/claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet' },
                { id: 'anthropic/claude-3-haiku-20240307', name: 'Claude 3 Haiku' },
                { id: 'openai/gpt-4o', name: 'GPT-4o' },
            ]);
        });

        it('returns fallback when providers API fails', async () => {
            const client = createMockClient();
            client.config.providers.mockRejectedValue(new Error('Network error'));
            stubSDKWithClient(client);

            const models = await svc.listModels();
            expect(models).toEqual([{ id: 'opencode-default', name: 'OpenCode Provider Default' }]);
        });

        it('returns fallback when providers is empty array', async () => {
            const client = createMockClient();
            client.config.providers.mockResolvedValue({ data: { providers: [], default: {} } });
            stubSDKWithClient(client);

            const models = await svc.listModels();
            expect(models).toEqual([{ id: 'opencode-default', name: 'OpenCode Provider Default' }]);
        });

        it('throws after dispose', async () => {
            svc.dispose();
            await expect(svc.listModels()).rejects.toThrow('disposed');
        });
    });

    // ── sendMessage ───────────────────────────────────────────────────────

    describe('sendMessage', () => {
        it('fails before creating a session when read-only roots require enforcement', async () => {
            const client = createMockClient();
            stubSDKWithClient(client);

            const result = await svc.sendMessage({
                prompt: 'compare',
                readOnlyDirectories: ['/reference'],
            });

            expect(result.success).toBe(false);
            expect(result.error).toContain('cannot enforce read-only');
            expect(client.session.create).not.toHaveBeenCalled();
        });

        it('creates a new session and returns text response', async () => {
            const client = createMockClient();
            stubSDKWithClient(client);

            const onSessionCreated = vi.fn();
            const result = await svc.sendMessage({
                prompt: 'Hello',
                onSessionCreated,
            });

            expect(result.success).toBe(true);
            expect(result.response).toBe('Hello from OpenCode!');
            expect(result.sessionId).toBe('new-session-1');
            expect(onSessionCreated).toHaveBeenCalledWith('new-session-1');
        });

        it('resumes an existing session', async () => {
            const client = createMockClient();
            stubSDKWithClient(client);

            const result = await svc.sendMessage({
                prompt: 'Follow up',
                sessionId: 'existing-session-42',
            });

            expect(result.success).toBe(true);
            expect(result.sessionId).toBe('existing-session-42');
            expect(client.session.create).not.toHaveBeenCalled();
            expect(client.session.prompt).toHaveBeenCalledWith({
                path: { id: 'existing-session-42' },
                body: expect.objectContaining({
                    parts: [{ type: 'text', text: 'Follow up' }],
                }),
            });
        });

        it('emits streaming chunks from text parts', async () => {
            const client = createMockClient();
            client.session.prompt.mockResolvedValue({
                data: {
                    info: { id: 'msg-1', sessionID: 'new-session-1', role: 'assistant' },
                    parts: [
                        { type: 'text', text: 'Hello ' },
                        { type: 'text', text: 'World!' },
                    ],
                },
            });
            stubSDKWithClient(client);

            const chunks: string[] = [];
            const result = await svc.sendMessage({
                prompt: 'Hello',
                streaming: true,
                onStreamingChunk: (chunk) => chunks.push(chunk),
            });

            expect(result.success).toBe(true);
            expect(result.response).toBe('Hello World!');
            expect(chunks).toEqual(['Hello ', 'World!', '']);
        });

        it('emits tool events from tool-invocation parts', async () => {
            const client = createMockClient();
            client.session.prompt.mockResolvedValue({
                data: {
                    info: { id: 'msg-1', sessionID: 'new-session-1', role: 'assistant' },
                    parts: [
                        {
                            type: 'tool-invocation',
                            toolCallID: 'tc-1',
                            toolName: 'read_file',
                            state: 'completed',
                            input: { path: '/test.ts' },
                            output: 'file contents here',
                        },
                        { type: 'text', text: 'I read the file.' },
                    ],
                },
            });
            stubSDKWithClient(client);

            const events: Array<{ type: string; toolName?: string }> = [];
            await svc.sendMessage({
                prompt: 'Read the file',
                onToolEvent: (event) => events.push({ type: event.type, toolName: event.toolName }),
            });

            expect(events).toEqual([
                { type: 'tool-complete', toolName: 'read_file' },
            ]);
        });

        it('returns error when SDK is unavailable', async () => {
            stubSDKNotInstalled();

            const result = await svc.sendMessage({ prompt: 'Hello' });
            expect(result.success).toBe(false);
            expect(result.error).toContain('not installed');
        });

        it('returns error when disposed', async () => {
            svc.dispose();
            const result = await svc.sendMessage({ prompt: 'Hello' });
            expect(result.success).toBe(false);
            expect(result.error).toContain('disposed');
        });

        it('returns error when signal is already aborted', async () => {
            const client = createMockClient();
            stubSDKWithClient(client);
            const abortController = new AbortController();
            abortController.abort();

            const result = await svc.sendMessage({
                prompt: 'Hello',
                signal: abortController.signal,
            });
            expect(result.success).toBe(false);
            expect(result.error).toBe('Request aborted');
        });

        it('passes model reference for provider/model format', async () => {
            const client = createMockClient();
            stubSDKWithClient(client);

            await svc.sendMessage({
                prompt: 'Hello',
                model: 'anthropic/claude-3-5-sonnet',
            });

            expect(client.session.prompt).toHaveBeenCalledWith({
                path: { id: 'new-session-1' },
                body: expect.objectContaining({
                    model: { providerID: 'anthropic', modelID: 'claude-3-5-sonnet' },
                }),
            });
        });

        it('omits model ref for provider-default model', async () => {
            const client = createMockClient();
            stubSDKWithClient(client);

            await svc.sendMessage({
                prompt: 'Hello',
                model: 'opencode-default',
            });

            const callBody = client.session.prompt.mock.calls[0]?.[0]?.body;
            expect(callBody?.model).toBeUndefined();
        });

        it('passes system message when provided', async () => {
            const client = createMockClient();
            stubSDKWithClient(client);

            await svc.sendMessage({
                prompt: 'Hello',
                systemMessage: { content: 'You are a helpful assistant' },
            });

            expect(client.session.prompt).toHaveBeenCalledWith({
                path: { id: 'new-session-1' },
                body: expect.objectContaining({
                    system: 'You are a helpful assistant',
                }),
            });
        });

        it('handles prompt API error gracefully', async () => {
            const client = createMockClient();
            client.session.prompt.mockRejectedValue(new Error('Server error'));
            stubSDKWithClient(client);

            const result = await svc.sendMessage({ prompt: 'Hello' });
            expect(result.success).toBe(false);
            expect(result.error).toContain('Server error');
        });

        it('prepends working directory to prompt', async () => {
            const client = createMockClient();
            stubSDKWithClient(client);

            await svc.sendMessage({
                prompt: 'Hello',
                workingDirectory: '/home/user/project',
            });

            const callBody = client.session.prompt.mock.calls[0]?.[0]?.body;
            expect(callBody?.parts[0]?.text).toContain('Working directory: /home/user/project');
            expect(callBody?.parts[0]?.text).toContain('Hello');
        });

        it('appends file attachment references to prompt', async () => {
            const client = createMockClient();
            stubSDKWithClient(client);

            await svc.sendMessage({
                prompt: 'Review these files',
                attachments: [{ filePath: '/tmp/foo.ts' }, { filePath: '/tmp/bar.ts' }] as any,
            });

            const callBody = client.session.prompt.mock.calls[0]?.[0]?.body;
            expect(callBody?.parts[0]?.text).toContain('/tmp/foo.ts');
            expect(callBody?.parts[0]?.text).toContain('/tmp/bar.ts');
        });

        it('enforces strict session resume', async () => {
            const client = createMockClient();
            client.session.get.mockRejectedValue(new Error('Not found'));
            stubSDKWithClient(client);

            const result = await svc.sendMessage({
                prompt: 'Follow up',
                sessionId: 'missing-session',
                strictSessionResume: true,
            });

            expect(result.success).toBe(false);
            expect(result.error).toContain('strictSessionResume');
        });

        it('resolves effective model from server response', async () => {
            const client = createMockClient();
            client.session.prompt.mockResolvedValue({
                data: {
                    info: { id: 'msg-1', sessionID: 'new-session-1', role: 'assistant', model: 'anthropic/claude-3-5-sonnet-v2' },
                    parts: [{ type: 'text', text: 'Hello' }],
                },
            });
            stubSDKWithClient(client);

            const result = await svc.sendMessage({
                prompt: 'Hello',
                model: 'anthropic/claude-3-5-sonnet',
            });

            expect(result.success).toBe(true);
            expect(result.effectiveModel).toBe('anthropic/claude-3-5-sonnet-v2');
        });

        it('emits tool-start event for pending tool state', async () => {
            const client = createMockClient();
            client.session.prompt.mockResolvedValue({
                data: {
                    info: { id: 'msg-1', sessionID: 'new-session-1', role: 'assistant' },
                    parts: [
                        {
                            type: 'tool-invocation',
                            toolCallID: 'tc-2',
                            toolName: 'write_file',
                            state: 'pending',
                            input: { path: '/output.ts', content: 'test' },
                        },
                    ],
                },
            });
            stubSDKWithClient(client);

            const events: Array<{ type: string; toolCallId: string; toolName?: string }> = [];
            await svc.sendMessage({
                prompt: 'Write the file',
                onToolEvent: (e) => events.push({ type: e.type, toolCallId: e.toolCallId, toolName: e.toolName }),
            });

            expect(events).toEqual([{ type: 'tool-start', toolCallId: 'tc-2', toolName: 'write_file' }]);
        });

        it('emits tool-failed event for error state', async () => {
            const client = createMockClient();
            client.session.prompt.mockResolvedValue({
                data: {
                    info: { id: 'msg-1', sessionID: 'new-session-1', role: 'assistant' },
                    parts: [
                        {
                            type: 'tool-invocation',
                            toolCallID: 'tc-3',
                            toolName: 'run_command',
                            state: 'error',
                            error: 'Command timed out',
                        },
                    ],
                },
            });
            stubSDKWithClient(client);

            const events: Array<{ type: string; error?: string }> = [];
            await svc.sendMessage({
                prompt: 'Run the command',
                onToolEvent: (e) => events.push({ type: e.type, error: e.error }),
            });

            expect(events).toEqual([{ type: 'tool-failed', error: 'Command timed out' }]);
        });
    });

    // ── transform ─────────────────────────────────────────────────────────

    describe('transform', () => {
        it('delegates to sendMessage with safe defaults', async () => {
            const client = createMockClient();
            client.session.prompt.mockResolvedValue({
                data: {
                    info: { id: 'msg-1', sessionID: 'new-session-1', role: 'assistant' },
                    parts: [{ type: 'text', text: 'Transformed text' }],
                },
            });
            stubSDKWithClient(client);

            const result = await svc.transform('Transform this');
            expect(result.success).toBe(true);
            expect(result.text).toBe('Transformed text');
        });

        it('returns error result on failure', async () => {
            const client = createMockClient();
            client.session.prompt.mockRejectedValue(new Error('Transform failed'));
            stubSDKWithClient(client);

            const result = await svc.transform('Transform this');
            expect(result.success).toBe(false);
            expect(result.text).toBe('');
            expect(result.error).toContain('Transform failed');
        });

        it('passes model and cwd through options', async () => {
            const client = createMockClient();
            client.session.prompt.mockResolvedValue({
                data: {
                    info: { id: 'msg-1', sessionID: 'new-session-1', role: 'assistant' },
                    parts: [{ type: 'text', text: 'ok' }],
                },
            });
            stubSDKWithClient(client);

            const result = await svc.transform('Transform this', {
                model: 'anthropic/claude-3-5-sonnet',
                cwd: '/tmp/test',
            });
            expect(result.success).toBe(true);
        });
    });

    // ── Session management ────────────────────────────────────────────────

    describe('forkSession', () => {
        it('creates a new session and injects history context', async () => {
            const client = createMockClient();
            stubSDKWithClient(client);
            client.session.create.mockResolvedValue({ data: { id: 'forked-session-1' } });

            const newId = await svc.forkSession('original-session-1');
            expect(newId).toBe('forked-session-1');
            expect(client.session.messages).toHaveBeenCalledWith({ path: { id: 'original-session-1' } });
            // Injected context via noReply prompt
            expect(client.session.prompt).toHaveBeenCalledWith({
                path: { id: 'forked-session-1' },
                body: expect.objectContaining({ noReply: true }),
            });
        });

        it('returns new session even when history copy fails', async () => {
            const client = createMockClient();
            client.session.messages.mockRejectedValue(new Error('Not found'));
            client.session.create.mockResolvedValue({ data: { id: 'forked-session-2' } });
            stubSDKWithClient(client);

            const newId = await svc.forkSession('missing-session');
            expect(newId).toBe('forked-session-2');
        });

        it('throws when disposed', async () => {
            svc.dispose();
            await expect(svc.forkSession('any')).rejects.toThrow('disposed');
        });
    });

    // ── Rewind (AC-02 / AC-05) ────────────────────────────────────────────

    describe('rewindSession', () => {
        /** Staged-revert API shim mirroring opencode's v2 `Revert` class. */
        function createRevertApi() {
            return {
                stage: vi.fn().mockResolvedValue({ data: { messageID: 'msg-7' } }),
                commit: vi.fn().mockResolvedValue({ data: undefined }),
                clear: vi.fn().mockResolvedValue({ data: undefined }),
            };
        }

        it('stages and commits a native revert, never restoring files', async () => {
            const revert = createRevertApi();
            const client = createMockClient();
            (client.session as Record<string, unknown>).revert = revert;
            stubSDKWithClient(client);

            const result = await svc.rewindSession('session-1', 'msg-7');

            expect(revert.stage).toHaveBeenCalledWith({
                sessionID: 'session-1',
                messageID: 'msg-7',
                files: false,
            });
            expect(revert.commit).toHaveBeenCalledWith({ sessionID: 'session-1' });
            // AC-05: file snapshots must not be restored.
            expect(revert.stage.mock.calls[0][0].files).toBe(false);
            // In-place truncate — the session id is unchanged.
            expect(result).toEqual({ eventsRemoved: 0, upToEventId: 'msg-7' });
        });

        it('reports a removed count when the revert payload carries one', async () => {
            const revert = createRevertApi();
            revert.stage.mockResolvedValue({ data: { messageID: 'msg-7', eventsRemoved: 4 } });
            const client = createMockClient();
            (client.session as Record<string, unknown>).revert = revert;
            stubSDKWithClient(client);

            const result = await svc.rewindSession('session-1', 'msg-7');
            expect(result.eventsRemoved).toBe(4);
        });

        it('falls back to the v2 client when the primary client has no staged revert', async () => {
            const revert = createRevertApi();
            const client = createMockClient();
            // v1 shape: `session.revert` is a plain function that restores files.
            (client.session as Record<string, unknown>).revert = vi.fn();
            const v2Client = { session: { revert } };
            const createV2Client = vi.fn().mockReturnValue(v2Client);
            mockDynamicImport.mockImplementation(async (specifier: string) => {
                if (specifier.includes('/v2/')) return { createOpencodeClient: createV2Client };
                return {
                    createOpencode: vi.fn().mockResolvedValue({
                        client,
                        server: { url: 'http://127.0.0.1:4096', close: vi.fn() },
                    }),
                    createOpencodeClient: vi.fn().mockReturnValue(client),
                };
            });

            const result = await svc.rewindSession('session-1', 'msg-7');
            expect(createV2Client).toHaveBeenCalledWith(
                expect.objectContaining({ baseUrl: 'http://127.0.0.1:4096' }),
            );
            expect(revert.stage).toHaveBeenCalledWith({
                sessionID: 'session-1',
                messageID: 'msg-7',
                files: false,
            });
            expect(result.upToEventId).toBe('msg-7');
        });

        it('throws REWIND_UNSUPPORTED when no staged revert API is reachable', async () => {
            const client = createMockClient();
            // Only the file-reverting v1 endpoint exists — must not be used.
            const legacyRevert = vi.fn();
            (client.session as Record<string, unknown>).revert = legacyRevert;
            stubSDKWithClient(client);

            await expect(svc.rewindSession('session-1', 'msg-7')).rejects.toMatchObject({
                code: 'REWIND_UNSUPPORTED',
                provider: OPENCODE_PROVIDER,
            });
            expect(legacyRevert).not.toHaveBeenCalled();
        });

        it('propagates a staged revert error and never commits', async () => {
            const revert = createRevertApi();
            revert.stage.mockResolvedValue({ error: { message: 'message not found' } });
            const client = createMockClient();
            (client.session as Record<string, unknown>).revert = revert;
            stubSDKWithClient(client);

            await expect(svc.rewindSession('session-1', 'msg-7')).rejects.toThrow('message not found');
            expect(revert.commit).not.toHaveBeenCalled();
        });

        it('propagates a commit error', async () => {
            const revert = createRevertApi();
            revert.commit.mockResolvedValue({ error: 'session busy' });
            const client = createMockClient();
            (client.session as Record<string, unknown>).revert = revert;
            stubSDKWithClient(client);

            await expect(svc.rewindSession('session-1', 'msg-7')).rejects.toThrow('session busy');
        });

        it('throws when disposed', async () => {
            svc.dispose();
            await expect(svc.rewindSession('session-1', 'msg-7')).rejects.toThrow('disposed');
        });
    });

    // AC-04: the user turn must carry a native anchor so it can be rewound later.
    // For opencode that anchor is the message id `revert.stage({ messageID })`
    // takes, read back from the session's message list after the prompt settles.
    describe('sendMessage rewind anchor (AC-04)', () => {
        it('returns the last user message id as userMessageEventId', async () => {
            const client = createMockClient();
            client.session.messages = vi.fn().mockResolvedValue({
                data: [
                    { info: { id: 'msg-old-user', sessionID: 's1', role: 'user' }, parts: [] },
                    { info: { id: 'msg-old-assistant', sessionID: 's1', role: 'assistant' }, parts: [] },
                    { info: { id: 'msg-new-user', sessionID: 's1', role: 'user' }, parts: [] },
                    { info: { id: 'msg-new-assistant', sessionID: 's1', role: 'assistant' }, parts: [] },
                ],
            });
            stubSDKWithClient(client);

            const result = await svc.sendMessage({ prompt: 'Hello', sessionId: 's1' });

            expect(result.success).toBe(true);
            expect(result.userMessageEventId).toBe('msg-new-user');
            expect(client.session.messages).toHaveBeenCalledWith({ path: { id: 's1' } });
        });

        it('leaves the anchor undefined when the session has no user message', async () => {
            const client = createMockClient();
            client.session.messages = vi.fn().mockResolvedValue({
                data: [{ info: { id: 'msg-a', sessionID: 's1', role: 'assistant' }, parts: [] }],
            });
            stubSDKWithClient(client);

            const result = await svc.sendMessage({ prompt: 'Hello', sessionId: 's1' });

            expect(result.success).toBe(true);
            expect(result.userMessageEventId).toBeUndefined();
        });

        it('still succeeds when the anchor lookup fails', async () => {
            const client = createMockClient();
            client.session.messages = vi.fn().mockRejectedValue(new Error('boom'));
            stubSDKWithClient(client);

            const result = await svc.sendMessage({ prompt: 'Hello', sessionId: 's1' });

            expect(result.success).toBe(true);
            expect(result.response).toBe('Hello from OpenCode!');
            expect(result.userMessageEventId).toBeUndefined();
        });
    });

    describe('abortSession', () => {
        it('aborts an active session and calls server abort', async () => {
            const client = createMockClient();
            stubSDKWithClient(client);

            await svc.sendMessage({ prompt: 'Hello' });
            // Session is already removed from active map after sendMessage completes,
            // but the server-side abort should still be called.
            const result = await svc.abortSession('new-session-1');
            expect(client.session.abort).toHaveBeenCalledWith({ path: { id: 'new-session-1' } });
            expect(result).toBe(true);
        });

        it('returns false for unknown session when server abort fails', async () => {
            const client = createMockClient();
            client.session.abort.mockRejectedValue(new Error('Not found'));
            stubSDKWithClient(client);

            const result = await svc.abortSession('nonexistent');
            expect(result).toBe(false);
        });
    });

    describe('softAbortSession', () => {
        it('delegates to abortSession', async () => {
            const client = createMockClient();
            stubSDKWithClient(client);

            const result = await svc.softAbortSession('any-session');
            expect(client.session.abort).toHaveBeenCalledWith({ path: { id: 'any-session' } });
            expect(result).toBe(true);
        });
    });

    describe('steerSession', () => {
        it('returns false (not supported)', async () => {
            const result = await svc.steerSession('any-session', 'new instructions');
            expect(result).toBe(false);
        });
    });

    describe('hasActiveSession / getActiveSessionCount', () => {
        it('returns false/0 when no sessions are active', () => {
            expect(svc.hasActiveSession('any')).toBe(false);
            expect(svc.getActiveSessionCount()).toBe(0);
        });
    });

    // ── Lifecycle ─────────────────────────────────────────────────────────

    describe('cleanup', () => {
        it('clears all cached state', async () => {
            const client = createMockClient();
            stubSDKWithClient(client);

            await svc.isAvailable();
            await svc.cleanup();

            // Availability cache was cleared; next call re-checks
            stubSDKNotInstalled();
            const result = await svc.isAvailable();
            expect(result.available).toBe(false);
        });
    });

    describe('dispose', () => {
        it('marks service as disposed', () => {
            svc.dispose();
            expect(svc.hasActiveSession('any')).toBe(false);
            expect(svc.getActiveSessionCount()).toBe(0);
        });

        it('closes owned server on dispose', async () => {
            const closeFn = vi.fn();
            const client = createMockClient();
            // Make health check fail so ensureClient goes through createOpencode path
            const createOpencodeClient = vi.fn().mockReturnValue(
                createMockClient({
                    global: {
                        health: vi.fn().mockRejectedValue(new Error('No server')),
                    },
                } as any),
            );
            const createOpencode = vi.fn().mockResolvedValue({
                client,
                server: { url: 'http://127.0.0.1:4096', close: closeFn },
            });
            mockDynamicImport.mockResolvedValue({ createOpencode, createOpencodeClient });

            await svc.listModels();
            svc.dispose();
            expect(closeFn).toHaveBeenCalled();
        });
    });

    // ── Registration ──────────────────────────────────────────────────────

    describe('registerOpenCodeSDKService', () => {
        afterEach(() => {
            sdkServiceRegistry.unregister(OPENCODE_PROVIDER);
        });

        it('registers service under opencode key', () => {
            const registered = registerOpenCodeSDKService();
            expect(sdkServiceRegistry.has(OPENCODE_PROVIDER)).toBe(true);
            expect(sdkServiceRegistry.get(OPENCODE_PROVIDER)).toBe(registered);
            registered.dispose();
        });
    });

    describe('provider constants', () => {
        it('OPENCODE_PROVIDER is "opencode"', () => {
            expect(OPENCODE_PROVIDER).toBe('opencode');
        });

        it('SDK_PROVIDER_OPENCODE is an alias for OPENCODE_PROVIDER', () => {
            expect(SDK_PROVIDER_OPENCODE).toBe(OPENCODE_PROVIDER);
        });
    });
});

// ============================================================================
// Helper function tests
// ============================================================================

describe('flattenOpenCodeProvidersToModelInfo', () => {
    it('flattens providers into composite model IDs', () => {
        const result = flattenOpenCodeProvidersToModelInfo([
            {
                id: 'anthropic',
                name: 'Anthropic',
                models: [
                    { id: 'claude-3-5-sonnet', name: 'Claude 3.5 Sonnet' },
                    { id: 'claude-3-haiku', name: 'Claude 3 Haiku' },
                ],
            },
            {
                id: 'openai',
                name: 'OpenAI',
                models: [{ id: 'gpt-4o', name: 'GPT-4o' }],
            },
        ]);

        expect(result).toEqual([
            { id: 'anthropic/claude-3-5-sonnet', name: 'Claude 3.5 Sonnet' },
            { id: 'anthropic/claude-3-haiku', name: 'Claude 3 Haiku' },
            { id: 'openai/gpt-4o', name: 'GPT-4o' },
        ]);
    });

    it('uses model id as name when name is not provided', () => {
        const result = flattenOpenCodeProvidersToModelInfo([
            { id: 'test', models: [{ id: 'model-1' }] },
        ]);
        expect(result).toEqual([{ id: 'test/model-1', name: 'model-1' }]);
    });

    it('returns fallback for empty providers', () => {
        const result = flattenOpenCodeProvidersToModelInfo([]);
        expect(result).toEqual([{ id: 'opencode-default', name: 'OpenCode Provider Default' }]);
    });

    it('returns fallback for provider with no models', () => {
        const result = flattenOpenCodeProvidersToModelInfo([
            { id: 'empty', models: [] },
        ]);
        expect(result).toEqual([{ id: 'opencode-default', name: 'OpenCode Provider Default' }]);
    });

    it('skips models without id', () => {
        const result = flattenOpenCodeProvidersToModelInfo([
            { id: 'test', models: [{ id: '' }, { id: 'valid-model' }] },
        ]);
        expect(result).toEqual([{ id: 'test/valid-model', name: 'valid-model' }]);
    });

    it('skips providers without models array', () => {
        const result = flattenOpenCodeProvidersToModelInfo([
            { id: 'no-models' } as any,
            { id: 'has-models', models: [{ id: 'm1', name: 'Model 1' }] },
        ]);
        expect(result).toEqual([{ id: 'has-models/m1', name: 'Model 1' }]);
    });
});

describe('parseOpenCodeModelRef', () => {
    it('parses provider/model format', () => {
        expect(parseOpenCodeModelRef('anthropic/claude-3-5-sonnet')).toEqual({
            providerID: 'anthropic',
            modelID: 'claude-3-5-sonnet',
        });
    });

    it('returns undefined for empty string', () => {
        expect(parseOpenCodeModelRef('')).toBeUndefined();
    });

    it('returns undefined for undefined', () => {
        expect(parseOpenCodeModelRef(undefined)).toBeUndefined();
    });

    it('returns undefined for opencode-default', () => {
        expect(parseOpenCodeModelRef('opencode-default')).toBeUndefined();
    });

    it('returns undefined for provider-default', () => {
        expect(parseOpenCodeModelRef('provider-default')).toBeUndefined();
    });

    it('returns undefined for default', () => {
        expect(parseOpenCodeModelRef('default')).toBeUndefined();
    });

    it('handles bare model name without slash', () => {
        const result = parseOpenCodeModelRef('gpt-4o');
        expect(result).toEqual({
            providerID: '',
            modelID: 'gpt-4o',
        });
    });

    it('handles whitespace-padded input', () => {
        expect(parseOpenCodeModelRef('  anthropic/claude-3-5-sonnet  ')).toEqual({
            providerID: 'anthropic',
            modelID: 'claude-3-5-sonnet',
        });
    });

    it('handles model with multiple slashes', () => {
        expect(parseOpenCodeModelRef('provider/model/variant')).toEqual({
            providerID: 'provider',
            modelID: 'model/variant',
        });
    });
});

describe('provider-model-resolver with opencode', () => {
    it('accepts any model for opencode provider', async () => {
        const { resolveModelForProvider } = await import('../../src/provider-model-resolver');
        expect(resolveModelForProvider('opencode', 'anthropic/claude-3-5-sonnet')).toEqual({
            model: 'anthropic/claude-3-5-sonnet',
            coerced: false,
            requestedModel: 'anthropic/claude-3-5-sonnet',
        });
    });

    it('accepts bare model names for opencode', async () => {
        const { resolveModelForProvider } = await import('../../src/provider-model-resolver');
        expect(resolveModelForProvider('opencode', 'gpt-4o')).toEqual({
            model: 'gpt-4o',
            coerced: false,
            requestedModel: 'gpt-4o',
        });
    });

    it('treats opencode-default as provider default', async () => {
        const { resolveModelForProvider } = await import('../../src/provider-model-resolver');
        expect(resolveModelForProvider('opencode', 'opencode-default')).toEqual({
            coerced: false,
            requestedModel: 'opencode-default',
        });
    });

    it('treats default as provider default for opencode', async () => {
        const { resolveModelForProvider } = await import('../../src/provider-model-resolver');
        expect(resolveModelForProvider('opencode', 'default')).toEqual({
            coerced: false,
            requestedModel: 'default',
        });
    });
});
