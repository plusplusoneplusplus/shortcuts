import { describe, it, expect } from 'vitest';
import { Marked } from 'marked';
import { mathMarkedExtension } from '../../../../../src/server/spa/client/shared/math/mathMarkedExtension';

/** A minimal Marked instance mirroring how the live consumers register the extension. */
function md(): Marked {
    return new Marked({ gfm: true, breaks: true }).use(mathMarkedExtension);
}

function render(src: string): string {
    return md().parse(src) as string;
}

describe('mathMarkedExtension — delimiter coverage', () => {
    it('renders inline $...$ math', () => {
        const html = render('mass is $E=mc^2$ today');
        expect(html).toContain('class="katex"');
        expect(html).toContain('<math');
        expect(html).not.toContain('katex-display');
        // Surrounding prose survives.
        expect(html).toContain('mass is');
        expect(html).toContain('today');
    });

    it('renders inline \\(...\\) math', () => {
        const html = render('area \\(\\pi r^2\\) here');
        expect(html).toContain('class="katex"');
        expect(html).not.toContain('katex-display');
    });

    it('renders display $$...$$ math as a block', () => {
        const html = render('$$\\int_0^1 x\\,dx$$');
        expect(html).toContain('katex-display');
        // Standalone display math is a block, not wrapped in a <p>.
        expect(html).not.toMatch(/<p>\s*<span class="katex-display"/);
    });

    it('renders display \\[...\\] math', () => {
        const html = render('\\[a^2 + b^2 = c^2\\]');
        expect(html).toContain('katex-display');
    });

    it('renders multiline display math', () => {
        const html = render('$$\n\\begin{aligned}\na &= b \\\\\nc &= d\n\\end{aligned}\n$$');
        expect(html).toContain('katex-display');
        // Multiline display renders as a single math token, so breaks:true does
        // not inject a stray <br> between the aligned rows.
        expect(html).not.toContain('<br');
    });

    it('renders multiple inline formulas in one paragraph', () => {
        const html = render('first $a+b$ and second $c+d$ done');
        const count = (html.match(/class="katex"/g) || []).length;
        expect(count).toBe(2);
    });
});

describe('mathMarkedExtension — literal / false-positive guards', () => {
    it('does not parse math inside inline code', () => {
        const html = render('use `$x$` literally');
        expect(html).not.toContain('class="katex"');
        expect(html).toContain('<code>$x$</code>');
    });

    it('does not parse math inside a fenced code block', () => {
        const html = render('```\n$a+b$\n```');
        expect(html).not.toContain('class="katex"');
        expect(html).toContain('$a+b$');
    });

    it('leaves currency amounts literal', () => {
        const html = render('It costs $5 and $6 total');
        expect(html).not.toContain('class="katex"');
        expect(html).toContain('$5');
        expect(html).toContain('$6');
    });

    it('leaves shell variables literal', () => {
        const html = render('echo $HOME and $PATH');
        expect(html).not.toContain('class="katex"');
    });

    it('leaves template placeholders literal', () => {
        const html = render('the value is ${count}');
        expect(html).not.toContain('class="katex"');
    });

    it('keeps an escaped \\$ literal', () => {
        const html = render('price \\$5 to \\$9');
        expect(html).not.toContain('class="katex"');
    });
});

describe('mathMarkedExtension — streaming and errors', () => {
    it('leaves an unclosed opener as readable source (streaming)', () => {
        const html = render('partial $E=mc^2 still typing');
        expect(html).not.toContain('class="katex"');
        expect(html).toContain('$E=mc^2 still typing');
    });

    it('renders once the closing delimiter arrives', () => {
        const html = render('partial $E=mc^2$ done');
        expect(html).toContain('class="katex"');
    });

    it('does not throw or blank on invalid TeX', () => {
        const html = render('bad $\\frac{1}{$ math');
        // Never throws; either renders a KaTeX error node or keeps source readable.
        expect(typeof html).toBe('string');
        expect(html.length).toBeGreaterThan(0);
    });

    it('renders an unsafe command inertly (trust:false)', () => {
        const html = render('link $\\href{https://evil.example}{x}$ here');
        // No clickable anchor is emitted for \href under trust:false.
        expect(html).not.toContain('href="https://evil.example"');
    });
});
