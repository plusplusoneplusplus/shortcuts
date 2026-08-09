/**
 * Programmer-calculator logic — a C-style integer expression evaluator.
 *
 * Dependency-free and React-free so it can be unit-tested directly. Everything
 * runs on `bigint` so 64-bit values stay exact, and every intermediate result is
 * truncated to the selected width, which is what makes overflow wrap the way it
 * does in C.
 *
 * Errors are returned as values (`{ ok: false, error }`) — nothing here throws,
 * so a card can keep showing the previous good value next to the message.
 */

export type CalcWidth = 8 | 16 | 32 | 64;

export const CALC_WIDTHS: readonly CalcWidth[] = [8, 16, 32, 64];

export interface CalcOptions {
    width: CalcWidth;
    /** Signed mode changes DEC display, `/`, `%` and whether `>>` is arithmetic. */
    signed: boolean;
}

export type CalcResult = { ok: true; value: bigint } | { ok: false; error: string };

/** All-ones mask for `width` bits. */
export function maskFor(width: CalcWidth): bigint {
    return (1n << BigInt(width)) - 1n;
}

/** Wrap a value into `width` bits, two's-complement style. */
export function truncate(value: bigint, width: CalcWidth): bigint {
    // BigInt bitwise ops work on an infinite two's-complement representation, so
    // masking a negative value already yields the wrapped bit pattern.
    return value & maskFor(width);
}

/** Reinterpret the `width`-bit pattern as a signed two's-complement number. */
export function toSigned(value: bigint, width: CalcWidth): bigint {
    const bits = truncate(value, width);
    const signBit = 1n << BigInt(width - 1);
    return bits >= signBit ? bits - (1n << BigInt(width)) : bits;
}

/** LSB-first array of the `width` bits of `value`. Index 0 is bit 0. */
export function bitsOf(value: bigint, width: CalcWidth): boolean[] {
    const bits = truncate(value, width);
    const out: boolean[] = [];
    for (let i = 0; i < width; i++) out.push(((bits >> BigInt(i)) & 1n) === 1n);
    return out;
}

/** Flip bit `index` (0 = LSB). Out-of-range indexes leave the value alone. */
export function toggleBit(value: bigint, width: CalcWidth, index: number): bigint {
    if (!Number.isInteger(index) || index < 0 || index >= width) return truncate(value, width);
    return truncate(truncate(value, width) ^ (1n << BigInt(index)), width);
}

export type CalcBase = 'dec' | 'hex' | 'oct' | 'bin';

/** Render the current value in one of the four readout bases. */
export function formatValue(value: bigint, width: CalcWidth, signed: boolean, base: CalcBase): string {
    const bits = truncate(value, width);
    if (base === 'dec') return (signed ? toSigned(bits, width) : bits).toString(10);
    if (base === 'hex') return bits.toString(16).toUpperCase();
    if (base === 'oct') return bits.toString(8);
    return bits.toString(2).padStart(width, '0');
}

/** Binary readout split into nibbles, e.g. `1111 0000`. */
export function formatBinaryGrouped(value: bigint, width: CalcWidth): string {
    const raw = formatValue(value, width, false, 'bin');
    return (raw.match(/.{1,4}/g) ?? []).join(' ');
}

/** The literal a bit-grid click writes back into the expression box. */
export function toHexLiteral(value: bigint, width: CalcWidth): string {
    return `0x${truncate(value, width).toString(16).toUpperCase()}`;
}

// ---------------------------------------------------------------------------
// Tokenizer
// ---------------------------------------------------------------------------

type Token =
    | { kind: 'num'; value: bigint; text: string }
    | { kind: 'op'; value: string }
    | { kind: 'lparen' }
    | { kind: 'rparen' };

class CalcError extends Error {}

const DIGITS: Record<string, string> = {
    x: '0123456789abcdef',
    b: '01',
    o: '01234567',
};

function tokenize(input: string): Token[] {
    const tokens: Token[] = [];
    let i = 0;
    while (i < input.length) {
        const ch = input[i]!;
        if (/\s/.test(ch)) {
            i++;
            continue;
        }
        if (ch === '(') {
            tokens.push({ kind: 'lparen' });
            i++;
            continue;
        }
        if (ch === ')') {
            tokens.push({ kind: 'rparen' });
            i++;
            continue;
        }
        if (ch === '<' || ch === '>') {
            if (input[i + 1] !== ch) throw new CalcError(`Unexpected character "${ch}"`);
            tokens.push({ kind: 'op', value: ch + ch });
            i += 2;
            continue;
        }
        if ('+-*/%&|^~'.includes(ch)) {
            tokens.push({ kind: 'op', value: ch });
            i++;
            continue;
        }
        if (/[0-9]/.test(ch)) {
            const prefix = ch === '0' ? (input[i + 1] ?? '').toLowerCase() : '';
            if (prefix === 'x' || prefix === 'b' || prefix === 'o') {
                const allowed = DIGITS[prefix]!;
                let j = i + 2;
                while (j < input.length && allowed.includes(input[j]!.toLowerCase())) j++;
                if (j === i + 2) throw new CalcError(`Malformed literal "${input.slice(i, i + 2)}"`);
                const text = input.slice(i, j);
                const radix = prefix === 'x' ? 16 : prefix === 'b' ? 2 : 8;
                tokens.push({ kind: 'num', value: parseDigits(text.slice(2), radix, text), text });
                i = j;
                continue;
            }
            let j = i;
            while (j < input.length && /[0-9]/.test(input[j]!)) j++;
            const text = input.slice(i, j);
            tokens.push({ kind: 'num', value: BigInt(text), text });
            i = j;
            continue;
        }
        throw new CalcError(`Unexpected character "${ch}"`);
    }
    return tokens;
}

function parseDigits(digits: string, radix: number, original: string): bigint {
    let out = 0n;
    const big = BigInt(radix);
    for (const d of digits.toLowerCase()) {
        const v = parseInt(d, radix);
        if (Number.isNaN(v)) throw new CalcError(`Malformed literal "${original}"`);
        out = out * big + BigInt(v);
    }
    return out;
}

// ---------------------------------------------------------------------------
// Parser — recursive descent, C precedence (weakest binding first)
// ---------------------------------------------------------------------------

class Parser {
    private pos = 0;

    constructor(
        private readonly tokens: Token[],
        private readonly opts: CalcOptions,
    ) {}

    parse(): bigint {
        const value = this.parseOr();
        if (this.pos < this.tokens.length) throw new CalcError(this.describeUnexpected());
        return value;
    }

    private describeUnexpected(): string {
        const t = this.tokens[this.pos];
        if (!t) return 'Unexpected end of expression';
        if (t.kind === 'num') return `Unexpected token "${t.text}"`;
        if (t.kind === 'op') return `Unexpected token "${t.value}"`;
        return `Unexpected token "${t.kind === 'lparen' ? '(' : ')'}"`;
    }

    private peekOp(...ops: string[]): string | null {
        const t = this.tokens[this.pos];
        if (t && t.kind === 'op' && ops.includes(t.value)) return t.value;
        return null;
    }

    private binary(ops: string[], next: () => bigint): bigint {
        let left = next();
        for (;;) {
            const op = this.peekOp(...ops);
            if (!op) return left;
            this.pos++;
            const right = next();
            left = this.apply(op, left, right);
        }
    }

    private parseOr = (): bigint => this.binary(['|'], this.parseXor);
    private parseXor = (): bigint => this.binary(['^'], this.parseAnd);
    private parseAnd = (): bigint => this.binary(['&'], this.parseShift);
    private parseShift = (): bigint => this.binary(['<<', '>>'], this.parseAdditive);
    private parseAdditive = (): bigint => this.binary(['+', '-'], this.parseMultiplicative);
    private parseMultiplicative = (): bigint => this.binary(['*', '/', '%'], this.parseUnary);

    private parseUnary = (): bigint => {
        const op = this.peekOp('-', '+', '~');
        if (op) {
            this.pos++;
            const operand = this.parseUnary();
            if (op === '+') return operand;
            if (op === '-') return this.fit(-operand);
            return this.fit(~operand);
        }
        return this.parsePrimary();
    };

    private parsePrimary(): bigint {
        const t = this.tokens[this.pos];
        if (!t) throw new CalcError('Unexpected end of expression');
        if (t.kind === 'num') {
            this.pos++;
            if (t.value > maskFor(this.opts.width)) {
                throw new CalcError(`Literal "${t.text}" does not fit in ${this.opts.width} bits`);
            }
            return t.value;
        }
        if (t.kind === 'lparen') {
            this.pos++;
            const inner = this.parseOr();
            const close = this.tokens[this.pos];
            if (!close || close.kind !== 'rparen') throw new CalcError('Missing ")"');
            this.pos++;
            return inner;
        }
        throw new CalcError(this.describeUnexpected());
    }

    private fit(value: bigint): bigint {
        return truncate(value, this.opts.width);
    }

    private apply(op: string, left: bigint, right: bigint): bigint {
        const { width, signed } = this.opts;
        switch (op) {
            case '+':
                return this.fit(left + right);
            case '-':
                return this.fit(left - right);
            case '*':
                return this.fit(left * right);
            case '/': {
                const a = signed ? toSigned(left, width) : left;
                const b = signed ? toSigned(right, width) : right;
                if (b === 0n) throw new CalcError('Divide by zero');
                return this.fit(a / b);
            }
            case '%': {
                const a = signed ? toSigned(left, width) : left;
                const b = signed ? toSigned(right, width) : right;
                if (b === 0n) throw new CalcError('Modulo by zero');
                return this.fit(a % b);
            }
            case '<<': {
                if (right > BigInt(width)) return this.fit(0n);
                return this.fit(left << right);
            }
            case '>>': {
                const a = signed ? toSigned(left, width) : left;
                const shift = right > BigInt(width) ? BigInt(width) : right;
                return this.fit(a >> shift);
            }
            case '&':
                return this.fit(left & right);
            case '|':
                return this.fit(left | right);
            case '^':
                return this.fit(left ^ right);
            default:
                throw new CalcError(`Unexpected token "${op}"`);
        }
    }
}

/**
 * Evaluate a C-style integer expression at the given width and signedness.
 *
 * Supported: `+ - * / %`, `~ & | ^ << >>`, parentheses, unary `+ - ~`, and
 * `0x` / `0b` / `0o` / decimal literals.
 */
export function evaluate(input: string, opts: CalcOptions): CalcResult {
    if (!input.trim()) return { ok: false, error: 'Empty expression' };
    try {
        const tokens = tokenize(input);
        // A negative shift count is undefined in C; reject it rather than letting
        // BigInt throw a RangeError from deep inside the parser.
        for (let i = 0; i < tokens.length; i++) {
            const t = tokens[i]!;
            if (t.kind === 'op' && (t.value === '<<' || t.value === '>>')) {
                const next = tokens[i + 1];
                if (next && next.kind === 'op' && next.value === '-') {
                    return { ok: false, error: 'Negative shift count' };
                }
            }
        }
        return { ok: true, value: new Parser(tokens, opts).parse() };
    } catch (err) {
        if (err instanceof CalcError) return { ok: false, error: err.message };
        return { ok: false, error: 'Invalid expression' };
    }
}
