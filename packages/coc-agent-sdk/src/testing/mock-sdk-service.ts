/**
 * Shared vitest-free mock of ISDKService.
 *
 * Implements all 13 interface methods plus the off-interface `createClient`.
 * The mock-function factory is injectable so consumers can bind `vi.fn` for
 * full spy assertions while the package itself imports nothing from vitest.
 */

import type { ISDKService, IAvailabilityResult, IInvocationResult, IModelInfo } from '../sdk-service-interface';
import type { SendMessageOptions } from '../types';
import type { MockFnHandle, MockFnFactory } from './mock-fn';
import { createDefaultMockFn } from './mock-fn';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MockSDKServiceOptions {
    /** Availability result. Default: `{ available: true }` */
    available?: boolean | IAvailabilityResult;
    /** Default sendMessage response */
    sendMessageResponse?: IInvocationResult;
    /** Default transform result. Default: `'Generated Title'` */
    transformResult?: unknown;
    /** Default listModels result. Default: `[]` */
    listModelsResult?: IModelInfo[];
    /** Arbitrary method overrides applied after defaults */
    overrides?: Partial<ISDKService>;
}

export type MockSDKService = ISDKService & { createClient: (...args: unknown[]) => unknown };

export interface MockSDKServiceResult {
    service: MockSDKService;
    mockSendMessage: MockFnHandle;
    mockTitleSendMessage: MockFnHandle;
    mockIsAvailable: MockFnHandle;
    mockCreateClient: MockFnHandle;
    mockTransform: MockFnHandle;
    mockAbortSession: MockFnHandle;
    mockSoftAbortSession: MockFnHandle;
    mockSteerSession: MockFnHandle;
    mockListModels: MockFnHandle;
    mockForkSession: MockFnHandle;
    mockClearAvailabilityCache: MockFnHandle;
    mockHasActiveSession: MockFnHandle;
    mockGetActiveSessionCount: MockFnHandle;
    mockCleanup: MockFnHandle;
    mockDispose: MockFnHandle;
    resetAll: () => void;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createMockSDKService(
    options?: MockSDKServiceOptions,
    fn: MockFnFactory = createDefaultMockFn,
): MockSDKServiceResult {
    const availableResult: IAvailabilityResult =
        typeof options?.available === 'object'
            ? options.available
            : { available: options?.available ?? true };

    const sendMessageResponse: IInvocationResult = options?.sendMessageResponse ?? {
        success: true,
        response: 'AI response text',
        sessionId: 'session-123',
    };

    const transformResult = options?.transformResult ?? 'Generated Title';
    const listModelsResult = options?.listModelsResult ?? [];

    // Individual mock handles
    const mockSendMessage = fn(() => Promise.resolve(sendMessageResponse));
    const mockTitleSendMessage = fn(() =>
        Promise.resolve({ success: true, response: 'Generated Title', sessionId: 'title-session' }),
    );

    const sendMessageRouter = fn((...args: unknown[]) => {
        const messageOptions = args[0] as SendMessageOptions | undefined;
        if (
            typeof messageOptions?.prompt === 'string' &&
            messageOptions.prompt.startsWith('Summarise the following conversation')
        ) {
            return mockTitleSendMessage(messageOptions);
        }
        return mockSendMessage(messageOptions);
    });

    const mockIsAvailable = fn(() => Promise.resolve(availableResult));
    const mockCreateClient = fn(() => Promise.resolve({ __mockClient: true }));
    const mockTransform = fn(() => Promise.resolve(transformResult));
    const mockAbortSession = fn(() => Promise.resolve(true));
    const mockSoftAbortSession = fn(() => Promise.resolve(true));
    const mockSteerSession = fn(() => Promise.resolve(true));
    const mockListModels = fn(() => Promise.resolve(listModelsResult));
    const mockForkSession = fn((...args: unknown[]) => Promise.resolve(`${String(args[0])}-forked`));
    const mockClearAvailabilityCache = fn(() => undefined);
    const mockHasActiveSession = fn(() => true);
    const mockGetActiveSessionCount = fn(() => 0);
    const mockCleanup = fn(() => Promise.resolve());
    const mockDispose = fn(() => undefined);

    const baseService: MockSDKService = {
        sendMessage: sendMessageRouter as unknown as ISDKService['sendMessage'],
        isAvailable: mockIsAvailable as unknown as ISDKService['isAvailable'],
        createClient: mockCreateClient,
        transform: mockTransform as unknown as ISDKService['transform'],
        abortSession: mockAbortSession as unknown as ISDKService['abortSession'],
        softAbortSession: mockSoftAbortSession as unknown as ISDKService['softAbortSession'],
        steerSession: mockSteerSession as unknown as ISDKService['steerSession'],
        listModels: mockListModels as unknown as ISDKService['listModels'],
        forkSession: mockForkSession as unknown as ISDKService['forkSession'],
        clearAvailabilityCache: mockClearAvailabilityCache as unknown as ISDKService['clearAvailabilityCache'],
        hasActiveSession: mockHasActiveSession as unknown as ISDKService['hasActiveSession'],
        getActiveSessionCount: mockGetActiveSessionCount as unknown as ISDKService['getActiveSessionCount'],
        cleanup: mockCleanup as unknown as ISDKService['cleanup'],
        dispose: mockDispose as unknown as ISDKService['dispose'],
    };

    if (options?.overrides) {
        Object.assign(baseService, options.overrides);
    }

    const resetAll = () => {
        mockSendMessage.mockReset().mockResolvedValue(sendMessageResponse);
        mockTitleSendMessage.mockReset().mockResolvedValue({
            success: true,
            response: 'Generated Title',
            sessionId: 'title-session',
        });
        sendMessageRouter.mockReset().mockImplementation((...args: unknown[]) => {
            const messageOptions = args[0] as SendMessageOptions | undefined;
            if (
                typeof messageOptions?.prompt === 'string' &&
                messageOptions.prompt.startsWith('Summarise the following conversation')
            ) {
                return mockTitleSendMessage(messageOptions);
            }
            return mockSendMessage(messageOptions);
        });
        mockIsAvailable.mockReset().mockResolvedValue(availableResult);
        mockCreateClient.mockReset().mockResolvedValue({ __mockClient: true });
        mockTransform.mockReset().mockResolvedValue(transformResult);
        mockAbortSession.mockReset().mockResolvedValue(true);
        mockSoftAbortSession.mockReset().mockResolvedValue(true);
        mockSteerSession.mockReset().mockResolvedValue(true);
        mockListModels.mockReset().mockResolvedValue(listModelsResult);
        mockForkSession.mockReset().mockImplementation((...args: unknown[]) => Promise.resolve(`${String(args[0])}-forked`));
        mockClearAvailabilityCache.mockReset();
        mockHasActiveSession.mockReset().mockImplementation(() => true);
        mockGetActiveSessionCount.mockReset().mockImplementation(() => 0);
        mockCleanup.mockReset().mockResolvedValue(undefined);
        mockDispose.mockReset();
    };

    return {
        service: baseService,
        mockSendMessage,
        mockTitleSendMessage,
        mockIsAvailable,
        mockCreateClient,
        mockTransform,
        mockAbortSession,
        mockSoftAbortSession,
        mockSteerSession,
        mockListModels,
        mockForkSession,
        mockClearAvailabilityCache,
        mockHasActiveSession,
        mockGetActiveSessionCount,
        mockCleanup,
        mockDispose,
        resetAll,
    };
}

// ---------------------------------------------------------------------------
// Preset factories
// ---------------------------------------------------------------------------

/** Mock where isAvailable returns `{ available: false }`. */
export function createUnavailableMock(
    fn?: MockFnFactory,
): MockSDKServiceResult {
    return createMockSDKService({ available: false }, fn);
}

/**
 * Mock where sendMessage invokes `onStreamingChunk` for each chunk
 * before resolving. The final response is the concatenation of all chunks.
 */
export function createStreamingMock(
    chunks: string[],
    fn?: MockFnFactory,
): MockSDKServiceResult {
    const result = createMockSDKService(undefined, fn);
    const fullResponse = chunks.join('');

    const streamingImpl = async (...args: unknown[]) => {
        const options = args[1] as { onStreamingChunk?: (chunk: string) => void } | undefined;
        if (options?.onStreamingChunk) {
            for (const chunk of chunks) {
                options.onStreamingChunk(chunk);
            }
        }
        return { success: true, response: fullResponse, sessionId: 'session-streaming' };
    };

    result.mockSendMessage.mockImplementation(streamingImpl);
    return result;
}

/** Mock where sendMessage resolves with `{ success: false, error }`. */
export function createFailingMock(
    error: string,
    fn?: MockFnFactory,
): MockSDKServiceResult {
    return createMockSDKService(
        { sendMessageResponse: { success: false, error } },
        fn,
    );
}
