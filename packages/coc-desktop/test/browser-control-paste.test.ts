// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { browserPaste } from '../src/browser-control-paste';

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); Reflect.deleteProperty(window, '__cocBrowserControl'); document.body.replaceChildren(); });

function fixture() {
    vi.useFakeTimers();
    document.body.innerHTML = '<div contenteditable="true" tabindex="0">Synthetic selection</div><button>Other</button>';
    const editor = document.querySelector('div')!;
    Object.defineProperty(editor, 'isContentEditable', { value: true });
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    editor.focus();
    document.getSelection()!.selectAllChildren(editor);
    Object.defineProperty(window, '__cocBrowserControl', { value: { refs: new Map([['e1', editor]]) }, configurable: true });
    return editor;
}

describe('rich paste selection guard', () => {
    it('prepares without changing focus or selection and ignores synthetic paste events', () => {
        const editor = fixture();
        const selection = document.getSelection()!;
        const anchor = selection.anchorNode, focus = selection.focusNode;
        expect(browserPaste('e1', 'token', 'prepare')).toBe(true);
        editor.dispatchEvent(new Event('paste', { bubbles: true }));
        expect(browserPaste('e1', 'token', 'result')).toBe(false);
        expect(document.activeElement).toBe(editor);
        expect(selection.anchorNode).toBe(anchor);
        expect(selection.focusNode).toBe(focus);
        expect(browserPaste('e1', 'token', 'check')).toBe(true);
        browserPaste('e1', 'token', 'cleanup');
    });

    it.each(['focus', 'selection', 'detached', 'stale-ref', 'inert'] as const)('rejects changed %s before dispatch', change => {
        const editor = fixture();
        browserPaste('e1', 'token', 'prepare');
        if (change === 'focus') document.querySelector('button')!.focus();
        if (change === 'selection') document.getSelection()!.collapse(editor.firstChild, 1);
        if (change === 'detached') editor.remove();
        if (change === 'stale-ref') Reflect.deleteProperty(window, '__cocBrowserControl');
        if (change === 'inert') editor.setAttribute('inert', '');
        expect(() => browserPaste('e1', 'token', 'check')).toThrow();
        vi.advanceTimersByTime(5000);
    });
});
