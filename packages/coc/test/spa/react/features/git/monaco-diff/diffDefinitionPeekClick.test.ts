// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    installPeekDefinitionClick,
    PEEK_DEFINITION_ACTION,
} from '../../../../../../src/server/spa/client/react/features/git/diff/diffDefinitionPeekClick';

const position = { lineNumber: 4, column: 9 };

function setup(platform = 'Linux x86_64', target: unknown = { type: 6, position }) {
    const container = document.createElement('div');
    const view = document.createElement('div');
    container.appendChild(view);
    document.body.appendChild(container);
    // Monaco's own mouse handling listens on a descendant in the bubble phase.
    const monacoSaw: string[] = [];
    for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
        view.addEventListener(type, event => monacoSaw.push(event.type));
    }
    const editor = {
        getContainerDomNode: () => container,
        getTargetAtClientPoint: vi.fn(() => target),
        setPosition: vi.fn(),
        focus: vi.fn(),
        trigger: vi.fn(),
    };
    const model = { getWordAtPosition: vi.fn(() => ({ word: 'parse', startColumn: 7, endColumn: 12 })) };
    const peek = installPeekDefinitionClick({ editor: editor as any, model, platform });
    const fire = (type: string, init: MouseEventInit) => {
        const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: 10, clientY: 20, ...init });
        view.dispatchEvent(event);
        return event;
    };
    const click = (init: MouseEventInit) => ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].map(type => fire(type, init));
    return { container, editor, model, peek, monacoSaw, click, fire };
}

afterEach(() => { document.body.innerHTML = ''; });

describe('diff Ctrl/Cmd+Alt+Click peek', () => {
    it('peeks the clicked word once and keeps the whole gesture from Monaco', () => {
        const s = setup();
        const events = s.click({ ctrlKey: true, altKey: true });
        expect(s.editor.getTargetAtClientPoint).toHaveBeenCalledWith(10, 20);
        expect(s.editor.setPosition).toHaveBeenCalledWith(position);
        expect(s.editor.focus).toHaveBeenCalledOnce();
        expect(s.editor.trigger).toHaveBeenCalledOnce();
        expect(s.editor.trigger).toHaveBeenCalledWith('mouse', PEEK_DEFINITION_ACTION, null);
        expect(s.monacoSaw).toEqual([]);
        // pointerdown stays unprevented so the browser still sends mousedown.
        expect(events.map(event => event.defaultPrevented)).toEqual([false, true, false, false, false]);
    });

    it('uses Cmd+Alt on macOS and Ctrl+Alt elsewhere', () => {
        const mac = setup('MacIntel');
        mac.click({ ctrlKey: true, altKey: true });
        expect(mac.editor.trigger).not.toHaveBeenCalled();
        mac.click({ metaKey: true, altKey: true });
        expect(mac.editor.trigger).toHaveBeenCalledOnce();
    });

    it('leaves plain Ctrl+Click, Alt+Click and other buttons to Monaco', () => {
        const s = setup();
        s.click({ ctrlKey: true });
        s.click({ altKey: true });
        s.click({ ctrlKey: true, altKey: true, button: 2 });
        expect(s.editor.trigger).not.toHaveBeenCalled();
        expect(s.monacoSaw).toHaveLength(15);
    });

    it('leaves clicks off a word or outside the text to Monaco', () => {
        const gutter = setup('Linux x86_64', { type: 3, position });
        gutter.click({ ctrlKey: true, altKey: true });
        expect(gutter.editor.trigger).not.toHaveBeenCalled();
        expect(gutter.monacoSaw).toHaveLength(5);

        const blank = setup();
        blank.model.getWordAtPosition.mockReturnValue(null as any);
        blank.click({ ctrlKey: true, altKey: true });
        expect(blank.editor.trigger).not.toHaveBeenCalled();
    });

    it('stops listening on dispose and is inert without DOM access', () => {
        const s = setup();
        s.peek.dispose();
        s.peek.dispose();
        s.click({ ctrlKey: true, altKey: true });
        expect(s.editor.trigger).not.toHaveBeenCalled();
        expect(s.monacoSaw).toHaveLength(5);

        const inert = installPeekDefinitionClick({ editor: {}, model: s.model });
        expect(() => inert.dispose()).not.toThrow();
    });
});
