/**
 * Tests for NoteEditorToolbar — text alignment and indent buttons.
 *
 * Validates that the toolbar source includes the alignment and indent button
 * commands, labels, and grouping.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const TOOLBAR_PATH = path.join(
    __dirname, '..', '..', '..', '..', '..', '..', 'src', 'server', 'spa', 'client', 'react',
    'features', 'notes', 'editor', 'NoteEditorToolbar.tsx'
);

describe('NoteEditorToolbar — alignment and indent buttons', () => {
    let source: string;

    beforeAll(() => {
        source = fs.readFileSync(TOOLBAR_PATH, 'utf-8');
    });

    describe('text alignment buttons', () => {
        it('includes Align left button', () => {
            expect(source).toContain("label=\"Align left\"");
            expect(source).toContain("setTextAlign('left')");
        });

        it('includes Align center button', () => {
            expect(source).toContain("label=\"Align center\"");
            expect(source).toContain("setTextAlign('center')");
        });

        it('includes Align right button', () => {
            expect(source).toContain("label=\"Align right\"");
            expect(source).toContain("setTextAlign('right')");
        });

        it('includes Justify button', () => {
            expect(source).toContain("label=\"Justify\"");
            expect(source).toContain("setTextAlign('justify')");
        });

        it('alignment buttons are inside the formatting section (not hidden in source mode)', () => {
            // The formatting section begins with the Bold button and is gated by !hidden
            const formattingStart = source.indexOf('"Bold"');
            const tableEnd = source.indexOf('"Insert table"');
            const alignLeft = source.indexOf('"Align left"');
            expect(formattingStart).toBeGreaterThan(0);
            expect(tableEnd).toBeGreaterThan(formattingStart);
            expect(alignLeft).toBeGreaterThan(tableEnd);
        });
    });

    describe('indent buttons', () => {
        it('includes Increase indent button', () => {
            expect(source).toContain("label=\"Increase indent\"");
            expect(source).toContain('increaseIndent()');
        });

        it('includes Decrease indent button', () => {
            expect(source).toContain("label=\"Decrease indent\"");
            expect(source).toContain('decreaseIndent()');
        });

        it('indent buttons appear after alignment buttons', () => {
            const alignIdx = source.indexOf('"Align left"');
            const increaseIdx = source.indexOf('"Increase indent"');
            expect(increaseIdx).toBeGreaterThan(alignIdx);
        });
    });
});
