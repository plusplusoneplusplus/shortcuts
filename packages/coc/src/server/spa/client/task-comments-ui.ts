/**
 * Task Comment UI Components
 *
 * Browser-compatible UI components for displaying and interacting with
 * comments in the task viewer. Components:
 *   - CommentCard: renders a single comment with metadata and actions
 *   - SelectionToolbar: floating toolbar for creating comments on text selection
 *   - CommentSidebar: sidebar panel listing all comments with filters
 *   - Selection utilities: detect text selection and compute positions
 *
 * No Node.js or VS Code dependencies.
 */

import type {
    TaskComment,
    TaskCommentStatus,
} from './task-comments-types';

// ============================================================================
// Inlined Utilities
// (Avoid importing from utils.ts which has browser-only side effects)
// ============================================================================

/** Escape HTML special characters for safe insertion into innerHTML. */
function escapeHtml(str: string | null | undefined): string {
    if (str == null) return '';
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

/** Format a date string as relative time (e.g. "5m ago"). */
function formatRelative(dateStr: string | null | undefined): string {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    const now = Date.now();
    const diff = now - d.getTime();
    if (diff < 60000) return 'just now';
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return mins + 'm ago';
    const hours = Math.floor(mins / 60);
    if (hours < 24) return hours + 'h ago';
    const days = Math.floor(hours / 24);
    if (days === 1) return 'yesterday';
    if (days < 7) return days + 'd ago';
    return d.toLocaleDateString();
}

// ============================================================================
// Comment Category
// ============================================================================

/** Comment categories with associated icon and label. */
export type CommentCategory = 'bug' | 'question' | 'suggestion' | 'praise' | 'nitpick' | 'general';

export interface CategoryInfo {
    label: string;
    icon: string;
}

export const CATEGORY_INFO: Record<CommentCategory, CategoryInfo> = {
    bug:        { label: 'Bug',        icon: '\uD83D\uDC1B' }, // 🐛
    question:   { label: 'Question',   icon: '\u2753' },       // ❓
    suggestion: { label: 'Suggestion', icon: '\uD83D\uDCA1' }, // 💡
    praise:     { label: 'Praise',     icon: '\uD83C\uDF1F' }, // 🌟
    nitpick:    { label: 'Nitpick',    icon: '\uD83D\uDD0D' }, // 🔍
    general:    { label: 'General',    icon: '\uD83D\uDCAC' }, // 💬
};

export const ALL_CATEGORIES: CommentCategory[] = ['bug', 'question', 'suggestion', 'praise', 'nitpick', 'general'];

// ============================================================================
// Selection Info
// ============================================================================

/** Information about a text selection in the preview content. */
export interface SelectionInfo {
    text: string;
    startLine: number;
    startColumn: number;
    endLine: number;
    endColumn: number;
    boundingRect: { top: number; left: number; width: number; height: number };
}

// ============================================================================
// Comment Card
// ============================================================================

export interface CommentCardOptions {
    comment: TaskComment;
    category?: CommentCategory;
    onReply?: (comment: TaskComment) => void;
    onResolve?: (comment: TaskComment) => void;
    onDelete?: (comment: TaskComment) => void;
    onEdit?: (comment: TaskComment) => void;
    onClick?: (comment: TaskComment) => void;
    readonly?: boolean;
}

/**
 * Render a comment card HTML string.
 * Pure function — returns HTML, caller inserts into DOM.
 */
export function renderCommentCardHTML(options: CommentCardOptions): string {
    const { comment, category = 'general', readonly = false } = options;
    const isResolved = comment.status === 'resolved';

    const resolvedClass = isResolved ? ' comment-card--resolved' : '';
    const badgeClass = 'comment-card__category-badge comment-card__category-badge--' + category;
    const info = CATEGORY_INFO[category];
    const statusIcon = isResolved ? '\u2705' : '\uD83D\uDFE2'; // ✅ or 🟢

    // Header
    const author = comment.author || 'Anonymous';
    const time = formatRelative(comment.createdAt);

    let html = '<div class="comment-card' + resolvedClass + '" data-comment-id="' + escapeHtml(comment.id) + '" role="article" aria-label="Comment by ' + escapeHtml(author) + '">';

    // Header row
    html += '<div class="comment-card__header">';
    html += '<span class="' + badgeClass + '">' + info.icon + ' ' + escapeHtml(info.label) + '</span>';
    html += '<span class="comment-card__author">' + escapeHtml(author) + '</span>';
    html += '<span class="comment-card__time">' + escapeHtml(time) + '</span>';
    html += '<span class="comment-card__status-icon" title="' + (isResolved ? 'Resolved' : 'Open') + '">' + statusIcon + '</span>';
    html += '</div>';

    // Body
    html += '<div class="comment-card__body">';
    if (comment.selectedText) {
        const truncated = comment.selectedText.length > 200
            ? comment.selectedText.substring(0, 200) + '…'
            : comment.selectedText;
        html += '<div class="comment-selected-text">' + escapeHtml(truncated) + '</div>';
    }
    html += '<div>' + escapeHtml(comment.comment) + '</div>';
    html += '</div>';

    // Footer with action buttons
    if (!readonly) {
        html += '<div class="comment-card__footer">';
        html += '<button class="comment-card__action" data-action="reply" data-comment-id="' + escapeHtml(comment.id) + '" aria-label="Reply">\uD83D\uDCAC Reply</button>';
        if (isResolved) {
            html += '<button class="comment-card__action" data-action="reopen" data-comment-id="' + escapeHtml(comment.id) + '" aria-label="Reopen">\uD83D\uDD13 Reopen</button>';
        } else {
            html += '<button class="comment-card__action" data-action="resolve" data-comment-id="' + escapeHtml(comment.id) + '" aria-label="Resolve">\u2705 Resolve</button>';
        }
        html += '<button class="comment-card__action" data-action="edit" data-comment-id="' + escapeHtml(comment.id) + '" aria-label="Edit">\u270F\uFE0F Edit</button>';
        html += '<button class="comment-card__action" data-action="delete" data-comment-id="' + escapeHtml(comment.id) + '" aria-label="Delete">\uD83D\uDDD1\uFE0F Delete</button>';
        html += '</div>';
    }

    html += '</div>';
    return html;
}

/**
 * Attach event handlers to comment card action buttons within a container.
 */
export function attachCommentCardHandlers(
    container: HTMLElement,
    handlers: {
        onReply?: (commentId: string) => void;
        onResolve?: (commentId: string) => void;
        onReopen?: (commentId: string) => void;
        onEdit?: (commentId: string) => void;
        onDelete?: (commentId: string) => void;
        onClick?: (commentId: string) => void;
    }
): void {
    container.addEventListener('click', (e) => {
        const target = e.target as HTMLElement;
        const btn = target.closest('.comment-card__action') as HTMLElement | null;

        if (btn) {
            const action = btn.getAttribute('data-action');
            const commentId = btn.getAttribute('data-comment-id');
            if (!commentId) return;

            switch (action) {
                case 'reply': handlers.onReply?.(commentId); break;
                case 'resolve': handlers.onResolve?.(commentId); break;
                case 'reopen': handlers.onReopen?.(commentId); break;
                case 'edit': handlers.onEdit?.(commentId); break;
                case 'delete': handlers.onDelete?.(commentId); break;
            }
            return;
        }

        const card = target.closest('.comment-card') as HTMLElement | null;
        if (card) {
            const commentId = card.getAttribute('data-comment-id');
            if (commentId) handlers.onClick?.(commentId);
        }
    });
}

// ============================================================================
// Selection Toolbar
// ============================================================================

export interface SelectionToolbarOptions {
    onAddComment: (selection: SelectionInfo, category: CommentCategory) => void;
}

/**
 * Render selection toolbar HTML.
 */
export function renderSelectionToolbarHTML(): string {
    let html = '<div class="selection-toolbar" role="toolbar" aria-label="Add comment">';

    for (const cat of ALL_CATEGORIES) {
        const info = CATEGORY_INFO[cat];
        html += '<button class="selection-toolbar__btn selection-toolbar__btn--' + cat + '" ' +
            'data-category="' + cat + '" ' +
            'title="' + escapeHtml(info.label) + '" ' +
            'aria-label="Add ' + escapeHtml(info.label) + ' comment">';
        html += '<span class="selection-toolbar__btn-icon">' + info.icon + '</span>';
        html += '</button>';
    }

    html += '<div class="selection-toolbar__arrow"></div>';
    html += '</div>';
    return html;
}

/**
 * Calculate position for the toolbar relative to a bounding rect.
 * Returns CSS top/left and whether toolbar is placed below the selection.
 */
export function calculateToolbarPosition(
    selectionRect: { top: number; left: number; width: number; height: number },
    toolbarWidth: number,
    toolbarHeight: number,
    viewport: { width: number; height: number }
): { top: number; left: number; below: boolean } {
    const MARGIN = 8;

    // Prefer above selection
    let below = false;
    let top = selectionRect.top - toolbarHeight - MARGIN;
    if (top < MARGIN) {
        // Flip below
        top = selectionRect.top + selectionRect.height + MARGIN;
        below = true;
    }

    // Horizontal: center on selection, clamp to viewport
    let left = selectionRect.left + selectionRect.width / 2 - toolbarWidth / 2;
    left = Math.max(MARGIN, Math.min(left, viewport.width - toolbarWidth - MARGIN));

    return { top, left, below };
}

/** Minimum selection length to trigger toolbar. */
export const MIN_SELECTION_LENGTH = 3;

/**
 * Create and manage a SelectionToolbar instance attached to the document.
 */
export class SelectionToolbar {
    private element: HTMLElement | null = null;
    private options: SelectionToolbarOptions;
    private currentSelection: SelectionInfo | null = null;
    private boundHide: () => void;
    private boundOnKeydown: (e: KeyboardEvent) => void;

    constructor(options: SelectionToolbarOptions) {
        this.options = options;
        this.boundHide = () => this.hide();
        this.boundOnKeydown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') this.hide();
        };
    }

    /** Show toolbar for the given selection. */
    show(selection: SelectionInfo): void {
        this.hide();
        this.currentSelection = selection;

        const container = document.createElement('div');
        container.innerHTML = renderSelectionToolbarHTML();
        this.element = container.firstElementChild as HTMLElement;
        document.body.appendChild(this.element);

        // Position after rendering
        const rect = this.element.getBoundingClientRect();
        const pos = calculateToolbarPosition(
            selection.boundingRect,
            rect.width,
            rect.height,
            { width: window.innerWidth, height: window.innerHeight }
        );

        this.element.style.top = pos.top + 'px';
        this.element.style.left = pos.left + 'px';
        if (pos.below) {
            this.element.classList.add('selection-toolbar--below');
        }

        // Event handlers
        this.element.addEventListener('click', (e) => {
            const btn = (e.target as HTMLElement).closest('.selection-toolbar__btn') as HTMLElement | null;
            if (btn && this.currentSelection) {
                const cat = btn.getAttribute('data-category') as CommentCategory;
                if (cat) {
                    this.options.onAddComment(this.currentSelection, cat);
                    this.hide();
                }
            }
        });

        // Dismiss handlers
        setTimeout(() => {
            document.addEventListener('mousedown', this.handleClickAway);
            document.addEventListener('keydown', this.boundOnKeydown);
            window.addEventListener('scroll', this.boundHide, { capture: true });
            window.addEventListener('resize', this.boundHide);
        }, 0);
    }

    /** Hide the toolbar. */
    hide(): void {
        if (this.element) {
            this.element.remove();
            this.element = null;
        }
        this.currentSelection = null;
        document.removeEventListener('mousedown', this.handleClickAway);
        document.removeEventListener('keydown', this.boundOnKeydown);
        window.removeEventListener('scroll', this.boundHide, { capture: true });
        window.removeEventListener('resize', this.boundHide);
    }

    /** Whether toolbar is currently visible. */
    isVisible(): boolean {
        return this.element !== null;
    }

    dispose(): void {
        this.hide();
    }

    private handleClickAway = (e: MouseEvent): void => {
        if (this.element && !this.element.contains(e.target as Node)) {
            this.hide();
        }
    };
}

// ============================================================================
// Comment Sidebar
// ============================================================================

export type CommentFilter = 'all' | CommentCategory;
export type StatusFilter = 'all' | 'open' | 'resolved';

export interface CommentSidebarOptions {
    onCommentClick?: (commentId: string) => void;
    onClose?: () => void;
}

/** Get category from a TaskComment (stored as metadata or default). */
export function getCommentCategory(comment: TaskComment): CommentCategory {
    // Category may be stored in the comment text prefix like "[bug]" or as a future field
    const match = comment.comment.match(/^\[(bug|question|suggestion|praise|nitpick|general)\]\s*/i);
    if (match) return match[1].toLowerCase() as CommentCategory;
    return 'general';
}

/** Count comments per category. */
export function countByCategory(comments: TaskComment[]): Record<CommentCategory | 'all', number> {
    const counts: Record<string, number> = { all: comments.length };
    for (const cat of ALL_CATEGORIES) counts[cat] = 0;
    for (const c of comments) {
        const cat = getCommentCategory(c);
        counts[cat] = (counts[cat] || 0) + 1;
    }
    return counts as Record<CommentCategory | 'all', number>;
}

/** Filter comments by category and status. */
export function filterComments(
    comments: TaskComment[],
    categoryFilter: CommentFilter,
    statusFilter: StatusFilter
): TaskComment[] {
    return comments.filter(c => {
        if (categoryFilter !== 'all' && getCommentCategory(c) !== categoryFilter) return false;
        if (statusFilter !== 'all' && c.status !== statusFilter) return false;
        return true;
    });
}

/**
 * Render the sidebar filter bar HTML.
 */
export function renderSidebarFiltersHTML(
    counts: Record<CommentCategory | 'all', number>,
    activeCategory: CommentFilter,
    activeStatus: StatusFilter
): string {
    let html = '<div class="comment-sidebar__filters">';

    // Category filter buttons
    const filters: Array<{ key: CommentFilter; label: string }> = [
        { key: 'all', label: 'All' },
        ...ALL_CATEGORIES.map(c => ({ key: c as CommentFilter, label: CATEGORY_INFO[c].icon }))
    ];

    for (const f of filters) {
        const active = activeCategory === f.key ? ' comment-sidebar__filter-btn--active' : '';
        const count = counts[f.key as CommentCategory | 'all'] || 0;
        html += '<button class="comment-sidebar__filter-btn' + active + '" ' +
            'data-filter="' + f.key + '" ' +
            'aria-pressed="' + (activeCategory === f.key) + '" ' +
            'title="' + escapeHtml(f.key === 'all' ? 'All' : CATEGORY_INFO[f.key as CommentCategory].label) + '">';
        html += escapeHtml(f.label);
        html += '<span class="comment-sidebar__count">' + count + '</span>';
        html += '</button>';
    }

    // Status filter
    html += '</div>';
    html += '<div class="comment-sidebar__filters">';
    for (const s of ['all', 'open', 'resolved'] as StatusFilter[]) {
        const active = activeStatus === s ? ' comment-sidebar__filter-btn--active' : '';
        const label = s === 'all' ? 'All Status' : s.charAt(0).toUpperCase() + s.slice(1);
        html += '<button class="comment-sidebar__filter-btn' + active + '" ' +
            'data-status-filter="' + s + '" ' +
            'aria-pressed="' + (activeStatus === s) + '">';
        html += escapeHtml(label);
        html += '</button>';
    }
    html += '</div>';

    return html;
}

/**
 * Render the sidebar comment list HTML.
 */
export function renderSidebarListHTML(
    comments: TaskComment[],
    activeCommentId?: string
): string {
    if (comments.length === 0) {
        return '<div class="comment-sidebar__empty">No comments match the current filter.</div>';
    }

    let html = '';
    for (const c of comments) {
        const cat = getCommentCategory(c);
        const info = CATEGORY_INFO[cat];
        const isResolved = c.status === 'resolved';
        const resolvedClass = isResolved ? ' comment-sidebar__item--resolved' : '';
        const activeClass = c.id === activeCommentId ? ' comment-sidebar__item--active' : '';

        html += '<div class="comment-sidebar__item' + resolvedClass + activeClass + '" ' +
            'data-comment-id="' + escapeHtml(c.id) + '" ' +
            'tabindex="0" role="button" ' +
            'aria-label="' + escapeHtml(info.label + ' comment: ' + c.comment.substring(0, 50)) + '">';

        html += '<div class="comment-sidebar__item-header">';
        html += '<span class="comment-card__category-badge comment-card__category-badge--' + cat + '">' +
            info.icon + '</span>';
        html += '<span class="comment-card__time">' + escapeHtml(formatRelative(c.createdAt)) + '</span>';
        if (isResolved) {
            html += '<span title="Resolved">\u2705</span>';
        }
        html += '</div>';

        const preview = c.comment.length > 80 ? c.comment.substring(0, 80) + '…' : c.comment;
        html += '<div class="comment-sidebar__item-text">' + escapeHtml(preview) + '</div>';
        html += '</div>';
    }

    return html;
}

/**
 * Render the full sidebar HTML.
 */
export function renderCommentSidebarHTML(
    comments: TaskComment[],
    categoryFilter: CommentFilter,
    statusFilter: StatusFilter,
    activeCommentId?: string
): string {
    const counts = countByCategory(comments);
    const filtered = filterComments(comments, categoryFilter, statusFilter);

    let html = '<div class="comment-sidebar" role="complementary" aria-label="Comments">';

    html += '<div class="comment-sidebar__header">';
    html += '<span class="comment-sidebar__title">Comments (' + comments.length + ')</span>';
    html += '<button class="comment-sidebar__close" aria-label="Close comments panel">&times;</button>';
    html += '</div>';

    html += renderSidebarFiltersHTML(counts, categoryFilter, statusFilter);

    html += '<div class="comment-sidebar__list" role="list">';
    html += renderSidebarListHTML(filtered, activeCommentId);
    html += '</div>';

    html += '</div>';
    return html;
}

/**
 * Attach event handlers to the comment sidebar.
 */
export function attachSidebarHandlers(
    container: HTMLElement,
    handlers: CommentSidebarOptions & {
        onFilterChange?: (category: CommentFilter, status: StatusFilter) => void;
    }
): void {
    // Close button
    const closeBtn = container.querySelector('.comment-sidebar__close');
    if (closeBtn) {
        closeBtn.addEventListener('click', () => handlers.onClose?.());
    }

    // Category filter buttons
    container.addEventListener('click', (e) => {
        const target = e.target as HTMLElement;

        const filterBtn = target.closest('[data-filter]') as HTMLElement | null;
        if (filterBtn) {
            const cat = filterBtn.getAttribute('data-filter') as CommentFilter;
            const currentStatus = container.querySelector('[data-status-filter].comment-sidebar__filter-btn--active')
                ?.getAttribute('data-status-filter') as StatusFilter || 'all';
            handlers.onFilterChange?.(cat, currentStatus);
            return;
        }

        const statusBtn = target.closest('[data-status-filter]') as HTMLElement | null;
        if (statusBtn) {
            const status = statusBtn.getAttribute('data-status-filter') as StatusFilter;
            const currentCat = container.querySelector('[data-filter].comment-sidebar__filter-btn--active')
                ?.getAttribute('data-filter') as CommentFilter || 'all';
            handlers.onFilterChange?.(currentCat, status);
            return;
        }

        const item = target.closest('.comment-sidebar__item') as HTMLElement | null;
        if (item) {
            const commentId = item.getAttribute('data-comment-id');
            if (commentId) handlers.onCommentClick?.(commentId);
        }
    });

    // Keyboard navigation in list
    const list = container.querySelector('.comment-sidebar__list');
    if (list) {
        list.addEventListener('keydown', (e) => {
            const evt = e as KeyboardEvent;
            const items = Array.from(list.querySelectorAll('.comment-sidebar__item'));
            const focused = document.activeElement as HTMLElement;
            const idx = items.indexOf(focused);

            if (evt.key === 'ArrowDown' && idx < items.length - 1) {
                evt.preventDefault();
                (items[idx + 1] as HTMLElement).focus();
            } else if (evt.key === 'ArrowUp' && idx > 0) {
                evt.preventDefault();
                (items[idx - 1] as HTMLElement).focus();
            } else if (evt.key === 'Enter' && idx >= 0) {
                const commentId = focused.getAttribute('data-comment-id');
                if (commentId) handlers.onCommentClick?.(commentId);
            }
        });
    }
}

// ============================================================================
// Selection Utilities
// ============================================================================

/**
 * Get the current text selection from the preview body, if valid.
 * Returns null if no selection or selection is too short.
 */
export function getPreviewSelection(previewBody: HTMLElement): SelectionInfo | null {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return null;

    const range = sel.getRangeAt(0);
    const text = sel.toString().trim();

    if (text.length < MIN_SELECTION_LENGTH) return null;

    // Ensure selection is within the preview body
    if (!previewBody.contains(range.startContainer) || !previewBody.contains(range.endContainer)) {
        return null;
    }

    const rect = range.getBoundingClientRect();

    // Compute line/column from text content
    const previewText = previewBody.textContent || '';
    const preOffset = getTextOffset(previewBody, range.startContainer, range.startOffset);
    const endOffset = getTextOffset(previewBody, range.endContainer, range.endOffset);

    const startPos = offsetToPosition(previewText, preOffset);
    const endPos = offsetToPosition(previewText, endOffset);

    return {
        text,
        startLine: startPos.line,
        startColumn: startPos.column,
        endLine: endPos.line,
        endColumn: endPos.column,
        boundingRect: { top: rect.top, left: rect.left, width: rect.width, height: rect.height },
    };
}

/**
 * Calculate the text offset of a node position within a container.
 */
function getTextOffset(container: Node, targetNode: Node, targetOffset: number): number {
    let offset = 0;
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);

    while (walker.nextNode()) {
        if (walker.currentNode === targetNode) {
            return offset + targetOffset;
        }
        offset += (walker.currentNode.textContent || '').length;
    }

    return offset + targetOffset;
}

/**
 * Convert a character offset in text to 1-based line/column.
 * Pure function — testable without DOM.
 */
export function offsetToPosition(text: string, offset: number): { line: number; column: number } {
    const clamped = Math.max(0, Math.min(offset, text.length));
    const before = text.substring(0, clamped);
    const lines = before.split('\n');
    return {
        line: lines.length,
        column: (lines[lines.length - 1]?.length || 0) + 1,
    };
}

/**
 * Add a highlight element around a comment's text range in the preview.
 */
export function addCommentHighlight(
    previewBody: HTMLElement,
    commentId: string,
    selectedText: string
): HTMLElement | null {
    const text = previewBody.textContent || '';
    const idx = text.indexOf(selectedText);
    if (idx === -1) return null;

    // Find the text nodes that contain the selection range
    const range = document.createRange();
    const walker = document.createTreeWalker(previewBody, NodeFilter.SHOW_TEXT);
    let currentOffset = 0;
    let startSet = false;

    while (walker.nextNode()) {
        const nodeText = walker.currentNode.textContent || '';
        const nodeEnd = currentOffset + nodeText.length;

        if (!startSet && nodeEnd > idx) {
            range.setStart(walker.currentNode, idx - currentOffset);
            startSet = true;
        }
        if (startSet && nodeEnd >= idx + selectedText.length) {
            range.setEnd(walker.currentNode, idx + selectedText.length - currentOffset);
            break;
        }
        currentOffset = nodeEnd;
    }

    if (!startSet) return null;

    const highlight = document.createElement('mark');
    highlight.className = 'comment-highlight';
    highlight.setAttribute('data-comment-id', commentId);
    highlight.setAttribute('role', 'mark');
    highlight.setAttribute('aria-label', 'Commented text');

    try {
        range.surroundContents(highlight);
    } catch {
        // surroundContents fails if selection spans multiple elements
        return null;
    }

    return highlight;
}

/**
 * Remove all comment highlights from the preview body.
 */
export function clearCommentHighlights(previewBody: HTMLElement): void {
    const highlights = previewBody.querySelectorAll('.comment-highlight');
    highlights.forEach(el => {
        const parent = el.parentNode;
        if (parent) {
            while (el.firstChild) parent.insertBefore(el.firstChild, el);
            parent.removeChild(el);
        }
    });
}

/**
 * Scroll a comment highlight into view and activate it.
 */
export function scrollToCommentHighlight(previewBody: HTMLElement, commentId: string): void {
    // Deactivate all
    previewBody.querySelectorAll('.comment-highlight--active').forEach(el =>
        el.classList.remove('comment-highlight--active'));

    const highlight = previewBody.querySelector('[data-comment-id="' + commentId + '"].comment-highlight') as HTMLElement | null;
    if (highlight) {
        highlight.classList.add('comment-highlight--active');
        highlight.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
}

// ============================================================================
// Comment Toggle Button (for preview header)
// ============================================================================

/**
 * Render a toggle button for showing/hiding the comment sidebar.
 */
export function renderCommentToggleHTML(commentCount: number, isActive: boolean): string {
    const activeClass = isActive ? ' comment-toggle-btn--active' : '';
    return '<button class="comment-toggle-btn' + activeClass + '" ' +
        'id="comment-toggle-btn" ' +
        'aria-label="Toggle comments" ' +
        'aria-expanded="' + isActive + '">' +
        '\uD83D\uDCAC ' + commentCount +
        '</button>';
}
