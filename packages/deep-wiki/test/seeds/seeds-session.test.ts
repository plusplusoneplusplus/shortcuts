/**
 * Seeds Session Tests
 *
 * Tests for the seeds session orchestration, including retry logic
 * for transient SDK errors and the isTransientSDKError helper.
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock pipeline-core before importing anything that uses it
const mockSendMessage = vi.fn();
const mockIsAvailable = vi.fn();
vi.mock('@plusplusoneplusplus/pipeline-core', () => ({
    getCopilotSDKService: () => ({
        sendMessage: mockSendMessage,
        isAvailable: mockIsAvailable,
    }),
}));

// Mock logger to avoid console output in tests
vi.mock('../../src/logger', () => ({
    printInfo: vi.fn(),
    printWarning: vi.fn(),
    gray: (s: string) => s,
}));

// Mock prompts
vi.mock('../../src/seeds/prompts', () => ({
    buildSeedsPrompt: vi.fn().mockReturnValue('mock prompt'),
}));

// Mock response parser
const mockParseSeedsResponse = vi.fn();
vi.mock('../../src/seeds/response-parser', () => ({
    parseSeedsResponse: (...args: any[]) => mockParseSeedsResponse(...args),
}));

// Mock heuristic fallback
const mockGenerateHeuristicSeeds = vi.fn();
vi.mock('../../src/seeds/heuristic-fallback', () => ({
    generateHeuristicSeeds: (...args: any[]) => mockGenerateHeuristicSeeds(...args),
}));

import { runSeedsSession, isTransientSDKError, SeedsError } from '../../src/seeds/seeds-session';

const defaultSeeds = [
    { theme: 'auth', description: 'Authentication', hints: ['login'] },
    { theme: 'db', description: 'Database layer', hints: ['sql'] },
];

// ============================================================================
// isTransientSDKError
// ============================================================================

describe('isTransientSDKError', () => {
    it('detects "Cannot call write after a stream was destroyed"', () => {
        expect(isTransientSDKError('Cannot call write after a stream was destroyed')).toBe(true);
    });

    it('detects "stream was destroyed" substring', () => {
        expect(isTransientSDKError('Copilot SDK error: stream was destroyed during write')).toBe(true);
    });

    it('detects EPIPE errors', () => {
        expect(isTransientSDKError('Error: write EPIPE')).toBe(true);
    });

    it('detects ECONNRESET errors', () => {
        expect(isTransientSDKError('read ECONNRESET')).toBe(true);
    });

    it('detects socket hang up', () => {
        expect(isTransientSDKError('socket hang up')).toBe(true);
    });

    it('is case-insensitive', () => {
        expect(isTransientSDKError('CANNOT CALL WRITE AFTER A STREAM WAS DESTROYED')).toBe(true);
        expect(isTransientSDKError('Socket Hang Up')).toBe(true);
    });

    it('returns false for non-transient errors', () => {
        expect(isTransientSDKError('Invalid prompt format')).toBe(false);
        expect(isTransientSDKError('Authentication required')).toBe(false);
        expect(isTransientSDKError('Model not found')).toBe(false);
        expect(isTransientSDKError('Request timed out after 30000ms')).toBe(false);
    });

    it('returns false for empty string', () => {
        expect(isTransientSDKError('')).toBe(false);
    });
});

// ============================================================================
// runSeedsSession
// ============================================================================

describe('runSeedsSession', () => {
    const defaultOptions = { maxThemes: 50, verbose: false };

    beforeEach(() => {
        vi.clearAllMocks();
        mockIsAvailable.mockResolvedValue(true);
        mockParseSeedsResponse.mockReturnValue([...defaultSeeds]);
        mockGenerateHeuristicSeeds.mockReturnValue([
            { theme: 'fallback', description: 'Fallback theme', hints: [] },
        ]);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('returns seeds on successful AI response', async () => {
        mockSendMessage.mockResolvedValue({
            success: true,
            response: 'mock response with themes',
        });

        const seeds = await runSeedsSession('/repo', defaultOptions);

        expect(seeds).toHaveLength(2);
        expect(seeds[0].theme).toBe('auth');
        expect(mockSendMessage).toHaveBeenCalledTimes(1);
    });

    it('throws SeedsError when SDK is unavailable', async () => {
        mockIsAvailable.mockResolvedValue(false);

        await expect(runSeedsSession('/repo', defaultOptions))
            .rejects.toThrow(SeedsError);
        await expect(runSeedsSession('/repo', defaultOptions))
            .rejects.toThrow('not available');
    });

    it('throws SeedsError on timeout', async () => {
        mockSendMessage.mockResolvedValue({
            success: false,
            error: 'Request timed out after 1800000ms',
        });

        await expect(runSeedsSession('/repo', defaultOptions))
            .rejects.toThrow('timed out');
    });

    it('throws SeedsError on non-transient SDK error', async () => {
        mockSendMessage.mockResolvedValue({
            success: false,
            error: 'Invalid model specified',
        });

        await expect(runSeedsSession('/repo', defaultOptions))
            .rejects.toThrow('Invalid model specified');
        expect(mockSendMessage).toHaveBeenCalledTimes(1);
    });

    it('retries on transient "stream was destroyed" error', async () => {
        mockSendMessage
            .mockResolvedValueOnce({
                success: false,
                error: 'Copilot SDK error: Cannot call write after a stream was destroyed',
            })
            .mockResolvedValueOnce({
                success: true,
                response: 'themes after retry',
            });

        const seeds = await runSeedsSession('/repo', defaultOptions);

        expect(seeds).toHaveLength(2);
        expect(mockSendMessage).toHaveBeenCalledTimes(2);
    });

    it('retries on EPIPE error', async () => {
        mockSendMessage
            .mockResolvedValueOnce({
                success: false,
                error: 'write EPIPE',
            })
            .mockResolvedValueOnce({
                success: true,
                response: 'themes after EPIPE retry',
            });

        const seeds = await runSeedsSession('/repo', defaultOptions);

        expect(seeds).toHaveLength(2);
        expect(mockSendMessage).toHaveBeenCalledTimes(2);
    });

    it('retries on ECONNRESET error', async () => {
        mockSendMessage
            .mockResolvedValueOnce({
                success: false,
                error: 'read ECONNRESET',
            })
            .mockResolvedValueOnce({
                success: true,
                response: 'themes after reset retry',
            });

        const seeds = await runSeedsSession('/repo', defaultOptions);
        expect(seeds).toHaveLength(2);
        expect(mockSendMessage).toHaveBeenCalledTimes(2);
    });

    it('gives up after MAX_SDK_RETRIES transient failures', async () => {
        mockSendMessage.mockResolvedValue({
            success: false,
            error: 'Copilot SDK error: Cannot call write after a stream was destroyed',
        });

        await expect(runSeedsSession('/repo', defaultOptions))
            .rejects.toThrow('Cannot call write after a stream was destroyed');

        // 1 initial + 2 retries = 3 calls
        expect(mockSendMessage).toHaveBeenCalledTimes(3);
    });

    it('does not retry non-transient errors', async () => {
        mockSendMessage.mockResolvedValue({
            success: false,
            error: 'Copilot SDK error: Authentication failed',
        });

        await expect(runSeedsSession('/repo', defaultOptions))
            .rejects.toThrow('Authentication failed');
        expect(mockSendMessage).toHaveBeenCalledTimes(1);
    });

    it('throws SeedsError on empty response', async () => {
        mockSendMessage.mockResolvedValue({
            success: true,
            response: '',
        });

        await expect(runSeedsSession('/repo', defaultOptions))
            .rejects.toThrow('empty response');
    });

    it('passes model option to sendMessage', async () => {
        mockSendMessage.mockResolvedValue({
            success: true,
            response: 'response',
        });

        await runSeedsSession('/repo', { ...defaultOptions, model: 'gpt-4' });

        expect(mockSendMessage).toHaveBeenCalledWith(
            expect.objectContaining({ model: 'gpt-4' }),
        );
    });

    it('passes timeout option converted to milliseconds', async () => {
        mockSendMessage.mockResolvedValue({
            success: true,
            response: 'response',
        });

        await runSeedsSession('/repo', { ...defaultOptions, timeout: 60 });

        expect(mockSendMessage).toHaveBeenCalledWith(
            expect.objectContaining({ timeoutMs: 60_000 }),
        );
    });

    it('uses default timeout when not specified', async () => {
        mockSendMessage.mockResolvedValue({
            success: true,
            response: 'response',
        });

        await runSeedsSession('/repo', defaultOptions);

        expect(mockSendMessage).toHaveBeenCalledWith(
            expect.objectContaining({ timeoutMs: 1_800_000 }),
        );
    });

    it('sets read-only tools and permissions', async () => {
        mockSendMessage.mockResolvedValue({
            success: true,
            response: 'response',
        });

        await runSeedsSession('/repo', defaultOptions);

        expect(mockSendMessage).toHaveBeenCalledWith(
            expect.objectContaining({
                availableTools: ['view', 'grep', 'glob'],
                onPermissionRequest: expect.any(Function),
            }),
        );
    });

    it('truncates seeds to maxThemes when AI over-generates', async () => {
        mockParseSeedsResponse.mockReturnValueOnce(
            Array.from({ length: 100 }, (_, i) => ({
                theme: `theme-${i}`,
                description: `Description ${i}`,
                hints: [],
            })),
        );

        mockSendMessage.mockResolvedValue({
            success: true,
            response: 'lots of themes',
        });

        const seeds = await runSeedsSession('/repo', { maxThemes: 10, verbose: true });
        expect(seeds).toHaveLength(10);
        expect(seeds[0].theme).toBe('theme-0');
        expect(seeds[9].theme).toBe('theme-9');
    });

    it('falls back to heuristic on parse failure', async () => {
        mockParseSeedsResponse.mockImplementationOnce(() => {
            throw new Error('Failed to parse');
        });

        mockSendMessage.mockResolvedValue({
            success: true,
            response: 'unparseable response',
        });

        const seeds = await runSeedsSession('/repo', { ...defaultOptions, verbose: true });
        expect(seeds).toHaveLength(1);
        expect(seeds[0].theme).toBe('fallback');
    });

    it('succeeds on second retry after first transient failure', async () => {
        mockSendMessage
            .mockResolvedValueOnce({
                success: false,
                error: 'Copilot SDK error: socket hang up',
            })
            .mockResolvedValueOnce({
                success: false,
                error: 'Copilot SDK error: Cannot call write after a stream was destroyed',
            })
            .mockResolvedValueOnce({
                success: true,
                response: 'themes on third attempt',
            });

        const seeds = await runSeedsSession('/repo', defaultOptions);
        expect(seeds).toHaveLength(2);
        expect(mockSendMessage).toHaveBeenCalledTimes(3);
    });
});
