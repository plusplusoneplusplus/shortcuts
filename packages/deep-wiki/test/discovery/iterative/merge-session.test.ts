/**
 * Merge Session Tests
 *
 * Tests for merge + gap analysis session orchestration, focusing on
 * SDK call configuration (MCP config, tools, permissions).
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockSendMessage = vi.fn();
const mockIsAvailable = vi.fn();

vi.mock('@plusplusoneplusplus/pipeline-core', () => ({
    getCopilotSDKService: () => ({
        sendMessage: mockSendMessage,
        isAvailable: mockIsAvailable,
    }),
}));

vi.mock('../../../src/logger', () => ({
    printInfo: vi.fn(),
    printWarning: vi.fn(),
    gray: (s: string) => s,
}));

vi.mock('../../../src/discovery/iterative/merge-prompts', () => ({
    buildMergePrompt: vi.fn().mockReturnValue('mock merge prompt'),
}));

const mockParseMergeResponse = vi.fn();
vi.mock('../../../src/discovery/iterative/merge-response-parser', () => ({
    parseMergeResponse: (...args: any[]) => mockParseMergeResponse(...args),
}));

vi.mock('../../../src/schemas', () => ({
    normalizeComponentId: (id: string) => id.toLowerCase().replace(/\s+/g, '-'),
    isValidComponentId: (id: string) => /^[a-z0-9-]+$/.test(id),
}));

import { mergeProbeResults } from '../../../src/discovery/iterative/merge-session';
import type { ThemeProbeResult } from '../../../src/discovery/iterative/types';

const testProbeResults: ThemeProbeResult[] = [
    {
        theme: 'auth',
        foundComponents: [{ id: 'auth-mod', name: 'Auth', path: 'src/auth', purpose: 'auth', keyFiles: [] }],
        discoveredThemes: [],
        dependencies: [],
        confidence: 0.9,
    },
];

const mockMergeResult = {
    graph: {
        project: { name: 'test', description: '', language: 'TS', buildSystem: 'npm', entryPoints: [] },
        components: [{ id: 'auth-mod', name: 'Auth', path: 'src/auth', purpose: '', keyFiles: [], dependencies: [], dependents: [], complexity: 'low', category: 'core' }],
        categories: [{ name: 'core', description: 'Core' }],
    },
    newThemes: [],
    converged: true,
    coverage: 0.8,
};

describe('mergeProbeResults', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockIsAvailable.mockResolvedValue(true);
        mockParseMergeResponse.mockReturnValue({ ...mockMergeResult });
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('passes loadDefaultMcpConfig: false to avoid user MCP config', async () => {
        mockSendMessage.mockResolvedValue({
            success: true,
            response: 'mock merge response',
        });

        await mergeProbeResults('/repo', testProbeResults, null);

        expect(mockSendMessage).toHaveBeenCalledTimes(1);
        const sendOptions = mockSendMessage.mock.calls[0][0];
        expect(sendOptions.loadDefaultMcpConfig).toBe(false);
    });

    it('uses read-only tools (view, grep, glob)', async () => {
        mockSendMessage.mockResolvedValue({
            success: true,
            response: 'mock merge response',
        });

        await mergeProbeResults('/repo', testProbeResults, null);

        const sendOptions = mockSendMessage.mock.calls[0][0];
        expect(sendOptions.availableTools).toEqual(['view', 'grep', 'glob']);
    });

    it('sets workingDirectory to repoPath', async () => {
        mockSendMessage.mockResolvedValue({
            success: true,
            response: 'mock merge response',
        });

        await mergeProbeResults('/my/project', testProbeResults, null);

        const sendOptions = mockSendMessage.mock.calls[0][0];
        expect(sendOptions.workingDirectory).toBe('/my/project');
    });

    it('falls back to local merge when SDK is unavailable', async () => {
        mockIsAvailable.mockResolvedValue(false);

        const result = await mergeProbeResults('/repo', testProbeResults, null);

        expect(result.graph.components.length).toBeGreaterThan(0);
        expect(mockSendMessage).not.toHaveBeenCalled();
    });

    it('falls back to local merge on sendMessage failure', async () => {
        mockSendMessage.mockResolvedValue({
            success: false,
            error: 'SDK error',
        });

        const result = await mergeProbeResults('/repo', testProbeResults, null);

        expect(result.graph.components.length).toBeGreaterThan(0);
        expect(result.reason).toContain('failed');
    });

    it('falls back to local merge on exception', async () => {
        mockSendMessage.mockRejectedValue(new Error('unexpected'));

        const result = await mergeProbeResults('/repo', testProbeResults, null);

        expect(result.graph.components.length).toBeGreaterThan(0);
        expect(result.reason).toContain('error');
    });

    it('passes model option when specified', async () => {
        mockSendMessage.mockResolvedValue({
            success: true,
            response: 'mock merge response',
        });

        await mergeProbeResults('/repo', testProbeResults, null, { model: 'gpt-4' });

        const sendOptions = mockSendMessage.mock.calls[0][0];
        expect(sendOptions.model).toBe('gpt-4');
    });
});
