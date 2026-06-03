/**
 * Thin wrapper around the shared `@plusplusoneplusplus/coc-agent-sdk/testing`
 * mock, binding `vi.fn` so all mock handles are real vitest spies.
 *
 * The import path (`../helpers/mock-sdk-service`) is preserved — no callers
 * need updating.
 */

import { vi } from 'vitest';
import {
    createMockSDKService as _createMockSDKService,
    createUnavailableMock as _createUnavailableMock,
    createStreamingMock as _createStreamingMock,
    createFailingMock as _createFailingMock,
    createMockBridge as _createMockBridge,
    createExpiredSessionBridge as _createExpiredSessionBridge,
} from '@plusplusoneplusplus/coc-agent-sdk/testing';
import type {
    MockSDKServiceOptions,
    MockSDKServiceResult,
    MockSDKService,
    MockFnFactory,
} from '@plusplusoneplusplus/coc-agent-sdk/testing';
import type { QueueExecutorBridge } from '../../src/server/queue/queue-executor-bridge';

// ---------------------------------------------------------------------------
// vitest-backed mock-fn factory
// ---------------------------------------------------------------------------

const viFnFactory: MockFnFactory = (impl) => {
    const spy = impl ? vi.fn(impl) : vi.fn();
    // Attach the MockFnHandle API on top of vitest's Mock so the shared mock
    // can drive it without importing vitest.
    const handle = spy as any;
    handle.calls = spy.mock.calls;

    const origMRV = spy.mockResolvedValue.bind(spy);
    handle.mockResolvedValue = (v: unknown) => { origMRV(v); return handle; };

    const origMRVO = spy.mockResolvedValueOnce.bind(spy);
    handle.mockResolvedValueOnce = (v: unknown) => { origMRVO(v); return handle; };

    const origMI = spy.mockImplementation.bind(spy);
    handle.mockImplementation = (fn: (...a: unknown[]) => unknown) => { origMI(fn); return handle; };

    const origMIO = spy.mockImplementationOnce.bind(spy);
    handle.mockImplementationOnce = (fn: (...a: unknown[]) => unknown) => { origMIO(fn); return handle; };

    const origReset = spy.mockReset.bind(spy);
    handle.mockReset = () => {
        origReset();
        handle.calls = spy.mock.calls;
        return handle;
    };

    return handle;
};

// ---------------------------------------------------------------------------
// Re-export types for backward compat
// ---------------------------------------------------------------------------

/** @deprecated Use `MockSDKService` from `@plusplusoneplusplus/coc-agent-sdk/testing` */
export type MockCopilotSDKService = MockSDKService;

export type { MockSDKServiceOptions, MockSDKServiceResult };

// ---------------------------------------------------------------------------
// Factory wrappers (inject vi.fn)
// ---------------------------------------------------------------------------

export function createMockSDKService(options?: MockSDKServiceOptions): MockSDKServiceResult {
    return _createMockSDKService(options, viFnFactory);
}

export function createUnavailableMock(): MockSDKServiceResult {
    return _createUnavailableMock(viFnFactory);
}

export function createStreamingMock(chunks: string[]): MockSDKServiceResult {
    return _createStreamingMock(chunks, viFnFactory);
}

export function createFailingMock(error: string): MockSDKServiceResult {
    return _createFailingMock(error, viFnFactory);
}

// ---------------------------------------------------------------------------
// Bridge helpers
// ---------------------------------------------------------------------------

export function createMockBridge(overrides?: Partial<QueueExecutorBridge>): QueueExecutorBridge {
    return _createMockBridge(overrides as any, viFnFactory) as unknown as QueueExecutorBridge;
}

export function createExpiredSessionBridge(): QueueExecutorBridge {
    return _createExpiredSessionBridge(viFnFactory) as unknown as QueueExecutorBridge;
}
