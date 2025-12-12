/**
 * Table handling for the webview
 */

import { state } from './state';
import { showFloatingPanel } from './panel-manager';
import { escapeHtml, applyInlineMarkdown } from '../webview-logic/markdown-renderer';
import { applyCommentsToBlockContent, checkBlockHasComments, getVisibleCommentsForLine } from './code-block-handlers';
import { MarkdownComment } from '../types';
import { ParsedTable } from './types';

/**
 * Parse tables from content
 */
export function parseTables(content: string): ParsedTable[] {
    const lines = content.split('\n');
    const tables: ParsedTable[] = [];
    let i = 0;
    
    while (i < lines.length) {
        const line = lines[i];
        
        // Check if this line could be a table header (contains |)
        if (line.includes('|') && i + 1 < lines.length) {
            const separatorLine = lines[i + 1];
            
            // Check if next line is a table separator (contains | and - or :)
            if (/^\|?[\s\-:|]+\|/.test(separatorLine)) {
                const table = parseTableAt(lines, i);
                if (table) {
                    tables.push(table);
                    // table.endLine is 1-based exclusive, convert back to 0-based for loop
                    i = table.endLine - 1;
                    continue;
                }
            }
        }
        i++;
    }
    
    return tables;
}

/**
 * Parse a table starting at a specific line
 */
function parseTableAt(lines: string[], startIndex: number): ParsedTable | null {
    const headerLine = lines[startIndex];
    const separatorLine = lines[startIndex + 1];
    
    // Parse header cells
    const headers = parseTableRow(headerLine);
    if (headers.length === 0) return null;
    
    // Parse alignment from separator
    const alignments = parseTableAlignments(separatorLine);
    
    // Parse body rows
    const rows: string[][] = [];
    let i = startIndex + 2; // 0-based index starting after header and separator
    while (i < lines.length && lines[i].includes('|')) {
        const row = parseTableRow(lines[i]);
        if (row.length > 0) {
            rows.push(row);
        }
        i++;
    }
    
    return {
        startLine: startIndex + 1, // 1-based (inclusive)
        endLine: i + 1, // 1-based (exclusive)
        headers,
        alignments,
        rows,
        id: 'table-' + (startIndex + 1)
    };
}

/**
 * Parse a table row into cells
 */
function parseTableRow(line: string): string[] {
    // Remove leading/trailing pipes and split
    const trimmed = line.replace(/^\|/, '').replace(/\|$/, '');
    return trimmed.split('|').map(cell => cell.trim());
}

/**
 * Parse table alignments from separator line
 */
function parseTableAlignments(line: string): Array<'left' | 'center' | 'right'> {
    const cells = parseTableRow(line);
    return cells.map(cell => {
        const left = cell.startsWith(':');
        const right = cell.endsWith(':');
        if (left && right) return 'center';
        if (right) return 'right';
        return 'left';
    });
}

/**
 * Render a table as HTML with comment highlights
 */
export function renderTable(
    table: ParsedTable, 
    commentsMap: Map<number, MarkdownComment[]>
): string {
    const hasComments = checkBlockHasComments(table.startLine, table.endLine - 1, commentsMap);
    const containerClass = 'md-table-container' + (hasComments ? ' has-comments' : '');
    
    let html = '<div class="' + containerClass + '" data-start-line="' + table.startLine + 
               '" data-end-line="' + (table.endLine - 1) + '" data-table-id="' + table.id + '">';
    html += '<table class="md-table">';
    
    // Header row is at startLine
    const headerLineNum = table.startLine;
    const headerComments = getVisibleCommentsForLine(headerLineNum, commentsMap);
    
    // Header
    html += '<thead><tr data-line="' + headerLineNum + '">';
    table.headers.forEach((header, i) => {
        const align = table.alignments[i] || 'left';
        const alignClass = align !== 'left' ? ' align-' + align : '';
        let cellContent = applyInlineMarkdown(header);
        // Apply comment highlights to header cell
        cellContent = applyCommentsToBlockContent(cellContent, header, headerComments);
        html += '<th class="table-cell' + alignClass + '" data-line="' + headerLineNum + '">' + 
                cellContent + '</th>';
    });
    html += '</tr></thead>';
    
    // Body - rows start at startLine + 2 (after header and separator)
    html += '<tbody>';
    table.rows.forEach((row, rowIndex) => {
        const rowLineNum = table.startLine + 2 + rowIndex;
        const rowComments = getVisibleCommentsForLine(rowLineNum, commentsMap);
        
        html += '<tr data-line="' + rowLineNum + '">';
        row.forEach((cell, i) => {
            const align = table.alignments[i] || 'left';
            const alignClass = align !== 'left' ? ' align-' + align : '';
            let cellContent = applyInlineMarkdown(cell);
            // Apply comment highlights to cell
            cellContent = applyCommentsToBlockContent(cellContent, cell, rowComments);
            html += '<td class="table-cell' + alignClass + '" data-line="' + rowLineNum + '">' + 
                    cellContent + '</td>';
        });
        // Fill in empty cells if row is shorter than header
        for (let j = row.length; j < table.headers.length; j++) {
            html += '<td class="table-cell" data-line="' + rowLineNum + '"></td>';
        }
        html += '</tr>';
    });
    html += '</tbody>';
    
    html += '</table>';
    
    // Actions
    html += '<div class="md-table-actions">';
    html += '<button class="md-table-action-btn table-copy-btn" title="Copy table as markdown" data-table-id="' + 
            table.id + '">📋 Copy</button>';
    html += '<button class="md-table-action-btn table-comment-btn" title="Add comment to table">💬</button>';
    html += '</div>';
    
    html += '</div>';
    
    return html;
}

/**
 * Setup handlers for table actions
 */
export function setupTableHandlers(): void {
    // Get original table markdown for copy
    const getTableMarkdown = (tableContainer: HTMLElement): string => {
        const startLine = parseInt(tableContainer.dataset.startLine || '');
        const endLine = parseInt(tableContainer.dataset.endLine || '');
        const lines = state.currentContent.split('\n');
        return lines.slice(startLine - 1, endLine).join('\n');
    };
    
    // Copy table button handlers
    document.querySelectorAll('.table-copy-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const container = (btn as HTMLElement).closest('.md-table-container') as HTMLElement;
            const markdown = getTableMarkdown(container);
            navigator.clipboard.writeText(markdown).then(() => {
                const originalText = btn.textContent;
                btn.textContent = '✅ Copied!';
                setTimeout(() => { btn.textContent = originalText; }, 1500);
            });
        });
    });
    
    // Comment button handlers for tables
    document.querySelectorAll('.table-comment-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const container = (btn as HTMLElement).closest('.md-table-container') as HTMLElement;
            const startLine = parseInt(container.dataset.startLine || '');
            const endLine = parseInt(container.dataset.endLine || '');
            
            state.setPendingSelection({
                startLine,
                startColumn: 1,
                endLine,
                endColumn: 1,
                selectedText: '[Table: lines ' + startLine + '-' + endLine + ']'
            });
            
            showFloatingPanel(btn.getBoundingClientRect(), 'Table');
        });
    });
}

