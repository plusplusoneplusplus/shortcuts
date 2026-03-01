/**
 * Tests for DOM-aware selection-to-source-position mapping.
 */
/* @vitest-environment jsdom */

import { describe, expect, it } from 'vitest';
import {
    findMdLineAncestor,
    getTextOffsetInContainer,
    mapRenderedOffsetToSourceColumn,
    selectionToSourcePosition,
} from '../../../../src/server/spa/client/react/utils/selection-position';

// ── Helpers ──

/** Build a `<div class="md-line" data-line="N">` with the given inner HTML. */
function mdLine(lineNum: number, innerHtml: string): HTMLDivElement {
    const div = document.createElement('div');
    div.className = 'md-line';
    div.setAttribute('data-line', String(lineNum));
    div.innerHTML = innerHtml;
    return div;
}

/** Build a preview root containing multiple md-line divs. */
function buildPreview(lines: HTMLDivElement[]): HTMLDivElement {
    const root = document.createElement('div');
    root.id = 'preview-root';
    for (const line of lines) root.appendChild(line);
    return root;
}

/** Create a Range spanning from (startNode, startOffset) to (endNode, endOffset). */
function makeRange(
    startNode: Node,
    startOffset: number,
    endNode: Node,
    endOffset: number,
): Range {
    const range = document.createRange();
    range.setStart(startNode, startOffset);
    range.setEnd(endNode, endOffset);
    return range;
}

// ── findMdLineAncestor ──

describe('findMdLineAncestor', () => {
    it('returns the md-line div when called on a child text node', () => {
        const line = mdLine(3, 'Hello world');
        const textNode = line.childNodes[0];

        expect(findMdLineAncestor(textNode)).toBe(line);
    });

    it('returns the md-line div when called on a nested element', () => {
        const line = mdLine(5, '<strong>bold</strong> text');
        const strong = line.querySelector('strong')!;

        expect(findMdLineAncestor(strong)).toBe(line);
        expect(findMdLineAncestor(strong.childNodes[0])).toBe(line);
    });

    it('returns null for nodes not inside an md-line div', () => {
        const codeBlock = document.createElement('pre');
        codeBlock.innerHTML = '<code>some code</code>';

        expect(findMdLineAncestor(codeBlock.querySelector('code')!)).toBeNull();
    });

    it('returns null for a standalone text node', () => {
        const text = document.createTextNode('orphan');
        expect(findMdLineAncestor(text)).toBeNull();
    });
});

// ── getTextOffsetInContainer ──

describe('getTextOffsetInContainer', () => {
    it('returns correct offset for a single text node', () => {
        const div = document.createElement('div');
        div.textContent = 'Hello world';
        const textNode = div.childNodes[0];

        expect(getTextOffsetInContainer(div, textNode, 5)).toBe(5);
    });

    it('returns correct offset across multiple text nodes', () => {
        const div = document.createElement('div');
        div.innerHTML = 'abc<strong>def</strong>ghi';
        // Text nodes: "abc", "def", "ghi"
        const defTextNode = div.querySelector('strong')!.childNodes[0]; // "def"

        expect(getTextOffsetInContainer(div, defTextNode, 1)).toBe(4); // 3 ("abc") + 1
    });
});

// ── mapRenderedOffsetToSourceColumn ──

describe('mapRenderedOffsetToSourceColumn', () => {
    it('maps rendered offset to source column when suffix matches', () => {
        // Raw: "**bold** text", Rendered: "bold text"
        // Offset 0 in rendered → suffix "bold text" → found at index 2 → column 3
        const col = mapRenderedOffsetToSourceColumn('**bold** text', 'bold text', 0);
        expect(col).toBe(3);
    });

    it('maps rendered offset via prefix fallback', () => {
        // Raw: "start **end**", Rendered: "start end"
        // Offset 6 → suffix "end" found at raw index 8 → column 9
        const col = mapRenderedOffsetToSourceColumn('start **end**', 'start end', 6);
        expect(col).toBe(9);
    });

    it('returns 1 for zero offset', () => {
        expect(mapRenderedOffsetToSourceColumn('any line', 'any line', 0)).toBe(1);
    });

    it('clamps to raw line length when no match found', () => {
        // Rendered text doesn't appear in raw at all
        const col = mapRenderedOffsetToSourceColumn('abc', 'xyz', 2);
        expect(col).toBe(3); // min(2+1, 3+1) = 3
    });
});

// ── selectionToSourcePosition ──

describe('selectionToSourcePosition', () => {
    const RAW_CONTENT = [
        '# Heading One',          // line 1 — rendered as "Heading One"
        'Plain text here',         // line 2 — rendered as "Plain text here"
        '**bold** and *italic*',   // line 3 — rendered as "bold and italic"
        'Last line of content',    // line 4
    ].join('\n');

    it('returns correct 1-based positions for a single-line selection', () => {
        // Line 2: "Plain text here" — no markdown syntax, 1:1 mapping
        const line2 = mdLine(2, 'Plain text here');
        const root = buildPreview([mdLine(1, 'Heading One'), line2]);

        const textNode = line2.childNodes[0]; // "Plain text here"
        const range = makeRange(textNode, 6, textNode, 10); // "text"

        const pos = selectionToSourcePosition(RAW_CONTENT, root, range);
        expect(pos).toEqual({ startLine: 2, startColumn: 7, endLine: 2, endColumn: 11 });
    });

    it('returns correct positions for multi-line selection', () => {
        const line2 = mdLine(2, 'Plain text here');
        const line3 = mdLine(3, 'bold and italic');
        const root = buildPreview([mdLine(1, 'Heading One'), line2, line3]);

        const startText = line2.childNodes[0]; // "Plain text here"
        const endText = line3.childNodes[0];   // "bold and italic"

        // Select from "text here" on line 2 to "bold" on line 3
        const range = makeRange(startText, 6, endText, 4);

        const pos = selectionToSourcePosition(RAW_CONTENT, root, range);
        expect(pos).not.toBeNull();
        expect(pos!.startLine).toBe(2);
        expect(pos!.endLine).toBe(3);
    });

    it('maps column offset using raw source line for bold syntax', () => {
        // Line 3: raw "**bold** and *italic*", rendered "bold and italic"
        const line3 = mdLine(3, 'bold and italic');
        const root = buildPreview([line3]);

        const textNode = line3.childNodes[0]; // "bold and italic"
        // Select "bold" (rendered offset 0..4)
        const range = makeRange(textNode, 0, textNode, 4);

        const pos = selectionToSourcePosition(RAW_CONTENT, root, range);
        expect(pos).toEqual({ startLine: 3, startColumn: 3, endLine: 3, endColumn: 7 });
    });

    it('returns null for selection inside a block element without md-line ancestor', () => {
        const codeBlock = document.createElement('pre');
        codeBlock.innerHTML = '<code>const x = 1;</code>';
        const root = buildPreview([]);
        root.appendChild(codeBlock);

        const codeText = codeBlock.querySelector('code')!.childNodes[0];
        const range = makeRange(codeText, 0, codeText, 5);

        const pos = selectionToSourcePosition(RAW_CONTENT, root, range);
        expect(pos).toBeNull();
    });

    it('handles heading line where rendered text differs from raw', () => {
        // Line 1: raw "# Heading One", rendered "Heading One"
        const line1 = mdLine(1, 'Heading One');
        const root = buildPreview([line1]);

        const textNode = line1.childNodes[0]; // "Heading One"
        // Select "Heading" (rendered offset 0..7)
        const range = makeRange(textNode, 0, textNode, 7);

        const pos = selectionToSourcePosition(RAW_CONTENT, root, range);
        expect(pos).not.toBeNull();
        expect(pos!.startLine).toBe(1);
        expect(pos!.endLine).toBe(1);
        // "Heading" found in raw "# Heading One" at index 2 → column 3
        expect(pos!.startColumn).toBe(3);
        expect(pos!.endColumn).toBe(10); // 3 + 7
    });

    it('handles selection with nested inline elements', () => {
        // Line 3: raw "**bold** and *italic*", rendered with <strong>bold</strong> and <em>italic</em>
        const line3 = mdLine(3, '<strong>bold</strong> and <em>italic</em>');
        const root = buildPreview([line3]);

        const boldText = line3.querySelector('strong')!.childNodes[0]; // "bold"
        // Select "bold" from the strong element
        const range = makeRange(boldText, 0, boldText, 4);

        const pos = selectionToSourcePosition(RAW_CONTENT, root, range);
        expect(pos).not.toBeNull();
        expect(pos!.startLine).toBe(3);
        expect(pos!.endLine).toBe(3);
        // "bold" found in raw at index 2 → column 3
        expect(pos!.startColumn).toBe(3);
        expect(pos!.endColumn).toBe(7);
    });
});

// ── Integration: handlePopupSubmit passes source-accurate positions ──

describe('selectionToSourcePosition integration with createAnchorData contract', () => {
    it('produces positions that yield correct contextBefore/contextAfter from raw content', () => {
        const rawContent = 'Line one\nLine two has **bold** text\nLine three';
        //                   0123456789...

        // Simulate: user selects "bold" from rendered line 2 "Line two has bold text"
        const line2 = mdLine(2, 'Line two has bold text');
        const root = buildPreview([mdLine(1, 'Line one'), line2, mdLine(3, 'Line three')]);

        const textNode = line2.childNodes[0];
        const range = makeRange(textNode, 13, textNode, 17); // "bold"

        const pos = selectionToSourcePosition(rawContent, root, range);
        expect(pos).not.toBeNull();

        // Verify the positions index correctly into the raw content
        const rawLines = rawContent.split('\n');
        const rawLine2 = rawLines[pos!.startLine - 1];
        const extracted = rawLine2.substring(pos!.startColumn - 1, pos!.endColumn - 1);
        expect(extracted).toBe('bold');

        // Verify the surrounding context is raw markdown, not rendered
        const beforeStart = Math.max(0, pos!.startColumn - 4);
        const contextBefore = rawLine2.substring(beforeStart, pos!.startColumn - 1);
        expect(contextBefore).toContain('**'); // raw markdown syntax preserved
    });
});
