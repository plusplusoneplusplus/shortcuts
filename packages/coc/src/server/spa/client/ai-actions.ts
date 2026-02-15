/**
 * AI action dropdown for task file rows in the Miller columns UI.
 * Stub shell — menu items wired to real handlers in 006/007.
 */

import { escapeHtmlClient } from './utils';

let activeDropdown: HTMLElement | null = null;
let outsideClickHandler: ((e: MouseEvent) => void) | null = null;

/**
 * Show the AI action dropdown positioned near the trigger button.
 * Only one dropdown can be open at a time.
 */
export function showAIActionDropdown(button: HTMLElement, wsId: string, taskPath: string): void {
    // Close any already-open dropdown first
    hideAIActionDropdown();

    const dropdown = document.createElement('div');
    dropdown.className = 'ai-action-dropdown';
    dropdown.setAttribute('data-ws-id', wsId);
    dropdown.setAttribute('data-task-path', taskPath);

    dropdown.innerHTML =
        '<button class="ai-action-menu-item" data-ai-action="follow-prompt">' +
            '<span class="ai-action-menu-icon">📝</span>' +
            '<span class="ai-action-menu-label">Follow Prompt</span>' +
        '</button>' +
        '<button class="ai-action-menu-item" data-ai-action="update-document">' +
            '<span class="ai-action-menu-icon">✏️</span>' +
            '<span class="ai-action-menu-label">Update Document</span>' +
        '</button>';

    // Position relative to the trigger button
    document.body.appendChild(dropdown);
    const rect = button.getBoundingClientRect();
    const dropdownRect = dropdown.getBoundingClientRect();

    // Default: below and left-aligned to button
    let top = rect.bottom + 4;
    let left = rect.left;

    // If dropdown would overflow right edge, align to right edge of button
    if (left + dropdownRect.width > window.innerWidth - 8) {
        left = rect.right - dropdownRect.width;
    }
    // If dropdown would overflow bottom, show above the button
    if (top + dropdownRect.height > window.innerHeight - 8) {
        top = rect.top - dropdownRect.height - 4;
    }

    dropdown.style.top = top + 'px';
    dropdown.style.left = left + 'px';

    activeDropdown = dropdown;

    // Menu item clicks — stubs for now (006/007 wire real handlers)
    dropdown.addEventListener('click', (e: Event) => {
        const item = (e.target as HTMLElement).closest('[data-ai-action]') as HTMLElement | null;
        if (!item) return;
        const action = item.getAttribute('data-ai-action');
        // Stub: log to console. 006/007 will replace with real calls.
        console.log('[ai-actions] stub action:', action, 'path:', taskPath, 'ws:', wsId);
        hideAIActionDropdown();
    });

    // Close on outside click (deferred to next tick so the opening click doesn't close it)
    requestAnimationFrame(() => {
        outsideClickHandler = (e: MouseEvent) => {
            if (activeDropdown && !activeDropdown.contains(e.target as Node)) {
                hideAIActionDropdown();
            }
        };
        document.addEventListener('click', outsideClickHandler, true);
    });
}

/** Remove the active dropdown and clean up listeners. */
export function hideAIActionDropdown(): void {
    if (activeDropdown) {
        activeDropdown.remove();
        activeDropdown = null;
    }
    if (outsideClickHandler) {
        document.removeEventListener('click', outsideClickHandler, true);
        outsideClickHandler = null;
    }
}
