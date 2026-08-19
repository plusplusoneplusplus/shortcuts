/**
 * Bit-flag definition parser — turns a pasted C/C++ snippet into named values.
 *
 * The point is that you can paste whatever the header actually says and get a
 * usable table back, so this accepts the six conventions real headers use:
 * `1 << n` shifts, plain literals, bare `#define` lines, composite aliases
 * (`ALL = A | B`), `*_MASK` / `*_SHIFT` sub-field pairs, and symbolic
 * references to names defined earlier in the same paste.
 *
 * Nothing here throws and nothing fails the whole paste: a line the parser does
 * not understand is recorded in `skipped` and the rest still parses, so the card
 * can say "9 of 11 lines parsed" instead of going blank.
 *
 * Arithmetic runs through `calculator.evaluate()` at 64 bits unsigned rather
 * than a second bespoke expression parser. `evaluate` speaks JavaScript-ish
 * literals, so `normalizeExpression` first rewrites the C spellings it does not
 * know — `'` digit separators, `U`/`L`/`UL`/`ULL` suffixes, `0777` octal — and
 * substitutes already-defined names with their hex value.
 *
 * React-free and dependency-free so it can be unit-tested directly.
 */

import { type CalcWidth, evaluate, maskFor, toHexLiteral, truncate } from './calculator';

/**
 * What a parsed name turned out to be.
 *
 * - `flag`  — exactly one bit set; the only kind reported as "bit N is set".
 * - `alias` — a composite or otherwise non-single-bit value (`ALL = A | B`).
 * - `mask`  — a `*_MASK` name holding a contiguous run of >1 bits: a sub-field.
 * - `shift` — the `*_SHIFT` partner of a mask; a shift distance, not a value.
 * - `zero`  — a `NONE = 0` style entry, which can never be "set".
 */
export type FlagKind = 'flag' | 'alias' | 'mask' | 'shift' | 'zero';

export interface FlagEntry {
    name: string;
    value: bigint;
    kind: FlagKind;
    /** Bit index for `kind: 'flag'`, otherwise `null`. */
    bit: number | null;
    /**
     * For `kind: 'mask'`: how far to shift the masked bits down to read the
     * field — the paired `*_SHIFT` value when one exists, else the mask's own
     * trailing-zero count. `null` for every other kind.
     */
    shift: number | null;
}

export interface SkippedLine {
    /** 1-based line number in the pasted source. */
    line: number;
    /**
     * What was skipped — the definition itself when a single enumerator on a
     * shared line failed, otherwise the whole line as pasted.
     */
    text: string;
    reason: string;
}

export interface ParsedFlagSet {
    /** The enum's own name when the paste had one — used as the default set name. */
    name: string | null;
    entries: FlagEntry[];
    /** Non-fatal notes: duplicate names, sequential-enum suspicion. */
    warnings: string[];
    skipped: SkippedLine[];
    /** Lines that produced at least one definition. */
    parsedLines: number;
    /** `parsedLines + skipped.length` — the lines that looked like definitions. */
    totalLines: number;
    /** True when the values look like a plain sequential enum, not bit flags. */
    sequential: boolean;
}

/** Everything is evaluated at the widest width; the card truncates for display. */
const PARSE_WIDTH = 64;

/** Structural scaffolding that is neither a definition nor an error. */
const STRUCTURAL = /^[\s{}();,]*$|^\s*#|^\s*(?:enum|namespace|typedef|struct|class|using|extern|inline|constexpr|static|const)\b/;

const ENUM_BLOCK = /\benum\b\s*(?:class|struct)?\s*([A-Za-z_]\w*)?\s*(?::\s*[^{;]+?)?\s*\{([^}]*)\}/g;
const DEFINE_LINE = /^\s*#\s*define\s+([A-Za-z_]\w*)\s+(\S.*?)\s*$/;
const ENUMERATOR = /^\s*([A-Za-z_]\w*)\s*(?:=\s*([\s\S]+?))?\s*$/;
const IDENTIFIER = /\b[A-Za-z_]\w*/g;

/** A name/expression pair found in the source, before its value is known. */
interface RawDefinition {
    name: string;
    /** `null` for an implicit auto-increment enumerator. */
    expr: string | null;
    /** Offset of the name in the comment-stripped source; drives ordering. */
    offset: number;
    /** Which enum block the auto-increment counter belongs to; `null` for `#define`. */
    enumId: number | null;
}

/**
 * Blank out comments while keeping every offset and newline, so line numbers
 * reported back to the user still line up with what they pasted.
 */
function stripComments(source: string): string {
    let out = '';
    let i = 0;
    while (i < source.length) {
        const two = source.slice(i, i + 2);
        if (two === '//') {
            while (i < source.length && source[i] !== '\n') {
                out += ' ';
                i++;
            }
            continue;
        }
        if (two === '/*') {
            const end = source.indexOf('*/', i + 2);
            const stop = end === -1 ? source.length : end + 2;
            for (; i < stop; i++) out += source[i] === '\n' ? '\n' : ' ';
            continue;
        }
        out += source[i];
        i++;
    }
    return out;
}

/** 0-based line index for a character offset. */
function lineIndexOf(source: string, offset: number): number {
    let line = 0;
    for (let i = 0; i < offset && i < source.length; i++) {
        if (source[i] === '\n') line++;
    }
    return line;
}

/** Split an enum body on commas that are not inside parentheses. */
function splitEnumerators(body: string, base: number): { text: string; offset: number }[] {
    const parts: { text: string; offset: number }[] = [];
    let depth = 0;
    let start = 0;
    const push = (end: number) => {
        const text = body.slice(start, end);
        if (text.trim().length > 0) {
            parts.push({ text, offset: base + start + (text.length - text.trimStart().length) });
        }
    };
    for (let i = 0; i < body.length; i++) {
        const ch = body[i];
        if (ch === '(') depth++;
        else if (ch === ')') depth--;
        else if (ch === ',' && depth === 0) {
            push(i);
            start = i + 1;
        }
    }
    push(body.length);
    return parts;
}

/**
 * Rewrite C integer spellings `evaluate()` does not know, then substitute the
 * names defined so far. Returns an error instead when a name is still unknown —
 * guessing would silently produce a wrong value.
 */
function normalizeExpression(expr: string, known: Map<string, bigint>): { ok: true; text: string } | { ok: false; error: string } {
    let text = expr
        // `1'000'000` — C++14 digit separators.
        .replace(/(\w)'(?=\w)/g, '$1')
        // `0x1FULL`, `64u`, `3L` — integer suffixes.
        .replace(/\b(0[xX][0-9a-fA-F]+|0[bB][01]+|[0-9]+)[uUlL]{1,3}\b/g, '$1')
        // `0777` — C octal, which `evaluate` spells `0o777`.
        .replace(/\b0([0-7]+)\b/g, '0o$1');

    const unresolved: string[] = [];
    text = text.replace(IDENTIFIER, name => {
        const value = known.get(name);
        if (value === undefined) {
            unresolved.push(name);
            return name;
        }
        return `0x${value.toString(16)}`;
    });
    if (unresolved.length > 0) return { ok: false, error: `unknown name "${unresolved[0]}"` };
    return { ok: true, text };
}

/** Number of trailing zero bits; 0 for a zero value. */
function trailingZeros(value: bigint): number {
    if (value === 0n) return 0;
    let count = 0;
    let v = value;
    while ((v & 1n) === 0n) {
        v >>= 1n;
        count++;
    }
    return count;
}

function isSingleBit(value: bigint): boolean {
    return value > 0n && (value & (value - 1n)) === 0n;
}

/** True when the set bits form one uninterrupted run, e.g. `0x70`. */
function isContiguous(value: bigint): boolean {
    if (value <= 0n) return false;
    const shifted = value >> BigInt(trailingZeros(value));
    return (shifted & (shifted + 1n)) === 0n;
}

/** Bit index of a single-bit value. */
export function bitIndexOf(value: bigint): number {
    return trailingZeros(value);
}

function classify(name: string, value: bigint, values: Map<string, bigint>): Pick<FlagEntry, 'kind' | 'bit' | 'shift'> {
    if (value === 0n) return { kind: 'zero', bit: null, shift: null };
    const shiftPartner = /_SHIFT$/.test(name) ? values.get(name.replace(/_SHIFT$/, '_MASK')) : undefined;
    if (shiftPartner !== undefined) return { kind: 'shift', bit: null, shift: null };
    if (isSingleBit(value)) return { kind: 'flag', bit: bitIndexOf(value), shift: null };
    if (/_MASK$/.test(name) && isContiguous(value)) {
        const paired = values.get(name.replace(/_MASK$/, '_SHIFT'));
        return { kind: 'mask', bit: null, shift: paired === undefined ? trailingZeros(value) : Number(paired) };
    }
    return { kind: 'alias', bit: null, shift: null };
}

/** Values 0,1,2,… or 1,2,3,… — an ordinary enum somebody pasted by mistake. */
function looksSequential(values: bigint[]): boolean {
    if (values.length < 3) return false;
    const sorted = [...new Set(values)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    if (sorted.length !== values.length) return false;
    if (sorted[0] !== 0n && sorted[0] !== 1n) return false;
    return sorted.every((v, i) => v === sorted[0]! + BigInt(i));
}

/** Collect every `name = expr` candidate, in source order. */
function collectDefinitions(cleaned: string): { defs: RawDefinition[]; enumName: string | null } {
    const defs: RawDefinition[] = [];
    let enumName: string | null = null;
    const insideEnum: { start: number; end: number }[] = [];

    ENUM_BLOCK.lastIndex = 0;
    let block: RegExpExecArray | null;
    let enumId = 0;
    while ((block = ENUM_BLOCK.exec(cleaned)) !== null) {
        const [, name, body] = block;
        if (name && !enumName) enumName = name;
        const bodyStart = block.index + block[0].indexOf('{') + 1;
        insideEnum.push({ start: block.index, end: block.index + block[0].length });
        for (const part of splitEnumerators(body ?? '', bodyStart)) {
            const m = ENUMERATOR.exec(part.text);
            if (!m) continue;
            defs.push({ name: m[1]!, expr: m[2] ?? null, offset: part.offset, enumId });
        }
        enumId++;
    }

    // `#define` is line-oriented and never appears inside an enum body.
    let offset = 0;
    for (const line of cleaned.split('\n')) {
        const m = DEFINE_LINE.exec(line);
        if (m && !insideEnum.some(r => offset >= r.start && offset < r.end)) {
            defs.push({ name: m[1]!, expr: m[2]!, offset: offset + line.indexOf(m[1]!), enumId: null });
        }
        offset += line.length + 1;
    }

    defs.sort((a, b) => a.offset - b.offset);
    return { defs, enumName };
}

/**
 * Parse a pasted C/C++ snippet into named flag values.
 *
 * Never throws: unparsable lines land in `skipped` and everything else still
 * comes back.
 */
export function parseFlagDefinitions(source: string): ParsedFlagSet {
    const cleaned = stripComments(source);
    const originalLines = source.split('\n');
    const { defs, enumName } = collectDefinitions(cleaned);

    const values = new Map<string, bigint>();
    const order: string[] = [];
    const warnings: string[] = [];
    // Per definition, not per line: `enum { A = 1, B = NOPE };` is one good
    // enumerator and one bad one, and the card should say so.
    const failures: SkippedLine[] = [];
    const parsedLineSet = new Set<number>();
    const autoCounters = new Map<number, bigint>();
    let usedAuto = false;

    for (const def of defs) {
        const line = lineIndexOf(cleaned, def.offset);
        let value: bigint;

        if (def.expr === null) {
            if (def.enumId === null) continue; // `#define NAME` with no value: not a flag.
            value = autoCounters.get(def.enumId) ?? 0n;
            usedAuto = true;
        } else {
            const fail = (reason: string) => {
                failures.push({ line: line + 1, text: `${def.name} = ${def.expr!.trim()}`, reason });
            };
            const normalized = normalizeExpression(def.expr, values);
            if (!normalized.ok) {
                fail(normalized.error);
                continue;
            }
            const result = evaluate(normalized.text, { width: PARSE_WIDTH, signed: false });
            if (!result.ok) {
                fail(result.error);
                continue;
            }
            if (result.kind !== 'int') {
                fail('value is not an integer');
                continue;
            }
            value = result.value;
        }

        if (def.enumId !== null) autoCounters.set(def.enumId, value + 1n);
        if (values.has(def.name)) {
            warnings.push(`"${def.name}" is defined more than once — keeping the last definition`);
            order.splice(order.indexOf(def.name), 1);
        }
        values.set(def.name, value);
        order.push(def.name);
        parsedLineSet.add(line);
    }

    const entries: FlagEntry[] = order.map(name => {
        const value = values.get(name)!;
        return { name, value, ...classify(name, value, values) };
    });

    // Whatever is left over: a line that held no definition at all and is not
    // scaffolding either. Anything already reported as a failed definition is
    // not reported a second time.
    const failureLines = new Set(failures.map(f => f.line));
    const cleanedLines = cleaned.split('\n');
    const skipped: SkippedLine[] = [...failures];
    for (let i = 0; i < originalLines.length; i++) {
        if (parsedLineSet.has(i) || failureLines.has(i + 1)) continue;
        const text = (cleanedLines[i] ?? '').trim();
        if (text.length === 0 || STRUCTURAL.test(text)) continue;
        skipped.push({ line: i + 1, text: originalLines[i]!, reason: 'not a flag definition' });
    }
    skipped.sort((a, b) => a.line - b.line);

    const sequential = entries.length > 0 && (usedAuto || looksSequential(entries.map(e => e.value)));
    if (sequential) {
        warnings.push('this looks like a sequential enum, not a bit flag enum');
    }

    return {
        name: enumName,
        entries,
        warnings,
        skipped,
        parsedLines: parsedLineSet.size,
        totalLines: parsedLineSet.size + skipped.length,
        sequential,
    };
}

// ---------------------------------------------------------------------------
// Decode / encode
// ---------------------------------------------------------------------------

/** A single-bit flag whose bit is set in the decoded value. */
export interface DecodedFlag {
    name: string;
    value: bigint;
    bit: number;
}

/** A composite whose bits are *all* present — a partial match is not a match. */
export interface DecodedAlias {
    name: string;
    value: bigint;
}

/** A `*_MASK` sub-field, read out as a small number rather than as flags. */
export interface DecodedField {
    name: string;
    /** The mask itself, e.g. `0x30`. */
    mask: bigint;
    /** The masked bits shifted down, e.g. `0x30` in `0x20` reads as `2`. */
    value: bigint;
    shift: number;
}

export interface DecodeResult {
    /** The input truncated to the selected width. */
    value: bigint;
    flags: DecodedFlag[];
    aliases: DecodedAlias[];
    fields: DecodedField[];
    /** Set bits nothing in the set accounts for. */
    unknown: bigint;
    unknownBits: number[];
    /** One line, e.g. `A | C | unknown 0x80`; `0` when nothing is set. */
    summary: string;
    /** True when the value is 0 — the card shows "no flags set", not an error. */
    empty: boolean;
}

/** Bit indices set in a value, low to high. */
function bitIndices(value: bigint): number[] {
    const bits: number[] = [];
    for (let i = 0; value >> BigInt(i); i++) {
        if ((value >> BigInt(i)) & 1n) bits.push(i);
    }
    return bits;
}

/**
 * Work out which named flags, aliases and sub-fields a number contains.
 *
 * An alias only counts when every one of its bits is present, so a half-matched
 * `ALL = A | B | C` is silently absent rather than misleadingly listed. Bits no
 * name accounts for come back as `unknown` so nothing is quietly dropped.
 */
export function decodeValue(entries: readonly FlagEntry[], input: bigint, width: CalcWidth): DecodeResult {
    const value = truncate(input, width);
    const limit = maskFor(width);

    const flags: DecodedFlag[] = [];
    const aliases: DecodedAlias[] = [];
    const fields: DecodedField[] = [];
    let covered = 0n;

    for (const entry of entries) {
        const entryValue = truncate(entry.value, width);
        if (entryValue === 0n) continue; // `NONE = 0` is never "set".
        switch (entry.kind) {
            case 'flag':
                if ((value & entryValue) === entryValue) {
                    flags.push({ name: entry.name, value: entryValue, bit: bitIndexOf(entryValue) });
                    covered |= entryValue;
                }
                break;
            case 'alias':
                if ((value & entryValue) === entryValue) {
                    aliases.push({ name: entry.name, value: entryValue });
                    covered |= entryValue;
                }
                break;
            case 'mask': {
                // A field's bits are accounted for whether or not it reads as 0,
                // otherwise a zero sub-field would leak into `unknown`.
                covered |= entryValue;
                const masked = value & entryValue;
                if (masked === 0n) break;
                const shift = entry.shift ?? 0;
                fields.push({ name: entry.name, mask: entryValue, value: masked >> BigInt(shift), shift });
                break;
            }
            default:
                break; // 'shift' and 'zero' are never bits of the value.
        }
    }

    const unknown = value & ~covered & limit;
    return {
        value,
        flags,
        aliases,
        fields,
        unknown,
        unknownBits: bitIndices(unknown),
        summary: summarizeDecoded({ value, flags, aliases, fields, unknown }, width),
        empty: value === 0n,
    };
}

/**
 * The one-line form, used both above the table and by the copy button.
 *
 * An alias is only worth a slot when it names bits no matched flag already
 * named — otherwise `A | B | BOTH` says the same thing three times.
 */
function summarizeDecoded(
    parts: Pick<DecodeResult, 'value' | 'flags' | 'aliases' | 'fields' | 'unknown'>,
    width: CalcWidth,
): string {
    const named = parts.flags.reduce((acc, f) => acc | f.value, 0n);
    const pieces: string[] = [];
    for (const flag of parts.flags) pieces.push(flag.name);
    for (const alias of parts.aliases) {
        if ((alias.value & ~named) !== 0n) pieces.push(alias.name);
    }
    for (const field of parts.fields) pieces.push(`${field.name}=${field.value}`);
    if (parts.unknown !== 0n) pieces.push(`unknown ${toHexLiteral(parts.unknown, width)}`);
    return pieces.length > 0 ? pieces.join(' | ') : toHexLiteral(parts.value, width);
}

/** What the card's checkboxes and sub-field inputs currently hold. */
export interface FlagSelection {
    /** Names of ticked `flag` and `alias` entries. */
    selected: readonly string[];
    /** Sub-field values by `*_MASK` name, already shifted down. */
    fields?: Readonly<Record<string, bigint>>;
}

/**
 * The reverse direction: turn ticked names and sub-field numbers back into a
 * number. Unknown names are ignored so a selection kept across a set switch
 * degrades instead of throwing.
 */
export function encodeSelection(entries: readonly FlagEntry[], selection: FlagSelection, width: CalcWidth): bigint {
    const byName = new Map(entries.map(entry => [entry.name, entry]));
    let value = 0n;

    for (const name of selection.selected) {
        const entry = byName.get(name);
        if (!entry || (entry.kind !== 'flag' && entry.kind !== 'alias')) continue;
        value |= entry.value;
    }
    for (const [name, fieldValue] of Object.entries(selection.fields ?? {})) {
        const entry = byName.get(name);
        if (!entry || entry.kind !== 'mask') continue;
        value |= (fieldValue << BigInt(entry.shift ?? 0)) & entry.value;
    }
    return truncate(value, width);
}

/**
 * The selection a number implies — what the checkboxes should show after the
 * user types into the numeric box.
 */
export function selectionFor(entries: readonly FlagEntry[], value: bigint, width: CalcWidth): FlagSelection {
    const decoded = decodeValue(entries, value, width);
    const fields: Record<string, bigint> = {};
    for (const entry of entries) {
        if (entry.kind !== 'mask') continue;
        const masked = truncate(value, width) & truncate(entry.value, width);
        fields[entry.name] = masked >> BigInt(entry.shift ?? 0);
    }
    return {
        selected: [...decoded.flags.map(f => f.name), ...decoded.aliases.map(a => a.name)],
        fields,
    };
}
