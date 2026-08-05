/**
 * @vitest-environment jsdom
 *
 * Regression: Quick Ask side-notes must be read and written on the workspace's
 * OWN server.
 *
 * Bug: the hook issued its GET / POST / DELETE through the local-origin
 * `fetchApi`. The sidenotes routes only call `isValidWorkspaceId` — they never
 * resolve the workspace — so for a REMOTE clone the LOCAL server happily served
 * the request and the manager created a real directory tree at
 * `{dataDir}/repos/<remote-workspace-id>/chat-sidenotes/` on the wrong host.
 * (The POST additionally checked `processExists` against the local store, which
 * a remote process never satisfies, so the lookup errored out too.)
 *
 * Fix: route all three through `requestForWorkspace(workspaceId, …)`. A remote
 * clone's calls carry its base URL; a local (unregistered) id keeps the relative
 * page-origin URL — byte-for-byte unchanged.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

vi.mock('../../../../src/server/spa/client/react/hooks/feature-flags/useQuickAskSidenotesEnabled', () => ({
    useQuickAskSidenotesEnabled: () => true,
}));

import {
    registerCloneBaseUrls,
    resetCloneRegistryForTests,
} from '../../../../src/server/spa/client/react/repos/cloneRegistry';
import { useQuickAskSidenotes } from '../../../../src/server/spa/client/react/features/chat/quick-ask/useQuickAskSidenotes';
import type { QuickAskSelection } from '../../../../src/server/spa/client/react/features/chat/quick-ask/types';

const REMOTE_WS = 'ws-47v03z';
const REMOTE_BASE = 'http://127.0.0.1:4001';
const LOCAL_WS = 'ws-local';

const PERSISTED = {
    id: 's1',
    processId: 'p1',
    turnIndex: 0,
    anchor: { selectedText: 'x', contextBefore: '', contextAfter: '', fingerprint: 'f' },
    answer: 'A',
    label: 'x',
    createdAt: 't',
};

function jsonResponse(data: unknown): Partial<Response> {
    return {
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => data,
        text: async () => JSON.stringify(data),
    };
}

function selection(): QuickAskSelection {
    return {
        turnIndex: 1,
        selectedText: 'Daly formula',
        contextBefore: 'the ',
        contextAfter: ' metric',
        rect: { top: 0, left: 0, bottom: 0, right: 0 },
    };
}

describe('useQuickAskSidenotes — remote-clone request routing', () => {
    let urls: string[];

    beforeEach(() => {
        resetCloneRegistryForTests();
        urls = [];
        vi.stubGlobal('fetch', vi.fn((input: string | URL | Request) => {
            const url = String(input);
            urls.push(url);
            return Promise.resolve(jsonResponse({ sidenotes: [PERSISTED], sidenote: PERSISTED }));
        }));
    });

    afterEach(() => {
        resetCloneRegistryForTests();
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    async function driveAllThree(workspaceId: string) {
        const { result } = renderHook(() => useQuickAskSidenotes('p1', workspaceId));
        // GET (hydrate)
        await waitFor(() => expect(result.current.items).toHaveLength(1));
        // POST (create)
        await act(async () => { result.current.createSidenote(selection()); });
        await waitFor(() => expect(urls.length).toBeGreaterThan(1));
        // DELETE (the hydrated, persisted note)
        await act(async () => { result.current.deleteSidenote('s1'); });
        await waitFor(() => expect(urls.some(u => u.includes('/sidenotes/s1'))).toBe(true));
    }

    it('regression: all three sidenote calls hit the remote clone, never the local server', async () => {
        registerCloneBaseUrls([{ workspaceId: REMOTE_WS, baseUrl: REMOTE_BASE }]);

        await driveAllThree(REMOTE_WS);

        const get = urls.find(u => u.endsWith(`/sidenotes?workspace=${REMOTE_WS}`));
        const del = urls.find(u => u.includes('/sidenotes/s1'));
        expect(get).toBeTruthy();
        expect(del).toBeTruthy();
        // GET + POST share the same URL; assert every recorded call is remote so
        // no local fallthrough can hide behind a deduped list.
        expect(urls.length).toBeGreaterThanOrEqual(3);
        for (const u of urls) {
            expect(u.startsWith(`${REMOTE_BASE}/api/processes/p1/sidenotes`)).toBe(true);
        }
    });

    it('a local (unregistered) workspace keeps the relative page-origin URLs', async () => {
        await driveAllThree(LOCAL_WS);

        expect(urls.length).toBeGreaterThanOrEqual(3);
        for (const u of urls) {
            expect(u.startsWith(REMOTE_BASE)).toBe(false);
            expect(u.startsWith('/api/processes/p1/sidenotes')).toBe(true);
        }
        expect(urls).toContain(`/api/processes/p1/sidenotes?workspace=${LOCAL_WS}`);
        expect(urls).toContain(`/api/processes/p1/sidenotes/s1?workspace=${LOCAL_WS}`);
    });
});
