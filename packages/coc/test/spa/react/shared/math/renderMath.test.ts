import { describe, it, expect } from 'vitest';
import { renderMath } from '../../../../../src/server/spa/client/shared/math/renderMath';

describe('renderMath — safe rendering', () => {
    it('renders inline math to HTML+MathML markup', () => {
        const html = renderMath('a+b', { display: false });
        expect(html).toContain('katex');
        // htmlAndMathml output includes a MathML <math> element for accessibility.
        expect(html).toContain('<math');
        expect(html).not.toContain('katex-display');
    });

    it('renders display math with the display wrapper', () => {
        const html = renderMath('E=mc^2', { display: true });
        expect(html).toContain('katex-display');
        expect(html).toContain('<math');
    });

    it('exposes theme-independent semantic MathML (annotation with source)', () => {
        const html = renderMath('x^2', { display: false });
        expect(html).toContain('<annotation');
        expect(html).toContain('x^2');
    });

    it('never throws on invalid TeX and keeps the source readable', () => {
        expect(() => renderMath('\\frac{1}{', { display: false })).not.toThrow();
        const html = renderMath('\\frac{1}{', { display: false });
        // throwOnError:false renders a readable error node rather than blanking.
        expect(html.length).toBeGreaterThan(0);
    });

    it('does not honor trusted commands (trust:false blocks \\href URLs)', () => {
        const html = renderMath('\\href{javascript:alert(1)}{x}', { display: false });
        // With trust:false KaTeX must not emit a clickable anchor. The raw
        // command may survive only as inert source text inside the MathML
        // <annotation>, but never as an executable link.
        expect(html.toLowerCase()).not.toContain('<a ');
        expect(html.toLowerCase()).not.toContain('href="javascript:');
    });

    it('degrades unsupported/unsafe input without throwing', () => {
        expect(() => renderMath('\\includegraphics{evil.png}', { display: true })).not.toThrow();
    });
});
