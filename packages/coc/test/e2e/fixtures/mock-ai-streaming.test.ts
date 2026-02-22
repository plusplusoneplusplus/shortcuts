/**
 * Unit tests for createStreamingResponse / createToolCallResponse helpers
 * in the E2E mock AI service.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createE2EMockSDKService, type MockToolEvent } from './mock-ai';

describe('MockAI streaming and tool-event helpers', () => {
    let mockAI: ReturnType<typeof createE2EMockSDKService>;

    beforeEach(() => {
        mockAI = createE2EMockSDKService();
    });

    // -----------------------------------------------------------------------
    // createStreamingResponse
    // -----------------------------------------------------------------------

    describe('createStreamingResponse', () => {
        it('calls onStreamingChunk for each chunk (sendMessage signature)', async () => {
            const chunks: string[] = [];
            const impl = mockAI.createStreamingResponse(['Hello', ' world']);

            const result = await impl({
                prompt: 'test',
                onStreamingChunk: (c: string) => chunks.push(c),
            });

            expect(chunks).toEqual(['Hello', ' world']);
            expect(result).toEqual({
                success: true,
                response: 'Hello world',
                sessionId: 'session-123',
            });
        });

        it('calls onStreamingChunk for sendFollowUp signature (3 args)', async () => {
            const chunks: string[] = [];
            const impl = mockAI.createStreamingResponse(['A', 'B', 'C']);

            // sendFollowUp(sessionId, message, opts)
            await impl('session-x', 'follow-up msg', {
                onStreamingChunk: (c: string) => chunks.push(c),
            });

            expect(chunks).toEqual(['A', 'B', 'C']);
        });

        it('uses custom finalResponse and sessionId when provided', async () => {
            const impl = mockAI.createStreamingResponse(['a'], {
                finalResponse: 'custom-final',
                sessionId: 'sess-custom',
            });

            const result = (await impl({ prompt: 'x' })) as Record<string, unknown>;
            expect(result.response).toBe('custom-final');
            expect(result.sessionId).toBe('sess-custom');
        });

        it('does not throw when onStreamingChunk is absent', async () => {
            const impl = mockAI.createStreamingResponse(['chunk1']);
            const result = await impl({ prompt: 'no-callback' });
            expect(result).toEqual({
                success: true,
                response: 'chunk1',
                sessionId: 'session-123',
            });
        });

        it('respects delayMs between chunks', async () => {
            const timestamps: number[] = [];
            const impl = mockAI.createStreamingResponse(['a', 'b'], { delayMs: 50 });

            await impl({
                prompt: 'delayed',
                onStreamingChunk: () => timestamps.push(Date.now()),
            });

            expect(timestamps).toHaveLength(2);
            const gap = timestamps[1] - timestamps[0];
            expect(gap).toBeGreaterThanOrEqual(30); // allow some timing tolerance
        });

        it('skips sleep when delayMs is 0', async () => {
            const chunks: string[] = [];
            const impl = mockAI.createStreamingResponse(['x', 'y'], { delayMs: 0 });

            const start = Date.now();
            await impl({
                prompt: 'fast',
                onStreamingChunk: (c: string) => chunks.push(c),
            });
            const elapsed = Date.now() - start;

            expect(chunks).toEqual(['x', 'y']);
            expect(elapsed).toBeLessThan(50);
        });

        it('works with mockImplementation on mockSendMessage', async () => {
            const chunks: string[] = [];
            mockAI.mockSendMessage.mockImplementation(
                mockAI.createStreamingResponse(['Hello', ' world']),
            );

            await mockAI.mockSendMessage({
                prompt: 'test',
                onStreamingChunk: (c: string) => chunks.push(c),
            });

            expect(chunks).toEqual(['Hello', ' world']);
            expect(mockAI.mockSendMessage.calls).toHaveLength(1);
        });
    });

    // -----------------------------------------------------------------------
    // createToolCallResponse
    // -----------------------------------------------------------------------

    describe('createToolCallResponse', () => {
        const sampleEvents: MockToolEvent[] = [
            { type: 'tool-start', toolCallId: 'tc-1', toolName: 'grep' },
            { type: 'tool-complete', toolCallId: 'tc-1', toolName: 'grep', result: '3 matches' },
        ];

        it('fires onToolEvent for each event (sendMessage signature)', async () => {
            const fired: Record<string, unknown>[] = [];
            const impl = mockAI.createToolCallResponse(sampleEvents);

            await impl({
                prompt: 'test',
                onToolEvent: (e: Record<string, unknown>) => fired.push(e),
            });

            expect(fired).toHaveLength(2);
            expect(fired[0]).toEqual({ type: 'tool-start', toolCallId: 'tc-1', toolName: 'grep' });
            expect(fired[1]).toEqual({
                type: 'tool-complete',
                toolCallId: 'tc-1',
                toolName: 'grep',
                result: '3 matches',
            });
        });

        it('fires onToolEvent for sendFollowUp signature (3 args)', async () => {
            const fired: Record<string, unknown>[] = [];
            const impl = mockAI.createToolCallResponse(sampleEvents);

            await impl('session-x', 'msg', {
                onToolEvent: (e: Record<string, unknown>) => fired.push(e),
            });

            expect(fired).toHaveLength(2);
        });

        it('strips delayMsBefore from the emitted event payload', async () => {
            const fired: Record<string, unknown>[] = [];
            const events: MockToolEvent[] = [
                { type: 'tool-start', toolCallId: 'tc-2', toolName: 'view', delayMsBefore: 10 },
            ];
            const impl = mockAI.createToolCallResponse(events);

            await impl({
                prompt: 'x',
                onToolEvent: (e: Record<string, unknown>) => fired.push(e),
            });

            expect(fired[0]).not.toHaveProperty('delayMsBefore');
            expect(fired[0]).toEqual({ type: 'tool-start', toolCallId: 'tc-2', toolName: 'view' });
        });

        it('respects per-event delayMsBefore', async () => {
            const timestamps: number[] = [];
            const events: MockToolEvent[] = [
                { type: 'tool-start', toolCallId: 'tc-1', toolName: 'a' },
                { type: 'tool-complete', toolCallId: 'tc-1', toolName: 'a', delayMsBefore: 50 },
            ];
            const impl = mockAI.createToolCallResponse(events);

            await impl({
                prompt: 'x',
                onToolEvent: () => timestamps.push(Date.now()),
            });

            const gap = timestamps[1] - timestamps[0];
            expect(gap).toBeGreaterThanOrEqual(30);
        });

        it('does not throw when onToolEvent is absent', async () => {
            const impl = mockAI.createToolCallResponse(sampleEvents);
            const result = await impl({ prompt: 'no-callback' });
            expect(result).toEqual({
                success: true,
                response: '',
                sessionId: 'session-123',
            });
        });

        it('uses custom finalResponse and sessionId', async () => {
            const impl = mockAI.createToolCallResponse(sampleEvents, {
                finalResponse: 'done',
                sessionId: 'sess-42',
            });

            const result = (await impl({ prompt: 'x' })) as Record<string, unknown>;
            expect(result.response).toBe('done');
            expect(result.sessionId).toBe('sess-42');
        });

        it('passes parentToolCallId and parameters through', async () => {
            const fired: Record<string, unknown>[] = [];
            const events: MockToolEvent[] = [
                {
                    type: 'tool-start',
                    toolCallId: 'child-1',
                    toolName: 'explore',
                    parentToolCallId: 'parent-1',
                    parameters: { path: '/src' },
                },
            ];
            const impl = mockAI.createToolCallResponse(events);

            await impl({
                prompt: 'x',
                onToolEvent: (e: Record<string, unknown>) => fired.push(e),
            });

            expect(fired[0]).toEqual({
                type: 'tool-start',
                toolCallId: 'child-1',
                toolName: 'explore',
                parentToolCallId: 'parent-1',
                parameters: { path: '/src' },
            });
        });

        it('works with mockImplementation on mockSendFollowUp', async () => {
            const fired: Record<string, unknown>[] = [];
            mockAI.mockSendFollowUp.mockImplementation(
                mockAI.createToolCallResponse(sampleEvents),
            );

            await mockAI.mockSendFollowUp('sess', 'msg', {
                onToolEvent: (e: Record<string, unknown>) => fired.push(e),
            });

            expect(fired).toHaveLength(2);
            expect(mockAI.mockSendFollowUp.calls).toHaveLength(1);
        });
    });
});
