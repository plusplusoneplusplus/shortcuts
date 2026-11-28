/**
 * Client-side arXiv paste detection.
 *
 * A cheap gate that decides whether a pasted string looks like a single arXiv
 * URL / identifier, so a host can route it to its own paper importer (which
 * stays the authoritative recognizer). Keeping this loose but host-anchored
 * avoids a round trip on every text paste while never hijacking a paste that
 * merely contains an arXiv link inside a paragraph.
 *
 * Pure — no I/O, safe to import anywhere and unit-test in isolation.
 */

/**
 * Return true if the pasted text is a lone arXiv reference (URL or `arXiv:` id).
 *
 * Requires the whole paste to be a single whitespace-free token so a pasted
 * paragraph that happens to mention arxiv.org does not get swallowed into a PDF
 * embed. Host-anchored on `arxiv.org/` or the `arXiv:` scheme.
 */
export function isLikelyArxivUrl(text: unknown): boolean {
    if (typeof text !== 'string') return false;
    const trimmed = text.trim();
    if (!trimmed || /\s/.test(trimmed)) return false;
    const lower = trimmed.toLowerCase();
    return /(^|\/\/|\.)arxiv\.org\//.test(lower) || /^arxiv:/.test(lower);
}
