/**
 * arXiv URL recognition & normalization (Goal 3, pure).
 *
 * Recognizes the URL forms a user might paste for an arXiv paper and reduces them
 * to a canonical arXiv identifier plus the canonical PDF/abstract URLs and a
 * filesystem-safe filename base for the local cache.
 *
 * Supported inputs (host-anchored — a bare `1802.05799`-looking number in an
 * unrelated URL is intentionally NOT recognized):
 *   - https://arxiv.org/pdf/1802.05799
 *   - https://arxiv.org/pdf/1802.05799v3.pdf
 *   - http://arxiv.org/abs/1802.05799v2
 *   - https://arxiv.org/abs/hep-th/9901001        (old-style identifier)
 *   - https://www.arxiv.org/pdf/math.GT/0309136
 *   - arXiv:1802.05799                            (identifier scheme)
 *
 * Pure — no I/O, no runtime dependencies. Safe to import anywhere.
 */

/** New-style identifier body: YYMM.NNNNN (4 or 5 digits after the dot). */
const NEW_ID_BODY = /\d{4}\.\d{4,5}/;
/** Old-style identifier body: archive[.subclass]/YYMMNNN. */
const OLD_ID_BODY = /[a-zA-Z-]+(?:\.[a-zA-Z]{2})?\/\d{7}/;
/** Optional version suffix. */
const VERSION = /v\d+/;

const NEW_ID_RE = new RegExp(`(${NEW_ID_BODY.source})(${VERSION.source})?`);
const OLD_ID_RE = new RegExp(`(${OLD_ID_BODY.source})(${VERSION.source})?`);

export interface RecognizedArxiv {
    /** Canonical identifier including any version, e.g. "1802.05799v3" or "hep-th/9901001". */
    arxivId: string;
    /** Identifier without the version suffix. */
    arxivIdBase: string;
    /** Version suffix ("v3") if the input pinned one, else undefined. */
    version?: string;
    /** Canonical PDF URL, e.g. "https://arxiv.org/pdf/1802.05799v3". */
    pdfUrl: string;
    /** Canonical abstract URL, e.g. "https://arxiv.org/abs/1802.05799v3". */
    absUrl: string;
    /** Filesystem-safe base name for the cache, e.g. "1802.05799v3" or "hep-th_9901001". */
    filename: string;
}

/**
 * Return true if the input string looks like it targets arxiv.org (or uses the
 * `arXiv:` identifier scheme). Used to host-anchor recognition so a numeric that
 * merely resembles an arXiv id inside an unrelated URL is not misclassified.
 */
function isArxivHosted(input: string): boolean {
    const lower = input.toLowerCase();
    return /(^|\/\/|\.)arxiv\.org\//.test(lower) || /^\s*arxiv:/.test(lower);
}

/**
 * Convert an arXiv identifier to a filesystem-safe filename base by replacing the
 * `/` in old-style ids and stripping anything that is not `[A-Za-z0-9._-]`.
 */
export function arxivIdToFilename(arxivId: string): string {
    return arxivId.replace(/\//g, '_').replace(/[^A-Za-z0-9._-]/g, '');
}

/**
 * Recognize an arXiv paper reference in the given input.
 * Returns the canonical descriptor, or `null` if the input is not an arXiv URL/id.
 */
export function recognizeArxivUrl(input: unknown): RecognizedArxiv | null {
    if (typeof input !== 'string') return null;
    const trimmed = input.trim();
    if (!trimmed || !isArxivHosted(trimmed)) return null;

    // Prefer the new-style id; fall back to the old-style archive/number form.
    // Anchor old-style to the `/abs/` or `/pdf/` segment (or the arXiv: scheme) so
    // a subclass like `math.GT` is not accidentally chopped by the new-style regex.
    const newMatch = NEW_ID_RE.exec(trimmed);
    const oldMatch = OLD_ID_RE.exec(trimmed);

    let base: string;
    let version: string | undefined;
    if (newMatch) {
        base = newMatch[1];
        version = newMatch[2] || undefined;
    } else if (oldMatch) {
        base = oldMatch[1];
        version = oldMatch[2] || undefined;
    } else {
        return null;
    }

    const arxivId = version ? `${base}${version}` : base;
    return {
        arxivId,
        arxivIdBase: base,
        version,
        pdfUrl: `https://arxiv.org/pdf/${arxivId}`,
        absUrl: `https://arxiv.org/abs/${arxivId}`,
        filename: arxivIdToFilename(arxivId),
    };
}
