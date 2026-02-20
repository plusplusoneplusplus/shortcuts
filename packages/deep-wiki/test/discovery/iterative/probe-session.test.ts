/**
 * Probe Session Tests
 *
 * Tests for per-theme probe session orchestration, focusing on
 * SDK call configuration (MCP config, tools, permissions).
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockSendMessage = vi.fn();
const mockIsAvailable = vi.fn();

vi.mock('../../../src/utils/resolve-working-directory', () => ({
    resolveWorkingDirectory: (p: string) => p,
}));

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

vi.mock('../../../src/discovery/iterative/probe-prompts', () => ({
    buildProbePrompt: vi.fn().mockReturnValue('mock probe prompt'),
}));

const mockParseProbeResponse = vi.fn();
vi.mock('../../../src/discovery/iterative/probe-response-parser', () => ({
    parseProbeResponse: (...args: any[]) => mockParseProbeResponse(...args),
}));

import { runThemeProbe } from '../../../src/discovery/iterative/probe-session';
import type { ThemeSeed } from '../../../src/types';

const testTheme: ThemeSeed = {
    theme: 'authentication',
    description: 'Auth system',
    hints: ['login', 'jwt'],
};

const mockProbeResult = {
    theme: 'authentication',
    foundComponents: [{ id: 'auth', name: 'Auth', path: 'src/auth', purpose: 'auth', keyFiles: [] }],
    discoveredThemes: [],
    dependencies: [],
    confidence: 0.8,
};

describe('runThemeProbe', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockIsAvailable.mockResolvedValue(true);
        mockParseProbeResponse.mockReturnValue({ ...mockProbeResult });
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('passes loadDefaultMcpConfig: false to avoid user MCP config', async () => {
        mockSendMessage.mockResolvedValue({
            success: true,
            response: 'mock response',
        });

        await runThemeProbe('/repo', testTheme);

        expect(mockSendMessage).toHaveBeenCalledTimes(1);
        const sendOptions = mockSendMessage.mock.calls[0][0];
        expect(sendOptions.loadDefaultMcpConfig).toBe(false);
    });

    it('uses read-only tools (view, grep, glob)', async () => {
        mockSendMessage.mockResolvedValue({
            success: true,
            response: 'mock response',
        });

        await runThemeProbe('/repo', testTheme);

        const sendOptions = mockSendMessage.mock.calls[0][0];
        expect(sendOptions.availableTools).toEqual(['view', 'grep', 'glob']);
    });

    it('sets workingDirectory to repoPath', async () => {
        mockSendMessage.mockResolvedValue({
            success: true,
            response: 'mock response',
        });

        await runThemeProbe('/my/project', testTheme);

        const sendOptions = mockSendMessage.mock.calls[0][0];
        expect(sendOptions.workingDirectory).toBe('/my/project');
    });

    it('returns empty result when SDK is unavailable', async () => {
        mockIsAvailable.mockResolvedValue(false);

        const result = await runThemeProbe('/repo', testTheme);

        expect(result.foundComponents).toHaveLength(0);
        expect(result.confidence).toBe(0);
        expect(mockSendMessage).not.toHaveBeenCalled();
    });

    it('returns empty result on sendMessage failure', async () => {
        mockSendMessage.mockResolvedValue({
            success: false,
            error: 'SDK error',
        });

        const result = await runThemeProbe('/repo', testTheme);

        expect(result.foundComponents).toHaveLength(0);
        expect(result.confidence).toBe(0);
    });

    it('returns empty result on exception', async () => {
        mockSendMessage.mockRejectedValue(new Error('unexpected crash'));

        const result = await runThemeProbe('/repo', testTheme);

        expect(result.foundComponents).toHaveLength(0);
        expect(result.confidence).toBe(0);
    });

    it('passes model option when specified', async () => {
        mockSendMessage.mockResolvedValue({
            success: true,
            response: 'mock response',
        });

        await runThemeProbe('/repo', testTheme, { model: 'gpt-4' });

        const sendOptions = mockSendMessage.mock.calls[0][0];
        expect(sendOptions.model).toBe('gpt-4');
    });
});
