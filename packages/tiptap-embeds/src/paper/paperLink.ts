import { isEmbeddableMapUrl, isPdfUrl, isYouTubeUrl } from '../urls/index.js';

/**
 * A link the paper decoration acts on. `kind` is `'pdf'` for the default
 * classifier; hosts may add their own kinds and fields (e.g. arXiv metadata).
 */
export interface PaperLinkInfo {
    kind: string;
    /** The href exactly as authored; New tab opens this. */
    href: string;
}

/**
 * Default paper classifier: any URL whose path ends in `.pdf`. YouTube and map
 * URLs are never papers — they have their own embeds.
 */
export function classifyPdfLink(href: unknown): PaperLinkInfo | null {
    if (typeof href !== 'string') return null;
    const trimmed = href.trim();
    if (!trimmed) return null;
    if (isYouTubeUrl(trimmed) || isEmbeddableMapUrl(trimmed)) return null;
    return isPdfUrl(trimmed) ? { kind: 'pdf', href: trimmed } : null;
}
