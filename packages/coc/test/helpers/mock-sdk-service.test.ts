/**
 * Smoke tests for shared mock-sdk-service helpers.
 */

import { describe, it, expect, vi } from 'vitest';
import {
    createMockSDKService,
    createMockBridge,
    createExpiredSessionMock,
    createUnavailableMock,
    createStreamingMock,
    createFailingMock,
    createExpiredSessionBridge,
} from './mock-sdk-service';

describe('mock-sdk-service helpers', () => {
    describe('createMockSDKService', () => {
        it('should return object with all SDK mocks and resetAll', () => {
            const result = createMockSDKService();
            expect(result.mockSendMessage).toBeDefined();
            expect(result.mockIsAvailable).toBeDefined();
            expect(result.mockSendFollowUp).toBeDefined();
            expect(result.mockHasKeptAliveSession).toBeDefined();
            expect(result.mockCanResumeSession).toBeDefined();
            expect(result.resetAll).toBeInstanceOf(Function);
            expect(result.service.sendMessage).toBe(result.mockSendMessage);
            expect(result.service.isAvailable).toBe(result.mockIsAvailable);
            expect(result.service.sendFollowUp).toBe(result.mockSendFollowUp);
            expect(result.service.hasKeptAliveSession).toBe(result.mockHasKeptAliveSession);
            expect(result.service.canResumeSession).toBe(result.mockCanResumeSession);
        });

        it('should use default responses when no options provided', async () => {
            const result = createMockSDKService();
            const available = await result.mockIsAvailable();
            expect(available).toEqual({ available: true });

            const msg = await result.mockSendMessage();
            expect(msg).toEqual({ success: true, response: 'AI response text', sessionId: 'session-123' });

            const followUp = await result.mockSendFollowUp();
            expect(followUp).toEqual({ success: true, response: 'Follow-up response', sessionId: 'sess-follow' });

            expect(result.mockHasKeptAliveSession()).toBe(true);
            await expect(result.mockCanResumeSession()).resolves.toBe(true);
        });

        it('should configure isAvailable to return { available: false }', async () => {
            const result = createMockSDKService({ available: false });
            const available = await result.mockIsAvailable();
            expect(available).toEqual({ available: false });
        });

        it('should configure custom sendMessage response', async () => {
            const result = createMockSDKService({
                sendMessageResponse: { success: false, error: 'test error' },
            });
            const msg = await result.mockSendMessage();
            expect(msg).toEqual({ success: false, error: 'test error' });
        });

        it('should restore mocks to initial configured state via resetAll', async () => {
            const result = createMockSDKService({ available: false });

            // Override
            result.mockIsAvailable.mockResolvedValue({ available: true });
            expect(await result.mockIsAvailable()).toEqual({ available: true });

            // Reset
            result.resetAll();
            expect(await result.mockIsAvailable()).toEqual({ available: false });
        });
    });

    describe('createMockBridge', () => {
        it('should return object with executeFollowUp, isSessionAlive, and enqueue', () => {
            const bridge = createMockBridge();
            expect(bridge.executeFollowUp).toBeDefined();
            expect(bridge.isSessionAlive).toBeDefined();
            expect(bridge.enqueue).toBeDefined();
        });

        it('should have default implementations', async () => {
            const bridge = createMockBridge();
            await expect(bridge.executeFollowUp('id', 'msg')).resolves.toBeUndefined();
            await expect(bridge.isSessionAlive('id')).resolves.toBe(true);
            await expect(bridge.enqueue!({ type: 'chat-followup', priority: 'normal', payload: {}, config: {} })).resolves.toBe('mock-task-id');
        });

        it('should accept overrides', async () => {
            const bridge = createMockBridge({
                isSessionAlive: vi.fn().mockResolvedValue(false),
            });
            await expect(bridge.isSessionAlive('id')).resolves.toBe(false);
        });
    });

    describe('preset factories', () => {
        it('createExpiredSessionMock should have hasKeptAliveSession return false', () => {
            const result = createExpiredSessionMock();
            expect(result.mockHasKeptAliveSession()).toBe(false);
            return expect(result.mockCanResumeSession()).resolves.toBe(false);
        });

        it('createUnavailableMock should have isAvailable return { available: false }', async () => {
            const result = createUnavailableMock();
            expect(await result.mockIsAvailable()).toEqual({ available: false });
        });

        it('createStreamingMock should invoke onStreamingChunk for each chunk', async () => {
            const result = createStreamingMock(['Hello ', 'World']);
            const chunks: string[] = [];
            const response = await result.mockSendMessage('prompt', {
                onStreamingChunk: (c: string) => chunks.push(c),
            });
            expect(chunks).toEqual(['Hello ', 'World']);
            expect(response.response).toBe('Hello World');
        });

        it('createStreamingMock should also work for sendFollowUp', async () => {
            const result = createStreamingMock(['a', 'b', 'c']);
            const chunks: string[] = [];
            const response = await result.mockSendFollowUp('sid', 'prompt', {
                onStreamingChunk: (c: string) => chunks.push(c),
            });
            expect(chunks).toEqual(['a', 'b', 'c']);
            expect(response.response).toBe('abc');
        });

        it('createFailingMock should have sendMessage return failure', async () => {
            const result = createFailingMock('rate limited');
            const msg = await result.mockSendMessage();
            expect(msg).toEqual({ success: false, error: 'rate limited' });
        });

        it('createExpiredSessionBridge should have isSessionAlive return false', async () => {
            const bridge = createExpiredSessionBridge();
            await expect(bridge.isSessionAlive('id')).resolves.toBe(false);
        });
    });
});
