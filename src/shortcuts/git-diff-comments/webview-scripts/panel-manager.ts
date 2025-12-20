/**
 * Panel manager for comment input and display
 */

import { DiffComment, SelectionState } from './types';
import { getState, setCommentPanelOpen, setEditingCommentId } from './state';
import { clearSelection, toDiffSelection } from './selection-handler';
import { sendAddComment, sendDeleteComment, sendEditComment, sendReopenComment, sendResolveComment } from './vscode-bridge';

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

/**
 * Current selection for the comment panel
 */
let currentPanelSelection: SelectionState | null = null;

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
 */
export function showCommentsForLine(comments: DiffComment[]): void {
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

    // Show panel
    listPanel.classList.remove('hidden');
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
 * Create a comment element for the list
 */
function createCommentElement(comment: DiffComment): HTMLElement {
    const div = document.createElement('div');
    div.className = `comment-item ${comment.status === 'resolved' ? 'resolved' : ''}`;
    div.dataset.commentId = comment.id;

    // Header with author and date
    const header = document.createElement('div');
    header.className = 'comment-header';
    
    const author = document.createElement('span');
    author.className = 'comment-author';
    author.textContent = comment.author || 'Anonymous';
    header.appendChild(author);

    const date = document.createElement('span');
    date.className = 'comment-date';
    date.textContent = formatDate(comment.createdAt);
    header.appendChild(date);

    div.appendChild(header);

    // Selected text preview
    const preview = document.createElement('div');
    preview.className = 'comment-preview';
    preview.textContent = comment.selectedText.length > 50
        ? comment.selectedText.substring(0, 50) + '...'
        : comment.selectedText;
    div.appendChild(preview);

    // Comment text
    const text = document.createElement('div');
    text.className = 'comment-text';
    text.textContent = comment.comment;
    div.appendChild(text);

    // Actions
    const actions = document.createElement('div');
    actions.className = 'comment-actions';

    if (comment.status === 'open') {
        const resolveBtn = document.createElement('button');
        resolveBtn.className = 'btn btn-small';
        resolveBtn.textContent = 'Resolve';
        resolveBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            sendResolveComment(comment.id);
        });
        actions.appendChild(resolveBtn);
    } else {
        const reopenBtn = document.createElement('button');
        reopenBtn.className = 'btn btn-small';
        reopenBtn.textContent = 'Reopen';
        reopenBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            sendReopenComment(comment.id);
        });
        actions.appendChild(reopenBtn);
    }

    const editBtn = document.createElement('button');
    editBtn.className = 'btn btn-small';
    editBtn.textContent = 'Edit';
    editBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        hideCommentsList();
        showEditCommentPanel(comment);
    });
    actions.appendChild(editBtn);

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'btn btn-small btn-danger';
    deleteBtn.textContent = 'Delete';
    deleteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        sendDeleteComment(comment.id);
    });
    actions.appendChild(deleteBtn);

    div.appendChild(actions);

    return div;
}

/**
 * Format a date string
 */
function formatDate(isoString: string): string {
    const date = new Date(isoString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) {
        return 'just now';
    } else if (diffMins < 60) {
        return `${diffMins}m ago`;
    } else if (diffHours < 24) {
        return `${diffHours}h ago`;
    } else if (diffDays < 7) {
        return `${diffDays}d ago`;
    } else {
        return date.toLocaleDateString();
    }
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

