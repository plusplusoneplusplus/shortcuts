/**
 * Tests for IndentExtension — verifies attribute parsing, rendering, and
 * that the CSS rules for data-indent are present in noteEditor.css.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
    MAX_INDENT,
    INDENT_TYPES,
    TEXT_INDENT_TYPES,
    EMBED_INDENT_TYPES,
    clampIndent,
    parseIndentAttr,
    renderIndentAttr,
    createIndentAttribute,
} from '../../../../src/server/spa/client/react/features/notes/editor/extensions/indentExtension';

const EXTENSIONS_DIR = path.join(
    __dirname, '..', '..', '..', '..', 'src', 'server', 'spa', 'client', 'react',
    'features', 'notes', 'editor', 'extensions',
);
const EXTENSION_PATH = path.join(EXTENSIONS_DIR, 'indentExtension.ts');
const SHARED_PATH = path.join(EXTENSIONS_DIR, 'indentShared.ts');
const CSS_PATH = path.join(
    __dirname, '..', '..', '..', '..', 'src', 'server', 'spa', 'client', 'react',
    'features', 'notes', 'editor', 'noteEditor.css',
);

const source = fs.readFileSync(EXTENSION_PATH, 'utf-8');
const sharedSource = fs.readFileSync(SHARED_PATH, 'utf-8');
const css = fs.readFileSync(CSS_PATH, 'utf-8');

describe('IndentExtension constants', () => {
    it('MAX_INDENT is 8', () => {
        expect(MAX_INDENT).toBe(8);
    });

    it('INDENT_TYPES includes paragraph and heading', () => {
        expect(INDENT_TYPES).toContain('paragraph');
        expect(INDENT_TYPES).toContain('heading');
    });

    it('INDENT_TYPES also includes the five block-level visual embeds', () => {
        expect(TEXT_INDENT_TYPES).toEqual(['paragraph', 'heading']);
        expect(EMBED_INDENT_TYPES).toEqual([
            'image', 'pdfBlock', 'mapBlock', 'mermaidBlock', 'mathDisplay',
        ]);
        for (const t of EMBED_INDENT_TYPES) expect(INDENT_TYPES).toContain(t);
        // Inline math is not a block and must not be indentable.
        expect(INDENT_TYPES).not.toContain('mathInline');
    });
});

describe('shared indent helpers (safety policy)', () => {
    it('clampIndent clamps to [0, MAX_INDENT]', () => {
        expect(clampIndent(-5)).toBe(0);
        expect(clampIndent(0)).toBe(0);
        expect(clampIndent(3)).toBe(3);
        expect(clampIndent(MAX_INDENT)).toBe(MAX_INDENT);
        expect(clampIndent(MAX_INDENT + 10)).toBe(MAX_INDENT);
    });

    function elWith(value: string | null): HTMLElement {
        const el = document.createElement('div');
        if (value !== null) el.setAttribute('data-indent', value);
        return el;
    }

    it('parseIndentAttr: absent/invalid → 0, negative → 0, over-max → clamped', () => {
        expect(parseIndentAttr(elWith(null))).toBe(0);
        expect(parseIndentAttr(elWith(''))).toBe(0);
        expect(parseIndentAttr(elWith('not-a-number'))).toBe(0);
        expect(parseIndentAttr(elWith('-3'))).toBe(0);
        expect(parseIndentAttr(elWith('2'))).toBe(2);
        expect(parseIndentAttr(elWith('99'))).toBe(MAX_INDENT);
    });

    it('renderIndentAttr: omits data-indent at level 0, emits it otherwise', () => {
        expect(renderIndentAttr(0)).toEqual({});
        expect(renderIndentAttr(null)).toEqual({});
        expect(renderIndentAttr(undefined)).toEqual({});
        expect(renderIndentAttr(1)).toEqual({ 'data-indent': '1' });
        expect(renderIndentAttr(8)).toEqual({ 'data-indent': '8' });
    });

    it('createIndentAttribute wires the shared parse/render with default 0', () => {
        const attr = createIndentAttribute();
        expect(attr.default).toBe(0);
        expect(attr.renderHTML({ indent: 0 })).toEqual({});
        expect(attr.renderHTML({ indent: 4 })).toEqual({ 'data-indent': '4' });
        expect(attr.parseHTML(elWith('4'))).toBe(4);
    });
});

describe('IndentExtension source structure', () => {
    it('declares increaseIndent command', () => {
        expect(source).toContain('increaseIndent');
    });

    it('declares decreaseIndent command', () => {
        expect(source).toContain('decreaseIndent');
    });

    it('shared module uses data-indent as the HTML attribute', () => {
        expect(sharedSource).toContain("'data-indent'");
    });

    it('shared module clamps indent to MAX_INDENT', () => {
        expect(sharedSource).toContain('MAX_INDENT');
        expect(sharedSource).toContain('Math.min');
        expect(sharedSource).toContain('Math.max');
    });

    it('shared module returns {} (no attribute) when indent is 0', () => {
        // The renderIndentAttr guard: if (!n || n <= 0) return {};
        expect(sharedSource).toContain('return {}');
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
