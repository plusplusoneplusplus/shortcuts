// @vitest-environment jsdom
/**
 * AC-07 DoD #3/#5 (subtask 8d, useNotesChat half) — Notes chat binding + creation
 * route to the OWNING clone's server and never fall through to the local origin
 * client, including on request failure.
 *
 * useNotesChat resolves its client via `useCocClient(workspaceId)` (the real
 * cloneRouting primitive). This test registers `ws-1` as a REMOTE clone in the
 * clone registry and gives `getCocClientFor(baseUrl)` a distinct REMOTE fake, then
 * proves:
 *   - listChatBindings (mount seed), createChat, and deleteChatBindingByPath all
 *     hit the REMOTE client for a remote workspace; the LOCAL client gets no call.
 *   - a REMOTE createChat rejection surfaces as a null result (which the Notes
 *     adapter turns into the shared inline error) with NO retry through the local
 *     client — there is no silent local fallback.
 *   - an UNREGISTERED (local) workspace keeps every call on the origin client and
 *     never touches getCocClientFor, so local callers are unchanged.
 *
 * The per-hook config/history/autocomplete routing and the composer-level wiring
 * are covered by providerHooks-clone-routing / promptHooks-clone-routing and
 * InitialChatComposer-clone-routing; this file covers the Notes chat-create seam.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// ── Per-baseUrl fake clients: one LOCAL origin, plus a REMOTE registry keyed by
// baseUrl. Each records the notes calls it received. ──────────────────────────
function makeNotesClient(label: string) {
    return {
        label,
        notes: {
            listChatBindings: vi.fn(async () => ({ bindings: {} as Record<string, { taskId: string }> })),
            createChat: vi.fn(async (_workspaceId: string, _request: any) => ({ task: { id: `${label}-task` } })),
            deleteChatBindingByPath: vi.fn(async () => undefined),
        },
    };
}

const LOCAL = makeNotesClient('local');
const remotes = new Map<string, ReturnType<typeof makeNotesClient>>();
const getCocClientForSpy = vi.fn((baseUrl?: string) => {
    if (!baseUrl) throw new Error('getCocClientFor called without a baseUrl');
    let c = remotes.get(baseUrl);
    if (!c) { c = makeNotesClient(`remote:${baseUrl}`); remotes.set(baseUrl, c); }
    return c;
});

vi.mock('../../../../src/server/spa/client/react/api/cocClient', () => ({
    getSpaCocClient: () => LOCAL,
    getCocClientFor: (baseUrl?: string) => getCocClientForSpy(baseUrl),
}));

import { useNotesChat } from '../../../../src/server/spa/client/react/features/notes/hooks/useNotesChat';
import {
    registerCloneBaseUrls,
    resetCloneRegistryForTests,
} from '../../../../src/server/spa/client/react/repos/cloneRegistry';

const WS_REMOTE = 'ws-1';
const REMOTE_URL = 'http://remote-a:4000';
const WS_LOCAL = 'ws-local';

function remoteFor(baseUrl: string) {
    let c = remotes.get(baseUrl);
    if (!c) { c = makeNotesClient(`remote:${baseUrl}`); remotes.set(baseUrl, c); }
    return c;
}

async function flushSeed() {
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
}

beforeEach(() => {
    localStorage.clear();
    resetCloneRegistryForTests();
    remotes.clear();
    getCocClientForSpy.mockClear();
    LOCAL.notes.listChatBindings.mockClear();
    LOCAL.notes.createChat.mockClear();
    LOCAL.notes.deleteChatBindingByPath.mockClear();
    registerCloneBaseUrls([{ workspaceId: WS_REMOTE, baseUrl: REMOTE_URL }]);
});

afterEach(() => {
    resetCloneRegistryForTests();
});

describe('useNotesChat — clone routing (AC-07 DoD #3/#5)', () => {
    it('seeds bindings, creates the chat, and resets bindings against the REMOTE clone, never the local client', async () => {
        const notePath = 'Docs/Note.md';
        const { result } = renderHook(() =>
            useNotesChat({ workspaceId: WS_REMOTE, notePath, noteTitle: 'Note' }),
        );
        await flushSeed();

        const remote = remoteFor(REMOTE_URL);

        // Mount seed read the remote server's bindings.
        expect(remote.notes.listChatBindings).toHaveBeenCalledWith(WS_REMOTE);
        expect(LOCAL.notes.listChatBindings).not.toHaveBeenCalled();

        await act(async () => { await result.current.createChat('Ask about this note'); });

        // createChat hit REMOTE, and the local origin client was never touched.
        expect(remote.notes.createChat).toHaveBeenCalledTimes(1);
        expect(remote.notes.createChat.mock.calls[0][0]).toBe(WS_REMOTE);
        expect(LOCAL.notes.createChat).not.toHaveBeenCalled();
        expect(result.current.taskId).toBe(`remote:${REMOTE_URL}-task`);

        // resetChat's best-effort binding cleanup also stays on the remote server.
        act(() => { result.current.resetChat(); });
        expect(remote.notes.deleteChatBindingByPath).toHaveBeenCalledWith(WS_REMOTE, notePath);
        expect(LOCAL.notes.deleteChatBindingByPath).not.toHaveBeenCalled();

        // getCocClientFor was only ever asked for the remote baseUrl.
        expect(getCocClientForSpy.mock.calls.every(c => c[0] === REMOTE_URL)).toBe(true);
    });

    it('surfaces a REMOTE createChat failure as a null result with no local fallback', async () => {
        const remote = remoteFor(REMOTE_URL);
        remote.notes.createChat.mockRejectedValueOnce(new Error('remote offline'));

        const { result } = renderHook(() =>
            useNotesChat({ workspaceId: WS_REMOTE, notePath: 'Docs/Note.md', noteTitle: 'Note' }),
        );
        await flushSeed();

        let outcome: string | null = 'unset';
        await act(async () => { outcome = await result.current.createChat('Ask about this note'); });

        // The failure returns null (the adapter converts this to the shared inline
        // error) and no binding is recorded — and it NEVER retries through local.
        expect(outcome).toBeNull();
        expect(result.current.taskId).toBeNull();
        expect(remote.notes.createChat).toHaveBeenCalledTimes(1);
        expect(LOCAL.notes.createChat).not.toHaveBeenCalled();
    });

    it('keeps an unregistered (local) workspace on the origin client and never calls getCocClientFor', async () => {
        const { result } = renderHook(() =>
            useNotesChat({ workspaceId: WS_LOCAL, notePath: 'Docs/Note.md', noteTitle: 'Note' }),
        );
        await flushSeed();

        await act(async () => { await result.current.createChat('Ask about this note'); });

        expect(LOCAL.notes.listChatBindings).toHaveBeenCalledWith(WS_LOCAL);
        expect(LOCAL.notes.createChat).toHaveBeenCalledTimes(1);
        expect(LOCAL.notes.createChat.mock.calls[0][0]).toBe(WS_LOCAL);
        // Local resolution uses getSpaCocClient() directly; the remote resolver is
        // never consulted for a local clone.
        expect(getCocClientForSpy).not.toHaveBeenCalled();
        expect(remotes.size).toBe(0);
    });
});
