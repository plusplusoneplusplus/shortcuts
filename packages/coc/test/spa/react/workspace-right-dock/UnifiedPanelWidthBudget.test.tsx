/** @vitest-environment jsdom */
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useWorkspaceDock } from '../../../../src/server/spa/client/react/features/repo-detail/useWorkspaceDock';
import {
    DOCK_MIN_CHAT_WIDTH,
    DOCK_MIN_WIDTH,
    RESIZE_HANDLE_TOTAL,
    workspaceDockWidthStorageKey,
} from '../../../../src/server/spa/client/react/features/repo-detail/WorkspaceDockToggle';
import {
    clearWorkspaceLeftWidth,
    setWorkspaceLeftWidth,
} from '../../../../src/server/spa/client/react/features/repo-detail/WorkspaceLeftWidth';
import { LEFT_RAIL_WIDTH } from '../../../../src/server/spa/client/react/features/repo-detail/WorkspaceLeftCollapse';

const WORKSPACE_ID = 'ws-width-budget';

function setInnerWidth(px: number): void {
    Object.defineProperty(window, 'innerWidth', { value: px, writable: true, configurable: true });
}

function resizeViewport(px: number): void {
    act(() => {
        setInnerWidth(px);
        window.dispatchEvent(new Event('resize'));
        vi.advanceTimersByTime(150);
    });
}

describe('Unified panel width budget', () => {
    let originalWidth: number;

    beforeEach(() => {
        originalWidth = window.innerWidth;
        localStorage.clear();
        clearWorkspaceLeftWidth(WORKSPACE_ID);
        vi.useFakeTimers();
    });

    afterEach(() => {
        clearWorkspaceLeftWidth(WORKSPACE_ID);
        vi.useRealTimers();
        setInnerWidth(originalWidth);
    });

    it('reserves the live left width and both resize handles', () => {
        setInnerWidth(1280);
        setWorkspaceLeftWidth(WORKSPACE_ID, 360);

        const { result } = renderHook(() => useWorkspaceDock(WORKSPACE_ID));

        expect(result.current.maxWidth).toBe(1280 - 360 - RESIZE_HANDLE_TOTAL - DOCK_MIN_CHAT_WIDTH);
    });

    it('raises the cap when the left column collapses to its rail', () => {
        setInnerWidth(1280);
        setWorkspaceLeftWidth(WORKSPACE_ID, 360);
        const { result } = renderHook(() => useWorkspaceDock(WORKSPACE_ID));

        act(() => setWorkspaceLeftWidth(WORKSPACE_ID, LEFT_RAIL_WIDTH));

        expect(result.current.maxWidth).toBe(1280 - LEFT_RAIL_WIDTH - RESIZE_HANDLE_TOTAL - DOCK_MIN_CHAT_WIDTH);
    });

    it('clamps an already-wide dock as the left column grows without losing persistence', () => {
        setInnerWidth(1600);
        localStorage.setItem(workspaceDockWidthStorageKey(WORKSPACE_ID), '700');
        setWorkspaceLeftWidth(WORKSPACE_ID, 360);
        const { result } = renderHook(() => useWorkspaceDock(WORKSPACE_ID));
        expect(result.current.width).toBe(700);

        act(() => setWorkspaceLeftWidth(WORKSPACE_ID, 640));

        expect(result.current.maxWidth).toBe(584);
        expect(result.current.width).toBe(584);
        expect(localStorage.getItem(workspaceDockWidthStorageKey(WORKSPACE_ID))).toBe('700');
    });

    it('floors the cap at the dock minimum on a very narrow viewport', () => {
        setInnerWidth(500);
        setWorkspaceLeftWidth(WORKSPACE_ID, 360);

        const { result } = renderHook(() => useWorkspaceDock(WORKSPACE_ID));

        expect(result.current.maxWidth).toBe(DOCK_MIN_WIDTH);
    });

    it('preserves the middle-pane budget at 1000px with the default layout', () => {
        setInnerWidth(1000);
        const leftWidth = 1000 - DOCK_MIN_CHAT_WIDTH - DOCK_MIN_WIDTH - RESIZE_HANDLE_TOTAL;
        setWorkspaceLeftWidth(WORKSPACE_ID, leftWidth);

        const { result } = renderHook(() => useWorkspaceDock(WORKSPACE_ID));

        expect(leftWidth + result.current.width + RESIZE_HANDLE_TOTAL).toBeLessThanOrEqual(
            1000 - DOCK_MIN_CHAT_WIDTH,
        );
    });

    it('keeps the persisted dock width through a narrow-then-wide viewport round trip', () => {
        setInnerWidth(1600);
        localStorage.setItem(workspaceDockWidthStorageKey(WORKSPACE_ID), '700');
        setWorkspaceLeftWidth(WORKSPACE_ID, 360);
        const { result } = renderHook(() => useWorkspaceDock(WORKSPACE_ID));
        expect(result.current.width).toBe(700);

        resizeViewport(1000);
        expect(result.current.width).toBe(DOCK_MIN_WIDTH);
        expect(localStorage.getItem(workspaceDockWidthStorageKey(WORKSPACE_ID))).toBe('700');

        resizeViewport(1600);
        expect(result.current.width).toBe(700);
        expect(localStorage.getItem(workspaceDockWidthStorageKey(WORKSPACE_ID))).toBe('700');
    });
});
