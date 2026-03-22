/**
 * Tests for ChatPreferencesContext — provider fetch, reducer, actions,
 * edge cases, and hook guard. Covers all ten acceptance-criteria cases.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { type ReactNode } from 'react';

vi.mock('../../../src/server/spa/client/react/hooks/preferencesApi', () => ({
    getWorkspacePreferences: vi.fn(),
    patchWorkspacePreferences: vi.fn(),
}));

import {
    getWorkspacePreferences,
    patchWorkspacePreferences,
} from '../../../src/server/spa/client/react/hooks/preferencesApi';
import {
    ChatPreferencesProvider,
    useChatPrefs,
    chatPrefsReducer,
    type ChatPrefsState,
} from '../../../src/server/spa/client/react/context/ChatPreferencesContext';

const mockGet = vi.mocked(getWorkspacePreferences);
const mockPatch = vi.mocked(patchWorkspacePreferences);

function makeWrapper(workspaceId: string) {
    return function Wrapper({ children }: { children: ReactNode }) {
        return <ChatPreferencesProvider workspaceId={workspaceId}>{children}</ChatPreferencesProvider>;
    };
}

beforeEach(() => {
    vi.clearAllMocks();
    mockPatch.mockResolvedValue(undefined);
});

// ── Reducer unit tests ─────────────────────────────────────────────────────

describe('chatPrefsReducer', () => {
    const initial: ChatPrefsState = { pinnedIds: [], archivedIds: [], loaded: false, workspaceId: '' };

    it('SET_ALL populates all fields and sets loaded=true', () => {
        const result = chatPrefsReducer(initial, {
            type: 'SET_ALL',
            pinnedIds: ['t1'],
            archivedIds: ['t2'],
            workspaceId: 'ws1',
        });
        expect(result.pinnedIds).toEqual(['t1']);
        expect(result.archivedIds).toEqual(['t2']);
        expect(result.workspaceId).toBe('ws1');
        expect(result.loaded).toBe(true);
    });

    it('RESET returns initial state', () => {
        const state: ChatPrefsState = { pinnedIds: ['t1'], archivedIds: ['t2'], loaded: true, workspaceId: 'ws1' };
        const result = chatPrefsReducer(state, { type: 'RESET' });
        expect(result).toEqual({ pinnedIds: [], archivedIds: [], loaded: false, workspaceId: '' });
    });

    it('PIN prepends id', () => {
        const state: ChatPrefsState = { ...initial, pinnedIds: ['a'] };
        const result = chatPrefsReducer(state, { type: 'PIN', taskId: 'b' });
        expect(result.pinnedIds).toEqual(['b', 'a']);
    });

    it('PIN is a no-op when id already present', () => {
        const state: ChatPrefsState = { ...initial, pinnedIds: ['a'] };
        const result = chatPrefsReducer(state, { type: 'PIN', taskId: 'a' });
        expect(result).toBe(state);
    });

    it('PIN slices to MAX_PINNED=50', () => {
        const fiftyIds = Array.from({ length: 50 }, (_, i) => `id${i}`);
        const state: ChatPrefsState = { ...initial, pinnedIds: fiftyIds };
        const result = chatPrefsReducer(state, { type: 'PIN', taskId: 'new' });
        expect(result.pinnedIds).toHaveLength(50);
        expect(result.pinnedIds[0]).toBe('new');
        expect(result.pinnedIds.includes('id49')).toBe(false);
    });

    it('UNPIN removes id', () => {
        const state: ChatPrefsState = { ...initial, pinnedIds: ['a', 'b'] };
        const result = chatPrefsReducer(state, { type: 'UNPIN', taskId: 'a' });
        expect(result.pinnedIds).toEqual(['b']);
    });

    it('UNPIN is a no-op when id absent', () => {
        const state: ChatPrefsState = { ...initial, pinnedIds: ['a'] };
        const result = chatPrefsReducer(state, { type: 'UNPIN', taskId: 'x' });
        expect(result).toBe(state);
    });

    it('ARCHIVE prepends id', () => {
        const state: ChatPrefsState = { ...initial, archivedIds: ['a'] };
        const result = chatPrefsReducer(state, { type: 'ARCHIVE', taskId: 'b' });
        expect(result.archivedIds).toEqual(['b', 'a']);
    });

    it('ARCHIVE is a no-op when id already present', () => {
        const state: ChatPrefsState = { ...initial, archivedIds: ['a'] };
        const result = chatPrefsReducer(state, { type: 'ARCHIVE', taskId: 'a' });
        expect(result).toBe(state);
    });

    it('UNARCHIVE removes id', () => {
        const state: ChatPrefsState = { ...initial, archivedIds: ['a', 'b'] };
        const result = chatPrefsReducer(state, { type: 'UNARCHIVE', taskId: 'a' });
        expect(result.archivedIds).toEqual(['b']);
    });

    it('UNARCHIVE is a no-op when id absent', () => {
        const state: ChatPrefsState = { ...initial, archivedIds: ['a'] };
        const result = chatPrefsReducer(state, { type: 'UNARCHIVE', taskId: 'x' });
        expect(result).toBe(state);
    });
});

// ── Provider + hook integration tests ─────────────────────────────────────

describe('ChatPreferencesProvider', () => {
    // Test 1: Provider fetches on mount
    it('1. fetches on mount, sets loaded=true with correct ids', async () => {
        mockGet.mockResolvedValueOnce({
            pinnedChats: { ws1: ['t1'] },
            archivedChats: { ws1: ['t2'] },
        });

        const { result } = renderHook(() => useChatPrefs(), { wrapper: makeWrapper('ws1') });

        await waitFor(() => expect(result.current.loaded).toBe(true));

        expect(result.current.pinnedChatIds.has('t1')).toBe(true);
        expect(result.current.archivedChatIds.has('t2')).toBe(true);
        expect(mockGet).toHaveBeenCalledTimes(1);
        expect(mockGet).toHaveBeenCalledWith('ws1');
    });

    // Test 2: Fetch failure treated as empty
    it('2. fetch failure treated as empty, loaded=true', async () => {
        mockGet.mockRejectedValueOnce(new Error('Network error'));

        const { result } = renderHook(() => useChatPrefs(), { wrapper: makeWrapper('ws1') });

        await waitFor(() => expect(result.current.loaded).toBe(true));

        expect(result.current.pinnedChatIds.size).toBe(0);
        expect(result.current.archivedChatIds.size).toBe(0);
    });

    // Test 3: PIN action — idempotent
    it('3. PIN action adds id; calling again is a no-op', async () => {
        mockGet.mockResolvedValueOnce({});

        const { result } = renderHook(() => useChatPrefs(), { wrapper: makeWrapper('ws1') });
        await waitFor(() => expect(result.current.loaded).toBe(true));

        act(() => { result.current.pinChat('newId'); });
        expect(result.current.pinnedChatIds.has('newId')).toBe(true);
        const sizeAfterFirst = result.current.pinnedChatIds.size;

        act(() => { result.current.pinChat('newId'); });
        expect(result.current.pinnedChatIds.size).toBe(sizeAfterFirst);
    });

    // Test 4: UNPIN action
    it('4. UNPIN action removes pinned id', async () => {
        mockGet.mockResolvedValueOnce({ pinnedChats: { ws1: ['t1'] } });

        const { result } = renderHook(() => useChatPrefs(), { wrapper: makeWrapper('ws1') });
        await waitFor(() => expect(result.current.loaded).toBe(true));

        act(() => { result.current.unpinChat('t1'); });
        expect(result.current.pinnedChatIds.has('t1')).toBe(false);
        expect(result.current.pinnedChatIds.size).toBe(0);
    });

    // Test 5: ARCHIVE action
    it('5. ARCHIVE action adds id', async () => {
        mockGet.mockResolvedValueOnce({});

        const { result } = renderHook(() => useChatPrefs(), { wrapper: makeWrapper('ws1') });
        await waitFor(() => expect(result.current.loaded).toBe(true));

        act(() => { result.current.archiveChat('a1'); });
        expect(result.current.archivedChatIds.has('a1')).toBe(true);
    });

    // Test 6: UNARCHIVE action
    it('6. UNARCHIVE action removes archived id', async () => {
        mockGet.mockResolvedValueOnce({ archivedChats: { ws1: ['a1'] } });

        const { result } = renderHook(() => useChatPrefs(), { wrapper: makeWrapper('ws1') });
        await waitFor(() => expect(result.current.loaded).toBe(true));

        act(() => { result.current.unarchiveChat('a1'); });
        expect(result.current.archivedChatIds.has('a1')).toBe(false);
    });

    // Test 7: MAX_PINNED cap
    it('7. MAX_PINNED cap — 50 pinned ids, adding one more keeps size at 50 (newest first)', async () => {
        const fiftyIds = Array.from({ length: 50 }, (_, i) => `id${i}`);
        mockGet.mockResolvedValueOnce({ pinnedChats: { ws1: fiftyIds } });

        const { result } = renderHook(() => useChatPrefs(), { wrapper: makeWrapper('ws1') });
        await waitFor(() => expect(result.current.loaded).toBe(true));

        act(() => { result.current.pinChat('newId'); });

        expect(result.current.pinnedChatIds.size).toBe(50);
        expect(result.current.pinnedChatIds.has('newId')).toBe(true);
        expect(result.current.pinnedChatIds.has('id49')).toBe(false); // oldest dropped
    });

    // Test 8: workspaceId change resets state and triggers fresh fetch
    it('8. workspaceId change resets state then loads new data', async () => {
        mockGet
            .mockResolvedValueOnce({ pinnedChats: { ws1: ['t1'] } })
            .mockResolvedValueOnce({ pinnedChats: { ws2: ['t2'] } });

        let currentWsId = 'ws1';
        const { result, rerender } = renderHook(
            () => useChatPrefs(),
            {
                wrapper: ({ children }: { children: ReactNode }) => (
                    <ChatPreferencesProvider workspaceId={currentWsId}>{children}</ChatPreferencesProvider>
                ),
            },
        );

        await waitFor(() => expect(result.current.loaded).toBe(true));
        expect(result.current.pinnedChatIds.has('t1')).toBe(true);

        currentWsId = 'ws2';
        rerender();

        await waitFor(() => {
            expect(result.current.loaded).toBe(true);
            expect(result.current.pinnedChatIds.has('t2')).toBe(true);
        });
        expect(result.current.pinnedChatIds.has('t1')).toBe(false);
        expect(mockGet).toHaveBeenCalledTimes(2);
        expect(mockGet).toHaveBeenLastCalledWith('ws2');
    });

    // Test 9: useChatPrefs throws outside provider
    it('9. useChatPrefs throws when used outside ChatPreferencesProvider', () => {
        const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
        expect(() => {
            renderHook(() => useChatPrefs());
        }).toThrow('useChatPrefs must be used within ChatPreferencesProvider');
        spy.mockRestore();
    });

    // Test 10: patchWorkspacePreferences called on mutating actions
    it('10. patchWorkspacePreferences called with correct payload on pinChat', async () => {
        mockGet.mockResolvedValueOnce({ pinnedChats: { ws1: ['t0'] } });

        const { result } = renderHook(() => useChatPrefs(), { wrapper: makeWrapper('ws1') });
        await waitFor(() => expect(result.current.loaded).toBe(true));

        act(() => { result.current.pinChat('newPin'); });

        await waitFor(() => {
            expect(mockPatch).toHaveBeenCalledWith('ws1', {
                pinnedChats: { ws1: ['newPin', 't0'] },
            });
        });
    });

    it('10b. patchWorkspacePreferences called with correct payload on archiveChat', async () => {
        mockGet.mockResolvedValueOnce({ archivedChats: { ws1: ['a0'] } });

        const { result } = renderHook(() => useChatPrefs(), { wrapper: makeWrapper('ws1') });
        await waitFor(() => expect(result.current.loaded).toBe(true));

        act(() => { result.current.archiveChat('newArchive'); });

        await waitFor(() => {
            expect(mockPatch).toHaveBeenCalledWith('ws1', {
                archivedChats: { ws1: ['newArchive', 'a0'] },
            });
        });
    });
});
