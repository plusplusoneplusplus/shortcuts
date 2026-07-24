/**
 * youtubeEmbedDecoration.test.tsx — AC-02 (buttons) + AC-04 inline mechanics.
 *
 * Two layers:
 *  1. Pure DOM-builder units (buildYouTubeButtons / buildInlinePlayer) — no editor.
 *  2. Real-Tiptap integration: a note with a YouTube link renders the buttons as
 *     view-only decorations, the inline button toggles a nocookie player, a link
 *     in a table cell shows popup-only, and serializing the doc back to markdown
 *     is unchanged (decorations never persist).
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
    YouTubeEmbedDecorationExtension,
    buildYouTubeButtons,
    buildInlinePlayer,
    findYouTubeLinkRuns,
} from '../../../../src/server/spa/client/react/features/notes/editor/extensions/YouTubeEmbedDecorationExtension';
import {
    markdownToHtml,
    htmlToMarkdown,
} from '../../../../src/server/spa/client/react/features/notes/editor/noteMarkdown';

const VIDEO_ID = 'dQw4w9WgXcQ';
const WATCH_URL = `https://www.youtube.com/watch?v=${VIDEO_ID}`;
const SHORT_URL = `https://youtu.be/${VIDEO_ID}`;

const editors: Editor[] = [];

function makeEditor(content: string, onRequestPopup?: (videoId: string) => void): Editor {
    const ext = onRequestPopup
        ? YouTubeEmbedDecorationExtension.configure({ onRequestPopup })
        : YouTubeEmbedDecorationExtension;
    const editor = new Editor({
        extensions: [
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

describe('buildYouTubeButtons', () => {
    it('renders both ▶ inline and ⛶ popup buttons outside a table', () => {
        const el = buildYouTubeButtons({
            videoId: VIDEO_ID,
            insideTable: false,
            onInline: vi.fn(),
            onPopup: vi.fn(),
        });

        expect(el.getAttribute('contenteditable')).toBe('false');
        const buttons = el.querySelectorAll('button');
        expect(buttons.length).toBe(2);
        expect(el.querySelector('.yt-embed-btn-inline')?.textContent).toContain('Play inline');
        expect(el.querySelector('.yt-embed-btn-popup')?.textContent).toContain('Popup');
    });

    it('renders only the ⛶ popup button inside a table cell', () => {
        const el = buildYouTubeButtons({
            videoId: VIDEO_ID,
            insideTable: true,
            onInline: vi.fn(),
            onPopup: vi.fn(),
        });

        expect(el.querySelectorAll('button').length).toBe(1);
        expect(el.querySelector('.yt-embed-btn-inline')).toBeNull();
        expect(el.querySelector('.yt-embed-btn-popup')).toBeTruthy();
    });

    it('fires onInline / onPopup on click', () => {
        const onInline = vi.fn();
        const onPopup = vi.fn();
        const el = buildYouTubeButtons({ videoId: VIDEO_ID, insideTable: false, onInline, onPopup });

        (el.querySelector('.yt-embed-btn-inline') as HTMLButtonElement).click();
        (el.querySelector('.yt-embed-btn-popup') as HTMLButtonElement).click();

        expect(onInline).toHaveBeenCalledTimes(1);
        expect(onPopup).toHaveBeenCalledTimes(1);
    });

    it('flips the inline label when expanded', () => {
        const el = buildYouTubeButtons({
            videoId: VIDEO_ID,
            insideTable: false,
            expanded: true,
            onInline: vi.fn(),
            onPopup: vi.fn(),
        });
        const inline = el.querySelector('.yt-embed-btn-inline')!;
        expect(inline.textContent).toContain('Hide inline');
        expect(inline.getAttribute('aria-pressed')).toBe('true');
    });
});

describe('buildInlinePlayer', () => {
    it('builds a sandboxed 16:9 nocookie iframe with NO autoplay', () => {
        const el = buildInlinePlayer(VIDEO_ID);
        expect(el.getAttribute('contenteditable')).toBe('false');

        const iframe = el.querySelector('iframe')!;
        expect(iframe.getAttribute('src')).toBe(`https://www.youtube-nocookie.com/embed/${VIDEO_ID}`);
        expect(iframe.getAttribute('src')).not.toContain('autoplay');
        expect(iframe.getAttribute('src')).not.toContain('youtube.com/embed');
        expect(iframe.getAttribute('sandbox')).toContain('allow-scripts');
        expect(el.querySelector('.yt-embed-inline-frame-wrap')).toBeTruthy();
    });
});

// ── findYouTubeLinkRuns over a real doc ────────────────────────────────────────

describe('findYouTubeLinkRuns', () => {
    it('detects a YouTube link and ignores a plain link', () => {
        const editor = makeEditor(
            markdownToHtml(`[watch](${WATCH_URL}) and [docs](https://example.com/page)`),
        );
        const runs = findYouTubeLinkRuns(editor.state.doc);
        expect(runs.length).toBe(1);
        expect(runs[0].videoId).toBe(VIDEO_ID);
        expect(runs[0].insideTable).toBe(false);
    });

    it('flags a YouTube link inside a table cell', () => {
        const editor = makeEditor(
            `<table><tbody><tr><td><a href="${SHORT_URL}">clip</a></td></tr></tbody></table>`,
        );
        const runs = findYouTubeLinkRuns(editor.state.doc);
        expect(runs.length).toBe(1);
        expect(runs[0].insideTable).toBe(true);
    });
});

// ── Integration: decorations in the editor DOM ─────────────────────────────────

describe('YouTubeEmbedDecorationExtension (integration)', () => {
    it('renders both buttons after a YouTube link', () => {
        const editor = makeEditor(markdownToHtml(`[rick](${WATCH_URL})`));
        const dom = editor.view.dom as HTMLElement;
        expect(dom.querySelectorAll('.yt-embed-btn').length).toBe(2);
        expect(dom.querySelector('.yt-embed-btn-inline')).toBeTruthy();
        expect(dom.querySelector('.yt-embed-btn-popup')).toBeTruthy();
    });

    it('renders no buttons for a non-YouTube link', () => {
        const editor = makeEditor(markdownToHtml('[docs](https://example.com/page)'));
        const dom = editor.view.dom as HTMLElement;
        expect(dom.querySelectorAll('.yt-embed-btn').length).toBe(0);
    });

    it('shows popup-only (no inline button) for a link inside a table cell', () => {
        const editor = makeEditor(
            `<table><tbody><tr><td><a href="${SHORT_URL}">clip</a></td></tr></tbody></table>`,
        );
        const dom = editor.view.dom as HTMLElement;
        expect(dom.querySelectorAll('.yt-embed-btn-popup').length).toBe(1);
        expect(dom.querySelector('.yt-embed-btn-inline')).toBeNull();
    });

    it('toggles the inline nocookie player on/off via the ▶ button', () => {
        const editor = makeEditor(markdownToHtml(`[rick](${WATCH_URL})`));
        const dom = editor.view.dom as HTMLElement;

        expect(dom.querySelector('.yt-embed-inline-frame')).toBeNull();

        (dom.querySelector('.yt-embed-btn-inline') as HTMLButtonElement).click();
        const iframe = dom.querySelector('.yt-embed-inline-frame') as HTMLIFrameElement;
        expect(iframe).toBeTruthy();
        expect(iframe.getAttribute('src')).toBe(`https://www.youtube-nocookie.com/embed/${VIDEO_ID}`);
        expect(iframe.getAttribute('src')).not.toContain('autoplay');

        // Toggle again → player unmounts (playback stops).
        (dom.querySelector('.yt-embed-btn-inline') as HTMLButtonElement).click();
        expect(dom.querySelector('.yt-embed-inline-frame')).toBeNull();
    });

    it('invokes onRequestPopup with the video id when ⛶ is clicked', () => {
        const onRequestPopup = vi.fn();
        const editor = makeEditor(markdownToHtml(`[rick](${WATCH_URL})`), onRequestPopup);
        const dom = editor.view.dom as HTMLElement;

        (dom.querySelector('.yt-embed-btn-popup') as HTMLButtonElement).click();
        expect(onRequestPopup).toHaveBeenCalledWith(VIDEO_ID);
    });

    it('does not throw and keeps exactly one button group when typing after the link', () => {
        const editor = makeEditor(markdownToHtml(`[rick](${WATCH_URL})`));
        const dom = editor.view.dom as HTMLElement;
        expect(dom.querySelectorAll('.yt-embed-btn-inline').length).toBe(1);

        expect(() => {
            editor.chain().focus('end').insertContent(' more text').run();
        }).not.toThrow();

        expect(dom.querySelectorAll('.yt-embed-btn-inline').length).toBe(1);
        expect(dom.querySelectorAll('.yt-embed-btn-popup').length).toBe(1);
    });
});

// ── Round-trip: the saved markdown is unchanged by the decorations ─────────────

describe('YouTube decoration round-trip (view-only, no persistence)', () => {
    it('serializes back to the original markdown link with no embed markup', () => {
        const original = `[Rick Astley](${WATCH_URL})`;
        const editor = makeEditor(markdownToHtml(original));

        // Expand the inline player so a decoration is live in the DOM…
        (editor.view.dom.querySelector('.yt-embed-btn-inline') as HTMLButtonElement).click();
        expect(editor.view.dom.querySelector('.yt-embed-inline-frame')).toBeTruthy();

        // …yet the serialized document is the plain link, byte-for-byte.
        const out = htmlToMarkdown(editor.getHTML());
        expect(out.trim()).toBe(original);
        expect(out).not.toContain('iframe');
        expect(out).not.toContain('yt-embed');
        expect(out).not.toContain('nocookie');
    });
});
