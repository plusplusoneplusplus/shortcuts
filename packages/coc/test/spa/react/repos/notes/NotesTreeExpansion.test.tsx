/** @vitest-environment jsdom */
import { useRef } from 'react';
import { act, fireEvent, render, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
    notesTreeExpandedStorageKey,
    notesTreeScrollStorageKey,
    readExpandedPaths,
    readNotesTreeScroll,
    useNotesTreeExpansion,
    useNotesTreeScroll,
} from '../../../../../src/server/spa/client/react/features/notes/editor/NotesTreeExpansion';

function ScrollHarness({
    workspaceId,
    rootId,
    ready = true,
}: {
    workspaceId: string;
    rootId?: string;
    ready?: boolean;
}) {
    const treeAreaRef = useRef<HTMLDivElement>(null);
    const onScroll = useNotesTreeScroll(workspaceId, rootId, treeAreaRef, ready);
    return <div ref={treeAreaRef} onScroll={onScroll} data-testid="tree-area" />;
}

describe('NotesTreeExpansion persistence', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    it('builds workspace-and-root scoped storage keys', () => {
        expect(notesTreeExpandedStorageKey('ws-a', 'default')).toBe('coc-notes-expanded-ws-a-default');
        expect(notesTreeExpandedStorageKey('ws-a', 'docs')).toBe('coc-notes-expanded-ws-a-docs');
        expect(notesTreeScrollStorageKey('my_life', 'default')).toBe('coc-notes-scroll-my_life-default');
    });

    it('reads valid string paths and safely rejects corrupt or non-array values', () => {
        const key = notesTreeExpandedStorageKey('ws-a', 'default');
        expect([...readExpandedPaths(key)]).toEqual([]);

        localStorage.setItem(key, JSON.stringify(['Notebook', 4, null, 'Notebook/Section']));
        expect([...readExpandedPaths(key)]).toEqual(['Notebook', 'Notebook/Section']);

        localStorage.setItem(key, '{bad json');
        expect([...readExpandedPaths(key)]).toEqual([]);

        localStorage.setItem(key, JSON.stringify({ path: 'Notebook' }));
        expect([...readExpandedPaths(key)]).toEqual([]);
    });

    it('hydrates lazily without writing, then persists user changes', () => {
        const key = notesTreeExpandedStorageKey('ws-a', 'default');
        localStorage.setItem(key, JSON.stringify(['Notebook']));
        const setItem = vi.spyOn(Storage.prototype, 'setItem');

        const { result } = renderHook(() => useNotesTreeExpansion('ws-a', undefined));
        expect([...result.current[0]]).toEqual(['Notebook']);
        expect(setItem).not.toHaveBeenCalled();

        act(() => {
            result.current[1](prev => new Set([...prev, 'Notebook/Section']));
        });
        expect(JSON.parse(localStorage.getItem(key)!)).toEqual(['Notebook', 'Notebook/Section']);
    });

    it('reloads on workspace or root changes without clobbering either scope', () => {
        const defaultKey = notesTreeExpandedStorageKey('ws-a', 'default');
        const docsKey = notesTreeExpandedStorageKey('ws-a', 'docs');
        const otherWorkspaceKey = notesTreeExpandedStorageKey('ws-b', 'docs');
        localStorage.setItem(defaultKey, JSON.stringify(['Default Notebook']));
        localStorage.setItem(docsKey, JSON.stringify(['Docs Notebook']));
        localStorage.setItem(otherWorkspaceKey, JSON.stringify(['Other Notebook']));

        const { result, rerender } = renderHook(
            ({ workspaceId, rootId }) => useNotesTreeExpansion(workspaceId, rootId),
            { initialProps: { workspaceId: 'ws-a', rootId: undefined as string | undefined } },
        );
        expect([...result.current[0]]).toEqual(['Default Notebook']);

        rerender({ workspaceId: 'ws-a', rootId: 'docs' });
        expect([...result.current[0]]).toEqual(['Docs Notebook']);

        rerender({ workspaceId: 'ws-b', rootId: 'docs' });
        expect([...result.current[0]]).toEqual(['Other Notebook']);
        expect(JSON.parse(localStorage.getItem(defaultKey)!)).toEqual(['Default Notebook']);
        expect(JSON.parse(localStorage.getItem(docsKey)!)).toEqual(['Docs Notebook']);
    });
});

describe('Notes tree scroll persistence', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    it('reads only finite non-negative scroll positions', () => {
        const key = notesTreeScrollStorageKey('ws-a', 'default');
        expect(readNotesTreeScroll(key)).toBe(0);
        localStorage.setItem(key, '42.9');
        expect(readNotesTreeScroll(key)).toBe(42);
        localStorage.setItem(key, '-1');
        expect(readNotesTreeScroll(key)).toBe(0);
        localStorage.setItem(key, 'not-a-number');
        expect(readNotesTreeScroll(key)).toBe(0);
    });

    it('restores when ready, throttles saves, and flushes on unmount', () => {
        const key = notesTreeScrollStorageKey('ws-a', 'default');
        localStorage.setItem(key, '73');
        const frames: FrameRequestCallback[] = [];
        vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => {
            frames.push(callback);
            return frames.length;
        });
        vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);

        const { getByTestId, unmount } = render(
            <ScrollHarness workspaceId="ws-a" ready />,
        );
        const treeArea = getByTestId('tree-area');
        expect(treeArea.scrollTop).toBe(73);

        treeArea.scrollTop = 120;
        fireEvent.scroll(treeArea);
        fireEvent.scroll(treeArea);
        expect(frames).toHaveLength(1);
        expect(localStorage.getItem(key)).toBe('73');

        act(() => frames[0](0));
        expect(localStorage.getItem(key)).toBe('120');

        treeArea.scrollTop = 145;
        unmount();
        expect(localStorage.getItem(key)).toBe('145');
    });

    it('saves the old scope before restoring the new root', () => {
        const defaultKey = notesTreeScrollStorageKey('ws-a', 'default');
        const docsKey = notesTreeScrollStorageKey('ws-a', 'docs');
        localStorage.setItem(defaultKey, '20');
        localStorage.setItem(docsKey, '90');

        const { getByTestId, rerender } = render(
            <ScrollHarness workspaceId="ws-a" ready />,
        );
        const treeArea = getByTestId('tree-area');
        expect(treeArea.scrollTop).toBe(20);
        treeArea.scrollTop = 55;

        rerender(<ScrollHarness workspaceId="ws-a" rootId="docs" ready />);
        expect(localStorage.getItem(defaultKey)).toBe('55');
        expect(treeArea.scrollTop).toBe(90);
    });
});
