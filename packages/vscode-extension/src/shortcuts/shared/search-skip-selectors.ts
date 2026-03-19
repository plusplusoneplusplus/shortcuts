/**
 * CSS selectors for display-only UI elements that should be excluded from search.
 * These elements are added by the editor for display purposes and are not part
 * of the original document content.
 *
 * This is extracted to a separate file to allow importing in both webview and
 * Node.js (test) environments.
 */
export const SEARCH_SKIP_SELECTORS = [
    // Search UI
    '.search-bar',
    '.search-highlight',
    // Line numbers and gutter
    '.line-number',
    '.line-number-column',
    '.gutter-icon',
    // Collapsed/truncated indicators
    '.collapsed-hint',
    '.collapsed-range',
    '.collapsed-indicator',
    '.truncated-indicator',
    '.line-number-truncated',
    // Comment bubbles (display-only UI)
    '.inline-comment-bubble',
    // Toolbar elements
    '.toolbar',
    '.editor-toolbar',
    // Non-editable content marker
    '[contenteditable="false"]'
] as const;

export type SearchSkipSelector = typeof SEARCH_SKIP_SELECTORS[number];
