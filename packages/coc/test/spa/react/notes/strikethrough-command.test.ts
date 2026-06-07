/**
 * Tests that the strikethrough (toggleStrike) command works correctly in a
 * real Tiptap editor instance — verifying the chain pattern used by the toolbar.
 */
import { describe, it, expect } from 'vitest';
import { Editor } from '@tiptap/core';
import { StarterKit } from '@tiptap/starter-kit';

describe('Strikethrough command (real editor)', () => {
    function createEditor(content = '<p>hello world</p>') {
        return new Editor({
            extensions: [
                StarterKit.configure({
                    heading: { levels: [1, 2, 3] },
                    link: false,
                }),
            ],
            content,
        });
    }

    it('toggleStrike exists on the editor chain', () => {
        const editor = createEditor();
        const chain = editor.chain();
        expect(typeof chain.focus).toBe('function');
        expect(typeof chain.toggleStrike).toBe('function');
        editor.destroy();
    });

    it('toggleStrike applies strike mark to selected text', () => {
        const editor = createEditor('<p>hello world</p>');
        editor.commands.setTextSelection({ from: 1, to: 6 });
        editor.chain().focus().toggleStrike().run();
        const html = editor.getHTML();
        expect(html).toContain('<s>hello</s>');
        editor.destroy();
    });

    it('fixed toolbar pattern (c = () => chain().focus()) works for toggleStrike', () => {
        const editor = createEditor('<p>hello world</p>');
        editor.commands.setTextSelection({ from: 1, to: 6 });

        // The FIXED pattern: creates a fresh chain per invocation
        const c = () => editor.chain().focus();
        c().toggleStrike().run();

        const html = editor.getHTML();
        expect(html).toContain('<s>hello</s>');
        editor.destroy();
    });

    it('fixed pattern: c().toggleBold().run() works', () => {
        const editor = createEditor('<p>hello world</p>');
        editor.commands.setTextSelection({ from: 1, to: 6 });
        const c = () => editor.chain().focus();
        c().toggleBold().run();
        const html = editor.getHTML();
        expect(html).toContain('<strong>hello</strong>');
        editor.destroy();
    });

    it('fixed pattern survives multiple sequential invocations', () => {
        const editor = createEditor('<p>hello world</p>');
        editor.commands.setTextSelection({ from: 1, to: 6 });

        // The FIXED pattern: each c() creates a fresh chain with a fresh transaction
        const c = () => editor.chain().focus();

        // First click: toggleBold
        c().toggleBold().run();

        // Re-select (simulate the user's selection persisting after mark toggle)
        editor.commands.setTextSelection({ from: 1, to: 6 });

        // Second click: toggleStrike — must NOT throw "Applying a mismatched transaction"
        c().toggleStrike().run();

        const html = editor.getHTML();
        expect(html).toContain('<s>');
        expect(html).toContain('<strong>');
        editor.destroy();
    });

    it('old broken pattern throws on second invocation (regression guard)', () => {
        const editor = createEditor('<p>hello world</p>');
        editor.commands.setTextSelection({ from: 1, to: 6 });

        // The OLD broken pattern: chain captured at "render time"
        const brokenC = editor.chain().focus.bind(editor.chain());

        // First call works
        brokenC().toggleBold().run();

        // Second call throws because the chain's transaction is stale
        expect(() => brokenC().toggleStrike().run()).toThrow('mismatched transaction');

        editor.destroy();
    });
});
