/**
 * Tests for ChatPreferencesContext — provider and consumer hook.
 *
 * Validates that:
 * - SET_ALL is dispatched after provider mounts (state reflects loaded pinnedIds + archivedIds)
 * - pinChat / archiveChat update state optimistically before the PATCH resolves
 * - Only one GET /preferences is issued even when multiple consumers call useChatPrefs()
 * - useChatPrefs() throws when used outside a provider
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import React from 'react';
import {
    ChatPreferencesProvider,
    useChatPrefs,
} from '../../../../src/server/spa/client/react/context/ChatPreferencesContext';

// ── Mock preferencesApi ─────────────────────────────────────────────────────

const getWorkspacePreferencesMock = vi.fn();
const patchWorkspacePreferencesMock = vi.fn();

vi.mock('../../../../src/server/spa/client/react/hooks/preferencesApi', () => ({
    getWorkspacePreferences: (...args: any[]) => getWorkspacePreferencesMock(...args),
    patchWorkspacePreferences: (...args: any[]) => patchWorkspacePreferencesMock(...args),
}));

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeWrapper(workspaceId: string) {
    return ({ children }: { children: React.ReactNode }) => (
        <ChatPreferencesProvider workspaceId={workspaceId}>{children}</ChatPreferencesProvider>
    );
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('ChatPreferencesContext', () => {
    beforeEach(() => {
        getWorkspacePreferencesMock.mockReset();
        patchWorkspacePreferencesMock.mockReset();
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    it('dispatches SET_ALL: state reflects loaded pinnedIds and archivedIds after mount', async () => {
        getWorkspacePreferencesMock.mockResolvedValue({
            pinnedChats: { ws1: ['p1', 'p2'] },
            archivedChats: { ws1: ['a1'] },
        });

        const { result } = renderHook(() => useChatPrefs(), {
            wrapper: makeWrapper('ws1'),
        });

        expect(result.current.loaded).toBe(false);

        await waitFor(() => expect(result.current.loaded).toBe(true));
        expect(result.current.pinnedChatIds.has('p1')).toBe(true);
        expect(result.current.pinnedChatIds.has('p2')).toBe(true);
        expect(result.current.archivedChatIds.has('a1')).toBe(true);
        expect(result.current.pinnedChatIds.size).toBe(2);
        expect(result.current.archivedChatIds.size).toBe(1);
    });

    it('pinChat updates state optimistically before PATCH resolves', async () => {
        getWorkspacePreferencesMock.mockResolvedValue({});
        // PATCH deliberately never resolves
        patchWorkspacePreferencesMock.mockReturnValue(new Promise(() => {}));

        const { result } = renderHook(() => useChatPrefs(), {
            wrapper: makeWrapper('ws1'),
        });

        await waitFor(() => expect(result.current.loaded).toBe(true));

        act(() => { result.current.pinChat('task-x'); });

        // Optimistic update: state must contain 'task-x' synchronously
        expect(result.current.pinnedChatIds.has('task-x')).toBe(true);
    });

    it('archiveChat updates state optimistically before PATCH resolves', async () => {
        getWorkspacePreferencesMock.mockResolvedValue({});
        patchWorkspacePreferencesMock.mockReturnValue(new Promise(() => {}));

        const { result } = renderHook(() => useChatPrefs(), {
            wrapper: makeWrapper('ws1'),
        });

        await waitFor(() => expect(result.current.loaded).toBe(true));

        act(() => { result.current.archiveChat('task-y'); });

        expect(result.current.archivedChatIds.has('task-y')).toBe(true);
    });

    it('issues only one GET even when multiple consumers call useChatPrefs() inside the same provider', async () => {
        getWorkspacePreferencesMock.mockResolvedValue({
            pinnedChats: { ws1: ['p1'] },
            archivedChats: { ws1: ['a1'] },
        });

        // Two useChatPrefs() calls rendered inside a single provider wrapper
        const { result } = renderHook(
            () => ({ c1: useChatPrefs(), c2: useChatPrefs() }),
            { wrapper: makeWrapper('ws1') },
        );

        await waitFor(() => expect(result.current.c1.loaded).toBe(true));
        expect(result.current.c2.loaded).toBe(true);

        // Only one GET was fired
        expect(getWorkspacePreferencesMock).toHaveBeenCalledTimes(1);

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
