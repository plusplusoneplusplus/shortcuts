/**
 * Render-level coverage for the terminal right-click menu and the key handler
 * TerminalPanel hands to xterm (AC-03 / AC-04 / AC-05).
 *
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const terminalWebSocketMock = vi.hoisted(function () { return ({
    connect: vi.fn(),
    disconnect: vi.fn(),
    sendInput: vi.fn(),
    sendResize: vi.fn(),
}); });

const xtermMock = vi.hoisted(function () { return ({
    instances: [] as any[],
}); });

vi.mock('@xterm/xterm', function () { return ({
    Terminal: vi.fn().mockImplementation(function () {
        const term = {
            cols: 98,
            rows: 41,
            loadAddon: vi.fn(),
            open: vi.fn(),
            dispose: vi.fn(),
            write: vi.fn(),
            onData: vi.fn(function () { return ({ dispose: vi.fn() }); }),
            attachCustomKeyEventHandler: vi.fn(),
            getSelection: vi.fn(function () { return ''; }),
            selectAll: vi.fn(),
            clear: vi.fn(),
            buffer: {
                active: {
                    length: 3,
                    getLine(i: number) {
                        return { translateToString: () => `line-${i}` };
                    },
                },
            },
            options: {},
        };
        xtermMock.instances.push(term);
        return term;
    }),
}); });

vi.mock('@xterm/addon-fit', function () { return ({
    FitAddon: vi.fn().mockImplementation(function () { return ({ fit: vi.fn() }); }),
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

class MockObserver {
    observe = vi.fn();
    disconnect = vi.fn();
}

const writeText = vi.fn(async () => {});
const readText = vi.fn(async () => 'pasted-text');

function renderPanel() {
    const utils = render(
        <TerminalPanel sessionId="client-session" workspaceId="ws-123" isActive={false} />,
    );
    const term = xtermMock.instances[xtermMock.instances.length - 1];
    return { ...utils, term };
}

function openMenu() {
    fireEvent.contextMenu(screen.getByTestId('terminal-panel-client-session'), {
        clientX: 10,
        clientY: 20,
    });
}

/** Menu items keep their order from buildTerminalContextMenuItems. */
function menuItem(label: string): HTMLElement {
    const menu = screen.getByTestId('context-menu');
    const match = Array.from(menu.querySelectorAll('button')).find(b => b.textContent === label);
    if (!match) throw new Error(`no menu item labelled ${label}`);
    return match;
}

beforeEach(() => {
    xtermMock.instances.length = 0;
    vi.clearAllMocks();
    vi.stubGlobal('ResizeObserver', MockObserver);
    vi.stubGlobal('MutationObserver', MockObserver);
    vi.stubGlobal('navigator', {
        ...navigator,
        platform: 'Linux x86_64',
        clipboard: { writeText, readText },
    });
});

afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
});

describe('TerminalPanel context menu', () => {
    it('opens on right-click with the five clipboard items and suppresses the native menu', () => {
        renderPanel();

        const container = screen.getByTestId('terminal-panel-client-session');
        const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
        fireEvent(container, event);

        expect(event.defaultPrevented).toBe(true);
        const menu = screen.getByTestId('context-menu');
        const labels = Array.from(menu.querySelectorAll('button')).map(b => b.textContent);
        expect(labels).toEqual(['Copy', 'Paste', 'Copy all output', 'Select all', 'Clear terminal']);
        expect(menu.querySelectorAll('[role="separator"]').length).toBe(1);
    });

    it('disables Copy when there is no selection and enables it when there is', () => {
        const { term } = renderPanel();

        openMenu();
        expect(menuItem('Copy')).toBeDisabled();
        fireEvent.keyDown(document, { key: 'Escape' });

        term.getSelection.mockReturnValue('selected text');
        openMenu();
        expect(menuItem('Copy')).not.toBeDisabled();
    });

    it('copies the selection from the Copy item', async () => {
        const { term } = renderPanel();
        term.getSelection.mockReturnValue('selected text');

        openMenu();
        fireEvent.click(menuItem('Copy'));

        await waitFor(() => expect(writeText).toHaveBeenCalledWith('selected text'));
        expect(terminalWebSocketMock.sendInput).not.toHaveBeenCalled();
    });

    it('pastes clipboard text as terminal input from the Paste item', async () => {
        renderPanel();

        openMenu();
        fireEvent.click(menuItem('Paste'));

        await waitFor(() => expect(terminalWebSocketMock.sendInput).toHaveBeenCalledWith('pasted-text'));
    });

    it('copies the whole scrollback buffer from Copy all output', async () => {
        renderPanel();

        openMenu();
        fireEvent.click(menuItem('Copy all output'));

        await waitFor(() => expect(writeText).toHaveBeenCalledWith('line-0\nline-1\nline-2'));
    });

    it('selects all from the Select all item', () => {
        const { term } = renderPanel();

        openMenu();
        fireEvent.click(menuItem('Select all'));

        expect(term.selectAll).toHaveBeenCalledTimes(1);
    });

    it('clears locally without sending anything to the shell', () => {
        const { term } = renderPanel();

        openMenu();
        fireEvent.click(menuItem('Clear terminal'));

        expect(term.clear).toHaveBeenCalledTimes(1);
        expect(terminalWebSocketMock.sendInput).not.toHaveBeenCalled();
    });
});

describe('TerminalPanel key handler wiring', () => {
    it('attaches a custom key handler that sends SIGINT for a selection-less Ctrl+C', () => {
        const { term } = renderPanel();

        expect(term.attachCustomKeyEventHandler).toHaveBeenCalledTimes(1);
        const handler = term.attachCustomKeyEventHandler.mock.calls[0][0];

        expect(handler({ type: 'keydown', key: 'c', ctrlKey: true })).toBe(false);
        expect(terminalWebSocketMock.sendInput).toHaveBeenCalledWith('\x03');
    });

    it('copies instead of interrupting when Ctrl+C has a selection', async () => {
        const { term } = renderPanel();
        term.getSelection.mockReturnValue('picked');
        const handler = term.attachCustomKeyEventHandler.mock.calls[0][0];

        expect(handler({ type: 'keydown', key: 'c', ctrlKey: true })).toBe(false);

        await waitFor(() => expect(writeText).toHaveBeenCalledWith('picked'));
        expect(terminalWebSocketMock.sendInput).not.toHaveBeenCalled();
    });

    it('lets ordinary keys through to xterm', () => {
        const { term } = renderPanel();
        const handler = term.attachCustomKeyEventHandler.mock.calls[0][0];

        expect(handler({ type: 'keydown', key: 'a' })).toBe(true);
    });
});
