/**
 * routePath — pure helpers for hash-based SPA routing.
 *
 * The dashboard encodes navigation state in `location.hash`. Route parsers and
 * hash builders all share one contract: strip the leading `#`, split the path
 * on `/`, decode each segment on its own (so an encoded `/` — `%2F` — inside a
 * segment survives), and keep any `?query` metadata separate from the path.
 * Centralizing that contract here keeps generated links round-tripping with the
 * parsers that read them, instead of each helper re-implementing the dance.
 */

/** Remove a single leading `#` from a raw `location.hash` value. */
export function stripHash(hash: string): string {
    return hash.replace(/^#/, '');
}

/** Split a hash's path portion into raw (still-encoded) `/`-delimited segments. */
export function hashSegments(hash: string): string[] {
    return stripHash(hash).split('/');
}

/** Decode a single path segment. */
export function decodeSegment(segment: string): string {
    return decodeURIComponent(segment);
}

/** Encode a single path segment. */
export function encodeSegment(segment: string): string {
    return encodeURIComponent(segment);
}

/**
 * Encode a multi-segment path by encoding each `/`-delimited segment on its own,
 * so literal separators stay while an in-segment `/` becomes `%2F`.
 */
export function encodePath(path: string): string {
    return path.split('/').map(encodeSegment).join('/');
}

/** Decode an array of raw path segments and rejoin them with `/`. */
export function decodePath(segments: string[]): string {
    return segments.map(decodeSegment).join('/');
}

/** The `#repos/{wsId}` prefix shared by every repo-scoped hash builder. */
export function repoHashBase(wsId: string): string {
    return '#repos/' + encodeSegment(wsId);
}

export interface TokenizedHash {
    /** Raw (still-encoded) path segments, split on `/`. */
    segments: string[];
    /** Everything after the first `?`, or null when there is no query. */
    query: string | null;
}

/**
 * Split a hash into its path segments and its `?query` metadata. The query is
 * returned verbatim (without the leading `?`); the path segments stay encoded so
 * callers decode only the segments they consume.
 */
export function tokenizeHash(hash: string): TokenizedHash {
    const cleaned = stripHash(hash);
    const qIndex = cleaned.indexOf('?');
    if (qIndex === -1) {
        return { segments: cleaned.split('/'), query: null };
    }
    return {
        segments: cleaned.slice(0, qIndex).split('/'),
        query: cleaned.slice(qIndex + 1),
    };
}
