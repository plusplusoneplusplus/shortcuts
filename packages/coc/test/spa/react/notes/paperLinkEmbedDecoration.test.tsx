/**
 * paperLinkEmbedDecoration.test.tsx — AC-02 (paper link affordances).
 *
 * Two layers:
 *  1. Pure DOM-builder units (buildPaperLinkButtons) — no editor.
 *  2. Real-Tiptap integration: a note with a paper/PDF link renders three
 *     view-only action buttons; a plain link renders none; a link inside a
 *     pdfBlock is NOT double-decorated; New tab opens the original href; and
 *     serializing back to markdown is unchanged (decorations never persist).
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { Editor } from '@tiptap/core';
import { StarterKit } from '@tiptap/starter-kit';
import { Link } from '@tiptap/extension-link';
import { Table } from '@tiptap/extension-table';
import { TableRow } from '@tiptap/extension-table-row';
import { TableCell } from '@tiptap/extension-table-cell';
import { TableHeader } from '@tiptap/extension-table-header';

import {
    PaperLinkEmbedDecorationExtension,
    buildPaperLinkButtons,
    findPaperLinkRuns,
    type PaperLinkEmbedOptions,
} from '../../../../src/server/spa/client/react/features/notes/editor/extensions/PaperLinkEmbedDecorationExtension';
import { PdfBlock } from '../../../../src/server/spa/client/react/features/notes/editor/extensions/pdfBlock';
import { classifyPaperLink } from '../../../../src/server/spa/client/react/features/notes/editor/extensions/paperLink';
import {
    markdownToHtml,
    htmlToMarkdown,
} from '../../../../src/server/spa/client/react/features/notes/editor/noteMarkdown';

const ARXIV_URL = 'https://arxiv.org/pdf/2104.04473';
const PDF_URL = 'https://example.com/papers/integration.pdf';
const PLAIN_URL = 'https://example.com/article';

const editors: Editor[] = [];

function makeEditor(content: string, options?: PaperLinkEmbedOptions): Editor {
    const ext = options
        ? PaperLinkEmbedDecorationExtension.configure(options)
        : PaperLinkEmbedDecorationExtension;
    const editor = new Editor({
        extensions: [
            PdfBlock,
            StarterKit.configure({ heading: { levels: [1, 2, 3] }, link: false }),
            Link.configure({
                openOnClick: false,
                HTMLAttributes: { rel: 'noopener noreferrer', target: '_blank' },
            }),
            Table.configure({ resizable: false }),
            TableRow,
            TableCell,
            TableHeader,
            ext,
        ],
        content,
    });
    editors.push(editor);
    return editor;
}

afterEach(() => {
    while (editors.length) editors.pop()!.destroy();
    vi.restoreAllMocks();
});

// ── Pure builder units ────────────────────────────────────────────────────────

describe('buildPaperLinkButtons', () => {
    const info = classifyPaperLink(ARXIV_URL)!;

    it('renders Open inline / Popout / New tab outside a table', () => {
        const el = buildPaperLinkButtons({
            info,
            insideTable: false,
            onInline: vi.fn(),
            onPopout: vi.fn(),
            onNewTab: vi.fn(),
        });

        expect(el.getAttribute('contenteditable')).toBe('false');
        expect(el.querySelectorAll('button').length).toBe(3);
        expect(el.querySelector('.paper-embed-btn-inline')?.textContent).toContain('Open inline');
        expect(el.querySelector('.paper-embed-btn-popout')?.textContent).toContain('Popout');
        expect(el.querySelector('.paper-embed-btn-newtab')?.textContent).toContain('New tab');
    });

    it('omits the inline button inside a table cell (Popout + New tab only)', () => {
        const el = buildPaperLinkButtons({
            info,
            insideTable: true,
            onInline: vi.fn(),
            onPopout: vi.fn(),
            onNewTab: vi.fn(),
        });

        expect(el.querySelectorAll('button').length).toBe(2);
        expect(el.querySelector('.paper-embed-btn-inline')).toBeNull();
        expect(el.querySelector('.paper-embed-btn-popout')).toBeTruthy();
        expect(el.querySelector('.paper-embed-btn-newtab')).toBeTruthy();
    });

    it('fires onInline / onPopout / onNewTab on click', () => {
        const onInline = vi.fn();
        const onPopout = vi.fn();
        const onNewTab = vi.fn();
        const el = buildPaperLinkButtons({ info, insideTable: false, onInline, onPopout, onNewTab });

        (el.querySelector('.paper-embed-btn-inline') as HTMLButtonElement).click();
        (el.querySelector('.paper-embed-btn-popout') as HTMLButtonElement).click();
        (el.querySelector('.paper-embed-btn-newtab') as HTMLButtonElement).click();

        expect(onInline).toHaveBeenCalledTimes(1);
        expect(onPopout).toHaveBeenCalledTimes(1);
        expect(onNewTab).toHaveBeenCalledTimes(1);
    });

    it('flips the inline label when expanded', () => {
        const el = buildPaperLinkButtons({
            info,
            insideTable: false,
            expanded: true,
            onInline: vi.fn(),
            onPopout: vi.fn(),
            onNewTab: vi.fn(),
        });
        const inline = el.querySelector('.paper-embed-btn-inline')!;
        expect(inline.textContent).toContain('Hide inline');
        expect(inline.getAttribute('aria-pressed')).toBe('true');
    });

    it('flips the New tab label to "Open in new window" in the desktop shell (AC-05)', () => {
        const el = buildPaperLinkButtons({
            info,
            insideTable: false,
            desktopShell: true,
            onInline: vi.fn(),
            onPopout: vi.fn(),
            onNewTab: vi.fn(),
        });
        expect(el.querySelector('.paper-embed-btn-newtab')?.textContent).toBe('Open in new window');
    });
});

// ── findPaperLinkRuns over a real doc ──────────────────────────────────────────

describe('findPaperLinkRuns', () => {
    it('detects arXiv + .pdf links and ignores a plain link', () => {
        const editor = makeEditor(
            markdownToHtml(
                `[paper](${ARXIV_URL}) and [pdf](${PDF_URL}) and [docs](${PLAIN_URL})`,
            ),
        );
        const runs = findPaperLinkRuns(editor.state.doc);
        expect(runs.length).toBe(2);
        expect(runs.map((r) => r.info.kind).sort()).toEqual(['arxiv', 'pdf']);
        expect(runs.every((r) => !r.insideTable)).toBe(true);
    });

    it('flags a paper link inside a table cell', () => {
        const editor = makeEditor(
            `<table><tbody><tr><td><a href="${ARXIV_URL}">paper</a></td></tr></tbody></table>`,
        );
        const runs = findPaperLinkRuns(editor.state.doc);
        expect(runs.length).toBe(1);
        expect(runs[0].insideTable).toBe(true);
    });
});

// ── Integration: decorations in the editor DOM ─────────────────────────────────

describe('PaperLinkEmbedDecorationExtension (integration)', () => {
    it('renders three action buttons after a paper link', () => {
        const editor = makeEditor(markdownToHtml(`[paper](${ARXIV_URL})`));
        const dom = editor.view.dom as HTMLElement;
        expect(dom.querySelectorAll('.paper-embed-btn').length).toBe(3);
        expect(dom.querySelector('.paper-embed-btn-inline')).toBeTruthy();
        expect(dom.querySelector('.paper-embed-btn-popout')).toBeTruthy();
        expect(dom.querySelector('.paper-embed-btn-newtab')).toBeTruthy();
    });

    it('renders buttons for a bare .pdf link', () => {
        const editor = makeEditor(markdownToHtml(`[pdf](${PDF_URL})`));
        const dom = editor.view.dom as HTMLElement;
        expect(dom.querySelectorAll('.paper-embed-btn').length).toBe(3);
    });

    it('renders no buttons for a non-paper link', () => {
        const editor = makeEditor(markdownToHtml(`[docs](${PLAIN_URL})`));
        const dom = editor.view.dom as HTMLElement;
        expect(dom.querySelectorAll('.paper-embed-btn').length).toBe(0);
    });

    it('shows Popout + New tab (no inline button) inside a table cell', () => {
        const editor = makeEditor(
            `<table><tbody><tr><td><a href="${ARXIV_URL}">paper</a></td></tr></tbody></table>`,
        );
        const dom = editor.view.dom as HTMLElement;
        expect(dom.querySelectorAll('.paper-embed-btn-popout').length).toBe(1);
        expect(dom.querySelectorAll('.paper-embed-btn-newtab').length).toBe(1);
        expect(dom.querySelector('.paper-embed-btn-inline')).toBeNull();
    });

    it('does NOT double-decorate a link that lives inside a pdfBlock embed', () => {
        // A pdfBlock is an atom node — a paper link cannot live in its content —
        // so a pdfBlock next to a paper link must decorate only the real link.
        const editor = makeEditor(
            `<div class="md-pdf-embed" data-pdf-url="${ARXIV_URL}" data-pdf-label="paper"></div>` +
                markdownToHtml(`[paper](${ARXIV_URL})`),
        );

        // Sanity: the pdfBlock actually parsed (else this test proves nothing).
        let pdfBlocks = 0;
        editor.state.doc.descendants((node) => {
            if (node.type.name === 'pdfBlock') pdfBlocks += 1;
            return true;
        });
        expect(pdfBlocks).toBe(1);

        const dom = editor.view.dom as HTMLElement;
        // Exactly one button group (the standalone link), not one for the pdfBlock too.
        expect(dom.querySelectorAll('.paper-embed-buttons').length).toBe(1);
    });

    it('invokes onRequestPopout with the paper info when ⛶ Popout is clicked (AC-04 seam)', () => {
        const onRequestPopout = vi.fn();
        const editor = makeEditor(markdownToHtml(`[paper](${ARXIV_URL})`), { onRequestPopout });
        const dom = editor.view.dom as HTMLElement;

        (dom.querySelector('.paper-embed-btn-popout') as HTMLButtonElement).click();
        expect(onRequestPopout).toHaveBeenCalledTimes(1);
        expect(onRequestPopout.mock.calls[0][0]).toMatchObject({ kind: 'arxiv', href: ARXIV_URL });
    });

    it('opens the original href in a new tab when New tab is clicked (AC-05)', () => {
        const openSpy = vi.spyOn(window, 'open').mockReturnValue(null);
        const editor = makeEditor(markdownToHtml(`[paper](${ARXIV_URL})`));
        const dom = editor.view.dom as HTMLElement;

        (dom.querySelector('.paper-embed-btn-newtab') as HTMLButtonElement).click();
        expect(openSpy).toHaveBeenCalledWith(ARXIV_URL, '_blank', 'noopener,noreferrer');
    });

    it('keeps exactly one button group when typing after the link', () => {
        const editor = makeEditor(markdownToHtml(`[paper](${ARXIV_URL})`));
        const dom = editor.view.dom as HTMLElement;
        expect(dom.querySelectorAll('.paper-embed-buttons').length).toBe(1);

        expect(() => {
            editor.chain().focus('end').insertContent(' more text').run();
        }).not.toThrow();

        expect(dom.querySelectorAll('.paper-embed-buttons').length).toBe(1);
    });
});

// ── Round-trip: the saved markdown is unchanged by the decorations ─────────────

describe('paper decoration round-trip (view-only, no persistence)', () => {
    it('serializes back to the original markdown link with no embed markup', () => {
        const original = `[integration paper](${ARXIV_URL})`;
        const editor = makeEditor(markdownToHtml(original));

        const out = htmlToMarkdown(editor.getHTML());
        expect(out.trim()).toBe(original);
        expect(out).not.toContain('paper-embed');
        expect(out).not.toContain('New tab');
    });
});
