/**
 * Percent-encoded forms that must never survive into a decoded path: `.` (as in
 * `..`), the two separators, NUL, and `%` itself — the marker of a
 * double-encoded payload. A caller checks its STILL-ENCODED input with this
 * before decoding, so `%2e%2e` is refused before it becomes `..` and
 * `%252e%252e` is refused before it becomes `%2e%2e`.
 *
 * Kept narrower than "any percent-escape" because a URL legitimately encodes
 * spaces and other ordinary filename characters as `%20` and friends.
 */
const ENCODED_PATH_ESCAPES = /%(?:2e|2f|5c|00|25)/i;

/**
 * True when a still-percent-encoded path contains an escape that would decode
 * into a traversal character. Layer 0, for callers holding the raw form (the
 * REST route matches on the raw pathname); {@link isSafeCanvasFilePath} then
 * checks the decoded form.
 */
export function hasEncodedPathEscape(rawPath: string): boolean {
    return ENCODED_PATH_ESCAPES.test(rawPath);
}

/**
 * Any percent-escape at all, applied to a path that has ALREADY been decoded.
 * A real filename can contain a bare `%` (`50% off.csv`), but a `%` followed by
 * two hex digits in a decoded path means the input was encoded twice, and the
 * only reason to do that is to survive one decode.
 */
const RESIDUAL_PERCENT_ESCAPE = /%[0-9a-fA-F]{2}/;

/**
 * Reject a canvas-relative file path by SHAPE, before it touches the
 * filesystem. This is layer 1 of 4 (shape → resolve → containment → realpath);
 * on its own it proves nothing about where the path lands, only that it is not
 * obviously trying to leave.
 *
 * Rejected: `..` in any position, an absolute path (leading separator or a
 * Windows drive letter), a UNC path, backslashes (a separator on Windows and a
 * legal filename character on POSIX — never worth the ambiguity), NUL and other
 * control characters, and any residual percent-escape (see
 * {@link RESIDUAL_PERCENT_ESCAPE}).
 *
 * Takes the DECODED path. A caller holding the raw URL form runs
 * {@link hasEncodedPathEscape} on it first.
 */
export function isSafeCanvasFilePath(relativePath: unknown): relativePath is string {
    if (typeof relativePath !== 'string') return false;
    if (relativePath.length === 0 || relativePath.length > 1024) return false;
    // NUL and every other C0 control character (a NUL truncates the path in
    // some syscall layers, so anything after it would be invisible here).
    // eslint-disable-next-line no-control-regex
    if (/[\u0000-\u001f\u007f]/.test(relativePath)) return false;
    if (relativePath.includes('\\')) return false;
    if (RESIDUAL_PERCENT_ESCAPE.test(relativePath)) return false;
    if (relativePath.startsWith('/')) return false;
    if (/^[a-zA-Z]:/.test(relativePath)) return false;
    // `..` anywhere — as a whole segment, and also inside a name, which no
    // legitimate data file needs and which keeps this check unarguable.
    if (relativePath.includes('..')) return false;
    // A `.` or empty segment (`a//b`, `a/./b`) normalizes away rather than
    // resolving to a real name; reject instead of silently accepting an alias.
    if (relativePath.split('/').some(segment => segment === '' || segment === '.')) return false;
    return true;
}
