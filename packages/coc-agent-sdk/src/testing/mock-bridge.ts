/**
 * Shared mock for QueueExecutorBridge — vitest-free.
 *
 * The bridge type is defined in coc, not here. We use a structural type that
 * matches the QueueExecutorBridge interface so consumers can cast to their
 * local import.
 */

import type { MockFnHandle, MockFnFactory } from './mock-fn';
import { createDefaultMockFn } from './mock-fn';

export interface MockBridge {
    executeFollowUp: MockFnHandle;
    isSessionAlive: MockFnHandle;
    enqueue: MockFnHandle;
    cancelProcess: MockFnHandle;
    steerProcess: MockFnHandle;
    getTask: MockFnHandle;
}

export function createMockBridge(
    overrides?: Partial<Record<keyof MockBridge, unknown>>,
    fn: MockFnFactory = createDefaultMockFn,
): MockBridge {
    return {
        executeFollowUp: (overrides?.executeFollowUp ?? fn(() => Promise.resolve(undefined))) as MockFnHandle,
        isSessionAlive: (overrides?.isSessionAlive ?? fn(() => Promise.resolve(true))) as MockFnHandle,
        enqueue: (overrides?.enqueue ?? fn(() => Promise.resolve('mock-task-id'))) as MockFnHandle,
        cancelProcess: (overrides?.cancelProcess ?? fn(() => Promise.resolve(undefined))) as MockFnHandle,
        steerProcess: (overrides?.steerProcess ?? fn(() => Promise.resolve(true))) as MockFnHandle,
        getTask: (overrides?.getTask ?? fn(() => undefined)) as MockFnHandle,
    };
}

/** Bridge where isSessionAlive resolves to false. Used for 410 test cases. */
export function createExpiredSessionBridge(
    fn: MockFnFactory = createDefaultMockFn,
): MockBridge {
    return createMockBridge(
        { isSessionAlive: fn(() => Promise.resolve(false)) },
        fn,
    );
}
