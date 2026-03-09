/**
 * CopilotSDKService System Message Passthrough Tests
 *
 * Verifies that the `systemMessage` field from SendMessageOptions and
 * SendFollowUpOptions is correctly forwarded to the underlying SDK
 * session creation / resume methods.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { CopilotSDKService, resetCopilotSDKService } from '../../src/copilot-sdk-wrapper/copilot-sdk-service';
import { SystemMessageConfig } from '../../src/copilot-sdk-wrapper/types';
import { setLogger, nullLogger } from '../../src/logger';
import {
    createStreamingMockSession,
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

describe('CopilotSDKService - System Message Passthrough', () => {
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
    // sendMessage — non-streaming path with append mode
    // ========================================================================

    it('should forward systemMessage (append) to createSession (non-streaming path)', async () => {
        const mockSession = {
            sessionId: 'sysmsg-append-non-streaming',
            sendAndWait: vi.fn().mockResolvedValue({ data: { content: 'response' } }),
            destroy: vi.fn().mockResolvedValue(undefined),
            on: vi.fn(),
            send: vi.fn(),
        };

        const { MockCopilotClient, mockClient } = createMockSDKModule(mockSession);
        const serviceAny = service as any;
        serviceAny.sdkModule = { CopilotClient: MockCopilotClient };
        serviceAny.availabilityCache = { available: true, sdkPath: '/fake/sdk' };

        const systemMessage: SystemMessageConfig = {
            mode: 'append',
            content: 'You are a helpful code reviewer.',
        };

        await service.sendMessage({
            prompt: 'Review my code',
            workingDirectory: '/test',
            timeoutMs: 60000,
            loadDefaultMcpConfig: false,
            systemMessage,
        });

        expect(mockClient.createSession).toHaveBeenCalledTimes(1);
        const sessionOpts = mockClient.createSession.mock.calls[0][0];
        expect(sessionOpts.systemMessage).toEqual(systemMessage);
    });

    // ========================================================================
    // sendMessage — non-streaming path with replace mode
    // ========================================================================

    it('should forward systemMessage (replace) to createSession (non-streaming path)', async () => {
        const mockSession = {
            sessionId: 'sysmsg-replace-non-streaming',
            sendAndWait: vi.fn().mockResolvedValue({ data: { content: 'response' } }),
            destroy: vi.fn().mockResolvedValue(undefined),
            on: vi.fn(),
            send: vi.fn(),
        };

        const { MockCopilotClient, mockClient } = createMockSDKModule(mockSession);
        const serviceAny = service as any;
        serviceAny.sdkModule = { CopilotClient: MockCopilotClient };
        serviceAny.availabilityCache = { available: true, sdkPath: '/fake/sdk' };

        const systemMessage: SystemMessageConfig = {
            mode: 'replace',
            content: 'You are a custom assistant. Respond only in JSON.',
        };

        await service.sendMessage({
            prompt: 'Analyze this',
            workingDirectory: '/test',
            timeoutMs: 60000,
            loadDefaultMcpConfig: false,
            systemMessage,
        });

        expect(mockClient.createSession).toHaveBeenCalledTimes(1);
        const sessionOpts = mockClient.createSession.mock.calls[0][0];
        expect(sessionOpts.systemMessage).toEqual(systemMessage);
    });

    // ========================================================================
    // sendMessage — streaming path
    // ========================================================================

    it('should forward systemMessage to createSession (streaming path)', async () => {
        const { session, dispatchEvent } = createStreamingMockSession('sysmsg-streaming');
        const { MockCopilotClient, mockClient } = createMockSDKModule(session);
        const serviceAny = service as any;
        serviceAny.sdkModule = { CopilotClient: MockCopilotClient };
        serviceAny.availabilityCache = { available: true, sdkPath: '/fake/sdk' };

        const systemMessage: SystemMessageConfig = {
            mode: 'append',
            content: 'Always include line numbers in code suggestions.',
        };

        const sendPromise = service.sendMessage({
            prompt: 'Suggest improvements',
            workingDirectory: '/test',
            streaming: true,
            loadDefaultMcpConfig: false,
            systemMessage,
        });

        await new Promise(r => setTimeout(r, 50));

        // Complete the streaming session
        dispatchEvent({ type: 'assistant.message_delta', data: { deltaContent: 'done' } });
        dispatchEvent({ type: 'session.idle', data: {} });

        await sendPromise;

        expect(mockClient.createSession).toHaveBeenCalledTimes(1);
        const sessionOpts = mockClient.createSession.mock.calls[0][0];
        expect(sessionOpts.systemMessage).toEqual(systemMessage);
    });

    // ========================================================================
    // sendMessage — systemMessage omitted
    // ========================================================================

    it('should not include systemMessage in session options when not provided', async () => {
        const mockSession = {
            sessionId: 'no-sysmsg',
            sendAndWait: vi.fn().mockResolvedValue({ data: { content: 'response' } }),
            destroy: vi.fn().mockResolvedValue(undefined),
            on: vi.fn(),
            send: vi.fn(),
        };

        const { MockCopilotClient, mockClient } = createMockSDKModule(mockSession);
        const serviceAny = service as any;
        serviceAny.sdkModule = { CopilotClient: MockCopilotClient };
        serviceAny.availabilityCache = { available: true, sdkPath: '/fake/sdk' };

        await service.sendMessage({
            prompt: 'No system message',
            workingDirectory: '/test',
            timeoutMs: 60000,
            loadDefaultMcpConfig: false,
        });

        expect(mockClient.createSession).toHaveBeenCalledTimes(1);
        const sessionOpts = mockClient.createSession.mock.calls[0][0];
        expect(sessionOpts).not.toHaveProperty('systemMessage');
    });

    // ========================================================================
    // sendFollowUp — systemMessage on resume
    // ========================================================================

    it('should forward systemMessage to resumeSession when resuming a kept-alive session', async () => {
        const resumedSession = {
            sessionId: 'sess-sysmsg-resume',
            sendAndWait: vi.fn().mockResolvedValue({ data: { content: 'resumed response' } }),
            destroy: vi.fn().mockResolvedValue(undefined),
        };

        const { MockCopilotClient, mockClient } = createMockSDKModule();
        mockClient.resumeSession.mockResolvedValue(resumedSession);

        const serviceAny = service as any;
        serviceAny.sdkModule = { CopilotClient: MockCopilotClient };
        serviceAny.availabilityCache = { available: true, sdkPath: '/fake/sdk' };

        const systemMessage: SystemMessageConfig = {
            mode: 'append',
            content: 'Continue with the same coding style.',
        };

        const result = await service.sendFollowUp('sess-sysmsg-resume', 'Follow up', {
            workingDirectory: '/test',
            timeoutMs: 60000,
            systemMessage,
        });

        expect(result.success).toBe(true);
        expect(mockClient.resumeSession).toHaveBeenCalled();
        const resumeOpts = mockClient.resumeSession.mock.calls[0][1];
        expect(resumeOpts.systemMessage).toEqual(systemMessage);
    });

    // ========================================================================
    // sendFollowUp — systemMessage omitted on resume
    // ========================================================================

    it('should not include systemMessage in resume options when not provided', async () => {
        const resumedSession = {
            sessionId: 'sess-no-sysmsg-resume',
            sendAndWait: vi.fn().mockResolvedValue({ data: { content: 'resumed response' } }),
            destroy: vi.fn().mockResolvedValue(undefined),
        };

        const { MockCopilotClient, mockClient } = createMockSDKModule();
        mockClient.resumeSession.mockResolvedValue(resumedSession);

        const serviceAny = service as any;
        serviceAny.sdkModule = { CopilotClient: MockCopilotClient };
        serviceAny.availabilityCache = { available: true, sdkPath: '/fake/sdk' };

        const result = await service.sendFollowUp('sess-no-sysmsg-resume', 'Follow up', {
            workingDirectory: '/test',
            timeoutMs: 60000,
        });

        expect(result.success).toBe(true);
        expect(mockClient.resumeSession).toHaveBeenCalled();
        const resumeOpts = mockClient.resumeSession.mock.calls[0][1];
        expect(resumeOpts).not.toHaveProperty('systemMessage');
    });

    // ========================================================================
    // systemMessage combined with other options
    // ========================================================================

    it('should forward systemMessage alongside tools and other options', async () => {
        const mockSession = {
            sessionId: 'sysmsg-combined',
            sendAndWait: vi.fn().mockResolvedValue({ data: { content: 'response' } }),
            destroy: vi.fn().mockResolvedValue(undefined),
            on: vi.fn(),
            send: vi.fn(),
        };

        const { MockCopilotClient, mockClient } = createMockSDKModule(mockSession);
        const serviceAny = service as any;
        serviceAny.sdkModule = { CopilotClient: MockCopilotClient };
        serviceAny.availabilityCache = { available: true, sdkPath: '/fake/sdk' };

        const systemMessage: SystemMessageConfig = {
            mode: 'replace',
            content: 'Custom system prompt with tools.',
        };

        const mockTool = {
            name: 'test_tool',
            description: 'A test tool',
            handler: vi.fn(),
        };

        await service.sendMessage({
            prompt: 'Use tool with custom system prompt',
            workingDirectory: '/test',
            timeoutMs: 60000,
            loadDefaultMcpConfig: false,
            systemMessage,
            tools: [mockTool],
            model: 'gpt-5',
        });

        expect(mockClient.createSession).toHaveBeenCalledTimes(1);
        const sessionOpts = mockClient.createSession.mock.calls[0][0];
        expect(sessionOpts.systemMessage).toEqual(systemMessage);
        expect(sessionOpts.tools).toEqual([mockTool]);
        expect(sessionOpts.model).toBe('gpt-5');
    });
});
