import { describe, it, expect } from 'vitest';
import { MockNode, NODE_TYPES } from '../../../src/editor/rendering/cursor-management';
import {
    normalizeExtractedLine,
    shouldSkipElement,
    isBlockElement,
    isLineContentElement,
    isLineRowElement,
    isBlockContentElement,
    isBrElement,
    processTextNode,
    addNewLine,
    createExtractionContext,
    extractBlockText,
    extractTableText,
    hasMeaningfulContentAfterBr,
    processNode,
    extractPlainTextContent,
    applyInsertion,
    applyDeletion,
    getTotalCharacterCount,
    positionToOffset,
    offsetToPosition,
    DEFAULT_SKIP_CLASSES,
} from '../../../src/editor/rendering/content-extraction';

// ---------------------------------------------------------------------------
// Helper: build MockNode trees
// ---------------------------------------------------------------------------

function createTextNode(text: string, parent?: MockNode): MockNode {
    const node: MockNode = {
        nodeType: NODE_TYPES.TEXT_NODE,
        textContent: text,
        parentNode: parent ?? null,
        childNodes: [],
    };
    return node;
}

interface ElementOpts {
    tagName?: string;
    classes?: string[];
    attrs?: Record<string, string>;
    children?: MockNode[];
    textContent?: string | null;
}

function createElement(opts: ElementOpts = {}): MockNode {
    const { tagName = 'div', classes = [], attrs = {}, children = [], textContent } = opts;
    const node: MockNode = {
        nodeType: NODE_TYPES.ELEMENT_NODE,
        tagName: tagName.toUpperCase(),
        textContent: textContent ?? children.map(c => c.textContent ?? '').join(''),
        parentNode: null,
        childNodes: [...children],
        classList: { contains: (cls: string) => classes.includes(cls) },
        getAttribute: (attr: string) => attrs[attr] ?? null,
        hasAttribute: (attr: string) => attr in attrs,
    };
    for (const child of node.childNodes) {
        child.parentNode = node;
    }
    return node;
}

function createLineContent(text: string, lineNum = '1'): MockNode {
    const textNode = createTextNode(text);
    return createElement({
        tagName: 'div',
        classes: ['line-content'],
        attrs: { 'data-line': lineNum },
        children: [textNode],
    });
}

function createLineRow(children: MockNode[]): MockNode {
    return createElement({ tagName: 'div', classes: ['line-row'], children });
}

function createBr(): MockNode {
    return createElement({ tagName: 'br' });
}

// ===========================================================================
// normalizeExtractedLine
// ===========================================================================
describe('normalizeExtractedLine', () => {
    it('returns empty/falsy strings unchanged', () => {
        expect(normalizeExtractedLine('')).toBe('');
    });

    it('strips leading NBSP', () => {
        expect(normalizeExtractedLine('\u00a0hello')).toBe('hello');
    });

    it('strips trailing NBSP', () => {
        expect(normalizeExtractedLine('world\u00a0')).toBe('world');
    });

    it('strips leading and trailing NBSP', () => {
        expect(normalizeExtractedLine('\u00a0text\u00a0')).toBe('text');
    });

    it('preserves interior NBSP', () => {
        expect(normalizeExtractedLine('a\u00a0b')).toBe('a\u00a0b');
    });

    it('strips multiple leading NBSPs', () => {
        expect(normalizeExtractedLine('\u00a0\u00a0x')).toBe('x');
    });

    it('returns line unchanged when no NBSP present', () => {
        expect(normalizeExtractedLine('plain text')).toBe('plain text');
    });
});

// ===========================================================================
// shouldSkipElement
// ===========================================================================
describe('shouldSkipElement', () => {
    it('returns false for text nodes', () => {
        const text = createTextNode('hello');
        expect(shouldSkipElement(text, DEFAULT_SKIP_CLASSES)).toBe(false);
    });

    it('returns true when element has a skip class', () => {
        const el = createElement({ classes: ['gutter-icon'] });
        expect(shouldSkipElement(el, DEFAULT_SKIP_CLASSES)).toBe(true);
    });

    it('returns false when element has no skip class', () => {
        const el = createElement({ classes: ['my-custom-class'] });
        expect(shouldSkipElement(el, DEFAULT_SKIP_CLASSES)).toBe(false);
    });

    it('returns true for each default skip class', () => {
        for (const cls of DEFAULT_SKIP_CLASSES) {
            const el = createElement({ classes: [cls] });
            expect(shouldSkipElement(el, DEFAULT_SKIP_CLASSES)).toBe(true);
        }
    });

    it('returns false when classList is missing', () => {
        const el: MockNode = {
            nodeType: NODE_TYPES.ELEMENT_NODE,
            textContent: '',
            parentNode: null,
            childNodes: [],
        };
        expect(shouldSkipElement(el, DEFAULT_SKIP_CLASSES)).toBe(false);
    });
});

// ===========================================================================
// Element classification helpers
// ===========================================================================
describe('isBlockElement', () => {
    it('returns false for text nodes', () => {
        expect(isBlockElement(createTextNode('x'))).toBe(false);
    });

    it('returns true for div', () => {
        expect(isBlockElement(createElement({ tagName: 'div' }))).toBe(true);
    });

    it('returns true for p', () => {
        expect(isBlockElement(createElement({ tagName: 'p' }))).toBe(true);
    });

    it('returns true for line-row class', () => {
        expect(isBlockElement(createElement({ tagName: 'span', classes: ['line-row'] }))).toBe(true);
    });

    it('returns true for block-row class', () => {
        expect(isBlockElement(createElement({ tagName: 'span', classes: ['block-row'] }))).toBe(true);
    });

    it('returns false for span without block class', () => {
        expect(isBlockElement(createElement({ tagName: 'span' }))).toBe(false);
    });
});

describe('isLineContentElement', () => {
    it('returns true for element with line-content class and data-line attr', () => {
        const el = createElement({ classes: ['line-content'], attrs: { 'data-line': '1' } });
        expect(isLineContentElement(el)).toBe(true);
    });

    it('returns false when data-line is missing', () => {
        const el = createElement({ classes: ['line-content'] });
        expect(isLineContentElement(el)).toBe(false);
    });

    it('returns false when line-content class is missing', () => {
        const el = createElement({ classes: [], attrs: { 'data-line': '1' } });
        expect(isLineContentElement(el)).toBe(false);
    });

    it('returns false for text nodes', () => {
        expect(isLineContentElement(createTextNode('x'))).toBe(false);
    });
});

describe('isLineRowElement', () => {
    it('returns true for line-row', () => {
        expect(isLineRowElement(createElement({ classes: ['line-row'] }))).toBe(true);
    });

    it('returns true for block-row', () => {
        expect(isLineRowElement(createElement({ classes: ['block-row'] }))).toBe(true);
    });

    it('returns false for unrelated class', () => {
        expect(isLineRowElement(createElement({ classes: ['other'] }))).toBe(false);
    });
});

describe('isBlockContentElement', () => {
    it('returns true for block-content class', () => {
        expect(isBlockContentElement(createElement({ classes: ['block-content'] }))).toBe(true);
    });

    it('returns false without block-content class', () => {
        expect(isBlockContentElement(createElement({ classes: [] }))).toBe(false);
    });
});

describe('isBrElement', () => {
    it('returns true for BR tag', () => {
        expect(isBrElement(createBr())).toBe(true);
    });

    it('returns false for non-BR element', () => {
        expect(isBrElement(createElement({ tagName: 'div' }))).toBe(false);
    });

    it('returns false for text node', () => {
        expect(isBrElement(createTextNode('x'))).toBe(false);
    });
});

// ===========================================================================
// processTextNode / addNewLine / createExtractionContext
// ===========================================================================
describe('processTextNode', () => {
    it('pushes text when context has no lines', () => {
        const ctx = createExtractionContext();
        processTextNode(createTextNode('hello'), ctx);
        expect(ctx.lines).toEqual(['hello']);
    });

    it('appends to last line when context already has lines', () => {
        const ctx = createExtractionContext();
        ctx.lines.push('abc');
        processTextNode(createTextNode('def'), ctx);
        expect(ctx.lines).toEqual(['abcdef']);
    });

    it('handles empty text content', () => {
        const ctx = createExtractionContext();
        const node: MockNode = { nodeType: NODE_TYPES.TEXT_NODE, textContent: null, parentNode: null, childNodes: [] };
        processTextNode(node, ctx);
        expect(ctx.lines).toEqual(['']);
    });
});

describe('addNewLine', () => {
    it('appends an empty string to lines', () => {
        const ctx = createExtractionContext();
        ctx.lines.push('line1');
        addNewLine(ctx);
        expect(ctx.lines).toEqual(['line1', '']);
    });
});

// ===========================================================================
// extractBlockText / extractTableText
// ===========================================================================
describe('extractBlockText', () => {
    it('returns textContent for pre elements', () => {
        const pre = createElement({ tagName: 'pre', textContent: 'code here' });
        expect(extractBlockText(pre)).toBe('code here');
    });

    it('returns textContent for code elements', () => {
        const code = createElement({ tagName: 'code', textContent: 'fn()' });
        expect(extractBlockText(code)).toBe('fn()');
    });

    it('delegates to extractTableText for md-table-container', () => {
        const table = createElement({ tagName: 'div', classes: ['md-table-container'], textContent: '|a|b|' });
        expect(extractBlockText(table)).toBe('|a|b|');
    });

    it('delegates to extractTableText for md-table', () => {
        const table = createElement({ tagName: 'table', classes: ['md-table'], textContent: 'cells' });
        expect(extractBlockText(table)).toBe('cells');
    });

    it('falls back to textContent for other elements', () => {
        const el = createElement({ tagName: 'div', textContent: 'fallback' });
        expect(extractBlockText(el)).toBe('fallback');
    });

    it('returns empty string when textContent is null', () => {
        const el = createElement({ tagName: 'div', textContent: null });
        expect(extractBlockText(el)).toBe('');
    });
});

describe('extractTableText', () => {
    it('returns textContent of table node', () => {
        const table = createElement({ tagName: 'table', textContent: 'row1\nrow2' });
        expect(extractTableText(table)).toBe('row1\nrow2');
    });
});

// ===========================================================================
// hasMeaningfulContentAfterBr
// ===========================================================================
describe('hasMeaningfulContentAfterBr', () => {
    it('returns true when a text node with content follows', () => {
        const br = createBr();
        const text = createTextNode('more');
        createElement({ children: [br, text] });
        expect(hasMeaningfulContentAfterBr(br)).toBe(true);
    });

    it('returns false when only whitespace follows', () => {
        const br = createBr();
        const ws = createTextNode('   ');
        createElement({ children: [br, ws] });
        expect(hasMeaningfulContentAfterBr(br)).toBe(false);
    });

    it('returns true when an element node follows', () => {
        const br = createBr();
        const span = createElement({ tagName: 'span', textContent: 'x' });
        createElement({ children: [br, span] });
        expect(hasMeaningfulContentAfterBr(br)).toBe(true);
    });

    it('returns false when br is last child', () => {
        const br = createBr();
        createElement({ children: [br] });
        expect(hasMeaningfulContentAfterBr(br)).toBe(false);
    });

    it('returns false when br has no parent', () => {
        const br = createBr();
        expect(hasMeaningfulContentAfterBr(br)).toBe(false);
    });

    it('returns false when only empty text follows', () => {
        const br = createBr();
        const empty = createTextNode('');
        createElement({ children: [br, empty] });
        expect(hasMeaningfulContentAfterBr(br)).toBe(false);
    });
});

// ===========================================================================
// processNode / extractPlainTextContent (integration)
// ===========================================================================
describe('processNode', () => {
    it('extracts text from a simple text node', () => {
        const ctx = createExtractionContext();
        processNode(createTextNode('hello'), ctx);
        expect(ctx.lines).toEqual(['hello']);
    });

    it('skips elements with skip classes', () => {
        const ctx = createExtractionContext();
        const el = createElement({ classes: ['line-number'], textContent: '42' });
        processNode(el, ctx);
        expect(ctx.lines).toEqual([]);
    });

    it('handles BR outside line-content by adding new line', () => {
        const ctx = createExtractionContext();
        ctx.lines.push('before');
        processNode(createBr(), ctx);
        expect(ctx.lines).toEqual(['before', '']);
    });

    it('processes line-content children and starts a new line', () => {
        const ctx = createExtractionContext();
        const lc = createLineContent('line one', '1');
        processNode(lc, ctx);
        // addNewLine pushes '', then text appends to it → ['line one']
        expect(ctx.lines).toEqual(['line one']);
    });

    it('processes line-row children recursively', () => {
        const ctx = createExtractionContext();
        const lc = createLineContent('inside row', '1');
        const row = createLineRow([lc]);
        processNode(row, ctx);
        expect(ctx.lines.filter(l => l === 'inside row')).toHaveLength(1);
    });

    it('processes block-content element', () => {
        const ctx = createExtractionContext();
        ctx.lines.push('');
        const block = createElement({ tagName: 'pre', classes: ['block-content'], textContent: 'code\nblock' });
        processNode(block, ctx);
        expect(ctx.lines).toContain('code');
        expect(ctx.lines).toContain('block');
    });

    it('ignores non-element non-text nodes', () => {
        const ctx = createExtractionContext();
        const comment: MockNode = { nodeType: 8, textContent: 'comment', parentNode: null, childNodes: [] };
        processNode(comment, ctx);
        expect(ctx.lines).toEqual([]);
    });
});

describe('extractPlainTextContent', () => {
    it('extracts text from a single line editor', () => {
        const lc = createLineContent('Hello, world!', '1');
        const editor = createElement({ children: [lc] });
        const result = extractPlainTextContent(editor);
        expect(result.content).toBe('Hello, world!');
        expect(result.lines).toEqual(['Hello, world!']);
    });

    it('extracts text from multi-line editor', () => {
        const l1 = createLineContent('first', '1');
        const l2 = createLineContent('second', '2');
        const editor = createElement({ children: [l1, l2] });
        const result = extractPlainTextContent(editor);
        expect(result.lines).toContain('first');
        expect(result.lines).toContain('second');
    });

    it('strips NBSP from extracted lines', () => {
        const lc = createLineContent('\u00a0indented\u00a0', '1');
        const editor = createElement({ children: [lc] });
        const result = extractPlainTextContent(editor);
        expect(result.lines).toContain('indented');
    });

    it('skips UI elements like gutter icons', () => {
        const gutter = createElement({ classes: ['gutter-icon'], textContent: '•' });
        const lc = createLineContent('content', '1');
        const editor = createElement({ children: [gutter, lc] });
        const result = extractPlainTextContent(editor);
        expect(result.content).not.toContain('•');
        expect(result.lines).toContain('content');
    });

    it('handles empty editor', () => {
        const editor = createElement({ children: [] });
        const result = extractPlainTextContent(editor);
        expect(result.content).toBe('');
        expect(result.lines).toEqual([]);
    });

    it('handles nested line-row > line-content', () => {
        const lc1 = createLineContent('row line 1', '1');
        const lc2 = createLineContent('row line 2', '2');
        const row1 = createLineRow([lc1]);
        const row2 = createLineRow([lc2]);
        const editor = createElement({ children: [row1, row2] });
        const result = extractPlainTextContent(editor);
        expect(result.lines).toContain('row line 1');
        expect(result.lines).toContain('row line 2');
    });

    it('accepts custom skipClasses', () => {
        const custom = createElement({ classes: ['my-skip'], textContent: 'hidden' });
        const lc = createLineContent('visible', '1');
        const editor = createElement({ children: [custom, lc] });
        const result = extractPlainTextContent(editor, new Set(['my-skip']));
        expect(result.content).not.toContain('hidden');
        expect(result.lines).toContain('visible');
    });

    it('returns lineMap as a Map', () => {
        const editor = createElement({ children: [] });
        const result = extractPlainTextContent(editor);
        expect(result.lineMap).toBeInstanceOf(Map);
    });
});

// ===========================================================================
// applyInsertion
// ===========================================================================
describe('applyInsertion', () => {
    it('inserts text at column position within a line', () => {
        const result = applyInsertion(['hello world'], 1, 5, ' dear');
        expect(result).toEqual(['hello dear world']);
    });

    it('inserts at the start of a line', () => {
        const result = applyInsertion(['world'], 1, 0, 'hello ');
        expect(result).toEqual(['hello world']);
    });

    it('inserts at the end of a line', () => {
        const result = applyInsertion(['hello'], 1, 5, ' world');
        expect(result).toEqual(['hello world']);
    });

    it('splits lines on newline in inserted text', () => {
        const result = applyInsertion(['abc'], 1, 1, 'X\nY');
        expect(result).toEqual(['aX', 'Ybc']);
    });

    it('handles multi-line insertion with middle lines', () => {
        const result = applyInsertion(['start end'], 1, 6, 'A\nB\nC\n');
        expect(result).toEqual(['start A', 'B', 'C', 'end']);
    });

    it('handles empty original lines', () => {
        const result = applyInsertion([], 1, 0, 'new text');
        expect(result).toEqual(['new text']);
    });

    it('handles empty original lines with multi-line insert', () => {
        const result = applyInsertion([], 1, 0, 'line1\nline2');
        expect(result).toEqual(['line1', 'line2']);
    });

    it('clamps line number to valid range', () => {
        const result = applyInsertion(['only'], 99, 0, 'X');
        expect(result).toEqual(['Xonly']);
    });

    it('clamps column to line length', () => {
        const result = applyInsertion(['ab'], 1, 100, 'c');
        expect(result).toEqual(['abc']);
    });

    it('preserves other lines when inserting in multi-line content', () => {
        const result = applyInsertion(['line1', 'line2', 'line3'], 2, 4, ' modified');
        expect(result).toEqual(['line1', 'line modified2', 'line3']);
    });

    it('inserts newline-only text to split a line', () => {
        const result = applyInsertion(['abcd'], 1, 2, '\n');
        expect(result).toEqual(['ab', 'cd']);
    });
});

// ===========================================================================
// applyDeletion
// ===========================================================================
describe('applyDeletion', () => {
    it('removes characters within same line', () => {
        const result = applyDeletion(['hello world'], 1, 5, 1, 11);
        expect(result).toEqual(['hello']);
    });

    it('removes from start of line', () => {
        const result = applyDeletion(['hello'], 1, 0, 1, 3);
        expect(result).toEqual(['lo']);
    });

    it('removes entire line content', () => {
        const result = applyDeletion(['hello'], 1, 0, 1, 5);
        expect(result).toEqual(['']);
    });

    it('merges lines when deletion spans line boundary', () => {
        const result = applyDeletion(['first', 'second'], 1, 3, 2, 3);
        expect(result).toEqual(['firond']);
    });

    it('removes intermediate lines in multi-line deletion', () => {
        const result = applyDeletion(['line1', 'line2', 'line3', 'line4'], 1, 3, 4, 2);
        expect(result).toEqual(['linne4']);
    });

    it('handles empty input', () => {
        const result = applyDeletion([], 1, 0, 1, 5);
        expect(result).toEqual([]);
    });

    it('clamps positions to valid range', () => {
        const result = applyDeletion(['ab'], 1, 0, 1, 100);
        expect(result).toEqual(['']);
    });

    it('preserves content before and after deletion', () => {
        const result = applyDeletion(['abcdefgh'], 1, 2, 1, 6);
        expect(result).toEqual(['abgh']);
    });

    it('handles single-character deletion', () => {
        const result = applyDeletion(['abcdef'], 1, 2, 1, 3);
        expect(result).toEqual(['abdef']);
    });

    it('handles cross-line deletion merging first and last', () => {
        const result = applyDeletion(['AAA', 'BBB', 'CCC'], 1, 1, 3, 2);
        expect(result).toEqual(['AC']);
    });
});

// ===========================================================================
// getTotalCharacterCount
// ===========================================================================
describe('getTotalCharacterCount', () => {
    it('counts characters plus newlines', () => {
        expect(getTotalCharacterCount(['abc', 'de'])).toBe(6); // 3 + 2 + 1 newline
    });

    it('handles single line', () => {
        expect(getTotalCharacterCount(['hello'])).toBe(5);
    });

    it('handles empty lines', () => {
        expect(getTotalCharacterCount(['', ''])).toBe(1); // 0 + 0 + 1 newline
    });

    it('handles empty array', () => {
        expect(getTotalCharacterCount([])).toBe(0);
    });
});

// ===========================================================================
// positionToOffset / offsetToPosition roundtrip
// ===========================================================================
describe('positionToOffset', () => {
    const lines = ['hello', 'world', 'foo'];

    it('returns 0 for line 1, column 0', () => {
        expect(positionToOffset(lines, 1, 0)).toBe(0);
    });

    it('returns correct offset within first line', () => {
        expect(positionToOffset(lines, 1, 3)).toBe(3);
    });

    it('returns correct offset at start of second line', () => {
        // 'hello' (5) + newline (1) = 6
        expect(positionToOffset(lines, 2, 0)).toBe(6);
    });

    it('returns correct offset within second line', () => {
        expect(positionToOffset(lines, 2, 3)).toBe(9);
    });

    it('returns correct offset at start of third line', () => {
        // 5 + 1 + 5 + 1 = 12
        expect(positionToOffset(lines, 3, 0)).toBe(12);
    });

    it('clamps column to line length', () => {
        expect(positionToOffset(lines, 1, 100)).toBe(5);
    });
});

describe('offsetToPosition', () => {
    const lines = ['hello', 'world', 'foo'];

    it('returns line 1 col 0 for offset 0', () => {
        expect(offsetToPosition(lines, 0)).toEqual({ line: 1, column: 0 });
    });

    it('returns correct position within first line', () => {
        expect(offsetToPosition(lines, 3)).toEqual({ line: 1, column: 3 });
    });

    it('returns start of second line for offset 6', () => {
        expect(offsetToPosition(lines, 6)).toEqual({ line: 2, column: 0 });
    });

    it('returns correct position within second line', () => {
        expect(offsetToPosition(lines, 9)).toEqual({ line: 2, column: 3 });
    });

    it('returns end position for offset beyond content', () => {
        expect(offsetToPosition(lines, 999)).toEqual({ line: 3, column: 3 });
    });

    it('handles empty lines array', () => {
        expect(offsetToPosition([], 5)).toEqual({ line: 1, column: 0 });
    });
});

describe('positionToOffset / offsetToPosition roundtrip', () => {
    const lines = ['hello', 'world', 'foo bar'];

    it('roundtrips for every valid position', () => {
        for (let line = 1; line <= lines.length; line++) {
            for (let col = 0; col <= lines[line - 1].length; col++) {
                const offset = positionToOffset(lines, line, col);
                const pos = offsetToPosition(lines, offset);
                expect(pos).toEqual({ line, column: col });
            }
        }
    });

    it('roundtrips through offsets', () => {
        const total = getTotalCharacterCount(lines);
        for (let offset = 0; offset <= total; offset++) {
            const pos = offsetToPosition(lines, offset);
            const rt = positionToOffset(lines, pos.line, pos.column);
            expect(rt).toBe(offset);
        }
    });
});

// ===========================================================================
// Integration: insertion then deletion roundtrip
// ===========================================================================
describe('applyInsertion + applyDeletion roundtrip', () => {
    it('inserting then deleting same text restores original', () => {
        const original = ['hello world'];
        const inserted = applyInsertion(original, 1, 5, ' beautiful');
        expect(inserted).toEqual(['hello beautiful world']);
        const restored = applyDeletion(inserted, 1, 5, 1, 15);
        expect(restored).toEqual(['hello world']);
    });

    it('multi-line insert then delete restores original', () => {
        const original = ['AB'];
        const inserted = applyInsertion(original, 1, 1, 'X\nY\nZ');
        expect(inserted).toEqual(['AX', 'Y', 'ZB']);
        const restored = applyDeletion(inserted, 1, 1, 3, 1);
        expect(restored).toEqual(['AB']);
    });
});
