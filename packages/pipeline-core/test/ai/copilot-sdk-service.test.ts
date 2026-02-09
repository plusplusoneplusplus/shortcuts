/**
 * Copilot SDK Service Tests (pipeline-core)
 *
 * Tests for the CopilotSDKService internals, focusing on client initialization,
 * automatic folder trust registration, and streaming event handling.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { CopilotSDKService, resetCopilotSDKService } from '../../src/ai/copilot-sdk-service';
import { setLogger, nullLogger } from '../../src/logger';
import * as trustedFolder from '../../src/ai/trusted-folder';

// Suppress logger output during tests
setLogger(nullLogger);

// Mock the trusted-folder module so we can verify calls without touching disk
vi.mock('../../src/ai/trusted-folder', async () => {
    const actual = await vi.importActual('../../src/ai/trusted-folder');
    return {
        ...actual,
        ensureFolderTrusted: vi.fn(),
    };
});

// Mock the mcp-config-loader module to avoid file system access
vi.mock('../../src/ai/mcp-config-loader', () => ({
    loadDefaultMcpConfig: vi.fn().mockReturnValue({
        success: false,
        fileExists: false,
        mcpServers: {},
    }),
    mergeMcpConfigs: vi.fn().mockImplementation(
        (base: Record<string, any>, override?: Record<string, any>) => ({
            ...base,
            ...override,
        }),
    ),
}));

/**
 * Create a mock SDK module that captures constructor options.
 */
function createMockSDKModule() {
    const capturedOptions: any[] = [];

    const mockClient = {
        createSession: vi.fn().mockResolvedValue({
            sessionId: 'test-session',
            sendAndWait: vi.fn().mockResolvedValue('response'),
            destroy: vi.fn().mockResolvedValue(undefined),
        }),
        stop: vi.fn().mockResolvedValue(undefined),
    };

    class MockCopilotClient {
        constructor(options?: any) {
            capturedOptions.push(options);
            Object.assign(this, mockClient);
        }
    }

    return { MockCopilotClient, capturedOptions, mockClient };
}

/**
 * Helper to create a mock session with streaming support.
 * The session captures event handlers registered via `on()` and supports
 * simulating SDK events by calling the handler directly.
 * 
 * SDK events use `event.type` as a plain string (e.g., "session.idle"),
 * NOT as `{ value: string }`.
 */
function createStreamingMockSession() {
    const handlers: Array<(event: any) => void> = [];

    const session = {
        sessionId: 'streaming-session-' + Math.random().toString(36).substring(7),
        sendAndWait: vi.fn(),
        destroy: vi.fn().mockResolvedValue(undefined),
        on: vi.fn().mockImplementation((handler: (event: any) => void) => {
            handlers.push(handler);
            return () => {
                const idx = handlers.indexOf(handler);
                if (idx >= 0) handlers.splice(idx, 1);
            };
        }),
        send: vi.fn().mockResolvedValue(undefined),
    };

    /**
     * Dispatch an event to all registered handlers.
     * Events are plain objects with `type` as a string — matching the real SDK behavior.
     */
    const dispatchEvent = (event: { type: string; data?: any }) => {
        for (const handler of [...handlers]) {
            handler(event);
        }
    };

    return { session, dispatchEvent, handlers };
}

/**
 * Create a mock SDK module whose sessions support streaming.
 */
function createStreamingMockSDKModule(sessionFactory?: () => ReturnType<typeof createStreamingMockSession>) {
    const capturedOptions: any[] = [];
    const sessions: Array<ReturnType<typeof createStreamingMockSession>> = [];

    const createSession = () => {
        const s = sessionFactory ? sessionFactory() : createStreamingMockSession();
        sessions.push(s);
        return s;
    };

    const mockClient = {
        createSession: vi.fn().mockImplementation(() => {
            const s = createSession();
            return Promise.resolve(s.session);
        }),
        stop: vi.fn().mockResolvedValue(undefined),
    };

    class MockCopilotClient {
        constructor(options?: any) {
            capturedOptions.push(options);
            Object.assign(this, mockClient);
        }
    }

    return { MockCopilotClient, capturedOptions, mockClient, sessions };
}

describe('CopilotSDKService - Client Initialization', () => {
    let service: CopilotSDKService;

    beforeEach(() => {
        resetCopilotSDKService();
        service = CopilotSDKService.getInstance();
        vi.clearAllMocks();
    });

    afterEach(async () => {
        service.dispose();
        resetCopilotSDKService();
    });

    it('should call ensureFolderTrusted with cwd when working directory is specified', async () => {
        const { MockCopilotClient } = createMockSDKModule();

        const serviceAny = service as any;
        serviceAny.sdkModule = { CopilotClient: MockCopilotClient };

        await serviceAny.initializeClient('/some/project/path');

        expect(trustedFolder.ensureFolderTrusted).toHaveBeenCalledWith('/some/project/path');
    });

    it('should not call ensureFolderTrusted when no working directory is given', async () => {
        const { MockCopilotClient } = createMockSDKModule();

        const serviceAny = service as any;
        serviceAny.sdkModule = { CopilotClient: MockCopilotClient };

        await serviceAny.initializeClient(undefined);

        expect(trustedFolder.ensureFolderTrusted).not.toHaveBeenCalled();
    });

    it('should call ensureFolderTrusted for each new cwd when client is re-created', async () => {
        const { MockCopilotClient } = createMockSDKModule();

        const serviceAny = service as any;
        serviceAny.sdkModule = { CopilotClient: MockCopilotClient };

        await serviceAny.initializeClient('/first/path');
        await serviceAny.initializeClient('/second/path');

        expect(trustedFolder.ensureFolderTrusted).toHaveBeenCalledTimes(2);
        expect(trustedFolder.ensureFolderTrusted).toHaveBeenCalledWith('/first/path');
        expect(trustedFolder.ensureFolderTrusted).toHaveBeenCalledWith('/second/path');
    });

    it('should still create client successfully even if ensureFolderTrusted throws', async () => {
        const { MockCopilotClient, capturedOptions } = createMockSDKModule();
        vi.mocked(trustedFolder.ensureFolderTrusted).mockImplementation(() => {
            throw new Error('Permission denied');
        });

        const serviceAny = service as any;
        serviceAny.sdkModule = { CopilotClient: MockCopilotClient };

        // Should not throw — ensureFolderTrusted errors are non-fatal
        await serviceAny.initializeClient('/some/path');

        expect(capturedOptions).toHaveLength(1);
        expect(capturedOptions[0].cwd).toBe('/some/path');
    });
});

// ============================================================================
// Streaming Event Handling Tests
// ============================================================================

describe('CopilotSDKService - Streaming (sendWithStreaming)', () => {
    let service: CopilotSDKService;

    beforeEach(() => {
        resetCopilotSDKService();
        service = CopilotSDKService.getInstance();
        vi.clearAllMocks();
    });

    afterEach(async () => {
        service.dispose();
        resetCopilotSDKService();
    });

    /**
     * Helper: set up the service with a streaming mock and call sendMessage.
     * Returns the session mock and a promise for the result.
     * 
     * Uses timeoutMs > 120000 to force the streaming path, or streaming: true.
     */
    function setupStreamingCall(options?: { streaming?: boolean; timeoutMs?: number }) {
        const { MockCopilotClient, sessions } = createStreamingMockSDKModule();
        const serviceAny = service as any;
        serviceAny.sdkModule = { CopilotClient: MockCopilotClient };
        serviceAny.availabilityCache = { available: true, sdkPath: '/fake/sdk' };

        const resultPromise = service.sendMessage({
            prompt: 'Test prompt',
            workingDirectory: '/test',
            // Trigger streaming path: either by explicit streaming flag or long timeout
            streaming: options?.streaming,
            timeoutMs: options?.timeoutMs ?? 200000, // > 120000 triggers streaming
            loadDefaultMcpConfig: false,
        });

        // Return sessions array — the session is created asynchronously
        return { sessions, resultPromise };
    }

    it('should resolve when session.idle event fires (event.type is a plain string)', async () => {
        const { sessions, resultPromise } = setupStreamingCall();

        // Wait for session to be created (yield to microtask queue)
        await vi.waitFor(() => {
            expect(sessions.length).toBe(1);
            expect(sessions[0].session.on).toHaveBeenCalled();
        }, { timeout: 1000 });

        const { dispatchEvent } = sessions[0];

        // Simulate assistant.message event (SDK uses plain string type)
        dispatchEvent({ type: 'assistant.message', data: { content: 'Hello world', messageId: 'msg-1' } });
        // Simulate session.idle event (SDK uses plain string type)
        dispatchEvent({ type: 'session.idle', data: {} });

        const result = await resultPromise;
        expect(result.success).toBe(true);
        expect(result.response).toBe('Hello world');
    });

    it('should accumulate delta chunks with camelCase deltaContent field', async () => {
        const { sessions, resultPromise } = setupStreamingCall();

        await vi.waitFor(() => {
            expect(sessions.length).toBe(1);
            expect(sessions[0].session.on).toHaveBeenCalled();
        }, { timeout: 1000 });

        const { dispatchEvent } = sessions[0];

        // Simulate streaming delta events (SDK uses camelCase deltaContent)
        dispatchEvent({ type: 'assistant.message_delta', data: { deltaContent: 'Hello ', messageId: 'msg-1' } });
        dispatchEvent({ type: 'assistant.message_delta', data: { deltaContent: 'world', messageId: 'msg-1' } });
        // No assistant.message final event — only deltas + idle
        dispatchEvent({ type: 'session.idle', data: {} });

        const result = await resultPromise;
        expect(result.success).toBe(true);
        expect(result.response).toBe('Hello world');
    });

    it('should prefer final assistant.message over accumulated deltas', async () => {
        const { sessions, resultPromise } = setupStreamingCall();

        await vi.waitFor(() => {
            expect(sessions.length).toBe(1);
            expect(sessions[0].session.on).toHaveBeenCalled();
        }, { timeout: 1000 });

        const { dispatchEvent } = sessions[0];

        // Simulate streaming deltas followed by a final message
        dispatchEvent({ type: 'assistant.message_delta', data: { deltaContent: 'partial...' } });
        // Final message should take precedence
        dispatchEvent({ type: 'assistant.message', data: { content: 'Final complete answer', messageId: 'msg-1' } });
        dispatchEvent({ type: 'session.idle', data: {} });

        const result = await resultPromise;
        expect(result.success).toBe(true);
        expect(result.response).toBe('Final complete answer');
    });

    it('should handle session.error events during streaming', async () => {
        const { sessions, resultPromise } = setupStreamingCall();

        await vi.waitFor(() => {
            expect(sessions.length).toBe(1);
            expect(sessions[0].session.on).toHaveBeenCalled();
        }, { timeout: 1000 });

        const { dispatchEvent } = sessions[0];

        // Simulate a session error
        dispatchEvent({ type: 'session.error', data: { message: 'Rate limit exceeded', stack: 'Error: ...' } });

        const result = await resultPromise;
        expect(result.success).toBe(false);
        expect(result.error).toContain('Rate limit exceeded');
    });

    it('should timeout if no events arrive within timeoutMs', async () => {
        // Use a very short timeout to make the test fast
        const { sessions, resultPromise } = setupStreamingCall({ timeoutMs: 200000 });

        await vi.waitFor(() => {
            expect(sessions.length).toBe(1);
            expect(sessions[0].session.on).toHaveBeenCalled();
        }, { timeout: 1000 });

        // Access the private sendWithStreaming method directly for faster timeout test
        const serviceAny = service as any;
        const { session } = sessions[0];

        // Test sendWithStreaming directly with a short timeout
        const streamingPromise = serviceAny.sendWithStreaming(session, 'test', 50);

        // Wait for the timeout to fire — don't dispatch any events
        await expect(streamingPromise).rejects.toThrow('Request timed out after 50ms');
    });

    it('should unsubscribe event handler after session.idle resolves', async () => {
        const { sessions, resultPromise } = setupStreamingCall();

        await vi.waitFor(() => {
            expect(sessions.length).toBe(1);
            expect(sessions[0].session.on).toHaveBeenCalled();
        }, { timeout: 1000 });

        const { dispatchEvent, handlers } = sessions[0];

        // Before idle, handler should be registered
        expect(handlers.length).toBe(1);

        dispatchEvent({ type: 'assistant.message', data: { content: 'Done', messageId: 'msg-1' } });
        dispatchEvent({ type: 'session.idle', data: {} });

        await resultPromise;

        // After idle, handler should be unsubscribed
        expect(handlers.length).toBe(0);
    });

    it('should unsubscribe event handler after session.error', async () => {
        const { sessions, resultPromise } = setupStreamingCall();

        await vi.waitFor(() => {
            expect(sessions.length).toBe(1);
            expect(sessions[0].session.on).toHaveBeenCalled();
        }, { timeout: 1000 });

        const { dispatchEvent, handlers } = sessions[0];

        expect(handlers.length).toBe(1);

        dispatchEvent({ type: 'session.error', data: { message: 'Something broke' } });

        await resultPromise;

        // Handler should be cleaned up after error
        expect(handlers.length).toBe(0);
    });

    it('should handle send() rejection', async () => {
        const { MockCopilotClient, sessions } = createStreamingMockSDKModule(() => {
            const mock = createStreamingMockSession();
            // Make send() reject
            mock.session.send = vi.fn().mockRejectedValue(new Error('Network error'));
            return mock;
        });

        const serviceAny = service as any;
        serviceAny.sdkModule = { CopilotClient: MockCopilotClient };
        serviceAny.availabilityCache = { available: true, sdkPath: '/fake/sdk' };

        const result = await service.sendMessage({
            prompt: 'Test prompt',
            workingDirectory: '/test',
            timeoutMs: 200000,
            loadDefaultMcpConfig: false,
        });

        expect(result.success).toBe(false);
        expect(result.error).toContain('Network error');
    });

    it('should handle empty response gracefully', async () => {
        const { sessions, resultPromise } = setupStreamingCall();

        await vi.waitFor(() => {
            expect(sessions.length).toBe(1);
            expect(sessions[0].session.on).toHaveBeenCalled();
        }, { timeout: 1000 });

        const { dispatchEvent } = sessions[0];

        // Session goes idle without any content events
        dispatchEvent({ type: 'session.idle', data: {} });

        const result = await resultPromise;
        // Empty response should be treated as no response
        expect(result.success).toBe(false);
        expect(result.error).toContain('No response received');
    });

    it('should use streaming path when streaming option is explicitly true', async () => {
        const { sessions, resultPromise } = setupStreamingCall({ streaming: true, timeoutMs: 5000 });

        await vi.waitFor(() => {
            expect(sessions.length).toBe(1);
            expect(sessions[0].session.on).toHaveBeenCalled();
        }, { timeout: 1000 });

        const { dispatchEvent } = sessions[0];

        dispatchEvent({ type: 'assistant.message', data: { content: 'Streaming response', messageId: 'msg-1' } });
        dispatchEvent({ type: 'session.idle', data: {} });

        const result = await resultPromise;
        expect(result.success).toBe(true);
        expect(result.response).toBe('Streaming response');
        // session.send should have been called (not sendAndWait)
        expect(sessions[0].session.send).toHaveBeenCalled();
        expect(sessions[0].session.sendAndWait).not.toHaveBeenCalled();
    });

    it('should not settle twice on duplicate session.idle events', async () => {
        const { sessions, resultPromise } = setupStreamingCall();

        await vi.waitFor(() => {
            expect(sessions.length).toBe(1);
            expect(sessions[0].session.on).toHaveBeenCalled();
        }, { timeout: 1000 });

        const { dispatchEvent } = sessions[0];

        dispatchEvent({ type: 'assistant.message', data: { content: 'First', messageId: 'msg-1' } });
        dispatchEvent({ type: 'session.idle', data: {} });
        // Second idle should be ignored (already settled)
        dispatchEvent({ type: 'session.idle', data: {} });

        const result = await resultPromise;
        expect(result.success).toBe(true);
        expect(result.response).toBe('First');
    });

    it('should not settle twice on error after success', async () => {
        const { sessions, resultPromise } = setupStreamingCall();

        await vi.waitFor(() => {
            expect(sessions.length).toBe(1);
            expect(sessions[0].session.on).toHaveBeenCalled();
        }, { timeout: 1000 });

        const { dispatchEvent } = sessions[0];

        dispatchEvent({ type: 'assistant.message', data: { content: 'OK', messageId: 'msg-1' } });
        dispatchEvent({ type: 'session.idle', data: {} });
        // Error after idle should be ignored (already settled)
        dispatchEvent({ type: 'session.error', data: { message: 'Late error' } });

        const result = await resultPromise;
        expect(result.success).toBe(true);
        expect(result.response).toBe('OK');
    });

    it('should handle delta events with missing deltaContent gracefully', async () => {
        const { sessions, resultPromise } = setupStreamingCall();

        await vi.waitFor(() => {
            expect(sessions.length).toBe(1);
            expect(sessions[0].session.on).toHaveBeenCalled();
        }, { timeout: 1000 });

        const { dispatchEvent } = sessions[0];

        // Delta events with no deltaContent field — should accumulate empty strings
        dispatchEvent({ type: 'assistant.message_delta', data: {} });
        dispatchEvent({ type: 'assistant.message_delta', data: { deltaContent: 'actual content' } });
        dispatchEvent({ type: 'session.idle', data: {} });

        const result = await resultPromise;
        expect(result.success).toBe(true);
        expect(result.response).toBe('actual content');
    });
});

// ============================================================================
// Non-streaming (sendAndWait) Path Tests
// ============================================================================

describe('CopilotSDKService - Non-streaming (sendAndWait)', () => {
    let service: CopilotSDKService;

    beforeEach(() => {
        resetCopilotSDKService();
        service = CopilotSDKService.getInstance();
        vi.clearAllMocks();
    });

    afterEach(async () => {
        service.dispose();
        resetCopilotSDKService();
    });

    it('should use sendAndWait when timeout <= 120000 and streaming is not set', async () => {
        const mockSession = {
            sessionId: 'non-streaming-session',
            sendAndWait: vi.fn().mockResolvedValue({ data: { content: 'Non-streaming response' } }),
            destroy: vi.fn().mockResolvedValue(undefined),
            on: vi.fn(),
            send: vi.fn(),
        };

        const capturedOptions: any[] = [];
        const mockClient = {
            createSession: vi.fn().mockResolvedValue(mockSession),
            stop: vi.fn().mockResolvedValue(undefined),
        };

        class MockCopilotClient {
            constructor(options?: any) {
                capturedOptions.push(options);
                Object.assign(this, mockClient);
            }
        }

        const serviceAny = service as any;
        serviceAny.sdkModule = { CopilotClient: MockCopilotClient };
        serviceAny.availabilityCache = { available: true, sdkPath: '/fake/sdk' };

        const result = await service.sendMessage({
            prompt: 'Test',
            workingDirectory: '/test',
            timeoutMs: 60000, // <= 120000, should use sendAndWait
            loadDefaultMcpConfig: false,
        });

        expect(result.success).toBe(true);
        expect(result.response).toBe('Non-streaming response');
        expect(mockSession.sendAndWait).toHaveBeenCalledWith({ prompt: 'Test' }, 60000);
        expect(mockSession.send).not.toHaveBeenCalled();
    });

    it('should fall back to sendAndWait when session lacks on/send methods', async () => {
        const mockSession = {
            sessionId: 'basic-session',
            sendAndWait: vi.fn().mockResolvedValue({ data: { content: 'Basic response' } }),
            destroy: vi.fn().mockResolvedValue(undefined),
            // No on() or send() methods — streaming not supported
        };

        const mockClient = {
            createSession: vi.fn().mockResolvedValue(mockSession),
            stop: vi.fn().mockResolvedValue(undefined),
        };

        class MockCopilotClient {
            constructor() {
                Object.assign(this, mockClient);
            }
        }

        const serviceAny = service as any;
        serviceAny.sdkModule = { CopilotClient: MockCopilotClient };
        serviceAny.availabilityCache = { available: true, sdkPath: '/fake/sdk' };

        const result = await service.sendMessage({
            prompt: 'Test',
            workingDirectory: '/test',
            timeoutMs: 200000, // Long timeout but no streaming support
            loadDefaultMcpConfig: false,
        });

        expect(result.success).toBe(true);
        expect(result.response).toBe('Basic response');
        expect(mockSession.sendAndWait).toHaveBeenCalled();
    });
});
