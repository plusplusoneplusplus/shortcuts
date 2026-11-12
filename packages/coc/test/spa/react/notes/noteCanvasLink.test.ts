/**
 * A `canvas://<id>` link in a note must survive the full save/reload cycle —
 * Markdown → editor HTML → Markdown — as the same link. tiptap's Link drops
 * hrefs with unknown schemes unless the scheme is allowed, which is what
 * RichEditorCore's `protocols: ['canvas']` does.
 */
import { describe, it, expect } from 'vitest';
import { Editor } from '@tiptap/core';
import { StarterKit } from '@tiptap/starter-kit';
import { Link } from '@tiptap/extension-link';
import {
    markdownToHtml,
    htmlToMarkdown,
} from '../../../../src/server/spa/client/react/features/notes/editor/noteMarkdown';

function createEditor(protocols: string[]) {
    return new Editor({
        extensions: [
            StarterKit.configure({ link: false }),
            Link.configure({ openOnClick: false, protocols }),
        ],
        content: markdownToHtml('See [the plan](canvas://abc-1) and [docs](https://example.com).'),
    });
}

describe('canvas:// links in notes', () => {
    it('keeps the canvas href through markdown → editor → markdown', () => {
        const editor = createEditor(['canvas']);
        expect(editor.getHTML()).toContain('href="canvas://abc-1"');
        const markdown = htmlToMarkdown(editor.getHTML());
        expect(markdown).toContain('[the plan](canvas://abc-1)');
        expect(markdown).toContain('[docs](https://example.com)');
        editor.destroy();
    });

    it('drops the href without the canvas protocol (regression guard)', () => {
        const editor = createEditor([]);
        expect(editor.getHTML()).not.toContain('canvas://abc-1');
        editor.destroy();
    });
});
