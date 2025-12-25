/**
 * Panel manager for comment input and display
 * 
 * Uses shared utilities from the base-panel-manager module for common
 * functionality like drag, positioning, and date formatting.
 */

import { AskAIContext, DiffAIInstructionType, DiffComment, DiffSide, SelectionState, SerializedAICommand } from './types';
import { getState, setCommentPanelOpen, setEditingCommentId } from './state';
import { clearSelection, toDiffSelection } from './selection-handler';
import { sendAddComment, sendAskAI, sendDeleteComment, sendEditComment, sendReopenComment, sendResolveComment } from './vscode-bridge';
import {
    formatCommentDate,
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
 * Show comments list for a specific line
 * @param comments - The comments to display
 * @param anchorElement - Optional element to position the panel near
 */
export function showCommentsForLine(comments: DiffComment[], anchorElement?: HTMLElement): void {
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

    // Position panel near the anchor element if provided
    if (anchorElement) {
        positionCommentsListNearElement(anchorElement, optimalWidth);
    }
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
        case 'ai-clarification': return '🤖 AI Clarification';
        case 'ai-critique': return '⚠️ AI Critique';
        case 'ai-question': return '❓ AI Question';
        default: return '';
    }
}

/**
 * Calculate optimal panel width based on comments content
 */
function calculateOptimalPanelWidth(comments: DiffComment[]): number {
    const minWidth = 350;
    const maxWidth = 600;
    
    // Find the longest comment
    let maxContentLength = 0;
    let hasCodeBlocks = false;
    let hasLongLines = false;
    
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
    }
    
    // Calculate width based on content
    let width: number;
    if (hasCodeBlocks || hasLongLines) {
        // Code blocks and long lines need more width
        width = Math.min(maxWidth, Math.max(500, minWidth));
    } else if (maxContentLength < 150) {
        // Short comments can use default width
        width = minWidth;
    } else if (maxContentLength < 400) {
        // Medium comments
        width = Math.min(450, minWidth + (maxContentLength - 150) * 0.4);
    } else {
        // Longer comments get wider
        width = Math.min(maxWidth, 450 + (maxContentLength - 400) * 0.2);
    }
    
    return width;
}

/**
 * Create a comment element for the list
 */
function createCommentElement(comment: DiffComment): HTMLElement {
    const div = document.createElement('div');
    // Build class list: base class + status class + type class
    const typeClass = comment.type && comment.type !== 'user' ? comment.type : '';
    const statusClass = comment.status === 'resolved' ? 'resolved' : '';
    div.className = ['comment-item', statusClass, typeClass].filter(c => c).join(' ');
    div.dataset.commentId = comment.id;

    // Header with meta info and action buttons
    const header = document.createElement('div');
    header.className = 'comment-header';
    
    // Left side: meta info (author, date, type badge, status)
    const headerMeta = document.createElement('div');
    headerMeta.className = 'comment-header-meta';
    
    const author = document.createElement('span');
    author.className = 'comment-author';
    author.textContent = comment.author || 'Anonymous';
    headerMeta.appendChild(author);
    
    const date = document.createElement('span');
    date.className = 'comment-date';
    date.textContent = formatDate(comment.createdAt);
    headerMeta.appendChild(date);
    
    // Add type badge for AI comments
    const typeLabel = getTypeLabel(comment.type);
    if (typeLabel) {
        const typeBadge = document.createElement('span');
        typeBadge.className = `type-badge ${comment.type}`;
        typeBadge.textContent = typeLabel;
        headerMeta.appendChild(typeBadge);
    }
    
    // Status badge
    if (comment.status === 'resolved') {
        const statusBadge = document.createElement('span');
        statusBadge.className = 'status-badge resolved';
        statusBadge.textContent = '✓ Resolved';
        headerMeta.appendChild(statusBadge);
    }
    
    header.appendChild(headerMeta);

    // Right side: action buttons (icon buttons in header)
    const headerActions = document.createElement('div');
    headerActions.className = 'comment-header-actions';
    
    // Resolve/Reopen button
    if (comment.status === 'open') {
        const resolveBtn = document.createElement('button');
        resolveBtn.className = 'comment-action-btn';
        resolveBtn.title = 'Resolve';
        resolveBtn.textContent = '✅';
        resolveBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            sendResolveComment(comment.id);
        });
        headerActions.appendChild(resolveBtn);
    } else {
        const reopenBtn = document.createElement('button');
        reopenBtn.className = 'comment-action-btn';
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
    editBtn.className = 'comment-action-btn';
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
    deleteBtn.className = 'comment-action-btn comment-action-btn-danger';
    deleteBtn.title = 'Delete';
    deleteBtn.textContent = '🗑️';
    deleteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        sendDeleteComment(comment.id);
    });
    headerActions.appendChild(deleteBtn);
    
    header.appendChild(headerActions);
    div.appendChild(header);

    // Selected text preview
    const preview = document.createElement('div');
    preview.className = 'comment-preview';
    preview.textContent = comment.selectedText.length > 50
        ? comment.selectedText.substring(0, 50) + '...'
        : comment.selectedText;
    div.appendChild(preview);

    // Comment text with markdown rendering
    const text = document.createElement('div');
    text.className = 'comment-text comment-markdown-content';
    text.innerHTML = renderCommentMarkdown(comment.comment);
    div.appendChild(text);

    return div;
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

