/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const terminalPanelMockState = vi.hoisted(() => ({
    autoCreateSessions: true,
}));

vi.mock('../../../../src/server/spa/client/react/features/terminal/TerminalPanel', async () => {
    const React = await import('react');
    return {
        TerminalPanel: (props: {
            sessionId: string;
            serverSessionId?: string;
            connectionMode?: 'create' | 'attach';
            onServerSessionCreated?: (session: {
                id: string;
                workspaceId: string;
                cols: number;
                rows: number;
                createdAt: number;
                lastActivity: number;
                pid: number;
                pinned: boolean;
            }) => void;
        }) => {
            const createdRef = React.useRef(false);
            React.useEffect(() => {
                if (!terminalPanelMockState.autoCreateSessions || props.connectionMode === 'attach') return;
                if (createdRef.current) return;
                createdRef.current = true;
                props.onServerSessionCreated?.({
                    id: `server-${props.sessionId}`,
                    workspaceId: 'ws1',
                    cols: 80,
                    rows: 24,
                    createdAt: 1,
                    lastActivity: 1,
                    pid: 1234,
                    pinned: false,
                });
            }, [props.connectionMode, props.onServerSessionCreated, props.sessionId]);

            return React.createElement('div', {
                'data-testid': `mock-terminal-panel-${props.sessionId}`,
                'data-server-session-id': props.serverSessionId ?? '',
                'data-connection-mode': props.connectionMode ?? 'create',
            }, 'mock terminal');
        },
    };
});

vi.mock('../../../../src/server/spa/client/react/utils/config', () => ({
    isContainerMode: () => false,
    getApiBase: () => '/api',
    isRalphEnabled: () => false,
}));

import { TerminalView } from '../../../../src/server/spa/client/react/features/terminal/TerminalView';

interface MockSession {
    id: string;
    workspaceId: string;
    cols: number;
    rows: number;
    createdAt: number;
    lastActivity: number;
    pid: number;
    pinned: boolean;
}

function makeSession(id: string, pinned: boolean): MockSession {
    return {
        id,
        workspaceId: 'ws1',
        cols: 80,
        rows: 24,
        createdAt: 1,
        lastActivity: 1,
        pid: 1234,
        pinned,
    };
}

function jsonResponse(status: number, body: unknown, statusText = status === 200 ? 'OK' : 'Error') {
    return Promise.resolve({
        ok: status >= 200 && status < 300,
        status,
        statusText,
        json: vi.fn().mockResolvedValue(body),
    });
}

function mockTerminalFetch(options?: {
    sessions?: MockSession[];
    patchStatus?: number;
}) {
    const sessions = options?.sessions ?? [];
    const patchStatus = options?.patchStatus ?? 200;
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? 'GET';
        if (method === 'GET' && url.endsWith('/terminals')) {
            return jsonResponse(200, { sessions });
        }
        if (method === 'PATCH' && url.includes('/terminals/') && url.endsWith('/pin')) {
            if (patchStatus === 404) {
                return jsonResponse(404, { error: 'Terminal session not found' }, 'Not Found');
            }
            const request = JSON.parse(String(init?.body ?? '{}')) as { pinned: boolean };
            const sessionId = decodeURIComponent(url.split('/terminals/')[1].split('/pin')[0]);
            return jsonResponse(200, { sessionId, pinned: request.pinned });
        }
        return jsonResponse(500, { error: `Unexpected ${method} ${url}` });
    });
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
}

function patchCalls(fetchMock: ReturnType<typeof mockTerminalFetch>) {
    return fetchMock.mock.calls.filter(([, init]) => init?.method === 'PATCH');
}

describe('TerminalView pin/unpin', () => {
    let uuidCounter = 0;

    beforeEach(() => {
        uuidCounter = 0;
        terminalPanelMockState.autoCreateSessions = true;
        vi.stubGlobal('crypto', {
            randomUUID: vi.fn(() => `test-uuid-${++uuidCounter}`),
        });
    });

    afterEach(() => {
        cleanup();
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    function renderAndCreate(fetchMock = mockTerminalFetch()) {
        const result = render(<TerminalView workspaceId="ws1" />);
        fireEvent.click(screen.getByTestId('terminal-new-btn'));
        return { result, fetchMock };
    }

    async function waitForServerSession(tabId: string) {
        await waitFor(() => {
            expect(screen.getByTestId(`terminal-tab-pin-${tabId}`).title).toBe('Pin terminal');
        });
    }

    it('renders pin button on terminal tab', () => {
        renderAndCreate();
        const pinBtn = screen.getByTestId('terminal-tab-pin-test-uuid-1');
        expect(pinBtn).toBeTruthy();
        expect(pinBtn.textContent).toBe('📌');
    });

    it('pins only after the server confirms the created session id', async () => {
        const { fetchMock } = renderAndCreate();
        await waitForServerSession('test-uuid-1');

        fireEvent.click(screen.getByTestId('terminal-tab-pin-test-uuid-1'));

        await waitFor(() => {
            expect(screen.getByTestId('terminal-tab-pin-test-uuid-1').className).toContain('opacity-80');
        });
        const [[url, init]] = patchCalls(fetchMock);
        expect(String(url)).toBe('/api/workspaces/ws1/terminals/server-test-uuid-1/pin');
        expect(init?.body).toBe(JSON.stringify({ pinned: true }));
    });

    it('shows unpin title when the confirmed server state is pinned', async () => {
        renderAndCreate();
        await waitForServerSession('test-uuid-1');

        fireEvent.click(screen.getByTestId('terminal-tab-pin-test-uuid-1'));

        await waitFor(() => {
            expect(screen.getByTestId('terminal-tab-pin-test-uuid-1').title).toBe('Unpin terminal');
        });
    });

    it('unpins through the server on second click', async () => {
        const { fetchMock } = renderAndCreate();
        await waitForServerSession('test-uuid-1');

        fireEvent.click(screen.getByTestId('terminal-tab-pin-test-uuid-1'));
        await waitFor(() => {
            expect(screen.getByTestId('terminal-tab-pin-test-uuid-1').className).toContain('opacity-80');
        });

        fireEvent.click(screen.getByTestId('terminal-tab-pin-test-uuid-1'));
        await waitFor(() => {
            expect(screen.getByTestId('terminal-tab-pin-test-uuid-1').className).toContain('opacity-0');
        });

        expect(patchCalls(fetchMock).map(([, init]) => init?.body)).toEqual([
            JSON.stringify({ pinned: true }),
            JSON.stringify({ pinned: false }),
        ]);
    });

    it('ignores pin clicks until the tab has a server session id', () => {
        terminalPanelMockState.autoCreateSessions = false;
        const { fetchMock } = renderAndCreate();

        const pinBtn = screen.getByTestId('terminal-tab-pin-test-uuid-1');
        expect(pinBtn.title).toBe('Waiting for terminal session');
        fireEvent.click(pinBtn);

        expect(patchCalls(fetchMock)).toHaveLength(0);
    });

    it('pin click does not switch active tab', async () => {
        renderAndCreate();
        fireEvent.click(screen.getByTestId('terminal-new-btn'));
        await waitForServerSession('test-uuid-1');

        expect(screen.getByTestId('terminal-tab-test-uuid-2').className).toContain('font-medium');

        fireEvent.click(screen.getByTestId('terminal-tab-pin-test-uuid-1'));

        await waitFor(() => {
            expect(screen.getByTestId('terminal-tab-pin-test-uuid-1').className).toContain('opacity-80');
        });
        expect(screen.getByTestId('terminal-tab-test-uuid-2').className).toContain('font-medium');
    });

    it('multiple tabs can be pinned independently through their own server sessions', async () => {
        mockTerminalFetch();
        render(<TerminalView workspaceId="ws1" />);
        fireEvent.click(screen.getByTestId('terminal-new-btn'));
        fireEvent.click(screen.getByTestId('terminal-new-btn'));
        await waitForServerSession('test-uuid-1');
        await waitForServerSession('test-uuid-2');

        fireEvent.click(screen.getByTestId('terminal-tab-pin-test-uuid-1'));
        await waitFor(() => {
            expect(screen.getByTestId('terminal-tab-pin-test-uuid-1').className).toContain('opacity-80');
        });
        expect(screen.getByTestId('terminal-tab-pin-test-uuid-2').className).toContain('opacity-0');

        fireEvent.click(screen.getByTestId('terminal-tab-pin-test-uuid-2'));
        await waitFor(() => {
            expect(screen.getByTestId('terminal-tab-pin-test-uuid-2').className).toContain('opacity-80');
        });
    });

    it('keeps hydrated pinned sessions in sync with confirmed unpin state', async () => {
        mockTerminalFetch({ sessions: [makeSession('sess-pinned', true)] });
        render(<TerminalView workspaceId="ws1" />);

        const hydratedPin = await screen.findByTestId('terminal-tab-pin-server-sess-pinned');
        expect(hydratedPin.className).toContain('opacity-80');

        fireEvent.click(hydratedPin);

        await waitFor(() => {
            expect(screen.getByTestId('terminal-tab-pin-server-sess-pinned').className).toContain('opacity-0');
        });
    });

    it('does not leave a tab falsely pinned when the server reports a missing session', async () => {
        mockTerminalFetch({ patchStatus: 404 });
        render(<TerminalView workspaceId="ws1" />);
        fireEvent.click(screen.getByTestId('terminal-new-btn'));
        await waitForServerSession('test-uuid-1');

        fireEvent.click(screen.getByTestId('terminal-tab-pin-test-uuid-1'));

        expect(await screen.findByTestId('terminal-pin-error')).toHaveTextContent('Terminal session no longer exists.');
        expect(screen.getByTestId('terminal-tab-pin-test-uuid-1').className).toContain('opacity-0');
        expect(screen.getByTestId('terminal-tab-title-test-uuid-1')).toHaveTextContent('Terminal 1 (missing)');
    });
});
