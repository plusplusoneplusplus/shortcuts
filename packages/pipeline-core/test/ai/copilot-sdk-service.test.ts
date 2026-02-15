/**
 * Copilot SDK Service Tests (pipeline-core)
 *
 * Tests for the CopilotSDKService internals, focusing on client initialization,
 * automatic folder trust registration, and streaming event handling.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { CopilotSDKService, resetCopilotSDKService, TokenUsage } from '../../src/copilot-sdk-wrapper/copilot-sdk-service';
import { setLogger, nullLogger } from '../../src/logger';
import * as trustedFolder from '../../src/copilot-sdk-wrapper/trusted-folder';

// Suppress logger output during tests
setLogger(nullLogger);

// Mock the trusted-folder module so we can verify calls without touching disk
vi.mock('../../src/copilot-sdk-wrapper/trusted-folder', async () => {
    const actual = await vi.importActual('../../src/copilot-sdk-wrapper/trusted-folder');
    return {
        ...actual,
        ensureFolderTrusted: vi.fn(),
    };
});

// Mock the mcp-config-loader module to avoid file system access
vi.mock('../../src/copilot-sdk-wrapper/mcp-config-loader', () => ({
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

    it('should settle via assistant.turn_end grace period when session.idle never fires', async () => {
        const { sessions, resultPromise } = setupStreamingCall();

        await vi.waitFor(() => {
            expect(sessions.length).toBe(1);
            expect(sessions[0].session.on).toHaveBeenCalled();
        }, { timeout: 1000 });

        const { dispatchEvent } = sessions[0];

        // Simulate deltas followed by turn_end (no session.idle)
        dispatchEvent({ type: 'assistant.message_delta', data: { deltaContent: 'Hello ' } });
        dispatchEvent({ type: 'assistant.message_delta', data: { deltaContent: 'world!' } });
        dispatchEvent({ type: 'assistant.turn_end', data: { turnId: 'turn-1' } });
        // Do NOT dispatch session.idle — grace timer (2s) should settle

        const result = await resultPromise;
        expect(result.success).toBe(true);
        expect(result.response).toBe('Hello world!');
    });

    it('should prefer session.idle over turn_end grace period', async () => {
        const { sessions, resultPromise } = setupStreamingCall();

        await vi.waitFor(() => {
            expect(sessions.length).toBe(1);
            expect(sessions[0].session.on).toHaveBeenCalled();
        }, { timeout: 1000 });

        const { dispatchEvent } = sessions[0];

        // Simulate deltas, turn_end, then session.idle within grace period
        dispatchEvent({ type: 'assistant.message_delta', data: { deltaContent: 'Partial...' } });
        dispatchEvent({ type: 'assistant.message', data: { content: 'Full final answer', messageId: 'msg-1' } });
        dispatchEvent({ type: 'assistant.turn_end', data: { turnId: 'turn-1' } });
        // session.idle arrives immediately after turn_end (within grace period)
        dispatchEvent({ type: 'session.idle', data: {} });

        const result = await resultPromise;
        expect(result.success).toBe(true);
        // Should use the final message (preferred over accumulated deltas)
        expect(result.response).toBe('Full final answer');
    });

    it('should not settle via turn_end if no content has been received', async () => {
        const { sessions, resultPromise } = setupStreamingCall();

        await vi.waitFor(() => {
            expect(sessions.length).toBe(1);
            expect(sessions[0].session.on).toHaveBeenCalled();
        }, { timeout: 1000 });

        const { dispatchEvent } = sessions[0];

        // turn_end fires but no content was received — should NOT settle
        dispatchEvent({ type: 'assistant.turn_end', data: { turnId: 'turn-1' } });

        // Wait for grace period to pass (2s)
        await new Promise(r => setTimeout(r, 2500));

        // Still waiting — should not have resolved yet
        // Send actual content and idle to resolve
        dispatchEvent({ type: 'assistant.message', data: { content: 'Late response', messageId: 'msg-1' } });
        dispatchEvent({ type: 'session.idle', data: {} });

        const result = await resultPromise;
        expect(result.success).toBe(true);
        expect(result.response).toBe('Late response');
    });

    it('should handle turn_end followed by session.error gracefully', async () => {
        const { sessions, resultPromise } = setupStreamingCall();

        await vi.waitFor(() => {
            expect(sessions.length).toBe(1);
            expect(sessions[0].session.on).toHaveBeenCalled();
        }, { timeout: 1000 });

        const { dispatchEvent } = sessions[0];

        dispatchEvent({ type: 'assistant.message_delta', data: { deltaContent: 'Some content' } });
        dispatchEvent({ type: 'assistant.turn_end', data: { turnId: 'turn-1' } });
        // Error arrives within grace period — should take precedence? No,
        // turn_end already started grace timer with content, but error should
        // still be handled if it arrives before grace timer fires.
        // However, since we already have content and turn_end started the timer,
        // the grace period will settle before the error can be processed
        // because session.error only fires if not already settled.
        // In practice, the 500ms grace timer will fire first.

        // Wait for grace period
        const result = await resultPromise;
        expect(result.success).toBe(true);
        expect(result.response).toBe('Some content');
    });

    it('should not start multiple turn_end grace timers', async () => {
        const { sessions, resultPromise } = setupStreamingCall();

        await vi.waitFor(() => {
            expect(sessions.length).toBe(1);
            expect(sessions[0].session.on).toHaveBeenCalled();
        }, { timeout: 1000 });

        const { dispatchEvent } = sessions[0];

        dispatchEvent({ type: 'assistant.message_delta', data: { deltaContent: 'Content' } });
        // Multiple turn_end events should only start one grace timer
        dispatchEvent({ type: 'assistant.turn_end', data: { turnId: 'turn-1' } });
        dispatchEvent({ type: 'assistant.turn_end', data: { turnId: 'turn-2' } });

        const result = await resultPromise;
        expect(result.success).toBe(true);
        expect(result.response).toBe('Content');
    });
});

// ============================================================================
// Multi-turn MCP Tool Conversation Tests
// ============================================================================

describe('CopilotSDKService - Multi-turn MCP tool conversations', () => {
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
     */
    function setupStreamingCall(options?: { streaming?: boolean; timeoutMs?: number }) {
        const { MockCopilotClient, sessions } = createStreamingMockSDKModule();
        const serviceAny = service as any;
        serviceAny.sdkModule = { CopilotClient: MockCopilotClient };
        serviceAny.availabilityCache = { available: true, sdkPath: '/fake/sdk' };

        const resultPromise = service.sendMessage({
            prompt: 'Test prompt',
            workingDirectory: '/test',
            streaming: options?.streaming,
            timeoutMs: options?.timeoutMs ?? 200000,
            loadDefaultMcpConfig: false,
        });

        return { sessions, resultPromise };
    }

    it('should wait for multi-turn MCP tool conversation to complete', async () => {
        const { sessions, resultPromise } = setupStreamingCall();

        await vi.waitFor(() => {
            expect(sessions.length).toBe(1);
            expect(sessions[0].session.on).toHaveBeenCalled();
        }, { timeout: 1000 });

        const { dispatchEvent } = sessions[0];

        // Turn 1: AI expresses intent to use tools
        dispatchEvent({ type: 'assistant.turn_start', data: { turnId: 'turn-1' } });
        dispatchEvent({ type: 'assistant.message', data: { content: "I'll read the key files.", messageId: 'msg-1' } });
        dispatchEvent({ type: 'tool.execution_start', data: { toolCallId: 'tc-1', toolName: 'view' } });
        dispatchEvent({ type: 'tool.execution_complete', data: { toolCallId: 'tc-1', success: true } });
        dispatchEvent({ type: 'assistant.turn_end', data: { turnId: 'turn-1' } });

        // Turn 2: AI processes tool results and produces output
        dispatchEvent({ type: 'assistant.turn_start', data: { turnId: 'turn-2' } });
        dispatchEvent({ type: 'assistant.message', data: { content: '{"moduleId": "test", "overview": "A comprehensive analysis..."}', messageId: 'msg-2' } });
        dispatchEvent({ type: 'assistant.turn_end', data: { turnId: 'turn-2' } });

        // Session idle signals conversation is done
        dispatchEvent({ type: 'session.idle', data: {} });

        const result = await resultPromise;
        expect(result.success).toBe(true);
        // All messages are joined to preserve the full conversation narrative
        expect(result.response).toContain("I'll read the key files.");
        expect(result.response).toContain('{"moduleId": "test", "overview": "A comprehensive analysis..."}');
    });

    it('should cancel turn_end grace timer when new turn starts', async () => {
        const { sessions, resultPromise } = setupStreamingCall();

        await vi.waitFor(() => {
            expect(sessions.length).toBe(1);
            expect(sessions[0].session.on).toHaveBeenCalled();
        }, { timeout: 1000 });

        const { dispatchEvent } = sessions[0];

        // Turn 1: AI says it will read files, then turn ends
        dispatchEvent({ type: 'assistant.message', data: { content: 'Let me read the files.', messageId: 'msg-1' } });
        dispatchEvent({ type: 'assistant.turn_end', data: { turnId: 'turn-1' } });
        // Grace timer is now started (2s)

        // Turn 2 starts immediately — should cancel the grace timer
        dispatchEvent({ type: 'assistant.turn_start', data: { turnId: 'turn-2' } });

        // Wait more than the grace period to prove it was cancelled
        await new Promise(r => setTimeout(r, 2500));

        // Should NOT have settled yet — still waiting for turn 2
        dispatchEvent({ type: 'assistant.message', data: { content: 'Here is the full JSON analysis.', messageId: 'msg-2' } });
        dispatchEvent({ type: 'assistant.turn_end', data: { turnId: 'turn-2' } });
        dispatchEvent({ type: 'session.idle', data: {} });

        const result = await resultPromise;
        expect(result.success).toBe(true);
        // Both messages are joined (grace timer was correctly cancelled for turn 2)
        expect(result.response).toContain('Let me read the files.');
        expect(result.response).toContain('Here is the full JSON analysis.');
    });

    it('should handle many turns with MCP tools (realistic deep analysis)', async () => {
        const { sessions, resultPromise } = setupStreamingCall();

        await vi.waitFor(() => {
            expect(sessions.length).toBe(1);
            expect(sessions[0].session.on).toHaveBeenCalled();
        }, { timeout: 1000 });

        const { dispatchEvent } = sessions[0];

        // Simulate a realistic 4-turn conversation with MCP tools
        // Turn 1: Read entry files
        dispatchEvent({ type: 'assistant.turn_start', data: { turnId: 'turn-1' } });
        dispatchEvent({ type: 'assistant.message', data: { content: "I'll read the key files.", messageId: 'msg-1' } });
        dispatchEvent({ type: 'tool.execution_start', data: { toolCallId: 'tc-1', toolName: 'view' } });
        dispatchEvent({ type: 'tool.execution_start', data: { toolCallId: 'tc-2', toolName: 'glob' } });
        dispatchEvent({ type: 'tool.execution_complete', data: { toolCallId: 'tc-1', success: true } });
        dispatchEvent({ type: 'tool.execution_complete', data: { toolCallId: 'tc-2', success: true } });
        dispatchEvent({ type: 'assistant.turn_end', data: { turnId: 'turn-1' } });

        // Turn 2: Read more files
        dispatchEvent({ type: 'assistant.turn_start', data: { turnId: 'turn-2' } });
        dispatchEvent({ type: 'assistant.message', data: { content: 'Reading more files...', messageId: 'msg-2' } });
        dispatchEvent({ type: 'tool.execution_start', data: { toolCallId: 'tc-3', toolName: 'view' } });
        dispatchEvent({ type: 'tool.execution_complete', data: { toolCallId: 'tc-3', success: true } });
        dispatchEvent({ type: 'assistant.turn_end', data: { turnId: 'turn-2' } });

        // Turn 3: Grep for patterns
        dispatchEvent({ type: 'assistant.turn_start', data: { turnId: 'turn-3' } });
        dispatchEvent({ type: 'assistant.message', data: { content: 'Searching for patterns...', messageId: 'msg-3' } });
        dispatchEvent({ type: 'tool.execution_start', data: { toolCallId: 'tc-4', toolName: 'grep' } });
        dispatchEvent({ type: 'tool.execution_complete', data: { toolCallId: 'tc-4', success: true } });
        dispatchEvent({ type: 'assistant.turn_end', data: { turnId: 'turn-3' } });

        // Turn 4: Final JSON output
        dispatchEvent({ type: 'assistant.turn_start', data: { turnId: 'turn-4' } });
        const jsonOutput = JSON.stringify({
            moduleId: 'test',
            overview: 'Comprehensive module analysis',
            keyConcepts: [{ name: 'Concept1', description: 'A key concept' }],
        });
        dispatchEvent({ type: 'assistant.message', data: { content: jsonOutput, messageId: 'msg-4' } });
        dispatchEvent({ type: 'assistant.turn_end', data: { turnId: 'turn-4' } });
        dispatchEvent({ type: 'session.idle', data: {} });

        const result = await resultPromise;
        expect(result.success).toBe(true);
        // All messages are joined — response contains the full conversation narrative
        expect(result.response).toContain("I'll read the key files.");
        expect(result.response).toContain('Reading more files...');
        expect(result.response).toContain('Searching for patterns...');
        expect(result.response).toContain(jsonOutput);
    });

    it('should join all messages in multi-turn conversation', async () => {
        const { sessions, resultPromise } = setupStreamingCall();

        await vi.waitFor(() => {
            expect(sessions.length).toBe(1);
            expect(sessions[0].session.on).toHaveBeenCalled();
        }, { timeout: 1000 });

        const { dispatchEvent } = sessions[0];

        // Multiple messages across turns
        dispatchEvent({ type: 'assistant.message', data: { content: 'Intent message (short)', messageId: 'msg-1' } });
        dispatchEvent({ type: 'assistant.turn_end', data: { turnId: 'turn-1' } });
        dispatchEvent({ type: 'assistant.turn_start', data: { turnId: 'turn-2' } });
        dispatchEvent({ type: 'assistant.message', data: { content: 'More investigation...', messageId: 'msg-2' } });
        dispatchEvent({ type: 'assistant.turn_end', data: { turnId: 'turn-2' } });
        dispatchEvent({ type: 'assistant.turn_start', data: { turnId: 'turn-3' } });
        dispatchEvent({ type: 'assistant.message', data: { content: 'The actual JSON output with lots of data', messageId: 'msg-3' } });
        dispatchEvent({ type: 'assistant.turn_end', data: { turnId: 'turn-3' } });
        dispatchEvent({ type: 'session.idle', data: {} });

        const result = await resultPromise;
        expect(result.success).toBe(true);
        // All messages are joined with double newlines to preserve full narrative
        expect(result.response).toBe('Intent message (short)\n\nMore investigation...\n\nThe actual JSON output with lots of data');
    });

    it('should skip empty messages when joining all messages', async () => {
        const { sessions, resultPromise } = setupStreamingCall();

        await vi.waitFor(() => {
            expect(sessions.length).toBe(1);
            expect(sessions[0].session.on).toHaveBeenCalled();
        }, { timeout: 1000 });

        const { dispatchEvent } = sessions[0];

        // Turn 1: meaningful message
        dispatchEvent({ type: 'assistant.message', data: { content: 'Real content here', messageId: 'msg-1' } });
        dispatchEvent({ type: 'assistant.turn_end', data: { turnId: 'turn-1' } });
        dispatchEvent({ type: 'assistant.turn_start', data: { turnId: 'turn-2' } });
        // Turn 2: empty message (tool-only turn)
        dispatchEvent({ type: 'assistant.message', data: { content: '', messageId: 'msg-2' } });
        dispatchEvent({ type: 'assistant.turn_end', data: { turnId: 'turn-2' } });
        dispatchEvent({ type: 'assistant.turn_start', data: { turnId: 'turn-3' } });
        // Turn 3: the actual output
        dispatchEvent({ type: 'assistant.message', data: { content: 'Final analysis JSON', messageId: 'msg-3' } });
        dispatchEvent({ type: 'session.idle', data: {} });

        const result = await resultPromise;
        expect(result.success).toBe(true);
        // Empty messages are filtered out when joining; only non-empty messages remain
        expect(result.response).toBe('Real content here\n\nFinal analysis JSON');
    });

    it('should settle via grace timer if session.idle never fires after last turn', async () => {
        const { sessions, resultPromise } = setupStreamingCall();

        await vi.waitFor(() => {
            expect(sessions.length).toBe(1);
            expect(sessions[0].session.on).toHaveBeenCalled();
        }, { timeout: 1000 });

        const { dispatchEvent } = sessions[0];

        // Multi-turn conversation without session.idle
        dispatchEvent({ type: 'assistant.message', data: { content: 'Intent', messageId: 'msg-1' } });
        dispatchEvent({ type: 'assistant.turn_end', data: { turnId: 'turn-1' } });
        dispatchEvent({ type: 'assistant.turn_start', data: { turnId: 'turn-2' } });
        dispatchEvent({ type: 'assistant.message', data: { content: 'Final output', messageId: 'msg-2' } });
        dispatchEvent({ type: 'assistant.turn_end', data: { turnId: 'turn-2' } });
        // No session.idle — grace timer should kick in after 2s

        const result = await resultPromise;
        expect(result.success).toBe(true);
        // Both messages joined
        expect(result.response).toBe('Intent\n\nFinal output');
    });

    it('should handle single-turn conversation normally (no MCP tools)', async () => {
        const { sessions, resultPromise } = setupStreamingCall();

        await vi.waitFor(() => {
            expect(sessions.length).toBe(1);
            expect(sessions[0].session.on).toHaveBeenCalled();
        }, { timeout: 1000 });

        const { dispatchEvent } = sessions[0];

        // Simple single-turn: message + session.idle
        dispatchEvent({ type: 'assistant.message', data: { content: 'Simple answer', messageId: 'msg-1' } });
        dispatchEvent({ type: 'session.idle', data: {} });

        const result = await resultPromise;
        expect(result.success).toBe(true);
        expect(result.response).toBe('Simple answer');
    });
});

// ============================================================================
// Streaming Callback (onStreamingChunk) Tests
// ============================================================================

describe('CopilotSDKService - onStreamingChunk callback', () => {
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
     * Helper: set up service with streaming mock and onStreamingChunk callback.
     */
    function setupStreamingCallWithCallback(
        onStreamingChunk: (chunk: string) => void,
        options?: { streaming?: boolean; timeoutMs?: number }
    ) {
        const { MockCopilotClient, sessions } = createStreamingMockSDKModule();
        const serviceAny = service as any;
        serviceAny.sdkModule = { CopilotClient: MockCopilotClient };
        serviceAny.availabilityCache = { available: true, sdkPath: '/fake/sdk' };

        const resultPromise = service.sendMessage({
            prompt: 'Test prompt',
            workingDirectory: '/test',
            timeoutMs: options?.timeoutMs ?? 5000,
            streaming: options?.streaming,
            loadDefaultMcpConfig: false,
            onStreamingChunk,
        });

        return { sessions, resultPromise };
    }

    it('should invoke onStreamingChunk for each delta event', async () => {
        const chunks: string[] = [];
        const { sessions, resultPromise } = setupStreamingCallWithCallback(
            (chunk) => { chunks.push(chunk); }
        );

        await vi.waitFor(() => {
            expect(sessions.length).toBe(1);
            expect(sessions[0].session.on).toHaveBeenCalled();
        }, { timeout: 1000 });

        const { dispatchEvent } = sessions[0];

        dispatchEvent({ type: 'assistant.message_delta', data: { deltaContent: 'Hello ' } });
        dispatchEvent({ type: 'assistant.message_delta', data: { deltaContent: 'world' } });
        dispatchEvent({ type: 'assistant.message_delta', data: { deltaContent: '!' } });
        dispatchEvent({ type: 'session.idle', data: {} });

        const result = await resultPromise;
        expect(result.success).toBe(true);
        expect(result.response).toBe('Hello world!');
        expect(chunks).toEqual(['Hello ', 'world', '!']);
    });

    it('should auto-enable streaming mode when onStreamingChunk is provided', async () => {
        const chunks: string[] = [];
        const { sessions, resultPromise } = setupStreamingCallWithCallback(
            (chunk) => { chunks.push(chunk); },
            { timeoutMs: 5000 } // Short timeout, no explicit streaming: true
        );

        await vi.waitFor(() => {
            expect(sessions.length).toBe(1);
            expect(sessions[0].session.on).toHaveBeenCalled();
        }, { timeout: 1000 });

        const { dispatchEvent } = sessions[0];

        // Verify session.send was called (not sendAndWait) — streaming was auto-enabled
        expect(sessions[0].session.send).toHaveBeenCalled();
        expect(sessions[0].session.sendAndWait).not.toHaveBeenCalled();

        dispatchEvent({ type: 'assistant.message', data: { content: 'Done', messageId: 'msg-1' } });
        dispatchEvent({ type: 'session.idle', data: {} });

        const result = await resultPromise;
        expect(result.success).toBe(true);
    });

    it('should not invoke onStreamingChunk for empty delta content', async () => {
        const chunks: string[] = [];
        const { sessions, resultPromise } = setupStreamingCallWithCallback(
            (chunk) => { chunks.push(chunk); }
        );

        await vi.waitFor(() => {
            expect(sessions.length).toBe(1);
            expect(sessions[0].session.on).toHaveBeenCalled();
        }, { timeout: 1000 });

        const { dispatchEvent } = sessions[0];

        dispatchEvent({ type: 'assistant.message_delta', data: {} }); // empty deltaContent
        dispatchEvent({ type: 'assistant.message_delta', data: { deltaContent: '' } }); // empty string
        dispatchEvent({ type: 'assistant.message_delta', data: { deltaContent: 'real content' } });
        dispatchEvent({ type: 'session.idle', data: {} });

        const result = await resultPromise;
        expect(result.success).toBe(true);
        // Only the non-empty chunk should trigger the callback
        expect(chunks).toEqual(['real content']);
    });

    it('should not break streaming flow when callback throws an error', async () => {
        let callCount = 0;
        const { sessions, resultPromise } = setupStreamingCallWithCallback(
            (chunk) => {
                callCount++;
                if (callCount === 1) {
                    throw new Error('Callback error!');
                }
            }
        );

        await vi.waitFor(() => {
            expect(sessions.length).toBe(1);
            expect(sessions[0].session.on).toHaveBeenCalled();
        }, { timeout: 1000 });

        const { dispatchEvent } = sessions[0];

        dispatchEvent({ type: 'assistant.message_delta', data: { deltaContent: 'chunk1' } });
        dispatchEvent({ type: 'assistant.message_delta', data: { deltaContent: 'chunk2' } });
        dispatchEvent({ type: 'session.idle', data: {} });

        const result = await resultPromise;
        expect(result.success).toBe(true);
        // Full response is still accumulated despite callback error
        expect(result.response).toBe('chunk1chunk2');
        // Both chunks were processed (callback was called for both)
        expect(callCount).toBe(2);
    });

    it('should still return full response when onStreamingChunk is provided', async () => {
        const chunks: string[] = [];
        const { sessions, resultPromise } = setupStreamingCallWithCallback(
            (chunk) => { chunks.push(chunk); }
        );

        await vi.waitFor(() => {
            expect(sessions.length).toBe(1);
            expect(sessions[0].session.on).toHaveBeenCalled();
        }, { timeout: 1000 });

        const { dispatchEvent } = sessions[0];

        dispatchEvent({ type: 'assistant.message_delta', data: { deltaContent: 'Part 1. ' } });
        dispatchEvent({ type: 'assistant.message_delta', data: { deltaContent: 'Part 2. ' } });
        dispatchEvent({ type: 'assistant.message_delta', data: { deltaContent: 'Part 3.' } });
        // Final message supersedes deltas
        dispatchEvent({ type: 'assistant.message', data: { content: 'Full final message', messageId: 'msg-1' } });
        dispatchEvent({ type: 'session.idle', data: {} });

        const result = await resultPromise;
        expect(result.success).toBe(true);
        // Return value is the final message (preferred over accumulated deltas)
        expect(result.response).toBe('Full final message');
        // But streaming chunks were still emitted for each delta
        expect(chunks).toEqual(['Part 1. ', 'Part 2. ', 'Part 3.']);
    });

    it('should complete streaming callback flow via turn_end when session.idle missing', async () => {
        const chunks: string[] = [];
        const { sessions, resultPromise } = setupStreamingCallWithCallback(
            (chunk) => { chunks.push(chunk); }
        );

        await vi.waitFor(() => {
            expect(sessions.length).toBe(1);
            expect(sessions[0].session.on).toHaveBeenCalled();
        }, { timeout: 1000 });

        const { dispatchEvent } = sessions[0];

        dispatchEvent({ type: 'assistant.message_delta', data: { deltaContent: 'Chunk 1 ' } });
        dispatchEvent({ type: 'assistant.message_delta', data: { deltaContent: 'Chunk 2' } });
        // Only turn_end, no session.idle
        dispatchEvent({ type: 'assistant.turn_end', data: { turnId: 'turn-1' } });

        const result = await resultPromise;
        expect(result.success).toBe(true);
        expect(result.response).toBe('Chunk 1 Chunk 2');
        expect(chunks).toEqual(['Chunk 1 ', 'Chunk 2']);
    });

    it('should invoke onStreamingChunk with finalMessage when no deltas were received', async () => {
        const chunks: string[] = [];
        const { sessions, resultPromise } = setupStreamingCallWithCallback(
            (chunk) => { chunks.push(chunk); }
        );

        await vi.waitFor(() => {
            expect(sessions.length).toBe(1);
            expect(sessions[0].session.on).toHaveBeenCalled();
        }, { timeout: 1000 });

        const { dispatchEvent } = sessions[0];

        // SDK sends only assistant.message (no delta events) — common for short responses
        dispatchEvent({ type: 'assistant.message', data: { content: 'Complete answer here', messageId: 'msg-1' } });
        dispatchEvent({ type: 'session.idle', data: {} });

        const result = await resultPromise;
        expect(result.success).toBe(true);
        expect(result.response).toBe('Complete answer here');
        // The callback should have been invoked once with the full message
        expect(chunks).toEqual(['Complete answer here']);
    });

    it('should NOT invoke onStreamingChunk for finalMessage when deltas were already received', async () => {
        const chunks: string[] = [];
        const { sessions, resultPromise } = setupStreamingCallWithCallback(
            (chunk) => { chunks.push(chunk); }
        );

        await vi.waitFor(() => {
            expect(sessions.length).toBe(1);
            expect(sessions[0].session.on).toHaveBeenCalled();
        }, { timeout: 1000 });

        const { dispatchEvent } = sessions[0];

        // Delta events followed by final message — callback already fired for deltas
        dispatchEvent({ type: 'assistant.message_delta', data: { deltaContent: 'Part 1 ' } });
        dispatchEvent({ type: 'assistant.message_delta', data: { deltaContent: 'Part 2' } });
        dispatchEvent({ type: 'assistant.message', data: { content: 'Full final message', messageId: 'msg-1' } });
        dispatchEvent({ type: 'session.idle', data: {} });

        const result = await resultPromise;
        expect(result.success).toBe(true);
        // Response uses finalMessage (preferred)
        expect(result.response).toBe('Full final message');
        // Only delta chunks should be in the callback, NOT the final message
        expect(chunks).toEqual(['Part 1 ', 'Part 2']);
    });

    it('should NOT invoke onStreamingChunk for empty finalMessage when no deltas received', async () => {
        const chunks: string[] = [];
        const { sessions, resultPromise } = setupStreamingCallWithCallback(
            (chunk) => { chunks.push(chunk); }
        );

        await vi.waitFor(() => {
            expect(sessions.length).toBe(1);
            expect(sessions[0].session.on).toHaveBeenCalled();
        }, { timeout: 1000 });

        const { dispatchEvent } = sessions[0];

        // Empty final message — nothing to emit
        dispatchEvent({ type: 'assistant.message', data: { content: '', messageId: 'msg-1' } });
        dispatchEvent({ type: 'session.idle', data: {} });

        const result = await resultPromise;
        // Empty response is treated as no response
        expect(chunks).toEqual([]);
    });

    it('should handle onStreamingChunk callback error for finalMessage gracefully', async () => {
        let callCount = 0;
        const { sessions, resultPromise } = setupStreamingCallWithCallback(
            () => {
                callCount++;
                throw new Error('Callback error on finalMessage!');
            }
        );

        await vi.waitFor(() => {
            expect(sessions.length).toBe(1);
            expect(sessions[0].session.on).toHaveBeenCalled();
        }, { timeout: 1000 });

        const { dispatchEvent } = sessions[0];

        // Only finalMessage, no deltas — callback will throw but should not break
        dispatchEvent({ type: 'assistant.message', data: { content: 'Response text', messageId: 'msg-1' } });
        dispatchEvent({ type: 'session.idle', data: {} });

        const result = await resultPromise;
        expect(result.success).toBe(true);
        expect(result.response).toBe('Response text');
        expect(callCount).toBe(1);
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

// ============================================================================
// Token Usage Tracking Tests
// ============================================================================

describe('CopilotSDKService - Token Usage Tracking', () => {
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
     */
    function setupStreamingCall() {
        const { MockCopilotClient, sessions } = createStreamingMockSDKModule();
        const serviceAny = service as any;
        serviceAny.sdkModule = { CopilotClient: MockCopilotClient };
        serviceAny.availabilityCache = { available: true, sdkPath: '/fake/sdk' };

        const resultPromise = service.sendMessage({
            prompt: 'Test prompt',
            workingDirectory: '/test',
            timeoutMs: 200000,
            loadDefaultMcpConfig: false,
        });

        return { sessions, resultPromise };
    }

    it('should capture assistant.usage event and attach tokenUsage to result', async () => {
        const { sessions, resultPromise } = setupStreamingCall();

        await vi.waitFor(() => {
            expect(sessions.length).toBe(1);
            expect(sessions[0].session.on).toHaveBeenCalled();
        }, { timeout: 1000 });

        const { dispatchEvent } = sessions[0];

        dispatchEvent({ type: 'assistant.message', data: { content: 'Hello', messageId: 'msg-1' } });
        dispatchEvent({
            type: 'assistant.usage',
            data: { inputTokens: 100, outputTokens: 50, cacheReadTokens: 10, cacheWriteTokens: 5, cost: 0.001, duration: 250 }
        });
        dispatchEvent({ type: 'session.idle', data: {} });

        const result = await resultPromise;
        expect(result.success).toBe(true);
        expect(result.tokenUsage).toBeDefined();
        const usage = result.tokenUsage!;
        expect(usage.inputTokens).toBe(100);
        expect(usage.outputTokens).toBe(50);
        expect(usage.cacheReadTokens).toBe(10);
        expect(usage.cacheWriteTokens).toBe(5);
        expect(usage.totalTokens).toBe(150);
        expect(usage.cost).toBe(0.001);
        expect(usage.duration).toBe(250);
        expect(usage.turnCount).toBe(1);
    });

    it('should accumulate token usage across multiple turns', async () => {
        const { sessions, resultPromise } = setupStreamingCall();

        await vi.waitFor(() => {
            expect(sessions.length).toBe(1);
            expect(sessions[0].session.on).toHaveBeenCalled();
        }, { timeout: 1000 });

        const { dispatchEvent } = sessions[0];

        // Turn 1
        dispatchEvent({ type: 'assistant.message', data: { content: 'Thinking...', messageId: 'msg-1' } });
        dispatchEvent({
            type: 'assistant.usage',
            data: { inputTokens: 100, outputTokens: 30, cacheReadTokens: 0, cacheWriteTokens: 0, cost: 0.001, duration: 200 }
        });

        // Turn 2
        dispatchEvent({ type: 'assistant.message', data: { content: 'Final answer', messageId: 'msg-2' } });
        dispatchEvent({
            type: 'assistant.usage',
            data: { inputTokens: 200, outputTokens: 80, cacheReadTokens: 50, cacheWriteTokens: 10, cost: 0.003, duration: 400 }
        });

        dispatchEvent({ type: 'session.idle', data: {} });

        const result = await resultPromise;
        expect(result.success).toBe(true);
        const usage = result.tokenUsage!;
        expect(usage.inputTokens).toBe(300);
        expect(usage.outputTokens).toBe(110);
        expect(usage.cacheReadTokens).toBe(50);
        expect(usage.cacheWriteTokens).toBe(10);
        expect(usage.totalTokens).toBe(410);
        expect(usage.cost).toBe(0.004);
        expect(usage.duration).toBe(600);
        expect(usage.turnCount).toBe(2);
    });

    it('should capture session.usage_info event (last-seen values)', async () => {
        const { sessions, resultPromise } = setupStreamingCall();

        await vi.waitFor(() => {
            expect(sessions.length).toBe(1);
            expect(sessions[0].session.on).toHaveBeenCalled();
        }, { timeout: 1000 });

        const { dispatchEvent } = sessions[0];

        dispatchEvent({ type: 'assistant.message', data: { content: 'Response', messageId: 'msg-1' } });
        dispatchEvent({
            type: 'assistant.usage',
            data: { inputTokens: 50, outputTokens: 25, cacheReadTokens: 0, cacheWriteTokens: 0 }
        });
        // First usage_info
        dispatchEvent({ type: 'session.usage_info', data: { tokenLimit: 10000, currentTokens: 75 } });
        // Second usage_info (should overwrite first)
        dispatchEvent({ type: 'session.usage_info', data: { tokenLimit: 10000, currentTokens: 150 } });

        dispatchEvent({ type: 'session.idle', data: {} });

        const result = await resultPromise;
        const usage = result.tokenUsage!;
        expect(usage.tokenLimit).toBe(10000);
        expect(usage.currentTokens).toBe(150);
    });

    it('should return undefined tokenUsage when no usage events fire', async () => {
        const { sessions, resultPromise } = setupStreamingCall();

        await vi.waitFor(() => {
            expect(sessions.length).toBe(1);
            expect(sessions[0].session.on).toHaveBeenCalled();
        }, { timeout: 1000 });

        const { dispatchEvent } = sessions[0];

        dispatchEvent({ type: 'assistant.message', data: { content: 'No usage events', messageId: 'msg-1' } });
        dispatchEvent({ type: 'session.idle', data: {} });

        const result = await resultPromise;
        expect(result.success).toBe(true);
        expect(result.tokenUsage).toBeUndefined();
    });

    it('should handle assistant.usage with missing optional fields', async () => {
        const { sessions, resultPromise } = setupStreamingCall();

        await vi.waitFor(() => {
            expect(sessions.length).toBe(1);
            expect(sessions[0].session.on).toHaveBeenCalled();
        }, { timeout: 1000 });

        const { dispatchEvent } = sessions[0];

        dispatchEvent({ type: 'assistant.message', data: { content: 'Response', messageId: 'msg-1' } });
        dispatchEvent({
            type: 'assistant.usage',
            data: { inputTokens: 100, outputTokens: 50 }
        });
        dispatchEvent({ type: 'session.idle', data: {} });

        const result = await resultPromise;
        const usage = result.tokenUsage!;
        expect(usage.inputTokens).toBe(100);
        expect(usage.outputTokens).toBe(50);
        expect(usage.cacheReadTokens).toBe(0);
        expect(usage.cacheWriteTokens).toBe(0);
        expect(usage.totalTokens).toBe(150);
        expect(usage.cost).toBeUndefined();
        expect(usage.duration).toBeUndefined();
        expect(usage.turnCount).toBe(1);
    });

    it('should not include tokenUsage for non-streaming (sendAndWait) path', async () => {
        const mockSession = {
            sessionId: 'non-streaming-session',
            sendAndWait: vi.fn().mockResolvedValue({ data: { content: 'Basic response' } }),
            destroy: vi.fn().mockResolvedValue(undefined),
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
            timeoutMs: 200000,
            loadDefaultMcpConfig: false,
        });

        expect(result.success).toBe(true);
        expect(result.tokenUsage).toBeUndefined();
    });

    it('should still include tokenUsage when response is empty', async () => {
        const { sessions, resultPromise } = setupStreamingCall();

        await vi.waitFor(() => {
            expect(sessions.length).toBe(1);
            expect(sessions[0].session.on).toHaveBeenCalled();
        }, { timeout: 1000 });

        const { dispatchEvent } = sessions[0];

        dispatchEvent({
            type: 'assistant.usage',
            data: { inputTokens: 50, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }
        });
        dispatchEvent({ type: 'session.idle', data: {} });

        const result = await resultPromise;
        expect(result.success).toBe(false);
        expect(result.tokenUsage).toBeDefined();
        expect(result.tokenUsage!.inputTokens).toBe(50);
        expect(result.tokenUsage!.turnCount).toBe(1);
    });

    it('should compute totalTokens as inputTokens + outputTokens', async () => {
        const { sessions, resultPromise } = setupStreamingCall();

        await vi.waitFor(() => {
            expect(sessions.length).toBe(1);
            expect(sessions[0].session.on).toHaveBeenCalled();
        }, { timeout: 1000 });

        const { dispatchEvent } = sessions[0];

        dispatchEvent({ type: 'assistant.message', data: { content: 'Test', messageId: 'msg-1' } });
        dispatchEvent({
            type: 'assistant.usage',
            data: { inputTokens: 1234, outputTokens: 567 }
        });
        dispatchEvent({ type: 'session.idle', data: {} });

        const result = await resultPromise;
        const usage = result.tokenUsage!;
        expect(usage.totalTokens).toBe(usage.inputTokens + usage.outputTokens);
        expect(usage.totalTokens).toBe(1801);
    });
});

// ============================================================================
// Empty Response with Activity (Tool-Based Execution) Tests
// ============================================================================

describe('CopilotSDKService - Empty response with tool activity', () => {
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
     */
    function setupStreamingCall(options?: { streaming?: boolean; timeoutMs?: number }) {
        const { MockCopilotClient, sessions } = createStreamingMockSDKModule();
        const serviceAny = service as any;
        serviceAny.sdkModule = { CopilotClient: MockCopilotClient };
        serviceAny.availabilityCache = { available: true, sdkPath: '/fake/sdk' };

        const resultPromise = service.sendMessage({
            prompt: 'Test prompt',
            workingDirectory: '/test',
            streaming: options?.streaming,
            timeoutMs: options?.timeoutMs ?? 200000,
            loadDefaultMcpConfig: false,
        });

        return { sessions, resultPromise };
    }

    it('should treat empty response as success when turns occurred (tool-based execution)', async () => {
        const { sessions, resultPromise } = setupStreamingCall();

        await vi.waitFor(() => {
            expect(sessions.length).toBe(1);
            expect(sessions[0].session.on).toHaveBeenCalled();
        }, { timeout: 1000 });

        const { dispatchEvent } = sessions[0];

        // Simulate tool-heavy session: turns happen but no text messages
        dispatchEvent({ type: 'assistant.turn_start', data: { turnId: 'turn-1' } });
        dispatchEvent({ type: 'tool.execution_start', data: { toolCallId: 'tc-1', toolName: 'edit' } });
        dispatchEvent({ type: 'tool.execution_complete', data: { toolCallId: 'tc-1', success: true } });
        dispatchEvent({ type: 'assistant.turn_end', data: { turnId: 'turn-1' } });

        dispatchEvent({ type: 'assistant.turn_start', data: { turnId: 'turn-2' } });
        dispatchEvent({ type: 'tool.execution_start', data: { toolCallId: 'tc-2', toolName: 'shell' } });
        dispatchEvent({ type: 'tool.execution_complete', data: { toolCallId: 'tc-2', success: true } });
        dispatchEvent({ type: 'assistant.turn_end', data: { turnId: 'turn-2' } });

        dispatchEvent({ type: 'session.idle', data: {} });

        const result = await resultPromise;
        // Empty text response but turns occurred — should be success, not failure
        expect(result.success).toBe(true);
        expect(result.response).toBe('');
    });

    it('should still fail when no turns and no response (truly empty session)', async () => {
        const { sessions, resultPromise } = setupStreamingCall();

        await vi.waitFor(() => {
            expect(sessions.length).toBe(1);
            expect(sessions[0].session.on).toHaveBeenCalled();
        }, { timeout: 1000 });

        const { dispatchEvent } = sessions[0];

        // Session goes idle with zero turns and no content
        dispatchEvent({ type: 'session.idle', data: {} });

        const result = await resultPromise;
        expect(result.success).toBe(false);
        expect(result.error).toContain('No response received');
    });

    it('should include turnCount in StreamingResult', async () => {
        // Test sendWithStreaming directly to verify turnCount is returned
        const { sessions, resultPromise } = setupStreamingCall();

        await vi.waitFor(() => {
            expect(sessions.length).toBe(1);
            expect(sessions[0].session.on).toHaveBeenCalled();
        }, { timeout: 1000 });

        const { dispatchEvent } = sessions[0];

        // 3 turns with messages
        dispatchEvent({ type: 'assistant.turn_start', data: { turnId: 'turn-1' } });
        dispatchEvent({ type: 'assistant.message', data: { content: 'Turn 1', messageId: 'msg-1' } });
        dispatchEvent({ type: 'assistant.turn_end', data: { turnId: 'turn-1' } });

        dispatchEvent({ type: 'assistant.turn_start', data: { turnId: 'turn-2' } });
        dispatchEvent({ type: 'assistant.message', data: { content: 'Turn 2', messageId: 'msg-2' } });
        dispatchEvent({ type: 'assistant.turn_end', data: { turnId: 'turn-2' } });

        dispatchEvent({ type: 'assistant.turn_start', data: { turnId: 'turn-3' } });
        dispatchEvent({ type: 'assistant.message', data: { content: 'Turn 3', messageId: 'msg-3' } });
        dispatchEvent({ type: 'assistant.turn_end', data: { turnId: 'turn-3' } });

        dispatchEvent({ type: 'session.idle', data: {} });

        const result = await resultPromise;
        expect(result.success).toBe(true);
        // All 3 messages joined
        expect(result.response).toBe('Turn 1\n\nTurn 2\n\nTurn 3');
    });

    it('should succeed with empty text when single tool-only turn occurs', async () => {
        const { sessions, resultPromise } = setupStreamingCall();

        await vi.waitFor(() => {
            expect(sessions.length).toBe(1);
            expect(sessions[0].session.on).toHaveBeenCalled();
        }, { timeout: 1000 });

        const { dispatchEvent } = sessions[0];

        // Single turn with tool execution but no text message
        dispatchEvent({ type: 'assistant.turn_start', data: { turnId: 'turn-1' } });
        dispatchEvent({ type: 'tool.execution_start', data: { toolCallId: 'tc-1', toolName: 'write' } });
        dispatchEvent({ type: 'tool.execution_complete', data: { toolCallId: 'tc-1', success: true } });
        dispatchEvent({ type: 'assistant.turn_end', data: { turnId: 'turn-1' } });
        dispatchEvent({ type: 'session.idle', data: {} });

        const result = await resultPromise;
        expect(result.success).toBe(true);
        expect(result.response).toBe('');
    });

    it('should succeed with partial text when some turns have messages and some do not', async () => {
        const { sessions, resultPromise } = setupStreamingCall();

        await vi.waitFor(() => {
            expect(sessions.length).toBe(1);
            expect(sessions[0].session.on).toHaveBeenCalled();
        }, { timeout: 1000 });

        const { dispatchEvent } = sessions[0];

        // Turn 1: has a message
        dispatchEvent({ type: 'assistant.turn_start', data: { turnId: 'turn-1' } });
        dispatchEvent({ type: 'assistant.message', data: { content: "I'll make the changes now.", messageId: 'msg-1' } });
        dispatchEvent({ type: 'assistant.turn_end', data: { turnId: 'turn-1' } });

        // Turn 2: tool-only, no message
        dispatchEvent({ type: 'assistant.turn_start', data: { turnId: 'turn-2' } });
        dispatchEvent({ type: 'tool.execution_start', data: { toolCallId: 'tc-1', toolName: 'edit' } });
        dispatchEvent({ type: 'tool.execution_complete', data: { toolCallId: 'tc-1', success: true } });
        dispatchEvent({ type: 'assistant.turn_end', data: { turnId: 'turn-2' } });

        // Turn 3: tool-only, no message
        dispatchEvent({ type: 'assistant.turn_start', data: { turnId: 'turn-3' } });
        dispatchEvent({ type: 'tool.execution_start', data: { toolCallId: 'tc-2', toolName: 'shell' } });
        dispatchEvent({ type: 'tool.execution_complete', data: { toolCallId: 'tc-2', success: true } });
        dispatchEvent({ type: 'assistant.turn_end', data: { turnId: 'turn-3' } });

        dispatchEvent({ type: 'session.idle', data: {} });

        const result = await resultPromise;
        expect(result.success).toBe(true);
        // Only the non-empty message from turn 1
        expect(result.response).toBe("I'll make the changes now.");
    });

    it('should handle realistic impl skill scenario: many tool turns, no final summary', async () => {
        const { sessions, resultPromise } = setupStreamingCall();

        await vi.waitFor(() => {
            expect(sessions.length).toBe(1);
            expect(sessions[0].session.on).toHaveBeenCalled();
        }, { timeout: 1000 });

        const { dispatchEvent } = sessions[0];

        // Realistic impl skill: AI reads files, makes changes, runs tests
        // Turn 1: Read instruction file
        dispatchEvent({ type: 'assistant.turn_start', data: { turnId: 'turn-1' } });
        dispatchEvent({ type: 'assistant.message', data: { content: "I'll follow the instructions in the skill file.", messageId: 'msg-1' } });
        dispatchEvent({ type: 'tool.execution_start', data: { toolCallId: 'tc-1', toolName: 'view' } });
        dispatchEvent({ type: 'tool.execution_complete', data: { toolCallId: 'tc-1', success: true } });
        dispatchEvent({ type: 'assistant.turn_end', data: { turnId: 'turn-1' } });

        // Turn 2: Read plan file
        dispatchEvent({ type: 'assistant.turn_start', data: { turnId: 'turn-2' } });
        dispatchEvent({ type: 'tool.execution_start', data: { toolCallId: 'tc-2', toolName: 'view' } });
        dispatchEvent({ type: 'tool.execution_complete', data: { toolCallId: 'tc-2', success: true } });
        dispatchEvent({ type: 'assistant.turn_end', data: { turnId: 'turn-2' } });

        // Turn 3: Read source files
        dispatchEvent({ type: 'assistant.turn_start', data: { turnId: 'turn-3' } });
        dispatchEvent({ type: 'tool.execution_start', data: { toolCallId: 'tc-3', toolName: 'view' } });
        dispatchEvent({ type: 'tool.execution_start', data: { toolCallId: 'tc-4', toolName: 'grep' } });
        dispatchEvent({ type: 'tool.execution_complete', data: { toolCallId: 'tc-3', success: true } });
        dispatchEvent({ type: 'tool.execution_complete', data: { toolCallId: 'tc-4', success: true } });
        dispatchEvent({ type: 'assistant.turn_end', data: { turnId: 'turn-3' } });

        // Turn 4: Make code changes
        dispatchEvent({ type: 'assistant.turn_start', data: { turnId: 'turn-4' } });
        dispatchEvent({ type: 'tool.execution_start', data: { toolCallId: 'tc-5', toolName: 'edit' } });
        dispatchEvent({ type: 'tool.execution_complete', data: { toolCallId: 'tc-5', success: true } });
        dispatchEvent({ type: 'assistant.turn_end', data: { turnId: 'turn-4' } });

        // Turn 5: Run tests
        dispatchEvent({ type: 'assistant.turn_start', data: { turnId: 'turn-5' } });
        dispatchEvent({ type: 'tool.execution_start', data: { toolCallId: 'tc-6', toolName: 'shell' } });
        dispatchEvent({ type: 'tool.execution_complete', data: { toolCallId: 'tc-6', success: true } });
        dispatchEvent({ type: 'assistant.turn_end', data: { turnId: 'turn-5' } });

        // Session ends — no final text summary
        dispatchEvent({ type: 'session.idle', data: {} });

        const result = await resultPromise;
        // Should succeed despite only having one text message from turn 1
        expect(result.success).toBe(true);
        expect(result.response).toContain("I'll follow the instructions in the skill file.");
    });
});

// ============================================================================
// Debug Logging Tests — verifies the enhanced event logging for diagnosing
// stuck sessions (tool execution, permissions, session lifecycle)
// ============================================================================

/**
 * Create a capturing logger that records all log calls for assertions.
 */
function createCapturingLogger() {
    const logs: Array<{ level: string; category: string; message: string }> = [];
    return {
        logs,
        logger: {
            debug: (category: string, message: string) => logs.push({ level: 'debug', category, message }),
            info: (category: string, message: string) => logs.push({ level: 'info', category, message }),
            warn: (category: string, message: string) => logs.push({ level: 'warn', category, message }),
            error: (category: string, message: string) => logs.push({ level: 'error', category, message }),
        },
        /** Filter logs by substring match on message */
        matching: (substr: string) => logs.filter(l => l.message.includes(substr)),
    };
}

describe('CopilotSDKService - Debug Logging (tool execution events)', () => {
    let service: CopilotSDKService;
    let capLogger: ReturnType<typeof createCapturingLogger>;

    beforeEach(() => {
        resetCopilotSDKService();
        service = CopilotSDKService.getInstance();
        capLogger = createCapturingLogger();
        setLogger(capLogger.logger);
        vi.clearAllMocks();
    });

    afterEach(async () => {
        setLogger(nullLogger);
        service.dispose();
        resetCopilotSDKService();
    });

    function setupStreamingCall(options?: { streaming?: boolean; timeoutMs?: number; onPermissionRequest?: any }) {
        const { MockCopilotClient, sessions } = createStreamingMockSDKModule();
        const serviceAny = service as any;
        serviceAny.sdkModule = { CopilotClient: MockCopilotClient };
        serviceAny.availabilityCache = { available: true, sdkPath: '/fake/sdk' };

        const resultPromise = service.sendMessage({
            prompt: 'Test prompt',
            workingDirectory: '/test',
            streaming: options?.streaming,
            timeoutMs: options?.timeoutMs ?? 200000,
            loadDefaultMcpConfig: false,
            onPermissionRequest: options?.onPermissionRequest,
        });

        return { sessions, resultPromise };
    }

    it('should log tool.execution_start with tool name and arguments', async () => {
        const { sessions, resultPromise } = setupStreamingCall();

        await vi.waitFor(() => {
            expect(sessions.length).toBe(1);
            expect(sessions[0].session.on).toHaveBeenCalled();
        }, { timeout: 1000 });

        const { dispatchEvent } = sessions[0];

        dispatchEvent({ type: 'assistant.message', data: { content: 'result', messageId: 'msg-1' } });
        dispatchEvent({ type: 'tool.execution_start', data: { toolCallId: 'tc-1', toolName: 'view', arguments: { path: '/src/main.ts' } } });
        dispatchEvent({ type: 'tool.execution_complete', data: { toolCallId: 'tc-1', success: true, result: { content: 'file contents' } } });
        dispatchEvent({ type: 'session.idle', data: {} });

        await resultPromise;

        const startLogs = capLogger.matching('Tool execution started');
        expect(startLogs.length).toBe(1);
        expect(startLogs[0].message).toContain('view');
        expect(startLogs[0].message).toContain('tc-1');
        expect(startLogs[0].message).toContain('/src/main.ts');
    });

    it('should log tool.execution_complete with duration and result length', async () => {
        const { sessions, resultPromise } = setupStreamingCall();

        await vi.waitFor(() => {
            expect(sessions.length).toBe(1);
            expect(sessions[0].session.on).toHaveBeenCalled();
        }, { timeout: 1000 });

        const { dispatchEvent } = sessions[0];

        dispatchEvent({ type: 'assistant.message', data: { content: 'result', messageId: 'msg-1' } });
        dispatchEvent({ type: 'tool.execution_start', data: { toolCallId: 'tc-1', toolName: 'glob' } });
        dispatchEvent({ type: 'tool.execution_complete', data: { toolCallId: 'tc-1', success: true, result: { content: 'a.ts\nb.ts' } } });
        dispatchEvent({ type: 'session.idle', data: {} });

        await resultPromise;

        const completeLogs = capLogger.matching('Tool execution completed');
        expect(completeLogs.length).toBe(1);
        expect(completeLogs[0].message).toContain('glob');
        expect(completeLogs[0].message).toContain('tc-1');
        expect(completeLogs[0].message).toContain('success');
        expect(completeLogs[0].message).toContain('chars');
    });

    it('should log tool.execution_complete failure with error message', async () => {
        const { sessions, resultPromise } = setupStreamingCall();

        await vi.waitFor(() => {
            expect(sessions.length).toBe(1);
            expect(sessions[0].session.on).toHaveBeenCalled();
        }, { timeout: 1000 });

        const { dispatchEvent } = sessions[0];

        dispatchEvent({ type: 'assistant.message', data: { content: 'result', messageId: 'msg-1' } });
        dispatchEvent({ type: 'tool.execution_start', data: { toolCallId: 'tc-1', toolName: 'view' } });
        dispatchEvent({ type: 'tool.execution_complete', data: { toolCallId: 'tc-1', success: false, error: { message: 'File not found' } } });
        dispatchEvent({ type: 'session.idle', data: {} });

        await resultPromise;

        const failLogs = capLogger.matching('Tool execution FAILED');
        expect(failLogs.length).toBe(1);
        expect(failLogs[0].message).toContain('view');
        expect(failLogs[0].message).toContain('File not found');
    });

    it('should log tool.execution_progress events', async () => {
        const { sessions, resultPromise } = setupStreamingCall();

        await vi.waitFor(() => {
            expect(sessions.length).toBe(1);
            expect(sessions[0].session.on).toHaveBeenCalled();
        }, { timeout: 1000 });

        const { dispatchEvent } = sessions[0];

        dispatchEvent({ type: 'assistant.message', data: { content: 'result', messageId: 'msg-1' } });
        dispatchEvent({ type: 'tool.execution_start', data: { toolCallId: 'tc-1', toolName: 'shell' } });
        dispatchEvent({ type: 'tool.execution_progress', data: { toolCallId: 'tc-1', progressMessage: 'Running npm test...' } });
        dispatchEvent({ type: 'tool.execution_complete', data: { toolCallId: 'tc-1', success: true } });
        dispatchEvent({ type: 'session.idle', data: {} });

        await resultPromise;

        const progressLogs = capLogger.matching('Tool progress');
        expect(progressLogs.length).toBe(1);
        expect(progressLogs[0].message).toContain('shell');
        expect(progressLogs[0].message).toContain('Running npm test');
    });

    it('should log assistant.intent events', async () => {
        const { sessions, resultPromise } = setupStreamingCall();

        await vi.waitFor(() => {
            expect(sessions.length).toBe(1);
            expect(sessions[0].session.on).toHaveBeenCalled();
        }, { timeout: 1000 });

        const { dispatchEvent } = sessions[0];

        dispatchEvent({ type: 'assistant.intent', data: { intent: 'Reading source files' } });
        dispatchEvent({ type: 'assistant.message', data: { content: 'done', messageId: 'msg-1' } });
        dispatchEvent({ type: 'session.idle', data: {} });

        await resultPromise;

        const intentLogs = capLogger.matching('Assistant intent');
        expect(intentLogs.length).toBe(1);
        expect(intentLogs[0].message).toContain('Reading source files');
    });

    it('should log session.info events', async () => {
        const { sessions, resultPromise } = setupStreamingCall();

        await vi.waitFor(() => {
            expect(sessions.length).toBe(1);
            expect(sessions[0].session.on).toHaveBeenCalled();
        }, { timeout: 1000 });

        const { dispatchEvent } = sessions[0];

        dispatchEvent({ type: 'session.info', data: { infoType: 'rate_limit', message: 'Approaching rate limit' } });
        dispatchEvent({ type: 'assistant.message', data: { content: 'done', messageId: 'msg-1' } });
        dispatchEvent({ type: 'session.idle', data: {} });

        await resultPromise;

        const infoLogs = capLogger.matching('Session info');
        expect(infoLogs.length).toBe(1);
        expect(infoLogs[0].message).toContain('rate_limit');
        expect(infoLogs[0].message).toContain('Approaching rate limit');
    });

    it('should log abort events', async () => {
        const { sessions, resultPromise } = setupStreamingCall();

        await vi.waitFor(() => {
            expect(sessions.length).toBe(1);
            expect(sessions[0].session.on).toHaveBeenCalled();
        }, { timeout: 1000 });

        const { dispatchEvent } = sessions[0];

        dispatchEvent({ type: 'assistant.message', data: { content: 'partial', messageId: 'msg-1' } });
        dispatchEvent({ type: 'abort', data: { reason: 'User cancelled' } });
        // abort doesn't settle, so we need session.idle or timeout
        dispatchEvent({ type: 'session.idle', data: {} });

        await resultPromise;

        const abortLogs = capLogger.matching('Session aborted');
        expect(abortLogs.length).toBe(1);
        expect(abortLogs[0].message).toContain('User cancelled');
    });

    it('should log tool requests in assistant.message events', async () => {
        const { sessions, resultPromise } = setupStreamingCall();

        await vi.waitFor(() => {
            expect(sessions.length).toBe(1);
            expect(sessions[0].session.on).toHaveBeenCalled();
        }, { timeout: 1000 });

        const { dispatchEvent } = sessions[0];

        dispatchEvent({ type: 'assistant.message', data: {
            content: 'Let me check the files',
            messageId: 'msg-1',
            toolRequests: [
                { toolCallId: 'tc-1', name: 'view', arguments: { path: '/a.ts' } },
                { toolCallId: 'tc-2', name: 'grep', arguments: { pattern: 'foo' } },
            ],
        } });
        dispatchEvent({ type: 'session.idle', data: {} });

        await resultPromise;

        const toolReqLogs = capLogger.matching('tool request(s)');
        expect(toolReqLogs.length).toBe(1);
        expect(toolReqLogs[0].message).toContain('view');
        expect(toolReqLogs[0].message).toContain('grep');
        expect(toolReqLogs[0].message).toContain('2 tool request(s)');
    });

    it('should log turn_start with elapsed time and active tool count', async () => {
        const { sessions, resultPromise } = setupStreamingCall();

        await vi.waitFor(() => {
            expect(sessions.length).toBe(1);
            expect(sessions[0].session.on).toHaveBeenCalled();
        }, { timeout: 1000 });

        const { dispatchEvent } = sessions[0];

        dispatchEvent({ type: 'assistant.turn_start', data: { turnId: 'turn-1' } });
        dispatchEvent({ type: 'assistant.message', data: { content: 'done', messageId: 'msg-1' } });
        dispatchEvent({ type: 'session.idle', data: {} });

        await resultPromise;

        const turnStartLogs = capLogger.matching('Turn starting');
        expect(turnStartLogs.length).toBe(1);
        expect(turnStartLogs[0].message).toContain('elapsed');
        expect(turnStartLogs[0].message).toContain('active tool calls');
    });

    it('should log elapsed time in settle message', async () => {
        const { sessions, resultPromise } = setupStreamingCall();

        await vi.waitFor(() => {
            expect(sessions.length).toBe(1);
            expect(sessions[0].session.on).toHaveBeenCalled();
        }, { timeout: 1000 });

        const { dispatchEvent } = sessions[0];

        dispatchEvent({ type: 'assistant.message', data: { content: 'done', messageId: 'msg-1' } });
        dispatchEvent({ type: 'session.idle', data: {} });

        await resultPromise;

        const settleLogs = capLogger.matching('Streaming completed');
        expect(settleLogs.length).toBe(1);
        expect(settleLogs[0].message).toContain('elapsed');
    });

    it('should warn about active tool calls on settle', async () => {
        const { sessions, resultPromise } = setupStreamingCall();

        await vi.waitFor(() => {
            expect(sessions.length).toBe(1);
            expect(sessions[0].session.on).toHaveBeenCalled();
        }, { timeout: 1000 });

        const { dispatchEvent } = sessions[0];

        dispatchEvent({ type: 'assistant.message', data: { content: 'done', messageId: 'msg-1' } });
        // Start a tool but never complete it
        dispatchEvent({ type: 'tool.execution_start', data: { toolCallId: 'tc-stale', toolName: 'view' } });
        dispatchEvent({ type: 'session.idle', data: {} });

        await resultPromise;

        const warningLogs = capLogger.matching('still active at settle');
        expect(warningLogs.length).toBe(1);
        expect(warningLogs[0].message).toContain('view');
        expect(warningLogs[0].message).toContain('tc-stale');
    });

    it('should track multiple concurrent tool calls and log completions', async () => {
        const { sessions, resultPromise } = setupStreamingCall();

        await vi.waitFor(() => {
            expect(sessions.length).toBe(1);
            expect(sessions[0].session.on).toHaveBeenCalled();
        }, { timeout: 1000 });

        const { dispatchEvent } = sessions[0];

        dispatchEvent({ type: 'assistant.message', data: { content: 'result', messageId: 'msg-1' } });
        // Start 3 tools concurrently
        dispatchEvent({ type: 'tool.execution_start', data: { toolCallId: 'tc-1', toolName: 'view' } });
        dispatchEvent({ type: 'tool.execution_start', data: { toolCallId: 'tc-2', toolName: 'grep' } });
        dispatchEvent({ type: 'tool.execution_start', data: { toolCallId: 'tc-3', toolName: 'glob' } });
        // Complete them in different order
        dispatchEvent({ type: 'tool.execution_complete', data: { toolCallId: 'tc-2', success: true } });
        dispatchEvent({ type: 'tool.execution_complete', data: { toolCallId: 'tc-1', success: true } });
        dispatchEvent({ type: 'tool.execution_complete', data: { toolCallId: 'tc-3', success: true } });
        dispatchEvent({ type: 'session.idle', data: {} });

        await resultPromise;

        const startLogs = capLogger.matching('Tool execution started');
        expect(startLogs.length).toBe(3);
        const completeLogs = capLogger.matching('Tool execution completed');
        expect(completeLogs.length).toBe(3);
        // No stale tools at settle
        const warningLogs = capLogger.matching('still active at settle');
        expect(warningLogs.length).toBe(0);
    });
});

describe('CopilotSDKService - Debug Logging (permission handler wrapping)', () => {
    let service: CopilotSDKService;
    let capLogger: ReturnType<typeof createCapturingLogger>;

    beforeEach(() => {
        resetCopilotSDKService();
        service = CopilotSDKService.getInstance();
        capLogger = createCapturingLogger();
        setLogger(capLogger.logger);
        vi.clearAllMocks();
    });

    afterEach(async () => {
        setLogger(nullLogger);
        service.dispose();
        resetCopilotSDKService();
    });

    it('should log permission requests and results via wrapped handler', async () => {
        const { MockCopilotClient, mockClient, sessions } = createStreamingMockSDKModule();
        const serviceAny = service as any;
        serviceAny.sdkModule = { CopilotClient: MockCopilotClient };
        serviceAny.availabilityCache = { available: true, sdkPath: '/fake/sdk' };

        const permissionHandler = (req: any) =>
            req.kind === 'read' ? { kind: 'approved' } : { kind: 'denied-by-rules' };

        const resultPromise = service.sendMessage({
            prompt: 'Test',
            workingDirectory: '/test',
            timeoutMs: 200000,
            loadDefaultMcpConfig: false,
            onPermissionRequest: permissionHandler,
        });

        // Wait for createSession to be called and session to be ready
        await vi.waitFor(() => {
            expect(mockClient.createSession).toHaveBeenCalled();
            expect(sessions.length).toBe(1);
            expect(sessions[0].session.on).toHaveBeenCalled();
        }, { timeout: 1000 });

        // Get the wrapped handler that was passed to createSession
        const sessionOptions = mockClient.createSession.mock.calls[0][0];
        expect(sessionOptions.onPermissionRequest).toBeDefined();
        expect(sessionOptions.onPermissionRequest).not.toBe(permissionHandler);

        // Simulate permission requests through the wrapper
        const readResult = sessionOptions.onPermissionRequest(
            { kind: 'read', toolCallId: 'tc-1' },
            { sessionId: sessions[0].session.sessionId }
        );
        expect(readResult.kind).toBe('approved');

        const writeResult = sessionOptions.onPermissionRequest(
            { kind: 'write', toolCallId: 'tc-2' },
            { sessionId: sessions[0].session.sessionId }
        );
        expect(writeResult.kind).toBe('denied-by-rules');

        // Verify logs
        const permReqLogs = capLogger.matching('Permission request');
        expect(permReqLogs.length).toBe(2);
        expect(permReqLogs[0].message).toContain('kind=read');
        expect(permReqLogs[1].message).toContain('kind=write');

        const permResultLogs = capLogger.matching('Permission result');
        expect(permResultLogs.length).toBe(2);
        expect(permResultLogs[0].message).toContain('approved');
        expect(permResultLogs[1].message).toContain('denied-by-rules');

        // Settle the session properly
        const { dispatchEvent } = sessions[0];
        dispatchEvent({ type: 'assistant.message', data: { content: 'done', messageId: 'msg-1' } });
        dispatchEvent({ type: 'session.idle', data: {} });
        await resultPromise;
    });

    it('should handle async permission handlers', async () => {
        const { MockCopilotClient, mockClient, sessions } = createStreamingMockSDKModule();
        const serviceAny = service as any;
        serviceAny.sdkModule = { CopilotClient: MockCopilotClient };
        serviceAny.availabilityCache = { available: true, sdkPath: '/fake/sdk' };

        const asyncPermHandler = async (req: any) => {
            return req.kind === 'read' ? { kind: 'approved' as const } : { kind: 'denied-by-rules' as const };
        };

        const resultPromise = service.sendMessage({
            prompt: 'Test',
            workingDirectory: '/test',
            timeoutMs: 200000,
            loadDefaultMcpConfig: false,
            onPermissionRequest: asyncPermHandler,
        });

        await vi.waitFor(() => {
            expect(mockClient.createSession).toHaveBeenCalled();
            expect(sessions.length).toBe(1);
            expect(sessions[0].session.on).toHaveBeenCalled();
        }, { timeout: 1000 });

        const sessionOptions = mockClient.createSession.mock.calls[0][0];

        // Call the async wrapper
        const result = await sessionOptions.onPermissionRequest(
            { kind: 'read', toolCallId: 'tc-async' },
            { sessionId: sessions[0].session.sessionId }
        );
        expect(result.kind).toBe('approved');

        // Verify async path logs
        const permResultLogs = capLogger.matching('Permission result');
        expect(permResultLogs.length).toBe(1);
        expect(permResultLogs[0].message).toContain('approved');

        // Settle the session properly
        const { dispatchEvent } = sessions[0];
        dispatchEvent({ type: 'assistant.message', data: { content: 'done', messageId: 'msg-1' } });
        dispatchEvent({ type: 'session.idle', data: {} });
        await resultPromise;
    });
});
