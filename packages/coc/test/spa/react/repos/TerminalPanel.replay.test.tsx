/**
 * @vitest-environment jsdom
 *
 * AC-03 (client side) — TerminalPanel renders the server's scrollback replay
 * before any live output, and sizes xterm's own scrollback to match the
 * server-side cap so the replayed buffer is not immediately clipped.
 */
import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(function () { return ({
    write: vi.fn(),
    terminalOptions: [] as any[],
    onMessage: null as null | ((msg: any) => void),
}); });

vi.mock('@xterm/xterm', function () { return ({
    Terminal: vi.fn().mockImplementation(function (options: any) {
        mocks.terminalOptions.push(options);
        return {
            cols: 98,
            rows: 41,
            loadAddon: vi.fn(),
            open: vi.fn(),
            dispose: vi.fn(),
            write: mocks.write,
            onData: vi.fn(function () { return ({ dispose: vi.fn() }); }),
            attachCustomKeyEventHandler: vi.fn(),
            getSelection: vi.fn(function () { return ''; }),
            selectAll: vi.fn(),
            clear: vi.fn(),
            options: {},
        };
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
    useTerminalWebSocket: function (options: any) {
        mocks.onMessage = options.onMessage;
        return {
            status: 'open',
            connect: vi.fn(),
            disconnect: vi.fn(),
            killSession: vi.fn(),
            sendInput: vi.fn(),
            sendResize: vi.fn(),
        };
    },
}); });

import { TerminalPanel } from '../../../../src/server/spa/client/react/features/terminal/TerminalPanel';

class MockResizeObserver {
    observe = vi.fn();
    disconnect = vi.fn();
}

function renderPanel() {
    return render(
        <TerminalPanel
            sessionId="tab-1"
            serverSessionId="server-1"
            connectionMode="attach"
            workspaceId="ws-1"
            isActive
        />,
    );
}

describe('TerminalPanel scrollback replay (AC-03)', function () {
    beforeEach(function () {
        mocks.write.mockClear();
        mocks.terminalOptions.length = 0;
        mocks.onMessage = null;
        (globalThis as any).ResizeObserver = MockResizeObserver;
    });

    afterEach(function () {
        cleanup();
    });

    it('writes the replayed scrollback into the terminal', function () {
        renderPanel();

        mocks.onMessage!({
            type: 'terminal-replay',
            sessionId: 'server-1',
            data: 'line 1\r\nline 2\r\n',
            truncated: false,
        });

        expect(mocks.write).toHaveBeenCalledWith('line 1\r\nline 2\r\n');
        expect(mocks.write).toHaveBeenCalledTimes(1);
    });

    it('prefixes a dim marker when the replay is truncated', function () {
        renderPanel();

        mocks.onMessage!({
            type: 'terminal-replay',
            sessionId: 'server-1',
            data: 'tail output',
            truncated: true,
        });

        expect(mocks.write.mock.calls.map(function (c) { return c[0]; })).toEqual([
            '\x1b[90m[scrollback truncated]\x1b[0m\r\n',
            'tail output',
        ]);
    });

    it('writes the replay before subsequent live output', function () {
        renderPanel();

        mocks.onMessage!({ type: 'terminal-replay', sessionId: 'server-1', data: 'old', truncated: false });
        mocks.onMessage!({ type: 'terminal-output', sessionId: 'server-1', data: 'new' });

        expect(mocks.write.mock.calls.map(function (c) { return c[0]; })).toEqual(['old', 'new']);
    });

    it('sizes xterm scrollback to match the server-side cap', function () {
        renderPanel();

        expect(mocks.terminalOptions[0].scrollback).toBe(10000);
    });
});
