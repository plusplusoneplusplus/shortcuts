import { describe, it, expect } from 'vitest';
import {
    pdfLabelFromMarkdown,
    normalizeStoredPdfLabel,
} from '../../../../src/server/spa/client/react/features/notes/editor/pdfLabel';

// Both helpers decode exactly one layer of Markdown backslash escaping so a PDF
// block's visible title equals the original filename. They share an implementation
// but carry distinct intent (Markdown-source label vs. stored legacy label).
describe('pdfLabel — decode Markdown escapes', () => {
    const cases: Array<[string, string]> = [
        // Multiple underscores — the reported OSDI filename bug.
        ['OSDI\\_2026\\_Paper\\_Survey.pdf', 'OSDI_2026_Paper_Survey.pdf'],
        // Other escapable punctuation: brackets, parens, backtick, asterisk, plus, tilde.
        ['a\\*b\\`c\\[d\\]\\(e\\)\\+\\~.pdf', 'a*b`c[d](e)+~.pdf'],
        // A single underscore.
        ['my\\_doc.pdf', 'my_doc.pdf'],
        // Already-literal text is unchanged (idempotent no-op).
        ['OSDI_2026_Paper_Survey.pdf', 'OSDI_2026_Paper_Survey.pdf'],
        ['plain.pdf', 'plain.pdf'],
        ['Sample PDF', 'Sample PDF'],
        // A literal backslash NOT before ASCII punctuation is preserved.
        ['a\\b.pdf', 'a\\b.pdf'],
        // Escaped backslash then literal underscore → one decode layer only.
        ['a\\\\_b.pdf', 'a\\_b.pdf'],
        // Unicode is preserved untouched.
        ['résumé_ω.pdf', 'résumé_ω.pdf'],
    ];

    it.each(cases)('pdfLabelFromMarkdown decodes %j', (input, expected) => {
        expect(pdfLabelFromMarkdown(input)).toBe(expected);
    });

    it.each(cases)('normalizeStoredPdfLabel decodes %j', (input, expected) => {
        expect(normalizeStoredPdfLabel(input)).toBe(expected);
    });

    it('decodes only one layer (running twice does not strip more)', () => {
        const once = pdfLabelFromMarkdown('OSDI\\_2026\\_x.pdf');
        expect(once).toBe('OSDI_2026_x.pdf');
        // A second pass is a stable no-op — no over-stripping across cycles.
        expect(pdfLabelFromMarkdown(once)).toBe(once);
        expect(normalizeStoredPdfLabel(once)).toBe(once);
    });

    it('preserves HTML entities (no double-decoding of &amp;)', () => {
        // The marked/plainLinkLabel boundary already resolved entities; these
        // helpers must not touch them.
        expect(pdfLabelFromMarkdown('Q&A.pdf')).toBe('Q&A.pdf');
    });
});
