/** @vitest-environment jsdom */
/**
 * Mark all read through the real clone routing used by RepoChatTab: the
 * clone-keyed owner client, the raw-id unseen reader and the native rail.
 * A local page-origin workspace shares the remote raw id, so every request is
 * attributed to its server.
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ToastContext } from '../../../../src/server/spa/client/react/contexts/ToastContext';
import { NativeRailUnreadChats } from '../../../../src/server/spa/client/react/features/chat/RailUnreadChats';
import { RailControlsContext } from '../../../../src/server/spa/client/react/features/repo-detail/RailHoverPreview';
import { useUnseenChat } from '../../../../src/server/spa/client/react/features/chat/hooks/useUnseenChat';
import { useCocClient } from '../../../../src/server/spa/client/react/repos/cloneRouting';
import { registerCloneBaseUrls, resetCloneRegistryForTests, setActiveCloneForRouting } from '../../../../src/server/spa/client/react/repos/cloneRegistry';
import { workspaceReadSource } from '../../../../src/server/spa/client/react/api/workspaceReads';

vi.mock('../../../../src/server/spa/client/react/contexts/AppContext', () => ({ useApp: () => ({ state: {} }) }));

const REMOTE = 'http://127.0.0.1:5555';
const REMOTE_ROUTE = 'remote:ubuntu-arm:ws-a';
const at = (n: number) => new Date(Date.UTC(2026, 9, 28, 0, 0, n)).toISOString();

interface Item { id: string; workspaceId: string; type: string; status: string; title: string; endTime: number }

/** One owner server: its own rows and seen map, with or without the unread history filter. */
class OwnerServer {
    readonly requests: string[] = [];
    readonly seen: Record<string, string> = {};
    failWrite = false;
    constructor(readonly items: Item[], unread: string[], readonly supportsUnseen: boolean) {
        for (const item of items) if (!unread.includes(item.id)) this.seen[item.id] = new Date(item.endTime).toISOString();
    }

    handle(url: URL, init?: RequestInit): Promise<Response> {
        this.requests.push(`${init?.method ?? 'GET'} ${url.pathname}${url.search}`);
        if (url.pathname === '/api/workspaces/ws-a/seen-state' && init?.method === 'PATCH') {
            if (this.failWrite) return reply(503, { error: 'owner unavailable' });
            for (const entry of JSON.parse(String(init.body)).entries) this.seen[entry.processId] = entry.seenAt;
            return reply(200, this.seen);
        }
        if (url.pathname === '/api/workspaces/ws-a/seen-state') return reply(200, this.seen);
        if (url.pathname === '/api/workspaces/ws-a/history') {
            const offset = Number(url.searchParams.get('offset') ?? 0), limit = Number(url.searchParams.get('limit') ?? 100);
            const rows = this.supportsUnseen && url.searchParams.get('unseen') === 'true'
                ? this.items.filter(item => this.seen[item.id] !== new Date(item.endTime).toISOString())
                : this.items;
            const history = rows.slice(offset, offset + limit).map(item => ({ ...item, seenAt: this.seen[item.id] }));
            return reply(200, { history, hasMore: offset + limit < rows.length, offset, limit });
        }
        return reply(404, { error: `unexpected ${url.pathname}` });
    }
}

function reply(status: number, body: unknown) {
    return Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }));
}

const rows = (prefix: string, count: number, n = 1): Item[] => Array.from({ length: count }, (_, i) => (
    { id: `${prefix}${i}`, workspaceId: 'ws-a', type: 'chat', status: 'completed', title: `${prefix}${i}`, endTime: Date.parse(at(n)) }
));
let remote: OwnerServer;
let local: OwnerServer;
const addToast = vi.fn();

function Harness({ routeId, loaded }: { routeId: string; loaded: Item[] }) {
    // RepoChatTab: the list/mark-all client follows the clone key, the reader the raw id.
    const client = useCocClient(routeId);
    const { unseenProcessIds } = useUnseenChat('ws-a', loaded, null);
    return <NativeRailUnreadChats history={loaded} unseenProcessIds={unseenProcessIds} routeId={routeId} tab="chats"
        client={client} workspaceId="ws-a" onOpen={vi.fn()} scopeKey={`${routeId}:${workspaceReadSource(client)}`}
        scopeLabel="ubuntu-arm / shortcuts" />;
}

function mount(routeId: string, owner: OwnerServer) {
    setActiveCloneForRouting(routeId);
    const loaded = owner.items.slice(0, 100);
    return render(<ToastContext.Provider value={{ addToast, removeToast: vi.fn(), toasts: [] }}>
        <RailControlsContext.Provider value={{ hoverEnabled: true, onExpand: vi.fn(), onPreview: vi.fn() }}>
            <Harness routeId={routeId} loaded={loaded} />
        </RailControlsContext.Provider>
    </ToastContext.Provider>);
}

const trigger = () => screen.getByTestId('split-workspace-left-unread');
const markAll = () => {
    fireEvent.click(trigger());
    fireEvent.click(screen.getByRole('button', { name: 'Mark all read' }));
};

function owners(remoteSupportsUnseen: boolean) {
    // Unread rows sit on the first page and beyond the loaded page; the local
    // workspace with the same raw id has different unread rows.
    remote = new OwnerServer([rows('queue_new', 1, 3)[0], ...rows('queue_read', 150), rows('queue_old', 1, 2)[0], ...rows('queue_more', 100)],
        ['queue_new0', 'queue_old0'], remoteSupportsUnseen);
    local = new OwnerServer([...rows('queue_local', 3, 4)], ['queue_local0', 'queue_local1'], true);
}

beforeEach(() => {
    vi.clearAllMocks();
    owners(true);
    resetCloneRegistryForTests();
    registerCloneBaseUrls([{ workspaceId: 'ws-a', serverId: 'ubuntu-arm', cloneKey: REMOTE_ROUTE, baseUrl: REMOTE }]);
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        return url.startsWith(REMOTE)
            ? remote.handle(new URL(url), init)
            : local.handle(new URL(url, 'http://dashboard.local'), init);
    }));
});
afterEach(() => { cleanup(); resetCloneRegistryForTests(); vi.unstubAllGlobals(); });

describe('Mark all read on a remote repository', () => {
    it('reads unread rows from the remote owner in one request, writes them there and clears the rail', async () => {
        mount(REMOTE_ROUTE, remote);
        await waitFor(() => expect(trigger()).toHaveAccessibleName('1 unread conversation'));
        markAll();
        await waitFor(() => expect(trigger()).toHaveAccessibleName('0 unread conversations'));
        expect(remote.requests.filter(r => r.startsWith('GET /api/workspaces/ws-a/history'))).toEqual([
            'GET /api/workspaces/ws-a/history?limit=100&offset=0&unseen=true',
        ]);
        expect(remote.requests).toContain('PATCH /api/workspaces/ws-a/seen-state');
        expect(remote.seen.queue_new0).toBe(at(3));
        expect(remote.seen.queue_old0).toBe(at(2));
        expect(local.requests).toEqual([]);
        expect(local.seen.queue_local0).toBeUndefined();
        expect(screen.queryByRole('alert')).toBeNull();
    });

    it('still writes only the unread rows when the remote owner predates the unread filter', async () => {
        owners(false);
        mount(REMOTE_ROUTE, remote);
        await waitFor(() => expect(trigger()).toHaveAccessibleName('1 unread conversation'));
        markAll();
        await waitFor(() => expect(trigger()).toHaveAccessibleName('0 unread conversations'));
        expect(remote.requests.filter(r => r.startsWith('GET /api/workspaces/ws-a/history'))).toHaveLength(3);
        expect(Object.keys(remote.seen)).toHaveLength(remote.items.length);
        expect(local.requests).toEqual([]);
    });

    it('reports a failed remote write without a local fallback or a success-shaped refresh', async () => {
        remote.failWrite = true;
        mount(REMOTE_ROUTE, remote);
        await waitFor(() => expect(trigger()).toHaveAccessibleName('1 unread conversation'));
        markAll();
        await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
        expect(addToast).toHaveBeenCalledWith(expect.any(String), 'error');
        expect(trigger()).toHaveAccessibleName('1 unread conversation');
        expect(remote.seen.queue_new0).toBeUndefined();
        expect(screen.getByRole('button', { name: 'Mark all read' })).toBeEnabled();
        expect(local.requests).toEqual([]);
    });

    it('keeps a local workspace with the same raw id on the page origin', async () => {
        mount('ws-a', local);
        await waitFor(() => expect(trigger()).toHaveAccessibleName('2 unread conversations'));
        markAll();
        await waitFor(() => expect(trigger()).toHaveAccessibleName('0 unread conversations'));
        expect(local.seen.queue_local0).toBe(at(4));
        expect(local.requests).toContain('GET /api/workspaces/ws-a/history?limit=100&offset=0&unseen=true');
        expect(remote.requests).toEqual([]);
    });
});
