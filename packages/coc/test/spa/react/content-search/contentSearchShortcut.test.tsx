/**
 * Ctrl/Cmd+Shift+F ownership for the tracked content-search overlay.
 *
 * The rule is pure so every cell of the scope/focus/open matrix can be pinned
 * without a DOM; the hook tests then prove the listener is wired in the capture
 * phase, survives an input or editor having focus, keeps its hands off a
 * terminal, and unregisters on unmount.
 */
import { describe, expect, it, vi, afterEach } from 'vitest';
import { renderHook, cleanup } from '@testing-library/react';
import {
    contentSearchOwner,
    contentSearchShortcut,
    resolveContentSearchScope,
} from '../../../../src/server/spa/client/react/features/repo-detail/content-search/contentSearchShortcut';
import {
    focusIsInTerminal,
    useContentSearchShortcut,
} from '../../../../src/server/spa/client/react/features/repo-detail/content-search/useContentSearchShortcut';

afterEach(() => {
    cleanup();
    document.body.innerHTML = '';
});

function key(overrides: Partial<KeyboardEventInit> = {}): KeyboardEvent {
    return new KeyboardEvent('keydown', {
        key: 'F',
        ctrlKey: true,
        shiftKey: true,
        bubbles: true,
        cancelable: true,
        ...overrides,
    });
}

describe('contentSearchShortcut', () => {
    it('claims Ctrl+Shift+F and Cmd+Shift+F', () => {
        expect(contentSearchShortcut(key())).toBe('search');
        expect(contentSearchShortcut(key({ ctrlKey: false, metaKey: true }))).toBe('search');
    });

    it('accepts either case of the key, since Shift reports an uppercase F', () => {
        expect(contentSearchShortcut(key({ key: 'f' }))).toBe('search');
        expect(contentSearchShortcut(key({ key: 'F' }))).toBe('search');
    });

    it('ignores the plain find shortcut, Alt variants, and other letters', () => {
        expect(contentSearchShortcut(key({ shiftKey: false }))).toBeNull();
        expect(contentSearchShortcut(key({ altKey: true }))).toBeNull();
        expect(contentSearchShortcut(key({ ctrlKey: false, metaKey: false }))).toBeNull();
        expect(contentSearchShortcut(key({ key: 'p' }))).toBeNull();
    });
});

describe('resolveContentSearchScope', () => {
    it('treats an ordinary workspace id as a repo scope', () => {
        expect(resolveContentSearchScope('coc')).toBe('repo');
    });

    it('recognizes a repo-group virtual workspace', () => {
        expect(resolveContentSearchScope('group-my-stack')).toBe('group');
    });

    it('declines the client-side virtual scopes and an absent selection', () => {
        expect(resolveContentSearchScope('my_work')).toBeNull();
        expect(resolveContentSearchScope('my_life')).toBeNull();
        expect(resolveContentSearchScope(null)).toBeNull();
        expect(resolveContentSearchScope('')).toBeNull();
    });
});

describe('contentSearchOwner', () => {
    it('opens for a repo and for a repo group', () => {
        expect(contentSearchOwner({ scope: 'repo', focusInTerminal: false, overlayOpen: false })).toBe('open');
        expect(contentSearchOwner({ scope: 'group', focusInTerminal: false, overlayOpen: false })).toBe('open');
    });

    it('focuses the existing overlay instead of stacking another one', () => {
        expect(contentSearchOwner({ scope: 'repo', focusInTerminal: false, overlayOpen: true })).toBe('focus');
    });

    it('leaves the event alone inside a terminal, open or not', () => {
        expect(contentSearchOwner({ scope: 'repo', focusInTerminal: true, overlayOpen: false })).toBe('ignore');
        expect(contentSearchOwner({ scope: 'group', focusInTerminal: true, overlayOpen: true })).toBe('ignore');
    });

    it('never claims the key in an unrelated scope, whatever the focus', () => {
        expect(contentSearchOwner({ scope: null, focusInTerminal: false, overlayOpen: false })).toBe('ignore');
        expect(contentSearchOwner({ scope: null, focusInTerminal: true, overlayOpen: true })).toBe('ignore');
    });
});

describe('focusIsInTerminal', () => {
    it('is true for xterm’s helper textarea and false for an ordinary input', () => {
        document.body.innerHTML = `
            <div class="xterm"><textarea class="xterm-helper-textarea" id="term"></textarea></div>
            <input id="plain" />
        `;
        (document.getElementById('term') as HTMLTextAreaElement).focus();
        expect(focusIsInTerminal()).toBe(true);
        (document.getElementById('plain') as HTMLInputElement).focus();
        expect(focusIsInTerminal()).toBe(false);
    });

    it('is false when nothing is focused', () => {
        expect(focusIsInTerminal()).toBe(false);
    });
});

interface Handlers {
    onOpen: ReturnType<typeof vi.fn>;
    onFocusExisting: ReturnType<typeof vi.fn>;
}

function mountShortcut(
    scope: 'repo' | 'group' | null,
    overlayOpen = false,
): { handlers: Handlers; unmount: () => void } {
    const handlers: Handlers = { onOpen: vi.fn(), onFocusExisting: vi.fn() };
    const { unmount } = renderHook(() => useContentSearchShortcut({
        scope,
        overlayOpen,
        onOpen: handlers.onOpen,
        onFocusExisting: handlers.onFocusExisting,
    }));
    return { handlers, unmount };
}

describe('useContentSearchShortcut', () => {
    it('opens the overlay and swallows the event from a repo scope', () => {
        const { handlers } = mountShortcut('repo');
        const event = key();
        document.dispatchEvent(event);
        expect(handlers.onOpen).toHaveBeenCalledTimes(1);
        expect(event.defaultPrevented).toBe(true);
    });

    it('opens from a repo-group scope too', () => {
        const { handlers } = mountShortcut('group');
        document.dispatchEvent(key({ metaKey: true, ctrlKey: false }));
        expect(handlers.onOpen).toHaveBeenCalledTimes(1);
    });

    it('wins while focus sits in an ordinary input', () => {
        document.body.innerHTML = '<input id="composer" />';
        const input = document.getElementById('composer') as HTMLInputElement;
        input.focus();
        const { handlers } = mountShortcut('repo');
        const event = key();
        input.dispatchEvent(event);
        expect(handlers.onOpen).toHaveBeenCalledTimes(1);
        expect(event.defaultPrevented).toBe(true);
    });

    it('wins over a code editor that stops the event in the bubble phase', () => {
        document.body.innerHTML = '<div id="editor"><textarea id="buffer"></textarea></div>';
        const editor = document.getElementById('editor') as HTMLDivElement;
        const monacoLike = vi.fn((e: Event) => { e.stopPropagation(); e.preventDefault(); });
        editor.addEventListener('keydown', monacoLike);
        const { handlers } = mountShortcut('repo');
        (document.getElementById('buffer') as HTMLTextAreaElement).focus();
        document.getElementById('buffer')!.dispatchEvent(key());
        expect(handlers.onOpen).toHaveBeenCalledTimes(1);
        // Capture-phase stopPropagation means the editor never sees the key.
        expect(monacoLike).not.toHaveBeenCalled();
    });

    it('leaves terminal key handling untouched', () => {
        document.body.innerHTML = '<div class="xterm"><textarea id="term"></textarea></div>';
        const term = document.getElementById('term') as HTMLTextAreaElement;
        term.focus();
        const { handlers } = mountShortcut('repo');
        const event = key();
        term.dispatchEvent(event);
        expect(handlers.onOpen).not.toHaveBeenCalled();
        expect(handlers.onFocusExisting).not.toHaveBeenCalled();
        expect(event.defaultPrevented).toBe(false);
    });

    it('does not listen at all in an unrelated scope', () => {
        const { handlers } = mountShortcut(null);
        const event = key();
        document.dispatchEvent(event);
        expect(handlers.onOpen).not.toHaveBeenCalled();
        expect(event.defaultPrevented).toBe(false);
    });

    it('re-focuses rather than stacking a second overlay when repeated', () => {
        const { handlers } = mountShortcut('repo', true);
        document.dispatchEvent(key());
        document.dispatchEvent(key());
        expect(handlers.onOpen).not.toHaveBeenCalled();
        expect(handlers.onFocusExisting).toHaveBeenCalledTimes(2);
    });

    it('removes its listener on unmount', () => {
        const { handlers, unmount } = mountShortcut('repo');
        unmount();
        const event = key();
        document.dispatchEvent(event);
        expect(handlers.onOpen).not.toHaveBeenCalled();
        expect(event.defaultPrevented).toBe(false);
    });
});
