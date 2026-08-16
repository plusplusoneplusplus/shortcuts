/**
 * Programmer-calculator logic — a C-style integer evaluator that falls back to
 * real (double) math when the expression asks for it.
 *
 * Dependency-free and React-free so it can be unit-tested directly. Integer
 * expressions run on `bigint` so 64-bit values stay exact, and every
 * intermediate result is truncated to the selected width, which is what makes
 * overflow wrap the way it does in C.
 *
 * The moment a real value enters — a decimal literal, `**`, a named function or
 * a constant — that operand and everything above it becomes an IEEE-754 double.
 * `/` on two integers stays integer division, so `7/2` is still `3`.
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

export type CalcResult =
    /** Exact integer result — the width/signed wrapping already applied. */
    | { ok: true; kind: 'int'; value: bigint }
    /** IEEE-754 result; the bases and bit grid show it truncated toward zero. */
    | { ok: true; kind: 'real'; value: number }
    | { ok: false; error: string };

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

/**
 * Render a real DEC readout: up to 15 significant digits with trailing zeros
 * stripped. Round-tripping through `Number` leaves the exponent notation to
 * JavaScript, which only reaches for it at |x| >= 1e21 or < 1e-6, and prints
 * `-0` as `0`.
 */
export function formatReal(value: number): string {
    return Number(value.toPrecision(15)).toString();
}

/** Truncate a real toward zero so the hex/oct/bin views have something to wrap. */
export function realToBigInt(value: number): bigint {
    return BigInt(Math.trunc(value));
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
    | { kind: 'real'; value: number; text: string }
    | { kind: 'name'; text: string }
    | { kind: 'op'; value: string }
    | { kind: 'lparen' }
    | { kind: 'rparen' }
    | { kind: 'comma' };

class CalcError extends Error {}

/** Wrap a double, refusing to let NaN or Infinity travel any further. */
function real(value: number): { kind: 'real'; value: number } {
    if (Number.isNaN(value)) throw new CalcError('Result is not a number');
    if (!Number.isFinite(value)) throw new CalcError('Result is out of range');
    return { kind: 'real', value };
}

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
        if (ch === ',') {
            tokens.push({ kind: 'comma' });
            i++;
            continue;
        }
        if (ch === '<' || ch === '>') {
            if (input[i + 1] !== ch) throw new CalcError(`Unexpected character "${ch}"`);
            tokens.push({ kind: 'op', value: ch + ch });
            i += 2;
            continue;
        }
        if (ch === '*' && input[i + 1] === '*') {
            tokens.push({ kind: 'op', value: '**' });
            i += 2;
            continue;
        }
        if ('+-*/%&|^~'.includes(ch)) {
            tokens.push({ kind: 'op', value: ch });
            i++;
            continue;
        }
        if (/[A-Za-z_]/.test(ch)) {
            let j = i;
            while (j < input.length && /[A-Za-z0-9_]/.test(input[j]!)) j++;
            tokens.push({ kind: 'name', text: input.slice(i, j) });
            i = j;
            continue;
        }
        if (ch === '.' && /[0-9]/.test(input[i + 1] ?? '')) {
            const end = scanRealTail(input, i);
            tokens.push(realToken(input.slice(i, end)));
            i = end;
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
            const end = scanRealTail(input, i);
            const text = input.slice(i, end);
            i = end;
            // A bare run of digits stays exact on the bigint path; anything with
            // a point or an exponent is a real literal.
            tokens.push(/[.eE]/.test(text) ? realToken(text) : { kind: 'num', value: BigInt(text), text });
            continue;
        }
        throw new CalcError(`Unexpected character "${ch}"`);
    }
    return tokens;
}

/** Consume `digits [. digits] [e[+-]digits]` starting at `start`. */
function scanRealTail(input: string, start: number): number {
    let j = start;
    while (j < input.length && /[0-9]/.test(input[j]!)) j++;
    if (input[j] === '.') {
        j++;
        while (j < input.length && /[0-9]/.test(input[j]!)) j++;
    }
    if (input[j] === 'e' || input[j] === 'E') {
        // Only swallow the `e` when a real exponent follows, so `2e` still reads
        // as `2` next to the constant `e`.
        let k = j + 1;
        if (input[k] === '+' || input[k] === '-') k++;
        if (/[0-9]/.test(input[k] ?? '')) {
            while (k < input.length && /[0-9]/.test(input[k]!)) k++;
            j = k;
        }
    }
    return j;
}

function realToken(text: string): Token {
    const value = Number(text);
    if (!Number.isFinite(value)) throw new CalcError(`Literal "${text}" is out of range`);
    return { kind: 'real', value, text };
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
// Named functions and constants — all real-producing, all case-insensitive
// ---------------------------------------------------------------------------

interface CalcFunction {
    /** Fixed argument count, or `null` for "one or more". */
    arity: number | null;
    apply(args: number[]): number;
}

const FUNCTIONS: Record<string, CalcFunction> = {
    sqrt: { arity: 1, apply: a => Math.sqrt(a[0]!) },
    abs: { arity: 1, apply: a => Math.abs(a[0]!) },
    round: { arity: 1, apply: a => Math.round(a[0]!) },
    floor: { arity: 1, apply: a => Math.floor(a[0]!) },
    ceil: { arity: 1, apply: a => Math.ceil(a[0]!) },
    log: { arity: 1, apply: a => Math.log(a[0]!) },
    log2: { arity: 1, apply: a => Math.log2(a[0]!) },
    log10: { arity: 1, apply: a => Math.log10(a[0]!) },
    exp: { arity: 1, apply: a => Math.exp(a[0]!) },
    pow: { arity: 2, apply: a => Math.pow(a[0]!, a[1]!) },
    min: { arity: null, apply: a => Math.min(...a) },
    max: { arity: null, apply: a => Math.max(...a) },
};

const CONSTANTS: Record<string, number> = {
    pi: Math.PI,
    e: Math.E,
};

/** Own-property lookup, so `constructor` and friends stay unknown names. */
function lookup<T>(table: Record<string, T>, name: string): T | undefined {
    return Object.prototype.hasOwnProperty.call(table, name) ? table[name] : undefined;
}

// ---------------------------------------------------------------------------
// Parser — recursive descent, C precedence (weakest binding first)
// ---------------------------------------------------------------------------

/** An operand mid-evaluation: still exact, or already promoted to a double. */
type Val = { kind: 'int'; value: bigint } | { kind: 'real'; value: number };

/** These reject a real operand outright rather than truncating behind the user's back. */
const BITWISE = new Set(['&', '|', '^', '<<', '>>']);

class Parser {
    private pos = 0;

    constructor(
        private readonly tokens: Token[],
        private readonly opts: CalcOptions,
    ) {}

    parse(): Val {
        const value = this.parseOr();
        if (this.pos < this.tokens.length) throw new CalcError(this.describeUnexpected());
        return value;
    }

    private describeUnexpected(): string {
        const t = this.tokens[this.pos];
        if (!t) return 'Unexpected end of expression';
        if (t.kind === 'num' || t.kind === 'real' || t.kind === 'name') {
            return `Unexpected token "${t.text}"`;
        }
        if (t.kind === 'op') return `Unexpected token "${t.value}"`;
        if (t.kind === 'comma') return 'Unexpected token ","';
        return `Unexpected token "${t.kind === 'lparen' ? '(' : ')'}"`;
    }

    private peekOp(...ops: string[]): string | null {
        const t = this.tokens[this.pos];
        if (t && t.kind === 'op' && ops.includes(t.value)) return t.value;
        return null;
    }

    private binary(ops: string[], next: () => Val): Val {
        let left = next();
        for (;;) {
            const op = this.peekOp(...ops);
            if (!op) return left;
            this.pos++;
            const right = next();
            left = this.apply(op, left, right);
        }
    }

    private parseOr = (): Val => this.binary(['|'], this.parseXor);
    private parseXor = (): Val => this.binary(['^'], this.parseAnd);
    private parseAnd = (): Val => this.binary(['&'], this.parseShift);
    private parseShift = (): Val => this.binary(['<<', '>>'], this.parseAdditive);
    private parseAdditive = (): Val => this.binary(['+', '-'], this.parseMultiplicative);
    private parseMultiplicative = (): Val => this.binary(['*', '/', '%'], this.parseUnary);

    private parseUnary = (): Val => {
        const op = this.peekOp('-', '+', '~');
        if (op) {
            this.pos++;
            const operand = this.parseUnary();
            if (op === '+') return operand;
            // A negated integer keeps its sign here and only wraps once an
            // integer operator or the final result asks for it, so `sqrt(-1)`
            // sees -1 rather than the unsigned wrap of -1.
            if (op === '-') {
                if (operand.kind === 'real') return real(-operand.value);
                return { kind: 'int', value: -operand.value };
            }
            if (operand.kind === 'real') throw new CalcError('Bitwise "~" needs an integer operand');
            return { kind: 'int', value: ~operand.value };
        }
        return this.parsePower();
    };

    // `**` binds tighter than unary minus and is right-associative, so
    // `-2**2` is `-4` and `2**3**2` is `512`. It always yields a real.
    private parsePower = (): Val => {
        const left = this.parsePrimary();
        if (!this.peekOp('**')) return left;
        this.pos++;
        const right = this.parseUnary();
        return real(Math.pow(this.toNumber(left), this.toNumber(right)));
    };

    private parsePrimary(): Val {
        const t = this.tokens[this.pos];
        if (!t) throw new CalcError('Unexpected end of expression');
        if (t.kind === 'num') {
            this.pos++;
            if (t.value > maskFor(this.opts.width)) {
                throw new CalcError(`Literal "${t.text}" does not fit in ${this.opts.width} bits`);
            }
            return { kind: 'int', value: t.value };
        }
        if (t.kind === 'real') {
            this.pos++;
            return { kind: 'real', value: t.value };
        }
        if (t.kind === 'name') {
            this.pos++;
            return this.parseName(t.text);
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

    /** A bare identifier is a constant; one followed by `(` is a call. */
    private parseName(text: string): Val {
        const name = text.toLowerCase();
        const next = this.tokens[this.pos];
        if (!next || next.kind !== 'lparen') {
            const constant = lookup(CONSTANTS, name);
            if (constant === undefined) throw new CalcError(`Unknown name "${text}"`);
            return { kind: 'real', value: constant };
        }
        const fn = lookup(FUNCTIONS, name);
        if (!fn) throw new CalcError(`Unknown function "${text}"`);
        this.pos++;
        const args: number[] = [];
        if (this.tokens[this.pos]?.kind === 'rparen') {
            this.pos++;
        } else {
            for (;;) {
                args.push(this.toNumber(this.parseOr()));
                const sep = this.tokens[this.pos];
                if (sep && sep.kind === 'comma') {
                    this.pos++;
                    continue;
                }
                if (!sep || sep.kind !== 'rparen') throw new CalcError('Missing ")"');
                this.pos++;
                break;
            }
        }
        if (fn.arity === null) {
            if (args.length < 1) throw new CalcError(`"${name}" needs at least 1 argument`);
        } else if (args.length !== fn.arity) {
            const plural = fn.arity === 1 ? 'argument' : 'arguments';
            throw new CalcError(`"${name}" takes ${fn.arity} ${plural}, got ${args.length}`);
        }
        return real(fn.apply(args));
    }

    private fit(value: bigint): bigint {
        return truncate(value, this.opts.width);
    }

    /**
     * Promote an operand to a double. A value that is still positive reads
     * through the signed setting, so `0xFFFFFFFF` is 4294967295 unsigned and -1
     * signed, matching the DEC readout.
     */
    private toNumber(v: Val): number {
        if (v.kind === 'real') return v.value;
        const { width, signed } = this.opts;
        return Number(signed ? toSigned(v.value, width) : v.value);
    }

    private apply(op: string, left: Val, right: Val): Val {
        if (BITWISE.has(op) && (left.kind === 'real' || right.kind === 'real')) {
            throw new CalcError(`Bitwise "${op}" needs integer operands`);
        }
        if (left.kind === 'int' && right.kind === 'int') {
            return { kind: 'int', value: this.applyInt(op, left.value, right.value) };
        }
        return this.applyReal(op, this.toNumber(left), this.toNumber(right));
    }

    private applyReal(op: string, a: number, b: number): Val {
        switch (op) {
            case '+':
                return real(a + b);
            case '-':
                return real(a - b);
            case '*':
                return real(a * b);
            case '/':
                if (b === 0) throw new CalcError('Divide by zero');
                return real(a / b);
            case '%':
                if (b === 0) throw new CalcError('Modulo by zero');
                return real(a % b);
            default:
                throw new CalcError(`Unexpected token "${op}"`);
        }
    }

    private applyInt(op: string, rawLeft: bigint, rawRight: bigint): bigint {
        const { width, signed } = this.opts;
        // Wrap both operands first: C only ever sees width-sized values here.
        const left = this.fit(rawLeft);
        const right = this.fit(rawRight);
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
 * Evaluate an expression at the given width and signedness.
 *
 * Supported: `+ - * / %`, `**`, `~ & | ^ << >>`, parentheses, unary `+ - ~`,
 * `0x` / `0b` / `0o` / decimal / real / scientific literals, the constants `pi`
 * and `e`, and the named functions in `FUNCTIONS` — all case-insensitive.
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
        const result = new Parser(tokens, opts).parse();
        return result.kind === 'int'
            ? { ok: true, kind: 'int', value: truncate(result.value, opts.width) }
            : { ok: true, kind: 'real', value: result.value };
    } catch (err) {
        if (err instanceof CalcError) return { ok: false, error: err.message };
        return { ok: false, error: 'Invalid expression' };
    }
}
