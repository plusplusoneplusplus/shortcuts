/**
 * Main render function for the webview
 */

import { state } from './state';
import { groupCommentsByLine } from '../webview-logic/comment-state';
import { applyMarkdownHighlighting } from '../webview-logic/markdown-renderer';
import { applyCommentHighlightToRange, getHighlightColumnsForLine } from '../webview-logic/selection-utils';
import { parseCodeBlocks, renderCodeBlock, setupCodeBlockHandlers } from './code-block-handlers';
import { parseTables, renderTable, setupTableHandlers } from './table-handlers';
import { renderMermaidContainer, renderMermaidDiagrams } from './mermaid-handlers';
import { setupImageHandlers, resolveImagePaths } from './image-handlers';
import { setupCommentInteractions } from './dom-handlers';
import { MarkdownComment } from '../types';

/**
 * Main render function - renders the editor content with markdown highlighting,
 * code blocks, tables, and comments
 */
export function render(): void {
    const editorWrapper = document.getElementById('editorWrapper')!;
    const openCount = document.getElementById('openCount')!;
    const resolvedCount = document.getElementById('resolvedCount')!;
    
    const lines = state.currentContent.split('\n');
    const commentsMap = groupCommentsByLine(state.comments);
    const codeBlocks = parseCodeBlocks(state.currentContent);
    const tables = parseTables(state.currentContent);
    
    // Create a map of lines that are part of code blocks
    const codeBlockLines = new Map<number, typeof codeBlocks[0]>();
    codeBlocks.forEach(block => {
        for (let i = block.startLine; i <= block.endLine; i++) {
            codeBlockLines.set(i, block);
        }
    });
    
    // Create a map of lines that are part of tables
    const tableLines = new Map<number, typeof tables[0]>();
    tables.forEach(table => {
        for (let i = table.startLine; i < table.endLine; i++) {
            tableLines.set(i, table);
        }
    });
    
    let html = '';
    let inCodeBlock = false;
    let currentCodeBlockLang: string | null = null;
    let skipUntilLine = 0;
    
    // Helper function to generate line numbers HTML for a block
    function generateBlockLineNumbers(
        startLine: number, 
        endLine: number, 
        commentsMap: Map<number, MarkdownComment[]>
    ): string {
        let lineNumsHtml = '';
        for (let i = startLine; i <= endLine; i++) {
            const blockLineComments = commentsMap.get(i) || [];
            const blockHasComments = blockLineComments.filter(c => 
                state.settings.showResolved || c.status !== 'resolved'
            ).length > 0;
            const blockGutterIcon = blockHasComments 
                ? '<span class="gutter-icon" title="Click to view comments">💬</span>' 
                : '';
            lineNumsHtml += '<div class="line-number">' + blockGutterIcon + i + '</div>';
        }
        return lineNumsHtml;
    }
    
    lines.forEach((line, index) => {
        const lineNum = index + 1;
        
        // Skip lines that are part of a rendered code/mermaid/table block
        if (lineNum <= skipUntilLine) {
            return;
        }
        
        const lineComments = commentsMap.get(lineNum) || [];
        const visibleComments = lineComments.filter(c => 
            state.settings.showResolved || c.status !== 'resolved'
        );
        
        const hasComments = visibleComments.length > 0;
        const gutterIcon = hasComments 
            ? '<span class="gutter-icon" title="Click to view comments">💬</span>' 
            : '';
        
        // Check if this line starts a code block
        const block = codeBlocks.find(b => b.startLine === lineNum);
        if (block) {
            const blockLineNums = generateBlockLineNumbers(block.startLine, block.endLine, commentsMap);
            const blockContent = block.isMermaid
                ? renderMermaidContainer(block, commentsMap)
                : renderCodeBlock(block, commentsMap);

            // Line numbers are not editable
            html += '<div class="line-row block-row">' +
                '<div class="line-number-column" contenteditable="false">' + blockLineNums + '</div>' +
                '<div class="line-content block-content">' + blockContent + '</div>' +
                '</div>';

            skipUntilLine = block.endLine;
            return;
        }

        // Check if this line starts a table
        const table = tables.find(t => t.startLine === lineNum);
        if (table) {
            const tableLineNums = generateBlockLineNumbers(table.startLine, table.endLine - 1, commentsMap);
            const tableContent = renderTable(table, commentsMap);

            // Line numbers are not editable
            html += '<div class="line-row block-row">' +
                '<div class="line-number-column" contenteditable="false">' + tableLineNums + '</div>' +
                '<div class="line-content block-content">' + tableContent + '</div>' +
                '</div>';

            skipUntilLine = table.endLine - 1;
            return;
        }
        
        // Apply markdown highlighting
        const result = applyMarkdownHighlighting(line, lineNum, inCodeBlock, currentCodeBlockLang);
        inCodeBlock = result.inCodeBlock;
        currentCodeBlockLang = result.codeBlockLang;
        
        let lineHtml = result.html || '&nbsp;';
        
        // Apply comment highlights to specific text ranges
        // Sort comments by startColumn descending to apply from right to left
        const sortedComments = [...visibleComments].sort((a, b) => {
            const aCol = a.selection.startLine === lineNum ? a.selection.startColumn : 1;
            const bCol = b.selection.startLine === lineNum ? b.selection.startColumn : 1;
            return bCol - aCol;
        });
        
        sortedComments.forEach(comment => {
            const statusClass = comment.status === 'resolved' ? 'resolved' : '';
            const { startCol, endCol } = getHighlightColumnsForLine(
                comment.selection, 
                lineNum, 
                line.length
            );
            
            lineHtml = applyCommentHighlightToRange(
                lineHtml, 
                line, 
                startCol, 
                endCol, 
                comment.id, 
                statusClass
            );
        });
        
        // Create row-based layout with line number and content together
        // Line numbers are not editable
        html += '<div class="line-row">' +
            '<div class="line-number" contenteditable="false">' + gutterIcon + lineNum + '</div>' +
            '<div class="line-content" data-line="' + lineNum + '">' + lineHtml + '</div>' +
            '</div>';
    });
    
    editorWrapper.innerHTML = html;
    
    // Update stats
    const open = state.comments.filter(c => c.status === 'open').length;
    const resolved = state.comments.filter(c => c.status === 'resolved').length;
    openCount.textContent = String(open);
    resolvedCount.textContent = String(resolved);
    
    // Setup click handlers for commented text and gutter icons
    setupCommentInteractions();
    
    // Setup code block handlers
    setupCodeBlockHandlers();
    
    // Render mermaid diagrams
    renderMermaidDiagrams();
    
    // Setup table handlers
    setupTableHandlers();
    
    // Setup image handlers
    setupImageHandlers();
    
    // Resolve image paths
    resolveImagePaths();
}

