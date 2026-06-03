/**
 * Lightweight mock-function utility — vitest-free.
 *
 * Modelled on the e2e `MockFn` pattern from `packages/coc/test/e2e/fixtures/mock-ai.ts`.
 * Consumers inject `vi.fn` (or any other spy factory) via the `fn` parameter of
 * `createMockSDKService`; the default shim here keeps the package usable standalone.
 */

export interface MockFnHandle<TReturn = unknown> {
    (...args: unknown[]): TReturn;
    calls: unknown[][];
    mockResolvedValue(value: unknown): MockFnHandle<TReturn>;
    mockResolvedValueOnce(value: unknown): MockFnHandle<TReturn>;
    mockImplementation(fn: (...args: unknown[]) => unknown): MockFnHandle<TReturn>;
    mockImplementationOnce(fn: (...args: unknown[]) => unknown): MockFnHandle<TReturn>;
    mockReset(): MockFnHandle<TReturn>;
}

export type MockFnFactory = (impl?: (...args: any[]) => any) => MockFnHandle;

export function createDefaultMockFn(defaultImpl?: (...args: any[]) => any): MockFnHandle {
    const initialImpl = defaultImpl ?? (() => undefined);
    let currentImpl: (...args: unknown[]) => unknown = initialImpl;
    const onceQueue: Array<(...args: unknown[]) => unknown> = [];

    const fn = ((...args: unknown[]) => {
        fn.calls.push(args);
        if (onceQueue.length > 0) {
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
}
