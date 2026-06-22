/**
 * Playwright-Compatible Mock AI Service for E2E Tests
 *
 * Re-bases the e2e fixture onto the single canonical ISDKService mock
 * (`createMockSDKService` from `@plusplusoneplusplus/coc-agent-sdk/testing`).
 * The fixture no longer defines its own service object or mock-fn; it only
 * injects a background-aware mock-fn factory (so title / follow-up prompts don't
 * consume per-test one-shot overrides) and layers Playwright-specific streaming /
 * tool-call response builders on top.
 *
 * Vitest-free: the canonical mock accepts an injectable MockFnFactory, so this
 * fixture pulls in no test-runner dependency and works under Playwright.
 */

import {
    createMockSDKService,
    type MockSDKService,
    type MockFnHandle,
    type MockFnFactory,
} from '@plusplusoneplusplus/coc-agent-sdk/testing';
import type { IInvocationResult, ToolEvent } from '@plusplusoneplusplus/coc-agent-sdk';

// ---------------------------------------------------------------------------
// Background-aware mock-fn factory (Vitest-free)
// ---------------------------------------------------------------------------

/**
 * Recognize background/system AI prompts (title generation, follow-up
 * suggestions, etc.) so they don't consume per-test `mockImplementationOnce`
 * slots intended for primary user prompts. Background calls always fall
 * through to the default implementation.
 */
function isBackgroundPrompt(prompt: string | undefined): boolean {
    if (!prompt) return false;
    return (
        prompt.startsWith('Summarise the following conversation as a short title')
        || prompt.startsWith('Generate a title for:')
    );
}

/**
 * A `MockFnFactory` variant that skips the one-shot queue for background
 * prompts. Injected into `createMockSDKService` so the e2e fixture preserves its
 * background-aware override semantics while reusing the canonical service mock.
 *
 * `opts` is the first arg for `sendMessage(opts)` and the third for the
 * `sendFollowUp(sessionId, message, opts)` signature, matching the builders.
 */
const createBackgroundAwareMockFn: MockFnFactory = (defaultImpl) => {
    const initialImpl: (...args: unknown[]) => unknown = defaultImpl ?? (() => undefined);
    let currentImpl: (...args: unknown[]) => unknown = initialImpl;
    const onceQueue: Array<(...args: unknown[]) => unknown> = [];

    const fn = ((...args: unknown[]) => {
        fn.calls.push(args);
        const opts = (args.length >= 3 ? args[2] : args[0]) as
            | { prompt?: string }
            | undefined;
        const prompt = typeof opts?.prompt === 'string' ? opts.prompt : undefined;
        if (onceQueue.length > 0 && !isBackgroundPrompt(prompt)) {
            return onceQueue.shift()!(...args);
        }
        return currentImpl(...args);
    }) as MockFnHandle;

    fn.calls = [];

    fn.mockResolvedValue = (value: unknown) => {
        currentImpl = () => Promise.resolve(value);
        return fn;
    };

    fn.mockResolvedValueOnce = (value: unknown) => {
        onceQueue.push(() => Promise.resolve(value));
        return fn;
    };

    fn.mockImplementation = (impl: (...args: unknown[]) => unknown) => {
        currentImpl = impl;
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
};

// ---------------------------------------------------------------------------
// Chunk Gate (for intermediate streaming verification)
// ---------------------------------------------------------------------------

export interface ChunkGate {
    /**
     * Unblocks the next pending chunk, then yields so onStreamingChunk fires
     * before returning. The Playwright expect() timeout handles SSE propagation.
     */
    releaseNext(): Promise<void>;
    /** Release all remaining chunks at once (cleanup / error paths). */
    releaseAll(): void;
    /** Number of chunks released so far. */
    readonly released: number;
}

// ---------------------------------------------------------------------------
// Mock Tool Event
// ---------------------------------------------------------------------------

/**
 * A unified-seam `ToolEvent` plus an optional pre-fire delay. Aliasing the SDK
 * `ToolEvent` (rather than re-declaring its shape) keeps this fixture in lockstep
 * with the real `onToolEvent` channel and lets `createToolCallResponse` accept
 * the `createSubAgentToolEvents(...)` producer output directly — a `ToolEvent[]`
 * is assignable here because `delayMsBefore` is optional.
 */
export type MockToolEvent = ToolEvent & {
    /** Optional milliseconds to wait before firing this event */
    delayMsBefore?: number;
};

// ---------------------------------------------------------------------------
// Mock AI Service
// ---------------------------------------------------------------------------

export interface E2EMockAIControls {
    /** The mock service object injected into the server (full ISDKService). */
    service: MockSDKService;
    /** Mock for sendMessage */
    mockSendMessage: MockFnHandle;
    /** Mock for isAvailable */
    mockIsAvailable: MockFnHandle;
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
    /**
     * Returns a gated streaming implementation where each chunk is held
     * until the test explicitly calls `gate.releaseNext()`. This allows
     * asserting exact DOM state after each individual chunk.
     */
    createGatedStreamingResponse(
        chunks: string[],
        options?: { finalResponse?: string; sessionId?: string },
    ): { implementation: (...args: unknown[]) => Promise<unknown>; gate: ChunkGate };
}

export interface E2EMockAIOptions {
    available?: boolean;
    sendMessageResponse?: Record<string, unknown>;
}

/**
 * Creates a mock CopilotSDKService suitable for Playwright E2E tests, backed by
 * the canonical `createMockSDKService` ISDKService mock.
 *
 * Defaults (no options):
 * - isAvailable → { available: true }
 * - sendMessage → { success: true, response: 'AI response text', sessionId: 'session-123' }
 *
 * Title generation no longer flows through sendMessage: TitleGenerationService
 * (and its prewarm) route through the SDK `transform` boundary, which the
 * canonical mock serves from its default transform handle (returning
 * `{ success: true, text: 'Generated Title', effectiveModel: 'gpt-5.4-mini' }`).
 * The background-prompt guard below remains so that any residual title/follow-up
 * prompt reaching sendMessage still skips queued one-shot overrides intended for
 * primary user prompts; the canonical mock also keeps a legacy sendMessage title
 * route for backward compatibility.
 */
export function createE2EMockSDKService(options?: E2EMockAIOptions): E2EMockAIControls {
    const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

    const base = createMockSDKService(
        {
            available: options?.available,
            sendMessageResponse: options?.sendMessageResponse as IInvocationResult | undefined,
        },
        createBackgroundAwareMockFn,
    );

    // Preserve the historical e2e contract: a no-op warm client (resolving to
    // `undefined`) disables the autocomplete prewarm path
    // (`PromptAutocompleteService.prewarm`), so its background
    // "Reply with JSON only" sendMessage call never fires during e2e and per-task
    // call counts stay deterministic. The canonical mock's default createClient
    // resolves truthy, which would otherwise enable prewarm.
    base.service.createClient = () => Promise.resolve(undefined);

    let activeGate: ChunkGate | null = null;

    const resetAll = () => {
        activeGate?.releaseAll();
        activeGate = null;
        base.resetAll();
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

    function createGatedStreamingResponse(
        chunks: string[],
        gatedOpts?: { finalResponse?: string; sessionId?: string },
    ): { implementation: (...args: unknown[]) => Promise<unknown>; gate: ChunkGate } {
        const gates = chunks.map(() => {
            let resolve!: () => void;
            const promise = new Promise<void>((r) => { resolve = r; });
            return { promise, resolve };
        });
        let releasedCount = 0;

        const implementation = async (...args: unknown[]) => {
            const opts = (args.length >= 3 ? args[2] : args[0]) as Record<string, unknown> | undefined;
            const onChunk = opts?.onStreamingChunk as ((chunk: string) => void) | undefined;

            for (let i = 0; i < chunks.length; i++) {
                await gates[i].promise;
                onChunk?.(chunks[i]);
            }

            return {
                success: true,
                response: gatedOpts?.finalResponse ?? chunks.join(''),
                sessionId: gatedOpts?.sessionId ?? 'session-123',
            };
        };

        const gate: ChunkGate = {
            releaseNext: async () => {
                if (releasedCount < gates.length) {
                    gates[releasedCount].resolve();
                    releasedCount++;
                    await sleep(0);
                }
            },
            releaseAll: () => {
                for (let i = releasedCount; i < gates.length; i++) {
                    gates[i].resolve();
                }
                releasedCount = gates.length;
            },
            get released() { return releasedCount; },
        };

        activeGate = gate;
        return { implementation, gate };
    }

    return {
        service: base.service,
        mockSendMessage: base.mockSendMessage,
        mockIsAvailable: base.mockIsAvailable,
        resetAll,
        createStreamingResponse,
        createToolCallResponse,
        createGatedStreamingResponse,
    };
}
