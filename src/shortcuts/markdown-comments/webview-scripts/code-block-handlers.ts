/**
 * Code block handling for the webview
 */

import { MarkdownComment } from '../types';
import { escapeHtml } from '../webview-logic/markdown-renderer';
import { applyCommentHighlightToRange } from '../webview-logic/selection-utils';
import { showFloatingPanel } from './panel-manager';
import { state } from './state';
import { CodeBlock } from './types';

/**
 * Parse code blocks from content
 */
export function parseCodeBlocks(content: string): CodeBlock[] {
    const lines = content.split('\n');
    const blocks: CodeBlock[] = [];
    let inBlock = false;
    let currentBlock: Partial<CodeBlock> | null = null;
    let codeLines: string[] = [];
    
    lines.forEach((line, index) => {
        const fenceMatch = line.match(/^```(\w*)/);
        
        if (fenceMatch && !inBlock) {
            inBlock = true;
            currentBlock = {
                language: fenceMatch[1] || 'plaintext',
                startLine: index + 1,
                isMermaid: fenceMatch[1] === 'mermaid'
            };
            codeLines = [];
        } else if (line.startsWith('```') && inBlock) {
            inBlock = false;
            if (currentBlock) {
                currentBlock.endLine = index + 1;
                currentBlock.code = codeLines.join('\n');
                currentBlock.id = 'codeblock-' + currentBlock.startLine;
                blocks.push(currentBlock as CodeBlock);
            }
            currentBlock = null;
        } else if (inBlock) {
            codeLines.push(line);
        }
    });
    
    return blocks;
}

/**
 * Highlight code using highlight.js
 */
export function highlightCode(code: string, language: string): string {
    if (typeof hljs === 'undefined') {
        return escapeHtml(code);
    }
    
    try {
        if (language && hljs.getLanguage(language)) {
            return hljs.highlight(code, { language }).value;
        } else {
            return hljs.highlightAuto(code).value;
        }
    } catch (e) {
        return escapeHtml(code);
    }
}

/**
 * Render a code block with syntax highlighting and comment highlights
 */
export function renderCodeBlock(
    block: CodeBlock, 
    commentsMap: Map<number, MarkdownComment[]>
): string {
    const highlightedCode = highlightCode(block.code, block.language);
    const codeLines = highlightedCode.split('\n');
    const plainCodeLines = block.code.split('\n');
    
    const hasBlockComments = checkBlockHasComments(block.startLine, block.endLine, commentsMap);
    const containerClass = 'code-block' + (hasBlockComments ? ' has-comments' : '');
    
    const linesHtml = codeLines.map((line, i) => {
        const actualLine = block.startLine + 1 + i; // +1 for fence line
        const plainLine = plainCodeLines[i] || '';
        const lineComments = getVisibleCommentsForLine(actualLine, commentsMap);
        
        let lineContent = line || '&nbsp;';
        // Apply comment highlights to this code line
        if (lineComments.length > 0) {
            lineContent = applyCommentsToBlockContent(lineContent, plainLine, lineComments);
        }
        
        return '<span class="code-line" data-line="' + actualLine + '">' + lineContent + '</span>';
    }).join('');
    
    const lineCount = codeLines.length;

    return '<div class="' + containerClass + '" data-start-line="' + block.startLine +
           '" data-end-line="' + block.endLine + '" data-block-id="' + block.id + '">' +
        '<div class="code-block-header">' +
            '<div class="code-block-header-left">' +
                '<button class="code-action-btn code-collapse-btn" title="Collapse code block">▼</button>' +
                '<span class="code-language">' + escapeHtml(block.language) + '</span>' +
                '<span class="code-line-count">(' + lineCount + ' line' + (lineCount !== 1 ? 's' : '') + ')</span>' +
            '</div>' +
            '<div class="code-block-actions">' +
                '<button class="code-action-btn code-copy-btn" title="Copy code" data-code="' +
                    encodeURIComponent(block.code) + '">📋 Copy</button>' +
                '<button class="code-action-btn code-comment-btn" title="Add comment to code block">💬</button>' +
            '</div>' +
        '</div>' +
        '<pre class="code-block-content"><code class="hljs language-' + block.language + '">' +
            linesHtml + '</code></pre>' +
    '</div>';
}

/**
 * Setup handlers for code block actions
 */
export function setupCodeBlockHandlers(): void {
    // Collapse/expand button handlers
    document.querySelectorAll('.code-collapse-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const button = btn as HTMLButtonElement;
            const container = button.closest('.code-block') as HTMLElement;
            const content = container.querySelector('.code-block-content') as HTMLElement;
            // Find the parent block-row to access the line number column
            const blockRow = container.closest('.block-row') as HTMLElement;
            const lineNumberColumn = blockRow?.querySelector('.line-number-column') as HTMLElement;

            if (container.classList.contains('collapsed')) {
                container.classList.remove('collapsed');
                content.style.display = 'block';
                if (lineNumberColumn) {
                    lineNumberColumn.style.display = 'block';
                }
                button.textContent = '▼';
                button.title = 'Collapse code block';
            } else {
                container.classList.add('collapsed');
                content.style.display = 'none';
                if (lineNumberColumn) {
                    lineNumberColumn.style.display = 'none';
                }
                button.textContent = '▶';
                button.title = 'Expand code block';
            }
        });
    });

    // Copy button handlers
    document.querySelectorAll('.code-copy-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const code = decodeURIComponent((btn as HTMLElement).dataset.code || '');
            navigator.clipboard.writeText(code).then(() => {
                const originalText = btn.textContent;
                btn.textContent = '✅ Copied!';
                setTimeout(() => { btn.textContent = originalText; }, 1500);
            });
        });
    });

    // Comment button handlers for code blocks
    document.querySelectorAll('.code-comment-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const container = (btn as HTMLElement).closest('.code-block') as HTMLElement;
            const startLine = parseInt(container.dataset.startLine || '');
            const endLine = parseInt(container.dataset.endLine || '');

            state.setPendingSelection({
                startLine,
                startColumn: 1,
                endLine,
                endColumn: 1,
                selectedText: '[Code Block: lines ' + startLine + '-' + endLine + ']'
            });

            showFloatingPanel(btn.getBoundingClientRect(), 'Code Block');
        });
    });
}

/**
 * Get visible comments for a specific line
 */
function getVisibleCommentsForLine(
    lineNum: number, 
    commentsMap: Map<number, MarkdownComment[]>
): MarkdownComment[] {
    const lineComments = commentsMap.get(lineNum) || [];
    return lineComments.filter(c => state.settings.showResolved || c.status !== 'resolved');
}

/**
 * Check if a block has any comments
 */
function checkBlockHasComments(
    startLine: number, 
    endLine: number, 
    commentsMap: Map<number, MarkdownComment[]>
): boolean {
    for (let line = startLine; line <= endLine; line++) {
        const comments = commentsMap.get(line);
        if (comments && comments.length > 0) {
            return true;
        }
    }
    return false;
}

/**
 * Apply comment highlights to block content (tables, code blocks)
 */
function applyCommentsToBlockContent(
    htmlContent: string, 
    plainText: string, 
    lineComments: MarkdownComment[]
): string {
    if (lineComments.length === 0) return htmlContent;
    
    // Sort comments by column descending to apply from right to left
    const sortedComments = [...lineComments].sort((a, b) => {
        return b.selection.startColumn - a.selection.startColumn;
    });
    
    let result = htmlContent;
    sortedComments.forEach(comment => {
        const statusClass = comment.status === 'resolved' ? 'resolved' : '';
        // Get the comment type class (e.g., 'ai-suggestion', 'ai-clarification')
        const typeClass = comment.type && comment.type !== 'user' ? comment.type : '';
        result = applyCommentHighlightToRange(
            result, 
            plainText,
            comment.selection.startColumn, 
            comment.selection.endColumn,
            comment.id, 
            statusClass,
            typeClass
        );
    });
    
    return result;
}

// Export for use in render.ts
export { applyCommentsToBlockContent, checkBlockHasComments, getVisibleCommentsForLine };

