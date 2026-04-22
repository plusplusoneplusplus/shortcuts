/**
 * useCodeBlockActions — attaches click handlers for code block copy,
 * collapse/expand, and collapsed-indicator buttons rendered by
 * pipeline-core's renderCodeBlock().
 *
 * Delegates to the container ref so it works with dangerouslySetInnerHTML
 * content that has no React event bindings.
 */

import { useEffect } from 'react';

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

        function handleClick(e: MouseEvent) {
            const target = e.target as HTMLElement;
            if (!target) return;

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
        return () => container.removeEventListener('click', handleClick);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [containerRef, ...deps]);
}

function handleCopy(btn: HTMLElement): void {
    const block = btn.closest('.code-block-container');
    if (!block) return;
    const raw = block.getAttribute('data-raw');
    if (!raw) return;

    const decoded = raw
        .replace(/&#10;/g, '\n')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&amp;/g, '&');

    navigator.clipboard.writeText(decoded).then(() => {
        const original = btn.textContent;
        btn.textContent = '\u2713';
        setTimeout(() => { btn.textContent = original; }, 1500);
    }).catch(() => { /* clipboard write failed silently */ });
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
