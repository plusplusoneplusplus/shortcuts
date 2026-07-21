/** Default rendered height (px) for an inline PDF embed. */
export const DEFAULT_PDF_EMBED_HEIGHT = 480;
export const MIN_PDF_EMBED_HEIGHT = 160;
export const MAX_PDF_EMBED_HEIGHT = 1200;

/**
 * True when `href` points at a PDF file.
 *
 * Matches on the URL's pathname ending in `.pdf` (case-insensitive) and is
 * tolerant of query strings and fragments. Accepts both absolute URLs
 * (`https://…/doc.pdf`) and relative attachment paths (`.attachments/x.pdf`).
 */
export function isPdfUrl(href: string | null | undefined): boolean {
    if (!href) return false;
    const trimmed = href.trim();
    if (!trimmed) return false;

    // Strip fragment and query so `x.pdf?y=1#z` still matches.
    const withoutFragment = trimmed.split('#', 1)[0];
    const withoutQuery = withoutFragment.split('?', 1)[0];
    return /\.pdf$/i.test(withoutQuery);
}
