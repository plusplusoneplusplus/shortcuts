import { Lexer, type MarkedExtension, type Token } from 'marked';

/** Only an attribute-free break tag may bypass HTML escaping. */
function isHtmlLineBreak(token: Token): boolean {
    return !('inRawBlock' in token && token.inRawBlock === true) && /^<br[ \t]*\/?>$/i.test(token.raw);
}

export const htmlLineBreakMarkedExtension: MarkedExtension = {
    extensions: [{
        name: 'html',
        renderer(token) {
            return isHtmlLineBreak(token) ? '<br>' : false;
        },
    }],
};

/**
 * Protect parsed breaks while retaining the existing preview inline formatter.
 * Marked identifies code, escapes and HTML attributes before break protection.
 */
export function protectInlineHtmlLineBreaks(text: string): {
    text: string;
    restores: { token: string; html: string }[];
} {
    const restores: { token: string; html: string }[] = [];
    if (!/<br[ \t]*\/?>/i.test(text)) return { text, restores };

    let prefix = 'xCOCHTMLBREAKx';
    while (text.includes(prefix)) prefix += 'x';

    function protect(tokens: Token[]): string {
        return tokens.map(token => {
            if (token.type === 'html' && isHtmlLineBreak(token)) {
                const placeholder = `${prefix}${restores.length}x`;
                restores.push({ token: placeholder, html: '<br>' });
                return placeholder;
            }
            if ('tokens' in token && Array.isArray(token.tokens) && token.tokens.length) {
                const children = token.tokens;
                // Child raw text excludes emphasis delimiters and link destinations.
                const inner = children.map(child => child.raw).join('');
                return token.raw.replace(inner, () => protect(children));
            }
            return token.raw;
        }).join('');
    }

    return { text: protect(Lexer.lexInline(text, { gfm: true })), restores };
}
