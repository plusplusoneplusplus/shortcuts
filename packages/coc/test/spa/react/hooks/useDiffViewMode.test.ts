/**
 * Tests for useDiffViewMode — localStorage-backed diff view mode persistence.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useDiffViewMode } from '../../../../src/server/spa/client/react/hooks/useDiffViewMode';

// ---------------------------------------------------------------------------
// localStorage mock helpers
// ---------------------------------------------------------------------------

function makeMockStorage(): Storage {
    let store: Record<string, string> = {};
    return {
        getItem: (key: string) => store[key] ?? null,
        setItem: (key: string, value: string) => { store[key] = value; },
        removeItem: (key: string) => { delete store[key]; },
        clear: () => { store = {}; },
        get length() { return Object.keys(store).length; },
        key: (i: number) => Object.keys(store)[i] ?? null,
    } as Storage;
}

const STORAGE_KEY = 'coc-diff-view-mode';

describe('useDiffViewMode', () => {
    let mockStorage: Storage;

    beforeEach(() => {
        mockStorage = makeMockStorage();
        vi.spyOn(Storage.prototype, 'getItem').mockImplementation((...args) => mockStorage.getItem(...args));
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation((...args) => mockStorage.setItem(...args));
        vi.spyOn(Storage.prototype, 'removeItem').mockImplementation((...args) => mockStorage.removeItem(...args));
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('defaults to "unified" when localStorage is empty', () => {
        const { result } = renderHook(() => useDiffViewMode());
        expect(result.current[0]).toBe('unified');
    });

    it('reads "split" from localStorage on mount', () => {
        mockStorage.setItem(STORAGE_KEY, 'split');
        const { result } = renderHook(() => useDiffViewMode());
        expect(result.current[0]).toBe('split');
    });

    it('setMode updates state and persists to localStorage', () => {
        const { result } = renderHook(() => useDiffViewMode());
        act(() => { result.current[1]('split'); });
        expect(result.current[0]).toBe('split');
        expect(mockStorage.getItem(STORAGE_KEY)).toBe('split');
    });

    it('falls back to "unified" for corrupted / unknown stored value', () => {
        mockStorage.setItem(STORAGE_KEY, 'foobar');
        const { result } = renderHook(() => useDiffViewMode());
        expect(result.current[0]).toBe('unified');
    });

    it('cross-tab storage event with valid value updates state', () => {
        const { result } = renderHook(() => useDiffViewMode());
        act(() => {
            window.dispatchEvent(new StorageEvent('storage', {
                key: STORAGE_KEY,
                newValue: 'split',
            }));
        });
        expect(result.current[0]).toBe('split');
    });

    it('cross-tab storage event with unrelated key is ignored', () => {
        const { result } = renderHook(() => useDiffViewMode());
        act(() => {
            window.dispatchEvent(new StorageEvent('storage', {
                key: 'some-other-key',
                newValue: 'split',
            }));
        });
        expect(result.current[0]).toBe('unified');
    });

    it('cross-tab storage event with invalid value is ignored', () => {
        const { result } = renderHook(() => useDiffViewMode());
        act(() => {
            window.dispatchEvent(new StorageEvent('storage', {
                key: STORAGE_KEY,
                newValue: 'invalid',
            }));
        });
        expect(result.current[0]).toBe('unified');
    });
});
