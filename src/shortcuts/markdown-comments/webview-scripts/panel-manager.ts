/**
 * Panel management for floating comment panel and inline edit panel
 */

import { MarkdownComment } from '../types';
import { escapeHtml } from '../webview-logic/markdown-renderer';
import { state } from './state';
import { addComment, deleteCommentMessage, editComment, reopenComment, resolveComment } from './vscode-bridge';

/**
 * Render markdown content to HTML for display in comment bubbles.
 * Supports: headings, bold, italic, strikethrough, code, code blocks,
 * links, blockquotes, and lists.
 * 
 * @param markdown - The raw markdown text
 * @returns HTML string with rendered markdown
 */
function renderCommentMarkdown(markdown: string): string {
    if (!markdown) return '';
    
    const lines = markdown.split('\n');
    const htmlLines: string[] = [];
    let inCodeBlock = false;
    let codeBlockLang = '';
    let codeBlockContent: string[] = [];
    let inList = false;
    let listType: 'ul' | 'ol' = 'ul';
    
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        
        // Handle code blocks
        if (line.startsWith('```')) {
            if (!inCodeBlock) {
                // Start code block
                inCodeBlock = true;
                codeBlockLang = line.slice(3).trim();
                codeBlockContent = [];
            } else {
                // End code block
                inCodeBlock = false;
                const langClass = codeBlockLang ? ` class="language-${escapeHtml(codeBlockLang)}"` : '';
                htmlLines.push(`<pre class="comment-code-block"><code${langClass}>${escapeHtml(codeBlockContent.join('\n'))}</code></pre>`);
                codeBlockContent = [];
                codeBlockLang = '';
            }
            continue;
        }
        
        if (inCodeBlock) {
            codeBlockContent.push(line);
            continue;
        }
        
        // Check for list items
        const ulMatch = line.match(/^(\s*)([-*+])\s+(.*)$/);
        const olMatch = line.match(/^(\s*)(\d+\.)\s+(.*)$/);
        
        if (ulMatch || olMatch) {
            if (!inList) {
                inList = true;
                listType = ulMatch ? 'ul' : 'ol';
                htmlLines.push(`<${listType} class="comment-list">`);
            }
            const content = ulMatch ? ulMatch[3] : olMatch![3];
            htmlLines.push(`<li>${renderInlineMarkdown(content)}</li>`);
            
            // Check if next line is not a list item to close the list
            const nextLine = lines[i + 1];
            if (!nextLine || (!nextLine.match(/^(\s*)([-*+])\s+/) && !nextLine.match(/^(\s*)(\d+\.)\s+/))) {
                htmlLines.push(`</${listType}>`);
                inList = false;
            }
            continue;
        }
        
        // Close any open list if we hit a non-list line
        if (inList) {
            htmlLines.push(`</${listType}>`);
            inList = false;
        }
        
        // Empty line
        if (line.trim() === '') {
            htmlLines.push('<br>');
            continue;
        }
        
        // Headings (# to ######)
        const headingMatch = line.match(/^(#{1,6})\s+(.*)$/);
        if (headingMatch) {
            const level = headingMatch[1].length;
            const content = renderInlineMarkdown(headingMatch[2]);
            htmlLines.push(`<h${level} class="comment-heading comment-h${level}">${content}</h${level}>`);
            continue;
        }
        
        // Blockquotes (>)
        if (line.startsWith('>')) {
            const content = line.replace(/^>\s*/, '');
            htmlLines.push(`<blockquote class="comment-blockquote">${renderInlineMarkdown(content)}</blockquote>`);
            continue;
        }
        
        // Horizontal rule
        if (/^(---+|\*\*\*+|___+)\s*$/.test(line)) {
            htmlLines.push('<hr class="comment-hr">');
            continue;
        }
        
        // Regular paragraph
        htmlLines.push(`<p class="comment-paragraph">${renderInlineMarkdown(line)}</p>`);
    }
    
    // Close any unclosed code block
    if (inCodeBlock && codeBlockContent.length > 0) {
        htmlLines.push(`<pre class="comment-code-block"><code>${escapeHtml(codeBlockContent.join('\n'))}</code></pre>`);
    }
    
    // Close any unclosed list
    if (inList) {
        htmlLines.push(`</${listType}>`);
    }
    
    return htmlLines.join('');
}

/**
 * Render inline markdown elements (bold, italic, code, links, etc.)
 * 
 * @param text - The text to process
 * @returns HTML string with rendered inline elements
 */
function renderInlineMarkdown(text: string): string {
    if (!text) return '';
    
    let html = escapeHtml(text);
    
    // Inline code (must be before bold/italic to avoid conflicts)
    html = html.replace(/`([^`]+)`/g, '<code class="comment-inline-code">$1</code>');
    
    // Bold + Italic (***text*** or ___text___)
    html = html.replace(/\*\*\*([^*]+)\*\*\*/g, '<strong><em>$1</em></strong>');
    html = html.replace(/___([^_]+)___/g, '<strong><em>$1</em></strong>');
    
    // Bold (**text** or __text__)
    html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/__([^_]+)__/g, '<strong>$1</strong>');
    
    // Italic (*text* or _text_) - careful not to match inside bold
    html = html.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '<em>$1</em>');
    html = html.replace(/(?<!_)_([^_]+)_(?!_)/g, '<em>$1</em>');
    
    // Strikethrough (~~text~~)
    html = html.replace(/~~([^~]+)~~/g, '<del>$1</del>');
    
    // Links [text](url) - make clickable
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" class="comment-link" target="_blank" rel="noopener">$1</a>');
    
    return html;
}

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
    // Build class list: base class + status class + type class
    const typeClass = comment.type && comment.type !== 'user' ? comment.type : '';
    const statusClass = comment.status === 'resolved' ? 'resolved' : '';
    bubble.className = ['inline-comment-bubble', statusClass, typeClass].filter(c => c).join(' ');
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
 */
function setupBubbleResize(bubble: HTMLElement): void {
    const handles = bubble.querySelectorAll('.resize-handle');
    if (handles.length === 0) return;

    let isResizing = false;
    let currentHandle: string | null = null;
    let startX: number, startY: number;
    let initialWidth: number, initialHeight: number;
    let initialLeft: number, initialTop: number;

    // Min/max constraints
    const minWidth = 280;
    const minHeight = 120;
    const maxWidth = window.innerWidth - 40;
    const maxHeight = window.innerHeight - 40;

    handles.forEach(handle => {
        handle.addEventListener('mousedown', (e) => {
            const event = e as MouseEvent;
            event.preventDefault();
            event.stopPropagation();

            isResizing = true;
            currentHandle = (handle as HTMLElement).dataset.resize || null;
            bubble.classList.add('resizing');
            (handle as HTMLElement).classList.add('active');
            state.startInteraction();

            startX = event.clientX;
            startY = event.clientY;
            initialWidth = bubble.offsetWidth;
            initialHeight = bubble.offsetHeight;
            initialLeft = parseInt(bubble.style.left) || 0;
            initialTop = parseInt(bubble.style.top) || 0;
        });
    });

    document.addEventListener('mousemove', (e) => {
        if (!isResizing || !currentHandle) return;

        const deltaX = e.clientX - startX;
        const deltaY = e.clientY - startY;

        let newWidth = initialWidth;
        let newHeight = initialHeight;
        let newLeft = initialLeft;
        let newTop = initialTop;

        // Calculate new dimensions based on which handle is being dragged
        switch (currentHandle) {
            case 'e': // East (right edge)
                newWidth = Math.max(minWidth, Math.min(maxWidth, initialWidth + deltaX));
                break;
            case 's': // South (bottom edge)
                newHeight = Math.max(minHeight, Math.min(maxHeight, initialHeight + deltaY));
                break;
            case 'se': // Southeast (bottom-right corner)
                newWidth = Math.max(minWidth, Math.min(maxWidth, initialWidth + deltaX));
                newHeight = Math.max(minHeight, Math.min(maxHeight, initialHeight + deltaY));
                break;
            case 'w': // West (left edge)
                newWidth = Math.max(minWidth, Math.min(maxWidth, initialWidth - deltaX));
                newLeft = initialLeft + (initialWidth - newWidth);
                break;
            case 'n': // North (top edge)
                newHeight = Math.max(minHeight, Math.min(maxHeight, initialHeight - deltaY));
                newTop = initialTop + (initialHeight - newHeight);
                break;
            case 'sw': // Southwest (bottom-left corner)
                newWidth = Math.max(minWidth, Math.min(maxWidth, initialWidth - deltaX));
                newHeight = Math.max(minHeight, Math.min(maxHeight, initialHeight + deltaY));
                newLeft = initialLeft + (initialWidth - newWidth);
                break;
            case 'ne': // Northeast (top-right corner)
                newWidth = Math.max(minWidth, Math.min(maxWidth, initialWidth + deltaX));
                newHeight = Math.max(minHeight, Math.min(maxHeight, initialHeight - deltaY));
                newTop = initialTop + (initialHeight - newHeight);
                break;
            case 'nw': // Northwest (top-left corner)
                newWidth = Math.max(minWidth, Math.min(maxWidth, initialWidth - deltaX));
                newHeight = Math.max(minHeight, Math.min(maxHeight, initialHeight - deltaY));
                newLeft = initialLeft + (initialWidth - newWidth);
                newTop = initialTop + (initialHeight - newHeight);
                break;
        }

        // Keep within viewport bounds
        if (newLeft < 10) {
            newWidth = newWidth - (10 - newLeft);
            newLeft = 10;
        }
        if (newTop < 10) {
            newHeight = newHeight - (10 - newTop);
            newTop = 10;
        }
        if (newLeft + newWidth > window.innerWidth - 10) {
            newWidth = window.innerWidth - newLeft - 10;
        }
        if (newTop + newHeight > window.innerHeight - 10) {
            newHeight = window.innerHeight - newTop - 10;
        }

        // Apply new dimensions
        bubble.style.width = newWidth + 'px';
        bubble.style.height = newHeight + 'px';
        bubble.style.left = newLeft + 'px';
        bubble.style.top = newTop + 'px';
    });

    document.addEventListener('mouseup', () => {
        if (isResizing) {
            isResizing = false;
            currentHandle = null;
            bubble.classList.remove('resizing');
            bubble.querySelectorAll('.resize-handle').forEach(h => {
                h.classList.remove('active');
            });
            state.endInteraction();
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

