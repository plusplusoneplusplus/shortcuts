import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { useRepoPreferences } from '../../../../src/server/spa/client/react/hooks/preferences/useRepoPreferences';
import { usePreferences } from '../../../../src/server/spa/client/react/hooks/preferences/usePreferences';
import { useChatPreferences } from '../../../../src/server/spa/client/react/features/chat/hooks/useChatPreferences';
import { useDefaultModelForMode } from '../../../../src/server/spa/client/react/hooks/useDefaultModelForMode';
import { registerCloneBaseUrls, resetCloneRegistryForTests } from '../../../../src/server/spa/client/react/repos/cloneRegistry';

const fetchMock = vi.fn();
const response = (value: unknown) => new Response(JSON.stringify(value), {
    status: 200, headers: { 'Content-Type': 'application/json' },
});

beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
    resetCloneRegistryForTests();
});
afterEach(() => {
    cleanup();
    resetCloneRegistryForTests();
    vi.unstubAllGlobals();
});

describe('shared repo preference consumers', () => {
    it('chat lists, model defaults, and last-used choices share one GET and warm reopening', async () => {
        fetchMock.mockImplementation(async () => response({
            lastModels: { task: 'last-model' },
            defaultModelsByProvider: { copilot: { ask: 'ask-model' }, codex: { ask: 'codex-model' } },
            lastChatProvider: 'codex',
            pinnedChats: { 'ws-1': ['pinned'] },
        }));
        const preferences = renderHook(() => usePreferences('ws-1'));
        const chats = renderHook(() => useChatPreferences('ws-1'));
        const defaults = renderHook(({ provider }) => useDefaultModelForMode('ws-1', 'ask', [], provider), {
            initialProps: { provider: 'copilot' },
        });
        await waitFor(() => {
            expect(preferences.result.current.models.task).toBe('last-model');
            expect(chats.result.current.pinnedChatIds.has('pinned')).toBe(true);
            expect(defaults.result.current.effectiveModel).toBe('ask-model');
        });
        defaults.rerender({ provider: 'codex' });
        expect(defaults.result.current.effectiveModel).toBe('codex-model');
        expect(fetchMock).toHaveBeenCalledTimes(1);
        preferences.unmount();
        chats.unmount();
        defaults.unmount();
        const reopened = renderHook(() => useRepoPreferences('ws-1'));
        expect(reopened.result.current?.lastChatProvider).toBe('codex');
        await act(async () => {});
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('successful last-used preference writes invalidate other readers for reopen', async () => {
        fetchMock.mockImplementation(async (_url, init) => response(
            init?.method === 'PATCH' ? { lastModels: { task: 'new-model' } } : { lastModels: { task: 'old-model' } },
        ));
        const preferences = renderHook(() => usePreferences('ws-1'));
        await waitFor(() => expect(preferences.result.current.loaded).toBe(true));
        await act(async () => { preferences.result.current.setModel('task', 'new-model'); });
        fetchMock.mockImplementation(async () => response({ lastModels: { task: 'new-model' } }));
        const reader = renderHook(() => useRepoPreferences('ws-1'));
        await waitFor(() => expect(reader.result.current?.lastModels?.task).toBe('new-model'));
        expect(fetchMock.mock.calls.filter(([, init]) => !init?.method)).toHaveLength(2);
    });

    it('drops a previous owner response when the same workspace changes servers', async () => {
        let resolveLocal!: (value: Response) => void;
        fetchMock.mockImplementation(url => String(url).startsWith('https://remote.example')
            ? Promise.resolve(response({ defaultModel: 'remote-model' }))
            : new Promise(resolve => { resolveLocal = resolve; }));
        const reader = renderHook(() => useRepoPreferences('ws-1'));
        await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
        act(() => registerCloneBaseUrls([{ workspaceId: 'ws-1', baseUrl: 'https://remote.example' }]));
        await waitFor(() => expect(reader.result.current?.defaultModel).toBe('remote-model'));
        await act(async () => { resolveLocal(response({ defaultModel: 'local-model' })); });
        expect(reader.result.current?.defaultModel).toBe('remote-model');
        expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
            '/api/workspaces/ws-1/preferences',
            'https://remote.example/api/workspaces/ws-1/preferences',
        ]);
    });

    it('does not paint a previous workspace preference while the next read is pending', async () => {
        let resolveNext!: (value: Response) => void;
        fetchMock.mockImplementation(url => String(url).includes('/ws-1/')
            ? Promise.resolve(response({ defaultModel: 'first-model' }))
            : new Promise(resolve => { resolveNext = resolve; }));
        const reader = renderHook(({ workspaceId }) => useRepoPreferences(workspaceId), {
            initialProps: { workspaceId: 'ws-1' },
        });
        await waitFor(() => expect(reader.result.current?.defaultModel).toBe('first-model'));
        reader.rerender({ workspaceId: 'ws-2' });
        expect(reader.result.current).toBeUndefined();
        await act(async () => { resolveNext(response({ defaultModel: 'next-model' })); });
        expect(reader.result.current?.defaultModel).toBe('next-model');
    });
});
