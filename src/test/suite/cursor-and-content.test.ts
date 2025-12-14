/**
 * Comprehensive tests for cursor management and content extraction
 * 
 * These tests simulate actual editing scenarios with mock DOM structures
 * to verify that cursor positions are correctly calculated and updated
 * when content is inserted at various positions.
 */

import * as assert from 'assert';
import {
    CursorPosition,
    MockNode,
    NODE_TYPES,
    adjustCursorAfterDeletion,
    adjustCursorAfterInsertion,
    calculateColumnOffset,
    compareCursorPositions,
    findLineElement,
    findTextNodeAtColumn,
    getLineNumber,
    isCursorInRange,
    validateCursorPosition
} from '../../shortcuts/markdown-comments/webview-logic/cursor-management';

import {
    applyDeletion,
    applyInsertion,
    extractPlainTextContent,
    offsetToPosition,
    positionToOffset
} from '../../shortcuts/markdown-comments/webview-logic/content-extraction';

/**
 * Helper to create mock text nodes
 */
function createTextNode(text: string, parent: MockNode | null = null): MockNode {
    const node: MockNode = {
        nodeType: NODE_TYPES.TEXT_NODE,
        textContent: text,
        parentNode: parent,
        childNodes: [],
        length: text.length
    };
    return node;
}

/**
 * Helper to create mock element nodes
 */
function createElementNode(
    tagName: string,
    children: MockNode[] = [],
    classNames: string[] = [],
    attributes: Record<string, string> = {},
    parent: MockNode | null = null
): MockNode {
    const node: MockNode = {
        nodeType: NODE_TYPES.ELEMENT_NODE,
        tagName: tagName.toUpperCase(),
        textContent: children.map(c => c.textContent || '').join(''),
        childNodes: children,
        parentNode: parent,
        classList: {
            contains: (className: string) => classNames.includes(className)
        },
        hasAttribute: (attr: string) => attr in attributes,
        getAttribute: (attr: string) => attributes[attr] || null
    };

    // Update parent references for children
    children.forEach(child => {
        child.parentNode = node;
    });

    return node;
}

/**
 * Create a complete line structure like what the editor renders
 */
function createLineRow(lineNum: number, content: string): MockNode {
    const textNode = createTextNode(content);
    const lineContent = createElementNode(
        'div',
        [textNode],
        ['line-content'],
        { 'data-line': String(lineNum) }
    );
    const lineNumber = createElementNode('div', [], ['line-number']);
    const lineRow = createElementNode('div', [lineNumber, lineContent], ['line-row']);
    return lineRow;
}

/**
 * Create an editor wrapper with multiple lines
 */
function createEditorWrapper(lines: string[]): MockNode {
    const lineRows = lines.map((line, idx) => createLineRow(idx + 1, line));
    return createElementNode('div', lineRows, ['editor-wrapper']);
}

suite('Cursor Management Tests', () => {

    suite('calculateColumnOffset', () => {
        test('should calculate offset for simple text node', () => {
            const textNode = createTextNode('Hello World');
            const lineContent = createElementNode('div', [textNode], ['line-content'], { 'data-line': '1' });

            const offset = calculateColumnOffset(lineContent, textNode, 5);
            assert.strictEqual(offset, 5);
        });

        test('should calculate offset for nested elements', () => {
            const text1 = createTextNode('Hello ');
            const boldText = createTextNode('World');
            const bold = createElementNode('b', [boldText]);
            const lineContent = createElementNode('div', [text1, bold], ['line-content'], { 'data-line': '1' });

            // Cursor is in the bold text, at position 3 ('Wor|ld')
            const offset = calculateColumnOffset(lineContent, boldText, 3);
            assert.strictEqual(offset, 6 + 3); // 'Hello ' + 'Wor' = 9
        });

        test('should skip comment bubble elements', () => {
            const text = createTextNode('Hello ');
            const bubbleText = createTextNode('comment');
            const bubble = createElementNode('div', [bubbleText], ['inline-comment-bubble']);
            const afterText = createTextNode('World');
            const lineContent = createElementNode('div', [text, bubble, afterText], ['line-content'], { 'data-line': '1' });

            // Cursor is in afterText at position 2 ('Wo|rld')
            const offset = calculateColumnOffset(lineContent, afterText, 2);
            // Should be 6 (Hello ) + 2 (Wo) = 8, NOT including bubble content
            assert.strictEqual(offset, 8);
        });

        test('should handle cursor at start of line', () => {
            const textNode = createTextNode('Hello');
            const lineContent = createElementNode('div', [textNode], ['line-content'], { 'data-line': '1' });

            const offset = calculateColumnOffset(lineContent, textNode, 0);
            assert.strictEqual(offset, 0);
        });

        test('should handle cursor at end of line', () => {
            const textNode = createTextNode('Hello');
            const lineContent = createElementNode('div', [textNode], ['line-content'], { 'data-line': '1' });

            const offset = calculateColumnOffset(lineContent, textNode, 5);
            assert.strictEqual(offset, 5);
        });

        test('should handle multiple text nodes', () => {
            const text1 = createTextNode('One');
            const text2 = createTextNode('Two');
            const text3 = createTextNode('Three');
            const lineContent = createElementNode('div', [text1, text2, text3], ['line-content'], { 'data-line': '1' });

            // Cursor in text3 at position 2
            const offset = calculateColumnOffset(lineContent, text3, 2);
            assert.strictEqual(offset, 3 + 3 + 2); // 'One' + 'Two' + 'Th' = 8
        });
    });

    suite('findLineElement', () => {
        test('should find line-content element', () => {
            const textNode = createTextNode('Hello');
            const lineContent = createElementNode('div', [textNode], ['line-content'], { 'data-line': '5' });
            const editor = createElementNode('div', [lineContent], ['editor-wrapper']);

            const found = findLineElement(textNode, editor);
            assert.strictEqual(found, lineContent);
        });

        test('should find nested line-content', () => {
            const textNode = createTextNode('Hello');
            const span = createElementNode('span', [textNode]);
            const lineContent = createElementNode('div', [span], ['line-content'], { 'data-line': '3' });
            const lineRow = createElementNode('div', [lineContent], ['line-row']);
            const editor = createElementNode('div', [lineRow], ['editor-wrapper']);

            const found = findLineElement(textNode, editor);
            assert.strictEqual(found, lineContent);
        });

        test('should return null if no line-content found', () => {
            const textNode = createTextNode('Hello');
            const div = createElementNode('div', [textNode]);
            const editor = createElementNode('div', [div], ['editor-wrapper']);

            const found = findLineElement(textNode, editor);
            assert.strictEqual(found, null);
        });

        test('should return null if element has line-content class but no data-line', () => {
            const textNode = createTextNode('Hello');
            const lineContent = createElementNode('div', [textNode], ['line-content']);
            const editor = createElementNode('div', [lineContent], ['editor-wrapper']);

            const found = findLineElement(textNode, editor);
            assert.strictEqual(found, null);
        });
    });

    suite('getLineNumber', () => {
        test('should get line number from element', () => {
            const lineContent = createElementNode('div', [], ['line-content'], { 'data-line': '7' });
            assert.strictEqual(getLineNumber(lineContent), 7);
        });

        test('should return null for missing data-line', () => {
            const lineContent = createElementNode('div', [], ['line-content']);
            assert.strictEqual(getLineNumber(lineContent), null);
        });

        test('should return null for invalid line number', () => {
            const lineContent = createElementNode('div', [], ['line-content'], { 'data-line': 'abc' });
            assert.strictEqual(getLineNumber(lineContent), null);
        });

        test('should handle line number 1', () => {
            const lineContent = createElementNode('div', [], ['line-content'], { 'data-line': '1' });
            assert.strictEqual(getLineNumber(lineContent), 1);
        });

        test('should handle large line numbers', () => {
            const lineContent = createElementNode('div', [], ['line-content'], { 'data-line': '9999' });
            assert.strictEqual(getLineNumber(lineContent), 9999);
        });
    });

    suite('findTextNodeAtColumn', () => {
        test('should find text node at column within single node', () => {
            const textNode = createTextNode('Hello World');
            const lineContent = createElementNode('div', [textNode], ['line-content'], { 'data-line': '1' });

            const result = findTextNodeAtColumn(lineContent, 5);
            assert.ok(result);
            assert.strictEqual(result.node, textNode);
            assert.strictEqual(result.offset, 5);
        });

        test('should find text node in second text node', () => {
            const text1 = createTextNode('Hello');
            const text2 = createTextNode('World');
            const lineContent = createElementNode('div', [text1, text2], ['line-content'], { 'data-line': '1' });

            // Column 7 is in text2 ('Wo|rld')
            const result = findTextNodeAtColumn(lineContent, 7);
            assert.ok(result);
            assert.strictEqual(result.node, text2);
            assert.strictEqual(result.offset, 2);
        });

        test('should handle column at boundary', () => {
            const text1 = createTextNode('Hello');
            const text2 = createTextNode('World');
            const lineContent = createElementNode('div', [text1, text2], ['line-content'], { 'data-line': '1' });

            // Column 5 is at end of text1
            const result = findTextNodeAtColumn(lineContent, 5);
            assert.ok(result);
            assert.strictEqual(result.node, text1);
            assert.strictEqual(result.offset, 5);
        });

        test('should skip comment bubbles', () => {
            const text1 = createTextNode('Hello');
            const bubble = createElementNode('div', [createTextNode('bubble')], ['inline-comment-bubble']);
            const text2 = createTextNode('World');
            const lineContent = createElementNode('div', [text1, bubble, text2], ['line-content'], { 'data-line': '1' });

            // Column 7 should be in text2, ignoring bubble
            const result = findTextNodeAtColumn(lineContent, 7);
            assert.ok(result);
            assert.strictEqual(result.node, text2);
            assert.strictEqual(result.offset, 2);
        });

        test('should return null for empty line', () => {
            const lineContent = createElementNode('div', [], ['line-content'], { 'data-line': '1' });

            const result = findTextNodeAtColumn(lineContent, 5);
            assert.strictEqual(result, null);
        });

        test('should clamp offset to node length', () => {
            const textNode = createTextNode('Hi');
            const lineContent = createElementNode('div', [textNode], ['line-content'], { 'data-line': '1' });

            const result = findTextNodeAtColumn(lineContent, 10);
            assert.ok(result);
            assert.strictEqual(result.node, textNode);
            assert.strictEqual(result.offset, 2);
        });
    });

    suite('adjustCursorAfterInsertion', () => {
        test('should not adjust cursor when insertion is after cursor line', () => {
            const cursor: CursorPosition = { line: 3, column: 5 };
            const result = adjustCursorAfterInsertion(cursor, 5, 0, ['new text']);

            assert.deepStrictEqual(result, cursor);
        });

        test('should not adjust when insertion is after cursor on same line', () => {
            const cursor: CursorPosition = { line: 3, column: 5 };
            const result = adjustCursorAfterInsertion(cursor, 3, 10, ['text']);

            assert.deepStrictEqual(result, cursor);
        });

        test('should shift line number for insertion on previous line', () => {
            const cursor: CursorPosition = { line: 5, column: 10 };
            const result = adjustCursorAfterInsertion(cursor, 3, 0, ['line1', 'line2', 'line3']);

            // 3 lines inserted (2 new lines added), so cursor moves to line 7
            assert.strictEqual(result.line, 7);
            assert.strictEqual(result.column, 10);
        });

        test('should shift column for single-line insertion on same line before cursor', () => {
            const cursor: CursorPosition = { line: 3, column: 10 };
            const result = adjustCursorAfterInsertion(cursor, 3, 2, ['inserted']);

            // 'inserted' is 8 chars, cursor shifts right by 8
            assert.strictEqual(result.line, 3);
            assert.strictEqual(result.column, 18);
        });

        test('should handle multi-line insertion on same line before cursor', () => {
            const cursor: CursorPosition = { line: 3, column: 10 };
            const result = adjustCursorAfterInsertion(cursor, 3, 2, ['first', 'second', 'third']);

            // Insert at col 2: 'XX|XXXXXXXX' -> 'XXfirst\nsecond\nthird|XXXXXXXX'
            // New line: 3 + 2 = 5, column: 5 (length of 'third') + (10 - 2) = 13
            assert.strictEqual(result.line, 5);
            assert.strictEqual(result.column, 5 + 8);
        });

        test('should handle insertion at cursor position', () => {
            const cursor: CursorPosition = { line: 3, column: 5 };
            const result = adjustCursorAfterInsertion(cursor, 3, 5, ['text']);

            // Insertion at exact cursor position, cursor moves right
            assert.strictEqual(result.line, 3);
            assert.strictEqual(result.column, 9);
        });

        test('should handle empty insertion', () => {
            const cursor: CursorPosition = { line: 3, column: 5 };
            const result = adjustCursorAfterInsertion(cursor, 3, 2, ['']);

            assert.strictEqual(result.line, 3);
            assert.strictEqual(result.column, 5);
        });

        test('should handle insertion at start of line', () => {
            const cursor: CursorPosition = { line: 3, column: 5 };
            const result = adjustCursorAfterInsertion(cursor, 3, 0, ['prefix']);

            assert.strictEqual(result.line, 3);
            assert.strictEqual(result.column, 11); // 5 + 6 (length of 'prefix')
        });
    });

    suite('adjustCursorAfterDeletion', () => {
        test('should not adjust cursor before deletion', () => {
            const cursor: CursorPosition = { line: 2, column: 5 };
            const result = adjustCursorAfterDeletion(cursor, 4, 0, 4, 10);

            assert.deepStrictEqual(result, cursor);
        });

        test('should not adjust cursor before deletion on same line', () => {
            const cursor: CursorPosition = { line: 2, column: 3 };
            const result = adjustCursorAfterDeletion(cursor, 2, 5, 2, 10);

            assert.deepStrictEqual(result, cursor);
        });

        test('should move cursor to deletion start when inside range', () => {
            const cursor: CursorPosition = { line: 3, column: 5 };
            const result = adjustCursorAfterDeletion(cursor, 2, 3, 4, 7);

            assert.strictEqual(result.line, 2);
            assert.strictEqual(result.column, 3);
        });

        test('should adjust cursor on deletion end line', () => {
            const cursor: CursorPosition = { line: 4, column: 12 };
            const result = adjustCursorAfterDeletion(cursor, 2, 3, 4, 5);

            // Cursor is on end line, after deletion end
            // New position: line 2, col = 3 + (12 - 5) = 10
            assert.strictEqual(result.line, 2);
            assert.strictEqual(result.column, 10);
        });

        test('should shift cursor line for deletion on earlier lines', () => {
            const cursor: CursorPosition = { line: 10, column: 5 };
            const result = adjustCursorAfterDeletion(cursor, 3, 0, 5, 0);

            // 3 lines deleted (lines 3, 4, 5), cursor shifts from 10 to 7
            assert.strictEqual(result.line, 8);
            assert.strictEqual(result.column, 5);
        });

        test('should handle single character deletion before cursor', () => {
            const cursor: CursorPosition = { line: 3, column: 10 };
            const result = adjustCursorAfterDeletion(cursor, 3, 5, 3, 6);

            // Same line deletion, cursor shifts left by 1
            assert.strictEqual(result.line, 3);
            assert.strictEqual(result.column, 9);
        });
    });

    suite('validateCursorPosition', () => {
        test('should keep valid position unchanged', () => {
            const lines = ['Hello', 'World', 'Test'];
            const cursor: CursorPosition = { line: 2, column: 3 };
            const result = validateCursorPosition(cursor, lines);

            assert.deepStrictEqual(result, cursor);
        });

        test('should clamp line number to max', () => {
            const lines = ['Hello', 'World'];
            const cursor: CursorPosition = { line: 10, column: 0 };
            const result = validateCursorPosition(cursor, lines);

            assert.strictEqual(result.line, 2);
        });

        test('should clamp line number to min', () => {
            const lines = ['Hello', 'World'];
            const cursor: CursorPosition = { line: -1, column: 0 };
            const result = validateCursorPosition(cursor, lines);

            assert.strictEqual(result.line, 1);
        });

        test('should clamp column to line length', () => {
            const lines = ['Hi', 'World'];
            const cursor: CursorPosition = { line: 1, column: 10 };
            const result = validateCursorPosition(cursor, lines);

            assert.strictEqual(result.column, 2);
        });

        test('should clamp negative column to 0', () => {
            const lines = ['Hello'];
            const cursor: CursorPosition = { line: 1, column: -5 };
            const result = validateCursorPosition(cursor, lines);

            assert.strictEqual(result.column, 0);
        });

        test('should handle empty content', () => {
            const lines: string[] = [];
            const cursor: CursorPosition = { line: 5, column: 10 };
            const result = validateCursorPosition(cursor, lines);

            assert.strictEqual(result.line, 1);
            assert.strictEqual(result.column, 0);
        });
    });

    suite('compareCursorPositions', () => {
        test('should return negative when first is before second', () => {
            const a: CursorPosition = { line: 2, column: 5 };
            const b: CursorPosition = { line: 3, column: 0 };

            assert.ok(compareCursorPositions(a, b) < 0);
        });

        test('should return positive when first is after second', () => {
            const a: CursorPosition = { line: 3, column: 10 };
            const b: CursorPosition = { line: 2, column: 15 };

            assert.ok(compareCursorPositions(a, b) > 0);
        });

        test('should return zero when positions are equal', () => {
            const a: CursorPosition = { line: 3, column: 7 };
            const b: CursorPosition = { line: 3, column: 7 };

            assert.strictEqual(compareCursorPositions(a, b), 0);
        });

        test('should compare by column when lines are equal', () => {
            const a: CursorPosition = { line: 3, column: 5 };
            const b: CursorPosition = { line: 3, column: 10 };

            assert.ok(compareCursorPositions(a, b) < 0);
        });
    });

    suite('isCursorInRange', () => {
        test('should return true when cursor is inside range', () => {
            const cursor: CursorPosition = { line: 3, column: 5 };
            assert.ok(isCursorInRange(cursor, 2, 0, 4, 10));
        });

        test('should return true at range start', () => {
            const cursor: CursorPosition = { line: 2, column: 5 };
            assert.ok(isCursorInRange(cursor, 2, 5, 4, 10));
        });

        test('should return true at range end', () => {
            const cursor: CursorPosition = { line: 4, column: 10 };
            assert.ok(isCursorInRange(cursor, 2, 5, 4, 10));
        });

        test('should return false before range', () => {
            const cursor: CursorPosition = { line: 1, column: 5 };
            assert.ok(!isCursorInRange(cursor, 2, 5, 4, 10));
        });

        test('should return false after range', () => {
            const cursor: CursorPosition = { line: 5, column: 0 };
            assert.ok(!isCursorInRange(cursor, 2, 5, 4, 10));
        });
    });
});

suite('Content Extraction Tests', () => {

    suite('extractPlainTextContent', () => {
        test('should extract text from simple line-content elements', () => {
            const editor = createEditorWrapper(['Line 1', 'Line 2', 'Line 3']);
            const result = extractPlainTextContent(editor);

            assert.strictEqual(result.content, 'Line 1\nLine 2\nLine 3');
            assert.strictEqual(result.lines.length, 3);
        });

        test('should handle empty lines with nbsp', () => {
            const textNode = createTextNode('\u00a0');
            const lineContent = createElementNode('div', [textNode], ['line-content'], { 'data-line': '1' });
            const lineRow = createElementNode('div', [lineContent], ['line-row']);
            const editor = createElementNode('div', [lineRow], ['editor-wrapper']);

            const result = extractPlainTextContent(editor);
            assert.strictEqual(result.content, '');
        });

        test('should skip comment bubbles', () => {
            const text1 = createTextNode('Hello ');
            const bubbleText = createTextNode('bubble content');
            const bubble = createElementNode('div', [bubbleText], ['inline-comment-bubble']);
            const text2 = createTextNode('World');
            const lineContent = createElementNode('div', [text1, bubble, text2], ['line-content'], { 'data-line': '1' });
            const lineRow = createElementNode('div', [lineContent], ['line-row']);
            const editor = createElementNode('div', [lineRow], ['editor-wrapper']);

            const result = extractPlainTextContent(editor);
            assert.strictEqual(result.content, 'Hello World');
            assert.ok(!result.content.includes('bubble'));
        });

        test('should skip line number elements', () => {
            const lineNumText = createTextNode('1');
            const lineNum = createElementNode('div', [lineNumText], ['line-number']);
            const text = createTextNode('Content');
            const lineContent = createElementNode('div', [text], ['line-content'], { 'data-line': '1' });
            const lineRow = createElementNode('div', [lineNum, lineContent], ['line-row']);
            const editor = createElementNode('div', [lineRow], ['editor-wrapper']);

            const result = extractPlainTextContent(editor);
            assert.strictEqual(result.content, 'Content');
            assert.ok(!result.content.startsWith('1'));
        });

        test('should handle user-created div elements (Enter key)', () => {
            const lineRow = createLineRow(1, 'Original');
            const userDiv = createElementNode('div', [createTextNode('User created')]);
            const editor = createElementNode('div', [lineRow, userDiv], ['editor-wrapper']);

            const result = extractPlainTextContent(editor);
            assert.ok(result.content.includes('Original'));
            assert.ok(result.content.includes('User created'));
        });

        test('should handle user-created p elements', () => {
            const lineRow = createLineRow(1, 'Line 1');
            const userP = createElementNode('p', [createTextNode('Paragraph')]);
            const editor = createElementNode('div', [lineRow, userP], ['editor-wrapper']);

            const result = extractPlainTextContent(editor);
            assert.ok(result.content.includes('Line 1'));
            assert.ok(result.content.includes('Paragraph'));
        });

        test('should preserve order of mixed content', () => {
            const line1 = createLineRow(1, 'A');
            const userDiv1 = createElementNode('div', [createTextNode('B')]);
            const line2 = createLineRow(2, 'C');
            const userDiv2 = createElementNode('div', [createTextNode('D')]);
            const editor = createElementNode('div', [line1, userDiv1, line2, userDiv2], ['editor-wrapper']);

            const result = extractPlainTextContent(editor);
            const lines = result.content.split('\n');

            const indexA = lines.findIndex(l => l === 'A');
            const indexB = lines.findIndex(l => l === 'B');
            const indexC = lines.findIndex(l => l === 'C');
            const indexD = lines.findIndex(l => l === 'D');

            assert.ok(indexA < indexB, 'A should come before B');
            assert.ok(indexB < indexC, 'B should come before C');
            assert.ok(indexC < indexD, 'C should come before D');
        });

        test('should handle empty editor', () => {
            const editor = createElementNode('div', [], ['editor-wrapper']);
            const result = extractPlainTextContent(editor);
            assert.strictEqual(result.content, '');
            assert.strictEqual(result.lines.length, 0);
        });
    });

    suite('applyInsertion', () => {
        test('should insert text at start of line', () => {
            const lines = ['Hello World'];
            const result = applyInsertion(lines, 1, 0, 'PREFIX ');

            assert.deepStrictEqual(result, ['PREFIX Hello World']);
        });

        test('should insert text in middle of line', () => {
            const lines = ['Hello World'];
            const result = applyInsertion(lines, 1, 6, 'Beautiful ');

            assert.deepStrictEqual(result, ['Hello Beautiful World']);
        });

        test('should insert text at end of line', () => {
            const lines = ['Hello'];
            const result = applyInsertion(lines, 1, 5, ' World');

            assert.deepStrictEqual(result, ['Hello World']);
        });

        test('should insert multiple lines', () => {
            const lines = ['Line 1', 'Line 2'];
            const result = applyInsertion(lines, 1, 6, '\nNew Line\n');

            assert.strictEqual(result.length, 4);
            assert.strictEqual(result[0], 'Line 1');
            assert.strictEqual(result[1], 'New Line');
            assert.strictEqual(result[2], '');
            assert.strictEqual(result[3], 'Line 2');
        });

        test('should handle insertion at random position in multi-line content', () => {
            const lines = ['First', 'Second', 'Third'];
            const result = applyInsertion(lines, 2, 3, 'XYZ');

            assert.strictEqual(result[1], 'SecXYZond');
        });

        test('should handle empty lines array', () => {
            const lines: string[] = [];
            const result = applyInsertion(lines, 1, 0, 'New content');

            assert.deepStrictEqual(result, ['New content']);
        });

        test('should clamp line number to valid range', () => {
            const lines = ['Only line'];
            const result = applyInsertion(lines, 100, 0, 'Text');

            assert.strictEqual(result[0], 'TextOnly line');
        });

        test('should clamp column to line length', () => {
            const lines = ['Hi'];
            const result = applyInsertion(lines, 1, 100, 'LO');

            assert.strictEqual(result[0], 'HiLO');
        });
    });

    suite('applyDeletion', () => {
        test('should delete single character', () => {
            const lines = ['Hello'];
            const result = applyDeletion(lines, 1, 0, 1, 1);

            assert.deepStrictEqual(result, ['ello']);
        });

        test('should delete text in middle of line', () => {
            const lines = ['Hello World'];
            const result = applyDeletion(lines, 1, 5, 1, 6);

            assert.deepStrictEqual(result, ['HelloWorld']);
        });

        test('should delete across multiple lines', () => {
            const lines = ['First', 'Second', 'Third'];
            const result = applyDeletion(lines, 1, 3, 3, 2);

            // Delete from 'Fir|st' to 'Th|ird' => 'Firird'
            assert.strictEqual(result.length, 1);
            assert.strictEqual(result[0], 'Firird');
        });

        test('should delete entire line', () => {
            const lines = ['Keep', 'Delete', 'Keep'];
            const result = applyDeletion(lines, 2, 0, 2, 6);

            assert.strictEqual(result.length, 3);
            assert.strictEqual(result[1], '');
        });

        test('should handle empty input', () => {
            const lines: string[] = [];
            const result = applyDeletion(lines, 1, 0, 1, 5);

            assert.deepStrictEqual(result, []);
        });
    });

    suite('positionToOffset and offsetToPosition', () => {
        test('should convert position to offset and back', () => {
            const lines = ['Hello', 'World', 'Test'];

            // Test various positions
            const testCases = [
                { line: 1, column: 0 },
                { line: 1, column: 5 },
                { line: 2, column: 0 },
                { line: 2, column: 3 },
                { line: 3, column: 4 }
            ];

            for (const pos of testCases) {
                const offset = positionToOffset(lines, pos.line, pos.column);
                const backPos = offsetToPosition(lines, offset);

                assert.strictEqual(backPos.line, pos.line, `Line mismatch for ${JSON.stringify(pos)}`);
                assert.strictEqual(backPos.column, pos.column, `Column mismatch for ${JSON.stringify(pos)}`);
            }
        });

        test('should handle start of content', () => {
            const lines = ['Hello'];
            const offset = positionToOffset(lines, 1, 0);
            assert.strictEqual(offset, 0);
        });

        test('should handle end of first line', () => {
            const lines = ['Hello', 'World'];
            const offset = positionToOffset(lines, 1, 5);
            assert.strictEqual(offset, 5);
        });

        test('should handle start of second line', () => {
            const lines = ['Hello', 'World'];
            const offset = positionToOffset(lines, 2, 0);
            assert.strictEqual(offset, 6); // 5 + 1 (newline)
        });

        test('should handle empty lines', () => {
            const lines = ['A', '', 'B'];

            const offset1 = positionToOffset(lines, 2, 0);
            const pos1 = offsetToPosition(lines, offset1);
            assert.strictEqual(pos1.line, 2);
            assert.strictEqual(pos1.column, 0);
        });
    });
});

suite('Cursor and Content Integration Tests', () => {
    /**
     * These tests simulate real editing scenarios:
     * 1. Start with initial content and cursor position
     * 2. Insert content at a random position
     * 3. Verify cursor is correctly updated
     * 4. Verify content is correct
     */

    suite('Simulated Editing Scenarios', () => {
        /**
         * Helper to simulate an edit operation
         */
        function simulateEdit(
            initialLines: string[],
            cursorPos: CursorPosition,
            insertLine: number,
            insertColumn: number,
            insertText: string
        ): { newLines: string[]; newCursor: CursorPosition } {
            const insertedLines = insertText.split('\n');
            const newCursor = adjustCursorAfterInsertion(cursorPos, insertLine, insertColumn, insertedLines);
            const newLines = applyInsertion(initialLines, insertLine, insertColumn, insertText);

            return { newLines, newCursor };
        }

        test('should handle insertion before cursor on same line', () => {
            const initialLines = ['Hello World'];
            const cursor: CursorPosition = { line: 1, column: 8 }; // 'Hello Wo|rld'

            const { newLines, newCursor } = simulateEdit(
                initialLines, cursor, 1, 0, 'PREFIX '
            );

            assert.strictEqual(newLines[0], 'PREFIX Hello World');
            assert.strictEqual(newCursor.line, 1);
            assert.strictEqual(newCursor.column, 15); // 8 + 7 (PREFIX length)
        });

        test('should handle insertion after cursor on same line', () => {
            const initialLines = ['Hello World'];
            const cursor: CursorPosition = { line: 1, column: 5 }; // 'Hello| World'

            const { newLines, newCursor } = simulateEdit(
                initialLines, cursor, 1, 8, 'SUFFIX'
            );

            assert.strictEqual(newLines[0], 'Hello WoSUFFIXrld');
            // Cursor should not move since insertion is after cursor
            assert.strictEqual(newCursor.line, 1);
            assert.strictEqual(newCursor.column, 5);
        });

        test('should handle multi-line insertion before cursor', () => {
            const initialLines = ['First line', 'Second line'];
            const cursor: CursorPosition = { line: 2, column: 7 }; // 'Second |line'

            const { newLines, newCursor } = simulateEdit(
                initialLines, cursor, 1, 5, '\nNew line\n'
            );

            // Inserting '\nNew line\n' at position 5 in 'First line':
            // - Before: 'First', After: ' line'
            // - Inserted lines: ['', 'New line', '']
            // - Result: 'First' + '', 'New line', '' + ' line' = ['First', 'New line', ' line']
            // - Plus unchanged 'Second line'
            // Content: ['First', 'New line', ' line', 'Second line']
            assert.strictEqual(newLines.length, 4);
            assert.strictEqual(newLines[0], 'First');
            assert.strictEqual(newLines[1], 'New line');
            assert.strictEqual(newLines[2], ' line');
            assert.strictEqual(newLines[3], 'Second line');

            // Cursor was on line 2, now should be on line 4 (2 new lines added)
            assert.strictEqual(newCursor.line, 4);
            assert.strictEqual(newCursor.column, 7);
        });

        test('should handle insertion at cursor position', () => {
            const initialLines = ['ABCDEF'];
            const cursor: CursorPosition = { line: 1, column: 3 }; // 'ABC|DEF'

            const { newLines, newCursor } = simulateEdit(
                initialLines, cursor, 1, 3, 'XYZ'
            );

            assert.strictEqual(newLines[0], 'ABCXYZDEF');
            // Cursor moves to end of inserted text
            assert.strictEqual(newCursor.line, 1);
            assert.strictEqual(newCursor.column, 6); // 3 + 3
        });

        test('should handle random insertions across multiple operations', () => {
            let lines = ['Line 1', 'Line 2', 'Line 3'];
            let cursor: CursorPosition = { line: 2, column: 3 }; // 'Lin|e 2'

            // Operation 1: Insert at start of line 1
            let result = simulateEdit(lines, cursor, 1, 0, 'START ');
            lines = result.newLines;
            cursor = result.newCursor;

            assert.strictEqual(lines[0], 'START Line 1');
            assert.strictEqual(cursor.line, 2);
            assert.strictEqual(cursor.column, 3); // No change, different line

            // Operation 2: Insert on cursor line before cursor
            result = simulateEdit(lines, cursor, 2, 0, 'PRE');
            lines = result.newLines;
            cursor = result.newCursor;

            assert.strictEqual(lines[1], 'PRELine 2');
            assert.strictEqual(cursor.line, 2);
            assert.strictEqual(cursor.column, 6); // 3 + 3

            // Operation 3: Insert multi-line before cursor
            result = simulateEdit(lines, cursor, 1, 6, '\nNEW\n');
            lines = result.newLines;
            cursor = result.newCursor;

            // Lines should now be: ['START ', 'NEW', 'Line 1', 'PRELine 2', 'Line 3']
            assert.strictEqual(lines.length, 5);
            // Cursor should move: line 2 -> line 4 (2 new lines), column unchanged
            assert.strictEqual(cursor.line, 4);
            assert.strictEqual(cursor.column, 6);
        });

        test('should validate cursor position after complex edits', () => {
            let lines = ['Short', 'A bit longer line', 'Medium'];
            let cursor: CursorPosition = { line: 2, column: 15 }; // Near end of line 2

            // Delete most of line 2
            lines = applyDeletion(lines, 2, 2, 2, 16);
            cursor = adjustCursorAfterDeletion(cursor, 2, 2, 2, 16);

            // Cursor was inside deletion range, should move to deletion start
            assert.strictEqual(cursor.line, 2);
            assert.strictEqual(cursor.column, 2);

            // Validate cursor is within bounds
            cursor = validateCursorPosition(cursor, lines);
            assert.ok(cursor.column <= (lines[cursor.line - 1] || '').length);
        });

        test('should handle edge case: insertion at very start of document', () => {
            const lines = ['Content'];
            const cursor: CursorPosition = { line: 1, column: 4 }; // 'Cont|ent'

            const { newLines, newCursor } = simulateEdit(
                lines, cursor, 1, 0, 'Header\n'
            );

            assert.strictEqual(newLines[0], 'Header');
            assert.strictEqual(newLines[1], 'Content');
            assert.strictEqual(newCursor.line, 2);
            assert.strictEqual(newCursor.column, 4);
        });

        test('should handle edge case: insertion at very end of document', () => {
            const lines = ['Content'];
            const cursor: CursorPosition = { line: 1, column: 4 }; // 'Cont|ent'

            const { newLines, newCursor } = simulateEdit(
                lines, cursor, 1, 7, '\nFooter'
            );

            assert.strictEqual(newLines[0], 'Content');
            assert.strictEqual(newLines[1], 'Footer');
            // Cursor should not move (insertion after cursor)
            assert.strictEqual(newCursor.line, 1);
            assert.strictEqual(newCursor.column, 4);
        });

        test('should handle rapid consecutive insertions', () => {
            let lines = ['ABC'];
            let cursor: CursorPosition = { line: 1, column: 1 }; // 'A|BC'

            // Rapidly insert characters
            const chars = ['X', 'Y', 'Z'];
            for (let i = 0; i < chars.length; i++) {
                const result = simulateEdit(lines, cursor, 1, cursor.column, chars[i]);
                lines = result.newLines;
                cursor = result.newCursor;
            }

            assert.strictEqual(lines[0], 'AXYZBC');
            assert.strictEqual(cursor.column, 4); // 1 + 3
        });
    });

    suite('Random Position Insertion Tests', () => {
        /**
         * Helper to generate random position within content bounds
         */
        function randomPosition(lines: string[]): { line: number; column: number } {
            const line = Math.floor(Math.random() * lines.length) + 1;
            const lineContent = lines[line - 1] || '';
            const column = Math.floor(Math.random() * (lineContent.length + 1));
            return { line, column };
        }

        test('should correctly update cursor for random single-char insertions', () => {
            const lines = ['Line one', 'Line two', 'Line three'];

            // Run multiple random tests
            for (let i = 0; i < 10; i++) {
                const cursorPos = randomPosition(lines);
                const insertPos = randomPosition(lines);
                const insertText = String.fromCharCode(65 + i); // A, B, C...

                const cursor: CursorPosition = { line: cursorPos.line, column: cursorPos.column };
                const newCursor = adjustCursorAfterInsertion(
                    cursor,
                    insertPos.line,
                    insertPos.column,
                    [insertText]
                );

                // Verify basic properties
                assert.ok(newCursor.line >= 1, 'Line should be >= 1');
                assert.ok(newCursor.column >= 0, 'Column should be >= 0');

                // If insertion was after cursor, cursor should not change
                if (insertPos.line > cursor.line ||
                    (insertPos.line === cursor.line && insertPos.column > cursor.column)) {
                    assert.deepStrictEqual(newCursor, cursor);
                }
            }
        });

        test('should correctly update content for random insertions', () => {
            let lines = ['Alpha', 'Beta', 'Gamma', 'Delta'];

            for (let i = 0; i < 5; i++) {
                const pos = randomPosition(lines);
                const text = `[${i}]`;

                const newLines = applyInsertion(lines, pos.line, pos.column, text);

                // Verify the text was actually inserted
                const combined = newLines.join('\n');
                assert.ok(combined.includes(text), `Text [${i}] should be in result`);

                // Total length should increase
                const oldLength = lines.join('\n').length;
                const newLength = combined.length;
                assert.strictEqual(newLength, oldLength + text.length);

                lines = newLines;
            }
        });

        test('should maintain cursor validity after many random edits', () => {
            let lines = ['Start content here'];
            let cursor: CursorPosition = { line: 1, column: 5 };

            for (let i = 0; i < 20; i++) {
                const pos = randomPosition(lines);
                const text = i % 3 === 0 ? '\nNewLine\n' : `X${i}`;

                const insertedLines = text.split('\n');
                cursor = adjustCursorAfterInsertion(cursor, pos.line, pos.column, insertedLines);
                lines = applyInsertion(lines, pos.line, pos.column, text);

                // Validate cursor is always within bounds
                cursor = validateCursorPosition(cursor, lines);

                assert.ok(cursor.line >= 1, `Line ${cursor.line} should be >= 1`);
                assert.ok(cursor.line <= lines.length, `Line ${cursor.line} should be <= ${lines.length}`);

                const lineLen = lines[cursor.line - 1].length;
                assert.ok(cursor.column >= 0, `Column ${cursor.column} should be >= 0`);
                assert.ok(cursor.column <= lineLen, `Column ${cursor.column} should be <= ${lineLen}`);
            }
        });
    });
});
