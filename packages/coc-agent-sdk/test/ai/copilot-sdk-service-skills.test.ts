/**
 * CopilotSDKService Skills Passthrough Tests
 *
 * Verifies that `skillDirectories` and `disabledSkills` from SendMessageOptions
 * are correctly forwarded to the underlying SDK session creation.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { CopilotSDKService, resetCopilotSDKService } from '../../src/copilot-sdk-service';
import {
    createStreamingMockSession,
    createMockSDKModule,
} from '../helpers/mock-sdk';

// Suppress logger output during tests


// Mock trusted-folder and mcp-config-loader to avoid filesystem access
vi.mock('../../src/trusted-folder', () => ({
    ensureFolderTrusted: vi.fn(),
}));

vi.mock('../../src/mcp-config-loader', () => ({
    loadDefaultMcpConfig: vi.fn().mockReturnValue({
        success: false,
        fileExists: false,
        mcpServers: {},
    }),
    loadEffectiveMcpConfig: vi.fn().mockReturnValue({
        success: true,
        fileExists: false,
        configPath: '',
        mcpServers: {},
    }),
    mergeMcpConfigs: vi.fn().mockImplementation(
        (base: Record<string, any>, override?: Record<string, any>) => ({
            ...base,
            ...override,
        }),
    ),
}));

const createSdkClientMock = vi.fn();
vi.mock('../../src/sdk-client-factory', () => ({
    createSdkClient: (...args: any[]) => createSdkClientMock(...args),
}));

describe('CopilotSDKService - Skills Passthrough', () => {
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
    // sendMessage — skillDirectories
    // ========================================================================

    it('should forward skillDirectories to createSession', async () => {
        const mockSession = {
            sessionId: 'skills-dir-test',
            sendAndWait: vi.fn().mockResolvedValue({ data: { content: 'response' } }),
            destroy: vi.fn().mockResolvedValue(undefined),
            on: vi.fn(),
            send: vi.fn(),
        };

        const { MockCopilotClient, mockClient } = createMockSDKModule(mockSession);
        const serviceAny = service as any;
        createSdkClientMock.mockImplementation((opts: any) => new MockCopilotClient(opts));
        serviceAny.availabilityCache = { available: true, sdkPath: '/fake/sdk' };

        await service.sendMessage({
            prompt: 'Use skills',
            workingDirectory: '/test',
            timeoutMs: 60000,
            loadDefaultMcpConfig: false,
            skillDirectories: ['/workspace/.github/skills'],
        });

        expect(mockClient.createSession).toHaveBeenCalledTimes(1);
        const sessionOpts = mockClient.createSession.mock.calls[0][0];
        expect(sessionOpts.skillDirectories).toEqual(['/workspace/.github/skills']);
    });

    // ========================================================================
    // sendMessage — disabledSkills
    // ========================================================================

    it('should forward disabledSkills to createSession', async () => {
        const mockSession = {
            sessionId: 'disabled-skills-test',
            sendAndWait: vi.fn().mockResolvedValue({ data: { content: 'response' } }),
            destroy: vi.fn().mockResolvedValue(undefined),
            on: vi.fn(),
            send: vi.fn(),
        };

        const { MockCopilotClient, mockClient } = createMockSDKModule(mockSession);
        const serviceAny = service as any;
        createSdkClientMock.mockImplementation((opts: any) => new MockCopilotClient(opts));
        serviceAny.availabilityCache = { available: true, sdkPath: '/fake/sdk' };

        await service.sendMessage({
            prompt: 'Test disabled skills',
            workingDirectory: '/test',
            timeoutMs: 60000,
            loadDefaultMcpConfig: false,
            disabledSkills: ['impl', 'draft'],
        });

        expect(mockClient.createSession).toHaveBeenCalledTimes(1);
        const sessionOpts = mockClient.createSession.mock.calls[0][0];
        expect(sessionOpts.disabledSkills).toEqual(['impl', 'draft']);
    });

    // ========================================================================
    // sendMessage — both fields together
    // ========================================================================

    it('should forward both skillDirectories and disabledSkills', async () => {
        const mockSession = {
            sessionId: 'both-skills-test',
            sendAndWait: vi.fn().mockResolvedValue({ data: { content: 'response' } }),
            destroy: vi.fn().mockResolvedValue(undefined),
            on: vi.fn(),
            send: vi.fn(),
        };

        const { MockCopilotClient, mockClient } = createMockSDKModule(mockSession);
        const serviceAny = service as any;
        createSdkClientMock.mockImplementation((opts: any) => new MockCopilotClient(opts));
        serviceAny.availabilityCache = { available: true, sdkPath: '/fake/sdk' };

        await service.sendMessage({
            prompt: 'Use filtered skills',
            workingDirectory: '/test',
            timeoutMs: 60000,
            loadDefaultMcpConfig: false,
            skillDirectories: ['/workspace/.github/skills'],
            disabledSkills: ['experimental-feature'],
        });

        expect(mockClient.createSession).toHaveBeenCalledTimes(1);
        const sessionOpts = mockClient.createSession.mock.calls[0][0];
        expect(sessionOpts.skillDirectories).toEqual(['/workspace/.github/skills']);
        expect(sessionOpts.disabledSkills).toEqual(['experimental-feature']);
    });

    // ========================================================================
    // sendMessage — omitted fields
    // ========================================================================

    it('should not include skill fields when not provided', async () => {
        const mockSession = {
            sessionId: 'no-skills-test',
            sendAndWait: vi.fn().mockResolvedValue({ data: { content: 'response' } }),
            destroy: vi.fn().mockResolvedValue(undefined),
            on: vi.fn(),
            send: vi.fn(),
        };

        const { MockCopilotClient, mockClient } = createMockSDKModule(mockSession);
        const serviceAny = service as any;
        createSdkClientMock.mockImplementation((opts: any) => new MockCopilotClient(opts));
        serviceAny.availabilityCache = { available: true, sdkPath: '/fake/sdk' };

        await service.sendMessage({
            prompt: 'No skills',
            workingDirectory: '/test',
            timeoutMs: 60000,
            loadDefaultMcpConfig: false,
        });

        expect(mockClient.createSession).toHaveBeenCalledTimes(1);
        const sessionOpts = mockClient.createSession.mock.calls[0][0];
        expect(sessionOpts.skillDirectories).toBeUndefined();
        expect(sessionOpts.disabledSkills).toBeUndefined();
    });

    // ========================================================================
    // sendMessage — empty arrays are not forwarded
    // ========================================================================

    it('should not forward empty arrays for skill fields', async () => {
        const mockSession = {
            sessionId: 'empty-skills-test',
            sendAndWait: vi.fn().mockResolvedValue({ data: { content: 'response' } }),
            destroy: vi.fn().mockResolvedValue(undefined),
            on: vi.fn(),
            send: vi.fn(),
        };

        const { MockCopilotClient, mockClient } = createMockSDKModule(mockSession);
        const serviceAny = service as any;
        createSdkClientMock.mockImplementation((opts: any) => new MockCopilotClient(opts));
        serviceAny.availabilityCache = { available: true, sdkPath: '/fake/sdk' };

        await service.sendMessage({
            prompt: 'Empty skills',
            workingDirectory: '/test',
            timeoutMs: 60000,
            loadDefaultMcpConfig: false,
            skillDirectories: [],
            disabledSkills: [],
        });

        expect(mockClient.createSession).toHaveBeenCalledTimes(1);
        const sessionOpts = mockClient.createSession.mock.calls[0][0];
        expect(sessionOpts.skillDirectories).toBeUndefined();
        expect(sessionOpts.disabledSkills).toBeUndefined();
    });

    // ========================================================================
    // sendMessage — streaming path
    // ========================================================================

    it('should forward skillDirectories and disabledSkills in streaming mode', async () => {
        const { session, dispatchEvent } = createStreamingMockSession('skills-streaming');
        const { MockCopilotClient, mockClient } = createMockSDKModule(session);
        const serviceAny = service as any;
        createSdkClientMock.mockImplementation((opts: any) => new MockCopilotClient(opts));
        serviceAny.availabilityCache = { available: true, sdkPath: '/fake/sdk' };

        const sendPromise = service.sendMessage({
            prompt: 'Stream with skills',
            workingDirectory: '/test',
            streaming: true,
            loadDefaultMcpConfig: false,
            skillDirectories: ['/ws/.github/skills'],
            disabledSkills: ['debug-tool'],
        });

        await new Promise(r => setTimeout(r, 50));

        dispatchEvent({ type: 'assistant.message_delta', data: { deltaContent: 'done' } });
        dispatchEvent({ type: 'session.idle', data: {} });

        await sendPromise;

        expect(mockClient.createSession).toHaveBeenCalledTimes(1);
        const sessionOpts = mockClient.createSession.mock.calls[0][0];
        expect(sessionOpts.skillDirectories).toEqual(['/ws/.github/skills']);
        expect(sessionOpts.disabledSkills).toEqual(['debug-tool']);
    });
});
