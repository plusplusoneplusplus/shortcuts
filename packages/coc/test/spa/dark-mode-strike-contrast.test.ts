/**
 * Tests that completed (strikethrough) task titles have sufficient contrast
 * in dark mode for both source-mode and markdown-body views.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const css = readFileSync(
    resolve(__dirname, '../../src/server/spa/client/tailwind.css'),
    'utf-8',
);

describe('dark mode strikethrough contrast', () => {
    describe('.src-strike (source mode)', () => {
        it('has a dark mode override', () => {
            expect(css).toContain('.dark .source-mode-body .src-strike');
        });

        it('uses a high-contrast color (not #9a9a9a)', () => {
            const rule = css.match(
                /\.dark\s+\.source-mode-body\s+\.src-strike\s*\{([^}]+)\}/,
            );
            expect(rule).toBeTruthy();
            const body = rule![1];
            expect(body).toContain('color:');
            // The old value #9a9a9a had insufficient contrast
            expect(body).not.toContain('#9a9a9a');
        });

        it('preserves line-through in the base rule', () => {
            const baseRule = css.match(
                /\.source-mode-body\s+\.src-strike\s*\{([^}]+)\}/,
            );
            expect(baseRule).toBeTruthy();
            expect(baseRule![1]).toContain('line-through');
        });
    });

    describe('.md-strike (markdown body)', () => {
        it('has a dark mode override', () => {
            expect(css).toContain('.dark .markdown-body .md-strike');
        });

        it('specifies a readable color in dark mode', () => {
            const rule = css.match(
                /\.dark\s+\.markdown-body\s+\.md-strike\s*\{([^}]+)\}/,
            );
            expect(rule).toBeTruthy();
            const body = rule![1];
            expect(body).toContain('color:');
        });

        it('keeps opacity for muted appearance', () => {
            const rule = css.match(
                /\.dark\s+\.markdown-body\s+\.md-strike\s*\{([^}]+)\}/,
            );
            expect(rule).toBeTruthy();
            expect(rule![1]).toContain('opacity:');
        });

        it('preserves line-through in the base rule', () => {
            const baseRule = css.match(
                /\.markdown-body\s+\.md-strike\s*\{([^}]+)\}/,
            );
            expect(baseRule).toBeTruthy();
            expect(baseRule![1]).toContain('line-through');
        });

        it('does not alter the light-mode base rule', () => {
            const baseRule = css.match(
                /(?<!\.dark\s)\.markdown-body\s+\.md-strike\s*\{([^}]+)\}/,
            );
            expect(baseRule).toBeTruthy();
            const body = baseRule![1];
            expect(body).toContain('line-through');
            expect(body).toContain('opacity: 0.85');
            // Light mode should NOT contain a color override (inherits)
            expect(body).not.toContain('color:');
        });
    });
});
