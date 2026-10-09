/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const terminalWebSocketMock = vi.hoisted(function () { return ({
    connect: vi.fn(),
    disconnect: vi.fn(),
    sendInput: vi.fn(),
    sendResize: vi.fn(),
    status: 'closed' as 'closed' | 'connecting' | 'open',
    onData: null as null | ((data: string) => void),
}); });

vi.mock('@xterm/xterm', function () { return ({
    Terminal: vi.fn().mockImplementation(function () { return ({
        cols: 98,
        rows: 41,
        loadAddon: vi.fn(),
        open: vi.fn((container: HTMLElement) => {
            container.appendChild(document.createElement('textarea'));
        }),
        dispose: vi.fn(),
        focus: vi.fn(),
        write: vi.fn(),
        onData: vi.fn(function (callback: (data: string) => void) {
            terminalWebSocketMock.onData = callback;
            return { dispose: () => { terminalWebSocketMock.onData = null; } };
        }),
        attachCustomKeyEventHandler: vi.fn(),
        getSelection: vi.fn(function () { return ''; }),
        selectAll: vi.fn(),
        clear: vi.fn(),
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
        status: terminalWebSocketMock.status,
        connect: terminalWebSocketMock.connect,
        disconnect: terminalWebSocketMock.disconnect,
        sendInput: terminalWebSocketMock.sendInput,
        sendResize: terminalWebSocketMock.sendResize,
    }); },
}); });

import { Terminal } from '@xterm/xterm';
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
    terminalWebSocketMock.status = 'closed';
    terminalWebSocketMock.onData = null;
    vi.stubGlobal('ResizeObserver', MockResizeObserver);
    vi.stubGlobal('MutationObserver', MockMutationObserver);
});

describe('TerminalPanel Enter restart', () => {
    it('focuses xterm for an explicit open request only while active', async () => {
        const view = renderTerminalPanel({ focusRequest: 1, isActive: false });
        const term = vi.mocked(Terminal).mock.results[0].value;
        expect(term.focus).not.toHaveBeenCalled();
        view.rerender(<TerminalPanel sessionId="client-session" workspaceId="ws-123" isActive focusRequest={1} />);
        await waitFor(() => expect(term.focus).toHaveBeenCalledTimes(1));
        view.rerender(<TerminalPanel sessionId="client-session" workspaceId="ws-123" isActive focusRequest={2} />);
        await waitFor(() => expect(term.focus).toHaveBeenCalledTimes(2));
    });

    it('claims focused Enter for an exited terminal without sending shell input', () => {
        const onRestart = vi.fn();
        const { container } = renderTerminalPanel({ readOnly: true, isActive: true, onRestart });
        const input = container.querySelector('textarea')!;
        input.focus();

        expect(fireEvent.keyDown(input, { key: 'Enter' })).toBe(false);
        expect(onRestart).toHaveBeenCalledTimes(1);
        expect(terminalWebSocketMock.sendInput).not.toHaveBeenCalled();
        expect(terminalWebSocketMock.onData).toBeNull();
    });

    it('ignores held keys, composition and modified Enter', () => {
        const onRestart = vi.fn();
        const { container } = renderTerminalPanel({ readOnly: true, isActive: true, onRestart });
        const input = container.querySelector('textarea')!;
        input.focus();
        for (const options of [
            { repeat: true }, { isComposing: true }, { ctrlKey: true },
            { metaKey: true }, { altKey: true }, { shiftKey: true },
        ]) fireEvent.keyDown(input, { key: 'Enter', ...options });
        fireEvent.keyDown(input, { key: 'a' });
        fireEvent.keyUp(input, { key: 'Enter' });
        fireEvent.paste(input, { clipboardData: { getData: () => '\n' } });
        expect(onRestart).not.toHaveBeenCalled();
    });

    it('requires focus inside the active terminal', () => {
        const onRestart = vi.fn();
        const { container, rerender } = renderTerminalPanel({ readOnly: true, isActive: true, onRestart });
        const input = container.querySelector('textarea')!;
        const outside = document.createElement('input');
        document.body.appendChild(outside);
        outside.focus();
        fireEvent.keyDown(outside, { key: 'Enter' });
        fireEvent.keyDown(input, { key: 'Enter' });
        outside.remove();
        input.focus();
        rerender(<TerminalPanel sessionId="client-session" workspaceId="ws-123"
            isActive={false} readOnly onRestart={onRestart} />);
        fireEvent.keyDown(input, { key: 'Enter' });
        expect(onRestart).not.toHaveBeenCalled();
    });

    it.each(['open', 'closed', 'connecting'] as const)(
        'preserves running Enter with transport %s', (status) => {
            terminalWebSocketMock.status = status;
            const onRestart = vi.fn();
            const { container } = renderTerminalPanel({ isActive: true, onRestart });
            const input = container.querySelector('textarea')!;
            input.focus();
            expect(fireEvent.keyDown(input, { key: 'Enter' })).toBe(true);
            terminalWebSocketMock.onData!('\r');
            expect(terminalWebSocketMock.sendInput).toHaveBeenCalledWith('\r');
            expect(onRestart).not.toHaveBeenCalled();
        },
    );

    it('uses current exit and restart props after a live terminal exits', () => {
        const onRestart = vi.fn();
        const { container, rerender } = renderTerminalPanel({ isActive: true, onRestart });
        const input = container.querySelector('textarea')!;
        input.focus();
        rerender(<TerminalPanel sessionId="client-session" workspaceId="ws-123"
            isActive readOnly onRestart={onRestart} />);
        fireEvent.keyDown(input, { key: 'Enter' });
        expect(onRestart).toHaveBeenCalledTimes(1);
        expect(terminalWebSocketMock.onData).toBeNull();
    });
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
