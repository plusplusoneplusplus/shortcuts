/**
 * listIndentation.test.ts — Tab on a list range must nest the items (bullet
 * moves), never stamp `data-indent` on the list-item paragraphs.
 *
 * A `paragraph` / `heading` inside a list/task item owns its horizontal
 * position through the list nesting, not through the indent attribute. The
 * indent commands skip list-owned blocks; a pure-list range therefore reports
 * "nothing changed" and the Tab shortcut falls through to StarterKit's
 * ListItem Tab (sinkListItem), which nests the selected items.
 *
 * Note: sinkListItem can only nest an item that has a preceding sibling, so a
 * range that starts at the very first item nests nothing — but critically it no
 * longer produces the broken half-state (text shifts, bullet does not) because
 * no `data-indent` is stamped on the list paragraphs.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { Editor } from '@tiptap/core';
import { StarterKit } from '@tiptap/starter-kit';
import { TaskList } from '@tiptap/extension-task-list';
import { TaskItem } from '@tiptap/extension-task-item';
import { IndentExtension } from '../../../../src/server/spa/client/react/features/notes/editor/extensions/indentExtension';

function makeEditor(content: string) {
    return new Editor({
        extensions: [
            StarterKit.configure({ heading: { levels: [1, 2, 3] }, link: false }),
            TaskList,
            TaskItem.configure({ nested: true }),
            IndentExtension,
        ],
        content,
    });
}

/** Dispatch a real Tab / Shift-Tab keydown to exercise the keymap. */
function pressTab(editor: Editor, shift = false): void {
    editor.view.dom.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Tab', shiftKey: shift, bubbles: true, cancelable: true }),
    );
}

/** The text position just inside the Nth paragraph in document order. */
function insideParagraph(editor: Editor, n: number): number {
    let pos = 0;
    let count = 0;
    editor.state.doc.descendants((node, p) => {
        if (node.type.name === 'paragraph') {
            count += 1;
            if (count === n) pos = p + 1;
        }
        return true;
    });
    if (pos === 0) throw new Error(`no paragraph #${n} found`);
    return pos;
}

/** Select a text range from inside paragraph `a` through inside paragraph `b`. */
function selectAcrossParagraphs(editor: Editor, a: number, b: number): void {
    editor.commands.setTextSelection({ from: insideParagraph(editor, a), to: insideParagraph(editor, b) });
}

/** Count how many list nodes (`bulletList` + `taskList`) exist in the doc. */
function listNodeCount(editor: Editor): number {
    let n = 0;
    editor.state.doc.descendants((node) => {
        if (node.type.name === 'bulletList' || node.type.name === 'taskList') n += 1;
        return true;
    });
    return n;
}

describe('list-range Tab nests instead of half-indenting', () => {
    let editor: Editor;
    afterEach(() => editor?.destroy());

    it('range Tab across bullets nests them (no data-indent)', () => {
        editor = makeEditor('<ul><li><p>one</p></li><li><p>two</p></li><li><p>three</p></li></ul>');
        expect(listNodeCount(editor)).toBe(1);

        // Select items 2 & 3 (they have item 1 as a preceding sibling to nest under).
        selectAcrossParagraphs(editor, 2, 3);
        pressTab(editor);

        // Items 2 & 3 are now nested under item 1 → an extra list node appears.
        expect(listNodeCount(editor)).toBeGreaterThan(1);
        // The list-item paragraphs must never carry data-indent.
        expect(editor.getHTML()).not.toContain('data-indent');
    });

    it('range Shift-Tab un-nests back and stays free of data-indent', () => {
        editor = makeEditor('<ul><li><p>one</p></li><li><p>two</p></li><li><p>three</p></li></ul>');
        selectAcrossParagraphs(editor, 2, 3);
        pressTab(editor);
        const nestedCount = listNodeCount(editor);
        expect(nestedCount).toBeGreaterThan(1);

        // Reselect the (now nested) items and lift them back out.
        selectAcrossParagraphs(editor, 2, 3);
        pressTab(editor, true);

        expect(listNodeCount(editor)).toBeLessThan(nestedCount);
        expect(editor.getHTML()).not.toContain('data-indent');
    });

    it('task-item range Tab nests without data-indent', () => {
        editor = makeEditor(
            '<ul data-type="taskList">' +
                '<li data-type="taskItem" data-checked="false"><p>a</p></li>' +
                '<li data-type="taskItem" data-checked="false"><p>b</p></li>' +
                '<li data-type="taskItem" data-checked="false"><p>c</p></li></ul>',
        );
        expect(listNodeCount(editor)).toBe(1);

        selectAcrossParagraphs(editor, 2, 3);
        pressTab(editor);

        expect(listNodeCount(editor)).toBeGreaterThan(1);
        expect(editor.getHTML()).not.toContain('data-indent');
    });

    it('range starting at the first item is a safe no-op (the original bug: never half-indents)', () => {
        editor = makeEditor('<ul><li><p>one</p></li><li><p>two</p></li></ul>');
        // Selecting from the first item can't nest (no preceding sibling)...
        selectAcrossParagraphs(editor, 1, 2);
        pressTab(editor);
        // ...but it must NOT stamp data-indent — no broken "text moved, dot didn't" state.
        expect(editor.getHTML()).not.toContain('data-indent');
    });

    it('mixed selection: heading, list container, and trailing paragraph all indent; list-item paragraphs do not', () => {
        editor = makeEditor('<h1>title</h1><ul><li><p>a</p></li><li><p>b</p></li></ul><p>tail</p>');
        editor.commands.selectAll();
        pressTab(editor);

        const html = editor.getHTML();
        // Heading, list container, and the standalone trailing paragraph are indented.
        expect(html).toMatch(/<h1[^>]*data-indent="1"/);
        expect(html).toMatch(/<ul[^>]*data-indent="1"/);
        expect(html).toMatch(/<p[^>]*data-indent="1"[^>]*>tail<\/p>/);
        // The list-item paragraphs (<p>a</p>, <p>b</p>) must never carry data-indent.
        expect(html).not.toMatch(/<p[^>]*data-indent[^>]*>[ab]<\/p>/);
    });

    it('command-level increaseIndent (toolbar path) indents the list container, not the paragraphs', () => {
        editor = makeEditor('<ul><li><p>one</p></li><li><p>two</p></li></ul>');
        selectAcrossParagraphs(editor, 1, 2);
        // Toolbar buttons call the command directly; should indent the list container.
        const changed = editor.chain().focus().increaseIndent().run();
        expect(changed).toBe(true);
        const html = editor.getHTML();
        // The list container gains data-indent.
        expect(html).toContain('data-indent="1"');
        // The child paragraphs must never carry data-indent.
        expect(html).not.toMatch(/<p[^>]*data-indent/);
    });
});

describe('regressions: single-cursor and plain-block indent still work', () => {
    let editor: Editor;
    afterEach(() => editor?.destroy());

    it('single-cursor list Tab still nests with no data-indent', () => {
        editor = makeEditor('<ul><li><p>one</p></li><li><p>two</p></li></ul>');
        editor.commands.setTextSelection(insideParagraph(editor, 2));
        pressTab(editor);
        expect(listNodeCount(editor)).toBeGreaterThan(1);
        expect(editor.getHTML()).not.toContain('data-indent');
    });

    it('plain paragraph Tab still sets data-indent="1"', () => {
        editor = makeEditor('<p>hello</p>');
        editor.commands.setTextSelection(2);
        pressTab(editor);
        expect(editor.getHTML()).toContain('data-indent="1"');
    });
});
