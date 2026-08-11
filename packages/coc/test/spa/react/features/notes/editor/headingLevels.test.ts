/**
 * headingLevels.test.ts — the rich editor schema must accept H1–H6.
 *
 * The toolbar's heading dropdown offers levels 1–6, so the StarterKit schema in
 * RichEditorCore has to allow all six: with the old `levels: [1, 2, 3]` a
 * `#### four` heading is parsed as a paragraph and the `####` is lost on save.
 */

// @vitest-environment jsdom

import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Editor } from '@tiptap/core';
import { StarterKit } from '@tiptap/starter-kit';
import {
    htmlToMarkdown,
    markdownToHtml,
} from '../../../../../../src/server/spa/client/react/features/notes/editor/noteMarkdown';

const EDITOR_DIR = join(
    __dirname,
    '../../../../../../src/server/spa/client/react/features/notes/editor',
);

let editor: Editor | null = null;

afterEach(() => {
    editor?.destroy();
    editor = null;
});

/** markdown → editor document → markdown, through the configured schema. */
function roundTripThroughEditor(md: string): string {
    editor = new Editor({
        extensions: [StarterKit.configure({ heading: { levels: [1, 2, 3, 4, 5, 6] }, link: false })],
        content: markdownToHtml(md),
    });
    return htmlToMarkdown(editor.getHTML()).trim();
}

describe('heading levels 1–6', () => {
    it('RichEditorCore configures StarterKit with all six levels', () => {
        const src = readFileSync(join(EDITOR_DIR, 'RichEditorCore.tsx'), 'utf8');
        expect(src).toContain('heading: { levels: [1, 2, 3, 4, 5, 6] }');
    });

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
