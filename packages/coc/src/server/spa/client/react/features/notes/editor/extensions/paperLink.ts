/**
 * paperLink — classify whether a link href qualifies for paper/PDF decoration
 * (paper-link-embed, AC-01, pure).
 *
 * A link mark in a note gets YouTube-style paper affordances (Open inline /
 * Popout / New tab) when its href is either:
 *   - a recognized arXiv URL in any form (`/pdf/<id>`, `/pdf/<id>.pdf`,
 *     `/abs/<id>`, version suffixes like `2104.04473v3`, old-style ids), OR
 *   - any URL whose path ends in `.pdf`.
 *
 * YouTube and map URLs are intentionally excluded — those already have their own
 * decoration extensions and neither is arXiv-hosted nor ends in `.pdf`, but we
 * guard against them explicitly so a pathological `.pdf`-suffixed video/map URL
 * never gets double-decorated.
 *
 * This reuses the existing recognizers rather than inventing a new regex:
 *   - {@link recognizeArxivUrl} from the server-side (pure) arXiv module, and
 *   - forge {@link isPdfUrl}.
 *
 * Pure — no I/O, no DOM. Safe to import anywhere and unit-test in isolation.
 */

import { isPdfUrl, isYouTubeUrl, isEmbeddableMapUrl } from '@plusplusoneplusplus/forge/editor/rendering';
import { recognizeArxivUrl, type RecognizedArxiv } from '../../../../../../../notes/arxiv-url';

/** How a paper link should be rendered by the inline/popout viewers. */
export type PaperLinkKind = 'arxiv' | 'pdf';

export interface PaperLinkInfo {
    /** `'arxiv'` when the href is a recognized arXiv reference, else `'pdf'`. */
    kind: PaperLinkKind;
    /**
     * The original, human-friendly href exactly as authored. This is what the
     * **New tab** action opens (never the internal `.papers/` cache path).
     */
    href: string;
    /** The canonical arXiv descriptor when `kind === 'arxiv'`. */
    arxiv?: RecognizedArxiv;
}

/**
 * Classify a link href for paper decoration. Returns the descriptor when the
 * href qualifies, or `null` when it does not (including YouTube / map / plain
 * links and non-string input).
 */
export function classifyPaperLink(href: unknown): PaperLinkInfo | null {
    if (typeof href !== 'string') return null;
    const trimmed = href.trim();
    if (!trimmed) return null;

    // YouTube and maps own their own decorations — never treat them as papers.
    if (isYouTubeUrl(trimmed) || isEmbeddableMapUrl(trimmed)) return null;

    const arxiv = recognizeArxivUrl(trimmed);
    if (arxiv) return { kind: 'arxiv', href: trimmed, arxiv };

    if (isPdfUrl(trimmed)) return { kind: 'pdf', href: trimmed };

    return null;
}

/** Cheap boolean gate over {@link classifyPaperLink}. */
export function isPaperLinkHref(href: unknown): boolean {
    return classifyPaperLink(href) !== null;
}
