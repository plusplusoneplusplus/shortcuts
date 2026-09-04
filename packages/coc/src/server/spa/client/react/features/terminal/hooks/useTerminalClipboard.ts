/**
 * Clipboard support for the shared xterm.js terminal.
 *
 * Everything here works against a small structural slice of the xterm
 * `Terminal` API (`ClipboardTerminal`) so the behaviour can be unit-tested
 * without a real terminal instance or a DOM canvas.
 *
 * Key handling deliberately resolves to an explicit action instead of leaning
 * on xterm's default key processing: `Ctrl+C` has to choose between copying a
 * selection and sending SIGINT, and making that choice visible keeps it
 * testable.
 */

import { useCallback, useMemo } from 'react';
import { isMacPlatform } from '../../../utils/composerKeyboardShortcuts';
import { copyToClipboard } from '../../../utils/format';
import type { ContextMenuItem } from '../../../tasks/comments/ContextMenu';

/** The parts of xterm's `Terminal` this module touches. */
export interface ClipboardTerminal {
    getSelection(): string;
    selectAll(): void;
    clear(): void;
    buffer?: {
        active?: {
            length: number;
            getLine(index: number): { translateToString(trimRight?: boolean): string } | undefined;
        };
    };
}

export interface TerminalKeyEventLike {
    type?: string;
    key: string;
    ctrlKey?: boolean;
    metaKey?: boolean;
    shiftKey?: boolean;
    altKey?: boolean;
}

export type TerminalKeyAction = 'copy' | 'paste' | 'interrupt' | 'noop' | 'passthrough';

/** The SIGINT byte a shell expects for Ctrl+C. */
export const SIGINT_SEQUENCE = '\x03';

/**
 * Decide what a key event means for the terminal.
 *
 * macOS: Cmd+C / Cmd+V are the clipboard keys and Ctrl+C always reaches the
 * shell. Elsewhere: Ctrl+Shift+C / Ctrl+Shift+V copy and paste, and a bare
 * Ctrl+C copies only when something is selected.
 */
export function classifyTerminalKeyEvent(
    event: TerminalKeyEventLike,
    opts: { isMac: boolean; hasSelection: boolean },
): TerminalKeyAction {
    if (event.type && event.type !== 'keydown') return 'passthrough';
    if (event.altKey) return 'passthrough';

    const key = (event.key ?? '').toLowerCase();
    const ctrl = event.ctrlKey === true;
    const meta = event.metaKey === true;
    const shift = event.shiftKey === true;

    if (opts.isMac) {
        if (meta && !ctrl) {
            if (key === 'c') return opts.hasSelection ? 'copy' : 'noop';
            if (key === 'v') return 'paste';
        }
        // Ctrl+C on macOS always belongs to the shell.
        if (ctrl && !meta && !shift && key === 'c') return 'interrupt';
        return 'passthrough';
    }

    if (ctrl && !meta) {
        if (shift) {
            // Swallow a selection-less Ctrl+Shift+C so it cannot reach the
            // shell as a stray SIGINT.
            if (key === 'c') return opts.hasSelection ? 'copy' : 'noop';
            if (key === 'v') return 'paste';
            return 'passthrough';
        }
        if (key === 'c') return opts.hasSelection ? 'copy' : 'interrupt';
    }

    return 'passthrough';
}

/**
 * Flatten the whole scrollback buffer to plain text.
 *
 * Trailing whitespace is trimmed per line, and the trailing run of blank lines
 * (the unused rows below the prompt) is dropped.
 */
export function readTerminalBuffer(term: ClipboardTerminal): string {
    const active = term.buffer?.active;
    if (!active) return term.getSelection() ?? '';

    const lines: string[] = [];
    for (let i = 0; i < active.length; i++) {
        const line = active.getLine(i);
        lines.push(line ? line.translateToString(true) : '');
    }
    while (lines.length > 0 && lines[lines.length - 1].trim() === '') {
        lines.pop();
    }
    return lines.join('\n');
}

export interface TerminalClipboardActions {
    /** Copy the current selection. No-op (clipboard untouched) when empty. */
    copySelection: () => Promise<void>;
    /** Read the clipboard and send it as terminal input. Fails silently. */
    paste: () => Promise<void>;
    /** Copy the entire scrollback buffer. */
    copyAll: () => Promise<void>;
    selectAll: () => void;
    /** Wipe the local UI scrollback. Sends nothing to the shell. */
    clearTerminal: () => void;
    hasSelection: () => boolean;
    /**
     * xterm `attachCustomKeyEventHandler` callback: `false` swallows the key.
     */
    handleKeyEvent: (event: TerminalKeyEventLike) => boolean;
}

export interface UseTerminalClipboardOptions {
    getTerminal: () => ClipboardTerminal | null;
    sendInput: (data: string) => void;
    /** Overridable for tests; defaults to `navigator.platform`. */
    platform?: string;
    /** Overridable for tests; defaults to `navigator.clipboard.readText`. */
    readClipboard?: () => Promise<string>;
}

async function readClipboardText(): Promise<string> {
    const clipboard = typeof navigator === 'undefined' ? undefined : navigator.clipboard;
    if (!clipboard || typeof clipboard.readText !== 'function') return '';
    return clipboard.readText();
}

export function useTerminalClipboard({
    getTerminal,
    sendInput,
    platform,
    readClipboard,
}: UseTerminalClipboardOptions): TerminalClipboardActions {
    const isMac = useMemo(() => isMacPlatform(platform), [platform]);

    const hasSelection = useCallback(() => {
        const term = getTerminal();
        return !!term && (term.getSelection() ?? '').length > 0;
    }, [getTerminal]);

    const copySelection = useCallback(async () => {
        const term = getTerminal();
        if (!term) return;
        const selection = term.getSelection() ?? '';
        // Never clear the clipboard when there is nothing selected.
        if (selection.length === 0) return;
        try {
            await copyToClipboard(selection);
        } catch {
            // Silent, like a normal terminal.
        }
    }, [getTerminal]);

    const copyAll = useCallback(async () => {
        const term = getTerminal();
        if (!term) return;
        const text = readTerminalBuffer(term);
        if (text.length === 0) return;
        try {
            await copyToClipboard(text);
        } catch {
            // Silent.
        }
    }, [getTerminal]);

    const paste = useCallback(async () => {
        try {
            const text = await (readClipboard ? readClipboard() : readClipboardText());
            if (text) sendInput(text);
        } catch {
            // Clipboard read denied or unavailable — the browser's native
            // Ctrl+V through xterm's hidden textarea remains the fallback.
        }
    }, [readClipboard, sendInput]);

    const selectAll = useCallback(() => {
        getTerminal()?.selectAll();
    }, [getTerminal]);

    const clearTerminal = useCallback(() => {
        getTerminal()?.clear();
    }, [getTerminal]);

    const handleKeyEvent = useCallback((event: TerminalKeyEventLike): boolean => {
        const action = classifyTerminalKeyEvent(event, { isMac, hasSelection: hasSelection() });
        switch (action) {
            case 'copy':
                void copySelection();
                return false;
            case 'paste':
                void paste();
                return false;
            case 'interrupt':
                sendInput(SIGINT_SEQUENCE);
                return false;
            case 'noop':
                return false;
            default:
                return true;
        }
    }, [isMac, hasSelection, copySelection, paste, sendInput]);

    return { copySelection, paste, copyAll, selectAll, clearTerminal, hasSelection, handleKeyEvent };
}

/**
 * The terminal right-click menu. Kept next to the actions so the wiring can be
 * asserted without rendering xterm.
 */
export function buildTerminalContextMenuItems(
    actions: Pick<TerminalClipboardActions, 'copySelection' | 'paste' | 'copyAll' | 'selectAll' | 'clearTerminal'>,
    opts: { hasSelection: boolean },
): ContextMenuItem[] {
    return [
        { label: 'Copy', disabled: !opts.hasSelection, onClick: () => { void actions.copySelection(); } },
        { label: 'Paste', onClick: () => { void actions.paste(); } },
        { label: 'Copy all output', onClick: () => { void actions.copyAll(); } },
        { label: 'Select all', onClick: () => actions.selectAll() },
        { label: '', separator: true, onClick: () => {} },
        { label: 'Clear terminal', onClick: () => actions.clearTerminal() },
    ];
}
