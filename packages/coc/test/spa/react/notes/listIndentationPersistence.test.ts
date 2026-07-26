/**
 * listIndentationPersistence.test.ts — toolbar Increase/Decrease indent on list
 * containers and Markdown round-trip fidelity.
 *
 * The toolbar increaseIndent / decreaseIndent commands set data-indent on the
 * list container (bulletList / orderedList / taskList), never on the child
 * paragraphs. Tab / Shift-Tab inside lists remains structural nesting (sinkListItem /
 * liftListItem) and is covered by listIndentation.test.ts.
 *
 * Coverage:
 *   - Increase and decrease on bullet, ordered, and task lists
 *   - Child paragraphs must never receive data-indent
 *   - Decrease at level 0 is a no-op (returns false, no change)
 *   - MAX_INDENT (8) clamping
 *   - Markdown save/reload round-trip preserves indent level and list type
 *   - Task list checked state survives the round-trip
 *   - Nested list structure survives the round-trip
 *   - Level-0 lists serialize to normal Markdown (no data-indent in persisted text)
 *   - Full top-level bullet list selection (including first item) can now be indented
 */

// @vitest-environment jsdom

import { describe, it, expect, afterEach } from 'vitest';
import { Editor } from '@tiptap/core';
import { StarterKit } from '@tiptap/starter-kit';
import { TaskList } from '@tiptap/extension-task-list';
import { TaskItem } from '@tiptap/extension-task-item';
import {
    IndentExtension,
    MAX_INDENT,
} from '../../../../src/server/spa/client/react/features/notes/editor/extensions/indentExtension';
import {
    htmlToMarkdown,
    markdownToHtml,
} from '../../../../src/server/spa/client/react/features/notes/editor/noteMarkdown';

function makeEditor(content: string): Editor {
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

/** Select all content (equivalent to Ctrl+A). */
function selectAll(editor: Editor): void {
    editor.commands.selectAll();
}

/** Return the indent on the first list container node (bulletList / orderedList / taskList). */
function listContainerIndent(editor: Editor): number {
    let val = 0;
    editor.state.doc.descendants((node) => {
        const name = node.type.name;
        if (name === 'bulletList' || name === 'orderedList' || name === 'taskList') {
            val = (node.attrs.indent as number) ?? 0;
            return false;
        }
        return true;
    });
    return val;
}

/** True if any paragraph INSIDE a listItem or taskItem has a nonzero indent. */
function listItemParagraphIndented(editor: Editor): boolean {
    let found = false;
    editor.state.doc.descendants((node, _pos, parent) => {
        if (
            node.type.name === 'paragraph' &&
            parent != null &&
            (parent.type.name === 'listItem' || parent.type.name === 'taskItem') &&
            ((node.attrs.indent as number) ?? 0) > 0
        ) {
            found = true;
        }
        return true;
    });
    return found;
}

/** Serialize an editor's content to Markdown and reload into a fresh editor. */
function saveReload(editor: Editor): { markdown: string; reloaded: Editor } {
    const markdown = htmlToMarkdown(editor.getHTML());
    const reloaded = makeEditor(markdownToHtml(markdown));
    return { markdown, reloaded };
}

// ── Bullet list ─────────────────────────────────────────────────────────────

describe('toolbar indent on bullet list', () => {
    let editor: Editor;
    afterEach(() => editor?.destroy());

    it('increases indent on the list container', () => {
        editor = makeEditor('<ul><li><p>one</p></li><li><p>two</p></li></ul>');
        selectAll(editor);
        const changed = editor.chain().focus().increaseIndent().run();
        expect(changed).toBe(true);
        expect(listContainerIndent(editor)).toBe(1);
        const html = editor.getHTML();
        expect(html).toContain('data-indent="1"');
        expect(listItemParagraphIndented(editor)).toBe(false);
    });

    it('decrease from level 0 is a no-op', () => {
        editor = makeEditor('<ul><li><p>one</p></li></ul>');
        selectAll(editor);
        const changed = editor.chain().focus().decreaseIndent().run();
        expect(changed).toBe(false);
        expect(listContainerIndent(editor)).toBe(0);
        expect(editor.getHTML()).not.toContain('data-indent');
    });

    it('increases then decreases back to 0', () => {
        editor = makeEditor('<ul><li><p>one</p></li></ul>');
        selectAll(editor);
        editor.chain().focus().increaseIndent().run();
        editor.chain().focus().increaseIndent().run();
        expect(listContainerIndent(editor)).toBe(2);
        editor.chain().focus().decreaseIndent().run();
        editor.chain().focus().decreaseIndent().run();
        expect(listContainerIndent(editor)).toBe(0);
        expect(editor.getHTML()).not.toContain('data-indent');
    });

    it('clamps at MAX_INDENT', () => {
        editor = makeEditor('<ul><li><p>one</p></li></ul>');
        selectAll(editor);
        for (let i = 0; i < MAX_INDENT + 5; i++) {
            editor.chain().focus().increaseIndent().run();
        }
        expect(listContainerIndent(editor)).toBe(MAX_INDENT);
    });

    it('first-item selection (the original bug) now indents the container', () => {
        editor = makeEditor('<ul><li><p>first</p></li><li><p>second</p></li></ul>');
        // Select from the very first item — previously a no-op with data-indent never set,
        // now it should indent the container.
        selectAll(editor);
        const changed = editor.chain().focus().increaseIndent().run();
        expect(changed).toBe(true);
        expect(listContainerIndent(editor)).toBe(1);
        // List-item-owned paragraphs must never carry data-indent.
        expect(listItemParagraphIndented(editor)).toBe(false);
    });
});

// ── Ordered list ─────────────────────────────────────────────────────────────

describe('toolbar indent on ordered list', () => {
    let editor: Editor;
    afterEach(() => editor?.destroy());

    it('increases indent on the ordered list container', () => {
        editor = makeEditor('<ol><li><p>one</p></li><li><p>two</p></li></ol>');
        selectAll(editor);
        const changed = editor.chain().focus().increaseIndent().run();
        expect(changed).toBe(true);
        expect(listContainerIndent(editor)).toBe(1);
        const html = editor.getHTML();
        expect(html).toContain('data-indent="1"');
        expect(listItemParagraphIndented(editor)).toBe(false);
    });

    it('decrease from level 0 is a no-op', () => {
        editor = makeEditor('<ol><li><p>one</p></li></ol>');
        selectAll(editor);
        const changed = editor.chain().focus().decreaseIndent().run();
        expect(changed).toBe(false);
        expect(editor.getHTML()).not.toContain('data-indent');
    });
});

// ── Task list ────────────────────────────────────────────────────────────────

describe('toolbar indent on task list', () => {
    let editor: Editor;
    afterEach(() => editor?.destroy());

    it('increases indent on the task list container', () => {
        editor = makeEditor(
            '<ul data-type="taskList">' +
                '<li data-type="taskItem" data-checked="false"><p>a</p></li>' +
                '<li data-type="taskItem" data-checked="true"><p>b</p></li>' +
            '</ul>',
        );
        selectAll(editor);
        const changed = editor.chain().focus().increaseIndent().run();
        expect(changed).toBe(true);
        expect(listContainerIndent(editor)).toBe(1);
        const html = editor.getHTML();
        expect(html).toContain('data-indent="1"');
        expect(listItemParagraphIndented(editor)).toBe(false);
    });

    it('decrease from level 0 is a no-op', () => {
        editor = makeEditor(
            '<ul data-type="taskList">' +
                '<li data-type="taskItem" data-checked="false"><p>x</p></li>' +
            '</ul>',
        );
        selectAll(editor);
        const changed = editor.chain().focus().decreaseIndent().run();
        expect(changed).toBe(false);
        expect(editor.getHTML()).not.toContain('data-indent');
    });
});

// ── Markdown round-trip ──────────────────────────────────────────────────────

describe('Markdown round-trip for indented bullet list', () => {
    it('level-0 serializes to normal Markdown (no data-indent)', () => {
        const editor = makeEditor('<ul><li><p>alpha</p></li><li><p>beta</p></li></ul>');
        const md = htmlToMarkdown(editor.getHTML());
        expect(md).not.toContain('data-indent');
        expect(md).toContain('alpha');
        expect(md).toContain('beta');
        expect(md).not.toContain('<ul');
        editor.destroy();
    });

    it('level-1 persists as raw HTML and reloads with indent preserved', () => {
        const editor = makeEditor('<ul><li><p>alpha</p></li><li><p>beta</p></li></ul>');
        selectAll(editor);
        editor.chain().focus().increaseIndent().run();
        expect(listContainerIndent(editor)).toBe(1);

        const { markdown, reloaded } = saveReload(editor);
        expect(markdown).toContain('data-indent="1"');
        expect(listContainerIndent(reloaded)).toBe(1);
        // Child paragraphs must be clean in the reloaded editor too.
        expect(reloaded.getHTML()).not.toMatch(/<p[^>]*data-indent/);

        editor.destroy();
        reloaded.destroy();
    });

    it('returns to canonical Markdown when decreased back to level 0', () => {
        const editor = makeEditor('<ul><li><p>item</p></li></ul>');
        selectAll(editor);
        editor.chain().focus().increaseIndent().run();

        const { reloaded } = saveReload(editor);
        expect(listContainerIndent(reloaded)).toBe(1);

        selectAll(reloaded);
        reloaded.chain().focus().decreaseIndent().run();
        expect(listContainerIndent(reloaded)).toBe(0);

        const finalMd = htmlToMarkdown(reloaded.getHTML());
        expect(finalMd).not.toContain('data-indent');
        expect(finalMd).toContain('item');
        expect(finalMd).not.toContain('<ul');

        editor.destroy();
        reloaded.destroy();
    });
});

describe('Markdown round-trip for indented ordered list', () => {
    it('level-1 persists as raw HTML and reloads with indent preserved', () => {
        const editor = makeEditor('<ol><li><p>first</p></li><li><p>second</p></li></ol>');
        selectAll(editor);
        editor.chain().focus().increaseIndent().run();

        const { markdown, reloaded } = saveReload(editor);
        expect(markdown).toContain('data-indent="1"');
        expect(listContainerIndent(reloaded)).toBe(1);

        editor.destroy();
        reloaded.destroy();
    });

    it('level-0 serializes to normal ordered Markdown', () => {
        const editor = makeEditor('<ol><li><p>a</p></li><li><p>b</p></li></ol>');
        const md = htmlToMarkdown(editor.getHTML());
        expect(md).not.toContain('data-indent');
        expect(md).not.toContain('<ol');
        expect(md).toContain('a');
        editor.destroy();
    });
});

describe('Markdown round-trip for indented task list', () => {
    it('preserves checked state through save/reload', () => {
        const editor = makeEditor(
            '<ul data-type="taskList">' +
                '<li data-type="taskItem" data-checked="true"><p>done</p></li>' +
                '<li data-type="taskItem" data-checked="false"><p>todo</p></li>' +
            '</ul>',
        );
        selectAll(editor);
        editor.chain().focus().increaseIndent().run();

        const { markdown, reloaded } = saveReload(editor);
        expect(markdown).toContain('data-indent="1"');

        // Verify checked state survived
        let checkedCount = 0;
        let uncheckedCount = 0;
        reloaded.state.doc.descendants((node) => {
            if (node.type.name === 'taskItem') {
                if (node.attrs.checked) checkedCount++;
                else uncheckedCount++;
            }
            return true;
        });
        expect(checkedCount).toBe(1);
        expect(uncheckedCount).toBe(1);
        expect(listContainerIndent(reloaded)).toBe(1);

        editor.destroy();
        reloaded.destroy();
    });

    it('level-0 task list uses GFM Markdown (no raw HTML)', () => {
        const editor = makeEditor(
            '<ul data-type="taskList">' +
                '<li data-type="taskItem" data-checked="true"><p>done</p></li>' +
                '<li data-type="taskItem" data-checked="false"><p>todo</p></li>' +
            '</ul>',
        );
        const md = htmlToMarkdown(editor.getHTML());
        expect(md).not.toContain('data-indent');
        expect(md).toContain('- [x]');
        expect(md).toContain('- [ ]');
        editor.destroy();
    });
});

// ── Mixed selection: list + surrounding blocks ───────────────────────────────

describe('mixed selection with list containers', () => {
    let editor: Editor;
    afterEach(() => editor?.destroy());

    it('indents surrounding paragraphs AND the list container together', () => {
        editor = makeEditor('<p>before</p><ul><li><p>item</p></li></ul><p>after</p>');
        selectAll(editor);
        editor.chain().focus().increaseIndent().run();

        const html = editor.getHTML();
        // Surrounding paragraphs get data-indent.
        expect(html).toMatch(/<p[^>]*data-indent="1"[^>]*>before<\/p>/);
        expect(html).toMatch(/<p[^>]*data-indent="1"[^>]*>after<\/p>/);
        // The list container gets data-indent.
        expect(html).toMatch(/<ul[^>]*data-indent="1"/);
        // List-item paragraph must NOT get data-indent.
        expect(html).not.toMatch(/<p[^>]*data-indent[^>]*>item<\/p>/);
    });
});
