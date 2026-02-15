/**
 * Review File Browser — client-side module for the `/review` page.
 *
 * Fetches the list of markdown files from the REST API and renders
 * clickable file cards in `#review-browser-content`.
 *
 * Browser-only — no Node.js or VS Code dependencies.
 */

import { getApiBase } from './config';

export async function initFileBrowser(): Promise<void> {
    const container = document.getElementById('review-browser-content');
    if (!container) return;

    container.innerHTML = '<div class="review-loading">Loading files…</div>';

    try {
        const res = await fetch(getApiBase() + '/review/files');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const { files } = await res.json();
        renderFileList(container, files);
    } catch {
        container.innerHTML = '<div class="review-error">Failed to load files.</div>';
    }
}

interface ReviewFile {
    path: string;
    name: string;
    commentCount: number;
}

function renderFileList(container: HTMLElement, files: ReviewFile[]): void {
    if (files.length === 0) {
        container.innerHTML = '<div class="review-empty">No markdown files found.</div>';
        return;
    }

    container.innerHTML = '';
    for (const file of files) {
        const card = document.createElement('a');
        card.className = 'review-file-card';
        card.href = '/review/' + encodeURIComponent(file.path);
        card.dataset.path = file.path;
        card.addEventListener('click', (e) => {
            e.preventDefault();
            history.pushState(null, '', card.href);
            window.dispatchEvent(new PopStateEvent('popstate'));
        });

        const nameEl = document.createElement('div');
        nameEl.className = 'review-file-name-label';
        nameEl.textContent = file.name;
        card.appendChild(nameEl);

        const pathEl = document.createElement('div');
        pathEl.className = 'review-file-path';
        pathEl.textContent = file.path;
        card.appendChild(pathEl);

        if (file.commentCount > 0) {
            const badge = document.createElement('span');
            badge.className = 'review-comment-badge';
            badge.textContent = String(file.commentCount);
            card.appendChild(badge);
        }

        container.appendChild(card);
    }

    // Wire up search input
    const searchInput = document.getElementById('review-search') as HTMLInputElement | null;
    if (searchInput) {
        searchInput.addEventListener('input', () => {
            const q = searchInput.value.toLowerCase();
            const cards = container.querySelectorAll('.review-file-card');
            cards.forEach((el) => {
                const cardEl = el as HTMLElement;
                const filePath = cardEl.dataset.path?.toLowerCase() || '';
                cardEl.style.display = filePath.includes(q) ? '' : 'none';
            });
        });
    }
}
