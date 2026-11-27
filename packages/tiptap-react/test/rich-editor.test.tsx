import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/react';
import { Extension, Node, type Editor } from '@tiptap/core';
import { RichEditor, createRichEditorExtensions, getLinkHoverTitle } from '../src/editor/index.js';

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

const names = (exts: ReturnType<typeof createRichEditorExtensions>) => exts.map((e) => e.name);

async function mount(props: Partial<React.ComponentProps<typeof RichEditor>> = {}) {
    let editor: Editor | null = null;
    const utils = render(<RichEditor {...props} onEditorReady={(ed) => { editor = ed; props.onEditorReady?.(ed); }} />);
    await waitFor(() => expect(editor).not.toBeNull());
    return { ...utils, editor: editor! };
}

function ctrlClick(editor: Editor, href: string) {
    editor.commands.setContent(`<p><a href="${href}">link</a></p>`);
    const event = new MouseEvent('click', { ctrlKey: true });
    // Position 2 sits inside the link text.
    return editor.view.someProp('handleClick', (f) => f(editor.view, 2, event));
}

describe('createRichEditorExtensions', () => {
    it('orders leading nodes first, the code block after StarterKit, host extensions before find/replace', () => {
        const Leading = Node.create({ name: 'leadingBlock', group: 'block', content: 'text*' });
        const Host = Extension.create({ name: 'hostExtension' });
        const list = names(createRichEditorExtensions({
            leadingExtensions: [Leading],
            codeBlock: Node.create({ name: 'codeBlock', group: 'block', content: 'text*', code: true }),
            extensions: [Host],
        }));
        expect(list[0]).toBe('leadingBlock');
        expect(list[1]).toBe('starterKit');
        expect(list[2]).toBe('codeBlock');
        expect(list.indexOf('indent')).toBeLessThan(list.indexOf('hostExtension'));
        expect(list.at(-2)).toBe('hostExtension');
        expect(list.at(-1)).toBe('findAndReplace');
    });

    it('keeps StarterKit code block when the host supplies none', () => {
        const list = names(createRichEditorExtensions());
        expect(list).not.toContain('codeBlock');
        expect(list[0]).toBe('starterKit');
    });
});

describe('RichEditor', () => {
    it('renders the editor root with the given class and children', async () => {
        const { container, editor } = await mount({ className: 'my-editor', children: <div data-testid="overlay" /> });
        expect(container.querySelector('.my-editor .ProseMirror')).not.toBeNull();
        expect(container.querySelector('[data-testid="overlay"]')).not.toBeNull();
        expect(editor.extensionManager.extensions.map((e) => e.name)).toContain('tableCell');
    });

    it('hands a Ctrl+clicked link to onOpenLink and skips window.open when handled', async () => {
        const onOpenLink = vi.fn(() => true);
        const open = vi.spyOn(window, 'open').mockReturnValue(null);
        const { editor } = await mount({ onOpenLink });
        expect(ctrlClick(editor, 'https://example.com/a')).toBe(true);
        expect(onOpenLink).toHaveBeenCalledWith('https://example.com/a');
        expect(open).not.toHaveBeenCalled();
    });

    it('opens a new window when the host leaves the link unhandled', async () => {
        const open = vi.spyOn(window, 'open').mockReturnValue(null);
        const { editor } = await mount({ onOpenLink: () => false });
        ctrlClick(editor, 'https://example.com/b');
        expect(open).toHaveBeenCalledWith('https://example.com/b', '_blank', 'noopener,noreferrer');
    });

    it('keeps #anchor links inside the document', async () => {
        const onOpenLink = vi.fn();
        const open = vi.spyOn(window, 'open').mockReturnValue(null);
        const { editor } = await mount({ onOpenLink });
        expect(ctrlClick(editor, '#missing-heading')).toBe(true);
        expect(onOpenLink).not.toHaveBeenCalled();
        expect(open).not.toHaveBeenCalled();
    });

    it('keeps extra link protocols through a round trip', async () => {
        const { editor } = await mount({ linkProtocols: ['canvas'] });
        editor.commands.setContent('<p><a href="canvas://abc">c</a></p>');
        expect(editor.getHTML()).toContain('href="canvas://abc"');
    });

    it('swallows paste while read-only and forwards it otherwise', async () => {
        const handlePaste = vi.fn(() => true);
        const { editor, rerender } = await mount({ readOnly: true, handlePaste });
        const paste = () => editor.view.someProp('handlePaste', (f) => f(editor.view, new Event('paste') as ClipboardEvent, editor.state.doc.slice(0)));
        expect(paste()).toBe(true);
        expect(handlePaste).not.toHaveBeenCalled();

        rerender(<RichEditor handlePaste={handlePaste} />);
        expect(paste()).toBe(true);
        expect(handlePaste).toHaveBeenCalledTimes(1);
    });

    it('reports changes only while editable', async () => {
        const onChange = vi.fn();
        const { editor } = await mount({ onChange });
        editor.commands.insertContent('hi');
        expect(onChange).toHaveBeenCalled();
    });

    it('builds a hover title naming the platform modifier', () => {
        expect(getLinkHoverTitle('https://x', 'MacIntel')).toBe('https://x\n⌘+Click to open link');
        expect(getLinkHoverTitle('https://x', 'Win32')).toBe('https://x\nCtrl+Click to open link');
    });
});
