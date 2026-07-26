/**
 * paperAnnotationsExport — pure client helpers for the Goal 4 AC-03 export button.
 *
 * Covers URL construction against the server export route + the derived download
 * filename. The DOM `downloadMarkdown` is exercised in PdfAnnotationsLayer.test.
 */

import { describe, it, expect } from 'vitest';
import {
    exportAnnotationsFilename,
    paperAnnotationsExportUrl,
} from '../../../../src/server/spa/client/react/features/notes/editor/extensions/paperAnnotationsExport';

describe('paperAnnotationsExportUrl', () => {
    it('builds the export route with the note path', () => {
        expect(paperAnnotationsExportUrl('ws-1', 'papers/deep.md')).toBe(
            '/api/workspaces/ws-1/notes/paper-annotations/export?path=papers%2Fdeep.md',
        );
    });

    it('includes root only when provided', () => {
        expect(paperAnnotationsExportUrl('ws-1', 'a.md')).not.toContain('root=');
        expect(paperAnnotationsExportUrl('ws-1', 'a.md', 'root-2')).toContain('root=root-2');
    });

    it('includes title only when provided', () => {
        expect(paperAnnotationsExportUrl('ws-1', 'a.md')).not.toContain('title=');
        expect(paperAnnotationsExportUrl('ws-1', 'a.md', undefined, 'My Title')).toContain(
            'title=My+Title',
        );
    });

    it('encodes the workspace id', () => {
        expect(paperAnnotationsExportUrl('ws/1', 'a.md')).toContain('/api/workspaces/ws%2F1/');
    });
});

describe('exportAnnotationsFilename', () => {
    it('derives from the note basename', () => {
        expect(exportAnnotationsFilename('papers/deep-dive.md')).toBe('deep-dive.annotations.md');
    });

    it('handles backslash paths', () => {
        expect(exportAnnotationsFilename('a\\b\\note.md')).toBe('note.annotations.md');
    });

    it('falls back when the path is empty or missing', () => {
        expect(exportAnnotationsFilename('')).toBe('paper.annotations.md');
        expect(exportAnnotationsFilename(undefined)).toBe('paper.annotations.md');
        expect(exportAnnotationsFilename(null)).toBe('paper.annotations.md');
    });

    it('strips only a trailing .md (case-insensitive)', () => {
        expect(exportAnnotationsFilename('X.MD')).toBe('X.annotations.md');
        expect(exportAnnotationsFilename('notes.md.md')).toBe('notes.md.annotations.md');
    });
});
