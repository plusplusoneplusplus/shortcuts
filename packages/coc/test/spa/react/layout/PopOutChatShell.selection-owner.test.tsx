import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { ConnectEventsOptions } from '@plusplusoneplusplus/coc-client';

vi.mock('../../../../src/server/spa/client/react/api/cocClient', async importOriginal => ({
    ...await importOriginal<typeof import('../../../../src/server/spa/client/react/api/cocClient')>(),
    getCocClientFor: (baseUrl: string) => ({
        events: { connect: (options: ConnectEventsOptions) => {
            const close = vi.fn();
            connections.push({ baseUrl, options, close });
            return { close };
        } },
    }),
}));

vi.mock('../../../../src/server/spa/client/react/contexts/AppContext', () => ({
    AppProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock('../../../../src/server/spa/client/react/contexts/QueueContext', () => ({
    QueueProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock('../../../../src/server/spa/client/react/contexts/ReposContext', () => ({
    ReposProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock('../../../../src/server/spa/client/react/contexts/useQueueBootstrap', () => ({
    useQueueBootstrap: () => bootstrapQueue,
}));
vi.mock('../../../../src/server/spa/client/react/layout/ThemeProvider', () => ({
    ThemeProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock('../../../../src/server/spa/client/react/contexts/ToastContext', () => ({
    ToastProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock('../../../../src/server/spa/client/react/contexts/ChatPreferencesContext', () => ({
    ChatPreferencesProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock('../../../../src/server/spa/client/react/ui', () => ({
    ToastContainer: () => null,
    useToast: () => ({ toasts: [], addToast: vi.fn(), removeToast: vi.fn() }),
}));
vi.mock('../../../../src/server/spa/client/react/features/chat/hooks/usePopOutChannel', () => ({
    usePopOutChannel: () => ({ postMessage }),
}));
vi.mock('../../../../src/server/spa/client/react/utils/config', () => ({
    getHostname: () => '',
}));
vi.mock('../../../../src/server/spa/client/react/features/chat/ChatDetail', () => ({
    ChatDetail: ({ workspaceId, sourceSelectionId, sourceBaseUrl, isPopOut }: {
        workspaceId?: string;
        sourceSelectionId?: string;
        sourceBaseUrl?: string;
        isPopOut?: boolean;
    }) => <div data-testid="chat-owner" data-workspace={workspaceId}
        data-destination={sourceSelectionId} data-endpoint={sourceBaseUrl}
        data-popout={String(isPopOut)} />,
}));

const { bootstrapQueue, postMessage, connections } = vi.hoisted(() => ({
    bootstrapQueue: vi.fn().mockResolvedValue(undefined),
    postMessage: vi.fn(),
    connections: [] as Array<{ baseUrl: string; options: ConnectEventsOptions; close: ReturnType<typeof vi.fn> }>,
}));
import { PopOutChatShell } from '../../../../src/server/spa/client/react/layout/PopOutChatShell';
import { lookupCloneBaseUrl, registerCloneBaseUrls } from '../../../../src/server/spa/client/react/repos/cloneRegistry';

function setOwner(owner: string, endpoint?: string) {
    const params = new URLSearchParams({ workspace: 'ws-1', sourceSelectionId: owner });
    if (endpoint) params.set('cloneBaseUrl', endpoint);
    window.history.replaceState(null, '', `/?${params}#popout/activity/task-1`);
}

beforeEach(() => {
    registerCloneBaseUrls([]);
    vi.clearAllMocks();
    connections.length = 0;
});

describe('PopOutChatShell selection ownership', () => {
    const owners: Array<[string, string?]> = [
        ['ws-1', undefined],
        ['remote:server-a:ws-1', 'https://clone-a.example.test'],
        ['remote:server-b:ws-1', 'https://clone-b.example.test'],
    ];
    it.each(owners)('passes explicit route owner %s to its standalone composer', (owner, endpoint) => {
        setOwner(owner, endpoint);
        render(<PopOutChatShell />);
        const chat = screen.getByTestId('chat-owner');
        expect(chat.getAttribute('data-workspace')).toBe('ws-1');
        expect(chat.getAttribute('data-destination')).toBe(owner);
        expect(chat.getAttribute('data-endpoint')).toBe(endpoint ?? null);
        expect(chat.getAttribute('data-popout')).toBe('true');
        if (endpoint) expect(lookupCloneBaseUrl(owner)).toBe(endpoint);
        expect(bootstrapQueue).toHaveBeenCalledOnce();
        expect(connections.map(connection => connection.baseUrl)).toEqual(endpoint ? [endpoint] : []);
    });

    it('relays exact-owner inventory invalidations and reconnects, replacing and closing the remote transport', () => {
        setOwner('remote:server-a:ws-1', 'https://clone-a.example.test');
        const messageListener = vi.fn();
        const connectListener = vi.fn();
        window.addEventListener('coc-remote-ws-message', messageListener);
        window.addEventListener('coc-remote-ws-connect', connectListener);
        const view = render(<PopOutChatShell />);
        const first = connections[0];
        const message = { type: 'tool-inventory-changed', workspaceId: 'ws-1',
            processId: 'proc-1', turnId: 'next-turn', state: 'pending' };
        first.options.onMessage(message);
        first.options.onOpen?.();
        expect(messageListener.mock.calls[0][0].detail).toEqual({ baseUrl: first.baseUrl, message });
        expect(connectListener.mock.calls[0][0].detail).toEqual({ baseUrl: first.baseUrl });
        setOwner('remote:server-b:ws-1', 'https://clone-b.example.test');
        view.rerender(<PopOutChatShell />);
        expect(first.close).toHaveBeenCalledOnce();
        first.options.onMessage(message);
        first.options.onOpen?.();
        expect(messageListener).toHaveBeenCalledOnce();
        expect(connectListener).toHaveBeenCalledOnce();
        const second = connections[1];
        second.options.onMessage({ ...message, state: 'captured' });
        expect(messageListener.mock.calls[1][0].detail).toEqual({
            baseUrl: second.baseUrl, message: { ...message, state: 'captured' },
        });
        view.unmount();
        expect(second.close).toHaveBeenCalledOnce();
        second.options.onMessage(message);
        expect(messageListener).toHaveBeenCalledTimes(2);
        window.removeEventListener('coc-remote-ws-message', messageListener);
        window.removeEventListener('coc-remote-ws-connect', connectListener);
    });

    it('replaces the explicit owner when the window route changes', () => {
        setOwner('remote:server-a:ws-1', 'https://clone-a.example.test');
        const view = render(<PopOutChatShell />);
        setOwner('remote:server-b:ws-1', 'https://clone-b.example.test');
        view.rerender(<PopOutChatShell />);
        const chat = screen.getByTestId('chat-owner');
        expect(chat.getAttribute('data-destination')).toBe('remote:server-b:ws-1');
        expect(chat.getAttribute('data-endpoint')).toBe('https://clone-b.example.test');
        expect(lookupCloneBaseUrl('remote:server-b:ws-1')).toBe('https://clone-b.example.test');
        expect(lookupCloneBaseUrl('remote:server-a:ws-1')).toBeUndefined();
    });
});
