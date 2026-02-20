/**
 * Discovery Session Tests
 *
 * Tests for the discovery session orchestration, focusing on
 * SDK call configuration (MCP config, tools, permissions).
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockSendMessage = vi.fn();
const mockIsAvailable = vi.fn();

const STREAM_DESTROYED_PATTERNS = [
    'stream was destroyed',
    'ERR_STREAM_DESTROYED',
    'cannot call write after a stream was destroyed',
    'EPIPE',
    'ECONNRESET',
];

vi.mock('@plusplusoneplusplus/pipeline-core', () => ({
    getCopilotSDKService: () => ({
        sendMessage: mockSendMessage,
        isAvailable: mockIsAvailable,
    }),
    CopilotSDKService: {
        isStreamDestroyedError: (msg: string) => {
            const lower = msg.toLowerCase();
            return STREAM_DESTROYED_PATTERNS.some(p => lower.includes(p.toLowerCase()));
        },
    },
}));

vi.mock('../../src/logger', () => ({
    printInfo: vi.fn(),
    printWarning: vi.fn(),
    gray: (s: string) => s,
}));

vi.mock('../../src/discovery/prompts', () => ({
    buildDiscoveryPrompt: vi.fn().mockReturnValue('mock discovery prompt'),
}));

const mockParseComponentGraphResponse = vi.fn();
vi.mock('../../src/discovery/response-parser', () => ({
    parseComponentGraphResponse: (...args: any[]) => mockParseComponentGraphResponse(...args),
}));

import { runDiscoverySession, DiscoveryError } from '../../src/discovery/discovery-session';

const mockGraph = {
    project: { name: 'test', description: '', language: 'TS', buildSystem: 'npm', entryPoints: [] },
    components: [{ id: 'comp-1', name: 'Comp', path: 'src/', purpose: '', keyFiles: [], dependencies: [], dependents: [], complexity: 'low', category: 'core' }],
    categories: [{ name: 'core', description: 'Core' }],
};

describe('runDiscoverySession', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockIsAvailable.mockResolvedValue(true);
        mockParseComponentGraphResponse.mockReturnValue({ ...mockGraph });
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('passes loadDefaultMcpConfig: false to avoid user MCP config', async () => {
        mockSendMessage.mockResolvedValue({
            success: true,
            response: 'mock response',
        });

        await runDiscoverySession({ repoPath: '/repo' });

        expect(mockSendMessage).toHaveBeenCalledTimes(1);
        const sendOptions = mockSendMessage.mock.calls[0][0];
        expect(sendOptions.loadDefaultMcpConfig).toBe(false);
    });

    it('uses read-only tools (view, grep, glob)', async () => {
        mockSendMessage.mockResolvedValue({
            success: true,
            response: 'mock response',
        });

        await runDiscoverySession({ repoPath: '/repo' });

        const sendOptions = mockSendMessage.mock.calls[0][0];
        expect(sendOptions.availableTools).toEqual(['view', 'grep', 'glob']);
    });

    it('sets workingDirectory to repoPath', async () => {
        mockSendMessage.mockResolvedValue({
            success: true,
            response: 'mock response',
        });

        await runDiscoverySession({ repoPath: '/my/project' });

        const sendOptions = mockSendMessage.mock.calls[0][0];
        expect(sendOptions.workingDirectory).toBe('/my/project');
    });

    it('throws DiscoveryError when SDK is unavailable', async () => {
        mockIsAvailable.mockResolvedValue(false);

        await expect(runDiscoverySession({ repoPath: '/repo' }))
            .rejects.toThrow(DiscoveryError);
    });

    it('throws DiscoveryError on timeout', async () => {
        mockSendMessage.mockResolvedValue({
            success: false,
            error: 'Request timed out after 1800000ms',
        });

        await expect(runDiscoverySession({ repoPath: '/repo' }))
            .rejects.toThrow('timed out');
    });

    it('retries with stricter prompt on parse failure', async () => {
        mockSendMessage.mockResolvedValue({
            success: true,
            response: 'some response',
        });

        mockParseComponentGraphResponse
            .mockImplementationOnce(() => { throw new Error('parse fail'); })
            .mockReturnValueOnce({ ...mockGraph });

        const result = await runDiscoverySession({ repoPath: '/repo' });

        expect(mockSendMessage).toHaveBeenCalledTimes(2);
        expect(result.graph.components).toHaveLength(1);
        const retryOptions = mockSendMessage.mock.calls[1][0];
        expect(retryOptions.loadDefaultMcpConfig).toBe(false);
    });
});
