/**
 * NoteEditorToolbar-live.test.tsx — the heading/list dropdowns against a REAL
 * TipTap editor instead of a mock.
 *
 * The behavioural suite (test/spa/react/notes/NoteEditorToolbar.test.tsx) drives
 * the dropdowns with a mock editor, so it can only prove the right command was
 * called. This file covers the other half of AC-04: markdown input rules
 * (`## `, `- `, `[] `) and the Mod-Alt-N shortcuts still work after the toolbar
 * change, the trigger labels track the real document state live, and picking a
 * menu item actually rewrites the document.
 */

// @vitest-environment jsdom

import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import { useEditor, EditorContent } from '@tiptap/react';
import type { Editor } from '@tiptap/react';
import { StarterKit } from '@tiptap/starter-kit';
import { TaskList } from '@tiptap/extension-task-list';
import { TaskItem } from '@tiptap/extension-task-item';
import { NoteEditorToolbar } from '../../../../../../src/server/spa/client/react/features/notes/editor/NoteEditorToolbar';

afterEach(cleanup);

let editor: Editor | null = null;

/** Mirrors RichEditorCore's wiring for the parts these tests exercise. */
function Harness() {
    editor = useEditor({
        shouldRerenderOnTransaction: true,
        immediatelyRender: true,
        extensions: [
            StarterKit.configure({ heading: { levels: [1, 2, 3, 4, 5, 6] }, link: false }),
            TaskList,
            TaskItem.configure({ nested: true }),
        ],
        content: '<p>hello</p>',
    });
    return (
        <div>
            <NoteEditorToolbar editor={editor} />
            <EditorContent editor={editor} />
        </div>
    );
}

function mount(): Editor {
    render(<Harness />);
    if (!editor) throw new Error('editor did not initialise');
    return editor;
}

/**
 * Type text the way a user does, so ProseMirror input rules see it —
 * `insertContent` bypasses `handleTextInput` and would never fire them.
 */
function type(ed: Editor, text: string) {
    act(() => {
        const { view } = ed;
        for (const ch of text) {
            const { from, to } = view.state.selection;
            const handled = view.someProp('handleTextInput', (f) => f(view, from, to, ch));
            if (!handled) view.dispatch(view.state.tr.insertText(ch, from, to));
        }
    });
}

/** Put the caret at the very start of the document. */
function caretAtStart(ed: Editor) {
    act(() => {
        ed.commands.setTextSelection(1);
    });
}

const headingLabel = () => screen.getByTestId('heading-dropdown-label').textContent;
const listLabel = () => screen.getByTestId('list-dropdown-label').textContent;

function openMenu(testId: string) {
    fireEvent.mouseDown(screen.getByTestId(testId));
}

function selectItem(testId: string) {
    fireEvent.mouseDown(screen.getByTestId(testId));
}

describe('heading dropdown against a real editor', () => {
    it('starts on a paragraph with a plain "H" label', () => {
        mount();
        expect(headingLabel()).toBe('H');
    });

    it.each([
        ['## ', 'H2'],
        ['### ', 'H3'],
        ['#### ', 'H4'],
        ['###### ', 'H6'],
    ])('the "%s" input rule still applies and the trigger reads %s', (input, label) => {
        const ed = mount();
        caretAtStart(ed);
        type(ed, input);

        expect(ed.isActive('heading', { level: input.trim().length })).toBe(true);
        expect(headingLabel()).toBe(label);
    });

    it('the Mod-Alt-N keyboard shortcut still applies', () => {
        const ed = mount();
        act(() => {
            ed.commands.keyboardShortcut('Mod-Alt-3');
        });

        expect(ed.isActive('heading', { level: 3 })).toBe(true);
        expect(headingLabel()).toBe('H3');
    });

    it('picking "Heading 2" rewrites the document and updates the trigger', () => {
        const ed = mount();

        openMenu('heading-dropdown');
        selectItem('heading-item-2');

        expect(ed.getHTML()).toContain('<h2');
        expect(headingLabel()).toBe('H2');
        expect(screen.queryByTestId('heading-dropdown-menu')).toBeNull();
    });

    it('picking "Paragraph" converts a heading back and resets the trigger', () => {
        const ed = mount();
        caretAtStart(ed);
        type(ed, '## ');
        expect(headingLabel()).toBe('H2');

        openMenu('heading-dropdown');
        selectItem('heading-item-paragraph');

        expect(ed.getHTML()).toContain('<p');
        expect(ed.isActive('heading')).toBe(false);
        expect(headingLabel()).toBe('H');
    });

    it('marks the active level in the menu', () => {
        const ed = mount();
        act(() => {
            ed.commands.keyboardShortcut('Mod-Alt-4');
        });

        openMenu('heading-dropdown');

        expect(screen.getByTestId('heading-item-4').getAttribute('aria-checked')).toBe('true');
        expect(screen.getByTestId('heading-item-2').getAttribute('aria-checked')).toBe('false');
    });
});

describe('list dropdown against a real editor', () => {
    it('the "- " input rule still applies and the trigger shows the bullet state', () => {
        const ed = mount();
        caretAtStart(ed);
        type(ed, '- ');

        expect(ed.isActive('bulletList')).toBe(true);
        expect(listLabel()).toBe('•');
    });

    it('the "1. " input rule still applies and the trigger shows the ordered state', () => {
        const ed = mount();
        caretAtStart(ed);
        type(ed, '1. ');

        expect(ed.isActive('orderedList')).toBe(true);
        expect(listLabel()).toBe('1.');
    });

    it('the "[] " input rule still applies and the trigger shows the task state', () => {
        const ed = mount();
        caretAtStart(ed);
        type(ed, '[] ');

        expect(ed.isActive('taskList')).toBe(true);
        expect(listLabel()).toBe('☑');
    });

    it('picking "Task List" wraps the line, and picking it again unwraps it', () => {
        const ed = mount();

        openMenu('list-dropdown');
        selectItem('list-item-task');
        expect(ed.isActive('taskList')).toBe(true);
        expect(listLabel()).toBe('☑');
        expect(screen.queryByTestId('list-dropdown-menu')).toBeNull();

        openMenu('list-dropdown');
        selectItem('list-item-task');
        expect(ed.isActive('taskList')).toBe(false);
        expect(listLabel()).toBe('•');
    });

    it('bullet → ordered converts the list rather than nesting it', () => {
        const ed = mount();

        openMenu('list-dropdown');
        selectItem('list-item-bullet');
        expect(ed.isActive('bulletList')).toBe(true);

        openMenu('list-dropdown');
        selectItem('list-item-ordered');

        expect(ed.isActive('orderedList')).toBe(true);
        expect(ed.isActive('bulletList')).toBe(false);
        expect(ed.getHTML()).not.toContain('<ul');
    });

    it('marks the active list type in the menu', () => {
        const ed = mount();
        caretAtStart(ed);
        type(ed, '1. ');

        openMenu('list-dropdown');

        expect(screen.getByTestId('list-item-ordered').getAttribute('aria-checked')).toBe('true');
        expect(screen.getByTestId('list-item-bullet').getAttribute('aria-checked')).toBe('false');
    });
});
