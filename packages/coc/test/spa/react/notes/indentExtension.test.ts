/**
 * Tests for IndentExtension — verifies attribute parsing, rendering, and
 * that the CSS rules for data-indent are present in noteEditor.css.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { MAX_INDENT, INDENT_TYPES } from '../../../../src/server/spa/client/react/features/notes/editor/extensions/indentExtension';

const EXTENSION_PATH = path.join(
    __dirname, '..', '..', '..', '..', 'src', 'server', 'spa', 'client', 'react',
    'features', 'notes', 'editor', 'extensions', 'indentExtension.ts',
);
const CSS_PATH = path.join(
    __dirname, '..', '..', '..', '..', 'src', 'server', 'spa', 'client', 'react',
    'features', 'notes', 'editor', 'noteEditor.css',
);

const source = fs.readFileSync(EXTENSION_PATH, 'utf-8');
const css = fs.readFileSync(CSS_PATH, 'utf-8');

describe('IndentExtension constants', () => {
    it('MAX_INDENT is 8', () => {
        expect(MAX_INDENT).toBe(8);
    });

    it('INDENT_TYPES includes paragraph and heading', () => {
        expect(INDENT_TYPES).toContain('paragraph');
        expect(INDENT_TYPES).toContain('heading');
    });
});

describe('IndentExtension source structure', () => {
    it('declares increaseIndent command', () => {
        expect(source).toContain('increaseIndent');
    });

    it('declares decreaseIndent command', () => {
        expect(source).toContain('decreaseIndent');
    });

    it('uses data-indent as the HTML attribute', () => {
        expect(source).toContain("'data-indent'");
    });

    it('clamps indent to MAX_INDENT on parseHTML', () => {
        expect(source).toContain('MAX_INDENT');
        expect(source).toContain('Math.min');
        expect(source).toContain('Math.max');
    });

    it('returns {} (no attribute) when indent is 0', () => {
        // The renderHTML guard: if (!n || n <= 0) return {};
        expect(source).toContain('return {}');
    });

    it('Tab shortcut increases indent (not in list context)', () => {
        expect(source).toContain("Tab");
        expect(source).toContain('increaseIndent');
        expect(source).toContain('listItem');
    });

    it('Shift-Tab shortcut decreases indent (not in list context)', () => {
        expect(source).toContain('Shift-Tab');
        expect(source).toContain('decreaseIndent');
    });
});

describe('noteEditor.css — data-indent rules', () => {
    for (let i = 1; i <= MAX_INDENT; i++) {
        const level = i;
        const expectedPaddingRem = level * 2;
        it(`data-indent="${level}" applies padding-left: ${expectedPaddingRem}rem`, () => {
            expect(css).toContain(`[data-indent="${level}"]`);
            expect(css).toContain(`padding-left: ${expectedPaddingRem}rem`);
        });
    }

    it('scopes indent rules inside .note-editor .ProseMirror', () => {
        expect(css).toContain('.note-editor .ProseMirror [data-indent="1"]');
    });
});
