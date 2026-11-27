import { describe, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import { StarterKit } from '@tiptap/starter-kit';
import { classifyPdfLink, findPaperLinkRuns, PaperLinkEmbedDecorationExtension } from '../src/paper/index.js';

describe('classifyPdfLink', () => {
    it('accepts .pdf URLs and rejects YouTube, maps and plain links', () => {
        expect(classifyPdfLink(' https://example.com/a.pdf?x=1 ')).toEqual({ kind: 'pdf', href: 'https://example.com/a.pdf?x=1' });
        expect(classifyPdfLink('https://youtu.be/dQw4w9WgXcQ')).toBeNull();
        expect(classifyPdfLink('https://www.google.com/maps/embed?pb=1')).toBeNull();
        expect(classifyPdfLink('https://example.com/page')).toBeNull();
        expect(classifyPdfLink(42)).toBeNull();
    });
});

describe('PaperLinkEmbedDecorationExtension host options', () => {
    const content = '<p><a href="https://example.com/a.pdf">a</a> <a href="https://papers.example/x">x</a></p>';

    it('uses the host classifier and desktop check', () => {
        const classifyLink = (href: string) => (href.includes('papers.example') ? { kind: 'custom', href } : null);
        const editor = new Editor({
            extensions: [StarterKit, PaperLinkEmbedDecorationExtension.configure({ classifyLink, isDesktopShell: () => true })],
            content,
        });
        expect(findPaperLinkRuns(editor.state.doc).map((r) => r.info.href)).toEqual(['https://example.com/a.pdf']);
        expect(findPaperLinkRuns(editor.state.doc, classifyLink).map((r) => r.info.kind)).toEqual(['custom']);
        const buttons = editor.view.dom.querySelectorAll('.paper-embed-buttons');
        expect([...buttons].map((b) => b.getAttribute('data-paper-href'))).toEqual(['https://papers.example/x']);
        expect(buttons[0].querySelector('.paper-embed-btn-newtab')?.textContent).toBe('Open in new window');
        editor.destroy();
    });

    it('decorates .pdf links with a New tab button by default', () => {
        const editor = new Editor({ extensions: [StarterKit, PaperLinkEmbedDecorationExtension], content });
        const buttons = editor.view.dom.querySelectorAll('.paper-embed-buttons');
        expect([...buttons].map((b) => b.getAttribute('data-paper-href'))).toEqual(['https://example.com/a.pdf']);
        expect(buttons[0].querySelector('.paper-embed-btn-newtab')?.textContent).toBe('New tab');
        editor.destroy();
    });
});
