/**
 * Panel management for floating comment panel and inline edit panel
 * 
 * Uses shared utilities from the base-panel-manager module for common
 * functionality like drag, resize, and positioning.
 */

import { MarkdownComment } from '../types';
import { escapeHtml } from '../webview-logic/markdown-renderer';
import {
    DEFAULT_RESIZE_CONSTRAINTS,
    formatCommentDate,
    setupElementResize,
    setupPanelDrag as setupSharedPanelDrag
} from '../../shared/webview/base-panel-manager';
import { renderCommentMarkdown } from '../../shared/webview/markdown-renderer';
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
 * Calculate optimal bubble dimensions based on content
 */
function calculateBubbleDimensions(comment: MarkdownComment): { width: number; height: number } {
    const minWidth = 280;
    const maxWidth = 600;
    const minHeight = 120;
    const maxHeight = 500;
    
    // Estimate content length
    const commentLength = comment.comment.length;
    const selectedTextLength = comment.selectedText.length;
    const totalLength = commentLength + selectedTextLength;
    
    // Check for code blocks or long lines which need more width
    const hasCodeBlocks = comment.comment.includes('```');
    const hasLongLines = comment.comment.split('\n').some(line => line.length > 60);
    const lines = comment.comment.split('\n').length;
    
    // Calculate width based on content characteristics
    let width: number;
    if (hasCodeBlocks || hasLongLines) {
        // Code blocks and long lines need more width
        width = Math.min(maxWidth, Math.max(450, minWidth));
    } else if (totalLength < 100) {
        // Short comments can be narrower
        width = minWidth;
    } else if (totalLength < 300) {
        // Medium comments
        width = Math.min(380, minWidth + (totalLength - 100) * 0.5);
    } else {
        // Longer comments get wider
        width = Math.min(maxWidth, 380 + (totalLength - 300) * 0.3);
    }
    
    // Calculate height based on content
    // Approximate: ~50px for header, ~80px for selected text, rest for comment
    const baseHeight = 130; // header + selected text area + padding
    const lineHeight = 20; // approximate line height for comment text
    const estimatedCommentLines = Math.max(lines, Math.ceil(commentLength / (width / 8)));
    let height = baseHeight + (estimatedCommentLines * lineHeight);
    
    // Clamp height
    height = Math.max(minHeight, Math.min(maxHeight, height));
    
    return { width, height };
}

/**
 * Show comment bubble for viewing/interacting with a comment
 */
export function showCommentBubble(comment: MarkdownComment, anchorEl: HTMLElement): void {
    closeActiveCommentBubble();

    const bubble = document.createElement('div');
    // Build class list: base class + status class + type class
    const typeClass = comment.type && comment.type !== 'user' ? comment.type : '';
    const statusClass = comment.status === 'resolved' ? 'resolved' : '';
    bubble.className = ['inline-comment-bubble', statusClass, typeClass].filter(c => c).join(' ');
    bubble.innerHTML = renderCommentBubbleContent(comment);

    // Always use fixed positioning
    bubble.style.position = 'fixed';
    bubble.style.zIndex = '200';

    // Calculate optimal dimensions based on content
    const { width: bubbleWidth, height: bubbleHeight } = calculateBubbleDimensions(comment);
    
    const rect = anchorEl.getBoundingClientRect();
    const padding = 20;
    
    // Calculate initial position (prefer below and aligned with anchor)
    let left = rect.left;
    let top = rect.bottom + 5;
    
    // Horizontal positioning: try to center on anchor, then adjust for screen bounds
    const anchorCenterX = rect.left + (rect.width / 2);
    left = anchorCenterX - (bubbleWidth / 2);
    
    // Adjust if bubble would go off screen horizontally
    if (left + bubbleWidth > window.innerWidth - padding) {
        left = window.innerWidth - bubbleWidth - padding;
    }
    if (left < padding) {
        left = padding;
    }
    
    // Vertical positioning: prefer below, but flip above if not enough space
    const spaceBelow = window.innerHeight - rect.bottom - padding;
    const spaceAbove = rect.top - padding;
    
    if (spaceBelow < bubbleHeight && spaceAbove > spaceBelow) {
        // Not enough space below and more space above - position above
        top = rect.top - bubbleHeight - 5;
        if (top < padding) {
            top = padding;
        }
    } else {
        // Position below
        if (top + bubbleHeight > window.innerHeight - padding) {
            top = window.innerHeight - bubbleHeight - padding;
        }
    }

    bubble.style.left = left + 'px';
    bubble.style.top = top + 'px';
    bubble.style.width = bubbleWidth + 'px';
    // Set max-height but let content determine actual height up to that limit
    bubble.style.maxHeight = bubbleHeight + 'px';

    document.body.appendChild(bubble);
    state.setActiveCommentBubble({ element: bubble, anchor: anchorEl, isFixed: true });

    // Setup bubble action handlers
    setupBubbleActions(bubble, comment);
    
    // After rendering, adjust position if actual height is different
    requestAnimationFrame(() => {
        const actualHeight = bubble.offsetHeight;
        const actualWidth = bubble.offsetWidth;
        
        // Re-check vertical positioning with actual dimensions
        const currentTop = parseInt(bubble.style.top);
        if (currentTop + actualHeight > window.innerHeight - padding) {
            // Try to position above if there's more space
            const newSpaceAbove = rect.top - padding;
            if (newSpaceAbove > actualHeight) {
                bubble.style.top = (rect.top - actualHeight - 5) + 'px';
            } else {
                // Just constrain to viewport
                bubble.style.top = Math.max(padding, window.innerHeight - actualHeight - padding) + 'px';
            }
        }
        
        // Re-check horizontal positioning
        const currentLeft = parseInt(bubble.style.left);
        if (currentLeft + actualWidth > window.innerWidth - padding) {
            bubble.style.left = Math.max(padding, window.innerWidth - actualWidth - padding) + 'px';
        }
    });
}

/**
 * Get display label for comment type
 */
function getTypeLabel(type?: string): string {
    switch (type) {
        case 'ai-suggestion': return '💡 AI Suggestion';
        case 'ai-clarification': return '🔮 AI Clarification';
        case 'ai-critique': return '⚠️ AI Critique';
        case 'ai-question': return '❓ AI Question';
        default: return '';
    }
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

    // Get type label and class for AI comments
    const typeLabel = getTypeLabel(comment.type);
    const typeClass = comment.type && comment.type !== 'user' ? comment.type : '';

    // Build type badge HTML if this is an AI comment
    const typeBadge = typeLabel ? '<span class="status ' + typeClass + '">' + typeLabel + '</span>' : '';

    return '<div class="bubble-header">' +
        '<div class="bubble-meta">' + lineRange +
        '<span class="status ' + statusClass + '">' + statusLabel + '</span>' +
        typeBadge + '</div>' +
        '<div class="bubble-actions">' +
        resolveBtn +
        '<button class="bubble-action-btn" data-action="edit" title="Edit">✏️</button>' +
        '<button class="bubble-action-btn" data-action="delete" title="Delete">🗑️</button>' +
        '</div></div>' +
        '<div class="bubble-selected-text">' + escapeHtml(comment.selectedText) + '</div>' +
        '<div class="bubble-comment-text bubble-markdown-content">' + renderCommentMarkdown(comment.comment) + '</div>' +
        // Add resize handles for the bubble
        '<div class="resize-handle resize-handle-se" data-resize="se"></div>' +
        '<div class="resize-handle resize-handle-e" data-resize="e"></div>' +
        '<div class="resize-handle resize-handle-s" data-resize="s"></div>' +
        '<div class="resize-grip"></div>';
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

    // Setup resize functionality for the bubble
    setupBubbleResize(bubble);
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
        state.startInteraction();

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
            state.endInteraction();
        }
    });
}

/**
 * Setup resize functionality for comment bubble
 * Uses the shared setupElementResize utility
 */
function setupBubbleResize(bubble: HTMLElement): void {
    setupElementResize(
        bubble,
        '.resize-handle',
        DEFAULT_RESIZE_CONSTRAINTS,
        () => state.startInteraction(),
        () => state.endInteraction()
    );
}

/**
 * Setup drag functionality for panels
 * Uses the shared setupPanelDrag utility
 */
function setupPanelDrag(panel: HTMLElement): void {
    setupSharedPanelDrag(
        panel,
        '.floating-panel-header, .inline-edit-header',
        '.floating-panel-close, .inline-edit-close'
    );
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

/**
 * Scroll to a comment and show its bubble
 * Called when user clicks on a comment in the tree view
 */
export function scrollToComment(commentId: string): void {
    // Find the comment
    const comment = state.findCommentById(commentId);
    if (!comment) {
        console.warn('[Webview] Comment not found:', commentId);
        return;
    }

    // Find the commented text element
    const commentedTextEl = document.querySelector(`.commented-text[data-comment-id="${commentId}"]`) as HTMLElement;
    
    if (commentedTextEl) {
        // Scroll the element into view with some padding
        commentedTextEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
        
        // Add a highlight animation
        commentedTextEl.classList.add('comment-highlight-flash');
        setTimeout(() => {
            commentedTextEl.classList.remove('comment-highlight-flash');
        }, 2000);
        
        // Show the comment bubble after scrolling completes
        setTimeout(() => {
            showCommentBubble(comment, commentedTextEl);
        }, 300);
    } else {
        // If the commented text element is not found, try to scroll to the line
        const lineEl = document.querySelector(`.line-content[data-line="${comment.selection.startLine}"]`) as HTMLElement;
        if (lineEl) {
            lineEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
            
            // Add a highlight animation to the line
            const lineRow = lineEl.closest('.line-row') as HTMLElement;
            if (lineRow) {
                lineRow.classList.add('comment-highlight-flash');
                setTimeout(() => {
                    lineRow.classList.remove('comment-highlight-flash');
                }, 2000);
            }
            
            // Show the comment bubble
            setTimeout(() => {
                showCommentBubble(comment, lineEl);
            }, 300);
        } else {
            console.warn('[Webview] Could not find element to scroll to for comment:', commentId);
        }
    }
}

