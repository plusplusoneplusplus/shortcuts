/**
 * DOM event handlers for the webview
 * 
 * Uses content-extraction module for extracting plain text from the contenteditable editor.
 */

import {
    DEFAULT_SKIP_CLASSES,
    ExtractionContext
} from '../webview-logic/content-extraction';
import {
    closeActiveCommentBubble,
    closeFloatingPanel,
    closeInlineEditPanel,
    showCommentBubble,
    showFloatingPanel
} from './panel-manager';
import { render } from './render';
import { getSelectionPosition } from './selection-handler';
import { state } from './state';
import { openFile, requestCopyPrompt, requestDeleteAll, requestResolveAll, updateContent } from './vscode-bridge';

// DOM element references
let editorWrapper: HTMLElement;
let showResolvedCheckbox: HTMLInputElement;
let contextMenu: HTMLElement;
let contextMenuCut: HTMLElement;
let contextMenuCopy: HTMLElement;
let contextMenuPaste: HTMLElement;
let contextMenuAddComment: HTMLElement;

/**
 * Initialize DOM handlers
 */
export function initDomHandlers(): void {
    editorWrapper = document.getElementById('editorWrapper')!;
    showResolvedCheckbox = document.getElementById('showResolvedCheckbox') as HTMLInputElement;
    contextMenu = document.getElementById('contextMenu')!;
    contextMenuCut = document.getElementById('contextMenuCut')!;
    contextMenuCopy = document.getElementById('contextMenuCopy')!;
    contextMenuPaste = document.getElementById('contextMenuPaste')!;
    contextMenuAddComment = document.getElementById('contextMenuAddComment')!;

    setupToolbarEventListeners();
    setupEditorEventListeners();
    setupContextMenuEventListeners();
    setupKeyboardEventListeners();
    setupGlobalEventListeners();
}

/**
 * Setup toolbar event listeners
 */
function setupToolbarEventListeners(): void {
    document.getElementById('resolveAllBtn')?.addEventListener('click', () => {
        requestResolveAll();
    });

    document.getElementById('deleteAllBtn')?.addEventListener('click', () => {
        requestDeleteAll();
    });

    document.getElementById('copyPromptBtn')?.addEventListener('click', () => {
        requestCopyPrompt('markdown');
    });

    showResolvedCheckbox.addEventListener('change', (e) => {
        state.setSettings({ showResolved: (e.target as HTMLInputElement).checked });
        render();
    });
}

/**
 * Setup editor event listeners
 */
function setupEditorEventListeners(): void {
    editorWrapper.addEventListener('input', handleEditorInput);
    editorWrapper.addEventListener('keydown', handleEditorKeydown);
    editorWrapper.addEventListener('mouseup', handleSelectionChange);
    editorWrapper.addEventListener('keyup', handleSelectionChange);
    editorWrapper.addEventListener('click', handleTripleClick);
}

/**
 * Setup context menu event listeners
 */
function setupContextMenuEventListeners(): void {
    document.addEventListener('contextmenu', (e) => {
        if ((e.target as HTMLElement).closest('#editorContainer')) {
            handleContextMenu(e);
        }
    });

    contextMenuCut.addEventListener('click', () => {
        hideContextMenu();
        handleCut();
    });

    contextMenuCopy.addEventListener('click', () => {
        hideContextMenu();
        handleCopy();
    });

    contextMenuPaste.addEventListener('click', () => {
        hideContextMenu();
        handlePaste();
    });

    contextMenuAddComment.addEventListener('click', () => {
        hideContextMenu();
        handleAddCommentFromContextMenu();
    });

    // Hide context menu on click outside
    document.addEventListener('click', (e) => {
        if (!(e.target as HTMLElement).closest('.context-menu')) {
            hideContextMenu();
        }
    });
}

/**
 * Setup keyboard event listeners
 */
function setupKeyboardEventListeners(): void {
    document.addEventListener('keydown', (e) => {
        // Escape closes panels
        if (e.key === 'Escape') {
            closeFloatingPanel();
            closeInlineEditPanel();
            closeActiveCommentBubble();
            hideContextMenu();
        }

        // Ctrl+Shift+M to add comment
        if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'm') {
            e.preventDefault();
            handleAddComment();
        }
    });
}

/**
 * Setup global event listeners
 */
function setupGlobalEventListeners(): void {
    // Close bubble when clicking outside
    document.addEventListener('click', (e) => {
        const target = e.target as HTMLElement;
        if (state.activeCommentBubble &&
            !target.closest('.inline-comment-bubble') &&
            !target.closest('.commented-text') &&
            !target.closest('.gutter-icon')) {
            closeActiveCommentBubble();
        }
    });
}

/**
 * Handle context menu
 */
function handleContextMenu(e: MouseEvent): void {
    const selection = window.getSelection();
    const hasSelection = selection && !selection.isCollapsed && selection.toString().trim().length > 0;

    // Save selection info for later use
    if (hasSelection) {
        const range = selection!.getRangeAt(0);
        const selectionInfo = getSelectionPosition(range);
        if (selectionInfo) {
            state.setSavedSelectionForContextMenu({
                ...selectionInfo,
                selectedText: selection!.toString().trim(),
                range: range.cloneRange(),
                rect: range.getBoundingClientRect()
            });
        }
    } else {
        state.setSavedSelectionForContextMenu(null);
    }

    // Update menu item states based on selection
    if (hasSelection) {
        contextMenuCut.classList.remove('disabled');
        contextMenuCopy.classList.remove('disabled');
        contextMenuAddComment.classList.remove('disabled');
    } else {
        contextMenuCut.classList.add('disabled');
        contextMenuCopy.classList.add('disabled');
        contextMenuAddComment.classList.add('disabled');
    }
    // Paste is always enabled
    contextMenuPaste.classList.remove('disabled');

    // Position and show context menu
    e.preventDefault();
    const x = Math.min(e.clientX, window.innerWidth - 220);
    const y = Math.min(e.clientY, window.innerHeight - 150);
    contextMenu.style.left = x + 'px';
    contextMenu.style.top = y + 'px';
    contextMenu.style.display = 'block';
}

/**
 * Hide context menu
 */
function hideContextMenu(): void {
    contextMenu.style.display = 'none';
}

/**
 * Handle cut operation
 */
function handleCut(): void {
    const saved = state.savedSelectionForContextMenu;
    if (saved && saved.selectedText) {
        navigator.clipboard.writeText(saved.selectedText).then(() => {
            // Restore selection and delete
            const selection = window.getSelection();
            selection?.removeAllRanges();
            selection?.addRange(saved.range);
            document.execCommand('delete');
            state.setSavedSelectionForContextMenu(null);
        });
    }
}

/**
 * Handle copy operation
 */
function handleCopy(): void {
    const saved = state.savedSelectionForContextMenu;
    if (saved && saved.selectedText) {
        navigator.clipboard.writeText(saved.selectedText);
    }
}

/**
 * Handle paste operation
 */
function handlePaste(): void {
    navigator.clipboard.readText().then(text => {
        editorWrapper.focus();
        document.execCommand('insertText', false, text);
    }).catch(() => {
        // Fallback if clipboard API fails
        editorWrapper.focus();
        document.execCommand('paste');
    });
}

/**
 * Handle add comment from selection
 */
export function handleAddComment(): void {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed) {
        alert('Please select some text first to add a comment.');
        return;
    }

    const selectedText = selection.toString().trim();
    if (!selectedText) {
        alert('Please select some text first to add a comment.');
        return;
    }

    const range = selection.getRangeAt(0);
    const selectionInfo = getSelectionPosition(range);

    if (!selectionInfo) {
        alert('Could not determine selection position.');
        return;
    }

    state.setPendingSelection({
        ...selectionInfo,
        selectedText
    });

    const rect = range.getBoundingClientRect();
    showFloatingPanel(rect, selectedText);
}

/**
 * Handle add comment from context menu
 */
function handleAddCommentFromContextMenu(): void {
    const saved = state.savedSelectionForContextMenu;
    if (!saved) {
        alert('Please select some text first to add a comment.');
        return;
    }

    state.setPendingSelection({
        startLine: saved.startLine,
        startColumn: saved.startColumn,
        endLine: saved.endLine,
        endColumn: saved.endColumn,
        selectedText: saved.selectedText
    });

    showFloatingPanel(saved.rect, saved.selectedText);
    state.setSavedSelectionForContextMenu(null);
}

/**
 * Handle selection change in editor
 */
function handleSelectionChange(): void {
    const selection = window.getSelection();
    if (selection && !selection.isCollapsed) {
        const text = selection.toString().trim();
        if (text.length > 0) {
            // Could show a hint for adding comment (optional enhancement)
        }
    }
}

/**
 * Handle triple-click to select the full logical line.
 * This ensures that even with word wrap, the entire line is selected.
 */
function handleTripleClick(e: MouseEvent): void {
    // detail === 3 indicates triple-click
    if (e.detail !== 3) return;

    const target = e.target as HTMLElement;

    // Find the line-content element that contains the click
    const lineContent = target.closest('.line-content') as HTMLElement;
    if (!lineContent) {
        // Also check for code block lines
        const codeLine = target.closest('.code-line') as HTMLElement;
        if (codeLine) {
            selectFullLine(codeLine);
            e.preventDefault();
        }
        return;
    }

    selectFullLine(lineContent);
    e.preventDefault();
}

/**
 * Select the full text content of a line element.
 * Excludes UI elements like comment bubbles and gutter icons.
 */
function selectFullLine(lineElement: HTMLElement): void {
    const selection = window.getSelection();
    if (!selection) return;

    // Create a range that spans the entire line content
    const range = document.createRange();

    // Find the first and last text nodes in the line, excluding UI elements
    let firstTextNode: Text | null = null;
    let lastTextNode: Text | null = null;

    const walker = document.createTreeWalker(
        lineElement,
        NodeFilter.SHOW_TEXT,
        {
            acceptNode: (node) => {
                const parent = node.parentElement;
                // Skip nodes inside comment bubbles, gutter icons, etc.
                if (parent && parent.closest('.inline-comment-bubble, .gutter-icon')) {
                    return NodeFilter.FILTER_REJECT;
                }
                // Skip empty text nodes
                if (!node.textContent || node.textContent.length === 0) {
                    return NodeFilter.FILTER_REJECT;
                }
                return NodeFilter.FILTER_ACCEPT;
            }
        }
    );

    let node: Text | null;
    while ((node = walker.nextNode() as Text | null)) {
        if (!firstTextNode) {
            firstTextNode = node;
        }
        lastTextNode = node;
    }

    if (firstTextNode && lastTextNode) {
        range.setStart(firstTextNode, 0);
        range.setEnd(lastTextNode, lastTextNode.length);
    } else {
        // Fallback: select the entire element content
        range.selectNodeContents(lineElement);
    }

    selection.removeAllRanges();
    selection.addRange(range);
}

/**
 * Handle editor input changes
 */
function handleEditorInput(): void {
    const newContent = getPlainTextContent();
    console.log('[Webview] handleEditorInput - extracted content length:', newContent.length);
    console.log('[Webview] handleEditorInput - current state content length:', state.currentContent.length);
    console.log('[Webview] handleEditorInput - content changed:', newContent !== state.currentContent);
    if (newContent !== state.currentContent) {
        // Debug: show first 200 chars of old and new content
        console.log('[Webview] OLD content preview:', state.currentContent.substring(0, 200));
        console.log('[Webview] NEW content preview:', newContent.substring(0, 200));
        state.setCurrentContent(newContent);
        updateContent(newContent);
    }
}

/**
 * Handle editor keydown events
 */
function handleEditorKeydown(e: KeyboardEvent): void {
    if (e.key === 'Tab') {
        e.preventDefault();
        document.execCommand('insertText', false, '    ');
    } else if (e.key === 'Enter' && !e.shiftKey) {
        // Handle Enter key explicitly to prevent browser from creating
        // DOM elements that break the flex layout in line-row containers.
        // The browser's default behavior creates <div> elements that become
        // flex siblings, causing text to appear side-by-side instead of on new lines.
        e.preventDefault();
        handleEnterKey();
    }
}

/**
 * Handle Enter key by inserting a newline into the content and re-rendering.
 * This prevents the browser from creating DOM elements that break the layout.
 */
function handleEnterKey(): void {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return;

    const range = selection.getRangeAt(0);
    const selectionInfo = getSelectionPosition(range);

    if (!selectionInfo) {
        // Fallback: try using execCommand if we can't determine position
        document.execCommand('insertText', false, '\n');
        return;
    }

    // Get current content and split into lines
    const lines = state.currentContent.split('\n');

    // Calculate the position to insert the newline
    // selectionInfo uses 1-based line numbers and 1-based columns
    const lineIndex = selectionInfo.startLine - 1;
    const columnIndex = selectionInfo.startColumn - 1;

    if (lineIndex < 0 || lineIndex >= lines.length) {
        // Invalid line, use fallback
        document.execCommand('insertText', false, '\n');
        return;
    }

    // If there's a selection (not collapsed), delete the selected text first
    if (selectionInfo.startLine !== selectionInfo.endLine ||
        selectionInfo.startColumn !== selectionInfo.endColumn) {
        // Handle selection deletion - for now, just delete and insert at start
        const startLineIdx = selectionInfo.startLine - 1;
        const endLineIdx = selectionInfo.endLine - 1;
        const startCol = selectionInfo.startColumn - 1;
        const endCol = selectionInfo.endColumn - 1;

        if (startLineIdx === endLineIdx) {
            // Single line selection
            const line = lines[startLineIdx];
            lines[startLineIdx] = line.substring(0, startCol) + line.substring(endCol);
        } else {
            // Multi-line selection
            const startLine = lines[startLineIdx];
            const endLine = lines[endLineIdx];
            lines[startLineIdx] = startLine.substring(0, startCol) + endLine.substring(endCol);
            lines.splice(startLineIdx + 1, endLineIdx - startLineIdx);
        }
    }

    // Now insert the newline at the cursor position
    const currentLine = lines[lineIndex] || '';
    const beforeCursor = currentLine.substring(0, columnIndex);
    const afterCursor = currentLine.substring(columnIndex);

    // Split the line at cursor position
    lines[lineIndex] = beforeCursor;
    lines.splice(lineIndex + 1, 0, afterCursor);

    // Calculate new cursor position (start of the new line)
    const newCursorLine = selectionInfo.startLine + 1;
    const newCursorColumn = 1;

    // Update content
    const newContent = lines.join('\n');
    state.setCurrentContent(newContent);
    updateContent(newContent);

    // Re-render and restore cursor
    render();

    // Restore cursor position to the new line
    setTimeout(() => {
        restoreCursorToPosition(newCursorLine, newCursorColumn - 1);
    }, 0);
}

/**
 * Restore cursor to a specific line and column position after re-render.
 */
function restoreCursorToPosition(line: number, column: number): void {
    const lineElement = editorWrapper.querySelector(`.line-content[data-line="${line}"]`);
    if (!lineElement) return;

    const target = findTextNodeAtColumn(lineElement as HTMLElement, column);
    if (!target) {
        // If no text node found, try to place cursor at start of line
        const range = document.createRange();
        range.selectNodeContents(lineElement);
        range.collapse(true);
        const selection = window.getSelection();
        if (selection) {
            selection.removeAllRanges();
            selection.addRange(range);
        }
        return;
    }

    try {
        const range = document.createRange();
        range.setStart(target.node, target.offset);
        range.collapse(true);

        const selection = window.getSelection();
        if (selection) {
            selection.removeAllRanges();
            selection.addRange(range);
        }
    } catch (e) {
        console.warn('[Webview] Could not restore cursor position:', e);
    }
}

/**
 * Find text node at a specific column position within a line element.
 */
function findTextNodeAtColumn(lineElement: HTMLElement, targetColumn: number): { node: Text; offset: number } | null {
    let currentOffset = 0;
    const walker = document.createTreeWalker(lineElement, NodeFilter.SHOW_TEXT, null);
    let currentNode: Text | null;
    let lastValidNode: Text | null = null;
    let lastValidNodeLength = 0;

    while ((currentNode = walker.nextNode() as Text | null)) {
        // Skip nodes in comment bubbles
        const parent = currentNode.parentElement;
        if (parent && parent.closest('.inline-comment-bubble, .gutter-icon')) {
            continue;
        }

        lastValidNode = currentNode;
        lastValidNodeLength = currentNode.length;

        if (currentOffset + currentNode.length >= targetColumn) {
            return {
                node: currentNode,
                offset: Math.min(targetColumn - currentOffset, currentNode.length)
            };
        }
        currentOffset += currentNode.length;
    }

    // If target is beyond content, return last node at end
    if (lastValidNode) {
        return {
            node: lastValidNode,
            offset: lastValidNodeLength
        };
    }

    return null;
}

/**
 * Check if an element should be skipped during content extraction.
 * Adapted from content-extraction module for browser DOM.
 */
function shouldSkipElement(el: HTMLElement): boolean {
    for (const cls of DEFAULT_SKIP_CLASSES) {
        if (el.classList.contains(cls)) {
            return true;
        }
    }
    return false;
}

/**
 * Check if an element is a block element.
 * Adapted from content-extraction module for browser DOM.
 */
function isBlockElement(el: HTMLElement): boolean {
    const tag = el.tagName.toLowerCase();
    if (tag === 'div' || tag === 'p') return true;
    if (el.classList.contains('line-row')) return true;
    if (el.classList.contains('block-row')) return true;
    return false;
}

/**
 * Check if BR is followed by meaningful content.
 * Adapted from content-extraction module for browser DOM.
 */
function hasMeaningfulContentAfterBr(el: HTMLElement): boolean {
    const nextSibling = el.nextSibling;
    if (!nextSibling) return false;

    if (nextSibling.nodeType === Node.TEXT_NODE) {
        const text = nextSibling.textContent?.trim();
        return Boolean(text && text.length > 0);
    }
    if (nextSibling.nodeType === Node.ELEMENT_NODE) {
        return true;
    }
    return false;
}

/**
 * Extract text from block content (code blocks, tables).
 * Adapted from content-extraction module for browser DOM.
 */
function extractBlockText(el: HTMLElement): string {
    // Check if this is a code block container
    const codeBlockEl = el.querySelector('.code-block');
    if (codeBlockEl) {
        // Extract language from the code element class (language-{lang}) or code-language span
        let language = 'text';
        const codeEl = codeBlockEl.querySelector('code');
        if (codeEl) {
            // Try to get language from class like "language-typescript" or "hljs language-typescript"
            const langMatch = codeEl.className.match(/language-(\w+)/);
            if (langMatch) {
                language = langMatch[1];
            }
        }
        // Fallback: try the code-language span
        if (language === 'text') {
            const langSpan = codeBlockEl.querySelector('.code-language');
            if (langSpan && langSpan.textContent) {
                language = langSpan.textContent.trim().toLowerCase();
            }
        }

        // Get the code content - try the data-code attribute first (most reliable)
        // The copy button stores the original code in a data-code attribute
        const copyBtn = codeBlockEl.querySelector('.code-copy-btn') as HTMLElement;

        // Don't include 'plaintext' in the code fence - it's our default for blocks without a language
        const fenceLanguage = language === 'plaintext' ? '' : language;

        if (copyBtn && copyBtn.dataset.code) {
            const codeContent = decodeURIComponent(copyBtn.dataset.code);
            return '```' + fenceLanguage + '\n' + codeContent + '\n```';
        }

        // Fallback: extract from code-line spans (preserving line breaks)
        const codeLines = codeBlockEl.querySelectorAll('.code-line');
        if (codeLines.length > 0) {
            const lines: string[] = [];
            codeLines.forEach(lineEl => {
                // Get text content, handling &nbsp; placeholder for empty lines
                let lineText = lineEl.textContent || '';
                if (lineText === '\u00a0') {
                    lineText = '';
                }
                lines.push(lineText);
            });
            return '```' + fenceLanguage + '\n' + lines.join('\n') + '\n```';
        }

        // Last fallback: just get textContent (may lose line breaks)
        const codeContent = codeEl?.textContent || '';
        return '```' + fenceLanguage + '\n' + codeContent + '\n```';
    }

    // Check for mermaid diagram container
    const mermaidEl = el.querySelector('.mermaid-container');
    if (mermaidEl) {
        // Get mermaid source from the hidden source element
        const sourceEl = mermaidEl.querySelector('.mermaid-source code');
        if (sourceEl) {
            const mermaidContent = sourceEl.textContent || '';
            return '```mermaid\n' + mermaidContent + '\n```';
        }
    }

    // For pre/code blocks (fallback for any other pre elements)
    const preElement = el.querySelector('pre');
    if (preElement) {
        const codeEl = preElement.querySelector('code') || preElement;
        // Try to extract from code-line spans first
        const codeLines = preElement.querySelectorAll('.code-line');
        if (codeLines.length > 0) {
            const lines: string[] = [];
            codeLines.forEach(lineEl => {
                let lineText = lineEl.textContent || '';
                if (lineText === '\u00a0') {
                    lineText = '';
                }
                lines.push(lineText);
            });
            // Try to detect language from code element class
            let language = '';
            if (codeEl.className) {
                const langMatch = codeEl.className.match(/language-(\w+)/);
                if (langMatch && langMatch[1] !== 'plaintext') {
                    language = langMatch[1];
                }
            }
            return '```' + language + '\n' + lines.join('\n') + '\n```';
        }

        const codeContent = codeEl.textContent || '';
        // Try to detect language from code element class
        let language = '';
        if (codeEl.className) {
            const langMatch = codeEl.className.match(/language-(\w+)/);
            if (langMatch && langMatch[1] !== 'plaintext') {
                language = langMatch[1];
            }
        }
        return '```' + language + '\n' + codeContent + '\n```';
    }

    // For tables, try to reconstruct markdown table format
    const tableEl = el.querySelector('table');
    if (tableEl) {
        const rows: string[] = [];
        tableEl.querySelectorAll('tr').forEach((tr, rowIndex) => {
            const cells: string[] = [];
            tr.querySelectorAll('th, td').forEach(cell => {
                cells.push((cell.textContent || '').trim());
            });
            rows.push('| ' + cells.join(' | ') + ' |');
            // Add separator row after header
            if (rowIndex === 0) {
                rows.push('| ' + cells.map(() => '---').join(' | ') + ' |');
            }
        });
        return rows.join('\n');
    }

    // Fallback: just get text content
    return el.textContent || '';
}

/**
 * Get plain text content from editor.
 * Uses content-extraction module logic adapted for browser DOM.
 * Handles contenteditable DOM mutations (br tags, div elements, etc.)
 */
function getPlainTextContent(): string {
    const context: ExtractionContext = {
        lines: [],
        insideLineContent: false,
        skipClasses: DEFAULT_SKIP_CLASSES
    };

    /**
     * Process a node and extract text content.
     * Adapted from content-extraction module for browser DOM.
     */
    function processNode(node: Node, isFirstChild: boolean = false): void {
        // Handle text nodes
        if (node.nodeType === Node.TEXT_NODE) {
            const text = node.textContent || '';
            if (context.lines.length === 0) {
                context.lines.push(text);
            } else {
                context.lines[context.lines.length - 1] += text;
            }
            return;
        }

        // Handle element nodes
        if (node.nodeType !== Node.ELEMENT_NODE) {
            return;
        }

        const el = node as HTMLElement;
        const tag = el.tagName.toLowerCase();

        // Skip elements that should be ignored
        if (shouldSkipElement(el)) {
            return;
        }

        // Handle BR elements
        if (tag === 'br') {
            if (!context.insideLineContent) {
                context.lines.push('');
            } else if (hasMeaningfulContentAfterBr(el)) {
                context.lines.push('');
            }
            return;
        }

        // Handle line-content elements (our rendered lines)
        if (el.classList.contains('line-content') && el.hasAttribute('data-line')) {
            if (context.lines.length === 0 ||
                context.lines[context.lines.length - 1] !== '' ||
                !isFirstChild) {
                context.lines.push('');
            }

            const wasInsideLineContent = context.insideLineContent;
            context.insideLineContent = true;

            let childIndex = 0;
            el.childNodes.forEach(child => {
                processNode(child, childIndex === 0);
                childIndex++;
            });

            context.insideLineContent = wasInsideLineContent;
            return;
        }

        // Handle line-row elements (just process children)
        if (el.classList.contains('line-row') || el.classList.contains('block-row')) {
            let childIndex = 0;
            el.childNodes.forEach(child => {
                processNode(child, childIndex === 0);
                childIndex++;
            });
            return;
        }

        // Handle block-content elements (code blocks, tables)
        if (el.classList.contains('block-content')) {
            const blockText = extractBlockText(el);
            if (blockText) {
                const blockLines = blockText.split('\n');
                blockLines.forEach((line, idx) => {
                    if (idx === 0 && context.lines.length > 0 &&
                        context.lines[context.lines.length - 1] === '') {
                        context.lines[context.lines.length - 1] = line;
                    } else {
                        context.lines.push(line);
                    }
                });
            }
            return;
        }

        // Handle other block elements (div, p created by contenteditable)
        if (isBlockElement(el)) {
            if (context.insideLineContent) {
                if (context.lines.length > 0 &&
                    context.lines[context.lines.length - 1] !== '') {
                    context.lines.push('');
                }
            } else if (context.lines.length > 0 &&
                context.lines[context.lines.length - 1] !== '' &&
                !isFirstChild) {
                context.lines.push('');
            }
        }

        // Process children for all other elements
        let childIndex = 0;
        el.childNodes.forEach(child => {
            processNode(child, childIndex === 0);
            childIndex++;
        });
    }

    processNode(editorWrapper, true);

    // Post-process: handle nbsp placeholders for empty lines
    return context.lines.map(line => {
        if (line === '\u00a0') {
            return '';
        }
        return line;
    }).join('\n');
}

/**
 * Setup comment interaction handlers (called after render)
 */
export function setupCommentInteractions(): void {
    // Click on commented text to show bubble
    document.querySelectorAll('.commented-text').forEach(el => {
        el.addEventListener('click', (e) => {
            e.stopPropagation();
            const commentId = (el as HTMLElement).dataset.commentId;
            const comment = state.findCommentById(commentId || '');
            if (comment) {
                showCommentBubble(comment, el as HTMLElement);
            }
        });
    });

    // Click on gutter icon
    document.querySelectorAll('.gutter-icon').forEach(icon => {
        icon.addEventListener('click', (e) => {
            e.stopPropagation();
            const lineRow = (icon as HTMLElement).closest('.line-row');
            const lineContentEl = lineRow?.querySelector('.line-content[data-line]') as HTMLElement;
            const lineNum = lineContentEl ? parseInt(lineContentEl.getAttribute('data-line') || '', 10) : null;

            if (!lineNum) return;

            const lineComments = state.comments.filter(c =>
                c.selection.startLine === lineNum &&
                (state.settings.showResolved || c.status !== 'resolved')
            );

            if (lineComments.length > 0) {
                const lineEl = editorWrapper.querySelector('[data-line="' + lineNum + '"]') as HTMLElement;
                if (lineEl) {
                    showCommentBubble(lineComments[0], lineEl);
                }
            }
        });
    });

    // Ctrl+Click on markdown links to open workspace files
    document.querySelectorAll('.md-link').forEach(linkEl => {
        linkEl.addEventListener('click', (e) => {
            const mouseEvent = e as MouseEvent;
            // Check for Ctrl (Windows/Linux) or Meta/Cmd (Mac)
            if (mouseEvent.ctrlKey || mouseEvent.metaKey) {
                e.preventDefault();
                e.stopPropagation();

                // Extract the URL from the link
                const urlSpan = linkEl.querySelector('.md-link-url');
                if (urlSpan) {
                    // The URL is wrapped in parentheses, e.g., "(path/to/file.md)"
                    const urlText = urlSpan.textContent || '';
                    // Remove the surrounding parentheses
                    const url = urlText.replace(/^\(|\)$/g, '');

                    if (url) {
                        // Send message to extension to open the file
                        openFile(url);
                    }
                }
            }
        });

        // Add visual hint that links are ctrl+clickable
        (linkEl as HTMLElement).title = 'Ctrl+Click to open file';
    });
}

