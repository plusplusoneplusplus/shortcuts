/**
 * Unit tests for the Quick Ask side-note AI adapters.
 *
 * Both adapters are thin wrappers over the shared one-shot helper, so these
 * tests pin what the wrappers actually own: the timeout, the model pass-through,
 * and the image-path -> attachment mapping on the vision path.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

let mockResult: any = { success: true, response: 'answer' };
let capturedPrompt = '';
let capturedOptions: any = undefined;

vi.mock('../../src/server/core/one-shot-ai', () => ({
    ONE_SHOT_AI_TIMEOUT_MS: 60000,
    invokeOneShotAI: async (prompt: string, options: any) => {
        capturedPrompt = prompt;
        capturedOptions = options;
        return mockResult;
    },
}));

import {
    invokeSideNoteAI,
    invokeSideNoteVisionAI,
    SIDENOTE_AI_TIMEOUT_MS,
} from '../../src/server/processes/chat-sidenotes/chat-sidenotes-ai';

describe('chat-sidenotes AI adapters', () => {
    beforeEach(() => {
        mockResult = { success: true, response: 'answer' };
        capturedPrompt = '';
        capturedOptions = undefined;
    });

    describe('invokeSideNoteAI', () => {
        it('forwards the prompt, model and side-note timeout with no attachments', async () => {
            const result = await invokeSideNoteAI('what is this?', 'gpt-4.1');

            expect(result).toEqual({ success: true, response: 'answer' });
            expect(capturedPrompt).toBe('what is this?');
            expect(capturedOptions).toEqual({ model: 'gpt-4.1', timeoutMs: SIDENOTE_AI_TIMEOUT_MS });
        });

        it('leaves the model undefined when the caller omits it', async () => {
            await invokeSideNoteAI('what is this?');

            expect(capturedOptions.model).toBeUndefined();
        });

        it('propagates a failure result unchanged', async () => {
            mockResult = { success: false, error: 'AI service unavailable', unavailable: true };

            const result = await invokeSideNoteAI('prompt');

            expect(result).toEqual({ success: false, error: 'AI service unavailable', unavailable: true });
        });
    });

    describe('invokeSideNoteVisionAI', () => {
        it('maps image paths to indexed file attachments', async () => {
            await invokeSideNoteVisionAI('read this figure', ['/tmp/a.png', '/tmp/b.png'], 'gpt-4.1');

            expect(capturedPrompt).toBe('read this figure');
            expect(capturedOptions).toEqual({
                model: 'gpt-4.1',
                timeoutMs: SIDENOTE_AI_TIMEOUT_MS,
                attachments: [
                    { type: 'file', path: '/tmp/a.png', displayName: 'region-0.png' },
                    { type: 'file', path: '/tmp/b.png', displayName: 'region-1.png' },
                ],
            });
        });

        it('passes an empty attachment list through when given no images', async () => {
            await invokeSideNoteVisionAI('prompt', []);

            expect(capturedOptions.attachments).toEqual([]);
        });
    });
});
