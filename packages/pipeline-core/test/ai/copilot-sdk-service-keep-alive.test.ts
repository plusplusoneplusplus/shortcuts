/**
 * Copilot SDK Service Keep-Alive Tests
 *
 * Tests for the session keep-alive and follow-up message functionality.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { CopilotSDKService, resetCopilotSDKService, SendFollowUpOptions } from '../../src/copilot-sdk-wrapper/copilot-sdk-service';
import { setLogger, nullLogger } from '../../src/logger';

// Suppress logger output during tests
setLogger(nullLogger);

// Mock the trusted-folder module
vi.mock('../../src/copilot-sdk-wrapper/trusted-folder', async () => {
    const actual = await vi.importActual('../../src/copilot-sdk-wrapper/trusted-folder');
    return {
        ...actual,
        ensureFolderTrusted: vi.fn(),
    };
});

// Mock the mcp-config-loader module
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
 * Create a mock session (non-streaming).
 */
function createMockSession(overrides?: Partial<{
    sessionId: string;
    sendAndWaitResponse: any;
    sendAndWaitError: Error;
}>) {
    const sessionId = overrides?.sessionId ?? 'test-session-' + Math.random().toString(36).substring(7);
    return {
        sessionId,
        sendAndWait: overrides?.sendAndWaitError
            ? vi.fn().mockRejectedValue(overrides.sendAndWaitError)
            : vi.fn().mockResolvedValue(
                overrides?.sendAndWaitResponse ?? { data: { content: 'mock response' } }
            ),
        destroy: vi.fn().mockResolvedValue(undefined),
    };
}

/**
 * Create a streaming mock session with event dispatch support.
 */
function createStreamingMockSession(sessionId?: string) {
    const handlers: Array<(event: any) => void> = [];
    const sid = sessionId ?? 'streaming-session-' + Math.random().toString(36).substring(7);

    const session = {
        sessionId: sid,
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

    const dispatchEvent = (event: { type: string; data?: any }) => {
        for (const handler of [...handlers]) {
            handler(event);
        }
    };

    return { session, dispatchEvent, handlers };
}

/**
 * Create a mock SDK module returning a specific session.
 */
function createMockSDKModule(sessionOrFactory: any) {
    const capturedOptions: any[] = [];

    const mockClient = {
        createSession: typeof sessionOrFactory === 'function'
            ? vi.fn().mockImplementation(() => Promise.resolve(sessionOrFactory()))
            : vi.fn().mockResolvedValue(sessionOrFactory),
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
 * Set up the service with a mock SDK module and return the service.
 */
function setupService(service: CopilotSDKService, session: any) {
    const { MockCopilotClient } = createMockSDKModule(session);
    const serviceAny = service as any;
    serviceAny.sdkModule = { CopilotClient: MockCopilotClient };
    serviceAny.availabilityCache = { available: true, sdkPath: '/fake/sdk' };
}

describe('CopilotSDKService - Keep-Alive', () => {
    let service: CopilotSDKService;

    beforeEach(() => {
        resetCopilotSDKService();
        service = CopilotSDKService.getInstance();
        vi.clearAllMocks();
    });

    afterEach(async () => {
        await service.cleanup();
        resetCopilotSDKService();
    });

    // ========================================================================
    // Test 1: keepAlive=true preserves session after sendMessage
    // ========================================================================
    it('should preserve session when keepAlive=true and request succeeds', async () => {
        const mockSession = createMockSession();
        setupService(service, mockSession);

        const result = await service.sendMessage({
            prompt: 'Hello',
            workingDirectory: '/test',
            keepAlive: true,
            loadDefaultMcpConfig: false,
        });

        expect(result.success).toBe(true);
        expect(result.sessionId).toBe(mockSession.sessionId);
        // Session should NOT be destroyed
        expect(mockSession.destroy).not.toHaveBeenCalled();
        // Session should be in keptAliveSessions
        const keptAlive = (service as any).keptAliveSessions;
        expect(keptAlive.has(mockSession.sessionId)).toBe(true);
        const entry = keptAlive.get(mockSession.sessionId);
        expect(entry.session).toBe(mockSession);
        expect(entry.createdAt).toBeGreaterThan(0);
        expect(entry.lastUsedAt).toBeGreaterThan(0);
    });

    // ========================================================================
    // Test 2: keepAlive=false (default) destroys session as before
    // ========================================================================
    it('should destroy session when keepAlive is false (default)', async () => {
        const mockSession = createMockSession();
        setupService(service, mockSession);

        const result = await service.sendMessage({
            prompt: 'Hello',
            workingDirectory: '/test',
            loadDefaultMcpConfig: false,
        });

        expect(result.success).toBe(true);
        expect(mockSession.destroy).toHaveBeenCalled();
        const keptAlive = (service as any).keptAliveSessions;
        expect(keptAlive.size).toBe(0);
    });

    // ========================================================================
    // Test 3: keepAlive=true with failed request still destroys session
    // ========================================================================
    it('should destroy session when keepAlive=true but request fails', async () => {
        const mockSession = createMockSession({
            sendAndWaitResponse: { data: { content: '' } },
        });
        setupService(service, mockSession);

        const result = await service.sendMessage({
            prompt: 'Hello',
            workingDirectory: '/test',
            keepAlive: true,
            loadDefaultMcpConfig: false,
        });

        // Empty response without turns → failure
        expect(result.success).toBe(false);
        expect(mockSession.destroy).toHaveBeenCalled();
        const keptAlive = (service as any).keptAliveSessions;
        expect(keptAlive.size).toBe(0);
    });

    // ========================================================================
    // Test 4: sendFollowUp on an existing session
    // ========================================================================
    it('should send follow-up on a kept-alive session', async () => {
        const mockSession = createMockSession();
        setupService(service, mockSession);

        // First message with keepAlive
        const firstResult = await service.sendMessage({
            prompt: 'Hello',
            workingDirectory: '/test',
            keepAlive: true,
            loadDefaultMcpConfig: false,
        });
        expect(firstResult.success).toBe(true);

        // Follow-up
        mockSession.sendAndWait.mockResolvedValueOnce({ data: { content: 'follow-up response' } });
        const followUpResult = await service.sendFollowUp(firstResult.sessionId!, 'Follow-up question');

        expect(followUpResult.success).toBe(true);
        expect(followUpResult.response).toBe('follow-up response');
        expect(followUpResult.sessionId).toBe(firstResult.sessionId);
        // lastUsedAt should be updated
        const entry = (service as any).keptAliveSessions.get(firstResult.sessionId);
        expect(entry.lastUsedAt).toBeGreaterThanOrEqual(entry.createdAt);
    });

    // ========================================================================
    // Test 5: sendFollowUp with streaming
    // ========================================================================
    it('should use streaming for follow-up when onStreamingChunk is provided', async () => {
        const { session: streamSession, dispatchEvent } = createStreamingMockSession();
        setupService(service, streamSession);

        // First message with keepAlive (use streaming path with long timeout)
        const firstPromise = service.sendMessage({
            prompt: 'Hello',
            workingDirectory: '/test',
            keepAlive: true,
            timeoutMs: 200000,
            loadDefaultMcpConfig: false,
        });

        // Wait for session creation
        await vi.waitFor(() => {
            expect(streamSession.send).toHaveBeenCalled();
        });

        // Simulate response for first message
        dispatchEvent({ type: 'assistant.message_delta', data: { deltaContent: 'first ' } });
        dispatchEvent({ type: 'assistant.message', data: { content: 'first response' } });
        dispatchEvent({ type: 'session.idle', data: {} });

        const firstResult = await firstPromise;
        expect(firstResult.success).toBe(true);

        // Follow-up with streaming
        const chunks: string[] = [];
        const followUpPromise = service.sendFollowUp(
            firstResult.sessionId!,
            'Follow-up',
            {
                timeoutMs: 200000,
                onStreamingChunk: (chunk) => chunks.push(chunk),
            },
        );

        // Wait for send to be called again
        await vi.waitFor(() => {
            expect(streamSession.send).toHaveBeenCalledTimes(2);
        });

        // Simulate streaming follow-up response
        dispatchEvent({ type: 'assistant.message_delta', data: { deltaContent: 'chunk1' } });
        dispatchEvent({ type: 'assistant.message_delta', data: { deltaContent: 'chunk2' } });
        dispatchEvent({ type: 'assistant.message', data: { content: 'chunk1chunk2' } });
        dispatchEvent({ type: 'session.idle', data: {} });

        const followUpResult = await followUpPromise;
        expect(followUpResult.success).toBe(true);
        expect(chunks).toContain('chunk1');
        expect(chunks).toContain('chunk2');
    });

    // ========================================================================
    // Test 6: sendFollowUp on non-existent session returns error
    // ========================================================================
    it('should return error when sendFollowUp is called on non-existent session', async () => {
        const result = await service.sendFollowUp('non-existent-id', 'Follow-up');

        expect(result.success).toBe(false);
        expect(result.error).toMatch(/not found/);
    });

    // ========================================================================
    // Test 7: sendFollowUp error destroys the session
    // ========================================================================
    it('should destroy session when sendFollowUp encounters an error', async () => {
        const mockSession = createMockSession();
        setupService(service, mockSession);

        // First message with keepAlive
        const firstResult = await service.sendMessage({
            prompt: 'Hello',
            workingDirectory: '/test',
            keepAlive: true,
            loadDefaultMcpConfig: false,
        });
        expect(firstResult.success).toBe(true);

        // Make follow-up throw
        mockSession.sendAndWait.mockRejectedValueOnce(new Error('Connection lost'));
        const followUpResult = await service.sendFollowUp(firstResult.sessionId!, 'Follow-up');

        expect(followUpResult.success).toBe(false);
        expect(followUpResult.error).toMatch(/Connection lost/);
        // Session should be destroyed and removed
        expect(mockSession.destroy).toHaveBeenCalled();
        const keptAlive = (service as any).keptAliveSessions;
        expect(keptAlive.has(firstResult.sessionId)).toBe(false);
    });

    // ========================================================================
    // Test 8: destroyKeptAliveSession cleans up
    // ========================================================================
    it('should destroy a kept-alive session via destroyKeptAliveSession', async () => {
        const mockSession = createMockSession();
        setupService(service, mockSession);

        const firstResult = await service.sendMessage({
            prompt: 'Hello',
            workingDirectory: '/test',
            keepAlive: true,
            loadDefaultMcpConfig: false,
        });
        expect(firstResult.success).toBe(true);
        expect((service as any).keptAliveSessions.has(firstResult.sessionId)).toBe(true);

        const destroyed = await service.destroyKeptAliveSession(firstResult.sessionId!);
        expect(destroyed).toBe(true);
        expect(mockSession.destroy).toHaveBeenCalled();
        expect((service as any).keptAliveSessions.has(firstResult.sessionId)).toBe(false);
    });

    // ========================================================================
    // Test 9: destroyKeptAliveSession with unknown id returns false
    // ========================================================================
    it('should return false when destroyKeptAliveSession is called with unknown id', async () => {
        const result = await service.destroyKeptAliveSession('unknown-id');
        expect(result).toBe(false);
    });

    // ========================================================================
    // Test 10: Idle timeout cleanup
    // ========================================================================
    it('should clean up idle kept-alive sessions', async () => {
        const mockSession = createMockSession();
        setupService(service, mockSession);

        const firstResult = await service.sendMessage({
            prompt: 'Hello',
            workingDirectory: '/test',
            keepAlive: true,
            loadDefaultMcpConfig: false,
        });
        expect(firstResult.success).toBe(true);

        // Simulate session being idle for 11 minutes
        const entry = (service as any).keptAliveSessions.get(firstResult.sessionId);
        entry.lastUsedAt = Date.now() - (11 * 60 * 1000);

        // Trigger cleanup
        const cleaned = await (service as any).cleanupIdleKeptAliveSessions();
        expect(cleaned).toBe(1);
        expect(mockSession.destroy).toHaveBeenCalled();
        expect((service as any).keptAliveSessions.size).toBe(0);
        // Timer should be stopped when no sessions remain
        expect((service as any).keepAliveCleanupTimer).toBeUndefined();
    });

    // ========================================================================
    // Test 11: cleanup() destroys all kept-alive sessions
    // ========================================================================
    it('should destroy all kept-alive sessions on cleanup()', async () => {
        // Create two sessions by using a factory
        const session1 = createMockSession({ sessionId: 'session-1' });
        const session2 = createMockSession({ sessionId: 'session-2' });
        let callCount = 0;
        const { MockCopilotClient } = createMockSDKModule(() => {
            callCount++;
            return callCount === 1 ? session1 : session2;
        });
        const serviceAny = service as any;
        serviceAny.sdkModule = { CopilotClient: MockCopilotClient };
        serviceAny.availabilityCache = { available: true, sdkPath: '/fake/sdk' };

        // First message
        const result1 = await service.sendMessage({
            prompt: 'Hello',
            workingDirectory: '/test',
            keepAlive: true,
            loadDefaultMcpConfig: false,
        });
        expect(result1.success).toBe(true);

        // Second message
        const result2 = await service.sendMessage({
            prompt: 'World',
            workingDirectory: '/test',
            keepAlive: true,
            loadDefaultMcpConfig: false,
        });
        expect(result2.success).toBe(true);

        expect(serviceAny.keptAliveSessions.size).toBe(2);

        // Cleanup
        await service.cleanup();

        expect(session1.destroy).toHaveBeenCalled();
        expect(session2.destroy).toHaveBeenCalled();
        expect(serviceAny.keptAliveSessions.size).toBe(0);
        expect(serviceAny.keepAliveCleanupTimer).toBeUndefined();
    });
});
