/**
 * @vitest-environment jsdom
 *
 * Unit tests for the terminal clipboard logic (key classification, scrollback
 * flattening, context-menu wiring) without a real xterm instance.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { renderHook } from '@testing-library/react';

import {
    classifyTerminalKeyEvent,
    useTerminalClipboard,
    readTerminalBuffer,
    buildTerminalContextMenuItems,
    SIGINT_SEQUENCE,
    type ClipboardTerminal,
} from '../../../../src/server/spa/client/react/features/terminal/hooks/useTerminalClipboard';

function key(overrides: Record<string, unknown>) {
    return { type: 'keydown', key: 'c', ...overrides } as never;
}

describe('classifyTerminalKeyEvent', () => {
    describe('windows / linux', () => {
        const opts = (hasSelection: boolean) => ({ isMac: false, hasSelection });

        it('copies on Ctrl+Shift+C when there is a selection', () => {
            expect(classifyTerminalKeyEvent(key({ ctrlKey: true, shiftKey: true }), opts(true)))
                .toBe('copy');
        });

        it('does nothing on Ctrl+Shift+C without a selection', () => {
            expect(classifyTerminalKeyEvent(key({ ctrlKey: true, shiftKey: true }), opts(false)))
                .toBe('noop');
        });

        it('copies on plain Ctrl+C when there is a selection', () => {
            expect(classifyTerminalKeyEvent(key({ ctrlKey: true }), opts(true))).toBe('copy');
        });

        it('interrupts on plain Ctrl+C without a selection', () => {
            expect(classifyTerminalKeyEvent(key({ ctrlKey: true }), opts(false))).toBe('interrupt');
        });

        it('pastes on Ctrl+Shift+V', () => {
            expect(classifyTerminalKeyEvent(key({ key: 'V', ctrlKey: true, shiftKey: true }), opts(false)))
                .toBe('paste');
        });

        it('leaves plain Ctrl+V to xterm', () => {
            expect(classifyTerminalKeyEvent(key({ key: 'v', ctrlKey: true }), opts(false)))
                .toBe('passthrough');
        });

        it('ignores non-keydown events', () => {
            expect(classifyTerminalKeyEvent(key({ type: 'keyup', ctrlKey: true, shiftKey: true }), opts(true)))
                .toBe('passthrough');
        });

        it('ignores shortcuts that also hold Alt', () => {
            expect(classifyTerminalKeyEvent(key({ ctrlKey: true, shiftKey: true, altKey: true }), opts(true)))
                .toBe('passthrough');
        });
    });

    describe('macos', () => {
        const opts = (hasSelection: boolean) => ({ isMac: true, hasSelection });

        it('copies on Cmd+C when there is a selection', () => {
            expect(classifyTerminalKeyEvent(key({ metaKey: true }), opts(true))).toBe('copy');
        });

        it('does nothing on Cmd+C without a selection', () => {
            expect(classifyTerminalKeyEvent(key({ metaKey: true }), opts(false))).toBe('noop');
        });

        it('pastes on Cmd+V', () => {
            expect(classifyTerminalKeyEvent(key({ key: 'v', metaKey: true }), opts(false))).toBe('paste');
        });

        it('always interrupts on Ctrl+C, even with a selection', () => {
            expect(classifyTerminalKeyEvent(key({ ctrlKey: true }), opts(true))).toBe('interrupt');
            expect(classifyTerminalKeyEvent(key({ ctrlKey: true }), opts(false))).toBe('interrupt');
        });
    });

    it('sends the SIGINT byte for interrupts', () => {
        expect(SIGINT_SEQUENCE).toBe('\x03');
    });
});

describe('readTerminalBuffer', () => {
    function makeTerm(lines: string[]): ClipboardTerminal {
        return {
            getSelection: () => '',
            selectAll: vi.fn(),
            clear: vi.fn(),
            buffer: {
                active: {
                    length: lines.length,
                    getLine: (i: number) => ({
                        translateToString: (trimRight?: boolean) =>
                            trimRight ? lines[i].replace(/\s+$/, '') : lines[i],
                    }),
                },
            },
        };
    }

    it('includes scrollback lines above the viewport', () => {
        const lines = Array.from({ length: 120 }, (_, i) => `line ${i + 1}`);
        const text = readTerminalBuffer(makeTerm(lines));
        expect(text).toContain('line 1');
        expect(text).toContain('line 120');
        expect(text.split('\n')).toHaveLength(120);
    });

    it('trims trailing whitespace per line and drops trailing blank rows', () => {
        const text = readTerminalBuffer(makeTerm(['a   ', 'b  ', '   ', '']));
        expect(text).toBe('a\nb');
    });

    it('falls back to the selection when no buffer is exposed', () => {
        const term: ClipboardTerminal = {
            getSelection: () => 'sel',
            selectAll: vi.fn(),
            clear: vi.fn(),
        };
        expect(readTerminalBuffer(term)).toBe('sel');
    });
});

describe('buildTerminalContextMenuItems', () => {
    const actions = () => ({
        copySelection: vi.fn().mockResolvedValue(undefined),
        paste: vi.fn().mockResolvedValue(undefined),
        copyAll: vi.fn().mockResolvedValue(undefined),
        selectAll: vi.fn(),
        clearTerminal: vi.fn(),
    });

    it('lists the five actions in order with a separator before Clear terminal', () => {
        const items = buildTerminalContextMenuItems(actions(), { hasSelection: true });
        expect(items.filter(i => !i.separator).map(i => i.label)).toEqual([
            'Copy', 'Paste', 'Copy all output', 'Select all', 'Clear terminal',
        ]);
        expect(items[items.length - 2].separator).toBe(true);
    });

    it('disables Copy when nothing is selected', () => {
        expect(buildTerminalContextMenuItems(actions(), { hasSelection: false })[0].disabled).toBe(true);
        expect(buildTerminalContextMenuItems(actions(), { hasSelection: true })[0].disabled).toBe(false);
    });

    it('routes each item to its action', () => {
        const a = actions();
        const items = buildTerminalContextMenuItems(a, { hasSelection: true });
        for (const item of items) item.onClick();
        expect(a.copySelection).toHaveBeenCalledTimes(1);
        expect(a.paste).toHaveBeenCalledTimes(1);
        expect(a.copyAll).toHaveBeenCalledTimes(1);
        expect(a.selectAll).toHaveBeenCalledTimes(1);
        expect(a.clearTerminal).toHaveBeenCalledTimes(1);
    });
});

describe('useTerminalClipboard actions', () => {
    let writeText: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        writeText = vi.fn().mockResolvedValue(undefined);
        // Replace only the clipboard: react-dom reads other navigator fields.
        Object.defineProperty(navigator, 'clipboard', {
            configurable: true,
            value: { writeText, readText: vi.fn().mockResolvedValue('pasted') },
        });
    });

    afterEach(() => {
        Reflect.deleteProperty(navigator, 'clipboard');
    });

    function mountHook(term: ClipboardTerminal | null, opts: Record<string, unknown> = {}) {
        const sendInput = vi.fn();
        const { result } = renderHook(() => useTerminalClipboard({
            getTerminal: () => term,
            sendInput,
            platform: 'Linux x86_64',
            ...opts,
        }));
        return { result, sendInput };
    }

    function stubTerm(selection: string): ClipboardTerminal {
        return { getSelection: () => selection, selectAll: vi.fn(), clear: vi.fn() };
    }

    it('copies the selection', async () => {
        const { result } = mountHook(stubTerm('hello'));
        await result.current.copySelection();
        expect(writeText).toHaveBeenCalledWith('hello');
    });

    it('leaves the clipboard alone when nothing is selected', async () => {
        const { result } = mountHook(stubTerm(''));
        await result.current.copySelection();
        expect(writeText).not.toHaveBeenCalled();
    });

    it('sends clipboard text on paste', async () => {
        const { result, sendInput } = mountHook(stubTerm(''), {
            readClipboard: () => Promise.resolve('from clipboard'),
        });
        await result.current.paste();
        expect(sendInput).toHaveBeenCalledWith('from clipboard');
    });

    it('stays silent when the clipboard read is denied', async () => {
        const { result, sendInput } = mountHook(stubTerm(''), {
            readClipboard: () => Promise.reject(new Error('denied')),
        });
        await expect(result.current.paste()).resolves.toBeUndefined();
        expect(sendInput).not.toHaveBeenCalled();
    });

    it('clears the terminal without sending input', async () => {
        const term = stubTerm('');
        const { result, sendInput } = mountHook(term);
        result.current.clearTerminal();
        expect(term.clear).toHaveBeenCalledTimes(1);
        expect(sendInput).not.toHaveBeenCalled();
    });

    it('selects all', async () => {
        const term = stubTerm('');
        const { result } = mountHook(term);
        result.current.selectAll();
        expect(term.selectAll).toHaveBeenCalledTimes(1);
    });

    it('handleKeyEvent copies without sending input when a selection exists', async () => {
        const { result, sendInput } = mountHook(stubTerm('picked'));
        const handled = result.current.handleKeyEvent({ type: 'keydown', key: 'c', ctrlKey: true });
        expect(handled).toBe(false);
        expect(sendInput).not.toHaveBeenCalled();
        await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith('picked'));
    });

    it('handleKeyEvent sends SIGINT for Ctrl+C without a selection', async () => {
        const { result, sendInput } = mountHook(stubTerm(''));
        expect(result.current.handleKeyEvent({ type: 'keydown', key: 'c', ctrlKey: true })).toBe(false);
        expect(sendInput).toHaveBeenCalledWith('\x03');
    });

    it('handleKeyEvent always sends SIGINT for Ctrl+C on macOS', async () => {
        const { result, sendInput } = mountHook(stubTerm('picked'), { platform: 'MacIntel' });
        expect(result.current.handleKeyEvent({ type: 'keydown', key: 'c', ctrlKey: true })).toBe(false);
        expect(sendInput).toHaveBeenCalledWith('\x03');
        expect(writeText).not.toHaveBeenCalled();
    });

    it('handleKeyEvent lets unrelated keys through', async () => {
        const { result } = mountHook(stubTerm(''));
        expect(result.current.handleKeyEvent({ type: 'keydown', key: 'a' })).toBe(true);
    });
});
