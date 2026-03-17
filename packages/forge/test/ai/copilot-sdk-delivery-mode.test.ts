/**
 * Copilot SDK Service — Delivery Mode Tests
 *
 * Tests for the `deliveryMode` option in `sendMessage()`:
 * - sendWithStreaming forwards deliveryMode to session.send()
 * - One-shot session warning when deliveryMode is set without sessionId
 * - Resumed session preserves deliveryMode
 * - sendWithTimeout does not forward deliveryMode
 * - Existing behavior unchanged when deliveryMode is undefined
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { CopilotSDKService, resetCopilotSDKService } from '../../src/copilot-sdk-wrapper/copilot-sdk-service';
import { setLogger, nullLogger } from '../../src/logger';
import {
    createStreamingMockSDKModule,
    createStreamingMockSession,
} from '../helpers/mock-sdk';

// Suppress logger output during tests
setLogger(nullLogger);

// Shared warn spy — reset in beforeEach
const warnSpy = vi.fn();

vi.mock('../../src/ai-logger', () => {
    const mockChildLogger = {
        debug: vi.fn(),
        info: vi.fn(),
        warn: (...args: any[]) => warnSpy(...args),
        error: vi.fn(),
        fatal: vi.fn(),
        trace: vi.fn(),
        child: vi.fn().mockReturnThis(),
        level: 'debug',
    };
    return {
        getAIServiceLogger: vi.fn().mockReturnValue(mockChildLogger),
        createSessionLogger: vi.fn().mockReturnValue(mockChildLogger),
        initAIServiceLogger: vi.fn(),
    };
});

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

describe('CopilotSDKService - Delivery Mode', () => {
    let service: CopilotSDKService;

    beforeEach(() => {
        resetCopilotSDKService();
        service = CopilotSDKService.getInstance();
        warnSpy.mockClear();
        vi.clearAllMocks();
    });

    afterEach(async () => {
        service.dispose();
        resetCopilotSDKService();
    });

    function wireStreamingService() {
        const sdkModule = createStreamingMockSDKModule();
        const serviceAny = service as any;
        serviceAny.sdkModule = { CopilotClient: sdkModule.MockCopilotClient };
        serviceAny.availabilityCache = { available: true, sdkPath: '/fake/sdk' };
        return sdkModule;
    }

    /**
     * Helper: send a streaming message and immediately dispatch session.idle
     * so the promise resolves.
     */
    async function sendStreamingMessage(
        sdkModule: ReturnType<typeof createStreamingMockSDKModule>,
        options: {
            deliveryMode?: 'immediate' | 'enqueue';
            sessionId?: string;
        } = {}
    ) {
        const resultPromise = service.sendMessage({
            prompt: 'test prompt',
            streaming: true,
            workingDirectory: '/test',
            timeoutMs: 30000,
            loadDefaultMcpConfig: false,
            ...options,
        });

        // Wait for session creation and event handler registration
        await vi.waitFor(() => {
            expect(sdkModule.sessions.length).toBeGreaterThan(0);
        });

        const sessionResult = sdkModule.sessions[sdkModule.sessions.length - 1];
        // Simulate a response then idle so the promise settles
        sessionResult.dispatchEvent({ type: 'assistant.message', data: { content: 'ok' } });
        sessionResult.dispatchEvent({ type: 'session.idle', data: {} });

        return resultPromise;
    }

    // ========================================================================
    // sendWithStreaming forwards deliveryMode
    // ========================================================================

    it('should forward deliveryMode: "enqueue" to session.send()', async () => {
        const sdkModule = wireStreamingService();

        await sendStreamingMessage(sdkModule, { deliveryMode: 'enqueue' });

        const session = sdkModule.sessions[0].session;
        expect(session.send).toHaveBeenCalledTimes(1);
        const sendArgs = session.send.mock.calls[0][0];
        expect(sendArgs.deliveryMode).toBe('enqueue');
    });

    it('should forward deliveryMode: "immediate" to session.send()', async () => {
        const sdkModule = wireStreamingService();

        await sendStreamingMessage(sdkModule, { deliveryMode: 'immediate' });

        const session = sdkModule.sessions[0].session;
        expect(session.send).toHaveBeenCalledTimes(1);
        const sendArgs = session.send.mock.calls[0][0];
        expect(sendArgs.deliveryMode).toBe('immediate');
    });

    it('should not include deliveryMode when it is undefined', async () => {
        const sdkModule = wireStreamingService();

        await sendStreamingMessage(sdkModule, {});

        const session = sdkModule.sessions[0].session;
        expect(session.send).toHaveBeenCalledTimes(1);
        const sendArgs = session.send.mock.calls[0][0];
        expect(sendArgs.deliveryMode).toBeUndefined();
    });

    // ========================================================================
    // One-shot session warning
    // ========================================================================

    it('should warn when deliveryMode is set on a one-shot session (no sessionId)', async () => {
        const sdkModule = wireStreamingService();

        await sendStreamingMessage(sdkModule, { deliveryMode: 'enqueue' });

        const warnCalls = warnSpy.mock.calls.map((c: any[]) =>
            c.map(arg => (typeof arg === 'string' ? arg : JSON.stringify(arg))).join(' ')
        );
        const hasOneShotWarning = warnCalls.some((msg: string) =>
            msg.includes('one-shot session')
        );
        expect(hasOneShotWarning).toBe(true);
    });

    it('should NOT warn when deliveryMode is set with a sessionId (resumed session)', async () => {
        const sdkModule = wireStreamingService();

        // Make resumeSession return a streaming session
        const resumedSessionResult = createStreamingMockSession('resumed-session');
        sdkModule.mockClient.resumeSession.mockResolvedValue(resumedSessionResult.session);

        const resultPromise = service.sendMessage({
            prompt: 'follow-up',
            streaming: true,
            workingDirectory: '/test',
            timeoutMs: 30000,
            loadDefaultMcpConfig: false,
            deliveryMode: 'enqueue',
            sessionId: 'existing-session-id',
        });

        // The resumed session was used directly, not via createSession
        await vi.waitFor(() => {
            expect(resumedSessionResult.session.send).toHaveBeenCalled();
        });

        resumedSessionResult.dispatchEvent({ type: 'assistant.message', data: { content: 'ok' } });
        resumedSessionResult.dispatchEvent({ type: 'session.idle', data: {} });

        await resultPromise;

        const warnCalls = warnSpy.mock.calls.map((c: any[]) =>
            c.map(arg => (typeof arg === 'string' ? arg : JSON.stringify(arg))).join(' ')
        );
        const hasOneShotWarning = warnCalls.some((msg: string) =>
            msg.includes('one-shot session')
        );
        expect(hasOneShotWarning).toBe(false);
    });

    // ========================================================================
    // Resumed session preserves deliveryMode
    // ========================================================================

    it('should forward deliveryMode through a resumed session', async () => {
        const sdkModule = wireStreamingService();

        const resumedSessionResult = createStreamingMockSession('resumed-session');
        sdkModule.mockClient.resumeSession.mockResolvedValue(resumedSessionResult.session);

        const resultPromise = service.sendMessage({
            prompt: 'follow-up',
            streaming: true,
            workingDirectory: '/test',
            timeoutMs: 30000,
            loadDefaultMcpConfig: false,
            deliveryMode: 'immediate',
            sessionId: 'existing-session-id',
        });

        await vi.waitFor(() => {
            expect(resumedSessionResult.session.send).toHaveBeenCalled();
        });

        const sendArgs = resumedSessionResult.session.send.mock.calls[0][0];
        expect(sendArgs.deliveryMode).toBe('immediate');

        resumedSessionResult.dispatchEvent({ type: 'assistant.message', data: { content: 'ok' } });
        resumedSessionResult.dispatchEvent({ type: 'session.idle', data: {} });

        const result = await resultPromise;
        expect(result.success).toBe(true);
    });

    // ========================================================================
    // sendWithTimeout does not forward deliveryMode
    // ========================================================================

    it('should NOT forward deliveryMode via sendWithTimeout (non-streaming)', async () => {
        // Use non-streaming SDK module (no session.on / session.send)
        const mockSession = {
            sessionId: 'non-streaming-session',
            sendAndWait: vi.fn().mockResolvedValue({ data: { content: 'response' } }),
            destroy: vi.fn().mockResolvedValue(undefined),
        };

        const capturedOptions: any[] = [];
        const mockClient = {
            createSession: vi.fn().mockResolvedValue(mockSession),
            resumeSession: vi.fn().mockRejectedValue(new Error('not found')),
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
            prompt: 'test',
            streaming: false,
            workingDirectory: '/test',
            timeoutMs: 10000,
            loadDefaultMcpConfig: false,
            deliveryMode: 'enqueue',
        });

        expect(result.success).toBe(true);
        expect(mockSession.sendAndWait).toHaveBeenCalledTimes(1);
        // sendAndWait should NOT receive any mode/deliveryMode property
        const sendAndWaitArgs = mockSession.sendAndWait.mock.calls[0][0];
        expect(sendAndWaitArgs).not.toHaveProperty('mode');
        expect(sendAndWaitArgs).not.toHaveProperty('deliveryMode');
    });

    // ========================================================================
    // No regression: undefined deliveryMode ≡ pre-commit behaviour
    // ========================================================================

    it('should behave identically to pre-commit when deliveryMode is not set', async () => {
        const sdkModule = wireStreamingService();

        await sendStreamingMessage(sdkModule, {});

        const session = sdkModule.sessions[0].session;
        expect(session.send).toHaveBeenCalledTimes(1);
        const sendArgs = session.send.mock.calls[0][0];
        // Only prompt and attachments should be set; deliveryMode should be absent/undefined
        expect(sendArgs).toHaveProperty('prompt', 'test prompt');
        expect(sendArgs.deliveryMode).toBeUndefined();
    });
});
