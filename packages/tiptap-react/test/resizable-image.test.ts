import { afterEach, describe, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import { StarterKit } from '@tiptap/starter-kit';
import { ResizableImage } from '../src/image/index.js';

let editor: Editor | null = null;

function makeEditor(content: string): Editor {
    editor = new Editor({ extensions: [StarterKit, ResizableImage], content });
    return editor;
}

afterEach(() => {
    editor?.destroy();
    editor = null;
});

describe('ResizableImage', () => {
    it('replaces the stock image node under the same name', () => {
        expect(ResizableImage.name).toBe('image');
    });

    it('parses and serializes a persisted width', () => {
        const ed = makeEditor('<img src="a.png" alt="A" width="240">');
        const image = ed.getJSON().content?.[0];
        expect(image?.type).toBe('image');
        expect(image?.attrs).toMatchObject({ src: 'a.png', alt: 'A', width: 240 });
        expect(ed.getHTML()).toContain('width="240"');
    });

    it('omits the width attribute when the image has its natural size', () => {
        const ed = makeEditor('<img src="a.png">');
        expect(ed.getJSON().content?.[0]?.attrs?.width).toBeNull();
        expect(ed.getHTML()).not.toContain('width=');
    });
});
