/**
 * Tests for useTaskSearch — debounced search across task tree.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useTaskSearch } from '../../../../src/server/spa/client/react/tasks/hooks/useTaskSearch';
import type { TaskFolder } from '../../../../src/server/spa/client/react/tasks/hooks/useTaskTree';

function makeTree(overrides: Partial<TaskFolder> = {}): TaskFolder {
    return {
        name: 'root',
        relativePath: '',
        children: [],
        documentGroups: [],
        singleDocuments: [],
        ...overrides,
    };
}

describe('useTaskSearch', () => {
    beforeEach(() => { vi.useFakeTimers(); });
    afterEach(() => {
        vi.useRealTimers();
        document.body.innerHTML = '';
    });

    // The scoped find/Escape handlers only fire while the panel container is
    // mounted and visible. jsdom reports offsetParent === null for everything,
    // so mount a container and force a truthy offsetParent to emulate a visible
    // panel.
    function attachVisibleContainer(containerRef: { current: HTMLElement | null }) {
        const el = document.createElement('div');
        Object.defineProperty(el, 'offsetParent', { get: () => document.body, configurable: true });
        document.body.appendChild(el);
        containerRef.current = el;
        return el;
    }

    it('starts with empty searchInput and searchQuery', () => {
        const { result } = renderHook(() => useTaskSearch(null));
        expect(result.current.searchInput).toBe('');
        expect(result.current.searchQuery).toBe('');
    });

    it('returns empty searchResults when tree is null', () => {
        const { result } = renderHook(() => useTaskSearch(null));
        expect(result.current.searchResults).toEqual([]);
    });

    it('updates searchInput immediately on onSearchChange', () => {
        const { result } = renderHook(() => useTaskSearch(makeTree()));
        act(() => { result.current.onSearchChange('hello'); });
        expect(result.current.searchInput).toBe('hello');
    });

    it('debounces searchQuery by 150ms', () => {
        const { result } = renderHook(() => useTaskSearch(makeTree()));
        act(() => { result.current.onSearchChange('hello'); });
        expect(result.current.searchQuery).toBe(''); // not yet committed

        act(() => { vi.advanceTimersByTime(150); });
        expect(result.current.searchQuery).toBe('hello');
    });

    it('does not update searchQuery before debounce fires', () => {
        const { result } = renderHook(() => useTaskSearch(makeTree()));
        act(() => { result.current.onSearchChange('partial'); });
        act(() => { vi.advanceTimersByTime(100); });
        expect(result.current.searchQuery).toBe('');
    });

    it('cancels previous debounce when input changes rapidly', () => {
        const { result } = renderHook(() => useTaskSearch(makeTree()));
        act(() => { result.current.onSearchChange('abc'); });
        act(() => { vi.advanceTimersByTime(100); });
        act(() => { result.current.onSearchChange('abcd'); });
        act(() => { vi.advanceTimersByTime(150); });
        // Only the last value should be committed
        expect(result.current.searchQuery).toBe('abcd');
    });

    it('onSearchClear resets both input and query immediately', () => {
        const { result } = renderHook(() => useTaskSearch(makeTree()));
        act(() => { result.current.onSearchChange('hello'); });
        act(() => { vi.advanceTimersByTime(150); });
        expect(result.current.searchQuery).toBe('hello');

        act(() => { result.current.onSearchClear(); });
        expect(result.current.searchInput).toBe('');
        expect(result.current.searchQuery).toBe('');
    });

    it('returns all items sorted when searchQuery is empty', () => {
        const tree = makeTree({
            singleDocuments: [
                { baseName: 'beta', fileName: 'beta.md', isArchived: false },
                { baseName: 'alpha', fileName: 'alpha.md', isArchived: false },
            ],
        });
        const { result } = renderHook(() => useTaskSearch(tree));
        act(() => { vi.advanceTimersByTime(200); });
        const names = result.current.searchResults.map(r => r.baseName);
        expect(names).toEqual(['alpha', 'beta']);
    });

    it('filters searchResults to match query string', () => {
        const tree = makeTree({
            singleDocuments: [
                { baseName: 'alpha-spec', fileName: 'alpha-spec.md', isArchived: false },
                { baseName: 'beta-plan', fileName: 'beta-plan.md', isArchived: false },
            ],
        });
        const { result } = renderHook(() => useTaskSearch(tree));

        act(() => { result.current.onSearchChange('alpha'); });
        act(() => { vi.advanceTimersByTime(150); });

        expect(result.current.searchResults).toHaveLength(1);
        expect(result.current.searchResults[0].baseName).toBe('alpha-spec');
    });

    it('exposes searchInputRef', () => {
        const { result } = renderHook(() => useTaskSearch(null));
        expect(result.current.searchInputRef).toBeDefined();
    });

    it('Escape key clears search when there is an active query', () => {
        const { result } = renderHook(() => useTaskSearch(makeTree()));
        act(() => { attachVisibleContainer(result.current.containerRef); });
        act(() => { result.current.onSearchChange('test'); });
        act(() => { vi.advanceTimersByTime(150); });
        expect(result.current.searchQuery).toBe('test');

        act(() => {
            document.dispatchEvent(
                new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
            );
        });
        expect(result.current.searchInput).toBe('');
        expect(result.current.searchQuery).toBe('');
    });

    it('Escape does nothing while the panel container is hidden', () => {
        const { result } = renderHook(() => useTaskSearch(makeTree()));
        // No visible container attached → container.offsetParent === null.
        act(() => { result.current.onSearchChange('test'); });
        act(() => { vi.advanceTimersByTime(150); });
        expect(result.current.searchQuery).toBe('test');

        act(() => {
            document.dispatchEvent(
                new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
            );
        });
        // Hidden panel must not clear its search.
        expect(result.current.searchQuery).toBe('test');
    });

    it('Ctrl+F does not focus search when isPreviewOpen is true', () => {
        const { result } = renderHook(() => useTaskSearch(makeTree(), { isPreviewOpen: true }));
        act(() => { attachVisibleContainer(result.current.containerRef); });
        const focusSpy = vi.fn();
        Object.defineProperty(result.current.searchInputRef, 'current', {
            value: { focus: focusSpy, blur: vi.fn() },
            writable: true,
        });

        const event = new KeyboardEvent('keydown', { key: 'f', ctrlKey: true, bubbles: true, cancelable: true });
        const preventSpy = vi.spyOn(event, 'preventDefault');

        act(() => { document.dispatchEvent(event); });

        expect(focusSpy).not.toHaveBeenCalled();
        expect(preventSpy).not.toHaveBeenCalled();
    });

    it('Ctrl+F focuses search when isPreviewOpen is false', () => {
        const { result } = renderHook(() => useTaskSearch(makeTree(), { isPreviewOpen: false }));
        act(() => { attachVisibleContainer(result.current.containerRef); });
        const focusSpy = vi.fn();
        Object.defineProperty(result.current.searchInputRef, 'current', {
            value: { focus: focusSpy, blur: vi.fn() },
            writable: true,
        });

        const event = new KeyboardEvent('keydown', { key: 'f', ctrlKey: true, bubbles: true, cancelable: true });

        act(() => { document.dispatchEvent(event); });

        expect(focusSpy).toHaveBeenCalled();
    });

    it('Ctrl+F does not focus search while the panel container is hidden', () => {
        const { result } = renderHook(() => useTaskSearch(makeTree(), { isPreviewOpen: false }));
        // No visible container attached.
        const focusSpy = vi.fn();
        Object.defineProperty(result.current.searchInputRef, 'current', {
            value: { focus: focusSpy, blur: vi.fn() },
            writable: true,
        });

        const event = new KeyboardEvent('keydown', { key: 'f', ctrlKey: true, bubbles: true, cancelable: true });
        const preventSpy = vi.spyOn(event, 'preventDefault');

        act(() => { document.dispatchEvent(event); });

        expect(focusSpy).not.toHaveBeenCalled();
        expect(preventSpy).not.toHaveBeenCalled();
    });

    it('Escape still clears search when isPreviewOpen is true', () => {
        const { result } = renderHook(() => useTaskSearch(makeTree(), { isPreviewOpen: true }));
        act(() => { attachVisibleContainer(result.current.containerRef); });
        act(() => { result.current.onSearchChange('test'); });
        act(() => { vi.advanceTimersByTime(150); });
        expect(result.current.searchQuery).toBe('test');

        act(() => {
            document.dispatchEvent(
                new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
            );
        });
        expect(result.current.searchInput).toBe('');
        expect(result.current.searchQuery).toBe('');
    });

    it('exposes containerRef', () => {
        const { result } = renderHook(() => useTaskSearch(null));
        expect(result.current.containerRef).toBeDefined();
    });

    it('removes keydown listener on unmount', () => {
        const removeSpy = vi.spyOn(document, 'removeEventListener');
        const { unmount } = renderHook(() => useTaskSearch(null));
        unmount();
        expect(removeSpy).toHaveBeenCalledWith('keydown', expect.any(Function));
    });
});
