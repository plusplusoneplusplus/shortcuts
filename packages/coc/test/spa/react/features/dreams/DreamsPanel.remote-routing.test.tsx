/**
 * @vitest-environment jsdom
 *
 * Regression tests: the Dreams panel must read and write the dream store and the
 * per-repo preferences on the clone's OWN server, not the local origin.
 *
 * Bug: DreamsPanel called everything through the bare getSpaCocClient(), which
 * always targets the LOCAL server. Neither failure mode is a 404 — both are
 * silent wrong-host data:
 *   • The dreams routes never resolve the workspace, so a remote clone id hit the
 *     local FileDreamStore and got HTTP 200 with an EMPTY card list.
 *   • /workspaces/:id/preferences is keyed by id only, so "Enable Dreams for this
 *     workspace" wrote a preference file on the local server and the remote server
 *     that actually runs the dream never saw it.
 *
 * Fix: route every workspace-scoped call through getCocClientForWorkspace(workspaceId).
 * A local (unregistered) workspace still resolves to the default page-origin
 * client — byte-for-byte unchanged.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import {
    registerCloneBaseUrls,
    resetCloneRegistryForTests,
} from '../../../../../src/server/spa/client/react/repos/cloneRegistry';

vi.mock('../../../../../src/server/spa/client/react/utils/config', async importOriginal => ({
    ...(await importOriginal<typeof import('../../../../../src/server/spa/client/react/utils/config')>()),
    isDreamsEnabled: () => true,
}));

import { DreamsPanel } from '../../../../../src/server/spa/client/react/features/dreams/DreamsPanel';

const REMOTE_WS = 'ws-remote-dreams';
const REMOTE_BASE = 'http://127.0.0.1:4001';
const LOCAL_WS = 'ws-local-dreams';

function jsonResponse(data: unknown): Partial<Response> {
    return {
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => data,
        text: async () => JSON.stringify(data),
    };
}

interface Call { url: string; method: string }

function makeFetchSpy(calls: Call[]) {
    return vi.fn((input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        calls.push({ url, method: (init?.method ?? 'GET').toUpperCase() });
        if (url.includes('/preferences')) {
            return Promise.resolve(jsonResponse({ dreams: { enabled: true } }));
        }
        if (url.includes('/dreams/cards')) {
            return Promise.resolve(jsonResponse({ cards: [] }));
        }
        if (url.includes('/dreams/run')) {
            return Promise.resolve(jsonResponse({
                task: { id: 'task-dream-1', displayName: 'Dream run', status: 'queued', payload: {} },
            }));
        }
        return Promise.resolve(jsonResponse({}));
    });
}

const wsScoped = (calls: Call[], wsId: string) =>
    calls.filter(c => c.url.includes(`/workspaces/${wsId}/`));

describe('DreamsPanel — remote-clone request routing', () => {
    let calls: Call[];

    beforeEach(() => {
        resetCloneRegistryForTests();
        calls = [];
        vi.stubGlobal('fetch', makeFetchSpy(calls));
    });

    afterEach(() => {
        resetCloneRegistryForTests();
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    it('regression: reads repo preferences and the dream cards from the remote clone server', async () => {
        registerCloneBaseUrls([{ workspaceId: REMOTE_WS, baseUrl: REMOTE_BASE }]);

        render(<DreamsPanel workspaceId={REMOTE_WS} />);

        await waitFor(() => {
            expect(calls.some(c => c.url.includes(`/workspaces/${REMOTE_WS}/dreams/cards`))).toBe(true);
        });

        const prefs = calls.find(c => c.url.includes(`/workspaces/${REMOTE_WS}/preferences`));
        expect(prefs).toBeTruthy();
        // A local-origin read returns the LOCAL server's prefs, so the panel showed
        // "workspace dreaming is off" for an enabled remote repo.
        expect(prefs!.url.startsWith(REMOTE_BASE)).toBe(true);

        const cards = calls.find(c => c.url.includes(`/workspaces/${REMOTE_WS}/dreams/cards`));
        // A local-origin list answers 200 with an EMPTY card list — silently wrong.
        expect(cards!.url.startsWith(REMOTE_BASE)).toBe(true);

        // No workspace-scoped call falls through to the local origin.
        expect(wsScoped(calls, REMOTE_WS).length).toBeGreaterThan(1);
        for (const c of wsScoped(calls, REMOTE_WS)) {
            expect(c.url.startsWith(REMOTE_BASE)).toBe(true);
        }
    });

    it('regression: "Run dreams now" enqueues on the remote clone server, never the local one', async () => {
        registerCloneBaseUrls([{ workspaceId: REMOTE_WS, baseUrl: REMOTE_BASE }]);

        render(<DreamsPanel workspaceId={REMOTE_WS} />);
        await waitFor(() => {
            expect(calls.some(c => c.url.includes(`/workspaces/${REMOTE_WS}/dreams/cards`))).toBe(true);
        });

        fireEvent.click(await screen.findByTestId('dreams-run-now'));

        await waitFor(() => {
            expect(calls.some(c => c.url.includes(`/workspaces/${REMOTE_WS}/dreams/run`))).toBe(true);
        });

        const run = calls.find(c => c.url.includes(`/workspaces/${REMOTE_WS}/dreams/run`))!;
        expect(run.method).toBe('POST');
        expect(run.url.startsWith(REMOTE_BASE)).toBe(true);
    });

    it('a local (unregistered) workspace keeps using the local origin', async () => {
        render(<DreamsPanel workspaceId={LOCAL_WS} />);

        await waitFor(() => {
            expect(calls.some(c => c.url.includes(`/workspaces/${LOCAL_WS}/dreams/cards`))).toBe(true);
        });

        const local = wsScoped(calls, LOCAL_WS);
        expect(local.length).toBeGreaterThan(1);
        for (const c of local) {
            expect(c.url.startsWith(REMOTE_BASE)).toBe(false);
            expect(c.url.startsWith('http')).toBe(false);
        }
    });
});
