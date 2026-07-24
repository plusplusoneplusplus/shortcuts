/* @vitest-environment jsdom */
/**
 * AC-07 clone routing for the shared composer's prompt-history + autocomplete
 * reads (subtask 8c).
 *
 * `usePromptAutocomplete` and `useChatPromptHistory` used to read the LOCAL
 * `getSpaCocClient()` unconditionally, and `useChatPromptHistory`'s module
 * cache was keyed by a BARE workspace id. That leaks a remote clone's prompt
 * history/autocomplete through the local origin and lets two server identities
 * that share a workspace id collide on one cache entry.
 *
 * These tests mount each hook against a REMOTE `baseUrl` and prove:
 *   - the remote server's client is used and the LOCAL client gets no request
 *     (DoD #3);
 *   - omitting `baseUrl` keeps the legacy LOCAL client (backward compatible);
 *   - the history cache is server-scoped, so the same workspace id on the local
 *     origin and a remote clone never share cached history (DoD #4).
 *
 * Mirrors the harness in `providerHooks-clone-routing.test.ts` (iter 10): a
 * single mock exports BOTH `getSpaCocClient` (→ LOCAL fake) and
 * `getCocClientFor(baseUrl)` (records the baseUrl, → the matching REMOTE fake).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { usePromptAutocomplete } from '../../../../src/server/spa/client/react/hooks/usePromptAutocomplete';
import {
    useChatPromptHistory,
    __resetPromptHistoryCacheForTesting,
} from '../../../../src/server/spa/client/react/hooks/useChatPromptHistory';

const REMOTE_URL = 'https://remote.example';

// LOCAL fake — returned by getSpaCocClient().
const localList = vi.fn();
const localCompletion = vi.fn();
// REMOTE fake — returned by getCocClientFor(REMOTE_URL).
const remoteList = vi.fn();
const remoteCompletion = vi.fn();
// Records every getCocClientFor(baseUrl) call so we can assert routing.
const getCocClientForSpy = vi.fn();

vi.mock('../../../../src/server/spa/client/react/api/cocClient', () => ({
    getSpaCocClient: () => ({
        promptHistory: { list: (...a: any[]) => localList(...a) },
        suggestions: { promptCompletion: (...a: any[]) => localCompletion(...a) },
    }),
    getCocClientFor: (baseUrl?: string) => {
        getCocClientForSpy(baseUrl);
        return {
            promptHistory: { list: (...a: any[]) => remoteList(...a) },
            suggestions: { promptCompletion: (...a: any[]) => remoteCompletion(...a) },
        };
    },
}));

beforeEach(() => {
    localList.mockReset();
    localCompletion.mockReset();
    remoteList.mockReset();
    remoteCompletion.mockReset();
    getCocClientForSpy.mockReset();
    __resetPromptHistoryCacheForTesting();
});

afterEach(() => {
    vi.clearAllMocks();
});

describe('usePromptAutocomplete — clone routing (AC-07 DoD #3)', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('fetches from the remote clone when baseUrl is set; local client gets no request', async () => {
        remoteCompletion.mockResolvedValue({ completion: ' the bug' });
        const { result } = renderHook(() =>
            usePromptAutocomplete({
                text: 'fix the ',
                cursorPos: 8,
                enabled: true,
                workspaceId: 'ws-1',
                baseUrl: REMOTE_URL,
            }),
        );

        await act(async () => { await vi.runAllTimersAsync(); });

        expect(remoteCompletion).toHaveBeenCalledWith(
            expect.objectContaining({ prefix: 'fix the ', workspaceId: 'ws-1' }),
        );
        expect(localCompletion).not.toHaveBeenCalled();
        expect(getCocClientForSpy).toHaveBeenCalledWith(REMOTE_URL);
        expect(result.current.completion).toBe(' the bug');
    });

    it('uses the local client when baseUrl is omitted (getCocClientFor untouched)', async () => {
        localCompletion.mockResolvedValue({ completion: ' locally' });
        const { result } = renderHook(() =>
            usePromptAutocomplete({
                text: 'fix the ',
                cursorPos: 8,
                enabled: true,
                workspaceId: 'ws-1',
            }),
        );

        await act(async () => { await vi.runAllTimersAsync(); });

        expect(localCompletion).toHaveBeenCalledWith(
            expect.objectContaining({ prefix: 'fix the ', workspaceId: 'ws-1' }),
        );
        expect(remoteCompletion).not.toHaveBeenCalled();
        expect(getCocClientForSpy).not.toHaveBeenCalled();
        expect(result.current.completion).toBe(' locally');
    });
});

describe('useChatPromptHistory — clone routing (AC-07 DoD #3/#4)', () => {
    function ev(key: string) {
        return {
            key,
            ctrlKey: false,
            metaKey: false,
            altKey: false,
            shiftKey: false,
            preventDefault: vi.fn(),
        };
    }

    function makeState(overrides?: Record<string, unknown>) {
        return {
            value: '',
            cursorPos: 0,
            setValue: vi.fn(),
            enabled: true,
            workspaceId: 'ws-1' as string | undefined,
            ...overrides,
        };
    }

    it('reads prompt history from the remote clone; local client gets no request', async () => {
        remoteList.mockResolvedValue({ items: ['remote recent', 'remote old'] });
        const state = makeState({ baseUrl: REMOTE_URL });
        const { result } = renderHook(() => useChatPromptHistory(state));

        // First Up primes the fetch (swallowed), second Up walks to items[0].
        result.current.handleKeyDown(ev('ArrowUp'));
        await act(async () => {});
        result.current.handleKeyDown(ev('ArrowUp'));

        expect(remoteList).toHaveBeenCalledWith({ workspaceId: 'ws-1', limit: 50 });
        expect(localList).not.toHaveBeenCalled();
        expect(getCocClientForSpy).toHaveBeenCalledWith(REMOTE_URL);
        expect(state.setValue).toHaveBeenLastCalledWith('remote recent');
    });

    it('uses the local client when baseUrl is omitted (getCocClientFor untouched)', async () => {
        localList.mockResolvedValue({ items: ['local recent'] });
        const state = makeState();
        const { result } = renderHook(() => useChatPromptHistory(state));

        result.current.handleKeyDown(ev('ArrowUp'));
        await act(async () => {});
        result.current.handleKeyDown(ev('ArrowUp'));

        expect(localList).toHaveBeenCalledWith({ workspaceId: 'ws-1', limit: 50 });
        expect(remoteList).not.toHaveBeenCalled();
        expect(getCocClientForSpy).not.toHaveBeenCalled();
        expect(state.setValue).toHaveBeenLastCalledWith('local recent');
    });

    it('does not share cached history across server identities that use the same workspace id (DoD #4)', async () => {
        localList.mockResolvedValue({ items: ['LOCAL entry'] });
        remoteList.mockResolvedValue({ items: ['REMOTE entry'] });

        // Local origin, ws-1 → caches under the bare workspace key.
        const local = makeState();
        const localHook = renderHook(() => useChatPromptHistory(local));
        localHook.result.current.handleKeyDown(ev('ArrowUp'));
        await act(async () => {});
        localHook.result.current.handleKeyDown(ev('ArrowUp'));
        expect(local.setValue).toHaveBeenLastCalledWith('LOCAL entry');

        // Remote clone, SAME ws-1 → must fetch its own history under a
        // server-scoped key, not serve the local cache entry.
        const remote = makeState({ baseUrl: REMOTE_URL });
        const remoteHook = renderHook(() => useChatPromptHistory(remote));
        remoteHook.result.current.handleKeyDown(ev('ArrowUp'));
        await act(async () => {});
        remoteHook.result.current.handleKeyDown(ev('ArrowUp'));

        expect(remoteList).toHaveBeenCalledTimes(1);
        expect(remote.setValue).toHaveBeenLastCalledWith('REMOTE entry');
        // The local entry never leaked into the remote navigation.
        expect(remote.setValue).not.toHaveBeenCalledWith('LOCAL entry');
        // Each server fetched exactly once — no cross-server cache hit.
        expect(localList).toHaveBeenCalledTimes(1);
    });

    it('a second mount on the same server + workspace reads from the server-scoped cache (no refetch)', async () => {
        remoteList.mockResolvedValue({ items: ['remote cached'] });

        const first = makeState({ baseUrl: REMOTE_URL });
        const firstHook = renderHook(() => useChatPromptHistory(first));
        firstHook.result.current.handleKeyDown(ev('ArrowUp'));
        await act(async () => {});
        firstHook.result.current.handleKeyDown(ev('ArrowUp'));
        expect(first.setValue).toHaveBeenLastCalledWith('remote cached');
        expect(remoteList).toHaveBeenCalledTimes(1);

        // Second mount, same remote server + workspace → cache hit, no refetch.
        const second = makeState({ baseUrl: REMOTE_URL });
        const secondHook = renderHook(() => useChatPromptHistory(second));
        secondHook.result.current.handleKeyDown(ev('ArrowUp')); // cached → walks immediately
        expect(second.setValue).toHaveBeenLastCalledWith('remote cached');
        expect(remoteList).toHaveBeenCalledTimes(1);
    });
});
