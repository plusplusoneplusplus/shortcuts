import { parseGlobList } from '../../repo-detail/explorer/types';

export type ReviewContentInclude =
    | { error: null; includes: (path: string) => boolean }
    | { error: string; includes: null };

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Browser-only glob compiler: *, ?, character classes and whole-segment **. */
function compileGlob(glob: string): RegExp {
    const rooted = glob.startsWith('/') || glob.startsWith('./');
    if (glob.startsWith('/')) glob = glob.slice(1);
    if (glob.startsWith('./')) glob = glob.slice(2);
    let source = '';
    for (let index = 0; index < glob.length; index++) {
        const char = glob[index];
        if (char === '*') {
            const start = index;
            while (glob[index + 1] === '*') index++;
            const globstar = index > start && (start === 0 || glob[start - 1] === '/')
                && (index === glob.length - 1 || glob[index + 1] === '/');
            if (globstar && glob[index + 1] === '/') {
                source += '(?:[^/]+/)*';
                index++;
            } else {
                source += globstar ? '[\\s\\S]*' : '[^/]*';
            }
        } else if (char === '?') {
            source += '[^/]';
        } else if (char === '[') {
            const start = index;
            let body = '';
            let negate = false;
            if (glob[index + 1] === '!' || glob[index + 1] === '^') {
                negate = true;
                index++;
            }
            while (++index < glob.length && glob[index] !== ']') {
                if (glob[index] === '\\') {
                    if (++index === glob.length) throw new Error('Trailing escape');
                    body += `\\u{${glob.charCodeAt(index).toString(16)}}`;
                } else {
                    body += glob[index] === '^' || glob[index] === '[' ? `\\${glob[index]}` : glob[index];
                }
            }
            if (index === glob.length || !body) throw new Error(`Invalid character class at ${start + 1}`);
            // Even a negated class cannot consume a path separator.
            source += `(?!/)[${negate ? '^' : ''}${body}]`;
        } else if (char === '\\') {
            if (++index === glob.length) throw new Error('Trailing escape');
            source += escape(glob[index]);
        } else {
            source += escape(char);
        }
    }
    // Slash-free patterns apply to file names at any depth; paths are root-relative.
    return new RegExp(`^${!rooted && !glob.includes('/') ? '(?:[^/]+/)*' : ''}${source}$`, 'u');
}

/** Comma-separated include patterns are ORed; an empty list includes every file. */
export function compileReviewContentInclude(value: string): ReviewContentInclude {
    try {
        const patterns = (parseGlobList(value) ?? []).map(compileGlob);
        return {
            error: null,
            includes: path => patterns.length === 0 || patterns.some(pattern => pattern.test(path.replace(/\\/g, '/'))),
        };
    } catch (error) {
        return { error: `Invalid include glob: ${error instanceof Error ? error.message : String(error)}`, includes: null };
    }
}
