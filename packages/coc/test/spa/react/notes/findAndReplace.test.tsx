/**
 * Tests for in-document find & replace in the notes rich editor.
 *
 * Find alone is already covered by the browser's native Ctrl+F; replace is the
 * capability with no workaround, so the emphasis here is on replace not
 * corrupting the document — marks, comment anchors, and undo in particular.
 *
 * The extension debounces `setSearchTerm` by 250ms in the app. Every editor
 * built here sets `searchDebounceMs: 0` so the assertions read synchronously.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { Editor } from '@tiptap/core';
import { StarterKit } from '@tiptap/starter-kit';
import { Highlight } from '@tiptap/extension-highlight';
import { FindAndReplace } from '@tiptap/extension-find-and-replace';
import { CommentExtension } from '../../../../src/server/spa/client/react/features/notes/editor/extensions/commentExtension';

interface FindState {
    results: { from: number; to: number }[];
    currentIndex: number | null;
    searchTerm: string;
}

const editors: Editor[] = [];

function makeEditor(content: string, extra: unknown[] = []): Editor {
    const editor = new Editor({
        content,
        extensions: [
            StarterKit.configure({ codeBlock: false }),
            Highlight.configure({ multicolor: true }),
            ...(extra as never[]),
            FindAndReplace.configure({ searchDebounceMs: 0, injectCSS: false }),
        ],
    });
    editors.push(editor);
    return editor;
}

function findState(editor: Editor): FindState {
    return (editor.storage as unknown as { findAndReplace: FindState }).findAndReplace;
}

/** Match count for a term, applied to an already-built editor. */
function search(editor: Editor, term: string): number {
    editor.commands.setSearchTerm(term);
    return findState(editor).results.length;
}

afterEach(() => {
    while (editors.length) editors.pop()?.destroy();
});

describe('find & replace — searching', () => {
    it('counts every match of the search term across the document', () => {
        const editor = makeEditor('<p>alpha beta alpha</p><p>alpha gamma</p>');

        expect(search(editor, 'alpha')).toBe(3);
    });

    it('reports no matches for a term that is absent', () => {
        const editor = makeEditor('<p>alpha beta</p>');

        expect(search(editor, 'delta')).toBe(0);
        expect(findState(editor).currentIndex).toBeNull();
    });

    it('clearSearch drops the term and all match highlights', () => {
        const editor = makeEditor('<p>alpha alpha</p>');
        search(editor, 'alpha');

        editor.commands.clearSearch();

        expect(findState(editor).searchTerm).toBe('');
        expect(findState(editor).results).toHaveLength(0);
    });

    it('matches text that spans a mark boundary within a paragraph', () => {
        // "alpha" is split across a bold run — the match must still be found,
        // since ProseMirror stores it as two adjacent text nodes.
        const editor = makeEditor('<p>al<strong>pha</strong> beta</p>');

        expect(search(editor, 'alpha')).toBe(1);
    });

    it('finds text inside a fenced code block', () => {
        // Code blocks are real ProseMirror text (unlike the NodeView-rendered
        // math/mermaid/pdf/map blocks, whose content is outside the text flow).
        const editor = makeEditor('<pre><code>const alpha = 1;</code></pre>');

        expect(search(editor, 'alpha')).toBe(1);
    });
});

describe('find & replace — match navigation', () => {
    it('goToNextResult advances through matches and wraps at the end', () => {
        const editor = makeEditor('<p>a a a</p>');
        expect(search(editor, 'a')).toBe(3);

        const seen: (number | null)[] = [findState(editor).currentIndex];
        for (let i = 0; i < 3; i++) {
            editor.commands.goToNextResult();
            seen.push(findState(editor).currentIndex);
        }

        // Four positions visited over three matches — the last one wrapped back
        // onto an index already seen.
        expect(seen).toHaveLength(4);
        expect(seen[3]).toBe(seen[0]);
        expect(new Set(seen).size).toBe(3);
    });

    it('goToPreviousResult walks backwards and wraps at the start', () => {
        const editor = makeEditor('<p>a a a</p>');
        search(editor, 'a');

        const first = findState(editor).currentIndex;
        editor.commands.goToPreviousResult();
        const back = findState(editor).currentIndex;

        expect(back).not.toBe(first);
        // Stepping forward again returns to where it started.
        editor.commands.goToNextResult();
        expect(findState(editor).currentIndex).toBe(first);
    });

    it('navigation on an empty result set is a no-op rather than a throw', () => {
        const editor = makeEditor('<p>alpha</p>');
        search(editor, 'nothing-here');

        expect(() => {
            editor.commands.goToNextResult();
            editor.commands.goToPreviousResult();
        }).not.toThrow();
        expect(findState(editor).currentIndex).toBeNull();
    });
});

describe('find & replace — search modifiers', () => {
    it('case sensitivity narrows the match count', () => {
        const editor = makeEditor('<p>Alpha alpha ALPHA</p>');

        expect(search(editor, 'alpha')).toBe(3);

        editor.commands.setCaseSensitive(true);
        expect(findState(editor).results).toHaveLength(1);

        editor.commands.setCaseSensitive(false);
        expect(findState(editor).results).toHaveLength(3);
    });

    it('whole-word matching excludes substrings inside longer words', () => {
        const editor = makeEditor('<p>cat catalog concat cat</p>');

        expect(search(editor, 'cat')).toBe(4);

        editor.commands.setWholeWord(true);
        expect(findState(editor).results).toHaveLength(2);
    });

    it('regex mode treats the term as a pattern', () => {
        const editor = makeEditor('<p>a1 b2 c3 dd</p>');

        editor.commands.setUseRegex(true);
        expect(search(editor, '[a-z][0-9]')).toBe(3);
    });

    it('an invalid regex yields no matches instead of throwing or blanking the doc', () => {
        const editor = makeEditor('<p>alpha beta</p>');
        editor.commands.setUseRegex(true);

        expect(() => editor.commands.setSearchTerm('([unclosed')).not.toThrow();
        expect(findState(editor).results).toHaveLength(0);
        // The document is untouched by a bad pattern.
        expect(editor.getText()).toBe('alpha beta');
    });
});

describe('find & replace — replacing', () => {
    it('replaceAll rewrites every match', () => {
        const editor = makeEditor('<p>alpha beta alpha</p><p>alpha</p>');
        editor.commands.setReplaceTerm('omega');
        search(editor, 'alpha');

        editor.commands.replaceAll();

        expect(editor.getText()).toContain('omega beta omega');
        expect(editor.getText()).not.toContain('alpha');
    });

    it('replace rewrites a single match and leaves the rest', () => {
        const editor = makeEditor('<p>alpha alpha alpha</p>');
        editor.commands.setReplaceTerm('omega');
        search(editor, 'alpha');

        editor.commands.replace();

        const text = editor.getText();
        expect(text.match(/omega/g)).toHaveLength(1);
        expect(text.match(/alpha/g)).toHaveLength(2);
    });

    it('replaceAll is a single transaction, so one undo restores the document', () => {
        // Matters for both the undo stack and the autosave path, which debounces
        // on transactions.
        const editor = makeEditor('<p>alpha alpha alpha</p>');
        const before = editor.getHTML();
        editor.commands.setReplaceTerm('omega');
        search(editor, 'alpha');

        editor.commands.replaceAll();
        expect(editor.getText()).not.toContain('alpha');

        editor.commands.undo();
        expect(editor.getHTML()).toBe(before);
    });

    it('replacing inside a bolded run keeps the bold mark on the replacement', () => {
        const editor = makeEditor('<p>plain <strong>alpha</strong> plain</p>');
        editor.commands.setReplaceTerm('omega');
        search(editor, 'alpha');

        editor.commands.replaceAll();

        const html = editor.getHTML();
        expect(html).toContain('<strong>omega</strong>');
        // The unmarked text either side is untouched.
        expect(editor.getText()).toBe('plain omega plain');
    });

    it('replacing one word leaves marks on neighbouring words intact', () => {
        const editor = makeEditor(
            '<p><strong>keep</strong> alpha <em>keep2</em></p>',
        );
        editor.commands.setReplaceTerm('omega');
        search(editor, 'alpha');

        editor.commands.replaceAll();

        const html = editor.getHTML();
        expect(html).toContain('<strong>keep</strong>');
        expect(html).toContain('<em>keep2</em>');
        expect(editor.getText()).toBe('keep omega keep2');
    });

    it('replacing inside a highlighted run keeps the highlight color', () => {
        const editor = makeEditor(
            '<p><mark data-color="#fff3b0">alpha</mark> beta</p>',
        );
        editor.commands.setReplaceTerm('omega');
        search(editor, 'alpha');

        editor.commands.replaceAll();

        const html = editor.getHTML();
        expect(html).toContain('omega');
        expect(html).toMatch(/<mark[^>]*>omega<\/mark>/);
    });
});

describe('find & replace — coexistence with comments', () => {
    it('search results are found inside a commented run', () => {
        const editor = makeEditor('<p>alpha beta</p>', [CommentExtension]);
        editor.commands.setTextSelection({ from: 1, to: 6 });
        editor.commands.setComment('c1');

        expect(search(editor, 'alpha')).toBe(1);
    });

    it('replaceAll elsewhere in the document leaves a comment mark anchored', () => {
        // Bulk replace rewrites spans in one transaction; a comment on untouched
        // text must survive it, or threads silently orphan.
        const editor = makeEditor('<p>commented text and alpha here</p>', [
            CommentExtension,
        ]);
        editor.commands.setTextSelection({ from: 1, to: 10 });
        editor.commands.setComment('c1');
        expect(editor.getHTML()).toContain('c1');

        editor.commands.setReplaceTerm('omega');
        search(editor, 'alpha');
        editor.commands.replaceAll();

        expect(editor.getText()).toContain('omega');
        // The comment mark is still on the document after the bulk rewrite.
        expect(editor.getHTML()).toContain('c1');
    });

    it('replacing inside a commented run keeps the comment mark on the new text', () => {
        // The orphaning case: the replaced span is *within* the commented range.
        // The mark must stretch over the replacement rather than being dropped.
        // (This covers the in-editor mark; re-anchoring a stored comment to its
        // quoted text on reload is commentAnchoring.ts's separate concern.)
        const editor = makeEditor('<p>alpha beta gamma</p>', [CommentExtension]);
        editor.commands.setTextSelection({ from: 1, to: 11 }); // "alpha beta"
        editor.commands.setComment('c1');

        editor.commands.setReplaceTerm('omega');
        search(editor, 'beta');
        editor.commands.replaceAll();

        expect(editor.getHTML()).toBe(
            '<p><span data-comment-id="c1">alpha omega</span> gamma</p>',
        );
    });

    it('registering both extensions leaves each one addressable', () => {
        const editor = makeEditor('<p>alpha</p>', [CommentExtension]);

        const names = editor.extensionManager.extensions.map((e) => e.name);
        expect(names).toContain('findAndReplace');
        expect(names).toContain('comment');
        // Find & replace is registered last so its decorations paint on top.
        expect(names.indexOf('findAndReplace')).toBeGreaterThan(names.indexOf('comment'));
    });
});
