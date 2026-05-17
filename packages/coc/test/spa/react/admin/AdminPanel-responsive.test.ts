/**
 * Tests for AdminPanel — responsive layout verification.
 *
 * The Linear-inspired redesign delegates responsive behaviour to
 * `admin-redesign.css` instead of inline Tailwind utility classes:
 *   - `.ar-page` provides the centered, padded content container.
 *   - `.ar-input` plus size variants (`ar-short`, `ar-med`, `ar-long`, `ar-full`)
 *     give consistent control sizing that adapts to its row.
 *   - A `@media (max-width: 720px)` block in the CSS file stacks rows on narrow
 *     screens (`.ar-row` becomes `flex-direction: column`).
 *
 * These tests assert that the source still hooks into that system.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const adminPanelSource = readFileSync(
    resolve(__dirname, '../../../../src/server/spa/client/react/admin/AdminPanel.tsx'),
    'utf-8'
);
const adminRedesignCss = readFileSync(
    resolve(__dirname, '../../../../src/server/spa/client/react/admin/admin-redesign.css'),
    'utf-8'
);

describe('AdminPanel responsive layout', () => {
    it('uses .ar-page as the centered content container', () => {
        // ar-page replaces the old `responsive-container` wrapper and supplies
        // max-width, horizontal padding, and a min-height on the admin route.
        expect(adminPanelSource).toContain('ar-page');
        expect(adminRedesignCss).toMatch(/\.admin-redesign \.ar-page\s*\{[^}]*max-width/);
    });

    it('uses the ar-input sizing primitives for form controls', () => {
        // Admin panel uses ar-input (with ar-short / ar-med / ar-long / ar-full
        // size variants) instead of bespoke padding utilities.
        expect(adminPanelSource).toMatch(/ar-input\b/);
        expect(adminRedesignCss).toMatch(/\.admin-redesign \.ar-input\b/);
    });

    it('stacks rows on narrow screens via a CSS media query', () => {
        // .ar-row switches to flex-direction: column under 720px so rows still
        // stack responsively even though the markup is identical at all sizes.
        expect(adminRedesignCss).toMatch(/@media \(max-width: 720px\)[\s\S]*\.ar-row\s*\{[\s\S]*flex-direction:\s*column/);
    });
});
