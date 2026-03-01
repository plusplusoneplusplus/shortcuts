/**
 * CopilotSDKService Tools Passthrough Tests
 *
 * Verifies that the `tools` field from SendMessageOptions and
 * SendFollowUpOptions is correctly forwarded to the underlying SDK
 * session creation / resume methods.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { CopilotSDKService, resetCopilotSDKService } from '../../src/copilot-sdk-wrapper/copilot-sdk-service';
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

describe('CopilotSDKService - Tools Passthrough', () => {
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
    // sendMessage — non-streaming path
    // ========================================================================

    it('should forward tools to createSession (non-streaming path)', async () => {
        const mockSession = {
            sessionId: 'tools-non-streaming',
            sendAndWait: vi.fn().mockResolvedValue({ data: { content: 'response' } }),
            destroy: vi.fn().mockResolvedValue(undefined),
            on: vi.fn(),
            send: vi.fn(),
        };

        const { MockCopilotClient, mockClient } = createMockSDKModule(mockSession);
        const serviceAny = service as any;
        serviceAny.sdkModule = { CopilotClient: MockCopilotClient };
        serviceAny.availabilityCache = { available: true, sdkPath: '/fake/sdk' };

        const mockTool = {
            name: 'test_tool',
            description: 'A test tool',
            handler: vi.fn(),
        };

        await service.sendMessage({
            prompt: 'Use the tool',
            workingDirectory: '/test',
            timeoutMs: 60000,
            loadDefaultMcpConfig: false,
            tools: [mockTool],
        });

        expect(mockClient.createSession).toHaveBeenCalledTimes(1);
        const sessionOpts = mockClient.createSession.mock.calls[0][0];
        expect(sessionOpts.tools).toEqual([mockTool]);
    });

    // ========================================================================
    // sendMessage — streaming path
    // ========================================================================

    it('should forward tools to createSession (streaming path)', async () => {
        const { session, dispatchEvent } = createStreamingMockSession('tools-streaming');
        const { MockCopilotClient, mockClient } = createMockSDKModule(session);
        const serviceAny = service as any;
        serviceAny.sdkModule = { CopilotClient: MockCopilotClient };
        serviceAny.availabilityCache = { available: true, sdkPath: '/fake/sdk' };

        const mockTool = {
            name: 'resolve_comment',
            description: 'Resolve a comment by ID',
            parameters: { type: 'object', properties: { id: { type: 'string' } } },
            handler: vi.fn(),
        };

        const sendPromise = service.sendMessage({
            prompt: 'Resolve comments',
            workingDirectory: '/test',
            streaming: true,
            loadDefaultMcpConfig: false,
            tools: [mockTool],
        });

        await new Promise(r => setTimeout(r, 50));

        // Complete the streaming session
        dispatchEvent({ type: 'assistant.message_delta', data: { deltaContent: 'done' } });
        dispatchEvent({ type: 'session.idle', data: {} });

        await sendPromise;

        expect(mockClient.createSession).toHaveBeenCalledTimes(1);
        const sessionOpts = mockClient.createSession.mock.calls[0][0];
        expect(sessionOpts.tools).toEqual([mockTool]);
    });

    // ========================================================================
    // sendMessage — tools omitted
    // ========================================================================

    it('should not include tools in session options when not provided', async () => {
        const mockSession = {
            sessionId: 'no-tools',
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
            prompt: 'No tools',
            workingDirectory: '/test',
            timeoutMs: 60000,
            loadDefaultMcpConfig: false,
        });

        expect(mockClient.createSession).toHaveBeenCalledTimes(1);
        const sessionOpts = mockClient.createSession.mock.calls[0][0];
        expect(sessionOpts).not.toHaveProperty('tools');
    });

    // ========================================================================
    // sendFollowUp — tools on resume
    // ========================================================================

    it('should forward tools to resumeSession when resuming a kept-alive session', async () => {
        // Use the non-streaming pattern from the existing keep-alive tests.
        // The resumed session is not in memory so sendFollowUp calls resumeKeptAliveSession.
        const resumedSession = {
            sessionId: 'sess-tools-resume',
            sendAndWait: vi.fn().mockResolvedValue({ data: { content: 'resumed response' } }),
            destroy: vi.fn().mockResolvedValue(undefined),
        };

        const { MockCopilotClient, mockClient } = createMockSDKModule();
        // Override the default rejection to succeed with our resumed session
        mockClient.resumeSession.mockResolvedValue(resumedSession);

        const serviceAny = service as any;
        serviceAny.sdkModule = { CopilotClient: MockCopilotClient };
        serviceAny.availabilityCache = { available: true, sdkPath: '/fake/sdk' };

        const mockTool = {
            name: 'resolve_comment',
            handler: vi.fn(),
        };

        // Call sendFollowUp directly — no in-memory session, so it triggers resume
        const result = await service.sendFollowUp('sess-tools-resume', 'Follow up', {
            workingDirectory: '/test',
            timeoutMs: 60000,
            tools: [mockTool],
        });

        expect(result.success).toBe(true);
        expect(mockClient.resumeSession).toHaveBeenCalled();
        const resumeOpts = mockClient.resumeSession.mock.calls[0][1];
        expect(resumeOpts.tools).toEqual([mockTool]);
    });

    // ========================================================================
    // Multiple tools
    // ========================================================================

    it('should forward multiple tools to createSession', async () => {
        const mockSession = {
            sessionId: 'multi-tools',
            sendAndWait: vi.fn().mockResolvedValue({ data: { content: 'response' } }),
            destroy: vi.fn().mockResolvedValue(undefined),
            on: vi.fn(),
            send: vi.fn(),
        };

        const { MockCopilotClient, mockClient } = createMockSDKModule(mockSession);
        const serviceAny = service as any;
        serviceAny.sdkModule = { CopilotClient: MockCopilotClient };
        serviceAny.availabilityCache = { available: true, sdkPath: '/fake/sdk' };

        const tools = [
            { name: 'tool_a', handler: vi.fn() },
            { name: 'tool_b', description: 'Second tool', handler: vi.fn() },
            { name: 'tool_c', parameters: { type: 'object' }, handler: vi.fn() },
        ];

        await service.sendMessage({
            prompt: 'Use all tools',
            workingDirectory: '/test',
            timeoutMs: 60000,
            loadDefaultMcpConfig: false,
            tools,
        });

        const sessionOpts = mockClient.createSession.mock.calls[0][0];
        expect(sessionOpts.tools).toHaveLength(3);
        expect(sessionOpts.tools[0].name).toBe('tool_a');
        expect(sessionOpts.tools[1].name).toBe('tool_b');
        expect(sessionOpts.tools[2].name).toBe('tool_c');
    });
});
