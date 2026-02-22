/**
 * Playwright-Compatible Mock AI Service for E2E Tests
 *
 * Provides a lightweight mock of CopilotSDKService that works in
 * Playwright tests (no Vitest dependency).  Exposes call tracking
 * and per-test override helpers (`mockResolvedValueOnce`, etc.).
 */

// ---------------------------------------------------------------------------
// Lightweight mock-function utility (Vitest-free)
// ---------------------------------------------------------------------------

export interface MockFn<TReturn = unknown> {
    (...args: unknown[]): TReturn;
    /** Accumulated call arguments */
    calls: unknown[][];
    /** Set the default resolved value (async functions) */
    mockResolvedValue(value: unknown): MockFn<TReturn>;
    /** Queue a one-shot resolved value */
    mockResolvedValueOnce(value: unknown): MockFn<TReturn>;
    /** Set the default implementation */
    mockImplementation(fn: (...args: unknown[]) => unknown): MockFn<TReturn>;
    /** Queue a one-shot implementation */
    mockImplementationOnce(fn: (...args: unknown[]) => unknown): MockFn<TReturn>;
    /** Reset to the initial configured state */
    mockReset(): MockFn<TReturn>;
}

function createMockFn<TReturn = unknown>(defaultImpl: (...args: unknown[]) => TReturn): MockFn<TReturn> {
    const initialImpl = defaultImpl;
    let currentImpl = defaultImpl;
    const onceQueue: Array<(...args: unknown[]) => unknown> = [];

    const fn = ((...args: unknown[]) => {
        fn.calls.push(args);
        if (onceQueue.length > 0) {
            return onceQueue.shift()!(...args);
        }
        return currentImpl(...args);
    }) as MockFn<TReturn>;

    fn.calls = [];

    fn.mockResolvedValue = (value: unknown) => {
        currentImpl = (() => Promise.resolve(value)) as () => TReturn;
        return fn;
    };

    fn.mockResolvedValueOnce = (value: unknown) => {
        onceQueue.push(() => Promise.resolve(value));
        return fn;
    };

    fn.mockImplementation = (impl: (...args: unknown[]) => unknown) => {
        currentImpl = impl as (...args: unknown[]) => TReturn;
        return fn;
    };

    fn.mockImplementationOnce = (impl: (...args: unknown[]) => unknown) => {
        onceQueue.push(impl);
        return fn;
    };

    fn.mockReset = () => {
        fn.calls = [];
        onceQueue.length = 0;
        currentImpl = initialImpl;
        return fn;
    };

    return fn;
}

// ---------------------------------------------------------------------------
// Mock Tool Event
// ---------------------------------------------------------------------------

export interface MockToolEvent {
    type: 'tool-start' | 'tool-complete' | 'tool-failed';
    toolCallId: string;
    toolName: string;
    parameters?: Record<string, unknown>;
    result?: string;
    error?: string;
    parentToolCallId?: string;
    /** Optional milliseconds to wait before firing this event */
    delayMsBefore?: number;
}

// ---------------------------------------------------------------------------
// Mock AI Service
// ---------------------------------------------------------------------------

export interface E2EMockAIControls {
    /** The mock service object injected into the server */
    service: Record<string, unknown>;
    /** Mock for sendMessage */
    mockSendMessage: MockFn;
    /** Mock for isAvailable */
    mockIsAvailable: MockFn;
    /** Mock for sendFollowUp */
    mockSendFollowUp: MockFn;
    /** Mock for hasKeptAliveSession */
    mockHasKeptAliveSession: MockFn;
    /** Mock for canResumeSession */
    mockCanResumeSession: MockFn;
    /** Reset all mocks to their default state */
    resetAll: () => void;
    /**
     * Returns a sendMessage/sendFollowUp implementation that calls
     * onStreamingChunk for each chunk with an optional inter-chunk delay,
     * then resolves with a success result.
     */
    createStreamingResponse(
        chunks: string[],
        options?: { delayMs?: number; finalResponse?: string; sessionId?: string },
    ): (...args: unknown[]) => Promise<unknown>;
    /**
     * Returns a sendMessage/sendFollowUp implementation that fires
     * onToolEvent for each MockToolEvent (with optional per-event delay),
     * then resolves with a success result.
     */
    createToolCallResponse(
        events: MockToolEvent[],
        options?: { finalResponse?: string; sessionId?: string },
    ): (...args: unknown[]) => Promise<unknown>;
}

export interface E2EMockAIOptions {
    available?: boolean;
    sendMessageResponse?: Record<string, unknown>;
    sendFollowUpResponse?: Record<string, unknown>;
    hasKeptAliveSession?: boolean;
    canResumeSession?: boolean;
}

/**
 * Creates a mock CopilotSDKService suitable for Playwright E2E tests.
 *
 * Defaults (no options):
 * - isAvailable → { available: true }
 * - sendMessage → { success: true, response: 'AI response text', sessionId: 'session-123' }
 * - sendFollowUp → { success: true, response: 'Follow-up response', sessionId: 'sess-follow' }
 * - hasKeptAliveSession → true
 * - canResumeSession → true
 */
export function createE2EMockSDKService(options?: E2EMockAIOptions): E2EMockAIControls {
    const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
    const defaultAvailability = { available: options?.available ?? true };
    const defaultSendMessage = options?.sendMessageResponse ?? {
        success: true,
        response: 'AI response text',
        sessionId: 'session-123',
    };
    const defaultSendFollowUp = options?.sendFollowUpResponse ?? {
        success: true,
        response: 'Follow-up response',
        sessionId: 'sess-follow',
    };
    const defaultHasKeptAlive = options?.hasKeptAliveSession ?? true;
    const defaultCanResume = options?.canResumeSession ?? defaultHasKeptAlive;

    const mockIsAvailable = createMockFn(() => Promise.resolve(defaultAvailability));
    const mockSendMessage = createMockFn(() => Promise.resolve(defaultSendMessage));
    const mockSendFollowUp = createMockFn(() => Promise.resolve(defaultSendFollowUp));
    const mockHasKeptAliveSession = createMockFn(() => defaultHasKeptAlive);
    const mockCanResumeSession = createMockFn(() => Promise.resolve(defaultCanResume));

    const service = {
        isAvailable: mockIsAvailable,
        sendMessage: mockSendMessage,
        sendFollowUp: mockSendFollowUp,
        hasKeptAliveSession: mockHasKeptAliveSession,
        canResumeSession: mockCanResumeSession,
        // Stubs for methods the executor may reference but doesn't critically need
        ensureClient: () => Promise.resolve(),
        destroyKeptAliveSession: () => Promise.resolve(),
        abortSession: () => {},
        hasActiveSession: () => false,
        getActiveSessionCount: () => 0,
        cleanup: () => Promise.resolve(),
        dispose: () => Promise.resolve(),
    };

    const resetAll = () => {
        mockIsAvailable.mockReset();
        mockSendMessage.mockReset();
        mockSendFollowUp.mockReset();
        mockHasKeptAliveSession.mockReset();
        mockCanResumeSession.mockReset();
    };

    function createStreamingResponse(
        chunks: string[],
        streamOpts?: { delayMs?: number; finalResponse?: string; sessionId?: string },
    ): (...args: unknown[]) => Promise<unknown> {
        return async (...args: unknown[]) => {
            // opts is first arg for sendMessage, third arg for sendFollowUp
            const opts = (args.length >= 3 ? args[2] : args[0]) as Record<string, unknown> | undefined;
            const onChunk = opts?.onStreamingChunk as ((chunk: string) => void) | undefined;
            const delayMs = streamOpts?.delayMs ?? 0;

            for (const chunk of chunks) {
                if (delayMs > 0) await sleep(delayMs);
                onChunk?.(chunk);
            }

            return {
                success: true,
                response: streamOpts?.finalResponse ?? chunks.join(''),
                sessionId: streamOpts?.sessionId ?? 'session-123',
            };
        };
    }

    function createToolCallResponse(
        events: MockToolEvent[],
        toolOpts?: { finalResponse?: string; sessionId?: string },
    ): (...args: unknown[]) => Promise<unknown> {
        return async (...args: unknown[]) => {
            const opts = (args.length >= 3 ? args[2] : args[0]) as Record<string, unknown> | undefined;
            const onEvent = opts?.onToolEvent as ((event: Record<string, unknown>) => void) | undefined;

            for (const evt of events) {
                if (evt.delayMsBefore && evt.delayMsBefore > 0) await sleep(evt.delayMsBefore);
                const { delayMsBefore: _dropped, ...eventPayload } = evt;
                onEvent?.(eventPayload as Record<string, unknown>);
            }

            return {
                success: true,
                response: toolOpts?.finalResponse ?? '',
                sessionId: toolOpts?.sessionId ?? 'session-123',
            };
        };
    }

    return {
        service,
        mockSendMessage,
        mockIsAvailable,
        mockSendFollowUp,
        mockHasKeptAliveSession,
        mockCanResumeSession,
        resetAll,
        createStreamingResponse,
        createToolCallResponse,
    };
}
