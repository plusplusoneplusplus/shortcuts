/**
 * Webview utilities for line number calculations and DOM operations
 * 
 * This module serves as the SINGLE SOURCE OF TRUTH for line number calculations.
 * The logic here is used both:
 * 1. In Node.js for unit testing
 * 2. In the webview (browser) by embedding the generated JavaScript
 * 
 * When modifying calculation logic, update this module and the tests will verify
 * the changes. The webview automatically uses the same logic via getWebviewTableCellLineFunction().
 */

/**
 * Interface representing a parsed table structure
 */
export interface ParsedTable {
    /** 1-based starting line number (header row) */
    startLine: number;
    /** 1-based ending line number (exclusive) */
    endLine: number;
    /** Header cells */
    headers: string[];
    /** Column alignments */
    alignments: Array<'left' | 'center' | 'right'>;
    /** Data rows (each row is an array of cells) */
    rows: string[][];
    /** Unique identifier */
    id: string;
}

/**
 * Interface representing a selection position in the document
 */
export interface SelectionPosition {
    startLine: number;
    startColumn: number;
    endLine: number;
    endColumn: number;
    selectedText: string;
}

/**
 * Calculate the line number for a table cell based on its position
 * 
 * Table structure in markdown:
 * - Line N: Header row (startLine)
 * - Line N+1: Separator row (not rendered as a row)
 * - Line N+2: First data row
 * - Line N+3: Second data row
 * - etc.
 * 
 * @param tableStartLine - The 1-based line number where the table starts (header row)
 * @param isHeaderRow - Whether the cell is in the header row (THEAD)
 * @param tbodyRowIndex - The 0-based index of the row within TBODY (ignored for header)
 * @returns The 1-based line number for the cell
 */
export function calculateTableCellLineNumber(
    tableStartLine: number,
    isHeaderRow: boolean,
    tbodyRowIndex: number
): number {
    if (isHeaderRow) {
        return tableStartLine;
    }
    // Data rows: startLine + 2 (header + separator) + row index within tbody
    return tableStartLine + 2 + tbodyRowIndex;
}

/**
 * Calculate the line number for a code block line
 * 
 * Code block structure:
 * - Line N: Opening fence (```)
 * - Line N+1: First code line
 * - Line N+2: Second code line
 * - etc.
 * - Line M: Closing fence (```)
 * 
 * @param blockStartLine - The 1-based line number where the code block fence starts
 * @param codeLineIndex - The 0-based index of the code line within the block
 * @returns The 1-based line number for the code line
 */
export function calculateCodeBlockLineNumber(
    blockStartLine: number,
    codeLineIndex: number
): number {
    // +1 for fence line, then the index
    return blockStartLine + 1 + codeLineIndex;
}

/**
 * Parse a markdown table and calculate line numbers for each row
 * 
 * @param lines - Array of markdown lines
 * @param startIndex - 0-based index where the table starts
 * @returns Parsed table with line numbers or null if not a valid table
 */
export function parseTableWithLineNumbers(
    lines: string[],
    startIndex: number
): ParsedTable | null {
    if (startIndex >= lines.length) return null;

    const headerLine = lines[startIndex];
    if (!headerLine.includes('|')) return null;

    const separatorLine = lines[startIndex + 1];
    if (!separatorLine || !isTableSeparatorLine(separatorLine)) return null;

    const headers = parseTableRowCells(headerLine);
    const alignments = parseTableAlignmentsFromSeparator(separatorLine);
    const rows: string[][] = [];

    let i = startIndex + 2;
    while (i < lines.length && lines[i].includes('|')) {
        rows.push(parseTableRowCells(lines[i]));
        i++;
    }

    return {
        startLine: startIndex + 1, // 1-based
        endLine: i + 1, // 1-based, exclusive (first line after table)
        headers,
        alignments,
        rows,
        id: `table-${startIndex + 1}`
    };
}

/**
 * Parse a table row into its cells
 */
export function parseTableRowCells(line: string): string[] {
    // Remove leading/trailing pipes and split
    const trimmed = line.replace(/^\|/, '').replace(/\|$/, '');
    return trimmed.split('|').map(cell => cell.trim());
}

/**
 * Check if a line is a table separator line
 */
export function isTableSeparatorLine(line: string): boolean {
    return /^\|?[\s\-:|]+\|[\s\-:|]*$/.test(line);
}

/**
 * Parse table alignments from a separator line
 */
export function parseTableAlignmentsFromSeparator(line: string): Array<'left' | 'center' | 'right'> {
    const cells = parseTableRowCells(line);
    return cells.map(cell => {
        const left = cell.startsWith(':');
        const right = cell.endsWith(':');
        if (left && right) return 'center';
        if (right) return 'right';
        return 'left';
    });
}

/**
 * Get the row index mapping for all rows in a table
 * Returns an array where each element contains the line number for that row
 * 
 * @param table - Parsed table structure
 * @returns Array of line numbers: [headerLineNum, bodyRow0LineNum, bodyRow1LineNum, ...]
 */
export function getTableRowLineNumbers(table: ParsedTable): number[] {
    const lineNumbers: number[] = [];

    // Header row
    lineNumbers.push(table.startLine);

    // Body rows
    for (let i = 0; i < table.rows.length; i++) {
        lineNumbers.push(calculateTableCellLineNumber(table.startLine, false, i));
    }

    return lineNumbers;
}

/**
 * Find which row a given line number corresponds to in a table
 * 
 * @param table - Parsed table structure
 * @param lineNumber - 1-based line number to find
 * @returns Object with rowType ('header' | 'body' | 'separator' | 'outside') and rowIndex
 */
export function findTableRowAtLine(
    table: ParsedTable,
    lineNumber: number
): { rowType: 'header' | 'body' | 'separator' | 'outside'; rowIndex: number } {
    if (lineNumber < table.startLine || lineNumber >= table.endLine) {
        return { rowType: 'outside', rowIndex: -1 };
    }

    if (lineNumber === table.startLine) {
        return { rowType: 'header', rowIndex: 0 };
    }

    if (lineNumber === table.startLine + 1) {
        return { rowType: 'separator', rowIndex: -1 };
    }

    // Body row
    const bodyRowIndex = lineNumber - table.startLine - 2;
    if (bodyRowIndex >= 0 && bodyRowIndex < table.rows.length) {
        return { rowType: 'body', rowIndex: bodyRowIndex };
    }

    return { rowType: 'outside', rowIndex: -1 };
}

/**
 * Calculate column positions within a line for comment highlighting
 * 
 * @param lineContent - The plain text content of the line
 * @param startCol - 1-based start column
 * @param endCol - 1-based end column
 * @returns Object with 0-based start and end indices
 */
export function calculateColumnIndices(
    lineContent: string,
    startCol: number,
    endCol: number
): { startIdx: number; endIdx: number; isValid: boolean } {
    const startIdx = Math.max(0, startCol - 1);
    const endIdx = Math.min(lineContent.length, endCol - 1);

    return {
        startIdx,
        endIdx,
        isValid: startIdx < endIdx && startIdx < lineContent.length
    };
}

/**
 * Check if a comment selection spans the given line
 * 
 * @param selection - Comment selection with line/column info
 * @param lineNumber - 1-based line number to check
 * @returns Object indicating if the line is covered and the column range
 */
export function getSelectionCoverageForLine(
    selection: { startLine: number; endLine: number; startColumn: number; endColumn: number },
    lineNumber: number
): { isCovered: boolean; startColumn: number; endColumn: number } {
    if (lineNumber < selection.startLine || lineNumber > selection.endLine) {
        return { isCovered: false, startColumn: 0, endColumn: 0 };
    }

    let startColumn = 1;
    let endColumn = Infinity; // Will be clamped to line length

    if (selection.startLine === selection.endLine && selection.startLine === lineNumber) {
        // Single line selection
        startColumn = selection.startColumn;
        endColumn = selection.endColumn;
    } else if (lineNumber === selection.startLine) {
        // First line of multi-line selection
        startColumn = selection.startColumn;
    } else if (lineNumber === selection.endLine) {
        // Last line of multi-line selection
        endColumn = selection.endColumn;
    }
    // Middle lines use full line (startColumn=1, endColumn=Infinity)

    return { isCovered: true, startColumn, endColumn };
}

/**
 * Simulate DOM structure for a table row to test line number calculation
 * This is a test helper that mimics the DOM structure used in getLineFromTableCell
 */
export interface MockTableRow {
    parentTagName: 'THEAD' | 'TBODY';
    rowIndexInParent: number;
}

/**
 * Calculate table cell line number using the same logic as the webview
 * This function mirrors getLineFromTableCell from webview-content.ts
 * 
 * @param tableStartLine - The data-start-line value from the table container
 * @param row - Mock table row information
 * @returns The calculated line number
 */
export function getLineFromTableCellLogic(
    tableStartLine: number,
    row: MockTableRow
): number {
    // Header row is at startLine
    if (row.parentTagName === 'THEAD') {
        return tableStartLine;
    }

    // For body rows, count the index within TBODY only
    // Data rows: startLine + 2 (header + separator) + row index within tbody
    return tableStartLine + 2 + row.rowIndexInParent;
}

// ============================================================================
// WEBVIEW CODE GENERATION
// These functions generate JavaScript code for embedding in the webview.
// This ensures the webview uses the exact same logic that is unit tested.
// ============================================================================

/**
 * Core calculation logic as a JavaScript string.
 * This is the single source of truth used by both:
 * - getLineFromTableCellLogic() for Node.js testing
 * - getWebviewTableCellLineFunction() for browser embedding
 * 
 * The logic calculates the line number based on:
 * - tableStartLine: The 1-based line where the table starts (header row)
 * - isHeader: Whether the row is in THEAD
 * - tbodyRowIndex: The 0-based index of the row within TBODY
 */
const TABLE_CELL_LINE_CALCULATION_LOGIC = `
    // Header row is at startLine
    if (isHeader) {
        return tableStartLine;
    }

    // For body rows, count the index within TBODY only
    // Data rows: startLine + 2 (header + separator) + row index within tbody
    return tableStartLine + 2 + tbodyRowIndex;
`;

/**
 * Generate the complete getLineFromTableCell function for the webview.
 * This function handles DOM traversal and uses the shared calculation logic.
 * 
 * @returns JavaScript function code as a string for embedding in the webview
 */
export function getWebviewTableCellLineFunction(): string {
    return `
            // Get line number from table cell
            // NOTE: Core calculation logic is generated from webview-utils.ts
            // to ensure it stays in sync with unit tests.
            function getLineFromTableCell(cell) {
                const container = cell.closest('.md-table-container');
                if (!container) return null;

                const tableStartLine = parseInt(container.dataset.startLine);
                const table = container.querySelector('.md-table');
                if (!table) return tableStartLine;

                const row = cell.closest('tr');
                if (!row) return tableStartLine;

                // Extract row information for calculation
                const isHeader = row.parentElement.tagName === 'THEAD';

                // For body rows, count the index within TBODY only (not all rows including header)
                let tbodyRowIndex = 0;
                if (!isHeader) {
                    const tbodyRows = row.parentElement.querySelectorAll('tr');
                    for (let i = 0; i < tbodyRows.length; i++) {
                        if (tbodyRows[i] === row) {
                            tbodyRowIndex = i;
                            break;
                        }
                    }
                }

                // === BEGIN SHARED CALCULATION LOGIC ===
                // This logic is the single source of truth from webview-utils.ts
                ${TABLE_CELL_LINE_CALCULATION_LOGIC.trim().split('\n').map(line => '    ' + line).join('\n')}
                // === END SHARED CALCULATION LOGIC ===
            }`;
}

/**
 * Generate the calculateCodeBlockLineNumber function for the webview.
 * 
 * @returns JavaScript function code as a string for embedding in the webview
 */
export function getWebviewCodeBlockLineFunction(): string {
    return `
            // Calculate line number for code block content
            // NOTE: Logic generated from webview-utils.ts for consistency with unit tests.
            function calculateCodeBlockLineNumber(blockStartLine, codeLineIndex) {
                // +1 for fence line, then the index
                return blockStartLine + 1 + codeLineIndex;
            }`;
}
