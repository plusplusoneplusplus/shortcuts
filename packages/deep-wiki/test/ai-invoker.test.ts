/**
 * AI Invoker Factory Tests
 *
 * Tests for the analysis and writing invoker factories.
 * Verifies MCP tool configuration, permission handling, timeout, model, and pool settings.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock pipeline-core before imports
const mockSendMessage = vi.fn();
const mockIsAvailable = vi.fn();

vi.mock('@plusplusoneplusplus/pipeline-core', () => ({
    getCopilotSDKService: () => ({
        sendMessage: mockSendMessage,
        isAvailable: mockIsAvailable,
    }),
    approveAllPermissions: vi.fn(),
    denyAllPermissions: vi.fn(),
}));

import {
    createAnalysisInvoker,
    createWritingInvoker,
    checkAIAvailability,
} from '../src/ai-invoker';

describe('AI Invoker Factory', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    // ========================================================================
    // checkAIAvailability
    // ========================================================================

    describe('checkAIAvailability', () => {
        it('should return available when SDK is ready', async () => {
            mockIsAvailable.mockResolvedValue({ available: true });
            const result = await checkAIAvailability();
            expect(result.available).toBe(true);
            expect(result.reason).toBeUndefined();
        });

        it('should return unavailable with reason', async () => {
            mockIsAvailable.mockResolvedValue({ available: false, error: 'Not signed in' });
            const result = await checkAIAvailability();
            expect(result.available).toBe(false);
            expect(result.reason).toBe('Not signed in');
        });

        it('should handle thrown errors', async () => {
            mockIsAvailable.mockRejectedValue(new Error('SDK not found'));
            const result = await checkAIAvailability();
            expect(result.available).toBe(false);
            expect(result.reason).toBe('SDK not found');
        });
    });

    // ========================================================================
    // createAnalysisInvoker
    // ========================================================================

    describe('createAnalysisInvoker', () => {
        it('should create invoker with MCP tools configured', async () => {
            mockSendMessage.mockResolvedValue({
                success: true,
                response: '{"result": "ok"}',
            });

            const invoker = createAnalysisInvoker({
                repoPath: '/repo',
            });

            await invoker('test prompt');

            expect(mockSendMessage).toHaveBeenCalledTimes(1);
            const callArgs = mockSendMessage.mock.calls[0][0];
            expect(callArgs.availableTools).toEqual(['view', 'grep', 'glob']);
        });

        it('should use direct session (usePool: false)', async () => {
            mockSendMessage.mockResolvedValue({
                success: true,
                response: 'result',
            });

            const invoker = createAnalysisInvoker({ repoPath: '/repo' });
            await invoker('test');

            const callArgs = mockSendMessage.mock.calls[0][0];
            expect(callArgs.usePool).toBe(false);
        });

        it('should set read-only permissions', async () => {
            mockSendMessage.mockResolvedValue({
                success: true,
                response: 'result',
            });

            const invoker = createAnalysisInvoker({ repoPath: '/repo' });
            await invoker('test');

            const callArgs = mockSendMessage.mock.calls[0][0];
            expect(callArgs.onPermissionRequest).toBeDefined();

            // Test read permission
            const readResult = callArgs.onPermissionRequest({ kind: 'read' });
            expect(readResult.kind).toBe('approved');

            // Test write permission
            const writeResult = callArgs.onPermissionRequest({ kind: 'write' });
            expect(writeResult.kind).toBe('denied-by-rules');

            // Test shell permission
            const shellResult = callArgs.onPermissionRequest({ kind: 'shell' });
            expect(shellResult.kind).toBe('denied-by-rules');
        });

        it('should pass model through', async () => {
            mockSendMessage.mockResolvedValue({ success: true, response: 'ok' });

            const invoker = createAnalysisInvoker({
                repoPath: '/repo',
                model: 'gpt-4',
            });
            await invoker('test');

            const callArgs = mockSendMessage.mock.calls[0][0];
            expect(callArgs.model).toBe('gpt-4');
        });

        it('should use per-invocation model override', async () => {
            mockSendMessage.mockResolvedValue({ success: true, response: 'ok' });

            const invoker = createAnalysisInvoker({
                repoPath: '/repo',
                model: 'gpt-4',
            });
            await invoker('test', { model: 'claude-sonnet' });

            const callArgs = mockSendMessage.mock.calls[0][0];
            expect(callArgs.model).toBe('claude-sonnet');
        });

        it('should use default timeout of 30min', async () => {
            mockSendMessage.mockResolvedValue({ success: true, response: 'ok' });

            const invoker = createAnalysisInvoker({ repoPath: '/repo' });
            await invoker('test');

            const callArgs = mockSendMessage.mock.calls[0][0];
            expect(callArgs.timeoutMs).toBe(1_800_000);
        });

        it('should use custom timeout', async () => {
            mockSendMessage.mockResolvedValue({ success: true, response: 'ok' });

            const invoker = createAnalysisInvoker({
                repoPath: '/repo',
                timeoutMs: 300_000,
            });
            await invoker('test');

            const callArgs = mockSendMessage.mock.calls[0][0];
            expect(callArgs.timeoutMs).toBe(300_000);
        });

        it('should set workingDirectory to repoPath', async () => {
            mockSendMessage.mockResolvedValue({ success: true, response: 'ok' });

            const invoker = createAnalysisInvoker({ repoPath: '/my/repo' });
            await invoker('test');

            const callArgs = mockSendMessage.mock.calls[0][0];
            expect(callArgs.workingDirectory).toBe('/my/repo');
        });

        it('should return success result', async () => {
            mockSendMessage.mockResolvedValue({
                success: true,
                response: 'analysis result',
            });

            const invoker = createAnalysisInvoker({ repoPath: '/repo' });
            const result = await invoker('test');

            expect(result.success).toBe(true);
            expect(result.response).toBe('analysis result');
        });

        it('should return error result on failure', async () => {
            mockSendMessage.mockResolvedValue({
                success: false,
                error: 'SDK error',
            });

            const invoker = createAnalysisInvoker({ repoPath: '/repo' });
            const result = await invoker('test');

            expect(result.success).toBe(false);
            expect(result.error).toBe('SDK error');
        });

        it('should handle thrown exceptions', async () => {
            mockSendMessage.mockRejectedValue(new Error('Connection failed'));

            const invoker = createAnalysisInvoker({ repoPath: '/repo' });
            const result = await invoker('test');

            expect(result.success).toBe(false);
            expect(result.error).toBe('Connection failed');
        });

        it('should not load default MCP config', async () => {
            mockSendMessage.mockResolvedValue({ success: true, response: 'ok' });

            const invoker = createAnalysisInvoker({ repoPath: '/repo' });
            await invoker('test');

            const callArgs = mockSendMessage.mock.calls[0][0];
            expect(callArgs.loadDefaultMcpConfig).toBe(false);
        });
    });

    // ========================================================================
    // createWritingInvoker
    // ========================================================================

    describe('createWritingInvoker', () => {
        it('should use direct session (usePool: false)', async () => {
            mockSendMessage.mockResolvedValue({ success: true, response: 'ok' });

            const invoker = createWritingInvoker({});
            await invoker('test');

            const callArgs = mockSendMessage.mock.calls[0][0];
            expect(callArgs.usePool).toBe(false);
        });

        it('should not configure any tools', async () => {
            mockSendMessage.mockResolvedValue({ success: true, response: 'ok' });

            const invoker = createWritingInvoker({});
            await invoker('test');

            const callArgs = mockSendMessage.mock.calls[0][0];
            expect(callArgs.availableTools).toBeUndefined();
            expect(callArgs.onPermissionRequest).toBeUndefined();
        });

        it('should not load default MCP config', async () => {
            mockSendMessage.mockResolvedValue({ success: true, response: 'ok' });

            const invoker = createWritingInvoker({});
            await invoker('test');

            const callArgs = mockSendMessage.mock.calls[0][0];
            expect(callArgs.loadDefaultMcpConfig).toBe(false);
        });

        it('should use default timeout of 30min', async () => {
            mockSendMessage.mockResolvedValue({ success: true, response: 'ok' });

            const invoker = createWritingInvoker({});
            await invoker('test');

            const callArgs = mockSendMessage.mock.calls[0][0];
            expect(callArgs.timeoutMs).toBe(1_800_000);
        });

        it('should pass model through', async () => {
            mockSendMessage.mockResolvedValue({ success: true, response: 'ok' });

            const invoker = createWritingInvoker({ model: 'gpt-4' });
            await invoker('test');

            const callArgs = mockSendMessage.mock.calls[0][0];
            expect(callArgs.model).toBe('gpt-4');
        });

        it('should use per-invocation timeout override', async () => {
            mockSendMessage.mockResolvedValue({ success: true, response: 'ok' });

            const invoker = createWritingInvoker({ timeoutMs: 60_000 });
            await invoker('test', { timeoutMs: 90_000 });

            const callArgs = mockSendMessage.mock.calls[0][0];
            expect(callArgs.timeoutMs).toBe(90_000);
        });

        it('should return success result', async () => {
            mockSendMessage.mockResolvedValue({
                success: true,
                response: '# Article\n\nContent here',
            });

            const invoker = createWritingInvoker({});
            const result = await invoker('Write article');

            expect(result.success).toBe(true);
            expect(result.response).toContain('Article');
        });

        it('should handle thrown exceptions', async () => {
            mockSendMessage.mockRejectedValue(new Error('Pool exhausted'));

            const invoker = createWritingInvoker({});
            const result = await invoker('test');

            expect(result.success).toBe(false);
            expect(result.error).toBe('Pool exhausted');
        });
    });

    // ========================================================================
    // Token Usage Pass-through
    // ========================================================================

    describe('tokenUsage pass-through', () => {
        const mockTokenUsage = {
            inputTokens: 1000,
            outputTokens: 500,
            cacheReadTokens: 200,
            cacheWriteTokens: 100,
            totalTokens: 1500,
            cost: 0.05,
            turnCount: 3,
        };

        it('should pass tokenUsage from analysis invoker', async () => {
            mockSendMessage.mockResolvedValue({
                success: true,
                response: 'result',
                tokenUsage: mockTokenUsage,
            });

            const invoker = createAnalysisInvoker({ repoPath: '/repo' });
            const result = await invoker('test');

            expect(result.tokenUsage).toBeDefined();
            expect(result.tokenUsage!.inputTokens).toBe(1000);
            expect(result.tokenUsage!.outputTokens).toBe(500);
            expect(result.tokenUsage!.totalTokens).toBe(1500);
            expect(result.tokenUsage!.cost).toBe(0.05);
            expect(result.tokenUsage!.turnCount).toBe(3);
        });

        it('should pass tokenUsage from writing invoker', async () => {
            mockSendMessage.mockResolvedValue({
                success: true,
                response: '# Article',
                tokenUsage: mockTokenUsage,
            });

            const invoker = createWritingInvoker({});
            const result = await invoker('test');

            expect(result.tokenUsage).toBeDefined();
            expect(result.tokenUsage!.inputTokens).toBe(1000);
            expect(result.tokenUsage!.totalTokens).toBe(1500);
        });

        it('should pass tokenUsage from consolidation invoker', async () => {
            mockSendMessage.mockResolvedValue({
                success: true,
                response: '{"clusters": []}',
                tokenUsage: mockTokenUsage,
            });

            const { createConsolidationInvoker } = await import('../src/ai-invoker');
            const invoker = createConsolidationInvoker({ workingDirectory: '/tmp' });
            const result = await invoker('test');

            expect(result.tokenUsage).toBeDefined();
            expect(result.tokenUsage!.inputTokens).toBe(1000);
        });

        it('should return undefined tokenUsage when SDK does not provide it', async () => {
            mockSendMessage.mockResolvedValue({
                success: true,
                response: 'result',
                // no tokenUsage
            });

            const invoker = createAnalysisInvoker({ repoPath: '/repo' });
            const result = await invoker('test');

            expect(result.tokenUsage).toBeUndefined();
        });

        it('should not include tokenUsage on error/exception', async () => {
            mockSendMessage.mockRejectedValue(new Error('timeout'));

            const invoker = createAnalysisInvoker({ repoPath: '/repo' });
            const result = await invoker('test');

            expect(result.success).toBe(false);
            expect(result.tokenUsage).toBeUndefined();
        });
    });
});
