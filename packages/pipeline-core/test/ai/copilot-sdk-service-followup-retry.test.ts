/**
 * Tests for sendFollowUp retry-on-disposed-connection behavior.
 *
 * When a kept-alive session's underlying JSON-RPC connection is disposed,
 * sendFollowUp should automatically retry once via resumeSession.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { CopilotSDKService, resetCopilotSDKService } from '../../src/copilot-sdk-wrapper/copilot-sdk-service';
import { setLogger, nullLogger } from '../../src/logger';
import {
    createMockSession,
    createMockSDKModule,
    setupService,
} from '../helpers/mock-sdk';

setLogger(nullLogger);

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

describe('CopilotSDKService - Follow-up Retry on Disposed Connection', () => {
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

    /**
     * Helper: create a service with a kept-alive session that will throw on
     * the next sendAndWait call, and a mock client whose resumeSession
     * returns a fresh session.
     */
    function setupWithDisposedSession(opts: {
        initialError: Error;
        resumedResponse?: any;
        resumedError?: Error;
        resumeThrows?: boolean;
    }) {
        const initialSession = createMockSession({ sessionId: 'sess-1' });
        const { MockCopilotClient, mockClient } = createMockSDKModule(initialSession);

        const serviceAny = service as any;
        serviceAny.sdkModule = { CopilotClient: MockCopilotClient };
        serviceAny.availabilityCache = { available: true, sdkPath: '/fake/sdk' };

        // Simulate kept-alive session already in memory
        const now = Date.now();
        serviceAny.keptAliveSessions.set('sess-1', {
            session: initialSession,
            createdAt: now,
            lastUsedAt: now,
            workingDirectory: '/test',
        });

        // Make the initial session throw
        initialSession.sendAndWait.mockRejectedValueOnce(opts.initialError);

        // Configure resume behavior
        if (opts.resumeThrows) {
            mockClient.resumeSession.mockRejectedValue(new Error('Resume unavailable'));
        } else {
            const resumedSession = createMockSession({
                sessionId: 'sess-1',
                sendAndWaitResponse: opts.resumedResponse ?? { data: { content: 'retried response' } },
                sendAndWaitError: opts.resumedError,
            });
            mockClient.resumeSession.mockResolvedValue(resumedSession);
        }

        return { initialSession, mockClient };
    }

    // ========================================================================
    // Test 1: Retry succeeds after connection disposed error
    // ========================================================================
    it('should retry via resume when sendFollowUp hits "Connection is disposed"', async () => {
        const { mockClient } = setupWithDisposedSession({
            initialError: new Error('Connection is disposed'),
            resumedResponse: { data: { content: 'retried response' } },
        });

        const result = await service.sendFollowUp('sess-1', 'Follow-up prompt');

        expect(result.success).toBe(true);
        expect(result.response).toBe('retried response');
        expect(result.sessionId).toBe('sess-1');
        expect(mockClient.resumeSession).toHaveBeenCalledWith('sess-1', expect.any(Object));
    });

    // ========================================================================
    // Test 2: Retry succeeds with "connection closed" variant
    // ========================================================================
    it('should retry on "connection closed" error', async () => {
        setupWithDisposedSession({
            initialError: new Error('connection closed before response'),
            resumedResponse: { data: { content: 'recovered' } },
        });

        const result = await service.sendFollowUp('sess-1', 'Follow-up');

        expect(result.success).toBe(true);
        expect(result.response).toBe('recovered');
    });

    // ========================================================================
    // Test 3: Retry succeeds with error code 2
    // ========================================================================
    it('should retry when error has code 2', async () => {
        const err = new Error('some connection error');
        (err as any).code = 2;
        setupWithDisposedSession({
            initialError: err,
            resumedResponse: { data: { content: 'code-2 recovery' } },
        });

        const result = await service.sendFollowUp('sess-1', 'Follow-up');

        expect(result.success).toBe(true);
        expect(result.response).toBe('code-2 recovery');
    });

    // ========================================================================
    // Test 4: Retry fails — returns original error
    // ========================================================================
    it('should return original error when retry also fails', async () => {
        setupWithDisposedSession({
            initialError: new Error('Connection is disposed'),
            resumedError: new Error('Retry also broke'),
        });

        const result = await service.sendFollowUp('sess-1', 'Follow-up');

        expect(result.success).toBe(false);
        expect(result.error).toContain('Connection is disposed');
    });

    // ========================================================================
    // Test 5: Resume fails — returns original error without retry
    // ========================================================================
    it('should return original error when resume itself fails', async () => {
        setupWithDisposedSession({
            initialError: new Error('Connection is disposed'),
            resumeThrows: true,
        });

        const result = await service.sendFollowUp('sess-1', 'Follow-up');

        expect(result.success).toBe(false);
        expect(result.error).toContain('Connection is disposed');
    });

    // ========================================================================
    // Test 6: Non-connection error — no retry attempted
    // ========================================================================
    it('should NOT retry on non-connection errors', async () => {
        const { mockClient } = setupWithDisposedSession({
            initialError: new Error('Rate limit exceeded'),
        });

        const result = await service.sendFollowUp('sess-1', 'Follow-up');

        expect(result.success).toBe(false);
        expect(result.error).toContain('Rate limit exceeded');
        // resumeSession should NOT be called for non-connection errors
        expect(mockClient.resumeSession).not.toHaveBeenCalled();
    });

    // ========================================================================
    // Test 7: Only retries once — second disposed error does not retry again
    // ========================================================================
    it('should only retry once even if retry also throws connection disposed', async () => {
        setupWithDisposedSession({
            initialError: new Error('Connection is disposed'),
            resumedError: new Error('Connection is disposed'),
        });

        const result = await service.sendFollowUp('sess-1', 'Follow-up');

        // Should fail after the single retry attempt
        expect(result.success).toBe(false);
        expect(result.error).toContain('Connection is disposed');
    });

    // ========================================================================
    // Test 8: Broken session is destroyed before retry
    // ========================================================================
    it('should destroy the broken session before attempting resume', async () => {
        const { initialSession, mockClient } = setupWithDisposedSession({
            initialError: new Error('Connection is disposed'),
            resumedResponse: { data: { content: 'ok' } },
        });

        await service.sendFollowUp('sess-1', 'Follow-up');

        // The original broken session should have been destroyed
        expect(initialSession.destroy).toHaveBeenCalled();
        // And resume should have been called
        expect(mockClient.resumeSession).toHaveBeenCalled();
    });

    // ========================================================================
    // Test 9: Retry cleans up resumed session on failure
    // ========================================================================
    it('should destroy resumed session when retry fails', async () => {
        const resumedSession = createMockSession({
            sessionId: 'sess-1',
            sendAndWaitError: new Error('Retry failed too'),
        });
        const { MockCopilotClient, mockClient } = createMockSDKModule(
            createMockSession({ sessionId: 'sess-1' }),
        );
        mockClient.resumeSession.mockResolvedValue(resumedSession);

        const serviceAny = service as any;
        serviceAny.sdkModule = { CopilotClient: MockCopilotClient };
        serviceAny.availabilityCache = { available: true, sdkPath: '/fake/sdk' };

        const initialSession = createMockSession({ sessionId: 'sess-1' });
        initialSession.sendAndWait.mockRejectedValueOnce(new Error('Connection is disposed'));
        serviceAny.keptAliveSessions.set('sess-1', {
            session: initialSession,
            createdAt: Date.now(),
            lastUsedAt: Date.now(),
            workingDirectory: '/test',
        });

        const result = await service.sendFollowUp('sess-1', 'Follow-up');

        expect(result.success).toBe(false);
        // The resumed session should also be destroyed
        expect(resumedSession.destroy).toHaveBeenCalled();
        // And it should be removed from keptAliveSessions
        expect(serviceAny.keptAliveSessions.has('sess-1')).toBe(false);
    });
});
