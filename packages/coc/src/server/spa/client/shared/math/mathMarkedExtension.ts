/**
 * Shared `marked` extension that renders TeX math in every Marked-based surface.
 *
 * Registering this extension (via `new Marked(...).use(mathMarkedExtension)` or
 * `marked.use(mathMarkedExtension)`) makes all four delimiter forms render
 * through the shared safe KaTeX policy:
 *
 *   - Inline:  `$...$`   and  `\(...\)`
 *   - Display: `$$...$$` and  `\[...\]`  (display may span multiple lines)
 *
 * Why a Marked extension rather than a pre/post placeholder pass: Marked
 * tokenizes fenced code, indented code, and inline code spans BEFORE inline
 * text, so custom inline/block tokenizers never see the inside of a code region.
 * That gives us "no math inside code" for free, without a second parser fighting
 * Marked over TeX characters. Currency (`$5`), shell (`$HOME`), template
 * (`${x}`), and escaped (`\$`) cases are rejected by `matchMathAtStart`, so they
 * stay literal and never become false-positive equations.
 *
 * Streaming safety: an unclosed opener never matches (there is no valid closing
 * delimiter yet), so it falls through to plain text and renders as readable
 * source until its closer arrives on a later chunk.
 */

import type { MarkedExtension, TokenizerAndRendererExtension, Tokens } from 'marked';
import { matchMathAtStart } from './mathTokenizer';
import { renderMath } from './renderMath';

interface MathToken extends Tokens.Generic {
    type: 'cocMathInline' | 'cocMathBlock';
    tex: string;
    display: boolean;
}

/**
 * Earliest index at which a math token could actually start, scanning forward
 * from `offset`. Returns undefined when no such position matches. Only positions
 * where `matchMathAtStart` succeeds are returned, so Marked's inlineText never
 * stops at a `$` that turns out to be currency (which would otherwise risk a
 * stall). Used by the inline extension's `start` hook.
 */
export function nextInlineMathStart(src: string): number | undefined {
    let offset = 0;
    while (offset < src.length) {
        let candidate = -1;
        for (let i = offset; i < src.length; i++) {
            const c = src[i];
            if (c === '$' || (c === '\\' && (src[i + 1] === '(' || src[i + 1] === '['))) {
                candidate = i;
                break;
            }
        }
        if (candidate === -1) return undefined;
        if (matchMathAtStart(src.slice(candidate))) return candidate;
        offset = candidate + 1;
    }
    return undefined;
}

const inlineMath: TokenizerAndRendererExtension = {
    name: 'cocMathInline',
    level: 'inline',
    start(src: string) {
        return nextInlineMathStart(src);
    },
    tokenizer(src: string) {
        const m = matchMathAtStart(src);
        if (!m) return undefined;
        const token: MathToken = {
            type: 'cocMathInline',
            raw: m.raw,
            tex: m.tex,
            display: m.display,
        };
        return token;
    },
    renderer(token: Tokens.Generic) {
        const t = token as MathToken;
        return renderMath(t.tex, { display: t.display });
    },
};

const blockMath: TokenizerAndRendererExtension = {
    name: 'cocMathBlock',
    level: 'block',
    start(src: string) {
        const m = /\$\$|\\\[/.exec(src);
        return m ? m.index : undefined;
    },
    tokenizer(src: string) {
        // Only claim a block when the source begins with a DISPLAY delimiter and
        // the closer is followed by end-of-block or a newline. Inline usage
        // (`text $$x$$ more`) is left to the inline extension.
        const m = matchMathAtStart(src);
        if (!m || !m.display) return undefined;
        const after = src[m.length];
        if (after !== undefined && after !== '\n') return undefined;
        const token: MathToken = {
            type: 'cocMathBlock',
            // Consume a trailing newline so the block lexer advances cleanly.
            raw: after === '\n' ? m.raw + '\n' : m.raw,
            tex: m.tex,
            display: true,
        };
        return token;
    },
    renderer(token: Tokens.Generic) {
        const t = token as MathToken;
        return renderMath(t.tex, { display: true });
    },
};

/**
 * The shared Marked extension. Register once per Marked instance.
 */
export const mathMarkedExtension: MarkedExtension = {
    extensions: [blockMath, inlineMath],
};
