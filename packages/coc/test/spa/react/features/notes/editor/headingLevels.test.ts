/**
 * headingLevels.test.ts — the rich editor schema must accept H1–H6.
 *
 * The toolbar's heading dropdown offers levels 1–6, so the StarterKit schema of
 * the editor shell (tiptap-react `createRichEditorExtensions`, which
 * RichEditorCore mounts) has to allow all six: with `levels: [1, 2, 3]` a
 * `#### four` heading is parsed as a paragraph and the `####` is lost on save.
 */

// @vitest-environment jsdom

import { describe, it, expect, afterEach } from 'vitest';
import { Editor } from '@tiptap/core';
import { createRichEditorExtensions } from '@plusplusoneplusplus/tiptap-react/editor';
import {
    htmlToMarkdown,
    markdownToHtml,
} from '../../../../../../src/server/spa/client/react/features/notes/editor/noteMarkdown';

let editor: Editor | null = null;

afterEach(() => {
    editor?.destroy();
    editor = null;
});

/** markdown → editor document → markdown, through the shell's real schema. */
function roundTripThroughEditor(md: string): string {
    editor = new Editor({
        extensions: createRichEditorExtensions(),
        content: markdownToHtml(md),
    });
    return htmlToMarkdown(editor.getHTML()).trim();
}

describe('heading levels 1–6', () => {
    it.each([
        ['# one', 'h1'],
        ['## two', 'h2'],
        ['### three', 'h3'],
        ['#### four', 'h4'],
        ['##### five', 'h5'],
        ['###### six', 'h6'],
    ])('%s survives a markdown → editor → markdown round trip', (md, tag) => {
        expect(roundTripThroughEditor(md)).toBe(md);
        expect(editor!.getHTML()).toContain(`<${tag}`);
    });
});
