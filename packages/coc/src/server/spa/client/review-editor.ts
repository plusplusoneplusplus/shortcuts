/**
 * Review Editor — client-side module for the `/review/:path` page.
 *
 * Initializes the HttpTransport, fetches initial state, and renders
 * the markdown file content with comments in the review editor layout.
 *
 * Browser-only — no Node.js or VS Code dependencies.
 */

import { HttpTransport } from './http-transport';
import { getReviewConfig } from './review-config';

export async function initReviewEditor(): Promise<void> {
    const config = getReviewConfig();
    if (!config) return;

    const transport = new HttpTransport(config.filePath, config.apiBasePath);

    // Set file name in toolbar
    const fileNameEl = document.getElementById('review-file-name');
    if (fileNameEl) {
        fileNameEl.textContent = config.filePath;
    }

    // Listen for backend messages to render content
    transport.onBackendMessage((msg) => {
        if (msg.type === 'update') {
            renderContent((msg as any).content, (msg as any).comments, (msg as any).filePath);
            updateCommentCount((msg as any).comments?.length ?? 0);
        }
    });

    // Wire resolve-all button
    const resolveAllBtn = document.getElementById('review-resolve-all');
    if (resolveAllBtn) {
        resolveAllBtn.addEventListener('click', () => {
            transport.send({ type: 'resolveAll' } as any);
        });
    }

    // Connect WebSocket and fetch initial state
    transport.connect();
    await transport.send({ type: 'ready' } as any);
}

function renderContent(content: string, comments: any[], _filePath: string): void {
    const contentEl = document.getElementById('review-content');
    if (!contentEl) return;

    // Render raw markdown as preformatted text (basic rendering)
    const pre = document.createElement('pre');
    pre.className = 'review-markdown-content';
    pre.textContent = content || '';
    contentEl.innerHTML = '';
    contentEl.appendChild(pre);

    // Render comments panel
    const panel = document.getElementById('review-comments-panel');
    if (panel) {
        renderCommentsPanel(panel, comments || []);
    }
}

function renderCommentsPanel(panel: HTMLElement, comments: any[]): void {
    panel.innerHTML = '';
    if (comments.length === 0) {
        panel.innerHTML = '<div class="review-no-comments">No comments yet.</div>';
        return;
    }

    for (const c of comments) {
        const card = document.createElement('div');
        card.className = 'review-comment-card';
        if (c.status === 'resolved') card.classList.add('resolved');

        const header = document.createElement('div');
        header.className = 'review-comment-header';
        header.innerHTML = `<span class="review-comment-status">${c.status === 'resolved' ? '✅' : '💬'}</span>`;
        if (c.selectedText) {
            const quote = document.createElement('span');
            quote.className = 'review-comment-quote';
            quote.textContent = c.selectedText.slice(0, 80);
            header.appendChild(quote);
        }
        card.appendChild(header);

        const body = document.createElement('div');
        body.className = 'review-comment-body';
        body.textContent = c.comment;
        card.appendChild(body);

        panel.appendChild(card);
    }
}

function updateCommentCount(count: number): void {
    const el = document.getElementById('review-comment-count');
    if (el) {
        el.textContent = count > 0 ? `${count} comment${count !== 1 ? 's' : ''}` : '';
    }
}
