/**
 * createMarkdownCodec — Markdown ↔ HTML conversion for a Tiptap editor.
 *
 * `markdownToHtml` runs marked (GFM, `breaks`) and rewrites the output into the
 * markup Tiptap parses (task lists, empty paragraphs, colgroup widths, inline
 * styles). `htmlToMarkdown` runs turndown over `editor.getHTML()` with rules for
 * task lists, tables, highlight, sup/sub, text style, indentation, alignment,
 * sized images, comment spans and Mermaid code blocks. Anything Markdown has no
 * syntax for is written as inline or block HTML that the next load re-parses.
 *
 * Hosts add their own syntax through `extensions`: marked extensions, turndown
 * rules, and `parse` / `serialize` wrappers for work that spans one conversion
 * (e.g. a definition block split out before parsing and folded back after).
 */

import { Marked, type MarkedExtension } from 'marked';
import TurndownService from 'turndown';
import {
    DEFAULT_HIGHLIGHT_COLOR,
    normalizeCssColor,
    readInlineColor,
    readInlineFontFamily,
    readInlineFontSize,
    readStyleProp,
} from '../text-style/index.js';
import { parseIndentAttr } from '../indent/index.js';
import { escapeHtmlText } from '../html/escape.js';
import { getHtmlAttr } from './htmlAttrs.js';
import { addTableRules } from './tableRules.js';

export interface MarkdownCodecExtension {
    /** For debugging only. */
    name: string;
    /** marked extensions (tokenizers / renderer overrides) for the Markdown → HTML side. */
    marked?: MarkedExtension | MarkedExtension[];
    /**
     * Register turndown rules for the HTML → Markdown side. Host rules are
     * checked before the built-in inline/table/list rules and after the
     * aligned-block and empty-paragraph rules.
     */
    turndownRules?: (turndown: TurndownService) => void;
    /** Wrap one Markdown → HTML conversion. `next` runs the inner wrappers and marked. */
    parse?: (markdown: string, next: (markdown: string) => string) => string;
    /** Wrap one HTML → Markdown conversion. `next` runs the inner wrappers and turndown. */
    serialize?: (html: string, next: (html: string) => string) => string;
}

export interface MarkdownCodecOptions {
    /** Applied in order; the first extension's `parse` / `serialize` is outermost. */
    extensions?: MarkdownCodecExtension[];
}

export interface MarkdownCodec {
    /** Markdown → HTML for `editor.commands.setContent()`. Empty input gives `''`. */
    markdownToHtml(markdown: string): string;
    /**
     * `editor.getHTML()` → Markdown. An empty document gives `''`; anything
     * else ends with exactly one newline.
     */
    htmlToMarkdown(html: string): string;
}

// Add ==highlight== syntax support to marked
// Add ==highlight== syntax support to marked
const highlightExtension: MarkedExtension = {
    extensions: [
        {
            name: 'highlight',
            level: 'inline' as const,
            start(src: string) {
                return src.indexOf('==');
            },
            tokenizer(src: string) {
                // `[^\n]+?` rather than `[^=]+`: a highlight may legitimately
                // contain an `=`, and since colors persist as inline HTML the
                // very common case — a colored word inside a highlight — carries
                // one in `style="…"`. Staying non-greedy and single-line keeps
                // the old matches (`a ==b== c` still highlights just `b`).
                const match = /^==([^\n]+?)==/.exec(src);
                if (match) {
                    return {
                        type: 'highlight',
                        raw: match[0],
                        text: match[1],
                        tokens: [],
                    };
                }
                return undefined;
            },
            renderer(token) {
                return `<mark>${token.text}</mark>`;
            },
        },
    ],
};

function addCoreRules(turndown: TurndownService): void {
    // Line breaks: <br> → plain \n (avoids trailing-space hard-break syntax on save)
    turndown.addRule('lineBreak', {
        filter: 'br',
        replacement() {
            return '\n';
        },
    });

    // Strikethrough: <del> / <s> → ~~text~~
    turndown.addRule('strikethrough', {
        filter: ['del', 's'],
        replacement(content) {
            return `~~${content}~~`;
        },
    });

    // Superscript / subscript: <sup> / <sub> → the same literal HTML tags. Markdown
    // has no portable syntax for either (pandoc's `^x^` / `~x~` collide with our
    // `~~strike~~` and `==highlight==` handling), and inline HTML is what marked
    // passes back through to Tiptap's parseHTML. Without a rule turndown would drop
    // the tags and keep only the bare text, silently losing the mark on every save.
    turndown.addRule('superscript', {
        filter: 'sup',
        replacement(content) {
            return `<sup>${content}</sup>`;
        },
    });

    turndown.addRule('subscript', {
        filter: 'sub',
        replacement(content) {
            return `<sub>${content}</sub>`;
        },
    });

    // Highlight: <mark> → ==text==, except for a non-default color, which has no
    // `==` syntax and is emitted as inline HTML instead. The default color stays
    // bare `==text==` so ordinary highlights remain clean Markdown and every note
    // written before colors were persisted keeps its exact current serialization.
    turndown.addRule('highlight', {
        filter: 'mark',
        replacement(content, node) {
            const el = node as HTMLElement;
            // Tiptap's Highlight extension writes `data-color` alongside the inline
            // style; either one alone is enough to recover the color.
            const color =
                readInlineColor(el.getAttribute('style'), 'background-color')
                ?? normalizeCssColor(el.getAttribute('data-color'));
            if (color && color !== DEFAULT_HIGHLIGHT_COLOR) {
                return `<mark style="background-color:${color}">${content}</mark>`;
            }
            return `==${content}==`;
        },
    });

    // Text style: <span style="color:…; font-family:…; font-size:…"> → the same
    // inline HTML. Markdown has syntax for none of them, and inline HTML is the one
    // form that survives marked → Tiptap → turndown *and* still renders in an
    // external Markdown viewer.
    //
    // Color, font family and font size are three attributes of the SAME Tiptap
    // `textStyle` mark, so one span can carry all three and they have to be
    // serialized together — a second, independent span rule would never see a span
    // the first rule already claimed.
    // Declarations are emitted in a fixed order so re-saving an untouched note
    // produces byte-identical Markdown.
    //
    // NOTE: addRule() unshifts, so this is checked BEFORE the plain `highlight` rule
    // above but AFTER every span rule registered later (note-link, file-ref, math,
    // comment, Quick Ask). Those spans carry neither declaration, so the ordering
    // only matters as insurance.
    function readTextStyleDeclarations(node: Node): string[] {
        const style = (node as HTMLElement).getAttribute('style');
        const declarations: string[] = [];
        const color = readInlineColor(style, 'color');
        if (color) declarations.push(`color:${color}`);
        const fontFamily = readInlineFontFamily(style);
        if (fontFamily) declarations.push(`font-family:${fontFamily}`);
        const fontSize = readInlineFontSize(style);
        if (fontSize) declarations.push(`font-size:${fontSize}`);
        return declarations;
    }

    turndown.addRule('textStyleSpan', {
        filter(node) {
            return node.nodeName === 'SPAN' && readTextStyleDeclarations(node).length > 0;
        },
        replacement(content, node) {
            const declarations = readTextStyleDeclarations(node);
            // An empty span carries no text to style — drop the wrapper rather than
            // leaving `<span style="…"></span>` noise in the file.
            if (declarations.length === 0 || !content) return content;
            return `<span style="${declarations.join('; ')}">${content}</span>`;
        },
    });

    // Images with a width or a nonzero indent: preserve as an HTML <img> tag so the
    // dimensions and/or the indent level round-trip (standard `![]()` syntax carries
    // neither). A plain, level-0, unsized image still serializes as `![alt](src)`.
    turndown.addRule('resizableImage', {
        filter(node) {
            return (
                node.nodeName === 'IMG' &&
                (node.hasAttribute('width') || parseIndentAttr(node as HTMLElement) > 0)
            );
        },
        replacement(_content, node) {
            const el = node as HTMLElement;
            const src = el.getAttribute('src') ?? '';
            const alt = el.getAttribute('alt') ?? '';
            const width = el.getAttribute('width') ?? '';
            const indent = parseIndentAttr(el);
            const altAttr = alt ? ` alt="${alt}"` : '';
            const widthAttr = width ? ` width="${width}"` : '';
            const indentAttr = indent > 0 ? ` data-indent="${indent}"` : '';
            return `<img src="${src}"${altAttr}${widthAttr}${indentAttr} />`;
        },
    });

    // Comment spans: strip wrapper, keep inner text
    turndown.addRule('commentSpan', {
        filter(node) {
            return (
                node.nodeName === 'SPAN' &&
                node.hasAttribute('data-comment-id')
            );
        },
        replacement(content) {
            return content;
        },
    });

    // Task list container: pass through children, don't wrap in extra markup
    turndown.addRule('taskList', {
        filter(node) {
            return (
                node.nodeName === 'UL' &&
                node.getAttribute('data-type') === 'taskList'
            );
        },
        replacement(_content, node) {
            // Process children manually to preserve task item rules
            let out = '';
            for (const child of Array.from(node.childNodes)) {
                if (child.nodeType === 1) {
                    out += turndown.turndown((child as Element).outerHTML) + '\n';
                }
            }
            return out;
        },
    });

    // Task list item: serialize to `- [x] ` or `- [ ] `
    turndown.addRule('taskItem', {
        filter(node) {
            return (
                node.nodeName === 'LI' &&
                node.getAttribute('data-type') === 'taskItem'
            );
        },
        replacement(_content, node) {
            const checked = node.getAttribute('data-checked') === 'true';
            const prefix = checked ? '- [x] ' : '- [ ] ';
            // Get inner text content, stripping the leading checkbox if present
            let inner = '';
            for (const child of Array.from(node.childNodes)) {
                if (child.nodeType === 1) {
                    const el = child as Element;
                    // Skip checkbox inputs, process other content
                    if (el.nodeName === 'INPUT') continue;
                    // For label or paragraph wrappers, get their text
                    if (el.nodeName === 'LABEL' || el.nodeName === 'DIV' || el.nodeName === 'P') {
                        inner += el.textContent ?? '';
                    } else {
                        inner += turndown.turndown(el.outerHTML);
                    }
                } else if (child.nodeType === 3) {
                    inner += child.textContent ?? '';
                }
            }
            return prefix + inner.trim();
        },
    });

    // Indented list containers (bulletList / orderedList / taskList with data-indent > 0):
    // standard Markdown list syntax cannot carry an indent attribute, so the whole
    // element is emitted as a raw HTML block that marked passes through unchanged and
    // Tiptap re-parses on reload. Level-0 lists fall through to the normal rules above.
    // NOTE: TurndownService.addRule() prepends (unshift) — last added = first checked.
    // This rule is added AFTER taskList/taskItem so it has higher priority and intercepts
    // indented task lists before the GFM task-list rules fire.
    turndown.addRule('indentedList', {
        filter(node) {
            if (node.nodeName !== 'UL' && node.nodeName !== 'OL') return false;
            return parseIndentAttr(node as HTMLElement) > 0;
        },
        replacement(_content, node) {
            // Emit the DOM element's current HTML (after pre-processing such as
            // unwrapSingleParagraphListItems has already run) as a raw HTML block.
            return `\n\n${(node as Element).outerHTML}\n\n`;
        },
    });

    addTableRules(turndown);

    // Mermaid fenced code block: <pre><code class="language-mermaid">…</code></pre> → ```mermaid\n…\n```
    // Registered last so it wins over turndown's built-in fenced-code rule for mermaid blocks.
    turndown.addRule('mermaidCode', {
        filter(node) {
            if (node.nodeName !== 'PRE') return false;
            // Truthiness for the same reason as `rawTable` above: under domino a miss is
            // `undefined`, so `!== null` matched every <pre> and rewrote plain code blocks
            // into empty ```mermaid fences.
            return Boolean((node as Element).querySelector('code.language-mermaid'));
        },
        replacement(_content, node) {
            const el = node as HTMLElement;
            const code = el.querySelector('code.language-mermaid');
            const text = code?.textContent ?? '';
            const indent = parseIndentAttr(el);
            if (indent > 0) {
                // Indent has no fenced-code syntax, so emit a raw <pre> HTML block
                // carrying `data-indent`; marked passes it through and MermaidBlock
                // re-parses the `code.language-mermaid` and the indent level.
                return `\n\n<pre data-indent="${indent}"><code class="language-mermaid">${escapeHtmlText(text)}</code></pre>\n\n`;
            }
            return `\`\`\`mermaid\n${text}\n\`\`\``;
        },
    });
}

// Registered after host rules, so these are checked first.
function addLateRules(turndown: TurndownService): void {
    // Aligned or indented paragraphs/headings: no standard markdown syntax exists, so
    // these are serialized as raw HTML blocks that `marked` will pass through unchanged.
    // Handles paragraphs and headings (H1–H3) that carry a non-default text-align style
    // or a data-indent attribute.
    function hasAlignOrIndent(el: HTMLElement): boolean {
        const style = el.getAttribute('style') ?? '';
        const indent = el.getAttribute('data-indent');
        const hasNonDefaultAlign =
            /text-align/i.test(style) && !/text-align:\s*left\b/i.test(style);
        const hasIndent = indent != null && indent !== '0' && indent !== '';
        return hasNonDefaultAlign || hasIndent;
    }

    turndown.addRule('alignedOrIndentedBlock', {
        filter(node) {
            const tag = node.nodeName;
            if (!['P', 'H1', 'H2', 'H3'].includes(tag)) return false;
            return hasAlignOrIndent(node as HTMLElement);
        },
        replacement(_content, node) {
            const el = node as HTMLElement;
            const tag = el.tagName.toLowerCase();
            const attrs: string[] = [];
            const style = el.getAttribute('style');
            if (style) attrs.push(`style="${style}"`);
            const indent = el.getAttribute('data-indent');
            if (indent && indent !== '0') attrs.push(`data-indent="${indent}"`);
            const attrStr = attrs.length > 0 ? ' ' + attrs.join(' ') : '';
            // Use innerHTML so inline formatting (bold, italic, etc.) is preserved
            const inner = el.innerHTML;
            return `\n\n<${tag}${attrStr}>${inner}</${tag}>\n\n`;
        },
    });

    // Empty paragraphs (from pressing Enter multiple times) → `&nbsp;` placeholder line.
    // Required because turndown drops `<p></p>` and CommonMark collapses blank lines, so
    // without a placeholder consecutive empty paragraphs vanish in the markdown round-trip.
    // Matches `<p></p>` (after preprocessEmptyParagraphs upgrades it to `<p><br></p>`),
    // `<p><br></p>`, and `<p>&nbsp;</p>` so re-saving an unchanged note is idempotent.
    turndown.addRule('emptyParagraph', {
        filter(node) {
            if (node.nodeName !== 'P') return false;
            const text = (node.textContent ?? '').replace(/ /g, '').trim();
            if (text !== '') return false;
            for (const child of Array.from(node.childNodes)) {
                if (child.nodeType === 1 && (child as Element).nodeName !== 'BR') return false;
            }
            return true;
        },
        replacement() {
            // Emit raw-HTML passthrough rather than `&nbsp;` text — marked's inline
            // tokenizer (with our file-path/note-link/highlight extensions registered)
            // escapes the `&` in `&nbsp;` to `&amp;` on reload, breaking the round-trip.
            // `<p>&nbsp;</p>` as a raw HTML block sidesteps inline tokenization entirely.
            return '\n\n<p>&nbsp;</p>\n\n';
        },
    });
}

// ── Pre-processing helpers ──────────────────────────────────────────────────

/**
 * Unwrap single-<p> list items so turndown produces tight lists.
 *
 * Tiptap always wraps list item content in <p> tags, even for tight lists.
 * Turndown interprets <li><p>...</p></li> as a loose list, adding blank lines.
 * This strips the <p> wrapper when it's the sole child of <li>.
 */
function unwrapSingleParagraphListItems(html: string): string {
    return html.replace(
        /<li>\s*<p>((?:(?!<\/p>)[\s\S])*)<\/p>\s*<\/li>/gi,
        (_match, inner: string) => `<li>${inner}</li>`,
    );
}

// Normalize visually-empty paragraphs to `<p><br></p>` so turndown's blank-node
// check doesn't drop them before the emptyParagraph rule runs. JS `\s` includes
// the NBSP character, so a `<p>&nbsp;</p>` (round-tripped placeholder) is also
// treated as blank by turndown — handle both shapes here.
function preprocessEmptyParagraphs(html: string): string {
    return html.replace(/<p>\s*<\/p>|<p>(?:&nbsp;|&#160;|&#xA0;)\s*<\/p>/gi, '<p><br></p>');
}

// Convert `<p>&nbsp;</p>` (and literal NBSP form) back to `<p></p>` after marked,
// so Tiptap loads a clean empty paragraph instead of one with a stray NBSP character
// that the user would have to delete before typing.
function stripNbspParagraphPlaceholders(html: string): string {
    return html.replace(/<p>(?:&nbsp;| )\s*<\/p>/gi, '<p></p>');
}

// marked always appends a single `\n` to fenced-code content (`<pre><code>x\n</code></pre>`).
// Tiptap's CodeBlock parses `<pre>` with `preserveWhitespace: 'full'`, so that trailing
// newline renders as a phantom empty last line inside every code block. Strip exactly one
// trailing newline before the closing tags; interior line breaks are left untouched.
// Round-trips cleanly — turndown re-fences without the newline and marked re-adds (then
// this re-strips) the single artifact one, so re-saves stay idempotent.
function stripCodeBlockTrailingNewline(html: string): string {
    return html.replace(
        /(<pre(?:\s[^>]*)?><code(?:\s[^>]*)?>[\s\S]*?)\n(<\/code><\/pre>)/g,
        '$1$2',
    );
}

// Tiptap's `Table.renderHTML` writes colgroup widths as an inline *style*
// (`<col style="width: 180px">`), but its `parseColwidth` colgroup fallback reads
// only the `width` *attribute* off `<col>` — so a style-only colgroup silently
// loses every width on reload. Rewrite style → attribute on load so colgroup-only
// HTML (pasted, hand-written, or from an older save) still parses into `colwidth`.
// A `<col>` whose style carries no px width (Tiptap's `min-width` placeholder for
// an unsized column) just loses the dead style.
function normalizeColgroupWidths(html: string): string {
    return html.replace(/<col\b([^>]*?)\/?>/gi, (match, attrs: string) => {
        const style = getHtmlAttr(attrs, 'style');
        if (!style) return match;
        const rest = attrs.replace(/\s*\bstyle\s*=\s*(["'])[\s\S]*?\1/i, '');
        // An explicit width attribute already wins over the style; keep it as-is.
        if (getHtmlAttr(rest, 'width')) return `<col${rest}>`;
        const styleWidth = /(?:^|;)\s*width\s*:\s*(\d+(?:\.\d+)?)\s*px/i.exec(style)?.[1];
        if (!styleWidth) return `<col${rest}>`;
        return `<col${rest} width="${Math.round(parseFloat(styleWidth))}">`;
    });
}

// `marked` passes inline HTML through verbatim, so a `<span>`/`<mark>` in the
// source arrives at Tiptap with whatever `style` was written. Only the
// declarations each tag persists are honored — `color`, `font-family` and
// `font-size` on `<span>`, `background-color` on `<mark>` — and only in a form
// `normalizeCssColor` / `normalizeFontStack` / `normalizeFontSize` recognizes.
// A `font-size` in any unit other than `px`, or outside the persisted range, is
// dropped like any other unrecognized value. Everything else is
// dropped, so a hand-written or pasted `style` cannot turn the note format into
// a general HTML-styling escape hatch. A tag left with no honored declaration
// loses its `style` attribute entirely; for a `<span>` that also means turndown
// unwraps it on the next save.
//
// The declaration order here matches the `textStyleSpan` turndown rule, so a
// note that is loaded and re-saved without an edit serializes unchanged.
function sanitizeInlineStyles(html: string): string {
    return html.replace(/<(span|mark)\b([^>]*?)(\/?)>/gi, (match, tag: string, attrs: string, selfClose: string) => {
        if (!/\bstyle\s*=/i.test(attrs)) return match;
        const raw = getHtmlAttr(attrs, 'style');
        const isSpan = tag.toLowerCase() === 'span';
        const declarations: string[] = [];
        const color = normalizeCssColor(readStyleProp(raw, isSpan ? 'color' : 'background-color'));
        if (color) declarations.push(`${isSpan ? 'color' : 'background-color'}:${color}`);
        if (isSpan) {
            const fontFamily = readInlineFontFamily(raw);
            if (fontFamily) declarations.push(`font-family:${fontFamily}`);
            const fontSize = readInlineFontSize(raw);
            if (fontSize) declarations.push(`font-size:${fontSize}`);
        }
        const rest = attrs.replace(/\s*\bstyle\s*=\s*(["'])[\s\S]*?\1/i, '');
        const style = declarations.length > 0 ? ` style="${declarations.join('; ')}"` : '';
        return `<${tag}${rest}${style}${selfClose}>`;
    });
}

/**
 * Post-process HTML from `marked` to convert standard GFM task-list markup
 * into Tiptap-compatible data attributes.
 *
 * marked renders:
 *   `<ul>\n<li><input type="checkbox" checked="" disabled=""> done</li>\n</ul>`
 *
 * We convert to:
 *   `<ul data-type="taskList"><li data-type="taskItem" data-checked="true"><label>...</label></li></ul>`
 */
function postProcessTaskLists(html: string): string {
    // Detect <li> containing <input type="checkbox"> — these are task items
    const taskItemRe =
        /<li>\s*<input\s+[^>]*type="checkbox"[^>]*>([\s\S]*?)<\/li>/gi;

    let result = html;
    let hasTaskItems = false;

    result = result.replace(taskItemRe, (_match, content: string) => {
        hasTaskItems = true;
        // Determine checked state from the original input
        const isChecked = /checked/i.test(_match);
        return `<li data-type="taskItem" data-checked="${isChecked}">${content.trim()}</li>`;
    });

    if (hasTaskItems) {
        // Wrap parent <ul> of task items with data-type="taskList".
        // Use a lookahead so we only tag <ul> whose immediate first child is a
        // taskItem — this avoids cross-boundary matches that would incorrectly
        // tag a preceding regular bullet list when both lists appear in the
        // same HTML fragment.
        result = result.replace(
            /<ul>\s*(?=<li data-type="taskItem")/gi,
            '<ul data-type="taskList">',
        );
    }

    return result;
}

// ── Codec ───────────────────────────────────────────────────────────────────

export function createMarkdownCodec({ extensions = [] }: MarkdownCodecOptions = {}): MarkdownCodec {
    const marked = new Marked(
        { gfm: true, breaks: true },
        highlightExtension,
        ...extensions.flatMap((ext) => ext.marked ?? []),
    );

    const turndown = new TurndownService({
        headingStyle: 'atx',
        codeBlockStyle: 'fenced',
        bulletListMarker: '-',
    });
    addCoreRules(turndown);
    for (const ext of extensions) ext.turndownRules?.(turndown);
    addLateRules(turndown);

    const parse = extensions.reduceRight<(md: string) => string>(
        (next, ext) => (ext.parse ? (md) => ext.parse!(md, next) : next),
        (md) => marked.parse(md, { async: false }) as string,
    );
    const serialize = extensions.reduceRight<(html: string) => string>(
        (next, ext) => (ext.serialize ? (html) => ext.serialize!(html, next) : next),
        (html) =>
            turndown
                .turndown(preprocessEmptyParagraphs(unwrapSingleParagraphListItems(html)))
                .replace(/\n*$/, '\n'),
    );

    return {
        markdownToHtml(markdown) {
            if (!markdown) return '';
            return sanitizeInlineStyles(
                normalizeColgroupWidths(
                    stripCodeBlockTrailingNewline(stripNbspParagraphPlaceholders(postProcessTaskLists(parse(markdown)))),
                ),
            );
        },
        htmlToMarkdown(html) {
            if (!html) return '';
            // Tiptap returns `<p></p>` for an empty document
            if (/^<p>\s*<\/p>$/i.test(html.trim())) return '';
            return serialize(html);
        },
    };
}
