/** @vitest-environment jsdom */
/**
 * End-to-end Mark all read through the real coc-client, seenStateApi and
 * useUnseenChat: only unread rows are written, the mounted rows clear on
 * success for local and remote owners, and stalled requests are bounded.
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ToastContext } from '../../../../src/server/spa/client/react/contexts/ToastContext';
import { MARK_ALL_READ_TIMEOUT_MS, NativeRailUnreadChats } from '../../../../src/server/spa/client/react/features/chat/RailUnreadChats';
import { RailControlsContext } from '../../../../src/server/spa/client/react/features/repo-detail/RailHoverPreview';
import { useUnseenChat } from '../../../../src/server/spa/client/react/features/chat/hooks/useUnseenChat';
import { getCocClientFor, getSpaCocClient } from '../../../../src/server/spa/client/react/api/cocClient';

let ownerBaseUrl: string | undefined;
vi.mock('../../../../src/server/spa/client/react/repos/cloneRouting', async importOriginal => ({
    ...await importOriginal<object>(), useCloneBaseUrl: () => ownerBaseUrl,
}));
vi.mock('../../../../src/server/spa/client/react/contexts/AppContext', () => ({ useApp: () => ({ state: {} }) }));

const at = (n: number) => `2026-10-26T00:00:0${n}.000Z`;
const task = (id: string, n: number) => ({ id, workspaceId: 'ws-a', type: 'chat', status: 'completed', title: id, customTitle: id, completedAt: at(n) });
/** 150 read conversations across two pages plus two unread ones; the mounted list holds the first page. */
const read = Array.from({ length: 150 }, (_, i) => task(`queue_read${i}`, 1));
const all = [task('queue_unread1', 2), ...read.slice(0, 50), task('queue_unread2', 3), ...read.slice(50)];
let seen: Record<string, string>;
let patches: Array<{ url: string; entries: Array<{ processId: string; seenAt: string }> }>;
let urls: string[];
let stallPatch: boolean;
const addToast = vi.fn();

function json(body: unknown) {
    return Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } }));
}

function fetchMock(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const url = String(input);
    urls.push(url);
    const path = new URL(url, 'http://page.example').pathname;
    if (path.endsWith('/seen-state') && init?.method === 'PATCH') {
        const { entries } = JSON.parse(String(init.body));
        patches.push({ url, entries });
        if (stallPatch) return new Promise(() => {});
        for (const entry of entries) seen[entry.processId] = entry.seenAt;
        return json(seen);
    }
    if (path.endsWith('/seen-state')) return json(seen);
    if (path.endsWith('/history')) {
        const query = new URL(url, 'http://page.example').searchParams;
        const offset = Number(query.get('offset')), limit = Number(query.get('limit'));
        const history = all.slice(offset, offset + limit).map(item => ({ ...item, seenAt: seen[item.id] }));
        return json({ history, hasMore: offset + limit < all.length, offset, limit });
    }
    return Promise.reject(new Error(`unexpected ${url}`));
}

function Harness({ client }: { client: ReturnType<typeof getSpaCocClient> }) {
    const loaded = all.slice(0, 100);
    const { unseenProcessIds } = useUnseenChat('ws-a', loaded, null);
    return <NativeRailUnreadChats history={loaded} unseenProcessIds={unseenProcessIds} routeId="ws-a" tab="chats"
        client={client} workspaceId="ws-a" onOpen={vi.fn()} scopeKey="ws-a" scopeLabel="Alpha" />;
}

function mount(client: ReturnType<typeof getSpaCocClient>) {
    return render(<ToastContext.Provider value={{ addToast, removeToast: vi.fn(), toasts: [] }}>
        <RailControlsContext.Provider value={{ hoverEnabled: true, onExpand: vi.fn(), onPreview: vi.fn() }}>
            <Harness client={client} />
        </RailControlsContext.Provider>
    </ToastContext.Provider>);
}

const trigger = () => screen.getByTestId('split-workspace-left-unread');

beforeEach(() => {
    vi.clearAllMocks();
    seen = Object.fromEntries(read.map(item => [item.id, item.completedAt]));
    patches = [];
    urls = [];
    stallPatch = false;
    ownerBaseUrl = undefined;
    vi.stubGlobal('fetch', vi.fn(fetchMock));
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('Mark all read against the owner API', () => {
    it.each([
        ['local page-origin', undefined],
        ['remote', 'https://box-b.example'],
    ])('writes only unread rows and clears the mounted %s rows on success', async (_label, baseUrl) => {
        ownerBaseUrl = baseUrl;
        mount(baseUrl ? getCocClientFor(baseUrl) : getSpaCocClient());
        await waitFor(() => expect(trigger()).toHaveAccessibleName('2 unread conversations'));
        fireEvent.click(trigger());
        fireEvent.click(screen.getByRole('button', { name: 'Mark all read' }));
        await waitFor(() => expect(trigger()).toHaveAccessibleName('0 unread conversations'));
        expect(patches).toHaveLength(1);
        expect(patches[0].entries).toEqual([
            { processId: 'queue_unread1', seenAt: at(2) },
            { processId: 'queue_unread2', seenAt: at(3) },
        ]);
        for (const url of urls) expect(url.startsWith(baseUrl ?? '/api/')).toBe(true);
        expect(screen.getByRole('button', { name: 'Mark all read' })).toBeDisabled();
        expect(screen.queryByRole('alert')).toBeNull();
    });

    it('releases a stalled write with an actionable error, keeps rows unread and allows retry', async () => {
        mount(getSpaCocClient());
        await waitFor(() => expect(trigger()).toHaveAccessibleName('2 unread conversations'));
        vi.useFakeTimers();
        stallPatch = true;
        fireEvent.click(trigger());
        await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Mark all read' })); });
        await act(async () => { await vi.advanceTimersByTimeAsync(0); });
        expect(patches).toHaveLength(1);
        expect(screen.getByRole('button', { name: 'Marking…' })).toBeDisabled();
        await act(async () => { await vi.advanceTimersByTimeAsync(MARK_ALL_READ_TIMEOUT_MS); });
        expect(screen.getByRole('alert')).toHaveTextContent('timed out');
        expect(addToast).toHaveBeenCalledWith(expect.stringContaining('try again'), 'error');
        expect(trigger()).toHaveAccessibleName('2 unread conversations');
        stallPatch = false;
        await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Mark all read' })); });
        await act(async () => { await vi.advanceTimersByTimeAsync(0); });
        expect(trigger()).toHaveAccessibleName('0 unread conversations');
        expect(screen.queryByRole('alert')).toBeNull();
    });
});
