/**
 * DOM Snapshot Copy — clones the rendered conversation DOM, strips interactive
 * elements, inlines computed styles, and produces a self-contained HTML string
 * suitable for pasting into Teams, Outlook, or other rich-text contexts.
 */

import { getExportKatexCss } from '../../shared/math/katexCssExtract';

export interface SnapshotOptions {
    /** Expand collapsed tool call groups so all content is visible. Default: true */
    expandToolGroups?: boolean;
    /** Force light-mode colors in the snapshot. Default: true */
    forceLightMode?: boolean;
    /** Only include turns whose data-turn-index is in this set. */
    selectedIndices?: Set<number>;
    /** Strip absolute pixel widths from inlined styles for print output. Default: false */
    forPrint?: boolean;
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
        forPrint = false,
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

        // Inline computed styles BEFORE any DOM mutations.
        // inlineComputedStyles walks source and clone in lockstep; removing nodes
        // from the clone first causes the walkers to fall out of sync, resulting in
        // button styles (e.g. opacity:0) being applied to the wrong elements.
        inlineComputedStyles(clone, sourceContainer);

        if (selectedIndices) {
            filterToSelectedTurns(clone, selectedIndices);
        }

        stripInteractiveElements(clone);

        if (expandToolGroups) {
            expandCollapsedGroups(clone);
        }

        if (forPrint) {
            stripAbsoluteWidths(clone);
        }

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
    // Remove 'collapsed' and 'hidden' classes from tool call bodies.
    // Also clear any inlined display:none that was baked in by inlineComputedStyles
    // before this function is called.
    clone.querySelectorAll('.tool-call-body.collapsed, .tool-call-body.hidden').forEach(el => {
        el.classList.remove('collapsed', 'hidden');
        (el as HTMLElement).style.display = '';
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

/**
 * Strip inlined absolute pixel `width` and `max-width` values that would
 * overflow a print page. Called as a safety net when `forPrint` is true —
 * the CSS `!important` rules in `buildPrintDocument` are the primary fix,
 * but stripping inline values ensures no edge cases leak through.
 */
export function stripAbsoluteWidths(root: HTMLElement): void {
    const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
    let node = walker.nextNode() as HTMLElement | null;
    while (node) {
        const style = node.getAttribute('style');
        if (style) {
            // Remove width/max-width with absolute pixel values (e.g. "max-width:1140px")
            const cleaned = style
                .replace(/max-width\s*:\s*\d+(\.\d+)?px\s*(;|$)/gi, '')
                .replace(/\bwidth\s*:\s*\d+(\.\d+)?px\s*(;|$)/gi, '')
                .replace(/;\s*$/, '')  // trailing semicolon
                .trim();
            if (cleaned) {
                node.setAttribute('style', cleaned);
            } else {
                node.removeAttribute('style');
            }
        }
        node = walker.nextNode() as HTMLElement | null;
    }
}

/** Wrap HTML content in a container div with sensible defaults for email clients. */
function wrapInContainer(innerHtml: string): string {
    return `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;line-height:1.6;max-width:800px;">${innerHtml}</div>`;
}

/**
 * Print-scoped layout override for embedded KaTeX math. The extracted KaTeX
 * stylesheet handles glyphs and positioning; this only forces long display
 * equations to scroll horizontally instead of overflowing a narrow printed
 * page, so the PDF stays contained. Emitted only when math CSS is present.
 */
const KATEX_PRINT_OVERRIDES_CSS = `.katex-display { overflow-x: auto; overflow-y: hidden; max-width: 100%; }
.katex { max-width: 100%; }`;

/**
 * Build a full standalone HTML document from snapshot HTML, optimized for
 * printing / "Save as PDF". Removes max-height constraints so scrollable
 * containers expand to show their full content.
 *
 * Note: `overflow` is intentionally NOT overridden globally because it breaks
 * flex layouts (text renders one-char-per-line). Since `overflow` is not in
 * the snapshot STYLE_ALLOWLIST, it naturally defaults to `visible` in the
 * print document — no override needed.
 *
 * `mathCss` (from `getExportKatexCss()`) is the self-contained KaTeX stylesheet
 * — its `KaTeX_*` fonts are already inlined as `data:` URIs, so the printed math
 * needs no network. It is only embedded when the conversation actually contains
 * rendered math; the default (math-free) document is byte-for-byte unchanged.
 */
export function buildPrintDocument(snapshotHtml: string, title?: string, mathCss?: string): string {
    const safeTitle = escapeHtmlText(title || 'Chat Conversation');
    const trimmedMath = (mathCss || '').trim();
    const hasMath = trimmedMath.length > 0;

    // Height/size reset. The default is a single universal rule. When the
    // conversation carries rendered KaTeX, exclude the math subtrees from the
    // height reset only — KaTeX relies on exact inline strut/vlist heights, and a
    // blanket `height:auto` collapses fractions, scripts, and delimiters. The
    // `:not()` variant is emitted ONLY in the math path so the default document
    // is unchanged (and any older engine that drops the complex `:not()` still
    // has no math to protect in that path).
    const sizeReset = hasMath
        ? `*:not(.katex):not(.katex *) {
    max-height: none !important;
    height: auto !important;
}
* {
    max-width: 100% !important;
    box-sizing: border-box !important;
}`
        : `* {
    max-height: none !important;
    height: auto !important;
    max-width: 100% !important;
    box-sizing: border-box !important;
}`;

    // Self-contained KaTeX styling (glyphs + data:-URI @font-face) plus the
    // print-scoped scroll override. Only present when there is math to style.
    const mathStyles = hasMath
        ? `
/* --- Embedded KaTeX styling for rendered math (self-contained, no network) --- */
${trimmedMath}
${KATEX_PRINT_OVERRIDES_CSS}`
        : '';

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
${sizeReset}
/* Bubble wrappers — override inlined pixel max-width */
[data-turn-index] > div {
    max-width: 100% !important;
    width: 100% !important;
}
/* Ensure code blocks wrap instead of causing horizontal overflow */
pre, code {
    white-space: pre-wrap !important;
    word-break: break-word !important;
}
/* Override overflow-x:auto on code blocks and tables (scrollbars don't exist in print) */
.code-block-content, .md-table-container {
    overflow-x: visible !important;
}
/* Tables: remove min-width, allow wrapping */
table {
    min-width: 0 !important;
    width: 100% !important;
    table-layout: fixed !important;
    word-break: break-word !important;
}
td, th {
    word-break: break-word !important;
    overflow-wrap: break-word !important;
}
/* Long unbreakable strings (URLs, file paths) */
a, .file-path {
    word-break: break-all !important;
}
/* Images scale to fit the page */
img {
    max-width: 100% !important;
    height: auto !important;
}
/* Avoid breaking individual turn bubbles across pages */
[data-turn-index] {
    break-inside: avoid;
}${mathStyles}
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
 * Extract the self-contained KaTeX stylesheet for the print document. Never
 * throws (a missing document or cross-origin sheet degrades to unstyled math
 * markup rather than failing the export).
 */
function safeGetPrintMathCss(): string {
    try {
        return getExportKatexCss();
    } catch {
        return '';
    }
}

/**
 * Open a print-preview window with the full conversation snapshot and trigger
 * the browser's Print dialog (which offers "Save as PDF").
 *
 * `mathCss` defaults to the live app's extracted KaTeX stylesheet; callers
 * (and tests) may pass it explicitly.
 *
 * Returns `true` on success, or throws with a user-facing message on failure.
 */
export function openPrintPreview(snapshotHtml: string, title?: string, mathCss?: string): boolean {
    const css = mathCss ?? safeGetPrintMathCss();
    const doc = buildPrintDocument(snapshotHtml, title, css);
    const win = window.open('', '_blank');
    if (!win) {
        throw new Error('Pop-up blocked. Please allow pop-ups for this site and try again.');
    }
    win.document.write(doc);
    win.document.close();
    win.onload = () => win.print();
    return true;
}
