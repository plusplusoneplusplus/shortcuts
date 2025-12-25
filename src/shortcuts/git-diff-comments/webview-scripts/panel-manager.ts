/**
 * Panel manager for comment input and display
 * 
 * Uses shared utilities from the base-panel-manager module for common
 * functionality like drag, resize, positioning, and date formatting.
 */

import { AskAIContext, DiffAIInstructionType, DiffComment, DiffSide, SelectionState, SerializedAICommand } from './types';
import { endInteraction, getState, setCommentPanelOpen, setEditingCommentId, startInteraction } from './state';
import { clearSelection, toDiffSelection } from './selection-handler';
import { sendAddComment, sendAskAI, sendDeleteComment, sendEditComment, sendReopenComment, sendResolveComment } from './vscode-bridge';
import {
    calculateBubbleDimensions,
    DEFAULT_RESIZE_CONSTRAINTS,
    formatCommentDate,
    setupBubbleDrag as setupSharedBubbleDrag,
    setupElementResize,
    setupPanelDrag as setupSharedPanelDrag
} from '../../shared/webview/base-panel-manager';
import { renderCommentMarkdown } from '../../shared/webview/markdown-renderer';

/**
 * Default AI commands when none are configured
 */
const DEFAULT_AI_COMMANDS: SerializedAICommand[] = [
    { id: 'clarify', label: 'Clarify', icon: '💡', order: 1 },
    { id: 'go-deeper', label: 'Go Deeper', icon: '🔍', order: 2 },
    { id: 'custom', label: 'Custom...', icon: '💬', order: 99, isCustomInput: true }
];

/**
 * DOM element references
 */
let commentPanel: HTMLElement | null = null;
let commentInput: HTMLTextAreaElement | null = null;
let selectedTextPreview: HTMLElement | null = null;
let submitButton: HTMLButtonElement | null = null;
let cancelButton: HTMLButtonElement | null = null;
let closeButton: HTMLButtonElement | null = null;
let commentsListPanel: HTMLElement | null = null;
let commentsListBody: HTMLElement | null = null;
let closeCommentsListButton: HTMLButtonElement | null = null;
let contextMenu: HTMLElement | null = null;
let contextMenuAddComment: HTMLElement | null = null;
// Ask AI context menu elements
let contextMenuAskAI: HTMLElement | null = null;
let askAISubmenu: HTMLElement | null = null;
// Custom instruction dialog elements
let customInstructionDialog: HTMLElement | null = null;
let customInstructionClose: HTMLElement | null = null;
let customInstructionSelection: HTMLElement | null = null;
let customInstructionInput: HTMLTextAreaElement | null = null;
let customInstructionCancelBtn: HTMLElement | null = null;
let customInstructionSubmitBtn: HTMLElement | null = null;
let customInstructionOverlay: HTMLElement | null = null;
// Current command ID for custom instruction dialog
let pendingCustomCommandId: string = 'custom';

// Active comment bubble (single floating bubble like markdown review)
let activeCommentBubble: HTMLElement | null = null;

/**
 * Current selection for the comment panel
 */
let currentPanelSelection: SelectionState | null = null;

/**
 * Saved selection for Ask AI (used when showing custom instruction dialog)
 */
let savedSelectionForAskAI: SelectionState | null = null;

/**
 * Get the AI commands to display in menus
 */
function getAICommands(): SerializedAICommand[] {
    const state = getState();
    const commands = state.settings.aiCommands;
    if (commands && commands.length > 0) {
        return [...commands].sort((a, b) => (a.order ?? 100) - (b.order ?? 100));
    }
    return DEFAULT_AI_COMMANDS;
}

/**
 * Build the AI submenu HTML dynamically
 */
function buildAISubmenuHTML(commands: SerializedAICommand[]): string {
    return commands.map(cmd => {
        const icon = cmd.icon ? `<span class="menu-icon">${cmd.icon}</span>` : '';
        const dataCustomInput = cmd.isCustomInput ? 'data-custom-input="true"' : '';
        return `<div class="context-menu-item ask-ai-item" data-command-id="${cmd.id}" ${dataCustomInput}>
            ${icon}${cmd.label}
        </div>`;
    }).join('');
}

/**
 * Rebuild the AI submenu based on current settings
 */
export function rebuildAISubmenu(): void {
    if (!askAISubmenu) return;

    const commands = getAICommands();
    askAISubmenu.innerHTML = buildAISubmenuHTML(commands);

    // Attach click handlers to all AI items
    askAISubmenu.querySelectorAll('.ask-ai-item').forEach(item => {
        item.addEventListener('click', (e) => {
            e.stopPropagation();
            const element = item as HTMLElement;
            const commandId = element.dataset.commandId || '';
            const isCustomInput = element.dataset.customInput === 'true';

            hideContextMenu();
            if (isCustomInput) {
                pendingCustomCommandId = commandId;
                showCustomInstructionDialog();
            } else {
                handleAskAI(commandId);
            }
        });
    });
}

/**
 * Initialize panel elements
 */
export function initPanelElements(): void {
    commentPanel = document.getElementById('comment-panel');
    commentInput = document.getElementById('comment-input') as HTMLTextAreaElement;
    selectedTextPreview = document.getElementById('selected-text-preview');
    submitButton = document.getElementById('submit-comment') as HTMLButtonElement;
    cancelButton = document.getElementById('cancel-comment') as HTMLButtonElement;
    closeButton = document.getElementById('close-panel') as HTMLButtonElement;
    commentsListPanel = document.getElementById('comments-list');
    commentsListBody = document.getElementById('comments-list-body');
    closeCommentsListButton = document.getElementById('close-comments-list') as HTMLButtonElement;
    contextMenu = document.getElementById('custom-context-menu');
    contextMenuAddComment = document.getElementById('context-menu-add-comment');
    
    // Ask AI context menu elements
    contextMenuAskAI = document.getElementById('context-menu-ask-ai');
    askAISubmenu = document.getElementById('ask-ai-submenu');

    // Custom instruction dialog elements
    customInstructionDialog = document.getElementById('custom-instruction-dialog');
    customInstructionClose = document.getElementById('custom-instruction-close');
    customInstructionSelection = document.getElementById('custom-instruction-selection');
    customInstructionInput = document.getElementById('custom-instruction-input') as HTMLTextAreaElement;
    customInstructionCancelBtn = document.getElementById('custom-instruction-cancel');
    customInstructionSubmitBtn = document.getElementById('custom-instruction-submit');

    // Setup event listeners
    if (submitButton) {
        submitButton.addEventListener('click', handleSubmitComment);
    }

    if (cancelButton) {
        cancelButton.addEventListener('click', hideCommentPanel);
    }

    if (closeButton) {
        closeButton.addEventListener('click', hideCommentPanel);
    }

    if (closeCommentsListButton) {
        closeCommentsListButton.addEventListener('click', hideCommentsList);
    }

    if (contextMenuAddComment) {
        contextMenuAddComment.addEventListener('click', () => {
            if (currentPanelSelection) {
                showCommentPanel(currentPanelSelection);
                hideContextMenu();
            }
        });
    }

    // Ask AI submenu event listeners
    if (contextMenuAskAI) {
        contextMenuAskAI.addEventListener('mouseenter', positionAskAISubmenu);
    }

    // Build initial AI submenu with default commands
    rebuildAISubmenu();

    // Custom instruction dialog event listeners
    setupCustomInstructionDialogListeners();

    // Hide context menu on click anywhere else
    document.addEventListener('click', (e) => {
        // Only hide if we clicked outside the context menu
        // But if we clicked the "Add Comment" item, the click handler above handles it
        if (contextMenu && !contextMenu.contains(e.target as Node)) {
            hideContextMenu();
        }
    });

    // Handle keyboard shortcuts
    if (commentInput) {
        commentInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                handleSubmitComment();
            } else if (e.key === 'Escape') {
                hideCommentPanel();
            }
        });
    }

    // Setup drag functionality for panels
    if (commentPanel) {
        setupPanelDrag(commentPanel);
    }
    if (commentsListPanel) {
        setupPanelDrag(commentsListPanel);
    }
}

/**
 * Show the comment panel for adding a new comment
 */
export function showCommentPanel(selection: SelectionState): void {
    if (!commentPanel || !commentInput || !selectedTextPreview) {
        console.error('Comment panel elements not found');
        return;
    }

    currentPanelSelection = selection;
    setCommentPanelOpen(true);
    setEditingCommentId(null);

    // Update preview
    const previewText = selection.selectedText.length > 100
        ? selection.selectedText.substring(0, 100) + '...'
        : selection.selectedText;
    selectedTextPreview.textContent = previewText;

    // Clear input
    commentInput.value = '';

    // Update panel title
    const titleEl = commentPanel.querySelector('.comment-panel-title');
    if (titleEl) {
        titleEl.textContent = 'Add Comment';
    }

    // Update button text
    if (submitButton) {
        submitButton.textContent = 'Add Comment';
    }

    // Show panel
    commentPanel.classList.remove('hidden');

    // Position panel near selection
    positionPanelNearSelection();

    // Focus input
    commentInput.focus();
}

/**
 * Show the comment panel for editing an existing comment
 */
export function showEditCommentPanel(comment: DiffComment): void {
    if (!commentPanel || !commentInput || !selectedTextPreview) {
        console.error('Comment panel elements not found');
        return;
    }

    currentPanelSelection = null;
    setCommentPanelOpen(true);
    setEditingCommentId(comment.id);

    // Update preview
    const previewText = comment.selectedText.length > 100
        ? comment.selectedText.substring(0, 100) + '...'
        : comment.selectedText;
    selectedTextPreview.textContent = previewText;

    // Set current comment text
    commentInput.value = comment.comment;

    // Update panel title
    const titleEl = commentPanel.querySelector('.comment-panel-title');
    if (titleEl) {
        titleEl.textContent = 'Edit Comment';
    }

    // Update button text
    if (submitButton) {
        submitButton.textContent = 'Save Changes';
    }

    // Show panel
    commentPanel.classList.remove('hidden');

    // Focus input
    commentInput.focus();
    commentInput.select();
}

/**
 * Hide the comment panel
 */
export function hideCommentPanel(): void {
    if (commentPanel) {
        commentPanel.classList.add('hidden');
    }
    setCommentPanelOpen(false);
    setEditingCommentId(null);
    currentPanelSelection = null;
    clearSelection();
}

/**
 * Handle submit button click
 */
function handleSubmitComment(): void {
    if (!commentInput) return;

    const commentText = commentInput.value.trim();
    if (!commentText) {
        return;
    }

    const state = getState();

    if (state.editingCommentId) {
        // Edit existing comment
        sendEditComment(state.editingCommentId, commentText);
    } else if (currentPanelSelection) {
        // Add new comment
        const diffSelection = toDiffSelection(currentPanelSelection);
        sendAddComment(diffSelection, currentPanelSelection.selectedText, commentText);
    }

    hideCommentPanel();
}

/**
 * Position the panel near the current selection
 */
function positionPanelNearSelection(): void {
    if (!commentPanel) return;

    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) {
        // Center in viewport
        commentPanel.style.top = '50%';
        commentPanel.style.left = '50%';
        commentPanel.style.transform = 'translate(-50%, -50%)';
        return;
    }

    const range = selection.getRangeAt(0);
    const rect = range.getBoundingClientRect();

    // Position below the selection
    const top = rect.bottom + 10;
    const left = rect.left;

    // Ensure panel stays within viewport
    const panelRect = commentPanel.getBoundingClientRect();
    const maxTop = window.innerHeight - panelRect.height - 20;
    const maxLeft = window.innerWidth - panelRect.width - 20;

    commentPanel.style.top = `${Math.min(Math.max(10, top), maxTop)}px`;
    commentPanel.style.left = `${Math.min(Math.max(10, left), maxLeft)}px`;
    commentPanel.style.transform = 'none';
}

/**
 * Show comments for a specific line
 * Uses single floating bubble approach like markdown review for consistency
 * @param comments - The comments to display
 * @param anchorElement - Optional element to position the bubble near
 */
export function showCommentsForLine(comments: DiffComment[], anchorElement?: HTMLElement): void {
    if (comments.length === 0) {
        return;
    }

    // Close any existing bubble
    closeActiveCommentBubble();
    hideCommentsList();

    if (comments.length === 1 && anchorElement) {
        // Single comment: show as floating bubble (like markdown review)
        showCommentBubble(comments[0], anchorElement);
    } else if (anchorElement) {
        // Multiple comments: show in list panel positioned near the anchor
        showCommentsInListPanel(comments);
        positionCommentsListNearElement(anchorElement, calculateOptimalPanelWidth(comments));
    } else {
        // Fallback: show in list panel at default position
        showCommentsInListPanel(comments);
    }
}

/**
 * Show a single comment in a floating bubble (like markdown review)
 */
function showCommentBubble(comment: DiffComment, anchorEl: HTMLElement): void {
    closeActiveCommentBubble();

    const bubble = document.createElement('div');
    // Build class list: base class + status class + type class
    const typeClass = comment.type && comment.type !== 'user' ? comment.type : '';
    const statusClass = comment.status === 'resolved' ? 'resolved' : '';
    bubble.className = ['inline-comment-bubble', statusClass, typeClass].filter(c => c).join(' ');
    bubble.dataset.commentId = comment.id;

    // Render bubble content (similar to markdown review's renderCommentBubbleContent)
    bubble.innerHTML = renderCommentBubbleContent(comment);

    // Always use fixed positioning
    bubble.style.position = 'fixed';
    bubble.style.zIndex = '1000';

    // Calculate optimal dimensions based on content
    const hasCodeBlocks = comment.comment.includes('```');
    const hasLongLines = comment.comment.split('\n').some(line => line.length > 60);
    const lineCount = comment.comment.split('\n').length;
    const { width: bubbleWidth, height: bubbleHeight } = calculateBubbleDimensions(
        comment.comment.length,
        comment.selectedText.length,
        hasCodeBlocks,
        hasLongLines,
        lineCount
    );

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
    activeCommentBubble = bubble;

    // Setup bubble action handlers
    setupBubbleActions(bubble, comment);

    // Setup drag and resize
    setupBubbleDrag(bubble);
    setupBubbleResize(bubble);

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
 * Render comment bubble content (matches markdown review's approach)
 */
function renderCommentBubbleContent(comment: DiffComment): string {
    const statusLabel = comment.status === 'open' ? '○ Open' : '✓ Resolved';
    const resolveBtn = comment.status === 'open'
        ? '<button class="bubble-action-btn" data-action="resolve" title="Resolve">✅</button>'
        : '<button class="bubble-action-btn" data-action="reopen" title="Reopen">🔄</button>';

    // Line range info
    const startLine = comment.selection.newStartLine ?? comment.selection.oldStartLine ?? 0;
    const endLine = comment.selection.newEndLine ?? comment.selection.oldEndLine ?? startLine;
    const lineRange = startLine === endLine
        ? `Line ${startLine}`
        : `Lines ${startLine}-${endLine}`;

    // Get type label and class for AI comments
    const typeLabel = getTypeLabel(comment.type);
    const typeClass = comment.type && comment.type !== 'user' ? comment.type : '';

    // Build type badge HTML if this is an AI comment
    const typeBadge = typeLabel ? `<span class="status ${typeClass}">${typeLabel}</span>` : '';

    // Escape selected text for safe display
    const escapedSelectedText = escapeHtml(comment.selectedText);

    return `<div class="bubble-header">
        <div class="bubble-meta">${lineRange}
        <span class="status ${comment.status}">${statusLabel}</span>
        ${typeBadge}</div>
        <div class="bubble-actions">
        ${resolveBtn}
        <button class="bubble-action-btn" data-action="edit" title="Edit">✏️</button>
        <button class="bubble-action-btn" data-action="delete" title="Delete">🗑️</button>
        </div></div>
        <div class="bubble-selected-text">${escapedSelectedText}</div>
        <div class="bubble-comment-text bubble-markdown-content">${renderCommentMarkdown(comment.comment)}</div>
        <div class="resize-handle resize-handle-se" data-resize="se"></div>
        <div class="resize-handle resize-handle-e" data-resize="e"></div>
        <div class="resize-handle resize-handle-s" data-resize="s"></div>
        <div class="resize-grip"></div>`;
}

/**
 * Escape HTML for safe display
 */
function escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

/**
 * Setup bubble action button handlers
 */
function setupBubbleActions(bubble: HTMLElement, comment: DiffComment): void {
    bubble.querySelectorAll('.bubble-action-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const action = (btn as HTMLElement).dataset.action;

            switch (action) {
                case 'resolve':
                    sendResolveComment(comment.id);
                    closeActiveCommentBubble();
                    break;
                case 'reopen':
                    sendReopenComment(comment.id);
                    closeActiveCommentBubble();
                    break;
                case 'edit':
                    closeActiveCommentBubble();
                    showEditCommentPanel(comment);
                    break;
                case 'delete':
                    sendDeleteComment(comment.id);
                    closeActiveCommentBubble();
                    break;
            }
        });
    });
}

/**
 * Close the active comment bubble
 */
export function closeActiveCommentBubble(): void {
    if (activeCommentBubble) {
        activeCommentBubble.remove();
        activeCommentBubble = null;
    }
}

/**
 * Fallback: Show comments in the list panel (for backward compatibility)
 */
function showCommentsInListPanel(comments: DiffComment[]): void {
    const listPanel = commentsListPanel;
    const listBody = commentsListBody;
    
    if (!listPanel || !listBody) {
        console.error('Comments list elements not found');
        return;
    }

    // Clear existing content
    listBody.innerHTML = '';

    // Add each comment
    comments.forEach(comment => {
        const commentEl = createCommentElement(comment);
        listBody.appendChild(commentEl);
    });

    // Calculate and set dynamic width based on content
    const optimalWidth = calculateOptimalPanelWidth(comments);
    listPanel.style.width = `${optimalWidth}px`;

    // Show panel
    listPanel.classList.remove('hidden');
}

/**
 * Position the comments list panel near a given element
 * Positions BELOW the element so it doesn't overlap with the highlighted line
 * Offset to the right to avoid overlapping with line numbers
 * @param element - The element to position near
 * @param panelWidth - Optional dynamic panel width (defaults to 350)
 */
function positionCommentsListNearElement(element: HTMLElement, panelWidth: number = 350): void {
    if (!commentsListPanel) return;

    const rect = element.getBoundingClientRect();
    const panelMaxHeight = window.innerHeight * 0.7; // 70vh from CSS
    const padding = 20;
    const lineHeight = 24; // Approximate line height
    const linesBelow = 3; // Show panel 3 lines below the highlighted line
    const leftOffset = 120; // Offset to the right to avoid line numbers

    // Calculate position - position BELOW the element (a few lines down)
    // Add leftOffset to move panel to the right of line numbers
    let left = rect.left + leftOffset;
    let top = rect.bottom + (lineHeight * linesBelow); // Position a few lines below

    // If panel would go off the right edge, adjust left position
    if (left + panelWidth > window.innerWidth - padding) {
        left = window.innerWidth - panelWidth - padding;
    }

    // Ensure panel doesn't go off the left edge (but allow some overlap with line numbers area)
    if (left < padding + 60) {
        left = padding + 60;
    }

    // Ensure panel doesn't go off the bottom - if so, show above the element instead
    const estimatedHeight = Math.min(panelMaxHeight, 300); // Estimate panel height
    if (top + estimatedHeight > window.innerHeight - padding) {
        // Position above the element instead
        top = rect.top - estimatedHeight - lineHeight;
        // If that would go off the top, just position at the bottom of viewport
        if (top < padding) {
            top = window.innerHeight - estimatedHeight - padding;
        }
    }

    // Ensure panel doesn't go off the top
    if (top < padding) {
        top = padding;
    }

    commentsListPanel.style.right = 'auto';
    commentsListPanel.style.left = `${left}px`;
    commentsListPanel.style.top = `${top}px`;
}

/**
 * Hide comments list
 */
export function hideCommentsList(): void {
    if (commentsListPanel) {
        commentsListPanel.classList.add('hidden');
    }
}

/**
 * Get type label for AI comments
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
 * Calculate optimal panel width based on comments content
 * Uses the shared calculateBubbleDimensions utility for consistency
 */
function calculateOptimalPanelWidth(comments: DiffComment[]): number {
    const minWidth = 350;
    const maxWidth = 600;
    
    // Find the longest comment
    let maxContentLength = 0;
    let hasCodeBlocks = false;
    let hasLongLines = false;
    let maxLineCount = 1;
    
    for (const comment of comments) {
        const length = comment.comment.length + comment.selectedText.length;
        if (length > maxContentLength) {
            maxContentLength = length;
        }
        if (comment.comment.includes('```')) {
            hasCodeBlocks = true;
        }
        if (comment.comment.split('\n').some(line => line.length > 60)) {
            hasLongLines = true;
        }
        maxLineCount = Math.max(maxLineCount, comment.comment.split('\n').length);
    }
    
    // Use the shared utility for consistent sizing
    const { width } = calculateBubbleDimensions(
        maxContentLength,
        0, // selectedTextLength already included in maxContentLength
        hasCodeBlocks,
        hasLongLines,
        maxLineCount
    );
    
    // Clamp to our panel-specific bounds
    return Math.max(minWidth, Math.min(maxWidth, width));
}

/**
 * Create a comment element for the list
 * Uses the same structure as markdown review's comment bubble for consistent look
 */
function createCommentElement(comment: DiffComment): HTMLElement {
    const div = document.createElement('div');
    // Build class list: base class + status class + type class
    // Use 'inline-comment-bubble' to match markdown review styling
    const typeClass = comment.type && comment.type !== 'user' ? comment.type : '';
    const statusClass = comment.status === 'resolved' ? 'resolved' : '';
    div.className = ['inline-comment-bubble', statusClass, typeClass].filter(c => c).join(' ');
    div.dataset.commentId = comment.id;

    // Header with meta info and action buttons (matches markdown review's bubble-header)
    const header = document.createElement('div');
    header.className = 'bubble-header';
    
    // Left side: meta info (line range, status badge, type badge)
    const headerMeta = document.createElement('div');
    headerMeta.className = 'bubble-meta';
    
    // Line range info (like markdown review shows "Line X" or "Lines X-Y")
    // For diff view, use newStartLine/newEndLine if available, otherwise oldStartLine/oldEndLine
    const lineRange = document.createElement('span');
    const startLine = comment.selection.newStartLine ?? comment.selection.oldStartLine ?? 0;
    const endLine = comment.selection.newEndLine ?? comment.selection.oldEndLine ?? startLine;
    lineRange.textContent = startLine === endLine 
        ? `Line ${startLine}` 
        : `Lines ${startLine}-${endLine}`;
    headerMeta.appendChild(lineRange);
    
    // Status badge (○ Open or ✓ Resolved)
    const statusBadge = document.createElement('span');
    statusBadge.className = `status ${comment.status}`;
    statusBadge.textContent = comment.status === 'open' ? '○ Open' : '✓ Resolved';
    headerMeta.appendChild(statusBadge);
    
    // Add type badge for AI comments
    const typeLabel = getTypeLabel(comment.type);
    if (typeLabel) {
        const typeBadge = document.createElement('span');
        typeBadge.className = `status ${comment.type}`;
        typeBadge.textContent = typeLabel;
        headerMeta.appendChild(typeBadge);
    }
    
    header.appendChild(headerMeta);

    // Right side: action buttons (matches markdown review's bubble-actions)
    const headerActions = document.createElement('div');
    headerActions.className = 'bubble-actions';
    
    // Resolve/Reopen button
    if (comment.status === 'open') {
        const resolveBtn = document.createElement('button');
        resolveBtn.className = 'bubble-action-btn';
        resolveBtn.title = 'Resolve';
        resolveBtn.textContent = '✅';
        resolveBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            sendResolveComment(comment.id);
        });
        headerActions.appendChild(resolveBtn);
    } else {
        const reopenBtn = document.createElement('button');
        reopenBtn.className = 'bubble-action-btn';
        reopenBtn.title = 'Reopen';
        reopenBtn.textContent = '🔄';
        reopenBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            sendReopenComment(comment.id);
        });
        headerActions.appendChild(reopenBtn);
    }

    // Edit button
    const editBtn = document.createElement('button');
    editBtn.className = 'bubble-action-btn';
    editBtn.title = 'Edit';
    editBtn.textContent = '✏️';
    editBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        hideCommentsList();
        showEditCommentPanel(comment);
    });
    headerActions.appendChild(editBtn);

    // Delete button
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'bubble-action-btn';
    deleteBtn.title = 'Delete';
    deleteBtn.textContent = '🗑️';
    deleteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        sendDeleteComment(comment.id);
    });
    headerActions.appendChild(deleteBtn);
    
    header.appendChild(headerActions);
    div.appendChild(header);

    // Selected text preview (matches markdown review's bubble-selected-text)
    const preview = document.createElement('div');
    preview.className = 'bubble-selected-text';
    preview.textContent = comment.selectedText;
    div.appendChild(preview);

    // Comment text with markdown rendering (matches markdown review's bubble-comment-text)
    const text = document.createElement('div');
    text.className = 'bubble-comment-text bubble-markdown-content';
    text.innerHTML = renderCommentMarkdown(comment.comment);
    div.appendChild(text);

    // Add resize handles for the bubble (matches markdown review)
    const resizeHandleSE = document.createElement('div');
    resizeHandleSE.className = 'resize-handle resize-handle-se';
    resizeHandleSE.dataset.resize = 'se';
    div.appendChild(resizeHandleSE);

    const resizeHandleE = document.createElement('div');
    resizeHandleE.className = 'resize-handle resize-handle-e';
    resizeHandleE.dataset.resize = 'e';
    div.appendChild(resizeHandleE);

    const resizeHandleS = document.createElement('div');
    resizeHandleS.className = 'resize-handle resize-handle-s';
    resizeHandleS.dataset.resize = 's';
    div.appendChild(resizeHandleS);

    const resizeGrip = document.createElement('div');
    resizeGrip.className = 'resize-grip';
    div.appendChild(resizeGrip);

    // Setup drag functionality for the bubble header
    setupBubbleDrag(div);

    // Setup resize functionality for the bubble
    setupBubbleResize(div);

    return div;
}

/**
 * Setup drag functionality for comment bubble
 * Uses the shared setupBubbleDrag utility
 */
function setupBubbleDrag(bubble: HTMLElement): void {
    setupSharedBubbleDrag(
        bubble,
        '.bubble-header',
        '.bubble-action-btn',
        () => startInteraction(),
        () => endInteraction()
    );
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
        () => startInteraction(),
        () => endInteraction()
    );
}

/**
 * Format a date string
 * Uses the shared formatCommentDate utility
 */
function formatDate(isoString: string): string {
    return formatCommentDate(isoString);
}

/**
 * Check if comment panel is currently visible
 */
export function isCommentPanelVisible(): boolean {
    return commentPanel ? !commentPanel.classList.contains('hidden') : false;
}

/**
 * Check if comments list is currently visible
 */
export function isCommentsListVisible(): boolean {
    return commentsListPanel ? !commentsListPanel.classList.contains('hidden') : false;
}

/**
 * Show custom context menu
 */
export function showContextMenu(x: number, y: number, selection: SelectionState): void {
    if (!contextMenu) return;

    currentPanelSelection = selection;
    
    // Update Ask AI visibility based on settings
    updateContextMenuForSettings();
    
    // Position menu - account for submenu width
    const submenuWidth = 200;
    const menuWidth = 150;
    const menuHeight = 80; // Approx with Ask AI
    
    let left = x;
    let top = y;
    
    // Adjust if close to edge - need room for submenu
    if (left + menuWidth + submenuWidth > window.innerWidth) {
        left = Math.max(0, window.innerWidth - menuWidth - submenuWidth);
    }
    
    if (top + menuHeight > window.innerHeight) {
        top = window.innerHeight - menuHeight - 10;
    }
    
    contextMenu.style.left = `${left}px`;
    contextMenu.style.top = `${top}px`;
    contextMenu.classList.remove('hidden');
}

/**
 * Hide custom context menu
 */
export function hideContextMenu(): void {
    if (contextMenu) {
        contextMenu.classList.add('hidden');
    }
}

/**
 * Setup drag functionality for panels
 * Uses the shared setupPanelDrag utility
 */
function setupPanelDrag(panel: HTMLElement): void {
    setupSharedPanelDrag(
        panel,
        '.comments-list-header, .comment-panel-header',
        '.close-btn, button'
    );
}

/**
 * Position Ask AI submenu based on available viewport space
 */
function positionAskAISubmenu(): void {
    if (!askAISubmenu || !contextMenuAskAI || !contextMenu) return;
    
    const parentRect = contextMenuAskAI.getBoundingClientRect();
    const menuRect = contextMenu.getBoundingClientRect();
    
    // Temporarily show submenu to get its dimensions
    const originalDisplay = askAISubmenu.style.display;
    askAISubmenu.style.display = 'block';
    askAISubmenu.style.visibility = 'hidden';
    const submenuRect = askAISubmenu.getBoundingClientRect();
    askAISubmenu.style.visibility = '';
    askAISubmenu.style.display = originalDisplay;
    
    // Check horizontal space
    const spaceOnRight = window.innerWidth - menuRect.right;
    const spaceOnLeft = menuRect.left;
    
    if (spaceOnRight < submenuRect.width && spaceOnLeft > submenuRect.width) {
        // Show on left side
        askAISubmenu.style.left = 'auto';
        askAISubmenu.style.right = '100%';
    } else {
        // Show on right side (default)
        askAISubmenu.style.left = '100%';
        askAISubmenu.style.right = 'auto';
    }
    
    // Check vertical space
    const submenuBottomIfAlignedToTop = parentRect.top + submenuRect.height;
    if (submenuBottomIfAlignedToTop > window.innerHeight) {
        const overflow = submenuBottomIfAlignedToTop - window.innerHeight;
        askAISubmenu.style.top = `${-overflow - 5}px`;
    } else {
        askAISubmenu.style.top = '-1px';
    }
}

/**
 * Handle Ask AI request
 * @param commandId - The command ID from the AI command registry
 * @param customInstruction - Optional custom instruction text (for custom input commands)
 */
function handleAskAI(commandId: string, customInstruction?: string): void {
    if (!currentPanelSelection) {
        console.log('[Diff Webview] No selection for Ask AI');
        return;
    }

    // Extract surrounding lines for context
    const surroundingLines = extractSurroundingLines(
        currentPanelSelection.side,
        currentPanelSelection.startLine,
        currentPanelSelection.endLine
    );

    const context: AskAIContext = {
        selectedText: currentPanelSelection.selectedText,
        startLine: currentPanelSelection.startLine,
        endLine: currentPanelSelection.endLine,
        side: currentPanelSelection.side,
        surroundingLines,
        instructionType: commandId,
        customInstruction
    };

    sendAskAI(context);
    currentPanelSelection = null;
}

/**
 * Extract surrounding lines for AI context
 */
function extractSurroundingLines(side: DiffSide, startLine: number, endLine: number): string {
    const state = getState();
    const content = side === 'old' ? state.oldContent : state.newContent;
    const lines = content.split('\n');
    
    // Get 5 lines before and after
    const contextRadius = 5;
    const contextStartLine = Math.max(0, startLine - 1 - contextRadius);
    const contextEndLine = Math.min(lines.length, endLine + contextRadius);
    
    const surroundingLines: string[] = [];
    for (let i = contextStartLine; i < contextEndLine; i++) {
        // Skip the selected lines themselves
        if (i >= startLine - 1 && i < endLine) {
            continue;
        }
        surroundingLines.push(lines[i]);
    }
    
    return surroundingLines.join('\n');
}

/**
 * Setup custom instruction dialog event listeners
 */
function setupCustomInstructionDialogListeners(): void {
    if (customInstructionClose) {
        customInstructionClose.addEventListener('click', hideCustomInstructionDialog);
    }
    
    if (customInstructionCancelBtn) {
        customInstructionCancelBtn.addEventListener('click', hideCustomInstructionDialog);
    }
    
    if (customInstructionSubmitBtn) {
        customInstructionSubmitBtn.addEventListener('click', () => {
            const instruction = customInstructionInput?.value.trim();
            if (!instruction) {
                customInstructionInput?.focus();
                return;
            }
            hideCustomInstructionDialog();

            // Restore the selection and send Ask AI request
            if (savedSelectionForAskAI) {
                currentPanelSelection = savedSelectionForAskAI;
                // Use the pending command ID (set when custom input command was clicked)
                handleAskAI(pendingCustomCommandId, instruction);
                savedSelectionForAskAI = null;
            }
        });
    }
    
    if (customInstructionInput) {
        customInstructionInput.addEventListener('keydown', (e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                e.preventDefault();
                customInstructionSubmitBtn?.click();
            }
            if (e.key === 'Escape') {
                hideCustomInstructionDialog();
            }
        });
    }
}

/**
 * Show custom instruction dialog
 */
function showCustomInstructionDialog(): void {
    if (!currentPanelSelection) {
        console.log('[Diff Webview] No selection for custom instruction');
        return;
    }
    
    // Save the selection for later use
    savedSelectionForAskAI = currentPanelSelection;
    
    // Create overlay
    customInstructionOverlay = document.createElement('div');
    customInstructionOverlay.className = 'custom-instruction-overlay';
    customInstructionOverlay.addEventListener('click', hideCustomInstructionDialog);
    document.body.appendChild(customInstructionOverlay);
    
    // Show selected text preview
    if (customInstructionSelection) {
        const truncatedText = savedSelectionForAskAI.selectedText.length > 100
            ? savedSelectionForAskAI.selectedText.substring(0, 100) + '...'
            : savedSelectionForAskAI.selectedText;
        customInstructionSelection.textContent = truncatedText;
    }
    
    // Clear input and show dialog
    if (customInstructionInput) {
        customInstructionInput.value = '';
    }
    
    if (customInstructionDialog) {
        customInstructionDialog.classList.remove('hidden');
    }
    
    // Focus input
    setTimeout(() => customInstructionInput?.focus(), 50);
}

/**
 * Hide custom instruction dialog
 */
function hideCustomInstructionDialog(): void {
    if (customInstructionDialog) {
        customInstructionDialog.classList.add('hidden');
    }
    
    if (customInstructionOverlay) {
        customInstructionOverlay.remove();
        customInstructionOverlay = null;
    }
}

/**
 * Update context menu visibility based on settings
 * Call this when settings are updated
 */
export function updateContextMenuForSettings(): void {
    const state = getState();
    const askAIEnabled = state.settings.askAIEnabled;
    
    if (contextMenuAskAI) {
        if (askAIEnabled) {
            contextMenuAskAI.style.display = '';
            // Show separator before Ask AI
            const separator = contextMenuAskAI.previousElementSibling;
            if (separator?.classList.contains('context-menu-separator')) {
                (separator as HTMLElement).style.display = '';
            }
        } else {
            contextMenuAskAI.style.display = 'none';
            // Hide separator before Ask AI
            const separator = contextMenuAskAI.previousElementSibling;
            if (separator?.classList.contains('context-menu-separator')) {
                (separator as HTMLElement).style.display = 'none';
            }
        }
    }
}

