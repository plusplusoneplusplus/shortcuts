import { describe, it, expect, vi } from 'vitest';
import type { ISDKService } from '../../src/sdk-service-interface';
import {
    createMockSDKService,
    createUnavailableMock,
    createStreamingMock,
    createFailingMock,
    createMockBridge,
    createExpiredSessionBridge,
    createDefaultMockFn,
} from '../../src/testing/index';
import type { MockFnFactory } from '../../src/testing/index';

// ---------------------------------------------------------------------------
// Default shim tests (no vitest spy injection)
// ---------------------------------------------------------------------------

describe('createMockSDKService (default shim)', () => {
    it('returns a service with all 15 ISDKService methods + createClient', () => {
        const { service } = createMockSDKService();
        const s: ISDKService = service;
        expect(typeof s.isAvailable).toBe('function');
        expect(typeof s.clearAvailabilityCache).toBe('function');
        expect(typeof s.listModels).toBe('function');
        expect(typeof s.sendMessage).toBe('function');
        expect(typeof s.transform).toBe('function');
        expect(typeof s.forkSession).toBe('function');
        expect(typeof s.rewindSession).toBe('function');
        expect(typeof s.compactSession).toBe('function');
        expect(typeof s.abortSession).toBe('function');
        expect(typeof s.softAbortSession).toBe('function');
        expect(typeof s.steerSession).toBe('function');
        expect(typeof s.hasActiveSession).toBe('function');
        expect(typeof s.getActiveSessionCount).toBe('function');
        expect(typeof s.cleanup).toBe('function');
        expect(typeof s.dispose).toBe('function');
        expect(typeof service.createClient).toBe('function');
    });

    it('default sendMessage returns success response', async () => {
        const { service } = createMockSDKService();
        const result = await service.sendMessage({ prompt: 'hello' } as any);
        expect(result).toEqual({
            success: true,
            response: 'AI response text',
            sessionId: 'session-123',
        });
    });

    it('title-router routes summarise prompts to mockTitleSendMessage', async () => {
        const { service, mockTitleSendMessage } = createMockSDKService();
        await service.sendMessage({
            prompt: 'Summarise the following conversation as a short title',
        } as any);
        expect(mockTitleSendMessage.calls.length).toBe(1);
    });

    it('default isAvailable returns { available: true }', async () => {
        const { service } = createMockSDKService();
        expect(await service.isAvailable()).toEqual({ available: true });
    });

    it('default transform returns a structured Generated Title result', async () => {
        const { service } = createMockSDKService();
        const result = await service.transform('prompt');
        expect(result.success).toBe(true);
        expect(result.text).toBe('Generated Title');
    });

    it('default forkSession returns id-forked', async () => {
        const { service } = createMockSDKService();
        expect(await service.forkSession('sess-1')).toBe('sess-1-forked');
    });

    it('default rewindSession echoes the event id with zero events removed', async () => {
        const { service } = createMockSDKService();
        expect(await service.rewindSession('sess-1', 'evt-9')).toEqual({
            eventsRemoved: 0,
            upToEventId: 'evt-9',
        });
    });

    it('default compactSession reports a successful no-op compaction', async () => {
        const { service } = createMockSDKService();
        expect(await service.compactSession('sess-1', 'focus')).toEqual({
            success: true,
            tokensRemoved: 0,
            messagesRemoved: 0,
        });
    });

    it('default session methods return expected values', async () => {
        const { service } = createMockSDKService();
        expect(await service.abortSession('s')).toBe(true);
        expect(await service.softAbortSession('s')).toBe(true);
        expect(await service.steerSession('s', 'msg')).toBe(true);
        expect(service.hasActiveSession('s')).toBe(true);
        expect(service.getActiveSessionCount()).toBe(0);
    });

    it('default lifecycle methods work', async () => {
        const { service } = createMockSDKService();
        await expect(service.cleanup()).resolves.toBeUndefined();
        expect(() => service.dispose()).not.toThrow();
    });

    it('default createClient returns mock client', async () => {
        const { service } = createMockSDKService();
        expect(await service.createClient()).toEqual({ __mockClient: true });
    });

    it('default shim records calls', async () => {
        const { mockSendMessage, service } = createMockSDKService();
        await service.sendMessage({ prompt: 'test' } as any);
        expect(mockSendMessage.calls.length).toBe(1);
    });

    it('resetAll restores defaults', async () => {
        const { service, mockSendMessage, resetAll } = createMockSDKService();
        mockSendMessage.mockResolvedValue({ success: false, error: 'fail' });
        const badResult = await service.sendMessage({ prompt: 'x' } as any);
        expect(badResult).toEqual({ success: false, error: 'fail' });

        resetAll();
        const goodResult = await service.sendMessage({ prompt: 'y' } as any);
        expect(goodResult).toEqual({
            success: true,
            response: 'AI response text',
            sessionId: 'session-123',
        });
    });
});

describe('createMockSDKService options', () => {
    it('accepts boolean available', async () => {
        const { service } = createMockSDKService({ available: false });
        expect(await service.isAvailable()).toEqual({ available: false });
    });

    it('accepts full IAvailabilityResult', async () => {
        const { service } = createMockSDKService({
            available: { available: false, error: 'not installed' },
        });
        expect(await service.isAvailable()).toEqual({ available: false, error: 'not installed' });
    });

    it('accepts custom sendMessageResponse', async () => {
        const custom = { success: false, error: 'boom' };
        const { service } = createMockSDKService({ sendMessageResponse: custom });
        expect(await service.sendMessage({ prompt: 'x' } as any)).toEqual(custom);
    });

    it('accepts custom transformResult', async () => {
        const { service } = createMockSDKService({ transformResult: { success: true, text: 'custom title' } });
        const result = await service.transform('p');
        expect(result.text).toBe('custom title');
    });

    it('accepts custom listModelsResult', async () => {
        const models = [{ id: 'gpt-5', name: 'GPT-5' }];
        const { service } = createMockSDKService({ listModelsResult: models });
        expect(await service.listModels()).toEqual(models);
    });

    it('accepts method overrides', async () => {
        const { service } = createMockSDKService({
            overrides: {
                isAvailable: async () => ({ available: false, error: 'override' }),
            },
        });
        expect(await service.isAvailable()).toEqual({ available: false, error: 'override' });
    });
});

// ---------------------------------------------------------------------------
// Injected vi.fn factory
// ---------------------------------------------------------------------------

describe('createMockSDKService with injected vi.fn', () => {
    const viFnFactory: MockFnFactory = (impl) => {
        const mock = impl ? vi.fn(impl) : vi.fn();
        (mock as any).calls = [];
        (mock as any).mockResolvedValue = mock.mockResolvedValue.bind(mock);
        (mock as any).mockResolvedValueOnce = mock.mockResolvedValueOnce.bind(mock);
        (mock as any).mockImplementation = mock.mockImplementation.bind(mock);
        (mock as any).mockImplementationOnce = mock.mockImplementationOnce.bind(mock);
        const origReset = mock.mockReset.bind(mock);
        (mock as any).mockReset = () => { origReset(); return mock as any; };
        return mock as any;
    };

    it('injected factory is honored', async () => {
        const { mockSendMessage, service } = createMockSDKService(undefined, viFnFactory);
        await service.sendMessage({ prompt: 'hello' } as any);
        expect(mockSendMessage).toHaveBeenCalledTimes(1);
    });

    it('vitest assertions work on mock handles', async () => {
        const { mockIsAvailable, service } = createMockSDKService(undefined, viFnFactory);
        await service.isAvailable();
        expect(mockIsAvailable).toHaveBeenCalled();
    });
});

// ---------------------------------------------------------------------------
// Preset factories
// ---------------------------------------------------------------------------

describe('createUnavailableMock', () => {
    it('returns unavailable service', async () => {
        const { service } = createUnavailableMock();
        expect(await service.isAvailable()).toEqual({ available: false });
    });
});

describe('createStreamingMock', () => {
    it('invokes onStreamingChunk for each chunk', async () => {
        const chunks = ['Hello', ' ', 'World'];
        const { mockSendMessage } = createStreamingMock(chunks);
        const received: string[] = [];
        await mockSendMessage('test', { onStreamingChunk: (c: string) => received.push(c) });
        expect(received).toEqual(chunks);
    });
});

describe('createFailingMock', () => {
    it('returns failure response', async () => {
        const { service } = createFailingMock('oops');
        const result = await service.sendMessage({ prompt: 'x' } as any);
        expect(result).toEqual({ success: false, error: 'oops' });
    });
});

// ---------------------------------------------------------------------------
// Default MockFn shim
// ---------------------------------------------------------------------------

describe('createDefaultMockFn', () => {
    it('tracks calls', () => {
        const fn = createDefaultMockFn(() => 42);
        fn('a', 'b');
        fn('c');
        expect(fn.calls).toEqual([['a', 'b'], ['c']]);
    });

    it('mockResolvedValue overrides return', async () => {
        const fn = createDefaultMockFn(() => Promise.resolve(1));
        fn.mockResolvedValue(99);
        expect(await fn()).toBe(99);
    });

    it('mockResolvedValueOnce is consumed once', async () => {
        const fn = createDefaultMockFn(() => Promise.resolve('default'));
        fn.mockResolvedValueOnce('once');
        expect(await fn()).toBe('once');
        expect(await fn()).toBe('default');
    });

    it('mockImplementation replaces default', () => {
        const fn = createDefaultMockFn(() => 'a');
        fn.mockImplementation(() => 'b');
        expect(fn()).toBe('b');
    });

    it('mockImplementationOnce is consumed once', () => {
        const fn = createDefaultMockFn(() => 'default');
        fn.mockImplementationOnce(() => 'once');
        expect(fn()).toBe('once');
        expect(fn()).toBe('default');
    });

    it('mockReset restores initial impl and clears calls', () => {
        const fn = createDefaultMockFn(() => 'initial');
        fn.mockImplementation(() => 'replaced');
        fn('call1');
        fn.mockReset();
        expect(fn()).toBe('initial');
        expect(fn.calls).toEqual([[]]);
    });
});

// ---------------------------------------------------------------------------
// Bridge mocks
// ---------------------------------------------------------------------------

describe('createMockBridge', () => {
    it('returns all bridge methods', async () => {
        const bridge = createMockBridge();
        expect(typeof bridge.executeFollowUp).toBe('function');
        expect(typeof bridge.isSessionAlive).toBe('function');
        expect(typeof bridge.enqueue).toBe('function');
        expect(typeof bridge.cancelProcess).toBe('function');
        expect(typeof bridge.steerProcess).toBe('function');
        expect(typeof bridge.getTask).toBe('function');
    });

    it('default isSessionAlive returns true', async () => {
        const bridge = createMockBridge();
        expect(await bridge.isSessionAlive()).toBe(true);
    });

    it('accepts overrides', async () => {
        const customFn = createDefaultMockFn(() => Promise.resolve(false));
        const bridge = createMockBridge({ isSessionAlive: customFn });
        expect(await bridge.isSessionAlive()).toBe(false);
    });
});

describe('createExpiredSessionBridge', () => {
    it('returns bridge where isSessionAlive is false', async () => {
        const bridge = createExpiredSessionBridge();
        expect(await bridge.isSessionAlive()).toBe(false);
    });
});
