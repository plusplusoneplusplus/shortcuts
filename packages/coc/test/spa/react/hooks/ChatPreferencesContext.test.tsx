/**
 * Tests for ChatPreferencesContext — provider and consumer hook.
 *
 * Validates that:
 * - SET_ALL dispatch sets loaded=true with correct pinnedIds + archivedIds
 * - pinChat / archiveChat update state optimistically and call REST endpoints
 * - Multiple consumers share the same state
 * - useChatPrefs() throws when used outside a provider
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import React from 'react';
import {
    ChatPreferencesProvider,
    useChatPrefs,
} from '../../../../src/server/spa/client/react/contexts/ChatPreferencesContext';

// ── Mock pinArchiveApi ──────────────────────────────────────────────────────

const pinProcessMock = vi.fn().mockResolvedValue(undefined);
const unpinProcessMock = vi.fn().mockResolvedValue(undefined);
const archiveProcessMock = vi.fn().mockResolvedValue(undefined);
const unarchiveProcessMock = vi.fn().mockResolvedValue(undefined);
const archiveProcessesMock = vi.fn().mockResolvedValue(undefined);
const unarchiveProcessesMock = vi.fn().mockResolvedValue(undefined);

vi.mock('../../../../src/server/spa/client/react/queue/hooks/pinArchiveApi', () => ({
    pinProcess: (...args: any[]) => pinProcessMock(...args),
    unpinProcess: (...args: any[]) => unpinProcessMock(...args),
    archiveProcess: (...args: any[]) => archiveProcessMock(...args),
    unarchiveProcess: (...args: any[]) => unarchiveProcessMock(...args),
    archiveProcesses: (...args: any[]) => archiveProcessesMock(...args),
    unarchiveProcesses: (...args: any[]) => unarchiveProcessesMock(...args),
}));

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeWrapper(workspaceId: string) {
    return ({ children }: { children: React.ReactNode }) => (
        <ChatPreferencesProvider workspaceId={workspaceId}>{children}</ChatPreferencesProvider>
    );
}

/** Render hook and initialise state via SET_ALL dispatch. */
function renderWithState(workspaceId: string, pinnedIds: string[] = [], archivedIds: string[] = []) {
    const hook = renderHook(() => useChatPrefs(), { wrapper: makeWrapper(workspaceId) });
    act(() => {
        hook.result.current.dispatch({ type: 'SET_ALL', pinnedIds, archivedIds, workspaceId });
    });
    return hook;
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('ChatPreferencesContext', () => {
    beforeEach(() => {
        pinProcessMock.mockReset().mockResolvedValue(undefined);
        unpinProcessMock.mockReset().mockResolvedValue(undefined);
        archiveProcessMock.mockReset().mockResolvedValue(undefined);
        unarchiveProcessMock.mockReset().mockResolvedValue(undefined);
        archiveProcessesMock.mockReset().mockResolvedValue(undefined);
        unarchiveProcessesMock.mockReset().mockResolvedValue(undefined);
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    it('dispatches SET_ALL: state reflects loaded pinnedIds and archivedIds', () => {
        const { result } = renderHook(() => useChatPrefs(), {
            wrapper: makeWrapper('ws1'),
        });

        expect(result.current.loaded).toBe(false);

        act(() => {
            result.current.dispatch({
                type: 'SET_ALL',
                pinnedIds: ['p1', 'p2'],
                archivedIds: ['a1'],
                workspaceId: 'ws1',
            });
        });

        expect(result.current.loaded).toBe(true);
        expect(result.current.pinnedChatIds.has('p1')).toBe(true);
        expect(result.current.pinnedChatIds.has('p2')).toBe(true);
        expect(result.current.archivedChatIds.has('a1')).toBe(true);
        expect(result.current.pinnedChatIds.size).toBe(2);
        expect(result.current.archivedChatIds.size).toBe(1);
    });

    it('pinChat updates state optimistically and calls pinProcess', () => {
        const { result } = renderWithState('ws1');

        act(() => { result.current.pinChat('task-x'); });

        // Optimistic update: state must contain 'task-x' synchronously
        expect(result.current.pinnedChatIds.has('task-x')).toBe(true);
        expect(pinProcessMock).toHaveBeenCalledWith('task-x', 'ws1');
    });

    it('archiveChat updates state optimistically and calls archiveProcess', () => {
        const { result } = renderWithState('ws1');

        act(() => { result.current.archiveChat('task-y'); });

        expect(result.current.archivedChatIds.has('task-y')).toBe(true);
        expect(archiveProcessMock).toHaveBeenCalledWith('task-y', 'ws1');
    });

    it('multiple consumers inside the same provider share identical state', () => {
        const { result } = renderHook(
            () => ({ c1: useChatPrefs(), c2: useChatPrefs() }),
            { wrapper: makeWrapper('ws1') },
        );

        act(() => {
            result.current.c1.dispatch({
                type: 'SET_ALL',
                pinnedIds: ['p1'],
                archivedIds: ['a1'],
                workspaceId: 'ws1',
            });
        });

        expect(result.current.c1.loaded).toBe(true);
        expect(result.current.c2.loaded).toBe(true);

        // Both consumers see the same state
        expect(result.current.c1.pinnedChatIds.has('p1')).toBe(true);
        expect(result.current.c2.archivedChatIds.has('a1')).toBe(true);
    });

    it('throws when useChatPrefs is called outside a ChatPreferencesProvider', () => {
        expect(() => renderHook(() => useChatPrefs())).toThrow(
            'useChatPrefs must be used within ChatPreferencesProvider',
        );
    });
});
