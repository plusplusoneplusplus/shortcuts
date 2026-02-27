/**
 * CopilotSDKService Attachment Forwarding Tests
 *
 * Verifies that the `attachments` field from SendMessageOptions and
 * SendFollowUpOptions is correctly forwarded through sendWithTimeout /
 * sendWithStreaming to the underlying SDK session methods.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { CopilotSDKService, resetCopilotSDKService } from '../../src/copilot-sdk-wrapper/copilot-sdk-service';
import { setLogger, nullLogger } from '../../src/logger';
import {
    createStreamingMockSession,
    createStreamingMockSDKModule,
    createMockSDKModule,
} from '../helpers/mock-sdk';

// Suppress logger output during tests
setLogger(nullLogger);

// Mock trusted-folder and mcp-config-loader to avoid filesystem access
vi.mock('../../src/copilot-sdk-wrapper/trusted-folder', () => ({
    ensureFolderTrusted: vi.fn(),
}));

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

describe('CopilotSDKService - Attachment Forwarding', () => {
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

    // ========================================================================
    // sendMessage — non-streaming path (sendAndWait)
    // ========================================================================

    it('should forward attachments to session.sendAndWait (non-streaming path)', async () => {
        const mockSession = {
            sessionId: 'attach-non-streaming',
            sendAndWait: vi.fn().mockResolvedValue({ data: { content: 'response' } }),
            destroy: vi.fn().mockResolvedValue(undefined),
            on: vi.fn(),
            send: vi.fn(),
        };

        const { MockCopilotClient } = createMockSDKModule(mockSession);
        const serviceAny = service as any;
        serviceAny.sdkModule = { CopilotClient: MockCopilotClient };
        serviceAny.availabilityCache = { available: true, sdkPath: '/fake/sdk' };

        const attachments = [{ type: 'file' as const, path: '/tmp/foo.ts' }];

        const result = await service.sendMessage({
            prompt: 'Explain this file',
            workingDirectory: '/test',
            timeoutMs: 60000,
            loadDefaultMcpConfig: false,
            attachments,
        });

        expect(result.success).toBe(true);
        expect(result.response).toBe('response');
        expect(mockSession.sendAndWait).toHaveBeenCalledWith(
            { prompt: 'Explain this file', attachments },
            60000,
        );
    });

    // ========================================================================
    // sendMessage — streaming path (session.send)
    // ========================================================================

    it('should forward attachments to session.send (streaming path)', async () => {
        const { session, dispatchEvent } = createStreamingMockSession('attach-streaming');
        const { MockCopilotClient } = createMockSDKModule(session);
        const serviceAny = service as any;
        serviceAny.sdkModule = { CopilotClient: MockCopilotClient };
        serviceAny.availabilityCache = { available: true, sdkPath: '/fake/sdk' };

        const attachments = [
            { type: 'directory' as const, path: '/tmp/src', displayName: 'source' },
        ];

        const resultPromise = service.sendMessage({
            prompt: 'Analyze this directory',
            workingDirectory: '/test',
            streaming: true,
            loadDefaultMcpConfig: false,
            attachments,
        });

        // Allow the send call to be invoked
        await new Promise(r => setTimeout(r, 50));

        // Dispatch streaming events to complete the request
        dispatchEvent({ type: 'assistant.message_delta', data: { deltaContent: 'Done' } });
        dispatchEvent({ type: 'session.idle', data: {} });

        const result = await resultPromise;
        expect(result.success).toBe(true);
        expect(session.send).toHaveBeenCalledWith(
            { prompt: 'Analyze this directory', attachments },
        );
    });

    // ========================================================================
    // sendMessage — without attachments (backward compatibility)
    // ========================================================================

    it('should work without attachments (backward compatibility)', async () => {
        const mockSession = {
            sessionId: 'no-attachments',
            sendAndWait: vi.fn().mockResolvedValue({ data: { content: 'ok' } }),
            destroy: vi.fn().mockResolvedValue(undefined),
            on: vi.fn(),
            send: vi.fn(),
        };

        const { MockCopilotClient } = createMockSDKModule(mockSession);
        const serviceAny = service as any;
        serviceAny.sdkModule = { CopilotClient: MockCopilotClient };
        serviceAny.availabilityCache = { available: true, sdkPath: '/fake/sdk' };

        const result = await service.sendMessage({
            prompt: 'Hello',
            workingDirectory: '/test',
            timeoutMs: 60000,
            loadDefaultMcpConfig: false,
        });

        expect(result.success).toBe(true);
        expect(result.response).toBe('ok');
        // attachments should be undefined in the call
        expect(mockSession.sendAndWait).toHaveBeenCalledWith(
            { prompt: 'Hello', attachments: undefined },
            60000,
        );
    });

    // ========================================================================
    // sendFollowUp — streaming path
    // ========================================================================

    it('should forward attachments through sendFollowUp (streaming path)', async () => {
        // Create a streaming session that will be kept alive
        const { MockCopilotClient, sessions } = createStreamingMockSDKModule();
        const serviceAny = service as any;
        serviceAny.sdkModule = { CopilotClient: MockCopilotClient };
        serviceAny.availabilityCache = { available: true, sdkPath: '/fake/sdk' };

        // First, send a message with keepAlive to establish the session
        const firstPromise = service.sendMessage({
            prompt: 'Initial prompt',
            workingDirectory: '/test',
            streaming: true,
            keepAlive: true,
            loadDefaultMcpConfig: false,
        });

        await new Promise(r => setTimeout(r, 50));
        const firstSession = sessions[0];
        firstSession.dispatchEvent({ type: 'assistant.message_delta', data: { deltaContent: 'First response' } });
        firstSession.dispatchEvent({ type: 'session.idle', data: {} });

        const firstResult = await firstPromise;
        expect(firstResult.success).toBe(true);
        const sessionId = firstResult.sessionId!;

        // Now send a follow-up with attachments
        const attachments = [{ type: 'file' as const, path: '/tmp/image.png', displayName: 'screenshot' }];

        // Reset the send mock to track the follow-up call
        firstSession.session.send.mockClear();

        const followUpPromise = service.sendFollowUp(sessionId, 'Follow up with image', {
            onStreamingChunk: () => {},
            attachments,
        });

        await new Promise(r => setTimeout(r, 50));
        firstSession.dispatchEvent({ type: 'assistant.message_delta', data: { deltaContent: 'Follow-up response' } });
        firstSession.dispatchEvent({ type: 'session.idle', data: {} });

        const followUpResult = await followUpPromise;
        expect(followUpResult.success).toBe(true);
        expect(firstSession.session.send).toHaveBeenCalledWith(
            { prompt: 'Follow up with image', attachments },
        );
    });

    // ========================================================================
    // sendFollowUp — non-streaming path
    // ========================================================================

    it('should forward attachments through sendFollowUp (non-streaming path)', async () => {
        // Create a streaming session for the initial keepAlive call
        const { MockCopilotClient, sessions } = createStreamingMockSDKModule();
        const serviceAny = service as any;
        serviceAny.sdkModule = { CopilotClient: MockCopilotClient };
        serviceAny.availabilityCache = { available: true, sdkPath: '/fake/sdk' };

        // First, send a message with keepAlive
        const firstPromise = service.sendMessage({
            prompt: 'Initial prompt',
            workingDirectory: '/test',
            streaming: true,
            keepAlive: true,
            loadDefaultMcpConfig: false,
        });

        await new Promise(r => setTimeout(r, 50));
        const firstSession = sessions[0];
        firstSession.dispatchEvent({ type: 'assistant.message_delta', data: { deltaContent: 'First response' } });
        firstSession.dispatchEvent({ type: 'session.idle', data: {} });

        const firstResult = await firstPromise;
        expect(firstResult.success).toBe(true);
        const sessionId = firstResult.sessionId!;

        // Configure sendAndWait for the non-streaming follow-up path
        firstSession.session.sendAndWait.mockResolvedValue({ data: { content: 'Non-streaming follow-up' } });

        const attachments = [{ type: 'file' as const, path: '/tmp/diagram.png' }];

        // Follow-up without onStreamingChunk and with short timeout → non-streaming path
        const followUpResult = await service.sendFollowUp(sessionId, 'Follow up with diagram', {
            timeoutMs: 30000,
            attachments,
        });

        expect(followUpResult.success).toBe(true);
        expect(followUpResult.response).toBe('Non-streaming follow-up');
        expect(firstSession.session.sendAndWait).toHaveBeenCalledWith(
            { prompt: 'Follow up with diagram', attachments },
            30000,
        );
    });
});
