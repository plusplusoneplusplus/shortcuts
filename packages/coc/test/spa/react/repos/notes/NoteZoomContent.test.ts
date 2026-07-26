import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * AC-02 — content scaling via the CSS `zoom` property.
 *
 * The full `NoteEditor` is a ~2500-line component with heavy provider/editor
 * dependencies, so this asserts against its source (the same source-mirror
 * pattern used elsewhere in this suite): the `zoom` value is derived from the
 * per-note zoom state and applied to BOTH the rich and source content bodies —
 * never to the toolbar / scroll chrome — and no `transform: scale()` or
 * font-size scaling was introduced for note-body zoom.
 */

const editorSrc = readFileSync(
    resolve(__dirname, '../../../../../src/server/spa/client/react/features/notes/editor/NoteEditor.tsx'),
    'utf8',
);

describe('NoteEditor CSS zoom wiring (AC-02)', () => {
    it('derives the zoom CSS value from the per-note zoom state', () => {
        expect(editorSrc).toContain('useNoteZoom(workspaceId, normalizedNotePath)');
        expect(editorSrc).toContain('const noteZoomCss = `${noteZoom.zoom}%`');
    });

    it('applies CSS zoom to the rich content body wrapper', () => {
        // The rich wrapper carries a testid and receives `zoom: noteZoomCss`.
        const richIdx = editorSrc.indexOf('data-testid="note-rich-zoom"');
        expect(richIdx).toBeGreaterThan(-1);
        const richBlock = editorSrc.slice(richIdx, richIdx + 200);
        expect(richBlock).toContain('zoom: noteZoomCss');
    });

    it('applies CSS zoom to the source (markdown) content body wrapper', () => {
        const srcIdx = editorSrc.indexOf('data-testid="note-source-zoom"');
        expect(srcIdx).toBeGreaterThan(-1);
        const srcBlock = editorSrc.slice(srcIdx - 60, srcIdx + 60);
        expect(srcBlock).toContain('zoom: noteZoomCss');
    });

    it('does not scale the note body with transform: scale() or font-size', () => {
        // No transform-based scaling of the note body was introduced.
        expect(editorSrc).not.toMatch(/transform:\s*['"`]?\s*scale\(/);
        // The zoom mechanism is the CSS `zoom` property, not font-size scaling.
        expect(editorSrc).not.toContain('fontSize: noteZoomCss');
    });

    it('does not apply zoom to the toolbar element', () => {
        // The zoom control lives in the toolbar, but the toolbar itself is never zoomed.
        const toolbarIdx = editorSrc.indexOf('<NoteEditorToolbar');
        expect(toolbarIdx).toBeGreaterThan(-1);
        // The toolbar JSX opening tag does not carry a zoom style.
        const toolbarTag = editorSrc.slice(toolbarIdx, editorSrc.indexOf('>', toolbarIdx));
        expect(toolbarTag).not.toContain('zoom');
    });
});
