/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Terminal } from '@xterm/xterm';

const fixture = vi.hoisted(() => ({ terminals: [] as Terminal[], sendInput: vi.fn() }));
vi.mock('@xterm/xterm', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@xterm/xterm')>();
    return { ...actual, Terminal: class extends actual.Terminal {
        constructor(options: ConstructorParameters<typeof actual.Terminal>[0]) {
            super(options);
            fixture.terminals.push(this);
        }
    } };
});
vi.mock('@xterm/addon-fit', () => ({ FitAddon: class { activate() {} fit() {} dispose() {} } }));
vi.mock('../../../../src/server/spa/client/react/features/terminal/hooks/useTerminalWebSocket', () => ({
    useTerminalWebSocket: () => ({ connect: vi.fn(), disconnect: vi.fn(), sendResize: vi.fn(), sendInput: fixture.sendInput }),
}));
import { TerminalPanel } from '../../../../src/server/spa/client/react/features/terminal/TerminalPanel';

const readText = vi.fn();
beforeEach(() => {
    fixture.terminals.length = 0;
    vi.clearAllMocks();
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} })));
    vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { readText } });
});
afterEach(() => {
    cleanup();
    Reflect.deleteProperty(navigator, 'clipboard');
    vi.unstubAllGlobals();
});

function mount(props: Partial<React.ComponentProps<typeof TerminalPanel>> = {}) {
    const view = render(<TerminalPanel sessionId="fixture" workspaceId="remote-workspace" routingRef="remote-route" isActive {...props} />);
    const container = screen.getByTestId('terminal-panel-fixture');
    const textarea = container.querySelector('textarea')!;
    textarea.focus();
    return { ...view, container, textarea, term: fixture.terminals[0] };
}
function paste(target: HTMLElement, plain = 'one\ntwo\r\nthree\n') {
    const getData = vi.fn((type: string) => type === 'text/plain' ? plain : '<b>formatted duplicate</b>');
    const event = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'clipboardData', { value: { types: ['text/html', 'text/plain'], getData } });
    target.dispatchEvent(event);
    return { event, getData };
}

describe('TerminalPanel plain-text paste with real xterm', () => {
    it.each([false, true])('inserts exactly once with bracketed paste %s', async (bracketed) => {
        const { term, textarea, container } = mount();
        await new Promise<void>(resolve => term.write(bracketed ? '\x1b[?2004h' : '\x1b[?2004l', resolve));
        const parallel = vi.fn();
        textarea.addEventListener('paste', parallel);
        container.addEventListener('paste', parallel);
        const { event, getData } = paste(textarea);
        expect(event.defaultPrevented).toBe(true);
        expect(getData).toHaveBeenCalledExactlyOnceWith('text/plain');
        expect(parallel).not.toHaveBeenCalled();
        expect(fixture.sendInput).toHaveBeenCalledExactlyOnceWith(bracketed ? '\x1b[200~one\rtwo\rthree\r\x1b[201~' : 'one\rtwo\rthree\r');
        expect(textarea.value).toBe('');
        expect(readText).not.toHaveBeenCalled();
    });

    it.each([
        ['Linux x86_64', { ctrlKey: true }],
        ['Linux x86_64', { ctrlKey: true, shiftKey: true }],
        ['MacIntel', { metaKey: true }],
        ['MacIntel', { ctrlKey: true, shiftKey: true }],
    ])('leaves %s paste shortcut to the native clipboard event (%j)', (platform, modifiers) => {
        Object.defineProperty(navigator, 'platform', { configurable: true, value: platform });
        const { textarea } = mount();
        const key = new KeyboardEvent('keydown', { key: 'v', bubbles: true, cancelable: true, ...modifiers });
        textarea.dispatchEvent(key);
        expect(key.defaultPrevented).toBe(false);
        expect(readText).not.toHaveBeenCalled();
        expect(fixture.sendInput).not.toHaveBeenCalled();
        paste(textarea, 'plain'); // Browser/Electron native paste follows the key or menu action.
        expect(fixture.sendInput).toHaveBeenCalledExactlyOnceWith('plain');
        Reflect.deleteProperty(navigator, 'platform');
    });

    it('leaves clipboard handling outside terminal focus alone', () => {
        mount();
        const input = document.createElement('textarea');
        document.body.append(input);
        input.focus();
        expect(paste(input).event.defaultPrevented).toBe(false);
        expect(fixture.sendInput).not.toHaveBeenCalled();
        input.remove();
    });

    it('does not send pasted newlines or restart an exited terminal', () => {
        const onRestart = vi.fn();
        const { textarea } = mount({ readOnly: true, onRestart });
        paste(textarea);
        expect(fixture.sendInput).not.toHaveBeenCalled();
        expect(onRestart).not.toHaveBeenCalled();
        fireEvent.keyDown(textarea, { key: 'Enter' });
        expect(onRestart).toHaveBeenCalledTimes(1);
    });

    it('uses xterm paste for the context menu', async () => {
        const { container, term } = mount();
        await new Promise<void>(resolve => term.write('\x1b[?2004h', resolve));
        readText.mockResolvedValue('context\ntext');
        fireEvent.contextMenu(container);
        fireEvent.click(screen.getByText('Paste'));
        await vi.waitFor(() => expect(fixture.sendInput).toHaveBeenCalledExactlyOnceWith('\x1b[200~context\rtext\x1b[201~'));
    });

    it('ignores an empty plain-text flavor even when HTML exists', () => {
        const { textarea } = mount();
        const { event, getData } = paste(textarea, '');
        expect(event.defaultPrevented).toBe(true);
        expect(getData).toHaveBeenCalledExactlyOnceWith('text/plain');
        expect(fixture.sendInput).not.toHaveBeenCalled();
    });
});
