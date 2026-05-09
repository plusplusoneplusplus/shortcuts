/**
 * @vitest-environment jsdom
 *
 * Unit tests for useScratchpadState — open/closed persistence per taskId.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useScratchpadState } from '../../../../src/server/spa/client/react/features/chat/scratchpad/useScratchpadState';

const OPEN_KEY = (id: string) => `coc.scratchpad.open.${id}`;
const LINKED_PATH_KEY = (id: string) => `coc.scratchpad.linkedNotePath.${id}`;

describe('useScratchpadState — open/closed persistence', () => {
    beforeEach(() => {
        localStorage.clear();
    });
    afterEach(() => {
        localStorage.clear();
    });

    it('defaults to closed when taskId is null', () => {
        const ref = { current: null } as React.RefObject<HTMLElement>;
        const { result } = renderHook(() => useScratchpadState(ref, 'horizontal', null));
        expect(result.current.isOpen).toBe(false);
    });

    it('defaults to closed when no persisted state exists for taskId', () => {
        const ref = { current: null } as React.RefObject<HTMLElement>;
        const { result } = renderHook(() => useScratchpadState(ref, 'horizontal', 'task-abc'));
        expect(result.current.isOpen).toBe(false);
    });

    it('initializes as open when localStorage has "true" for the taskId', () => {
        localStorage.setItem(OPEN_KEY('task-xyz'), 'true');
        const ref = { current: null } as React.RefObject<HTMLElement>;
        const { result } = renderHook(() => useScratchpadState(ref, 'horizontal', 'task-xyz'));
        expect(result.current.isOpen).toBe(true);
    });

    it('persists "true" to localStorage on open()', () => {
        const ref = { current: null } as React.RefObject<HTMLElement>;
        const { result } = renderHook(() => useScratchpadState(ref, 'horizontal', 'task-1'));
        act(() => { result.current.open(); });
        expect(result.current.isOpen).toBe(true);
        expect(localStorage.getItem(OPEN_KEY('task-1'))).toBe('true');
    });

    it('removes the key from localStorage on close()', () => {
        localStorage.setItem(OPEN_KEY('task-2'), 'true');
        const ref = { current: null } as React.RefObject<HTMLElement>;
        const { result } = renderHook(() => useScratchpadState(ref, 'horizontal', 'task-2'));
        act(() => { result.current.close(); });
        expect(result.current.isOpen).toBe(false);
        expect(localStorage.getItem(OPEN_KEY('task-2'))).toBeNull();
    });

    it('does not write to localStorage when taskId is null on open()', () => {
        const ref = { current: null } as React.RefObject<HTMLElement>;
        const { result } = renderHook(() => useScratchpadState(ref, 'horizontal', null));
        act(() => { result.current.open(); });
        expect(result.current.isOpen).toBe(true);
        // No open-state key should have been written for null taskId
        // (height key may be present from layout effect, which is unrelated)
        const openKeys = Object.keys(localStorage).filter(k => k.startsWith('coc.scratchpad.open.'));
        expect(openKeys).toHaveLength(0);
    });

    it('does not throw when taskId is null on close()', () => {
        const ref = { current: null } as React.RefObject<HTMLElement>;
        const { result } = renderHook(() => useScratchpadState(ref, 'horizontal', null));
        act(() => { result.current.open(); });
        expect(() => act(() => { result.current.close(); })).not.toThrow();
        expect(result.current.isOpen).toBe(false);
    });

    it('resets isOpen when taskId changes to a task with no saved state', () => {
        localStorage.setItem(OPEN_KEY('task-A'), 'true');
        const ref = { current: null } as React.RefObject<HTMLElement>;
        let taskId = 'task-A';
        const { result, rerender } = renderHook(() =>
            useScratchpadState(ref, 'horizontal', taskId),
        );
        expect(result.current.isOpen).toBe(true);

        // Switch to a different task with no saved open state
        taskId = 'task-B';
        rerender();
        expect(result.current.isOpen).toBe(false);
    });

    it('restores isOpen when switching to a task that was previously opened', () => {
        localStorage.setItem(OPEN_KEY('task-B'), 'true');
        const ref = { current: null } as React.RefObject<HTMLElement>;
        let taskId = 'task-A';
        const { result, rerender } = renderHook(() =>
            useScratchpadState(ref, 'horizontal', taskId),
        );
        expect(result.current.isOpen).toBe(false);

        taskId = 'task-B';
        rerender();
        expect(result.current.isOpen).toBe(true);
    });

    it('resets isOpen to false when taskId changes to null', () => {
        localStorage.setItem(OPEN_KEY('task-C'), 'true');
        const ref = { current: null } as React.RefObject<HTMLElement>;
        let taskId: string | null = 'task-C';
        const { result, rerender } = renderHook(() =>
            useScratchpadState(ref, 'horizontal', taskId),
        );
        expect(result.current.isOpen).toBe(true);

        taskId = null;
        rerender();
        expect(result.current.isOpen).toBe(false);
    });

    it('open() with a notePath still persists the open state', () => {
        const ref = { current: null } as React.RefObject<HTMLElement>;
        const { result } = renderHook(() => useScratchpadState(ref, 'horizontal', 'task-3'));
        act(() => { result.current.open('notes/plan.md'); });
        expect(result.current.isOpen).toBe(true);
        expect(localStorage.getItem(OPEN_KEY('task-3'))).toBe('true');
        expect(result.current.linkedNotePath).toBe('notes/plan.md');
    });

    it('persists and restores linkedNotePath across hook remounts for the same taskId', () => {
        const ref = { current: null } as React.RefObject<HTMLElement>;
        const { result, unmount } = renderHook(() => useScratchpadState(ref, 'horizontal', 'task-linked'));

        act(() => { result.current.open('notes/restored.md'); });
        expect(localStorage.getItem(LINKED_PATH_KEY('task-linked'))).toBe('notes/restored.md');

        unmount();

        const { result: remounted } = renderHook(() => useScratchpadState(ref, 'horizontal', 'task-linked'));
        expect(remounted.current.linkedNotePath).toBe('notes/restored.md');
    });

    it('loads each taskId own persisted linkedNotePath when taskId changes', () => {
        localStorage.setItem(LINKED_PATH_KEY('task-A'), 'notes/a.md');
        localStorage.setItem(LINKED_PATH_KEY('task-B'), 'notes/b.md');
        const ref = { current: null } as React.RefObject<HTMLElement>;
        let taskId = 'task-A';
        const { result, rerender } = renderHook(() =>
            useScratchpadState(ref, 'horizontal', taskId),
        );
        expect(result.current.linkedNotePath).toBe('notes/a.md');

        taskId = 'task-B';
        rerender();
        expect(result.current.linkedNotePath).toBe('notes/b.md');
    });

    it('adds a restored linkedNotePath to knownFiles so the tab is visible immediately', () => {
        localStorage.setItem(LINKED_PATH_KEY('task-tabs'), 'notes/tab.md');
        const ref = { current: null } as React.RefObject<HTMLElement>;

        const { result } = renderHook(() => useScratchpadState(ref, 'horizontal', 'task-tabs'));

        expect(result.current.knownFiles).toEqual(['notes/tab.md']);
    });

    it('clears the persisted linkedNotePath when setLinkedNotePath(null) is called', () => {
        localStorage.setItem(LINKED_PATH_KEY('task-clear'), 'notes/old.md');
        const ref = { current: null } as React.RefObject<HTMLElement>;
        const { result } = renderHook(() => useScratchpadState(ref, 'horizontal', 'task-clear'));

        act(() => { result.current.setLinkedNotePath(null); });

        expect(result.current.linkedNotePath).toBeNull();
        expect(localStorage.getItem(LINKED_PATH_KEY('task-clear'))).toBeNull();
    });

    it('keeps the persisted linkedNotePath when close() hides the scratchpad', () => {
        const ref = { current: null } as React.RefObject<HTMLElement>;
        const { result } = renderHook(() => useScratchpadState(ref, 'horizontal', 'task-close'));
        act(() => { result.current.open('notes/remembered.md'); });

        act(() => { result.current.close(); });

        expect(result.current.isOpen).toBe(false);
        expect(localStorage.getItem(OPEN_KEY('task-close'))).toBeNull();
        expect(localStorage.getItem(LINKED_PATH_KEY('task-close'))).toBe('notes/remembered.md');
    });
});

describe('useScratchpadState — no auto-open from ChatDetail (static check)', () => {
    it('verifies the auto-open effect was removed from ChatDetail.tsx', async () => {
        const { readFileSync } = await import('fs');
        const { resolve } = await import('path');
        const src = readFileSync(
            resolve(__dirname, '../../../../src/server/spa/client/react/features/chat/ChatDetail.tsx'),
            'utf-8',
        );
        // The auto-open effect must not exist
        expect(src).not.toMatch(/extractLastWrittenNotePath.*scratchpad\.open/s);
        expect(src).not.toMatch(/Auto-open scratchpad when the last assistant turn/);
        // The import of extractLastWrittenNotePath should be gone
        expect(src).not.toMatch(/import.*extractLastWrittenNotePath/);
    });

    it('verifies useScratchpadState receives bareTaskId', async () => {
        const { readFileSync } = await import('fs');
        const { resolve } = await import('path');
        const src = readFileSync(
            resolve(__dirname, '../../../../src/server/spa/client/react/features/chat/ChatDetail.tsx'),
            'utf-8',
        );
        expect(src).toMatch(/useScratchpadState\s*\(\s*scratchpadContainerRef\s*,\s*scratchpadLayout\s*,\s*bareTaskId\s*\)/);
    });
});
