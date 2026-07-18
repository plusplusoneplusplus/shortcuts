import { describe, it, expect } from 'vitest';
import {
    tokenizeMath,
    hasMath,
    wrapMathDelimiters,
    type MarkdownMathSegment,
    type MathSegment,
} from '../../../../../src/server/spa/client/shared/math/mathTokenizer';

function mathOnly(segs: MarkdownMathSegment[]): MathSegment[] {
    return segs.filter((s): s is MathSegment => s.type === 'math');
}

function text(segs: MarkdownMathSegment[]): string {
    return segs.map(s => (s.type === 'text' ? s.value : s.raw)).join('');
}

describe('tokenizeMath — delimiter forms', () => {
    it('parses inline $...$', () => {
        const segs = tokenizeMath('before $a+b$ after');
        const m = mathOnly(segs);
        expect(m).toHaveLength(1);
        expect(m[0]).toMatchObject({ tex: 'a+b', display: false, delimiter: 'dollar', raw: '$a+b$' });
        expect(text(segs)).toBe('before $a+b$ after');
    });

    it('parses inline \\(...\\)', () => {
        const segs = tokenizeMath('x = \\(a+b\\) done');
        const m = mathOnly(segs);
        expect(m).toHaveLength(1);
        expect(m[0]).toMatchObject({ tex: 'a+b', display: false, delimiter: 'paren' });
    });

    it('parses display $$...$$', () => {
        const segs = tokenizeMath('$$E=mc^2$$');
        const m = mathOnly(segs);
        expect(m).toHaveLength(1);
        expect(m[0]).toMatchObject({ tex: 'E=mc^2', display: true, delimiter: 'double-dollar' });
    });

    it('parses display \\[...\\]', () => {
        const segs = tokenizeMath('\\[E=mc^2\\]');
        const m = mathOnly(segs);
        expect(m).toHaveLength(1);
        expect(m[0]).toMatchObject({ tex: 'E=mc^2', display: true, delimiter: 'bracket' });
    });

    it('parses multiline display math', () => {
        const src = '$$\n\\begin{aligned}\na &= b \\\\\nc &= d\n\\end{aligned}\n$$';
        const m = mathOnly(tokenizeMath(src));
        expect(m).toHaveLength(1);
        expect(m[0].display).toBe(true);
        expect(m[0].tex).toContain('\\begin{aligned}');
        expect(m[0].tex).toContain('c &= d');
    });

    it('handles multiple formulas in one paragraph', () => {
        const segs = tokenizeMath('$a$ and $b$ and \\(c\\)');
        const m = mathOnly(segs);
        expect(m.map(x => x.tex)).toEqual(['a', 'b', 'c']);
    });

    it('preserves markdown-significant characters inside a formula', () => {
        const m = mathOnly(tokenizeMath('$a_*b*_c$'));
        expect(m).toHaveLength(1);
        expect(m[0].tex).toBe('a_*b*_c');
    });
});

describe('tokenizeMath — false positives stay literal', () => {
    it('does not treat currency as math', () => {
        const segs = tokenizeMath('It costs $5 and $10 total.');
        expect(mathOnly(segs)).toHaveLength(0);
        expect(text(segs)).toBe('It costs $5 and $10 total.');
    });

    it('does not match $ followed by whitespace', () => {
        expect(mathOnly(tokenizeMath('a $ b $ c'))).toHaveLength(0);
    });

    it('leaves escaped \\$ literal', () => {
        const segs = tokenizeMath('price is \\$5 not math');
        expect(mathOnly(segs)).toHaveLength(0);
        expect(text(segs)).toBe('price is \\$5 not math');
    });

    it('does not consume shell variables', () => {
        expect(mathOnly(tokenizeMath('echo $HOME and $PATH'))).toHaveLength(0);
    });

    it('does not consume ${...} template placeholders', () => {
        expect(mathOnly(tokenizeMath('url is ${base}/api'))).toHaveLength(0);
    });

    it('escaped closing dollar does not close inline math prematurely', () => {
        const m = mathOnly(tokenizeMath('$a \\$ b$'));
        expect(m).toHaveLength(1);
        expect(m[0].tex).toBe('a \\$ b');
    });
});

describe('tokenizeMath — streaming / incomplete', () => {
    it('leaves an unclosed inline opener literal', () => {
        const segs = tokenizeMath('partial $a+b still typing');
        expect(mathOnly(segs)).toHaveLength(0);
        expect(text(segs)).toBe('partial $a+b still typing');
    });

    it('leaves an unclosed display opener literal', () => {
        const segs = tokenizeMath('$$E=mc still typing');
        expect(mathOnly(segs)).toHaveLength(0);
        expect(text(segs)).toBe('$$E=mc still typing');
    });

    it('renders once the closing delimiter arrives', () => {
        const m = mathOnly(tokenizeMath('$$E=mc^2$$'));
        expect(m).toHaveLength(1);
    });

    it('inline math does not span a paragraph break', () => {
        const segs = tokenizeMath('$a\n\nb$');
        expect(mathOnly(segs)).toHaveLength(0);
    });
});

describe('tokenizeMath — round trip', () => {
    it('reconstructs the original source verbatim for mixed content', () => {
        const src = 'Given $x$, we have $$y = x^2$$ and \\(z\\) plus \\[w\\].';
        expect(text(tokenizeMath(src))).toBe(src);
    });

    it('hasMath reflects presence', () => {
        expect(hasMath('plain text')).toBe(false);
        expect(hasMath('has $x$ math')).toBe(true);
        expect(hasMath('costs $5')).toBe(false);
    });
});

describe('wrapMathDelimiters', () => {
    it('reconstructs each delimiter form', () => {
        expect(wrapMathDelimiters('dollar', 'x')).toBe('$x$');
        expect(wrapMathDelimiters('double-dollar', 'x')).toBe('$$x$$');
        expect(wrapMathDelimiters('paren', 'x')).toBe('\\(x\\)');
        expect(wrapMathDelimiters('bracket', 'x')).toBe('\\[x\\]');
    });

    it('round-trips a tokenized segment back to its raw source', () => {
        const src = 'Given $x$, $$y^2$$, \\(z\\), \\[w\\].';
        for (const seg of tokenizeMath(src)) {
            if (seg.type === 'math') {
                expect(wrapMathDelimiters(seg.delimiter, seg.tex)).toBe(seg.raw);
            }
        }
    });
});
