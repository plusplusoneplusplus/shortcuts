/**
 * Shared mock factories for CopilotSDKService (as exposed via sdkServiceRegistry.getOrThrow())
 * and QueueExecutorBridge.
 *
 * Consolidates duplicated mock setup from:
 *   - test/server/queue-executor-bridge.test.ts
 *   - test/server/executor-session-tracking.test.ts
 *   - test/server/follow-up-api.test.ts
 */

import { vi } from 'vitest';
import type { QueueExecutorBridge } from '../../src/server/queue/queue-executor-bridge';

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

/** Shape of the mock SDK service returned by sdkServiceRegistry.getOrThrow() */
export interface MockCopilotSDKService {
    sendMessage: ReturnType<typeof vi.fn>;
    isAvailable: ReturnType<typeof vi.fn>;
    createClient: ReturnType<typeof vi.fn>;
    transform: ReturnType<typeof vi.fn>;
    abortSession: ReturnType<typeof vi.fn>;
    steerSession: ReturnType<typeof vi.fn>;
}

/** Configuration for SDK service mock behavior */
export interface MockSDKServiceOptions {
    /** Default availability result. Default: { available: true } */
    available?: boolean;
    /** Default sendMessage response */
    sendMessageResponse?: {
        success: boolean;
        response?: string;
        error?: string;
        sessionId?: string;
    };
}

/** Return type from createMockSDKService() with reset helper */
export interface MockSDKServiceResult {
    service: MockCopilotSDKService;
    mockSendMessage: ReturnType<typeof vi.fn>;
    mockTitleSendMessage: ReturnType<typeof vi.fn>;
    mockIsAvailable: ReturnType<typeof vi.fn>;
    mockCreateClient: ReturnType<typeof vi.fn>;
    mockTransform: ReturnType<typeof vi.fn>;
    mockAbortSession: ReturnType<typeof vi.fn>;
    mockSteerSession: ReturnType<typeof vi.fn>;
    /** Reset all mocks to their initial configured state */
    resetAll: () => void;
}

// ---------------------------------------------------------------------------
// Factory Functions
// ---------------------------------------------------------------------------

/**
 * Creates a mock CopilotSDKService with configurable default behaviors.
 *
 * Default behavior (no options):
 * - isAvailable → { available: true }
 * - sendMessage → { success: true, response: 'AI response text', sessionId: 'session-123' }
 * - sendFollowUp → { success: true, response: 'Follow-up response', sessionId: 'sess-follow' }
 * - hasKeptAliveSession → true
 * - canResumeSession → true
 */
export function createMockSDKService(options?: MockSDKServiceOptions): MockSDKServiceResult {
    const availableResult = { available: options?.available ?? true };
    const sendMessageResponse = options?.sendMessageResponse ?? {
        success: true,
        response: 'AI response text',
        sessionId: 'session-123',
    };

    const mockSendMessage = vi.fn().mockResolvedValue(sendMessageResponse);
    const mockTitleSendMessage = vi.fn().mockResolvedValue({ success: true, response: 'Generated Title', sessionId: 'title-session' });
    const sendMessageRouter = vi.fn((messageOptions: any) => {
        if (typeof messageOptions?.prompt === 'string' && messageOptions.prompt.startsWith('Summarise the following conversation')) {
            return mockTitleSendMessage(messageOptions);
        }
        return mockSendMessage(messageOptions);
    });
    const mockIsAvailable = vi.fn().mockResolvedValue(availableResult);
    const mockCreateClient = vi.fn().mockResolvedValue({ __mockClient: true });
    const mockTransform = vi.fn().mockResolvedValue('Generated Title');
    const mockAbortSession = vi.fn().mockResolvedValue(true);
    const mockSteerSession = vi.fn().mockResolvedValue(true);

    const service: MockCopilotSDKService = {
        sendMessage: sendMessageRouter,
        isAvailable: mockIsAvailable,
        createClient: mockCreateClient,
        transform: mockTransform,
        abortSession: mockAbortSession,
        steerSession: mockSteerSession,
    };

    const resetAll = () => {
        mockSendMessage.mockReset().mockResolvedValue(sendMessageResponse);
        mockTitleSendMessage.mockReset().mockResolvedValue({ success: true, response: 'Generated Title', sessionId: 'title-session' });
        sendMessageRouter.mockReset().mockImplementation((messageOptions: any) => {
            if (typeof messageOptions?.prompt === 'string' && messageOptions.prompt.startsWith('Summarise the following conversation')) {
                return mockTitleSendMessage(messageOptions);
            }
            return mockSendMessage(messageOptions);
        });
        mockIsAvailable.mockReset().mockResolvedValue(availableResult);
        mockCreateClient.mockReset().mockResolvedValue({ __mockClient: true });
        mockTransform.mockReset().mockResolvedValue('Generated Title');
        mockAbortSession.mockReset().mockResolvedValue(true);
        mockSteerSession.mockReset().mockResolvedValue(true);
    };

    return {
        service,
        mockSendMessage,
        mockTitleSendMessage,
        mockIsAvailable,
        mockCreateClient,
        mockTransform,
        mockAbortSession,
        mockSteerSession,
        resetAll,
    };
}

/**
 * Creates a mock QueueExecutorBridge with default implementations.
 * - executeFollowUp → vi.fn().mockResolvedValue(undefined)
 * - isSessionAlive → vi.fn().mockResolvedValue(true)
 * - enqueue → vi.fn().mockResolvedValue('mock-task-id')
 * - requeueForFollowUp → vi.fn().mockResolvedValue(undefined)
 * - cancelProcess → vi.fn().mockResolvedValue(undefined)
 */
export function createMockBridge(overrides?: Partial<QueueExecutorBridge>): QueueExecutorBridge {
    return {
        executeFollowUp: overrides?.executeFollowUp ?? vi.fn().mockResolvedValue(undefined),
        isSessionAlive: overrides?.isSessionAlive ?? vi.fn().mockResolvedValue(true),
        enqueue: overrides?.enqueue ?? vi.fn().mockResolvedValue('mock-task-id'),
        cancelProcess: overrides?.cancelProcess ?? vi.fn().mockResolvedValue(undefined),
        steerProcess: overrides?.steerProcess ?? vi.fn().mockResolvedValue(true),
        getTask: overrides?.getTask ?? vi.fn().mockReturnValue(undefined),
    };
}

// ---------------------------------------------------------------------------
// Preset Factory Functions
// ---------------------------------------------------------------------------

/** Mock where isAvailable returns { available: false }. Useful for SDK unavailability paths. */
export function createUnavailableMock(): MockSDKServiceResult {
    return createMockSDKService({ available: false });
}

/**
 * Mock where sendMessage and sendFollowUp invoke onStreamingChunk for each chunk
 * before resolving. The final response is the concatenation of all chunks.
 */
export function createStreamingMock(chunks: string[]): MockSDKServiceResult {
    const result = createMockSDKService();
    const fullResponse = chunks.join('');

    const streamingImpl = async (_prompt: string, options?: any) => {
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

/** Mock where sendMessage resolves with { success: false, error }. */
export function createFailingMock(error: string): MockSDKServiceResult {
    return createMockSDKService({
        sendMessageResponse: { success: false, error },
    });
}

/** Bridge where isSessionAlive resolves to false. Used for 410 test cases. */
export function createExpiredSessionBridge(): QueueExecutorBridge {
    return createMockBridge({
        isSessionAlive: vi.fn().mockResolvedValue(false),
    });
}
