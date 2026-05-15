/**
 * @vitest-environment jsdom
 */
import { cleanup, render, waitFor } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const terminalWebSocketMock = vi.hoisted(function () { return ({
    connect: vi.fn(),
    disconnect: vi.fn(),
    sendInput: vi.fn(),
    sendResize: vi.fn(),
}); });

vi.mock('@xterm/xterm', function () { return ({
    Terminal: vi.fn().mockImplementation(function () { return ({
        cols: 98,
        rows: 41,
        loadAddon: vi.fn(),
        open: vi.fn(),
        dispose: vi.fn(),
        write: vi.fn(),
        onData: vi.fn(function () { return ({ dispose: vi.fn() }); }),
        options: {},
    }); }),
}); });

vi.mock('@xterm/addon-fit', function () { return ({
    FitAddon: vi.fn().mockImplementation(function () { return ({
        fit: vi.fn(),
    }); }),
}); });

vi.mock('@xterm/addon-web-links', function () { return ({
    WebLinksAddon: vi.fn().mockImplementation(function () { return ({}); }),
}); });

vi.mock('@xterm/xterm/css/xterm.css', function () { return ({}); });

vi.mock('../../../../src/server/spa/client/react/features/terminal/hooks/useTerminalWebSocket', function () { return ({
    useTerminalWebSocket: function () { return ({
        status: 'closed',
        connect: terminalWebSocketMock.connect,
        disconnect: terminalWebSocketMock.disconnect,
        sendInput: terminalWebSocketMock.sendInput,
        sendResize: terminalWebSocketMock.sendResize,
    }); },
}); });

import { TerminalPanel } from '../../../../src/server/spa/client/react/features/terminal/TerminalPanel';

class MockResizeObserver {
    observe = vi.fn();
    disconnect = vi.fn();
}

class MockMutationObserver {
    observe = vi.fn();
    disconnect = vi.fn();
}

function renderTerminalPanel(overrides: Partial<ComponentProps<typeof TerminalPanel>> = {}) {
    return render(
        <TerminalPanel
            sessionId="client-session"
            workspaceId="ws-123"
            isActive={false}
            {...overrides}
        />,
    );
}

beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('ResizeObserver', MockResizeObserver);
    vi.stubGlobal('MutationObserver', MockMutationObserver);
});

afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
});

describe('TerminalPanel WebSocket lifecycle', () => {
    it('does not reconnect create-mode terminals when the created server session id is recorded', async () => {
        const { rerender } = renderTerminalPanel({ connectionMode: 'create' });

        await waitFor(() => {
            expect(terminalWebSocketMock.connect).toHaveBeenCalledTimes(1);
        });
        expect(terminalWebSocketMock.connect).toHaveBeenLastCalledWith(
            'ws-123',
            98,
            41,
            { mode: 'create' },
        );

        rerender(
            <TerminalPanel
                sessionId="client-session"
                workspaceId="ws-123"
                isActive={false}
                connectionMode="create"
                serverSessionId="sess-created"
            />,
        );

        expect(terminalWebSocketMock.connect).toHaveBeenCalledTimes(1);
        expect(terminalWebSocketMock.disconnect).not.toHaveBeenCalled();
    });

    it('reconnects when the server session id changes in attach mode', async () => {
        const { rerender } = renderTerminalPanel({
            connectionMode: 'attach',
            serverSessionId: 'sess-one',
        });

        await waitFor(() => {
            expect(terminalWebSocketMock.connect).toHaveBeenCalledTimes(1);
        });
        expect(terminalWebSocketMock.connect).toHaveBeenLastCalledWith(
            'ws-123',
            98,
            41,
            { mode: 'attach', sessionId: 'sess-one' },
        );

        rerender(
            <TerminalPanel
                sessionId="client-session"
                workspaceId="ws-123"
                isActive={false}
                connectionMode="attach"
                serverSessionId="sess-two"
            />,
        );

        await waitFor(() => {
            expect(terminalWebSocketMock.connect).toHaveBeenCalledTimes(2);
        });
        expect(terminalWebSocketMock.disconnect).toHaveBeenCalledTimes(1);
        expect(terminalWebSocketMock.connect).toHaveBeenLastCalledWith(
            'ws-123',
            98,
            41,
            { mode: 'attach', sessionId: 'sess-two' },
        );
    });
});
