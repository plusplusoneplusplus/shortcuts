/**
 * AC-06 guard — floating dialog fallback preserved; read-only code path unchanged.
 *
 * The editable-note-canvas feature only diverts the *in-chat markdown* branch to
 * the docked canvas. Every other surface keeps the floating `MarkdownReviewDialog`,
 * and code references keep the read-only syntax-highlighted source viewer. The
 * spec explicitly notes the read-only `MarkdownCanvasView` "may be cleaned up in a
 * later pass" — this static guard fails loudly if a future change silently removes
 * any of the fallback artifacts, so the divert can never become a one-way door.
 *
 * Behavioural routing (flag on/off × markdown/code × chat/non-chat) is exercised in
 * FilePathPreview.test.ts. This file is purely structural — it reads source and
 * asserts the fallback wiring still exists.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const REACT_ROOT = join(__dirname, '../../../src/server/spa/client/react');

function read(relativePath: string): string {
    return readFileSync(join(REACT_ROOT, relativePath), 'utf-8');
}

// ---------------------------------------------------------------------------
// 1. The floating MarkdownReviewDialog component still exists and is mounted.
// ---------------------------------------------------------------------------
describe('AC-06 — floating MarkdownReviewDialog preserved', () => {
    const dialog = read('processes/MarkdownReviewDialog.tsx');
    const app = read('App.tsx');

    it('MarkdownReviewDialog component is still exported', () => {
        expect(dialog).toContain('export function MarkdownReviewDialog');
    });

    it('App.tsx still imports and renders <MarkdownReviewDialog />', () => {
        expect(app).toContain("import { MarkdownReviewDialog } from './processes/MarkdownReviewDialog'");
        expect(app).toContain('<MarkdownReviewDialog');
    });
});

// ---------------------------------------------------------------------------
// 2. The coc-open-markdown-review event channel is still wired end-to-end.
// ---------------------------------------------------------------------------
describe('AC-06 — coc-open-markdown-review event channel intact', () => {
    const preview = read('shared/file-path/file-path-preview.ts');
    const app = read('App.tsx');

    it('file-path-preview still dispatches coc-open-markdown-review (the fallback)', () => {
        expect(preview).toContain("new CustomEvent('coc-open-markdown-review'");
    });

    it('App.tsx still registers a coc-open-markdown-review listener', () => {
        expect(app).toContain("window.addEventListener('coc-open-markdown-review'");
        expect(app).toContain("window.removeEventListener('coc-open-markdown-review'");
    });
});

// ---------------------------------------------------------------------------
// 3. The floating dialog is the UNCONDITIONAL fallback in openFileReference:
//    the canvas branches are gated by SHOW_SOURCE_CANVAS_FOR_CHAT_LINKS, and
//    control falls through to dispatchOpenMarkdownReview when none match.
// ---------------------------------------------------------------------------
describe('AC-06 — floating dialog is the fallback after the flag-gated canvas branches', () => {
    const preview = read('shared/file-path/file-path-preview.ts');

    it('the only gate is SHOW_SOURCE_CANVAS_FOR_CHAT_LINKS (no new flag added)', () => {
        expect(preview).toContain('if (SHOW_SOURCE_CANVAS_FOR_CHAT_LINKS)');
    });

    it('openFileReference falls through to dispatchOpenMarkdownReview', () => {
        const fn = preview.slice(
            preview.indexOf('function openFileReference('),
            preview.indexOf('function openFilePathLink('),
        );
        expect(fn).toBeTruthy();
        // The canvas dispatches sit inside the flag guard...
        expect(fn).toContain('dispatchOpenSourceCanvas(ref');
        // ...and the final, un-guarded statement is the floating-dialog fallback.
        const lastDispatch = fn.lastIndexOf('dispatchOpenMarkdownReview(ref)');
        const lastCanvas = fn.lastIndexOf('dispatchOpenSourceCanvas(ref');
        expect(lastDispatch).toBeGreaterThan(lastCanvas);
    });
});

// ---------------------------------------------------------------------------
// 4. Code references keep the READ-ONLY source viewer behaviour:
//    markdown chat links carry kind 'note', code chat links do NOT, and the
//    code branch stays assistant-only.
// ---------------------------------------------------------------------------
describe('AC-06 — code references stay read-only and assistant-only', () => {
    const preview = read('shared/file-path/file-path-preview.ts');

    it('markdown chat links open as an editable note (kind: note)', () => {
        expect(preview).toContain("dispatchOpenSourceCanvas(ref, 'note')");
    });

    it('code chat links open the read-only viewer (no note kind) from assistant messages only', () => {
        expect(preview).toContain("sourceEl.closest('.chat-message.assistant')");
        // The non-markdown branch dispatches WITHOUT a kind argument.
        expect(preview).toMatch(/!isMarkdownPath\(ref\.filePath\)[\s\S]*?dispatchOpenSourceCanvas\(ref\);/);
    });
});

// ---------------------------------------------------------------------------
// 5. The read-only MarkdownCanvasView still exists inside SourceCanvasBody and
//    is still the renderer for markdown refs — it must NOT have become editable.
// ---------------------------------------------------------------------------
describe('AC-06 — read-only MarkdownCanvasView preserved', () => {
    const body = read('features/chat/source-canvas/SourceCanvasBody.tsx');

    it('MarkdownCanvasView is still defined', () => {
        expect(body).toContain('function MarkdownCanvasView(');
    });

    it('markdown files in the read-only body still render MarkdownCanvasView', () => {
        expect(body).toContain('isMarkdownFile(fileName, language)');
        expect(body).toContain('<MarkdownCanvasView content={content} range={range} />');
    });

    it('it keeps its read-only Rendered ⇄ Raw toggle (no inline editing)', () => {
        expect(body).toContain("{raw ? 'Rendered' : 'Raw'}");
    });

    it('the read-only body never mounts the editable NoteEditor', () => {
        expect(body).not.toContain('NoteEditor');
    });
});
