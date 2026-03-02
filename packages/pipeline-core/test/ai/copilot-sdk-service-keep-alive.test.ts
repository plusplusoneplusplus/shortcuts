/**
 * Copilot SDK Service Keep-Alive Tests
 *
 * Tests for the session keep-alive and follow-up message functionality.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { CopilotSDKService, resetCopilotSDKService, SendFollowUpOptions } from '../../src/copilot-sdk-wrapper/copilot-sdk-service';
import { setLogger, nullLogger } from '../../src/logger';
import {
    createMockSession,
    createMockSDKModule,
    createStreamingMockSession,
    setupService,
} from '../helpers/mock-sdk';

// Suppress logger output during tests
setLogger(nullLogger);

// vi.mock factories must be inline (hoisted before imports)
vi.mock('../../src/copilot-sdk-wrapper/trusted-folder', async () => {
    const actual = await vi.importActual('../../src/copilot-sdk-wrapper/trusted-folder');
    return { ...actual, ensureFolderTrusted: vi.fn() };
});

vi.mock('../../src/copilot-sdk-wrapper/mcp-config-loader', () => ({
    loadDefaultMcpConfig: vi.fn().mockReturnValue({
        success: false, fileExists: false, mcpServers: {},
    }),
    mergeMcpConfigs: vi.fn().mockImplementation(
        (base: Record<string, any>, override?: Record<string, any>) => ({ ...base, ...override }),
    ),
}));

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
        // Use mocked SDK client so this test never touches real Copilot CLI.
        setupService(service, createMockSession());
        const result = await service.sendFollowUp('non-existent-id', 'Follow-up');

        expect(result.success).toBe(false);
        expect(result.error).toMatch(/not found/);
    });

    it('should resume a persisted session by ID when not present in memory', async () => {
        const resumedSession = createMockSession({
            sessionId: 'sess-persisted',
            sendAndWaitResponse: { data: { content: 'resumed response' } },
        });
        const { MockCopilotClient, mockClient } = createMockSDKModule();
        mockClient.resumeSession.mockResolvedValue(resumedSession);

        const serviceAny = service as any;
        serviceAny.sdkModule = { CopilotClient: MockCopilotClient };
        serviceAny.availabilityCache = { available: true, sdkPath: '/fake/sdk' };

        const result = await service.sendFollowUp('sess-persisted', 'Follow-up', {
            workingDirectory: '/test',
        });

        expect(result.success).toBe(true);
        expect(result.response).toBe('resumed response');
        expect(result.sessionId).toBe('sess-persisted');
        expect(mockClient.resumeSession).toHaveBeenCalledWith(
            'sess-persisted',
            expect.objectContaining({}),
        );
        expect(resumedSession.sendAndWait).toHaveBeenCalledWith(
            expect.objectContaining({ prompt: 'Follow-up' }),
            expect.any(Number),
        );
        expect((service as any).keptAliveSessions.has('sess-persisted')).toBe(true);
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

    // ========================================================================
    // Test 12: Per-session client isolation — each session gets its own client
    // ========================================================================
    it('should create a separate client per session (no shared client)', async () => {
        let clientCount = 0;
        const session1 = createMockSession({ sessionId: 'session-a' });
        const session2 = createMockSession({ sessionId: 'session-b' });
        const clients: any[] = [];

        class MockCopilotClient {
            createSession: ReturnType<typeof vi.fn>;
            resumeSession = vi.fn().mockRejectedValue(new Error('not found'));
            stop = vi.fn().mockResolvedValue(undefined);
            constructor() {
                clientCount++;
                const session = clientCount === 1 ? session1 : session2;
                this.createSession = vi.fn().mockResolvedValue(session);
                clients.push(this);
            }
        }

        const serviceAny = service as any;
        serviceAny.sdkModule = { CopilotClient: MockCopilotClient };
        serviceAny.availabilityCache = { available: true, sdkPath: '/fake/sdk' };

        // Send two keepAlive messages with different cwds
        const result1 = await service.sendMessage({
            prompt: 'Hello',
            workingDirectory: '/project-a',
            keepAlive: true,
            loadDefaultMcpConfig: false,
        });
        expect(result1.success).toBe(true);

        const result2 = await service.sendMessage({
            prompt: 'World',
            workingDirectory: '/project-b',
            keepAlive: true,
            loadDefaultMcpConfig: false,
        });
        expect(result2.success).toBe(true);

        // Two separate clients should have been created
        expect(clientCount).toBe(2);
        expect(clients.length).toBe(2);

        // Both sessions should still be alive (different cwd didn't kill first session)
        expect(serviceAny.keptAliveSessions.has('session-a')).toBe(true);
        expect(serviceAny.keptAliveSessions.has('session-b')).toBe(true);

        // Each kept-alive entry should have its own client
        const entryA = serviceAny.keptAliveSessions.get('session-a');
        const entryB = serviceAny.keptAliveSessions.get('session-b');
        expect(entryA.client).toBe(clients[0]);
        expect(entryB.client).toBe(clients[1]);
        expect(entryA.client).not.toBe(entryB.client);
    });

    // ========================================================================
    // Test 13: Client is stopped when session is destroyed (non-keepAlive)
    // ========================================================================
    it('should stop the per-session client when session is not kept alive', async () => {
        const mockSession = createMockSession();
        const mockClientStop = vi.fn().mockResolvedValue(undefined);

        class MockCopilotClient {
            createSession = vi.fn().mockResolvedValue(mockSession);
            resumeSession = vi.fn().mockRejectedValue(new Error('not found'));
            stop = mockClientStop;
            constructor() {}
        }

        const serviceAny = service as any;
        serviceAny.sdkModule = { CopilotClient: MockCopilotClient };
        serviceAny.availabilityCache = { available: true, sdkPath: '/fake/sdk' };

        const result = await service.sendMessage({
            prompt: 'Hello',
            workingDirectory: '/test',
            keepAlive: false,
            loadDefaultMcpConfig: false,
        });

        expect(result.success).toBe(true);
        // Session destroyed
        expect(mockSession.destroy).toHaveBeenCalled();
        // Client stopped
        expect(mockClientStop).toHaveBeenCalled();
    });

    // ========================================================================
    // Test 14: cleanup() stops clients for all kept-alive sessions
    // ========================================================================
    it('should stop clients for all kept-alive sessions on cleanup()', async () => {
        const session1 = createMockSession({ sessionId: 'session-1' });
        const session2 = createMockSession({ sessionId: 'session-2' });
        let callCount = 0;
        const clientStops: ReturnType<typeof vi.fn>[] = [];

        class MockCopilotClient {
            createSession: ReturnType<typeof vi.fn>;
            resumeSession = vi.fn().mockRejectedValue(new Error('not found'));
            stop = vi.fn().mockResolvedValue(undefined);
            constructor() {
                callCount++;
                this.createSession = vi.fn().mockResolvedValue(
                    callCount === 1 ? session1 : session2
                );
                clientStops.push(this.stop);
            }
        }

        const serviceAny = service as any;
        serviceAny.sdkModule = { CopilotClient: MockCopilotClient };
        serviceAny.availabilityCache = { available: true, sdkPath: '/fake/sdk' };

        await service.sendMessage({
            prompt: 'Hello', workingDirectory: '/test',
            keepAlive: true, loadDefaultMcpConfig: false,
        });
        await service.sendMessage({
            prompt: 'World', workingDirectory: '/test',
            keepAlive: true, loadDefaultMcpConfig: false,
        });

        expect(serviceAny.keptAliveSessions.size).toBe(2);

        await service.cleanup();

        // Both sessions destroyed AND both clients stopped
        expect(session1.destroy).toHaveBeenCalled();
        expect(session2.destroy).toHaveBeenCalled();
        expect(clientStops[0]).toHaveBeenCalled();
        expect(clientStops[1]).toHaveBeenCalled();
    });
});
