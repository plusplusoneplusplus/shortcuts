/**
 * Unit tests for `invokeCommentAI` in comments-ai-helpers.ts.
 *
 * Tests the function directly (no HTTP server) covering: happy path,
 * empty-response fallback, success:false branches, invoker throws,
 * import failure, and invocation-contract assertions.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mutable state controlling mock behaviour
// ---------------------------------------------------------------------------
let mockAIResponse: any = { success: true, response: 'test response' };
let mockAIThrow = false;
let capturedPrompt = '';
let capturedInvokerOptions: any = {};
let capturedFactoryOptions: any = {};

vi.mock('../../src/ai-invoker', () => ({
    createCLIAIInvoker: (opts: any) => {
        capturedFactoryOptions = opts;
        return async (prompt: string, invokerOpts: any) => {
            capturedPrompt = prompt;
            capturedInvokerOptions = invokerOpts;
            if (mockAIThrow) {
                throw new Error('AI unavailable');
            }
            return mockAIResponse;
        };
    },
}));

import { invokeCommentAI } from '../../src/server/tasks/comments/comments-ai-helpers';

// ===========================================================================
// Tests
// ===========================================================================

describe('invokeCommentAI', () => {
    beforeEach(() => {
        mockAIResponse = { success: true, response: 'test response' };
        mockAIThrow = false;
        capturedPrompt = '';
        capturedInvokerOptions = {};
        capturedFactoryOptions = {};
    });

    // -----------------------------------------------------------------------
    // Happy path
    // -----------------------------------------------------------------------

    it('returns success:true with the invoker response string', async () => {
        mockAIResponse = { success: true, response: 'some text' };
        const result = await invokeCommentAI('my prompt');
        expect(result).toEqual({ success: true, response: 'some text' });
    });

    it('returns empty string when response is empty', async () => {
        mockAIResponse = { success: true, response: '' };
        const result = await invokeCommentAI('prompt');
        expect(result).toEqual({ success: true, response: '' });
    });

    it('returns empty string when response is undefined', async () => {
        mockAIResponse = { success: true, response: undefined };
        const result = await invokeCommentAI('prompt');
        expect(result).toEqual({ success: true, response: '' });
    });

    // -----------------------------------------------------------------------
    // success:false (non-throw) — maps to HTTP 502
    // -----------------------------------------------------------------------

    it('returns unavailable:false when invoker resolves with success:false', async () => {
        mockAIResponse = { success: false, error: 'bad request' };
        const result = await invokeCommentAI('prompt');
        expect(result).toEqual({
            success: false,
            error: 'bad request',
            unavailable: false,
        });
    });

    it('uses default error message when invoker resolves with success:false and no error field', async () => {
        mockAIResponse = { success: false };
        const result = await invokeCommentAI('prompt');
        expect(result).toEqual({
            success: false,
            error: 'AI request failed',
            unavailable: false,
        });
    });

    // -----------------------------------------------------------------------
    // Invoker throw — maps to HTTP 503
    // -----------------------------------------------------------------------

    it('returns unavailable:true when invoker function throws', async () => {
        mockAIThrow = true;
        const result = await invokeCommentAI('prompt');
        expect(result).toEqual({
            success: false,
            error: 'AI service unavailable',
            unavailable: true,
        });
    });

    // -----------------------------------------------------------------------
    // Invocation-contract assertions
    // -----------------------------------------------------------------------

    it('calls createCLIAIInvoker with approvePermissions: false', async () => {
        await invokeCommentAI('prompt');
        expect(capturedFactoryOptions).toEqual({ approvePermissions: false });
    });

    it('calls the invoker with timeoutMs: 60000', async () => {
        await invokeCommentAI('prompt');
        expect(capturedInvokerOptions).toEqual({ timeoutMs: 60000 });
    });

    it('forwards the prompt string unchanged', async () => {
        const prompt = 'Please analyze this code\nwith newlines and special chars: <>&"';
        await invokeCommentAI(prompt);
        expect(capturedPrompt).toBe(prompt);
    });

    // -----------------------------------------------------------------------
    // Import failure — maps to HTTP 503
    // -----------------------------------------------------------------------

    describe('when ai-invoker import fails', () => {
        afterEach(() => {
            vi.doUnmock('../../src/ai-invoker');
            vi.resetModules();
        });

        it('returns unavailable:true when dynamic import throws', async () => {
            vi.resetModules();
            vi.doMock('../../src/ai-invoker', () => {
                throw new Error('Module not found');
            });
            const mod = await import('../../src/server/tasks/comments/comments-ai-helpers');
            const result = await mod.invokeCommentAI('prompt');
            expect(result).toEqual({
                success: false,
                error: 'AI service unavailable',
                unavailable: true,
            });
        });
    });
});
