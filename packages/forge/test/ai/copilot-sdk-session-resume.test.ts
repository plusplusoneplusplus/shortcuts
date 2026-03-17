/**
 * Copilot SDK Service — Session Resume Tests
 *
 * Tests for the `sessionId` option in `sendMessage()`:
 * - When `sessionId` is provided, calls `client.resumeSession()` instead of `createSession()`
 * - When `resumeSession()` fails, falls back to `createSession()`
 * - When `sessionId` is absent, `createSession()` is called as before (no regression)
 * - `onSessionCreated` fires in both resume and fallback paths
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { CopilotSDKService, resetCopilotSDKService } from '../../src/copilot-sdk-wrapper/copilot-sdk-service';
import { setLogger, nullLogger } from '../../src/logger';
import {
    createMockSDKModule,
    createStreamingMockSDKModule,
    createMockSession,
} from '../helpers/mock-sdk';

// Suppress logger output during tests
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

describe('CopilotSDKService - Session Resume', () => {
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
     * Wire a mock SDK module into the service internals.
     */
    function wireService(sdkModule: { MockCopilotClient: new (...args: any[]) => any }) {
        const serviceAny = service as any;
        serviceAny.sdkModule = { CopilotClient: sdkModule.MockCopilotClient };
        serviceAny.availabilityCache = { available: true, sdkPath: '/fake/sdk' };
    }

    // ========================================================================
    // Resume Path
    // ========================================================================

    it('should call resumeSession when sessionId is provided', async () => {
        const resumedSession = createMockSession({ sessionId: 'resumed-sess-1' });
        const sdkModule = createMockSDKModule();
        sdkModule.mockClient.resumeSession.mockResolvedValue(resumedSession);
        wireService(sdkModule);

        const result = await service.sendMessage({
            prompt: 'follow-up',
            sessionId: 'original-sess-1',
            workingDirectory: '/test',
            timeoutMs: 10000,
            loadDefaultMcpConfig: false,
        });

        expect(result.success).toBe(true);
        expect(sdkModule.mockClient.resumeSession).toHaveBeenCalledTimes(1);
        expect(sdkModule.mockClient.resumeSession).toHaveBeenCalledWith(
            'original-sess-1',
            expect.any(Object),
        );
        // createSession should NOT have been called
        expect(sdkModule.mockClient.createSession).not.toHaveBeenCalled();
    });

    it('should fire onSessionCreated with the resumed session ID', async () => {
        const resumedSession = createMockSession({ sessionId: 'resumed-abc' });
        const sdkModule = createMockSDKModule();
        sdkModule.mockClient.resumeSession.mockResolvedValue(resumedSession);
        wireService(sdkModule);

        const receivedIds: string[] = [];
        await service.sendMessage({
            prompt: 'test',
            sessionId: 'old-sess',
            workingDirectory: '/test',
            timeoutMs: 10000,
            loadDefaultMcpConfig: false,
            onSessionCreated: (id) => receivedIds.push(id),
        });

        expect(receivedIds).toEqual(['resumed-abc']);
    });

    it('should return the response from the resumed session', async () => {
        const resumedSession = createMockSession({
            sessionId: 'resumed-resp',
            sendAndWaitResponse: { data: { content: 'resumed-response-text' } },
        });
        const sdkModule = createMockSDKModule();
        sdkModule.mockClient.resumeSession.mockResolvedValue(resumedSession);
        wireService(sdkModule);

        const result = await service.sendMessage({
            prompt: 'test',
            sessionId: 'old-sess',
            workingDirectory: '/test',
            timeoutMs: 10000,
            loadDefaultMcpConfig: false,
        });

        expect(result.success).toBe(true);
        expect(result.response).toBe('resumed-response-text');
    });

    // ========================================================================
    // Fallback Path
    // ========================================================================

    it('should fall back to createSession when resumeSession fails', async () => {
        const freshSession = createMockSession({
            sessionId: 'fallback-fresh-sess',
            sendAndWaitResponse: { data: { content: 'fallback response' } },
        });

        const sdkModule = createMockSDKModule(freshSession);
        // Override resumeSession to reject
        sdkModule.mockClient.resumeSession.mockRejectedValue(new Error('Session expired'));
        wireService(sdkModule);

        const receivedIds: string[] = [];
        const result = await service.sendMessage({
            prompt: 'test',
            sessionId: 'expired-sess',
            workingDirectory: '/test',
            timeoutMs: 10000,
            loadDefaultMcpConfig: false,
            onSessionCreated: (id) => receivedIds.push(id),
        });

        expect(result.success).toBe(true);
        expect(result.response).toBe('fallback response');
        // Both resume and create should have been attempted
        expect(sdkModule.mockClient.resumeSession).toHaveBeenCalledTimes(1);
        expect(sdkModule.mockClient.createSession).toHaveBeenCalledTimes(1);
        // onSessionCreated should fire with the new session ID
        expect(receivedIds).toEqual(['fallback-fresh-sess']);
    });

    // ========================================================================
    // No SessionId — Regression
    // ========================================================================

    it('should call createSession when no sessionId is provided (first turn)', async () => {
        const newSession = createMockSession({ sessionId: 'new-sess-1' });
        const sdkModule = createMockSDKModule(newSession);
        wireService(sdkModule);

        const result = await service.sendMessage({
            prompt: 'initial message',
            workingDirectory: '/test',
            timeoutMs: 10000,
            loadDefaultMcpConfig: false,
        });

        expect(result.success).toBe(true);
        expect(sdkModule.mockClient.createSession).toHaveBeenCalledTimes(1);
        expect(sdkModule.mockClient.resumeSession).not.toHaveBeenCalled();
    });

    it('should call createSession when sessionId is undefined', async () => {
        const newSession = createMockSession({ sessionId: 'new-sess-2' });
        const sdkModule = createMockSDKModule(newSession);
        wireService(sdkModule);

        const result = await service.sendMessage({
            prompt: 'test',
            sessionId: undefined,
            workingDirectory: '/test',
            timeoutMs: 10000,
            loadDefaultMcpConfig: false,
        });

        expect(result.success).toBe(true);
        expect(sdkModule.mockClient.createSession).toHaveBeenCalledTimes(1);
        expect(sdkModule.mockClient.resumeSession).not.toHaveBeenCalled();
    });

    // ========================================================================
    // Streaming + Resume
    // ========================================================================

    it('should call resumeSession in streaming path when sessionId is provided', async () => {
        const { MockCopilotClient, mockClient, sessions } = createStreamingMockSDKModule();
        const resumedStreamingSession = sessions.length; // will be 0 before call
        
        // Override resumeSession to return a streaming session
        const streamingHandlers: Array<(event: any) => void> = [];
        const streamingSession = {
            sessionId: 'stream-resumed-sess',
            sendAndWait: vi.fn(),
            destroy: vi.fn().mockResolvedValue(undefined),
            on: vi.fn().mockImplementation((handler: (event: any) => void) => {
                streamingHandlers.push(handler);
                return () => {};
            }),
            send: vi.fn().mockResolvedValue(undefined),
        };
        mockClient.resumeSession.mockResolvedValue(streamingSession);

        wireService({ MockCopilotClient });

        const resultPromise = service.sendMessage({
            prompt: 'streaming follow-up',
            sessionId: 'old-stream-sess',
            workingDirectory: '/test',
            timeoutMs: 200000, // triggers streaming path
            loadDefaultMcpConfig: false,
        });

        // Wait for handlers to be registered
        await vi.waitFor(() => {
            expect(streamingHandlers.length).toBeGreaterThan(0);
        }, { timeout: 1000 });

        // Settle the session
        for (const handler of streamingHandlers) {
            handler({ type: 'assistant.message', data: { content: 'streamed response', messageId: 'msg-1' } });
            handler({ type: 'session.idle', data: {} });
        }

        const result = await resultPromise;

        expect(result.success).toBe(true);
        expect(result.response).toBe('streamed response');
        expect(mockClient.resumeSession).toHaveBeenCalledWith('old-stream-sess', expect.any(Object));
        expect(mockClient.createSession).not.toHaveBeenCalled();
    });

    // ========================================================================
    // Edge: client without resumeSession (SDK version compat)
    // ========================================================================

    it('should fall back to createSession when client has no resumeSession method', async () => {
        const session = createMockSession({ sessionId: 'no-resume-method-sess' });

        // Create a mock SDK module without resumeSession on the client
        const capturedOptions: any[] = [];
        const mockClient = {
            createSession: vi.fn().mockResolvedValue(session),
            // No resumeSession property at all
            stop: vi.fn().mockResolvedValue(undefined),
        };

        class MockCopilotClient {
            constructor(options?: any) {
                capturedOptions.push(options);
                Object.assign(this, mockClient);
            }
        }

        wireService({ MockCopilotClient });

        const result = await service.sendMessage({
            prompt: 'test',
            sessionId: 'some-sess',
            workingDirectory: '/test',
            timeoutMs: 10000,
            loadDefaultMcpConfig: false,
        });

        expect(result.success).toBe(true);
        expect(mockClient.createSession).toHaveBeenCalledTimes(1);
    });
});
