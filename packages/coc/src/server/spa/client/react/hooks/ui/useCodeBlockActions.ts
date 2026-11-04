/**
 * useCodeBlockActions — attaches click handlers for the code-block copy,
 * collapse/expand, collapsed-indicator and table-copy buttons that
 * `diff/markdown-renderer.ts` emits.
 *
 * Delegates to the container ref so it works with dangerouslySetInnerHTML
 * content that has no React event bindings.
 */

import { useEffect } from 'react';
import { copyToClipboard } from '../../utils/format';

/**
 * Attach delegated click handlers for code-block interactive elements.
 *
 * @param containerRef - Ref to the element containing rendered markdown HTML.
 * @param deps - Additional dependency array values to re-attach on.
 */
export function useCodeBlockActions(
    containerRef: React.RefObject<HTMLElement | null>,
    deps: unknown[] = [],
): void {
    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;

        let active = true;
        const timers = new Map<HTMLElement, ReturnType<typeof setTimeout>>();
        const pending = new Set<HTMLElement>();
        const copyButtons = container.querySelectorAll<HTMLButtonElement>('.code-block-copy');
        for (const button of copyButtons) {
            button.type = 'button';
            button.textContent = 'Copy all';
            button.title = 'Copy all';
            button.setAttribute('aria-label', 'Copy all');
            button.setAttribute('aria-live', 'polite');
        }

        async function handleCopy(btn: HTMLElement) {
            const raw = btn.closest('.code-block-container')?.getAttribute('data-raw');
            if (raw == null || pending.has(btn)) return;
            clearTimeout(timers.get(btn));
            pending.add(btn);
            try {
                // HTML attribute entities are already decoded by the DOM. A second
                // decode corrupts literal code such as "&lt;" and "&#10;".
                await copyToClipboard(raw);
                if (!active) return;
                btn.textContent = 'Copied!';
                btn.setAttribute('aria-label', 'Copied!');
                btn.title = 'Copied!';
            } catch {
                if (!active) return;
                btn.textContent = 'Copy failed';
                btn.setAttribute('aria-label', 'Copy failed. Try again');
                btn.title = 'Copy failed. Try again';
            } finally {
                pending.delete(btn);
            }
            if (active) timers.set(btn, setTimeout(() => {
                btn.textContent = 'Copy all';
                btn.setAttribute('aria-label', 'Copy all');
                btn.title = 'Copy all';
                timers.delete(btn);
            }, 3000));
        }

        function handleClick(e: MouseEvent) {
            const target = e.target instanceof Element
                ? e.target.closest<HTMLElement>('.code-block-copy, .code-block-collapse, .code-block-collapsed-indicator, .md-table-copy-btn')
                : null;
            if (!target || !container.contains(target)) return;
            // Embedded MarkdownViews own their controls and clipboard feedback.
            if (container.classList.contains('markdown-body') && target.closest('.markdown-body') !== container) return;

            if (target.classList.contains('code-block-copy')) {
                handleCopy(target);
                return;
            }

            if (target.classList.contains('code-block-collapse')) {
                handleCollapse(target);
                return;
            }

            if (target.classList.contains('code-block-collapsed-indicator')) {
                handleExpandFromIndicator(target);
                return;
            }

            if (target.classList.contains('md-table-copy-btn')) {
                handleTableCopy(target);
                return;
            }
        }

        container.addEventListener('click', handleClick);
        return () => {
            active = false;
            container.removeEventListener('click', handleClick);
            for (const timer of timers.values()) clearTimeout(timer);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [containerRef, ...deps]);
}

function handleCollapse(btn: HTMLElement): void {
    const block = btn.closest('.code-block-container');
    if (!block) return;

    const isCollapsed = block.getAttribute('data-collapsed') === 'true';
    if (isCollapsed) {
        block.setAttribute('data-collapsed', 'false');
        btn.textContent = '\u25BC';
        btn.title = 'Collapse code block';
    } else {
        block.setAttribute('data-collapsed', 'true');
        btn.textContent = '\u25B6';
        btn.title = 'Expand code block';
    }
}

function handleExpandFromIndicator(indicator: HTMLElement): void {
    const block = indicator.closest('.code-block-container');
    if (!block) return;

    block.setAttribute('data-collapsed', 'false');
    const collapseBtn = block.querySelector('.code-block-collapse');
    if (collapseBtn) {
        collapseBtn.textContent = '\u25BC';
        (collapseBtn as HTMLElement).title = 'Collapse code block';
    }
}

function handleTableCopy(btn: HTMLElement): void {
    const markdown = btn.getAttribute('data-table-markdown');
    if (!markdown) return;

    const decoded = markdown
        .replace(/&#10;/g, '\n')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&amp;/g, '&');

    navigator.clipboard.writeText(decoded).then(() => {
        const original = btn.textContent;
        btn.textContent = '\u2713 Copied';
        setTimeout(() => { btn.textContent = original; }, 1500);
    }).catch(() => { /* clipboard write failed silently */ });
}
