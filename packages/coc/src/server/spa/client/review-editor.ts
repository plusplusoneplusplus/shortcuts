/**
 * Review Editor — client-side module for the `/review/:path` page.
 *
 * Renders markdown with rich formatting, syntax highlighting, inline
 * comment indicators, mode toggle (Review/Source), and a comments panel
 * with CRUD actions.
 *
 * Browser-only — no Node.js or VS Code dependencies.
 */

import { HttpTransport } from './http-transport';
import { getReviewConfig } from './review-config';
import {
    renderMarkdownContent,
    renderSourceContent,
    applyCommentHighlights,
    escapeHtml,
    CommentHighlight,
} from './review-markdown-renderer';

// ============================================================================
// State
// ============================================================================

let transport: HttpTransport | null = null;
let currentContent = '';
let currentComments: CommentHighlight[] = [];
let currentFilePath = '';
let viewMode: 'review' | 'source' = 'review';
let showResolved = true;

// ============================================================================
// Init
// ============================================================================

export async function initReviewEditor(): Promise<void> {
    const config = getReviewConfig();
    if (!config) return;

    // Disconnect previous transport if re-initializing (SPA navigation)
    if (transport) {
        transport.disconnect();
    }

    transport = new HttpTransport(config.filePath, config.apiBasePath);
    currentFilePath = config.filePath;

    // Set file name in toolbar
    const fileNameEl = document.getElementById('review-file-name');
    if (fileNameEl) {
        fileNameEl.textContent = config.filePath;
    }

    // Listen for backend messages to render content
    transport.onBackendMessage((msg) => {
        if (msg.type === 'update') {
            currentContent = (msg as any).content || '';
            currentComments = (msg as any).comments || [];
            currentFilePath = (msg as any).filePath || currentFilePath;
            renderAll();
        }
    });

    // Wire toolbar
    setupToolbar();

    // Wire comment floating panel
    setupCommentPanel();

    // Wire text selection for adding comments
    setupTextSelection();

    // Connect WebSocket and fetch initial state
    transport.connect();
    await transport.send({ type: 'ready' } as any);
}

// ============================================================================
// Toolbar
// ============================================================================

function setupToolbar(): void {
    // Mode toggle
    const reviewBtn = document.getElementById('review-mode-review');
    const sourceBtn = document.getElementById('review-mode-source');
    if (reviewBtn && sourceBtn) {
        reviewBtn.addEventListener('click', () => setViewMode('review'));
        sourceBtn.addEventListener('click', () => setViewMode('source'));
    }

    // Resolve All
    const resolveAllBtn = document.getElementById('review-resolve-all');
    if (resolveAllBtn) {
        resolveAllBtn.addEventListener('click', () => {
            transport?.send({ type: 'resolveAll' } as any);
        });
    }

    // Show Resolved checkbox
    const showResolvedCb = document.getElementById('review-show-resolved') as HTMLInputElement | null;
    if (showResolvedCb) {
        showResolvedCb.addEventListener('change', () => {
            showResolved = showResolvedCb.checked;
            renderAll();
        });
    }
}

function setViewMode(mode: 'review' | 'source'): void {
    viewMode = mode;
    const reviewBtn = document.getElementById('review-mode-review');
    const sourceBtn = document.getElementById('review-mode-source');
    if (reviewBtn) reviewBtn.classList.toggle('active', mode === 'review');
    if (sourceBtn) sourceBtn.classList.toggle('active', mode === 'source');
    renderAll();
}

// ============================================================================
// Rendering
// ============================================================================

function renderAll(): void {
    renderContent();
    renderCommentsPanel();
    updateStats();
}

function renderContent(): void {
    const contentEl = document.getElementById('review-rendered-content');
    if (!contentEl) return;

    if (viewMode === 'source') {
        contentEl.innerHTML = renderSourceContent(currentContent);
    } else {
        const apiBase = getReviewConfig()?.apiBasePath || '/api';
        contentEl.innerHTML = renderMarkdownContent(currentContent, apiBase);

        // Apply syntax highlighting to code blocks
        applyHighlightJs(contentEl);

        // Apply comment highlights
        const visibleComments = showResolved
            ? currentComments
            : currentComments.filter(c => c.status !== 'resolved');
        applyCommentHighlights(contentEl, visibleComments);
    }
}

function applyHighlightJs(container: HTMLElement): void {
    const hljs = (window as any).hljs;
    if (!hljs) return;

    const codeBlocks = container.querySelectorAll('.review-code-block pre code');
    codeBlocks.forEach((block) => {
        try {
            hljs.highlightElement(block);
        } catch {
            // Ignore highlight errors
        }
    });
}

function renderCommentsPanel(): void {
    const panel = document.getElementById('review-comments-panel');
    if (!panel) return;

    const visibleComments = showResolved
        ? currentComments
        : currentComments.filter(c => c.status !== 'resolved');

    if (visibleComments.length === 0) {
        panel.innerHTML = '<div class="review-no-comments">No comments yet. Select text and press Ctrl+Shift+M to add one.</div>';
        return;
    }

    panel.innerHTML = '';
    for (const c of visibleComments) {
        const card = document.createElement('div');
        card.className = 'review-comment-card';
        if (c.status === 'resolved') card.classList.add('resolved');

        // Header
        const header = document.createElement('div');
        header.className = 'review-comment-header';
        const statusIcon = c.status === 'resolved' ? '✅' : '💬';
        header.innerHTML = `<span class="review-comment-status">${statusIcon}</span>`;
        if (c.selectedText || c.selection?.selectedText) {
            const quote = document.createElement('span');
            quote.className = 'review-comment-quote';
            quote.textContent = (c.selectedText || c.selection?.selectedText || '').slice(0, 80);
            header.appendChild(quote);
        }
        card.appendChild(header);

        // Body
        const body = document.createElement('div');
        body.className = 'review-comment-body';
        body.textContent = c.comment;
        card.appendChild(body);

        // Actions
        const actions = document.createElement('div');
        actions.className = 'review-comment-actions';

        if (c.status !== 'resolved') {
            const resolveBtn = document.createElement('button');
            resolveBtn.className = 'review-comment-action-btn resolve';
            resolveBtn.textContent = '✅ Resolve';
            resolveBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                transport?.send({ type: 'resolveComment', commentId: c.id } as any);
            });
            actions.appendChild(resolveBtn);
        } else {
            const reopenBtn = document.createElement('button');
            reopenBtn.className = 'review-comment-action-btn';
            reopenBtn.textContent = '↩️ Reopen';
            reopenBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                transport?.send({ type: 'reopenComment', commentId: c.id } as any);
            });
            actions.appendChild(reopenBtn);
        }

        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'review-comment-action-btn delete';
        deleteBtn.textContent = '🗑️ Delete';
        deleteBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            transport?.send({ type: 'deleteComment', commentId: c.id } as any);
        });
        actions.appendChild(deleteBtn);

        card.appendChild(actions);

        // Click to scroll to commented line
        card.addEventListener('click', () => {
            if (c.selection) {
                const lineEl = document.querySelector(`.review-line[data-line="${c.selection.startLine}"]`);
                if (lineEl) {
                    lineEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    lineEl.classList.add('flash');
                    setTimeout(() => lineEl.classList.remove('flash'), 1500);
                }
            }
        });

        panel.appendChild(card);
    }
}

function updateStats(): void {
    const open = currentComments.filter(c => c.status !== 'resolved').length;
    const resolved = currentComments.filter(c => c.status === 'resolved').length;

    const openEl = document.getElementById('review-open-count');
    const resolvedEl = document.getElementById('review-resolved-count');
    if (openEl) openEl.textContent = String(open);
    if (resolvedEl) resolvedEl.textContent = String(resolved);
}

// ============================================================================
// Text Selection → Add Comment
// ============================================================================

let pendingSelection: { startLine: number; startColumn: number; endLine: number; endColumn: number; selectedText: string } | null = null;

function setupTextSelection(): void {
    const contentEl = document.getElementById('review-rendered-content');
    if (!contentEl) return;

    // Keyboard shortcut: Ctrl+Shift+M
    document.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'M') {
            e.preventDefault();
            showCommentPanelForSelection();
        }
    });

    // Double-click on commented line to scroll to comment
    contentEl.addEventListener('dblclick', (e) => {
        const lineEl = (e.target as HTMLElement).closest('.review-line.has-comment');
        if (!lineEl) return;
        const lineNum = parseInt(lineEl.getAttribute('data-line') || '0', 10);
        if (!lineNum) return;
        const comment = currentComments.find(c => c.selection && c.selection.startLine <= lineNum && c.selection.endLine >= lineNum);
        if (comment) {
            const card = document.querySelector(`.review-comment-card[data-comment-id="${comment.id}"]`);
            if (card) card.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    });
}

function showCommentPanelForSelection(): void {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return;

    const range = sel.getRangeAt(0);
    const selectedText = sel.toString().trim();
    if (!selectedText) return;

    // Find start and end lines from the selection
    const startLineEl = findLineElement(range.startContainer);
    const endLineEl = findLineElement(range.endContainer);
    if (!startLineEl || !endLineEl) return;

    const startLine = parseInt(startLineEl.getAttribute('data-line') || '0', 10);
    const endLine = parseInt(endLineEl.getAttribute('data-line') || '0', 10);
    if (!startLine || !endLine) return;

    pendingSelection = {
        startLine,
        startColumn: 1,
        endLine,
        endColumn: 9999,
        selectedText,
    };

    // Show floating panel near the selection
    const panel = document.getElementById('review-floating-panel');
    const selectionEl = document.getElementById('review-floating-selection');
    const input = document.getElementById('review-floating-input') as HTMLTextAreaElement | null;

    if (!panel) return;

    if (selectionEl) {
        selectionEl.textContent = selectedText.length > 120 ? selectedText.slice(0, 120) + '…' : selectedText;
    }

    // Position panel near the selection
    const rect = range.getBoundingClientRect();
    panel.style.top = Math.min(rect.bottom + 8, window.innerHeight - 300) + 'px';
    panel.style.left = Math.min(rect.left, window.innerWidth - 400) + 'px';
    panel.classList.add('visible');

    if (input) {
        input.value = '';
        input.focus();
    }
}

function findLineElement(node: Node): HTMLElement | null {
    let current: Node | null = node;
    while (current) {
        if (current instanceof HTMLElement && current.classList.contains('review-line')) {
            return current;
        }
        current = current.parentNode;
    }
    return null;
}

// ============================================================================
// Floating Comment Panel
// ============================================================================

function setupCommentPanel(): void {
    const panel = document.getElementById('review-floating-panel');
    const closeBtn = document.getElementById('review-floating-close');
    const cancelBtn = document.getElementById('review-floating-cancel');
    const saveBtn = document.getElementById('review-floating-save');
    const input = document.getElementById('review-floating-input') as HTMLTextAreaElement | null;

    function hidePanel(): void {
        panel?.classList.remove('visible');
        pendingSelection = null;
        if (input) input.value = '';
    }

    closeBtn?.addEventListener('click', hidePanel);
    cancelBtn?.addEventListener('click', hidePanel);

    saveBtn?.addEventListener('click', () => {
        submitComment();
    });

    // Ctrl+Enter to submit
    input?.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
            e.preventDefault();
            submitComment();
        }
        if (e.key === 'Escape') {
            hidePanel();
        }
    });
}

function submitComment(): void {
    const input = document.getElementById('review-floating-input') as HTMLTextAreaElement | null;
    const comment = input?.value.trim();
    if (!comment || !pendingSelection || !transport) return;

    transport.send({
        type: 'addComment',
        selection: {
            startLine: pendingSelection.startLine,
            startColumn: pendingSelection.startColumn,
            endLine: pendingSelection.endLine,
            endColumn: pendingSelection.endColumn,
            selectedText: pendingSelection.selectedText,
        },
        comment,
    } as any);

    // Hide panel
    const panel = document.getElementById('review-floating-panel');
    panel?.classList.remove('visible');
    pendingSelection = null;
    if (input) input.value = '';
}
