/**
 * Panel management for floating comment panel and inline edit panel
 */

import { MarkdownComment } from '../types';
import { escapeHtml } from '../webview-logic/markdown-renderer';
import { state } from './state';
import { addComment, deleteCommentMessage, editComment, reopenComment, resolveComment } from './vscode-bridge';

// DOM element references
let floatingPanel: HTMLElement;
let floatingInput: HTMLTextAreaElement;
let floatingSelection: HTMLElement;
let inlineEditPanel: HTMLElement;
let inlineEditInput: HTMLTextAreaElement;

/**
 * Initialize panel manager with DOM elements
 */
export function initPanelManager(): void {
    floatingPanel = document.getElementById('floatingCommentPanel')!;
    floatingInput = document.getElementById('floatingCommentInput') as HTMLTextAreaElement;
    floatingSelection = document.getElementById('floatingPanelSelection')!;
    inlineEditPanel = document.getElementById('inlineEditPanel')!;
    inlineEditInput = document.getElementById('inlineEditInput') as HTMLTextAreaElement;

    // Setup panel event listeners
    setupFloatingPanelEvents();
    setupInlineEditPanelEvents();
}

/**
 * Setup floating panel event listeners
 */
function setupFloatingPanelEvents(): void {
    document.getElementById('floatingPanelClose')?.addEventListener('click', closeFloatingPanel);
    document.getElementById('floatingCancelBtn')?.addEventListener('click', closeFloatingPanel);
    document.getElementById('floatingSaveBtn')?.addEventListener('click', saveNewComment);

    // Ctrl+Enter to submit
    floatingInput.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
            e.preventDefault();
            saveNewComment();
        }
    });

    // Setup drag
    setupPanelDrag(floatingPanel);
}

/**
 * Setup inline edit panel event listeners
 */
function setupInlineEditPanelEvents(): void {
    document.getElementById('inlineEditClose')?.addEventListener('click', closeInlineEditPanel);
    document.getElementById('inlineEditCancelBtn')?.addEventListener('click', closeInlineEditPanel);
    document.getElementById('inlineEditSaveBtn')?.addEventListener('click', saveEditedComment);

    // Ctrl+Enter to submit
    inlineEditInput.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
            e.preventDefault();
            saveEditedComment();
        }
    });

    // Setup drag
    setupPanelDrag(inlineEditPanel);
}

/**
 * Show floating panel for new comment
 * Enhanced to handle edge positioning (edges are typically wider than nodes)
 */
export function showFloatingPanel(selectionRect: DOMRect, selectedText: string): void {
    floatingSelection.textContent = selectedText;
    floatingInput.value = '';

    // Position the panel near the selection
    const panelWidth = 380;
    const panelHeight = 250;
    const minPadding = 20;

    let left = selectionRect.left;
    let top = selectionRect.bottom + 10;

    // Special handling for edges (typically wider than nodes)
    // Position at the midpoint of the edge for better UX
    const isEdgeComment = selectedText.includes('Mermaid Edge:');
    if (isEdgeComment) {
        // Calculate midpoint of the edge element and center panel on it
        const midX = selectionRect.left + (selectionRect.width / 2);
        left = midX - (panelWidth / 2);
    }

    // Adjust if panel would go off-screen horizontally
    if (left + panelWidth > window.innerWidth - minPadding) {
        left = window.innerWidth - panelWidth - minPadding;
    }
    if (left < minPadding) {
        left = minPadding;
    }

    // Adjust if panel would go off-screen vertically at the bottom
    if (top + panelHeight > window.innerHeight - minPadding) {
        // Try to position above the selection
        const topAbove = selectionRect.top - panelHeight - 10;

        if (topAbove >= minPadding) {
            // Enough room above - position there
            top = topAbove;
        } else {
            // Not enough room above either - position at the best visible spot
            // Prefer below if there's more room, otherwise above
            const spaceBelow = window.innerHeight - selectionRect.bottom - minPadding;
            const spaceAbove = selectionRect.top - minPadding;

            if (spaceBelow >= spaceAbove) {
                // More space below - position below with maximum visible area
                top = Math.min(selectionRect.bottom + 10, window.innerHeight - panelHeight - minPadding);
            } else {
                // More space above - position above with minimum padding
                top = Math.max(minPadding, selectionRect.top - panelHeight - 10);
            }
        }
    }

    // Final bounds check to ensure panel is always visible
    if (top < minPadding) {
        top = minPadding;
    }
    if (top + panelHeight > window.innerHeight - minPadding) {
        top = window.innerHeight - panelHeight - minPadding;
    }

    floatingPanel.style.left = left + 'px';
    floatingPanel.style.top = top + 'px';
    floatingPanel.style.display = 'block';

    setTimeout(() => floatingInput.focus(), 50);
}

/**
 * Close floating panel
 */
export function closeFloatingPanel(): void {
    floatingPanel.style.display = 'none';
    state.setPendingSelection(null);
    floatingInput.value = '';
}

/**
 * Save new comment from floating panel
 */
function saveNewComment(): void {
    const commentText = floatingInput.value.trim();
    if (!commentText) {
        alert('Please enter a comment.');
        return;
    }

    if (state.pendingSelection) {
        addComment(commentText);
    }

    closeFloatingPanel();
}

/**
 * Show inline edit panel
 */
export function showInlineEditPanel(comment: MarkdownComment, rect: DOMRect): void {
    state.setEditingCommentId(comment.id);
    inlineEditInput.value = comment.comment;

    // Use absolute positioning relative to document
    const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
    const scrollLeft = window.pageXOffset || document.documentElement.scrollLeft;

    let left = rect.left + scrollLeft;
    let top = rect.bottom + scrollTop + 5;

    // Adjust if panel would go off-screen horizontally
    if (left + 350 > window.innerWidth + scrollLeft - 20) {
        left = window.innerWidth + scrollLeft - 370;
    }
    if (left < scrollLeft + 20) {
        left = scrollLeft + 20;
    }

    // Adjust if panel would go off-screen vertically
    const viewportBottom = scrollTop + window.innerHeight;
    if (top + 150 > viewportBottom) {
        top = rect.top + scrollTop - 160;
    }

    inlineEditPanel.style.left = left + 'px';
    inlineEditPanel.style.top = top + 'px';
    inlineEditPanel.style.display = 'block';

    setTimeout(() => inlineEditInput.focus(), 50);
}

/**
 * Close inline edit panel
 */
export function closeInlineEditPanel(): void {
    inlineEditPanel.style.display = 'none';
    state.setEditingCommentId(null);
}

/**
 * Save edited comment
 */
function saveEditedComment(): void {
    const commentText = inlineEditInput.value.trim();
    if (!commentText) {
        alert('Comment cannot be empty.');
        return;
    }

    const commentId = state.editingCommentId;
    if (commentId) {
        editComment(commentId, commentText);
    }

    closeInlineEditPanel();
}

/**
 * Show comment bubble for viewing/interacting with a comment
 */
export function showCommentBubble(comment: MarkdownComment, anchorEl: HTMLElement): void {
    closeActiveCommentBubble();

    const bubble = document.createElement('div');
    bubble.className = 'inline-comment-bubble' + (comment.status === 'resolved' ? ' resolved' : '');
    bubble.innerHTML = renderCommentBubbleContent(comment);

    // Always use fixed positioning
    bubble.style.position = 'fixed';
    bubble.style.zIndex = '200';

    const rect = anchorEl.getBoundingClientRect();
    let left = rect.left;
    let top = rect.bottom + 5;

    // Adjust if bubble would go off screen
    if (left + 350 > window.innerWidth - 20) {
        left = window.innerWidth - 370;
    }
    if (left < 20) {
        left = 20;
    }
    if (top + 200 > window.innerHeight) {
        top = rect.top - 210;
    }

    bubble.style.left = left + 'px';
    bubble.style.top = top + 'px';
    bubble.style.width = '350px';

    document.body.appendChild(bubble);
    state.setActiveCommentBubble({ element: bubble, anchor: anchorEl, isFixed: true });

    // Setup bubble action handlers
    setupBubbleActions(bubble, comment);
}

/**
 * Render comment bubble content
 */
function renderCommentBubbleContent(comment: MarkdownComment): string {
    const statusClass = comment.status;
    const statusLabel = comment.status === 'open' ? '○ Open' : '✓ Resolved';
    const resolveBtn = comment.status === 'open'
        ? '<button class="bubble-action-btn" data-action="resolve" title="Resolve">✅</button>'
        : '<button class="bubble-action-btn" data-action="reopen" title="Reopen">🔄</button>';

    const lineRange = comment.selection.startLine === comment.selection.endLine
        ? 'Line ' + comment.selection.startLine
        : 'Lines ' + comment.selection.startLine + '-' + comment.selection.endLine;

    return '<div class="bubble-header">' +
        '<div class="bubble-meta">' + lineRange +
        '<span class="status ' + statusClass + '">' + statusLabel + '</span></div>' +
        '<div class="bubble-actions">' +
        resolveBtn +
        '<button class="bubble-action-btn" data-action="edit" title="Edit">✏️</button>' +
        '<button class="bubble-action-btn" data-action="delete" title="Delete">🗑️</button>' +
        '</div></div>' +
        '<div class="bubble-selected-text">' + escapeHtml(comment.selectedText) + '</div>' +
        '<div class="bubble-comment-text">' + escapeHtml(comment.comment) + '</div>';
}

/**
 * Setup bubble action button handlers
 */
function setupBubbleActions(bubble: HTMLElement, comment: MarkdownComment): void {
    bubble.querySelectorAll('.bubble-action-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const action = (btn as HTMLElement).dataset.action;

            switch (action) {
                case 'resolve':
                    resolveComment(comment.id);
                    closeActiveCommentBubble();
                    break;
                case 'reopen':
                    reopenComment(comment.id);
                    closeActiveCommentBubble();
                    break;
                case 'edit':
                    closeActiveCommentBubble();
                    showInlineEditPanel(comment, (btn as HTMLElement).getBoundingClientRect());
                    break;
                case 'delete':
                    deleteCommentMessage(comment.id);
                    closeActiveCommentBubble();
                    break;
            }
        });
    });

    // Setup drag functionality for the bubble header
    setupBubbleDrag(bubble);
}

/**
 * Setup drag functionality for comment bubble
 */
function setupBubbleDrag(bubble: HTMLElement): void {
    const header = bubble.querySelector('.bubble-header');
    if (!header) return;

    let isDragging = false;
    let startX: number, startY: number;
    let initialLeft: number, initialTop: number;

    header.addEventListener('mousedown', (e) => {
        const event = e as MouseEvent;
        // Only start drag if clicking on header (not on buttons)
        if ((event.target as HTMLElement).closest('.bubble-action-btn')) return;

        isDragging = true;
        bubble.classList.add('dragging');

        startX = event.clientX;
        startY = event.clientY;
        initialLeft = parseInt(bubble.style.left) || 0;
        initialTop = parseInt(bubble.style.top) || 0;

        event.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
        if (!isDragging) return;

        const deltaX = e.clientX - startX;
        const deltaY = e.clientY - startY;

        let newLeft = initialLeft + deltaX;
        let newTop = initialTop + deltaY;

        // Keep bubble within viewport bounds
        const bubbleWidth = bubble.offsetWidth;
        const bubbleHeight = bubble.offsetHeight;

        newLeft = Math.max(10, Math.min(newLeft, window.innerWidth - bubbleWidth - 10));
        newTop = Math.max(10, Math.min(newTop, window.innerHeight - bubbleHeight - 10));

        bubble.style.left = newLeft + 'px';
        bubble.style.top = newTop + 'px';
    });

    document.addEventListener('mouseup', () => {
        if (isDragging) {
            isDragging = false;
            bubble.classList.remove('dragging');
        }
    });
}

/**
 * Setup drag functionality for panels
 */
function setupPanelDrag(panel: HTMLElement): void {
    const header = panel.querySelector('.floating-panel-header, .inline-edit-header');
    if (!header) return;

    let isDragging = false;
    let startX: number, startY: number;
    let initialLeft: number, initialTop: number;

    header.addEventListener('mousedown', (e) => {
        const event = e as MouseEvent;
        // Only start drag if clicking on header (not on close button)
        if ((event.target as HTMLElement).closest('.floating-panel-close, .inline-edit-close')) return;

        isDragging = true;
        panel.classList.add('dragging');

        startX = event.clientX;
        startY = event.clientY;
        initialLeft = parseInt(panel.style.left) || 0;
        initialTop = parseInt(panel.style.top) || 0;

        event.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
        if (!isDragging) return;

        const deltaX = e.clientX - startX;
        const deltaY = e.clientY - startY;

        let newLeft = initialLeft + deltaX;
        let newTop = initialTop + deltaY;

        // Keep panel within viewport bounds
        const panelWidth = panel.offsetWidth;
        const panelHeight = panel.offsetHeight;

        newLeft = Math.max(10, Math.min(newLeft, window.innerWidth - panelWidth - 10));
        newTop = Math.max(10, Math.min(newTop, window.innerHeight - panelHeight - 10));

        panel.style.left = newLeft + 'px';
        panel.style.top = newTop + 'px';
    });

    document.addEventListener('mouseup', () => {
        if (isDragging) {
            isDragging = false;
            panel.classList.remove('dragging');
        }
    });
}

/**
 * Close active comment bubble
 */
export function closeActiveCommentBubble(): void {
    const bubble = state.activeCommentBubble;
    if (bubble) {
        bubble.element.remove();
        state.setActiveCommentBubble(null);
    }
}

