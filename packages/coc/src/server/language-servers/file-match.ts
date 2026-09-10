/**
 * Path normalization and glob matching for language-server file patterns.
 *
 * Patterns are matched against the workspace-relative path in POSIX form so
 * the same definition behaves identically on Linux, macOS, and Windows.
 */

/**
 * Convert a workspace-relative path to the POSIX form used for matching:
 * backslashes become slashes, leading `./` and `/` are dropped, and repeated
 * separators collapse.
 */
export function normalizeRelativePath(filePath: string): string {
    return filePath
        .replace(/\\/g, '/')
        .replace(/\/+/g, '/')
        .replace(/^\.\//, '')
        .replace(/^\//, '');
}

/** Lowercase extension including the dot, or `''` when the file has none. */
export function fileExtension(filePath: string): string {
    const name = normalizeRelativePath(filePath).split('/').pop() ?? '';
    const dot = name.lastIndexOf('.');
    return dot > 0 ? name.slice(dot).toLowerCase() : '';
}

/**
 * Translate a glob pattern into regular-expression source.
 *
 * Supported syntax: `**` (any number of path segments), `*` (any run of
 * characters inside one segment), `?` (one character inside one segment), and
 * `{a,b}` alternation. Everything else is literal.
 */
function translate(pattern: string): string {
    let source = '';
    for (let i = 0; i < pattern.length; i++) {
        const char = pattern[i];
        if (char === '*') {
            if (pattern[i + 1] === '*') {
                i++;
                // `**/` also matches zero segments so `**/*.ts` covers `a.ts`.
                if (pattern[i + 1] === '/') {
                    i++;
                    source += '(?:[^/]*/)*';
                } else {
                    source += '.*';
                }
            } else {
                source += '[^/]*';
            }
        } else if (char === '?') {
            source += '[^/]';
        } else if (char === '{' && pattern.includes('}', i)) {
            const end = pattern.indexOf('}', i);
            source += `(?:${pattern.slice(i + 1, end).split(',').map(translate).join('|')})`;
            i = end;
        } else {
            source += char.replace(/[.+^${}()|[\]\\]/g, '\\$&');
        }
    }
    return source;
}

const patternCache = new Map<string, RegExp>();

/** True when the workspace-relative path matches the glob pattern. */
export function matchesPattern(pattern: string, filePath: string): boolean {
    let regex = patternCache.get(pattern);
    if (!regex) {
        regex = new RegExp(`^${translate(pattern)}$`);
        patternCache.set(pattern, regex);
    }
    return regex.test(normalizeRelativePath(filePath));
}

/**
 * Most specific matching pattern, or `undefined` when none match. Specificity
 * is the pattern's literal length, so `**\/*.test.ts` beats `**\/*.ts`.
 */
export function bestMatchingPattern(patterns: string[], filePath: string): string | undefined {
    let best: string | undefined;
    for (const pattern of patterns) {
        if (!matchesPattern(pattern, filePath)) {
            continue;
        }
        if (best === undefined || patternSpecificity(pattern) > patternSpecificity(best)) {
            best = pattern;
        }
    }
    return best;
}

/** Count of literal (non-wildcard) characters in a pattern. */
export function patternSpecificity(pattern: string): number {
    return pattern.replace(/[*?{},]/g, '').length;
}
