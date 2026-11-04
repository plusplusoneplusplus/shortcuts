/* @vitest-environment jsdom */
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useWorkItemSearch } from '../../../../src/server/spa/client/react/features/work-items/hooks/useWorkItemSearch';
import { useTaskSearch } from '../../../../src/server/spa/client/react/tasks/hooks/useTaskSearch';
import type { TaskFolder } from '../../../../src/server/spa/client/react/tasks/hooks/useTaskTree';

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
});

describe.each([
    ['work items', () => useWorkItemSearch()],
    ['tasks', () => useTaskSearch(null)],
] as const)('%s search lifetime', (_label, useSearch) => {
    it('Escape cancels a pending debounce rather than restoring the cleared query', () => {
        const { result } = renderHook(useSearch);
        const container = document.createElement('div');
        Object.defineProperty(container, 'offsetParent', { value: document.body });
        document.body.appendChild(container);
        Object.assign(result.current.containerRef, { current: container });
        act(() => result.current.onSearchChange('pending'));
        act(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
        act(() => vi.advanceTimersByTime(150));
        expect(result.current.searchInput).toBe('');
        expect(result.current.searchQuery).toBe('');
    });

    it('clear and unmount release debounce timers', () => {
        const { result, unmount } = renderHook(useSearch);
        act(() => result.current.onSearchChange('first'));
        act(() => result.current.onSearchClear());
        expect(vi.getTimerCount()).toBe(0);
        act(() => result.current.onSearchChange('second'));
        unmount();
        expect(vi.getTimerCount()).toBe(0);
    });
});

it('retains task result identity until a debounced query or the tree actually changes', () => {
    const tree: TaskFolder = {
        name: 'root', relativePath: '', children: [], documentGroups: [],
        singleDocuments: [{ baseName: 'spec', fileName: 'spec.md', isArchived: false }],
    };
    const { result, rerender } = renderHook(() => useTaskSearch(tree));
    const initial = result.current.searchResults;
    act(() => result.current.onSearchChange('spec'));
    expect(result.current.searchResults).toBe(initial);
    rerender();
    expect(result.current.searchResults).toBe(initial);
    act(() => vi.advanceTimersByTime(150));
    const filtered = result.current.searchResults;
    expect(filtered).not.toBe(initial);
    rerender();
    expect(result.current.searchResults).toBe(filtered);
});
