/**
 * DOM event handlers for the webview
 */

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
import { requestCopyPrompt, requestDeleteAll, requestResolveAll, updateContent } from './vscode-bridge';

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
    }
}

/**
 * Get plain text content from editor
 * Handles contenteditable DOM mutations (br tags, div elements, etc.)
 */
function getPlainTextContent(): string {
    const lines: string[] = [];

    /**
     * Process a node and extract text content
     * @param node - The DOM node to process
     * @param isFirstChild - Whether this is the first child of its parent
     * @param insideLineContent - Whether we're inside a line-content element
     */
    function processNode(node: Node, isFirstChild: boolean = false, insideLineContent: boolean = false): void {
        if (node.nodeType === Node.TEXT_NODE) {
            const text = node.textContent || '';
            if (lines.length === 0) {
                lines.push(text);
            } else {
                lines[lines.length - 1] += text;
            }
        } else if (node.nodeType === Node.ELEMENT_NODE) {
            const el = node as HTMLElement;
            const tag = el.tagName.toLowerCase();

            // Skip comment bubbles and gutter icons
            if (el.classList.contains('inline-comment-bubble') ||
                el.classList.contains('gutter-icon') ||
                el.classList.contains('line-number') ||
                el.classList.contains('line-number-column')) {
                return;
            }

            // Handle line breaks
            if (tag === 'br') {
                // Only create a new line if we're NOT inside a line-content element
                // or if there's actual content after the br
                if (!insideLineContent) {
                    lines.push('');
                }
                // Inside line-content, br typically means the user pressed Enter
                // We should create ONE new line, not multiple
                else {
                    // Check if this br is followed by meaningful content
                    const nextSibling = el.nextSibling;
                    const hasContentAfter = nextSibling && (
                        (nextSibling.nodeType === Node.TEXT_NODE && nextSibling.textContent?.trim()) ||
                        (nextSibling.nodeType === Node.ELEMENT_NODE)
                    );
                    if (hasContentAfter) {
                        lines.push('');
                    }
                }
                return;
            }

            // Check if this is a block element that should start a new line
            const isBlockElement = tag === 'div' || tag === 'p' ||
                el.classList.contains('line-row') ||
                el.classList.contains('block-row');

            // For line-content with data-line, handle as a single line
            if (el.classList.contains('line-content') && el.hasAttribute('data-line')) {
                // Start a new line for each line-content element
                if (lines.length === 0 || lines[lines.length - 1] !== '' || !isFirstChild) {
                    lines.push('');
                }
                // Process children - mark that we're inside line-content
                let childIndex = 0;
                el.childNodes.forEach(child => {
                    processNode(child, childIndex === 0, true);
                    childIndex++;
                });
                return;
            }

            // For line-row elements, just process children
            if (el.classList.contains('line-row') || el.classList.contains('block-row')) {
                let childIndex = 0;
                el.childNodes.forEach(child => {
                    processNode(child, childIndex === 0, insideLineContent);
                    childIndex++;
                });
                return;
            }

            // For block-content (code blocks, tables), extract raw text
            if (el.classList.contains('block-content')) {
                // For code blocks and tables, we need to get the original markdown content
                // This is complex because the content has been transformed
                // For now, just extract text content preserving some structure
                const blockText = extractBlockText(el);
                if (blockText) {
                    blockText.split('\n').forEach((line, idx) => {
                        if (idx === 0 && lines.length > 0 && lines[lines.length - 1] === '') {
                            lines[lines.length - 1] = line;
                        } else {
                            lines.push(line);
                        }
                    });
                }
                return;
            }

            // For other block elements created by contenteditable
            // Inside line-content, nested divs/p elements mean user pressed Enter
            if (isBlockElement) {
                if (insideLineContent) {
                    // Inside line-content, block elements should create a new line
                    // but only if there's content in the current line
                    if (lines.length > 0 && lines[lines.length - 1] !== '') {
                        lines.push('');
                    }
                } else if (lines.length > 0 && lines[lines.length - 1] !== '' && !isFirstChild) {
                    lines.push('');
                }
            }

            // Process children
            let childIndex = 0;
            el.childNodes.forEach(child => {
                processNode(child, childIndex === 0, insideLineContent);
                childIndex++;
            });
        }
    }

    processNode(editorWrapper, true, false);

    // Clean up: handle nbsp placeholders for empty lines and normalize
    return lines.map(line => {
        if (line === '\u00a0') {
            return '';
        }
        return line;
    }).join('\n');
}

/**
 * Extract text from block content (code blocks, tables)
 */
function extractBlockText(el: HTMLElement): string {
    // For pre/code blocks, get the text content
    const preElement = el.querySelector('pre');
    if (preElement) {
        const codeEl = preElement.querySelector('code') || preElement;
        return codeEl.textContent || '';
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
}

