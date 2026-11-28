/**
 * Markdown codec extension for TeX math: the four delimiter forms parse into
 * `mathInline` / `mathDisplay` placeholders, and those serialize back to the
 * exact original delimited source.
 */

import type TurndownService from 'turndown';
import type { MarkdownCodecExtension } from '../markdown/createMarkdownCodec.js';
import { escapeAttr } from '../markdown/htmlAttrs.js';
import { escapeHtmlText } from '../html/escape.js';
import { parseIndentAttr } from '../indent/index.js';
import { wrapMathDelimiters, type MathDelimiter } from './mathTokenizer.js';
import { mathNodeMarkedExtension } from './mathNodeMarked.js';

function addMathRules(turndown: TurndownService): void {
    // Math formula nodes: rebuild the exact original delimited source from the
    // node's stored delimiter + TeX. Because the TeX is preserved verbatim in
    // `data-tex`, an unedited formula round-trips byte-for-byte, and no rendered
    // KaTeX/MathML is ever serialized into the Markdown source.
    function mathDelimiterFromNode(node: HTMLElement, fallback: MathDelimiter): MathDelimiter {
        const raw = node.getAttribute('data-delim');
        if (raw === 'dollar' || raw === 'double-dollar' || raw === 'paren' || raw === 'bracket') {
            return raw;
        }
        return fallback;
    }

    turndown.addRule('mathInline', {
        filter(node) {
            return (
                node.nodeName === 'SPAN' &&
                (node as Element).getAttribute('data-math') === 'inline'
            );
        },
        replacement(_content, node) {
            const el = node as HTMLElement;
            const tex = el.getAttribute('data-tex') ?? '';
            return wrapMathDelimiters(mathDelimiterFromNode(el, 'dollar'), tex);
        },
    });

    turndown.addRule('mathDisplay', {
        filter(node) {
            return (
                node.nodeName === 'DIV' &&
                (node as Element).getAttribute('data-math') === 'display'
            );
        },
        replacement(_content, node) {
            const el = node as HTMLElement;
            const tex = el.getAttribute('data-tex') ?? '';
            const delim = mathDelimiterFromNode(el, 'double-dollar');
            const indent = parseIndentAttr(el);
            if (indent > 0) {
                // Delimited `$$…$$` source has no indent metadata, so emit a raw HTML
                // placeholder div carrying `data-indent` (plus the exact TeX/delimiter);
                // marked passes it through and MathDisplay re-parses all three.
                return `\n\n<div data-math="display" data-tex="${escapeAttr(tex)}" data-delim="${delim}" data-indent="${indent}">${escapeHtmlText(tex)}</div>\n\n`;
            }
            return `\n\n${wrapMathDelimiters(delim, tex)}\n\n`;
        },
    });
}

export const mathMarkdownExtension: MarkdownCodecExtension = {
    name: 'math',
    marked: mathNodeMarkedExtension,
    turndownRules: addMathRules,
};
