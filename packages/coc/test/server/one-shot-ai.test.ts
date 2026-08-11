/**
 * Unit tests for the shared `invokeOneShotAI` helper.
 *
 * Covers path selection (transform when there are no attachments, the CLI
 * invoker when there are), the MCP-free contract on both paths, and the
 * success/unavailable result mapping the HTTP handlers depend on.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mutable state controlling mock behaviour
// ---------------------------------------------------------------------------
let mockTransformResult: any = { success: true, text: 'transformed' };
let mockRegistryThrows = false;
let capturedTransformInput = '';
let capturedTransformOptions: any = undefined;
let transformCalls = 0;

let mockInvokerResult: any = { success: true, response: 'invoked' };
let capturedFactoryOptions: any = undefined;
let capturedInvokerPrompt = '';
let capturedInvokerOptions: any = undefined;
let invokerCalls = 0;

const mockService = {
    transform: async (input: string, options: any) => {
        transformCalls++;
        capturedTransformInput = input;
        capturedTransformOptions = options;
        return mockTransformResult;
    },
};

vi.mock('@plusplusoneplusplus/forge', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@plusplusoneplusplus/forge')>();
    return {
        ...actual,
        sdkServiceRegistry: {
            getOrThrow: () => {
                if (mockRegistryThrows) {
                    throw new Error('no provider registered');
                }
                return mockService;
            },
        },
    };
});

vi.mock('../../src/ai-invoker', () => ({
    createCLIAIInvoker: (opts: any) => {
        capturedFactoryOptions = opts;
        return async (prompt: string, invokerOpts: any) => {
            invokerCalls++;
            capturedInvokerPrompt = prompt;
            capturedInvokerOptions = invokerOpts;
            return mockInvokerResult;
        };
    },
}));

import {
    invokeOneShotAI,
    ONE_SHOT_AI_TIMEOUT_MS,
} from '../../src/server/core/one-shot-ai';

const attachment = { type: 'file' as const, path: '/tmp/region-0.png', displayName: 'region-0.png' };

describe('invokeOneShotAI', () => {
    beforeEach(() => {
        mockTransformResult = { success: true, text: 'transformed' };
        mockRegistryThrows = false;
        capturedTransformInput = '';
        capturedTransformOptions = undefined;
        transformCalls = 0;

        mockInvokerResult = { success: true, response: 'invoked' };
        capturedFactoryOptions = undefined;
        capturedInvokerPrompt = '';
        capturedInvokerOptions = undefined;
        invokerCalls = 0;
    });

    // -----------------------------------------------------------------------
    // Path selection
    // -----------------------------------------------------------------------

    describe('path selection', () => {
        it('uses the transform primitive when there are no attachments', async () => {
            const result = await invokeOneShotAI('my prompt');

            expect(result).toEqual({ success: true, response: 'transformed' });
            expect(transformCalls).toBe(1);
            expect(invokerCalls).toBe(0);
            expect(capturedTransformInput).toBe('my prompt');
        });

        it('uses the transform primitive when attachments is an empty array', async () => {
            await invokeOneShotAI('my prompt', { attachments: [] });

            expect(transformCalls).toBe(1);
            expect(invokerCalls).toBe(0);
        });

        it('uses the CLI invoker when attachments are present', async () => {
            const result = await invokeOneShotAI('describe this', { attachments: [attachment] });

            expect(result).toEqual({ success: true, response: 'invoked' });
            expect(invokerCalls).toBe(1);
            expect(transformCalls).toBe(0);
            expect(capturedInvokerPrompt).toBe('describe this');
        });
    });

    // -----------------------------------------------------------------------
    // Invocation contract — both paths must be MCP-free and permission-denied
    // -----------------------------------------------------------------------

    describe('invocation contract', () => {
        it('forwards model and timeout to transform', async () => {
            await invokeOneShotAI('prompt', { model: 'gpt-4.1', timeoutMs: 1234 });

            expect(capturedTransformOptions).toEqual({ model: 'gpt-4.1', timeoutMs: 1234 });
        });

        it('defaults the transform timeout to the one-shot timeout', async () => {
            await invokeOneShotAI('prompt');

            expect(capturedTransformOptions.timeoutMs).toBe(ONE_SHOT_AI_TIMEOUT_MS);
            expect(capturedTransformOptions.model).toBeUndefined();
        });

        it('disables MCP config loading on the invoker path', async () => {
            await invokeOneShotAI('prompt', { attachments: [attachment] });

            expect(capturedFactoryOptions.loadMcpConfig).toBe(false);
        });

        it('denies permissions and forwards model + attachments on the invoker path', async () => {
            await invokeOneShotAI('prompt', { model: 'gpt-4.1', attachments: [attachment] });

            expect(capturedFactoryOptions.approvePermissions).toBe(false);
            expect(capturedFactoryOptions.model).toBe('gpt-4.1');
            expect(capturedFactoryOptions.attachments).toEqual([attachment]);
        });

        it('forwards the timeout to the invoker call', async () => {
            await invokeOneShotAI('prompt', { timeoutMs: 4321, attachments: [attachment] });

            expect(capturedInvokerOptions).toEqual({ timeoutMs: 4321 });
        });
    });

    // -----------------------------------------------------------------------
    // Result mapping
    // -----------------------------------------------------------------------

    describe('result mapping', () => {
        it('maps a provider-reported transform failure to unavailable:false', async () => {
            mockTransformResult = { success: false, text: '', error: 'model refused' };

            const result = await invokeOneShotAI('prompt');

            expect(result).toEqual({ success: false, error: 'model refused', unavailable: false });
        });

        it('falls back to a generic error message when the provider gives none', async () => {
            mockTransformResult = { success: false, text: '' };

            const result = await invokeOneShotAI('prompt');

            expect(result).toEqual({ success: false, error: 'AI request failed', unavailable: false });
        });

        it('maps a registry throw to unavailable:true', async () => {
            mockRegistryThrows = true;

            const result = await invokeOneShotAI('prompt');

            expect(result).toEqual({ success: false, error: 'AI service unavailable', unavailable: true });
        });

        it('returns an empty string when transform reports no text', async () => {
            mockTransformResult = { success: true, text: '' };

            const result = await invokeOneShotAI('prompt');

            expect(result).toEqual({ success: true, response: '' });
        });

        it('returns an empty string when transform text is undefined', async () => {
            mockTransformResult = { success: true };

            const result = await invokeOneShotAI('prompt');

            expect(result).toEqual({ success: true, response: '' });
        });

        it('maps an invoker failure to unavailable:false', async () => {
            mockInvokerResult = { success: false, response: '', error: 'vision failed' };

            const result = await invokeOneShotAI('prompt', { attachments: [attachment] });

            expect(result).toEqual({ success: false, error: 'vision failed', unavailable: false });
        });

        it('returns an empty string when the invoker reports no response', async () => {
            mockInvokerResult = { success: true, response: undefined };

            const result = await invokeOneShotAI('prompt', { attachments: [attachment] });

            expect(result).toEqual({ success: true, response: '' });
        });
    });
});
