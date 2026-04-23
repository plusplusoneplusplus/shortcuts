/**
 * DOM Snapshot Copy — clones the rendered conversation DOM, strips interactive
 * elements, inlines computed styles, and produces a self-contained HTML string
 * suitable for pasting into Teams, Outlook, or other rich-text contexts.
 */

export interface SnapshotOptions {
    /** Expand collapsed tool call groups so all content is visible. Default: true */
    expandToolGroups?: boolean;
    /** Force light-mode colors in the snapshot. Default: true */
    forceLightMode?: boolean;
    /** Only include turns whose data-turn-index is in this set. */
    selectedIndices?: Set<number>;
}

/** CSS properties to inline. Keeps output size reasonable while preserving visual fidelity. */
const STYLE_ALLOWLIST: readonly string[] = [
    'color', 'background-color', 'background',
    'font-family', 'font-size', 'font-weight', 'font-style',
    'line-height', 'letter-spacing', 'text-transform',
    'padding', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
    'margin', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
    'border', 'border-top', 'border-right', 'border-bottom', 'border-left',
    'border-radius', 'box-shadow',
    'display', 'flex-direction', 'align-items', 'justify-content', 'gap',
    'max-width', 'width',
    'white-space', 'word-break', 'overflow-wrap',
    'text-decoration', 'opacity',
] as const;

/** Classes on elements that should be removed from the snapshot. */
const REMOVE_BY_CLASS = [
    'bubble-retry-btn', 'bubble-json-toggle-btn', 'bubble-raw-btn',
    'bubble-copy-btn', 'bubble-copy-html-btn', 'command-copy-btn',
    'mobile-preview-btn', 'streaming-indicator', 'section-copy-btn',
];

/** data-testid values of elements to remove. */
const REMOVE_BY_TESTID = [
    'retry-turn-btn', 'json-toggle-btn', 'scroll-to-bottom-btn',
    'load-images-btn', 'retry-images-btn',
];

/**
 * Produce a self-contained HTML string from the live conversation DOM.
 *
 * 1. Optionally forces light mode via a temporary class swap.
 * 2. Deep-clones the source container.
 * 3. Filters to selected turns (if specified).
 * 4. Strips interactive elements.
 * 5. Expands collapsed tool groups.
 * 6. Inlines computed styles from the source tree.
 * 7. Rewrites relative URLs to absolute.
 * 8. Returns the resulting HTML string.
 */
export function snapshotConversation(
    sourceContainer: HTMLElement,
    options: SnapshotOptions = {},
): string {
    const {
        expandToolGroups = true,
        forceLightMode = true,
        selectedIndices,
    } = options;

    const docEl = sourceContainer.ownerDocument?.documentElement;
    let wasLight = true;
    if (forceLightMode && docEl) {
        wasLight = !docEl.classList.contains('dark');
        if (!wasLight) {
            docEl.classList.remove('dark');
            docEl.setAttribute('data-theme', 'light');
        }
    }

    try {
        const clone = sourceContainer.cloneNode(true) as HTMLElement;

        if (selectedIndices) {
            filterToSelectedTurns(clone, selectedIndices);
        }

        stripInteractiveElements(clone);

        if (expandToolGroups) {
            expandCollapsedGroups(clone);
        }

        inlineComputedStyles(clone, sourceContainer);

        const baseUrl = typeof window !== 'undefined' ? window.location.origin : '';
        rewriteRelativeUrls(clone, baseUrl);

        return wrapInContainer(clone.innerHTML);
    } finally {
        if (forceLightMode && docEl && !wasLight) {
            docEl.classList.add('dark');
            docEl.setAttribute('data-theme', 'dark');
        }
    }
}

/** Remove buttons, badges, and other interactive elements not useful in a static copy. */
export function stripInteractiveElements(clone: HTMLElement): void {
    for (const cls of REMOVE_BY_CLASS) {
        const els = clone.querySelectorAll(`.${cls}`);
        els.forEach(el => el.remove());
    }

    for (const testId of REMOVE_BY_TESTID) {
        const els = clone.querySelectorAll(`[data-testid="${testId}"]`);
        els.forEach(el => el.remove());
    }

    // Remove stats badge elements (legacy and merged)
    clone.querySelectorAll('.token-usage-badge, .cost-time-badge, .assistant-stats-badge').forEach(el => el.remove());
}

/** Expand collapsed tool call groups so their content is visible. */
export function expandCollapsedGroups(clone: HTMLElement): void {
    // Remove 'collapsed' and 'hidden' classes from tool call bodies
    clone.querySelectorAll('.tool-call-body.collapsed, .tool-call-body.hidden').forEach(el => {
        el.classList.remove('collapsed', 'hidden');
    });

    // Expand tool groups marked as collapsed via aria-expanded
    clone.querySelectorAll('[aria-expanded="false"]').forEach(el => {
        el.setAttribute('aria-expanded', 'true');
        // Show any hidden sibling content
        const parent = el.parentElement;
        if (parent) {
            parent.querySelectorAll('.hidden, [style*="display: none"], [style*="display:none"]').forEach(child => {
                if (child instanceof HTMLElement) {
                    child.classList.remove('hidden');
                    child.style.display = '';
                }
            });
        }
    });
}

/**
 * Walk the source and clone trees in parallel, copying computed styles from
 * source elements onto the clone elements as inline `style` attributes.
 *
 * Skips elements that already have inline styles from highlight.js to avoid
 * double-inlining conflicts.
 */
export function inlineComputedStyles(clone: HTMLElement, source: HTMLElement): void {
    const sourceWalker = source.ownerDocument.createTreeWalker(source, NodeFilter.SHOW_ELEMENT);
    const cloneWalker = clone.ownerDocument.createTreeWalker(clone, NodeFilter.SHOW_ELEMENT);

    let sourceNode = sourceWalker.nextNode() as HTMLElement | null;
    let cloneNode = cloneWalker.nextNode() as HTMLElement | null;

    while (sourceNode && cloneNode) {
        // Skip elements that already have inline styles (e.g., from highlight.js)
        if (!cloneNode.getAttribute('style')) {
            try {
                const computed = window.getComputedStyle(sourceNode);
                const styles: string[] = [];
                for (const prop of STYLE_ALLOWLIST) {
                    const val = computed.getPropertyValue(prop);
                    if (val && val !== 'initial' && val !== 'inherit' && val !== 'unset') {
                        styles.push(`${prop}:${val}`);
                    }
                }
                if (styles.length > 0) {
                    cloneNode.setAttribute('style', styles.join(';'));
                }
            } catch {
                // getComputedStyle can throw on detached nodes; skip
            }
        }

        sourceNode = sourceWalker.nextNode() as HTMLElement | null;
        cloneNode = cloneWalker.nextNode() as HTMLElement | null;
    }
}

/**
 * Rewrite relative URLs (images, links) to absolute ones so they work when
 * pasted into external contexts.
 */
export function rewriteRelativeUrls(clone: HTMLElement, baseUrl: string): void {
    if (!baseUrl) return;

    clone.querySelectorAll('img[src]').forEach(img => {
        const src = img.getAttribute('src') || '';
        if (src.startsWith('/') && !src.startsWith('//')) {
            img.setAttribute('src', baseUrl + src);
        }
    });

    clone.querySelectorAll('a[href]').forEach(a => {
        const href = a.getAttribute('href') || '';
        if (href.startsWith('/') && !href.startsWith('//')) {
            a.setAttribute('href', baseUrl + href);
        }
    });
}

/** Filter out turns whose `data-turn-index` is not in the selected set. */
function filterToSelectedTurns(clone: HTMLElement, indices: Set<number>): void {
    const turnEls = clone.querySelectorAll('[data-turn-index]');
    turnEls.forEach(el => {
        const idx = parseInt(el.getAttribute('data-turn-index') || '', 10);
        if (!indices.has(idx)) {
            el.remove();
        }
    });
}

/** Wrap HTML content in a container div with sensible defaults for email clients. */
function wrapInContainer(innerHtml: string): string {
    return `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;line-height:1.6;max-width:800px;">${innerHtml}</div>`;
}

/**
 * Build a full standalone HTML document from snapshot HTML, optimized for
 * printing / "Save as PDF". Removes max-height constraints so scrollable
 * containers expand to show their full content.
 *
 * Note: `overflow` is intentionally NOT overridden globally because it breaks
 * flex layouts (text renders one-char-per-line). Since `overflow` is not in
 * the snapshot STYLE_ALLOWLIST, it naturally defaults to `visible` in the
 * print document — no override needed.
 */
export function buildPrintDocument(snapshotHtml: string, title?: string): string {
    const safeTitle = escapeHtmlText(title || 'Chat Conversation');
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${safeTitle}</title>
<style>
@page { margin: 1cm; }
body {
    margin: 0;
    padding: 16px;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    line-height: 1.6;
    color: #1e1e1e;
    background: #fff;
}
/* Remove height caps so scrollable areas expand to full content */
* {
    max-height: none !important;
    height: auto !important;
}
/* Ensure code blocks wrap instead of causing horizontal overflow */
pre, code {
    white-space: pre-wrap !important;
    word-break: break-word !important;
}
/* Images scale to fit the page */
img {
    max-width: 100% !important;
    height: auto !important;
}
/* Avoid breaking individual turn bubbles across pages */
[data-turn-index] {
    break-inside: avoid;
}
</style>
</head>
<body>${snapshotHtml}</body>
</html>`;
}

/** Escape text for safe HTML insertion (title, etc.) */
function escapeHtmlText(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Open a print-preview window with the full conversation snapshot and trigger
 * the browser's Print dialog (which offers "Save as PDF").
 *
 * Returns `true` on success, or throws with a user-facing message on failure.
 */
export function openPrintPreview(snapshotHtml: string, title?: string): boolean {
    const doc = buildPrintDocument(snapshotHtml, title);
    const win = window.open('', '_blank');
    if (!win) {
        throw new Error('Pop-up blocked. Please allow pop-ups for this site and try again.');
    }
    win.document.write(doc);
    win.document.close();
    win.onload = () => win.print();
    return true;
}
