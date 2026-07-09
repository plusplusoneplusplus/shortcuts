/**
 * Tests for useWorkItemSearch — debounced search input and keyboard shortcuts for work items.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useWorkItemSearch } from '../../../../src/server/spa/client/react/features/work-items/hooks/useWorkItemSearch';

describe('useWorkItemSearch', () => {
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
        const { result } = renderHook(() => useWorkItemSearch());
        expect(result.current.searchInput).toBe('');
        expect(result.current.searchQuery).toBe('');
    });

    it('updates searchInput immediately on onSearchChange', () => {
        const { result } = renderHook(() => useWorkItemSearch());
        act(() => { result.current.onSearchChange('test'); });
        expect(result.current.searchInput).toBe('test');
    });

    it('debounces searchQuery by 150ms', () => {
        const { result } = renderHook(() => useWorkItemSearch());
        act(() => { result.current.onSearchChange('test'); });
        expect(result.current.searchQuery).toBe(''); // not yet committed

        act(() => { vi.advanceTimersByTime(150); });
        expect(result.current.searchQuery).toBe('test');
    });

    it('does not update searchQuery before debounce fires', () => {
        const { result } = renderHook(() => useWorkItemSearch());
        act(() => { result.current.onSearchChange('partial'); });
        act(() => { vi.advanceTimersByTime(100); });
        expect(result.current.searchQuery).toBe('');
    });

    it('cancels previous debounce when input changes rapidly', () => {
        const { result } = renderHook(() => useWorkItemSearch());
        act(() => { result.current.onSearchChange('abc'); });
        act(() => { vi.advanceTimersByTime(100); });
        act(() => { result.current.onSearchChange('abcd'); });
        act(() => { vi.advanceTimersByTime(150); });
        // Only the last value should be committed
        expect(result.current.searchQuery).toBe('abcd');
    });

    it('onSearchClear resets both input and query immediately', () => {
        const { result } = renderHook(() => useWorkItemSearch());
        act(() => { result.current.onSearchChange('hello'); });
        act(() => { vi.advanceTimersByTime(150); });
        expect(result.current.searchQuery).toBe('hello');

        act(() => { result.current.onSearchClear(); });
        expect(result.current.searchInput).toBe('');
        expect(result.current.searchQuery).toBe('');
    });

    it('Escape key clears search when there is an active query', () => {
        const { result } = renderHook(() => useWorkItemSearch());
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
        const { result } = renderHook(() => useWorkItemSearch());
        // No visible container attached → container.offsetParent === null.
        act(() => { result.current.onSearchChange('test'); });
        act(() => { vi.advanceTimersByTime(150); });
        expect(result.current.searchQuery).toBe('test');

        act(() => {
            document.dispatchEvent(
                new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
            );
        });
        expect(result.current.searchQuery).toBe('test');
    });

    it('Ctrl+F focuses search input', () => {
        const { result } = renderHook(() => useWorkItemSearch());
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

    it('Ctrl+F does not focus search when isPreviewOpen is true', () => {
        const { result } = renderHook(() => useWorkItemSearch({ isPreviewOpen: true }));
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
        const { result } = renderHook(() => useWorkItemSearch({ isPreviewOpen: false }));
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
        const { result } = renderHook(() => useWorkItemSearch());
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
        const { result } = renderHook(() => useWorkItemSearch({ isPreviewOpen: true }));
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

    it('exposes searchInputRef', () => {
        const { result } = renderHook(() => useWorkItemSearch());
        expect(result.current.searchInputRef).toBeDefined();
    });

    it('exposes containerRef', () => {
        const { result } = renderHook(() => useWorkItemSearch());
        expect(result.current.containerRef).toBeDefined();
    });

    it('removes keydown listener on unmount', () => {
        const removeSpy = vi.spyOn(document, 'removeEventListener');
        const { unmount } = renderHook(() => useWorkItemSearch());
        unmount();
        expect(removeSpy).toHaveBeenCalledWith('keydown', expect.any(Function));
    });
});
