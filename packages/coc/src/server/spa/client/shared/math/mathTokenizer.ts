/**
 * Shared math delimiter tokenizer.
 *
 * Splits a plain-text string into ordered text / math segments, recognizing the
 * four common TeX delimiter forms:
 *
 *   - Inline:  `$...$`   and  `\(...\)`
 *   - Display: `$$...$$` and  `\[...\]`  (display may span multiple lines)
 *
 * This module is intentionally framework-agnostic and side-effect free: it does
 * no rendering and pulls in no KaTeX. Each rendering seam (Marked adapter, Forge
 * line-renderer adapter, Tiptap conversion) tokenizes first, then renders the
 * math segments through `renderMath`.
 *
 * IMPORTANT: the caller is responsible for excluding literal/source regions —
 * inline code, fenced code, Mermaid blocks, source-mode views — before handing
 * text to this tokenizer. The tokenizer sees only prose-level text.
 *
 * The `$...$` inline form applies conservative guards so ordinary currency,
 * shell variables, and template placeholders never become false-positive math:
 *
 *   - An opening `$` must not be immediately followed by whitespace or a digit.
 *   - A closing `$` must not be immediately preceded by whitespace, and must not
 *     be immediately followed by a digit (guards `$5 and $6`).
 *   - Inline `$...$` and `\(...\)` may not span a blank line / paragraph break.
 *   - `\$` is an escaped literal dollar and never opens or closes math.
 *   - An unclosed opener stays literal text, so streaming content remains
 *     readable until its closing delimiter arrives.
 */

export type MathDelimiter = 'dollar' | 'double-dollar' | 'paren' | 'bracket';

export interface MathSegment {
    type: 'math';
    /** Raw TeX source between the delimiters, verbatim (never trimmed for storage). */
    tex: string;
    /** True for display math (`$$...$$`, `\[...\]`), false for inline. */
    display: boolean;
    /** Which delimiter form produced this segment. */
    delimiter: MathDelimiter;
    /** The full matched source including delimiters (for round-trip / source preservation). */
    raw: string;
}

export interface TextSegment {
    type: 'text';
    value: string;
}

export type MarkdownMathSegment = TextSegment | MathSegment;

function isWhitespace(ch: string | undefined): boolean {
    return ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r' || ch === '\f' || ch === '\v';
}

function isDigit(ch: string | undefined): boolean {
    return ch !== undefined && ch >= '0' && ch <= '9';
}

/**
 * Count consecutive backslashes ending at (exclusive) index `i`. Used to decide
 * whether the delimiter char at `i` is escaped. An even count (including zero)
 * means the char is NOT escaped; an odd count means it is.
 */
function precedingBackslashesEscape(text: string, i: number): boolean {
    let count = 0;
    let j = i - 1;
    while (j >= 0 && text[j] === '\\') {
        count++;
        j--;
    }
    return count % 2 === 1;
}

/** Does the substring starting at `from` contain a blank-line / paragraph break before `to`? */
function hasParagraphBreak(text: string, from: number, to: number): boolean {
    const slice = text.slice(from, to);
    return /\n[ \t]*\n/.test(slice);
}

interface Match {
    tex: string;
    raw: string;
    delimiter: MathDelimiter;
    display: boolean;
    /** Index in the source just past the matched region. */
    end: number;
}

/** Try to match a `$$...$$` display region starting at `i` (text[i]==='$', text[i+1]==='$'). */
function matchDoubleDollar(text: string, i: number): Match | null {
    // Scan for an unescaped closing `$$`.
    let j = i + 2;
    while (j < text.length) {
        if (text[j] === '$' && text[j + 1] === '$' && !precedingBackslashesEscape(text, j)) {
            const tex = text.slice(i + 2, j);
            if (tex.trim().length === 0) return null;
            return {
                tex,
                raw: text.slice(i, j + 2),
                delimiter: 'double-dollar',
                display: true,
                end: j + 2,
            };
        }
        j++;
    }
    return null;
}

/** Try to match a `$...$` inline region starting at `i` (text[i]==='$'). */
function matchDollar(text: string, i: number): Match | null {
    const after = text[i + 1];
    // Opening guard: not followed by whitespace or a digit, and something follows.
    if (after === undefined || isWhitespace(after) || isDigit(after)) return null;

    let j = i + 1;
    while (j < text.length) {
        const ch = text[j];
        if (ch === '\n') {
            // Allow a single newline inside inline math but not a paragraph break.
            if (hasParagraphBreak(text, i, j + 1)) return null;
        }
        if (ch === '$' && !precedingBackslashesEscape(text, j)) {
            const prev = text[j - 1];
            const next = text[j + 1];
            // Closing guard: no whitespace immediately before, no digit immediately after.
            if (isWhitespace(prev) || isDigit(next)) {
                // Not a valid close here; keep scanning for a later `$`.
                j++;
                continue;
            }
            const tex = text.slice(i + 1, j);
            if (tex.length === 0) return null;
            return {
                tex,
                raw: text.slice(i, j + 1),
                delimiter: 'dollar',
                display: false,
                end: j + 1,
            };
        }
        j++;
    }
    return null;
}

/** Try to match `\(...\)` (inline) or `\[...\]` (display) starting at a backslash at `i`. */
function matchBackslashDelim(text: string, i: number): Match | null {
    const open = text[i + 1];
    if (open !== '(' && open !== '[') return null;
    const display = open === '[';
    const closeChar = display ? ']' : ')';

    let j = i + 2;
    while (j < text.length) {
        if (text[j] === '\\' && text[j + 1] === closeChar) {
            const tex = text.slice(i + 2, j);
            if (tex.trim().length === 0) return null;
            // Inline `\(...\)` must not span a paragraph break.
            if (!display && hasParagraphBreak(text, i, j)) return null;
            return {
                tex,
                raw: text.slice(i, j + 2),
                delimiter: display ? 'bracket' : 'paren',
                display,
                end: j + 2,
            };
        }
        // Skip an escaped backslash so `\\` inside TeX doesn't confuse the close scan.
        if (text[j] === '\\' && text[j + 1] === '\\') {
            j += 2;
            continue;
        }
        j++;
    }
    return null;
}

/**
 * Tokenize a prose string into ordered text and math segments.
 *
 * The scan is single-pass and left-to-right; the earliest valid delimiter wins,
 * so nested/ambiguous cases resolve deterministically.
 */
export function tokenizeMath(text: string): MarkdownMathSegment[] {
    const segments: MarkdownMathSegment[] = [];
    let textStart = 0;
    let i = 0;

    const flushText = (end: number) => {
        if (end > textStart) {
            segments.push({ type: 'text', value: text.slice(textStart, end) });
        }
    };

    while (i < text.length) {
        const ch = text[i];

        if (ch === '\\') {
            // `\$` — escaped literal dollar; leave the pair in the text stream so
            // the downstream Markdown renderer handles the escape.
            if (text[i + 1] === '$') {
                i += 2;
                continue;
            }
            const m = matchBackslashDelim(text, i);
            if (m) {
                flushText(i);
                segments.push({ type: 'math', tex: m.tex, display: m.display, delimiter: m.delimiter, raw: m.raw });
                i = m.end;
                textStart = i;
                continue;
            }
            // Some other escape (e.g. `\,`); consume the pair as text.
            i += 2;
            continue;
        }

        if (ch === '$') {
            // Escaped `$` handled above via `\$`; here `$` is unescaped.
            if (text[i + 1] === '$') {
                const m = matchDoubleDollar(text, i);
                if (m) {
                    flushText(i);
                    segments.push({ type: 'math', tex: m.tex, display: m.display, delimiter: m.delimiter, raw: m.raw });
                    i = m.end;
                    textStart = i;
                    continue;
                }
                // Unclosed `$$` — literal; skip both to avoid re-matching as `$`.
                i += 2;
                continue;
            }
            const m = matchDollar(text, i);
            if (m) {
                flushText(i);
                segments.push({ type: 'math', tex: m.tex, display: m.display, delimiter: m.delimiter, raw: m.raw });
                i = m.end;
                textStart = i;
                continue;
            }
            i += 1;
            continue;
        }

        i += 1;
    }

    flushText(text.length);
    return segments;
}

/** Convenience predicate: does the text contain at least one math segment? */
export function hasMath(text: string): boolean {
    return tokenizeMath(text).some(s => s.type === 'math');
}

export interface MathMatch {
    tex: string;
    raw: string;
    delimiter: MathDelimiter;
    display: boolean;
    /** Length of the matched region (== the number of chars consumed from index 0). */
    length: number;
}

/**
 * Try to match a single math token anchored at the START of `text` (index 0).
 *
 * Returns null when the text does not begin with a valid, closed math region.
 * This is the primitive the Marked adapter uses: Marked hands it a source slice
 * beginning at a candidate delimiter, and this decides whether — and how far —
 * a math token extends. It reuses the exact same delimiter rules and guards as
 * `tokenizeMath`, so currency/shell/template/escaped cases are rejected here too.
 */
export function matchMathAtStart(text: string): MathMatch | null {
    const ch = text[0];
    if (ch === '\\') {
        // `\$` is an escaped literal dollar, never a delimiter.
        if (text[1] === '$') return null;
        const m = matchBackslashDelim(text, 0);
        return m ? { tex: m.tex, raw: m.raw, delimiter: m.delimiter, display: m.display, length: m.end } : null;
    }
    if (ch === '$') {
        if (text[1] === '$') {
            const m = matchDoubleDollar(text, 0);
            return m ? { tex: m.tex, raw: m.raw, delimiter: m.delimiter, display: m.display, length: m.end } : null;
        }
        const m = matchDollar(text, 0);
        return m ? { tex: m.tex, raw: m.raw, delimiter: m.delimiter, display: m.display, length: m.end } : null;
    }
    return null;
}
