/**
 * @vitest-environment jsdom
 *
 * Diff-engine preference (AC-04): localStorage first paint, server
 * reconciliation, local changes while the read is pending, failed writes and
 * cross-tab storage events.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, renderHook, waitFor, within } from '@testing-library/react';
import { createElement } from 'react';

const getGlobal = vi.fn();
const patchGlobal = vi.fn();
vi.mock('../../../../../src/server/spa/client/react/api/cocClient', () => ({
    getSpaCocClient: () => ({ preferences: { getGlobal, patchGlobal } }),
}));

import {
    DEFAULT_DIFF_ENGINE,
    DIFF_ENGINE_STORAGE_KEY,
    createDiffEngineStore,
    resolveDiffEngine,
    useDiffEngine,
    __resetDiffEngineForTesting,
    type DiffEngineStorage,
} from '../../../../../src/server/spa/client/react/features/git/hooks/useDiffEngine';
import { DiffEngineToggle } from '../../../../../src/server/spa/client/react/features/git/diff/DiffViewToggle';

function deferred<T>() {
    let resolve!: (v: T) => void;
    let reject!: (e: unknown) => void;
    const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
}

function memoryStorage(initial: Record<string, string> = {}): DiffEngineStorage & { data: Record<string, string> } {
    const data = { ...initial };
    return {
        data,
        getItem: (k) => (k in data ? data[k] : null),
        setItem: (k, v) => { data[k] = v; },
    };
}

beforeEach(() => {
    getGlobal.mockReset();
    patchGlobal.mockReset();
    patchGlobal.mockResolvedValue({});
    localStorage.clear();
    __resetDiffEngineForTesting();
});

afterEach(() => { vi.restoreAllMocks(); });

describe('resolveDiffEngine', () => {
    it('defaults to monaco for absent or unknown values', () => {
        expect(DEFAULT_DIFF_ENGINE).toBe('monaco');
        for (const v of [undefined, null, '', 'editor', 1, {}]) expect(resolveDiffEngine(v)).toBe('monaco');
        expect(resolveDiffEngine('monaco')).toBe('monaco');
        expect(resolveDiffEngine('legacy')).toBe('legacy');
    });
});

describe('createDiffEngineStore', () => {
    it('reads the cached engine synchronously at creation', () => {
        const storage = memoryStorage({ [DIFF_ENGINE_STORAGE_KEY]: 'monaco' });
        const store = createDiffEngineStore({ storage: () => storage, getGlobal, patchGlobal });
        expect(store.getSnapshot()).toBe('monaco');
        expect(getGlobal).not.toHaveBeenCalled();
    });

    it('uses monaco when no cache and storage throws', () => {
        const store = createDiffEngineStore({
            storage: () => ({ getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } }),
            getGlobal, patchGlobal,
        });
        expect(store.getSnapshot()).toBe('monaco');
        expect(() => store.set('legacy')).not.toThrow();
        expect(store.getSnapshot()).toBe('legacy');
    });

    it('lets the server value win over a stale cache and refreshes the cache', async () => {
        const storage = memoryStorage({ [DIFF_ENGINE_STORAGE_KEY]: 'legacy' });
        getGlobal.mockResolvedValue({ diffEngine: 'monaco' });
        const store = createDiffEngineStore({ storage: () => storage, getGlobal, patchGlobal });
        const listener = vi.fn();
        store.subscribe(listener);
        await store.reconcile();
        expect(store.getSnapshot()).toBe('monaco');
        expect(storage.data[DIFF_ENGINE_STORAGE_KEY]).toBe('monaco');
        expect(listener).toHaveBeenCalledTimes(1);
    });

    it('keeps the cached value when the server has no or an invalid diffEngine', async () => {
        const storage = memoryStorage({ [DIFF_ENGINE_STORAGE_KEY]: 'monaco' });
        getGlobal.mockResolvedValue({ diffEngine: 'bogus' });
        const store = createDiffEngineStore({ storage: () => storage, getGlobal, patchGlobal });
        await store.reconcile();
        expect(store.getSnapshot()).toBe('monaco');
    });

    it('keeps the local choice made while the server read is pending', async () => {
        const storage = memoryStorage();
        const pending = deferred<{ diffEngine: 'legacy' }>();
        getGlobal.mockReturnValue(pending.promise);
        const store = createDiffEngineStore({ storage: () => storage, getGlobal, patchGlobal });
        const done = store.reconcile();
        store.set('monaco');
        pending.resolve({ diffEngine: 'legacy' });
        await done;
        expect(store.getSnapshot()).toBe('monaco');
        expect(storage.data[DIFF_ENGINE_STORAGE_KEY]).toBe('monaco');
        expect(patchGlobal).toHaveBeenCalledWith({ diffEngine: 'monaco' });
    });

    it('reads the server only once per store', async () => {
        getGlobal.mockResolvedValue({});
        const store = createDiffEngineStore({ storage: () => memoryStorage(), getGlobal, patchGlobal });
        await Promise.all([store.reconcile(), store.reconcile()]);
        await store.reconcile();
        expect(getGlobal).toHaveBeenCalledTimes(1);
    });

    it('keeps the choice when the server read fails', async () => {
        const storage = memoryStorage({ [DIFF_ENGINE_STORAGE_KEY]: 'monaco' });
        getGlobal.mockRejectedValue(new Error('offline'));
        const store = createDiffEngineStore({ storage: () => storage, getGlobal, patchGlobal });
        await expect(store.reconcile()).resolves.toBeUndefined();
        expect(store.getSnapshot()).toBe('monaco');
    });

    it('keeps the local choice when the server write rejects, without an unhandled rejection', async () => {
        const unhandled = vi.fn();
        process.on('unhandledRejection', unhandled);
        try {
            const storage = memoryStorage();
            patchGlobal.mockRejectedValue(new Error('500'));
            const store = createDiffEngineStore({ storage: () => storage, getGlobal, patchGlobal });
            store.set('monaco');
            await new Promise(r => setTimeout(r, 0));
            expect(store.getSnapshot()).toBe('monaco');
            expect(storage.data[DIFF_ENGINE_STORAGE_KEY]).toBe('monaco');
            expect(unhandled).not.toHaveBeenCalled();
        } finally {
            process.off('unhandledRejection', unhandled);
        }
    });

    it('keeps the local choice when the server write throws synchronously', () => {
        patchGlobal.mockImplementation(() => { throw new Error('no client'); });
        const store = createDiffEngineStore({ storage: () => memoryStorage(), getGlobal, patchGlobal });
        expect(() => store.set('monaco')).not.toThrow();
        expect(store.getSnapshot()).toBe('monaco');
    });

    it('applies another tab\'s valid value and ignores invalid ones', () => {
        const store = createDiffEngineStore({ storage: () => memoryStorage(), getGlobal, patchGlobal });
        store.applyStorageValue('monaco');
        expect(store.getSnapshot()).toBe('monaco');
        store.applyStorageValue('garbage');
        store.applyStorageValue(null);
        expect(store.getSnapshot()).toBe('monaco');
        expect(patchGlobal).not.toHaveBeenCalled();
    });

    it('does not let a pending server read override another tab\'s newer choice', async () => {
        const pending = deferred<{ diffEngine: 'legacy' }>();
        getGlobal.mockReturnValue(pending.promise);
        const store = createDiffEngineStore({ storage: () => memoryStorage(), getGlobal, patchGlobal });
        const done = store.reconcile();
        store.applyStorageValue('monaco');
        pending.resolve({ diffEngine: 'legacy' });
        await done;
        expect(store.getSnapshot()).toBe('monaco');
    });
});

describe('useDiffEngine', () => {
    it('uses the cached Editor engine on the first render, before the server answers', () => {
        localStorage.setItem(DIFF_ENGINE_STORAGE_KEY, 'monaco');
        getGlobal.mockReturnValue(new Promise(() => {}));
        const seen: string[] = [];
        renderHook(() => { const [engine] = useDiffEngine(); seen.push(engine); });
        expect(seen[0]).toBe('monaco');
    });

    it('defaults to monaco with no cache and no server value', async () => {
        getGlobal.mockResolvedValue({});
        const { result } = renderHook(() => useDiffEngine());
        await act(async () => {});
        expect(result.current[0]).toBe('monaco');
    });

    it('reconciles to the server value', async () => {
        getGlobal.mockResolvedValue({ diffEngine: 'monaco' });
        const { result } = renderHook(() => useDiffEngine());
        await waitFor(() => expect(result.current[0]).toBe('monaco'));
        expect(localStorage.getItem(DIFF_ENGINE_STORAGE_KEY)).toBe('monaco');
    });

    it('shares one engine across hook instances and persists changes', async () => {
        localStorage.setItem(DIFF_ENGINE_STORAGE_KEY, 'legacy');
        getGlobal.mockResolvedValue({});
        const a = renderHook(() => useDiffEngine());
        const b = renderHook(() => useDiffEngine());
        await act(async () => { a.result.current[1]('monaco'); });
        expect(b.result.current[0]).toBe('monaco');
        expect(localStorage.getItem(DIFF_ENGINE_STORAGE_KEY)).toBe('monaco');
        expect(patchGlobal).toHaveBeenCalledWith({ diffEngine: 'monaco' });
        expect(getGlobal).toHaveBeenCalledTimes(1);
    });

    it('updates working-tree and FileDiffPanel controls together without a reload', async () => {
        localStorage.setItem(DIFF_ENGINE_STORAGE_KEY, 'legacy');
        getGlobal.mockResolvedValue({});

        function Surface({ testId }: { testId: string }) {
            const [engine, setEngine] = useDiffEngine();
            return createElement(
                'div',
                { 'data-testid': testId },
                createElement(DiffEngineToggle, { engine, onChange: setEngine }),
            );
        }

        const view = render(createElement(
            'div',
            null,
            createElement(Surface, { testId: 'working-tree-engine' }),
            createElement(Surface, { testId: 'file-diff-panel-engine' }),
        ),
        );
        const workingTree = within(view.getByTestId('working-tree-engine'));
        const filePanel = within(view.getByTestId('file-diff-panel-engine'));

        expect(workingTree.getByTestId('diff-engine-toggle').getAttribute('data-value')).toBe('legacy');
        fireEvent.click(filePanel.getByTestId('diff-engine-toggle'));
        expect(workingTree.getByTestId('diff-engine-toggle').getAttribute('data-value')).toBe('monaco');

        fireEvent.click(workingTree.getByTestId('diff-engine-toggle'));
        expect(filePanel.getByTestId('diff-engine-toggle').getAttribute('data-value')).toBe('legacy');
        expect(patchGlobal).toHaveBeenNthCalledWith(1, { diffEngine: 'monaco' });
        expect(patchGlobal).toHaveBeenNthCalledWith(2, { diffEngine: 'legacy' });
    });

    it('follows a storage event from another tab', async () => {
        getGlobal.mockResolvedValue({});
        const { result } = renderHook(() => useDiffEngine());
        await act(async () => {});
        act(() => {
            window.dispatchEvent(new StorageEvent('storage', { key: DIFF_ENGINE_STORAGE_KEY, newValue: 'monaco' }));
        });
        expect(result.current[0]).toBe('monaco');
        act(() => {
            window.dispatchEvent(new StorageEvent('storage', { key: 'other-key', newValue: 'legacy' }));
        });
        expect(result.current[0]).toBe('monaco');
    });
});
