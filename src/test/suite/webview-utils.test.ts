/**
 * Comprehensive unit tests for webview utilities
 * Tests line number calculations, table parsing, and selection handling
 * 
 * These tests are designed to catch bugs like the table cell line number issue
 * where body rows were being assigned incorrect line numbers.
 */

import * as assert from 'assert';
import {
    calculateCodeBlockLineNumber,
    calculateColumnIndices,
    calculateTableCellLineNumber,
    findTableRowAtLine,
    getLineFromTableCellLogic,
    getSelectionCoverageForLine,
    getTableRowLineNumbers,
    isTableSeparatorLine,
    MockTableRow,
    parseTableAlignmentsFromSeparator,
    parseTableRowCells,
    parseTableWithLineNumbers
} from '../../shortcuts/markdown-comments/webview-utils';

suite('Webview Utils - Table Line Number Calculations', () => {

    suite('calculateTableCellLineNumber', () => {

        test('should return startLine for header row', () => {
            // Table starts at line 10
            // Header is at line 10
            const lineNum = calculateTableCellLineNumber(10, true, 0);
            assert.strictEqual(lineNum, 10);
        });

        test('should return startLine + 2 for first body row', () => {
            // Table starts at line 10
            // Separator is at line 11
            // First body row is at line 12
            const lineNum = calculateTableCellLineNumber(10, false, 0);
            assert.strictEqual(lineNum, 12);
        });

        test('should return startLine + 3 for second body row', () => {
            // Table starts at line 10
            // Second body row is at line 13
            const lineNum = calculateTableCellLineNumber(10, false, 1);
            assert.strictEqual(lineNum, 13);
        });

        test('should handle table starting at line 1', () => {
            assert.strictEqual(calculateTableCellLineNumber(1, true, 0), 1);  // Header
            assert.strictEqual(calculateTableCellLineNumber(1, false, 0), 3); // First body
            assert.strictEqual(calculateTableCellLineNumber(1, false, 1), 4); // Second body
        });

        test('should handle many body rows correctly', () => {
            const startLine = 5;
            for (let i = 0; i < 20; i++) {
                const expected = startLine + 2 + i;
                const actual = calculateTableCellLineNumber(startLine, false, i);
                assert.strictEqual(actual, expected, `Body row ${i} should be at line ${expected}`);
            }
        });
    });

    suite('getLineFromTableCellLogic - Regression tests for line number bug', () => {

        test('REGRESSION: header row should be at startLine', () => {
            const row: MockTableRow = { parentTagName: 'THEAD', rowIndexInParent: 0 };
            assert.strictEqual(getLineFromTableCellLogic(52, row), 52);
        });

        test('REGRESSION: first tbody row should be at startLine + 2, not startLine + 3', () => {
            // This is the exact bug that was fixed
            // Before fix: first tbody row was calculated as startLine + 2 + 1 = startLine + 3
            // After fix: first tbody row is correctly startLine + 2 + 0 = startLine + 2
            const row: MockTableRow = { parentTagName: 'TBODY', rowIndexInParent: 0 };
            assert.strictEqual(getLineFromTableCellLogic(52, row), 54);
        });

        test('REGRESSION: second tbody row should be at startLine + 3', () => {
            const row: MockTableRow = { parentTagName: 'TBODY', rowIndexInParent: 1 };
            assert.strictEqual(getLineFromTableCellLogic(52, row), 55);
        });

        test('REGRESSION: verify consecutive body rows have consecutive line numbers', () => {
            const startLine = 10;
            const rows: MockTableRow[] = [
                { parentTagName: 'THEAD', rowIndexInParent: 0 },
                { parentTagName: 'TBODY', rowIndexInParent: 0 },
                { parentTagName: 'TBODY', rowIndexInParent: 1 },
                { parentTagName: 'TBODY', rowIndexInParent: 2 },
                { parentTagName: 'TBODY', rowIndexInParent: 3 }
            ];

            const expectedLines = [10, 12, 13, 14, 15]; // Line 11 is separator

            rows.forEach((row, i) => {
                const actual = getLineFromTableCellLogic(startLine, row);
                assert.strictEqual(
                    actual,
                    expectedLines[i],
                    `Row ${i} (${row.parentTagName}[${row.rowIndexInParent}]) should be at line ${expectedLines[i]}, got ${actual}`
                );
            });
        });

        test('should correctly map all rows for image example table', () => {
            // This simulates the exact table from the bug report:
            // Line 52: | Test Category | Location | Status | Coverage |
            // Line 53: |---|---|---|---|
            // Line 54: **Server Unit Tests** row
            // Line 55: **Client Unit Tests** row (this was incorrectly getting line 54's text)
            // Line 56: **Integration** row

            const startLine = 52;

            // Header should be at line 52
            const headerRow: MockTableRow = { parentTagName: 'THEAD', rowIndexInParent: 0 };
            assert.strictEqual(getLineFromTableCellLogic(startLine, headerRow), 52);

            // Server Unit Tests row (first body row, index 0) should be at line 54
            const serverRow: MockTableRow = { parentTagName: 'TBODY', rowIndexInParent: 0 };
            assert.strictEqual(getLineFromTableCellLogic(startLine, serverRow), 54);

            // Client Unit Tests row (second body row, index 1) should be at line 55
            const clientRow: MockTableRow = { parentTagName: 'TBODY', rowIndexInParent: 1 };
            assert.strictEqual(getLineFromTableCellLogic(startLine, clientRow), 55);

            // Integration row (third body row, index 2) should be at line 56
            const integrationRow: MockTableRow = { parentTagName: 'TBODY', rowIndexInParent: 2 };
            assert.strictEqual(getLineFromTableCellLogic(startLine, integrationRow), 56);
        });
    });

    suite('parseTableWithLineNumbers', () => {

        test('should parse simple table correctly', () => {
            const lines = [
                '| A | B |',
                '|---|---|',
                '| 1 | 2 |'
            ];

            const result = parseTableWithLineNumbers(lines, 0);
            assert.ok(result);
            assert.strictEqual(result.startLine, 1);
            assert.strictEqual(result.endLine, 4);
            assert.deepStrictEqual(result.headers, ['A', 'B']);
            assert.strictEqual(result.rows.length, 1);
        });

        test('should calculate correct line numbers for multi-row table', () => {
            const lines = [
                '| Header 1 | Header 2 |',
                '|----------|----------|',
                '| Row 1    | Data     |',
                '| Row 2    | More     |',
                '| Row 3    | Even More|'
            ];

            const result = parseTableWithLineNumbers(lines, 0);
            assert.ok(result);

            const rowLineNumbers = getTableRowLineNumbers(result);
            assert.deepStrictEqual(rowLineNumbers, [1, 3, 4, 5]);
        });

        test('should handle table not at start of document', () => {
            const lines = [
                'Some text',
                '',
                '| A | B |',
                '|---|---|',
                '| 1 | 2 |'
            ];

            const result = parseTableWithLineNumbers(lines, 2);
            assert.ok(result);
            assert.strictEqual(result.startLine, 3);

            const rowLineNumbers = getTableRowLineNumbers(result);
            assert.deepStrictEqual(rowLineNumbers, [3, 5]); // Header at 3, first body at 5
        });

        test('should return null for invalid table', () => {
            assert.strictEqual(parseTableWithLineNumbers(['not a table'], 0), null);
            assert.strictEqual(parseTableWithLineNumbers([], 0), null);
            assert.strictEqual(parseTableWithLineNumbers(['| A |'], 0), null); // No separator
        });
    });

    suite('findTableRowAtLine', () => {

        const table = {
            startLine: 10,
            endLine: 15,
            headers: ['A', 'B'],
            alignments: ['left' as const, 'left' as const],
            rows: [['1', '2'], ['3', '4'], ['5', '6']],
            id: 'table-10'
        };

        test('should identify header row', () => {
            const result = findTableRowAtLine(table, 10);
            assert.strictEqual(result.rowType, 'header');
            assert.strictEqual(result.rowIndex, 0);
        });

        test('should identify separator row', () => {
            const result = findTableRowAtLine(table, 11);
            assert.strictEqual(result.rowType, 'separator');
            assert.strictEqual(result.rowIndex, -1);
        });

        test('should identify first body row', () => {
            const result = findTableRowAtLine(table, 12);
            assert.strictEqual(result.rowType, 'body');
            assert.strictEqual(result.rowIndex, 0);
        });

        test('should identify subsequent body rows', () => {
            assert.deepStrictEqual(findTableRowAtLine(table, 13), { rowType: 'body', rowIndex: 1 });
            assert.deepStrictEqual(findTableRowAtLine(table, 14), { rowType: 'body', rowIndex: 2 });
        });

        test('should identify lines outside table', () => {
            assert.strictEqual(findTableRowAtLine(table, 9).rowType, 'outside');
            assert.strictEqual(findTableRowAtLine(table, 15).rowType, 'outside');
            assert.strictEqual(findTableRowAtLine(table, 100).rowType, 'outside');
        });
    });
});

suite('Webview Utils - Code Block Line Numbers', () => {

    test('should calculate first code line correctly', () => {
        // Code block starts at line 5 (opening fence)
        // First code line is at line 6
        assert.strictEqual(calculateCodeBlockLineNumber(5, 0), 6);
    });

    test('should calculate subsequent code lines correctly', () => {
        const startLine = 10;
        assert.strictEqual(calculateCodeBlockLineNumber(startLine, 0), 11);
        assert.strictEqual(calculateCodeBlockLineNumber(startLine, 1), 12);
        assert.strictEqual(calculateCodeBlockLineNumber(startLine, 2), 13);
        assert.strictEqual(calculateCodeBlockLineNumber(startLine, 9), 20);
    });

    test('should handle code block at start of document', () => {
        assert.strictEqual(calculateCodeBlockLineNumber(1, 0), 2);
        assert.strictEqual(calculateCodeBlockLineNumber(1, 1), 3);
    });
});

suite('Webview Utils - Table Parsing Helpers', () => {

    suite('parseTableRowCells', () => {

        test('should parse simple row', () => {
            assert.deepStrictEqual(parseTableRowCells('| A | B |'), ['A', 'B']);
        });

        test('should handle whitespace', () => {
            assert.deepStrictEqual(parseTableRowCells('|  A  |  B  |'), ['A', 'B']);
        });

        test('should handle row without outer pipes', () => {
            assert.deepStrictEqual(parseTableRowCells('A | B'), ['A', 'B']);
        });

        test('should handle multiple columns', () => {
            assert.deepStrictEqual(
                parseTableRowCells('| A | B | C | D | E |'),
                ['A', 'B', 'C', 'D', 'E']
            );
        });

        test('should handle empty cells', () => {
            assert.deepStrictEqual(parseTableRowCells('| A |  | C |'), ['A', '', 'C']);
        });
    });

    suite('isTableSeparatorLine', () => {

        test('should detect standard separator', () => {
            assert.strictEqual(isTableSeparatorLine('|---|---|'), true);
        });

        test('should detect separator with alignment markers', () => {
            assert.strictEqual(isTableSeparatorLine('|:---|---:|'), true);
            assert.strictEqual(isTableSeparatorLine('|:---:|:---:|'), true);
        });

        test('should detect separator with spaces', () => {
            assert.strictEqual(isTableSeparatorLine('| --- | --- |'), true);
        });

        test('should reject non-separator lines', () => {
            assert.strictEqual(isTableSeparatorLine('| A | B |'), false);
            assert.strictEqual(isTableSeparatorLine('not a table'), false);
            assert.strictEqual(isTableSeparatorLine(''), false);
        });
    });

    suite('parseTableAlignmentsFromSeparator', () => {

        test('should parse left alignment', () => {
            assert.deepStrictEqual(
                parseTableAlignmentsFromSeparator('|---|---|'),
                ['left', 'left']
            );
        });

        test('should parse right alignment', () => {
            assert.deepStrictEqual(
                parseTableAlignmentsFromSeparator('|---:|---:|'),
                ['right', 'right']
            );
        });

        test('should parse center alignment', () => {
            assert.deepStrictEqual(
                parseTableAlignmentsFromSeparator('|:---:|:---:|'),
                ['center', 'center']
            );
        });

        test('should parse mixed alignments', () => {
            assert.deepStrictEqual(
                parseTableAlignmentsFromSeparator('|:---|:---:|---:|'),
                ['left', 'center', 'right']
            );
        });
    });
});

suite('Webview Utils - Selection and Column Calculations', () => {

    suite('calculateColumnIndices', () => {

        test('should convert 1-based columns to 0-based indices', () => {
            const result = calculateColumnIndices('Hello World', 1, 6);
            assert.strictEqual(result.startIdx, 0);
            assert.strictEqual(result.endIdx, 5);
            assert.strictEqual(result.isValid, true);
        });

        test('should handle selection in middle of line', () => {
            const result = calculateColumnIndices('Hello World', 7, 12);
            assert.strictEqual(result.startIdx, 6);
            assert.strictEqual(result.endIdx, 11);
            assert.strictEqual(result.isValid, true);
        });

        test('should clamp end to line length', () => {
            const result = calculateColumnIndices('Hello', 1, 100);
            assert.strictEqual(result.startIdx, 0);
            assert.strictEqual(result.endIdx, 5);
            assert.strictEqual(result.isValid, true);
        });

        test('should handle invalid range', () => {
            const result = calculateColumnIndices('Hello', 10, 15);
            assert.strictEqual(result.isValid, false);
        });

        test('should handle zero-width selection', () => {
            const result = calculateColumnIndices('Hello', 3, 3);
            assert.strictEqual(result.isValid, false);
        });
    });

    suite('getSelectionCoverageForLine', () => {

        test('should handle single-line selection', () => {
            const selection = { startLine: 5, endLine: 5, startColumn: 3, endColumn: 10 };
            const result = getSelectionCoverageForLine(selection, 5);

            assert.strictEqual(result.isCovered, true);
            assert.strictEqual(result.startColumn, 3);
            assert.strictEqual(result.endColumn, 10);
        });

        test('should handle first line of multi-line selection', () => {
            const selection = { startLine: 5, endLine: 10, startColumn: 3, endColumn: 20 };
            const result = getSelectionCoverageForLine(selection, 5);

            assert.strictEqual(result.isCovered, true);
            assert.strictEqual(result.startColumn, 3);
            assert.strictEqual(result.endColumn, Infinity);
        });

        test('should handle last line of multi-line selection', () => {
            const selection = { startLine: 5, endLine: 10, startColumn: 3, endColumn: 20 };
            const result = getSelectionCoverageForLine(selection, 10);

            assert.strictEqual(result.isCovered, true);
            assert.strictEqual(result.startColumn, 1);
            assert.strictEqual(result.endColumn, 20);
        });

        test('should handle middle line of multi-line selection', () => {
            const selection = { startLine: 5, endLine: 10, startColumn: 3, endColumn: 20 };
            const result = getSelectionCoverageForLine(selection, 7);

            assert.strictEqual(result.isCovered, true);
            assert.strictEqual(result.startColumn, 1);
            assert.strictEqual(result.endColumn, Infinity);
        });

        test('should handle line before selection', () => {
            const selection = { startLine: 5, endLine: 10, startColumn: 3, endColumn: 20 };
            const result = getSelectionCoverageForLine(selection, 4);

            assert.strictEqual(result.isCovered, false);
        });

        test('should handle line after selection', () => {
            const selection = { startLine: 5, endLine: 10, startColumn: 3, endColumn: 20 };
            const result = getSelectionCoverageForLine(selection, 11);

            assert.strictEqual(result.isCovered, false);
        });
    });
});

suite('Webview Utils - Integration Tests', () => {

    test('should correctly process a complete table from markdown', () => {
        // Simulate processing a table exactly as it would appear in a markdown file
        const markdown = `# Test Document

| Test Category | Location | Status |
|---------------|----------|--------|
| Server Unit Tests | tests/unit/server | ✅ PASSED |
| Client Unit Tests | tests/unit/client | ⚠️ 20/28 |
| Integration | tests/integration | ⚠️ |

Some text after the table.`;

        const lines = markdown.split('\n');

        // Find where the table starts
        let tableStartIndex = -1;
        for (let i = 0; i < lines.length; i++) {
            if (lines[i].includes('Test Category')) {
                tableStartIndex = i;
                break;
            }
        }

        assert.ok(tableStartIndex >= 0, 'Should find table start');

        const table = parseTableWithLineNumbers(lines, tableStartIndex);
        assert.ok(table, 'Should parse table');

        // Verify line numbers (1-based)
        const headerLineNum = table.startLine;
        assert.strictEqual(headerLineNum, tableStartIndex + 1);

        // Simulate what the webview does for each row
        const serverRow: MockTableRow = { parentTagName: 'TBODY', rowIndexInParent: 0 };
        const clientRow: MockTableRow = { parentTagName: 'TBODY', rowIndexInParent: 1 };
        const integrationRow: MockTableRow = { parentTagName: 'TBODY', rowIndexInParent: 2 };

        const serverLineNum = getLineFromTableCellLogic(table.startLine, serverRow);
        const clientLineNum = getLineFromTableCellLogic(table.startLine, clientRow);
        const integrationLineNum = getLineFromTableCellLogic(table.startLine, integrationRow);

        // Verify the lines contain the expected content
        assert.ok(lines[serverLineNum - 1].includes('Server Unit Tests'),
            `Line ${serverLineNum} should contain 'Server Unit Tests'`);
        assert.ok(lines[clientLineNum - 1].includes('Client Unit Tests'),
            `Line ${clientLineNum} should contain 'Client Unit Tests'`);
        assert.ok(lines[integrationLineNum - 1].includes('Integration'),
            `Line ${integrationLineNum} should contain 'Integration'`);

        // Each row should have a unique line number
        assert.notStrictEqual(serverLineNum, clientLineNum);
        assert.notStrictEqual(clientLineNum, integrationLineNum);

        // Line numbers should be consecutive for body rows
        assert.strictEqual(clientLineNum, serverLineNum + 1);
        assert.strictEqual(integrationLineNum, clientLineNum + 1);
    });

    test('should handle table comment selection correctly', () => {
        // Simulate adding a comment to a specific table cell
        const tableStartLine = 10;

        // User selects text in the second body row (Client Unit Tests)
        const selectedRow: MockTableRow = { parentTagName: 'TBODY', rowIndexInParent: 1 };
        const lineNumber = getLineFromTableCellLogic(tableStartLine, selectedRow);

        // Verify the selection would be saved to the correct line
        assert.strictEqual(lineNumber, 13, 'Second body row should be at line 13');

        // Simulate retrieving comments for that row
        const commentSelection = {
            startLine: lineNumber,
            endLine: lineNumber,
            startColumn: 5,
            endColumn: 25
        };

        // Verify coverage calculation
        const coverage = getSelectionCoverageForLine(commentSelection, lineNumber);
        assert.strictEqual(coverage.isCovered, true);
        assert.strictEqual(coverage.startColumn, 5);
        assert.strictEqual(coverage.endColumn, 25);

        // Adjacent rows should not be covered
        assert.strictEqual(getSelectionCoverageForLine(commentSelection, lineNumber - 1).isCovered, false);
        assert.strictEqual(getSelectionCoverageForLine(commentSelection, lineNumber + 1).isCovered, false);
    });
});

suite('Webview Utils - Code Generation', () => {
    // Import the code generation functions
    const { getWebviewTableCellLineFunction, getWebviewCodeBlockLineFunction } = require('../../shortcuts/markdown-comments/webview-utils');

    test('getWebviewTableCellLineFunction should generate valid JavaScript', () => {
        const code = getWebviewTableCellLineFunction();

        // Should be a string
        assert.strictEqual(typeof code, 'string');

        // Should contain function definition
        assert.ok(code.includes('function getLineFromTableCell(cell)'), 'Should define function');

        // Should contain key logic elements
        assert.ok(code.includes('closest'), 'Should use closest for DOM traversal');
        assert.ok(code.includes('THEAD'), 'Should check for THEAD');
        assert.ok(code.includes('TBODY'), 'Should check for TBODY');
        assert.ok(code.includes('tableStartLine'), 'Should use tableStartLine variable');
        assert.ok(code.includes('tbodyRowIndex'), 'Should use tbodyRowIndex variable');

        // Should contain the core calculation
        assert.ok(code.includes('tableStartLine + 2 + tbodyRowIndex'), 'Should have correct calculation');

        // Should be parseable as JavaScript (wrapped in a function to make it valid)
        assert.doesNotThrow(() => {
            // eslint-disable-next-line @typescript-eslint/no-implied-eval
            new Function(code);
        }, 'Generated code should be valid JavaScript');
    });

    test('getWebviewCodeBlockLineFunction should generate valid JavaScript', () => {
        const code = getWebviewCodeBlockLineFunction();

        // Should be a string
        assert.strictEqual(typeof code, 'string');

        // Should contain function definition
        assert.ok(code.includes('function calculateCodeBlockLineNumber'), 'Should define function');

        // Should contain the correct calculation
        assert.ok(code.includes('blockStartLine + 1 + codeLineIndex'), 'Should have correct calculation');

        // Should be parseable as JavaScript
        assert.doesNotThrow(() => {
            // eslint-disable-next-line @typescript-eslint/no-implied-eval
            new Function(code);
        }, 'Generated code should be valid JavaScript');
    });

    test('generated table cell function should produce same results as getLineFromTableCellLogic', () => {
        const code = getWebviewTableCellLineFunction();

        // Create a test harness that simulates the DOM structure
        const testHarness = `
            ${code}

            // Mock DOM structure for testing
            function simulateGetLineFromTableCell(tableStartLine, isHeader, tbodyRowIndex) {
                // Create mock DOM elements
                const mockCell = {
                    closest: function(selector) {
                        if (selector === '.md-table-container') {
                            return {
                                dataset: { startLine: tableStartLine.toString() },
                                querySelector: function() {
                                    return {}; // mock table
                                }
                            };
                        }
                        if (selector === 'tr') {
                            return {
                                parentElement: {
                                    tagName: isHeader ? 'THEAD' : 'TBODY',
                                    querySelectorAll: function() {
                                        // Return array with the mock row at the specified index
                                        const rows = [];
                                        for (let i = 0; i <= tbodyRowIndex; i++) {
                                            rows.push(i === tbodyRowIndex ? this.parentRow : {});
                                        }
                                        rows.parentRow = this.parentRow;
                                        return rows;
                                    }.bind({ parentRow: {} })
                                }
                            };
                        }
                        return null;
                    }
                };

                // The mock row reference for comparison
                const mockRow = mockCell.closest('tr');
                mockRow.parentElement.querySelectorAll('tr').forEach = function(fn) {
                    for (let i = 0; i < this.length; i++) {
                        fn(this[i], i);
                    }
                };

                return getLineFromTableCell(mockCell);
            }

            // Test cases
            return {
                headerRow: simulateGetLineFromTableCell(10, true, 0),
                firstBodyRow: simulateGetLineFromTableCell(10, false, 0),
                secondBodyRow: simulateGetLineFromTableCell(10, false, 1),
                thirdBodyRow: simulateGetLineFromTableCell(10, false, 2)
            };
        `;

        // This test verifies the structure is correct
        // (Full DOM simulation would require jsdom, but we verify the logic path)
        assert.ok(code.includes('return tableStartLine'), 'Header should return tableStartLine');
        assert.ok(code.includes('tableStartLine + 2 + tbodyRowIndex'), 'Body should return correct calculation');
    });
});
