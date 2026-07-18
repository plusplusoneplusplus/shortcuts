/**
 * mathNodeMarked — a `marked` extension for the rich-editor (Tiptap) path.
 *
 * Unlike the shared `mathMarkedExtension` (which renders KaTeX HTML directly for
 * read-only Markdown surfaces), this extension emits inert placeholder elements
 * that carry the formula's exact source in data attributes:
 *
 *   inline  → `<span data-math="inline"  data-tex="…" data-delim="…"></span>`
 *   display → `<div  data-math="display" data-tex="…" data-delim="…"></div>`
 *
 * Tiptap parses those into `mathInline` / `mathDisplay` nodes (see
 * `extensions/mathNode.tsx`) that render KaTeX at runtime and open an inline TeX
 * editor. On save, turndown reads the same data attributes and rebuilds the
 * original delimited source byte-for-byte via `wrapMathDelimiters`, so no KaTeX
 * HTML or MathML is ever persisted into the Note's Markdown source.
 *
 * The delimiter split mirrors `mathMarkedExtension`: standalone display math is
 * a block token; everything else (including display delimiters appearing inside
 * a paragraph) is an inline token so it can live inside a paragraph node.
 */

import type { MarkedExtension, TokenizerAndRendererExtension, Tokens } from 'marked';
import { matchMathAtStart, type MathDelimiter } from '../../../../shared/math/mathTokenizer';
import { nextInlineMathStart } from '../../../../shared/math/mathMarkedExtension';

interface MathNodeToken extends Tokens.Generic {
    type: 'cocMathNodeInline' | 'cocMathNodeBlock';
    tex: string;
    display: boolean;
    delimiter: MathDelimiter;
}

/** Escape a value for safe inclusion inside a double-quoted HTML attribute. */
function escapeAttr(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

/** Escape a value for safe inclusion as HTML text content. */
function escapeText(value: string): string {
    return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// The TeX is written both as `data-tex` (authoritative, read by turndown) and as
// the element's text content. The text content is required so turndown does not
// treat the placeholder as a blank node and drop it before the math rule runs;
// Tiptap ignores it (the node is an atom parsed from `data-tex`).
function inlinePlaceholder(tex: string, delimiter: MathDelimiter): string {
    return `<span data-math="inline" data-tex="${escapeAttr(tex)}" data-delim="${delimiter}">${escapeText(tex)}</span>`;
}

function displayPlaceholder(tex: string, delimiter: MathDelimiter): string {
    return `<div data-math="display" data-tex="${escapeAttr(tex)}" data-delim="${delimiter}">${escapeText(tex)}</div>`;
}

const inlineMathNode: TokenizerAndRendererExtension = {
    name: 'cocMathNodeInline',
    level: 'inline',
    start(src: string) {
        return nextInlineMathStart(src);
    },
    tokenizer(src: string) {
        const m = matchMathAtStart(src);
        if (!m) return undefined;
        const token: MathNodeToken = {
            type: 'cocMathNodeInline',
            raw: m.raw,
            tex: m.tex,
            display: m.display,
            delimiter: m.delimiter,
        };
        return token;
    },
    renderer(token: Tokens.Generic) {
        const t = token as MathNodeToken;
        return inlinePlaceholder(t.tex, t.delimiter);
    },
};

const blockMathNode: TokenizerAndRendererExtension = {
    name: 'cocMathNodeBlock',
    level: 'block',
    start(src: string) {
        const m = /\$\$|\\\[/.exec(src);
        return m ? m.index : undefined;
    },
    tokenizer(src: string) {
        // Only claim a block when the source begins with a DISPLAY delimiter and
        // the closer ends the line/block. Inline usage stays with the inline ext.
        const m = matchMathAtStart(src);
        if (!m || !m.display) return undefined;
        const after = src[m.length];
        if (after !== undefined && after !== '\n') return undefined;
        const token: MathNodeToken = {
            type: 'cocMathNodeBlock',
            raw: after === '\n' ? m.raw + '\n' : m.raw,
            tex: m.tex,
            display: true,
            delimiter: m.delimiter,
        };
        return token;
    },
    renderer(token: Tokens.Generic) {
        const t = token as MathNodeToken;
        return displayPlaceholder(t.tex, t.delimiter);
    },
};

/**
 * Marked extension that turns TeX math into editable Tiptap formula placeholders.
 * Register on the notes `marked` singleton via `marked.use(mathNodeMarkedExtension)`.
 */
export const mathNodeMarkedExtension: MarkedExtension = {
    extensions: [blockMathNode, inlineMathNode],
};
