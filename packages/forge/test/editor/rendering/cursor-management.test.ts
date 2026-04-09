import { describe, it, expect } from 'vitest';
import {
    MockNode,
    NODE_TYPES,
    CursorPosition,
    calculateColumnOffset,
    findLineElement,
    getLineNumber,
    findTextNodeAtColumn,
    getCursorPositionFromSelection,
    adjustCursorAfterInsertion,
    adjustCursorAfterDeletion,
    validateCursorPosition,
    compareCursorPositions,
    isCursorInRange,
    restoreCursorAfterContentChange
} from '../../../src/editor/rendering/cursor-management';

// ---------- MockNode helpers ----------

function textNode(text: string, parent: MockNode | null = null): MockNode {
    const node: MockNode = {
        nodeType: NODE_TYPES.TEXT_NODE,
        textContent: text,
        parentNode: parent,
        childNodes: [],
        length: text.length
    };
    return node;
}

function elementNode(
    opts: {
        tagName?: string;
        classes?: string[];
        attrs?: Record<string, string>;
        parent?: MockNode | null;
    } = {}
): MockNode {
    const { tagName = 'SPAN', classes = [], attrs = {}, parent = null } = opts;
    const node: MockNode = {
        nodeType: NODE_TYPES.ELEMENT_NODE,
        textContent: '',
        parentNode: parent,
        childNodes: [],
        tagName,
        classList: { contains: (cls: string) => classes.includes(cls) },
        getAttribute: (attr: string) => attrs[attr] ?? null,
        hasAttribute: (attr: string) => attr in attrs
    };
    return node;
}

/** Append children to a parent and set parentNode back-links. */
function append(parent: MockNode, ...children: MockNode[]): MockNode {
    for (const child of children) {
        child.parentNode = parent;
        parent.childNodes.push(child);
    }
    return parent;
}

/**
 * Build a typical line element:
 *   <div class="line-content" data-line="N"> ...children </div>
 */
function lineEl(lineNum: number, ...children: MockNode[]): MockNode {
    const el = elementNode({
        tagName: 'DIV',
        classes: ['line-content'],
        attrs: { 'data-line': String(lineNum) }
    });
    return append(el, ...children);
}

// ---------- Tests ----------

describe('calculateColumnOffset', () => {
    it('returns 0 when target is the first text node with offset 0', () => {
        const t = textNode('hello');
        const line = lineEl(1, t);
        expect(calculateColumnOffset(line, t, 0)).toBe(0);
    });

    it('returns targetOffset within the first text node', () => {
        const t = textNode('hello');
        const line = lineEl(1, t);
        expect(calculateColumnOffset(line, t, 3)).toBe(3);
    });

    it('sums lengths of preceding text nodes', () => {
        const t1 = textNode('abc');
        const t2 = textNode('de');
        const target = textNode('fgh');
        const line = lineEl(1, t1, t2, target);
        // offset should be len('abc') + len('de') + targetOffset
        expect(calculateColumnOffset(line, target, 1)).toBe(6); // 3+2+1
    });

    it('handles nested elements', () => {
        const t1 = textNode('ab');
        const span = elementNode({ tagName: 'SPAN' });
        const inner = textNode('cd');
        append(span, inner);
        const target = textNode('ef');
        const line = lineEl(1, t1, span, target);

        expect(calculateColumnOffset(line, target, 1)).toBe(5); // 2+2+1
    });

    it('skips elements with matching skip classes', () => {
        const t1 = textNode('ab');
        const bubble = elementNode({ classes: ['inline-comment-bubble'] });
        append(bubble, textNode('IGNORED'));
        const target = textNode('cd');
        const line = lineEl(1, t1, bubble, target);

        expect(calculateColumnOffset(line, target, 1)).toBe(3); // 2+1, bubble skipped
    });

    it('skips gutter-icon class', () => {
        const gutter = elementNode({ classes: ['gutter-icon'] });
        append(gutter, textNode('XX'));
        const target = textNode('hi');
        const line = lineEl(1, gutter, target);

        expect(calculateColumnOffset(line, target, 2)).toBe(2);
    });

    it('supports custom skipClasses parameter', () => {
        const custom = elementNode({ classes: ['my-skip'] });
        append(custom, textNode('SKP'));
        const target = textNode('ok');
        const line = lineEl(1, custom, target);

        // default skipClasses would NOT skip 'my-skip', so it counts
        expect(calculateColumnOffset(line, target, 0, [])).toBe(3); // includes 'SKP'
        expect(calculateColumnOffset(line, target, 0, ['my-skip'])).toBe(0); // skipped
    });

    it('handles empty text nodes', () => {
        const empty = textNode('');
        const target = textNode('abc');
        const line = lineEl(1, empty, target);
        expect(calculateColumnOffset(line, target, 2)).toBe(2);
    });

    it('returns 0 when target is the line element itself', () => {
        const t = textNode('hello');
        const line = lineEl(1, t);
        expect(calculateColumnOffset(line, line, 0)).toBe(0);
    });

    it('handles target node with null textContent', () => {
        const t: MockNode = {
            nodeType: NODE_TYPES.TEXT_NODE,
            textContent: null,
            parentNode: null,
            childNodes: []
        };
        const other = textNode('ab');
        const line = lineEl(1, other, t);
        // null text content contributes 0 length
        expect(calculateColumnOffset(line, t, 0)).toBe(2);
    });
});

describe('findLineElement', () => {
    it('returns the line element when node is a direct child', () => {
        const t = textNode('x');
        const line = lineEl(1, t);
        const editor = elementNode({ tagName: 'DIV' });
        append(editor, line);

        expect(findLineElement(t, editor)).toBe(line);
    });

    it('returns the line element when node is deeply nested', () => {
        const t = textNode('x');
        const span = elementNode({ tagName: 'SPAN' });
        append(span, t);
        const line = lineEl(3, span);
        const editor = elementNode({ tagName: 'DIV' });
        append(editor, line);

        expect(findLineElement(t, editor)).toBe(line);
    });

    it('returns null when node is outside any line element', () => {
        const t = textNode('orphan');
        const editor = elementNode({ tagName: 'DIV' });
        append(editor, t);

        expect(findLineElement(t, editor)).toBeNull();
    });

    it('returns null when node is the editor element itself', () => {
        const editor = elementNode({ tagName: 'DIV' });
        expect(findLineElement(editor, editor)).toBeNull();
    });

    it('returns null when parentNode chain is null', () => {
        const t = textNode('detached');
        const editor = elementNode({ tagName: 'DIV' });
        expect(findLineElement(t, editor)).toBeNull();
    });

    it('finds the nearest line-content ancestor (not an outer one)', () => {
        const t = textNode('x');
        const innerLine = lineEl(2, t);
        const outerLine = lineEl(1, innerLine);
        const editor = elementNode({ tagName: 'DIV' });
        append(editor, outerLine);

        expect(findLineElement(t, editor)).toBe(innerLine);
    });
});

describe('getLineNumber', () => {
    it('returns the line number from data-line attribute', () => {
        const el = elementNode({ attrs: { 'data-line': '5' } });
        expect(getLineNumber(el)).toBe(5);
    });

    it('returns null when data-line is missing', () => {
        const el = elementNode({});
        expect(getLineNumber(el)).toBeNull();
    });

    it('returns null when data-line is not a number', () => {
        const el = elementNode({ attrs: { 'data-line': 'abc' } });
        expect(getLineNumber(el)).toBeNull();
    });

    it('returns null when getAttribute is not defined', () => {
        const el: MockNode = {
            nodeType: NODE_TYPES.ELEMENT_NODE,
            textContent: '',
            parentNode: null,
            childNodes: []
        };
        expect(getLineNumber(el)).toBeNull();
    });

    it('handles line number 0', () => {
        const el = elementNode({ attrs: { 'data-line': '0' } });
        expect(getLineNumber(el)).toBe(0);
    });

    it('handles negative line numbers', () => {
        const el = elementNode({ attrs: { 'data-line': '-1' } });
        expect(getLineNumber(el)).toBe(-1);
    });
});

describe('findTextNodeAtColumn', () => {
    it('finds the correct text node for column 0', () => {
        const t = textNode('hello');
        const line = lineEl(1, t);
        const result = findTextNodeAtColumn(line, 0);
        expect(result).toEqual({ node: t, offset: 0 });
    });

    it('finds the correct offset within a single text node', () => {
        const t = textNode('hello');
        const line = lineEl(1, t);
        const result = findTextNodeAtColumn(line, 3);
        expect(result).toEqual({ node: t, offset: 3 });
    });

    it('finds text node across multiple nodes', () => {
        const t1 = textNode('abc');
        const t2 = textNode('def');
        const line = lineEl(1, t1, t2);

        // column 4 → second text node, offset 1 (3+1)
        const result = findTextNodeAtColumn(line, 4);
        expect(result).toEqual({ node: t2, offset: 1 });
    });

    it('returns boundary of first node when column equals its length', () => {
        const t1 = textNode('abc');
        const t2 = textNode('def');
        const line = lineEl(1, t1, t2);

        // column 3 → end of first node
        const result = findTextNodeAtColumn(line, 3);
        expect(result).toEqual({ node: t1, offset: 3 });
    });

    it('returns last text node at its end when column exceeds content', () => {
        const t = textNode('ab');
        const line = lineEl(1, t);
        const result = findTextNodeAtColumn(line, 100);
        expect(result).toEqual({ node: t, offset: 2 });
    });

    it('skips elements with skip classes', () => {
        const t1 = textNode('ab');
        const bubble = elementNode({ classes: ['inline-comment-bubble'] });
        append(bubble, textNode('SKIP'));
        const t2 = textNode('cd');
        const line = lineEl(1, t1, bubble, t2);

        // column 3 → should be t2 offset 1 (bubble skipped)
        const result = findTextNodeAtColumn(line, 3);
        expect(result).toEqual({ node: t2, offset: 1 });
    });

    it('handles nested elements', () => {
        const span = elementNode({ tagName: 'SPAN' });
        const inner = textNode('abc');
        append(span, inner);
        const line = lineEl(1, span);

        const result = findTextNodeAtColumn(line, 2);
        expect(result).toEqual({ node: inner, offset: 2 });
    });

    it('returns null when line has no text nodes', () => {
        const line = lineEl(1);
        const result = findTextNodeAtColumn(line, 0);
        expect(result).toBeNull();
    });

    it('handles empty text nodes correctly', () => {
        const empty = textNode('');
        const t = textNode('abc');
        const line = lineEl(1, empty, t);

        const result = findTextNodeAtColumn(line, 1);
        expect(result).toEqual({ node: t, offset: 1 });
    });
});

describe('getCursorPositionFromSelection', () => {
    function buildEditor(lines: { lineNum: number; text: string }[]): {
        editor: MockNode;
        textNodes: MockNode[];
    } {
        const editor = elementNode({ tagName: 'DIV', classes: ['editor'] });
        const textNodes: MockNode[] = [];
        for (const { lineNum, text } of lines) {
            const t = textNode(text);
            const line = lineEl(lineNum, t);
            append(editor, line);
            textNodes.push(t);
        }
        return { editor, textNodes };
    }

    it('returns correct position for cursor in first line', () => {
        const { editor, textNodes } = buildEditor([{ lineNum: 1, text: 'hello' }]);
        const result = getCursorPositionFromSelection(textNodes[0], 3, editor);
        expect(result).toEqual({ line: 1, column: 3 });
    });

    it('returns correct position for cursor in second line', () => {
        const { editor, textNodes } = buildEditor([
            { lineNum: 1, text: 'hello' },
            { lineNum: 2, text: 'world' }
        ]);
        const result = getCursorPositionFromSelection(textNodes[1], 2, editor);
        expect(result).toEqual({ line: 2, column: 2 });
    });

    it('returns null when cursor is outside any line element', () => {
        const editor = elementNode({ tagName: 'DIV' });
        const orphan = textNode('lost');
        append(editor, orphan);
        expect(getCursorPositionFromSelection(orphan, 0, editor)).toBeNull();
    });

    it('returns null when line element has no data-line', () => {
        const editor = elementNode({ tagName: 'DIV' });
        const badLine = elementNode({
            tagName: 'DIV',
            classes: ['line-content']
            // no data-line attribute
        });
        const t = textNode('abc');
        append(badLine, t);
        append(editor, badLine);
        expect(getCursorPositionFromSelection(t, 0, editor)).toBeNull();
    });
});

describe('adjustCursorAfterInsertion', () => {
    it('does nothing when insertion is on a later line', () => {
        const cursor: CursorPosition = { line: 1, column: 5 };
        const result = adjustCursorAfterInsertion(cursor, 2, 0, ['text']);
        expect(result).toEqual({ line: 1, column: 5 });
    });

    it('does nothing when insertion is after cursor on the same line', () => {
        const cursor: CursorPosition = { line: 1, column: 3 };
        const result = adjustCursorAfterInsertion(cursor, 1, 5, ['text']);
        expect(result).toEqual({ line: 1, column: 3 });
    });

    it('shifts column right for single-line insert before cursor on same line', () => {
        const cursor: CursorPosition = { line: 1, column: 5 };
        const result = adjustCursorAfterInsertion(cursor, 1, 2, ['abc']);
        expect(result.line).toBe(1);
        expect(result.column).toBe(8); // 5 + 3
    });

    it('shifts line number for insertion on a previous line', () => {
        const cursor: CursorPosition = { line: 3, column: 5 };
        const result = adjustCursorAfterInsertion(cursor, 1, 0, ['a', 'b', 'c']);
        // 2 new lines inserted before cursor's line
        expect(result).toEqual({ line: 5, column: 5 });
    });

    it('handles multi-line insertion on the same line before cursor', () => {
        const cursor: CursorPosition = { line: 1, column: 10 };
        // Insert "X\nYY" at column 3
        const result = adjustCursorAfterInsertion(cursor, 1, 3, ['X', 'YY']);
        // numNewLines = 1, lastLineLength = 2
        // remainingColumn = 10 - 3 = 7
        // new line = 1 + 1 = 2, new column = 2 + 7 = 9
        expect(result).toEqual({ line: 2, column: 9 });
    });

    it('handles single-line insert at cursor column (insertion exactly at cursor)', () => {
        const cursor: CursorPosition = { line: 1, column: 5 };
        const result = adjustCursorAfterInsertion(cursor, 1, 5, ['XX']);
        // insertColumn === cursor.column, so insertion is "at" cursor
        expect(result).toEqual({ line: 1, column: 7 }); // 5 + 2
    });

    it('handles empty single-line insertion', () => {
        const cursor: CursorPosition = { line: 1, column: 5 };
        const result = adjustCursorAfterInsertion(cursor, 1, 2, ['']);
        expect(result).toEqual({ line: 1, column: 5 }); // '' has length 0
    });

    it('handles multi-line insert on previous line with multiple new lines', () => {
        const cursor: CursorPosition = { line: 2, column: 3 };
        const result = adjustCursorAfterInsertion(cursor, 1, 0, ['a', 'b', 'c', 'd']);
        // 3 new lines, cursor was on line 2 → line 5
        expect(result).toEqual({ line: 5, column: 3 });
    });
});

describe('adjustCursorAfterDeletion', () => {
    it('does nothing when deletion is entirely after cursor', () => {
        const cursor: CursorPosition = { line: 1, column: 2 };
        const result = adjustCursorAfterDeletion(cursor, 1, 5, 1, 10);
        expect(result).toEqual({ line: 1, column: 2 });
    });

    it('does nothing when deletion is on a later line', () => {
        const cursor: CursorPosition = { line: 1, column: 5 };
        const result = adjustCursorAfterDeletion(cursor, 2, 0, 2, 5);
        expect(result).toEqual({ line: 1, column: 5 });
    });

    it('moves cursor to deletion start when cursor is inside deletion range', () => {
        const cursor: CursorPosition = { line: 1, column: 5 };
        const result = adjustCursorAfterDeletion(cursor, 1, 3, 1, 8);
        expect(result).toEqual({ line: 1, column: 3 });
    });

    it('moves cursor to deletion start when cursor is at deletion start', () => {
        const cursor: CursorPosition = { line: 1, column: 3 };
        const result = adjustCursorAfterDeletion(cursor, 1, 3, 1, 8);
        expect(result).toEqual({ line: 1, column: 3 });
    });

    it('moves cursor to deletion start when cursor is at deletion end', () => {
        const cursor: CursorPosition = { line: 1, column: 8 };
        const result = adjustCursorAfterDeletion(cursor, 1, 3, 1, 8);
        expect(result).toEqual({ line: 1, column: 3 });
    });

    it('shifts cursor left for same-line deletion before cursor', () => {
        const cursor: CursorPosition = { line: 1, column: 10 };
        // Delete columns 2-5 on line 1
        const result = adjustCursorAfterDeletion(cursor, 1, 2, 1, 5);
        // cursor on same line as end: deleteStartColumn + (cursor.column - deleteEndColumn) = 2 + (10-5) = 7
        expect(result).toEqual({ line: 1, column: 7 });
    });

    it('shifts line number down for multi-line deletion before cursor', () => {
        const cursor: CursorPosition = { line: 5, column: 3 };
        // Delete lines 2-3
        const result = adjustCursorAfterDeletion(cursor, 2, 0, 3, 5);
        // deletedLines = 1, cursor on later line → line 5-1=4
        expect(result).toEqual({ line: 4, column: 3 });
    });

    it('handles cross-line deletion with cursor on the end line', () => {
        const cursor: CursorPosition = { line: 3, column: 8 };
        // Delete from line 2 col 5 to line 3 col 3
        const result = adjustCursorAfterDeletion(cursor, 2, 5, 3, 3);
        // cursor.line === deleteEndLine: line→deleteStartLine, col→5+(8-3)=10
        expect(result).toEqual({ line: 2, column: 10 });
    });

    it('handles cursor inside multi-line deletion range', () => {
        const cursor: CursorPosition = { line: 3, column: 2 };
        // Delete from line 2 col 0 to line 4 col 5
        const result = adjustCursorAfterDeletion(cursor, 2, 0, 4, 5);
        expect(result).toEqual({ line: 2, column: 0 });
    });

    it('does nothing when cursor is strictly before deletion on same line', () => {
        const cursor: CursorPosition = { line: 1, column: 1 };
        const result = adjustCursorAfterDeletion(cursor, 1, 3, 1, 8);
        expect(result).toEqual({ line: 1, column: 1 });
    });
});

describe('validateCursorPosition', () => {
    it('returns {line:1, column:0} for empty content', () => {
        expect(validateCursorPosition({ line: 5, column: 10 }, [])).toEqual({
            line: 1,
            column: 0
        });
    });

    it('clamps line to 1 when too low', () => {
        const result = validateCursorPosition({ line: 0, column: 0 }, ['abc']);
        expect(result.line).toBe(1);
    });

    it('clamps line to last line when too high', () => {
        const result = validateCursorPosition({ line: 10, column: 0 }, ['abc', 'def']);
        expect(result.line).toBe(2);
    });

    it('clamps column to 0 when negative', () => {
        const result = validateCursorPosition({ line: 1, column: -5 }, ['abc']);
        expect(result.column).toBe(0);
    });

    it('clamps column to line length when too high', () => {
        const result = validateCursorPosition({ line: 1, column: 100 }, ['abc']);
        expect(result.column).toBe(3);
    });

    it('passes through valid position unchanged', () => {
        const result = validateCursorPosition({ line: 2, column: 2 }, ['abc', 'defg']);
        expect(result).toEqual({ line: 2, column: 2 });
    });

    it('handles empty line correctly', () => {
        const result = validateCursorPosition({ line: 2, column: 5 }, ['abc', '', 'def']);
        expect(result).toEqual({ line: 2, column: 0 });
    });
});

describe('compareCursorPositions', () => {
    it('returns negative when a is before b (different lines)', () => {
        expect(compareCursorPositions({ line: 1, column: 5 }, { line: 2, column: 0 })).toBeLessThan(0);
    });

    it('returns positive when a is after b (different lines)', () => {
        expect(compareCursorPositions({ line: 3, column: 0 }, { line: 1, column: 5 })).toBeGreaterThan(0);
    });

    it('returns negative when a is before b (same line)', () => {
        expect(compareCursorPositions({ line: 1, column: 2 }, { line: 1, column: 5 })).toBeLessThan(0);
    });

    it('returns positive when a is after b (same line)', () => {
        expect(compareCursorPositions({ line: 1, column: 5 }, { line: 1, column: 2 })).toBeGreaterThan(0);
    });

    it('returns 0 for equal positions', () => {
        expect(compareCursorPositions({ line: 3, column: 7 }, { line: 3, column: 7 })).toBe(0);
    });
});

describe('isCursorInRange', () => {
    it('returns true when cursor is inside the range', () => {
        expect(isCursorInRange({ line: 2, column: 3 }, 1, 0, 3, 10)).toBe(true);
    });

    it('returns true when cursor is at the start boundary', () => {
        expect(isCursorInRange({ line: 1, column: 0 }, 1, 0, 3, 10)).toBe(true);
    });

    it('returns true when cursor is at the end boundary', () => {
        expect(isCursorInRange({ line: 3, column: 10 }, 1, 0, 3, 10)).toBe(true);
    });

    it('returns false when cursor is before the range', () => {
        expect(isCursorInRange({ line: 1, column: 0 }, 1, 5, 3, 10)).toBe(false);
    });

    it('returns false when cursor is after the range', () => {
        expect(isCursorInRange({ line: 4, column: 0 }, 1, 0, 3, 10)).toBe(false);
    });

    it('returns true for single-point range matching cursor', () => {
        expect(isCursorInRange({ line: 2, column: 5 }, 2, 5, 2, 5)).toBe(true);
    });

    it('returns false when cursor is one column before range start on same line', () => {
        expect(isCursorInRange({ line: 1, column: 4 }, 1, 5, 1, 10)).toBe(false);
    });

    it('returns false when cursor is one column after range end on same line', () => {
        expect(isCursorInRange({ line: 1, column: 11 }, 1, 5, 1, 10)).toBe(false);
    });
});

describe('restoreCursorAfterContentChange', () => {
    it('returns {line:1, column:0} for empty content', () => {
        expect(restoreCursorAfterContentChange({ line: 3, column: 5 }, [])).toEqual({
            line: 1,
            column: 0
        });
    });

    it('clamps to valid column on existing line', () => {
        const result = restoreCursorAfterContentChange({ line: 1, column: 100 }, ['abc']);
        expect(result).toEqual({ line: 1, column: 3 });
    });

    it('passes through valid cursor unchanged', () => {
        const result = restoreCursorAfterContentChange({ line: 2, column: 2 }, ['abc', 'defg']);
        expect(result).toEqual({ line: 2, column: 2 });
    });

    it('clamps line when cursor line exceeds content length', () => {
        const result = restoreCursorAfterContentChange({ line: 5, column: 0 }, ['abc', 'def']);
        expect(result.line).toBe(2);
    });

    it('handles undo-newline: uses prevLineLength to compute column', () => {
        // Scenario: "A|B" was split to "A\nB", cursor at line 2 col 0
        // Undo → "AB" (1 line). Cursor should go to col 1 (after "A").
        const result = restoreCursorAfterContentChange(
            { line: 2, column: 0 },
            ['AB'],
            1 // prevLineLength = len("A")
        );
        expect(result).toEqual({ line: 1, column: 1 });
    });

    it('handles undo-newline with cursor offset on second line', () => {
        // "Hello\nWorld" → cursor at line 2, col 3 ("Wor|ld")
        // Undo → "HelloWorld" (1 line)
        // prevLineLength = 5, cursor.column = 3 → new col = 5 + 3 = 8
        const result = restoreCursorAfterContentChange(
            { line: 2, column: 3 },
            ['HelloWorld'],
            5
        );
        expect(result).toEqual({ line: 1, column: 8 });
    });

    it('clamps restored column to line length when prevLineLength + column overshoots', () => {
        // prevLineLength=10, cursor.column=5 → 15, but line only has 12 chars
        const result = restoreCursorAfterContentChange(
            { line: 3, column: 5 },
            ['abc', 'defghijklmno'], // line 2 has 12 chars
            10
        );
        expect(result).toEqual({ line: 2, column: 12 });
    });

    it('handles negative cursor column by clamping to 0', () => {
        const result = restoreCursorAfterContentChange({ line: 1, column: -3 }, ['abc']);
        expect(result).toEqual({ line: 1, column: 0 });
    });

    it('handles line that exists with column at end', () => {
        const result = restoreCursorAfterContentChange({ line: 1, column: 3 }, ['abc']);
        expect(result).toEqual({ line: 1, column: 3 });
    });
});
