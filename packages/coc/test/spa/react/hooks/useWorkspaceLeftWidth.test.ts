/** @vitest-environment jsdom */
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import {
    LEFT_COLUMN_INITIAL_WIDTH,
    clearWorkspaceLeftWidth,
    readWorkspaceLeftWidth,
    setWorkspaceLeftWidth,
    splitWorkspaceWidthStorageKey,
    useWorkspaceLeftWidth,
} from '../../../../src/server/spa/client/react/features/repo-detail/WorkspaceLeftWidth';
import {
    LEFT_RAIL_WIDTH,
    splitWorkspaceLeftCollapsedStorageKey,
} from '../../../../src/server/spa/client/react/features/repo-detail/WorkspaceLeftCollapse';

describe('useWorkspaceLeftWidth', () => {
    beforeEach(() => {
        localStorage.clear();
        clearWorkspaceLeftWidth('ws-a');
        clearWorkspaceLeftWidth('ws-b');
    });

    it('falls back to the persisted width when nothing has published', () => {
        localStorage.setItem(splitWorkspaceWidthStorageKey('ws-a'), '512');

        expect(readWorkspaceLeftWidth('ws-a')).toBe(512);
    });

    it('falls back to the collapsed rail width before the panel publishes', () => {
        localStorage.setItem(splitWorkspaceWidthStorageKey('ws-a'), '512');
        localStorage.setItem(splitWorkspaceLeftCollapsedStorageKey('ws-a'), '1');

        expect(readWorkspaceLeftWidth('ws-a')).toBe(LEFT_RAIL_WIDTH);
    });

    it('uses the initial width when storage is empty', () => {
        expect(readWorkspaceLeftWidth('ws-a')).toBe(LEFT_COLUMN_INITIAL_WIDTH);
    });

    it('notifies subscribers and keeps live widths per workspace', () => {
        const { result } = renderHook(() => useWorkspaceLeftWidth('ws-a'));

        act(() => setWorkspaceLeftWidth('ws-a', 440));
        expect(result.current).toBe(440);
        expect(readWorkspaceLeftWidth('ws-b')).toBe(LEFT_COLUMN_INITIAL_WIDTH);
    });

    it('falls back to persistence after the live publisher clears', () => {
        localStorage.setItem(splitWorkspaceWidthStorageKey('ws-a'), '480');
        const { result } = renderHook(() => useWorkspaceLeftWidth('ws-a'));

        act(() => setWorkspaceLeftWidth('ws-a', 360));
        expect(result.current).toBe(360);

        act(() => clearWorkspaceLeftWidth('ws-a'));
        expect(result.current).toBe(480);
    });
});
