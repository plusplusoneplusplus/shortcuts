/**
 * Desktop Edit ▸ Copy delegation (AC-06).
 *
 * REGRESSION: on macOS the Electron Edit menu owns the Cmd+C accelerator, so
 * the terminal's own key handler never sees it and `webContents.copy()` finds
 * nothing to copy (xterm paints its selection instead of making a DOM one).
 * The main process now pushes `cocDesktop.menu.onCopy`; a focused terminal with
 * a selection must copy and answer `copyHandled()`, and must stay silent
 * otherwise so the native fallback still serves ordinary text fields.
 *
 * @vitest-environment jsdom
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const terminalWebSocketMock = vi.hoisted(function () { return ({
    connect: vi.fn(),
    disconnect: vi.fn(),
    sendInput: vi.fn(),
    sendResize: vi.fn(),
}); });

const xtermMock = vi.hoisted(function () { return ({ instances: [] as any[] }); });

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
const copyHandled = vi.fn();
const unsubscribe = vi.fn();
/** The main-process push, captured from the stubbed preload bridge. */
let fireMenuCopy: (() => void) | null = null;

function renderPanel() {
    const utils = render(
        <TerminalPanel sessionId="client-session" workspaceId="ws-123" isActive={false} />,
    );
    const term = xtermMock.instances[xtermMock.instances.length - 1];
    return { ...utils, term };
}

/** xterm's real hidden textarea lives inside the container; mimic that. */
function focusTerminal(): void {
    const container = screen.getByTestId('terminal-panel-client-session');
    const textarea = document.createElement('textarea');
    container.appendChild(textarea);
    textarea.focus();
}

beforeEach(() => {
    xtermMock.instances.length = 0;
    fireMenuCopy = null;
    vi.clearAllMocks();
    vi.stubGlobal('ResizeObserver', MockObserver);
    vi.stubGlobal('MutationObserver', MockObserver);
    vi.stubGlobal('navigator', {
        ...navigator,
        platform: 'MacIntel',
        clipboard: { writeText, readText: vi.fn(async () => '') },
    });
    (window as any).cocDesktop = {
        isDesktop: true,
        menu: {
            onCopy: (cb: () => void) => { fireMenuCopy = cb; return unsubscribe; },
            copyHandled,
        },
    };
});

afterEach(() => {
    cleanup();
    delete (window as any).cocDesktop;
    vi.unstubAllGlobals();
});

describe('TerminalPanel — desktop Edit ▸ Copy', () => {
    it('copies the selection and claims the copy when focused', async () => {
        const { term } = renderPanel();
        term.getSelection.mockReturnValue('selected output');
        focusTerminal();

        fireMenuCopy!();

        expect(copyHandled).toHaveBeenCalledTimes(1);
        await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith('selected output'));
    });

    it('leaves the copy to the native fallback when nothing is selected', () => {
        const { term } = renderPanel();
        term.getSelection.mockReturnValue('');
        focusTerminal();

        fireMenuCopy!();

        expect(copyHandled).not.toHaveBeenCalled();
        expect(writeText).not.toHaveBeenCalled();
    });

    it('leaves the copy to the native fallback when the terminal is not focused', () => {
        const { term } = renderPanel();
        term.getSelection.mockReturnValue('selected output');
        // Focus stays on <body> — e.g. the user is in a normal text field.

        fireMenuCopy!();

        expect(copyHandled).not.toHaveBeenCalled();
        expect(writeText).not.toHaveBeenCalled();
    });

    it('unsubscribes from the bridge on unmount', () => {
        const { unmount } = renderPanel();
        unmount();
        expect(unsubscribe).toHaveBeenCalledTimes(1);
    });

    it('is inert in the browser, where there is no desktop bridge', () => {
        delete (window as any).cocDesktop;
        expect(() => renderPanel()).not.toThrow();
        expect(fireMenuCopy).toBeNull();
    });
});
