/**
 * Tests for AdminPanel — responsive layout verification.
 *
 * The Linear-inspired redesign delegates responsive behaviour to
 * `admin-redesign.css` instead of inline Tailwind utility classes:
 *   - `.ar-shell` provides the sidebar (`.ar-sidebar`) + main pane
 *     (`.ar-main`) two-column layout.
 *   - `.ar-page` provides the centered, padded content container in the
 *     right pane.
 *   - `.ar-input` plus size variants (`ar-short`, `ar-med`, `ar-long`,
 *     `ar-full`) give consistent control sizing that adapts to its row.
 *   - A `@media` block collapses the sidebar to a `<select>` and stacks
 *     `.ar-row` on narrow viewports (`.ar-row` becomes
 *     `flex-direction: column`).
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
    it('uses .ar-shell as the sidebar + main two-column layout', () => {
        // The admin redesign wraps the page in a sidebar (.ar-sidebar) plus
        // main pane (.ar-main) grid, similar to a Linear-style settings page.
        expect(adminPanelSource).toContain('ar-shell');
        expect(adminPanelSource).toContain('ar-sidebar');
        expect(adminPanelSource).toContain('ar-main');
        expect(adminRedesignCss).toMatch(/\.admin-redesign \.ar-shell\s*\{[^}]*grid-template-columns/);
    });

    it('uses .ar-page as the centered content container in the right pane', () => {
        // ar-page replaces the old `responsive-container` wrapper and supplies
        // max-width and horizontal padding for the page body.
        expect(adminPanelSource).toContain('ar-page');
        expect(adminRedesignCss).toMatch(/\.admin-redesign \.ar-page\s*\{[^}]*max-width/);
    });

    it('uses the ar-input sizing primitives for form controls', () => {
        // Admin panel uses ar-input (with ar-short / ar-med / ar-long / ar-full
        // size variants) instead of bespoke padding utilities.
        expect(adminPanelSource).toMatch(/ar-input\b/);
        expect(adminRedesignCss).toMatch(/\.admin-redesign \.ar-input\b/);
    });

    it('collapses the sidebar and stacks rows on narrow screens via a CSS media query', () => {
        // The single responsive media query collapses the sidebar
        // (hides .ar-sidebar, shows .ar-mobile-tab-select) and stacks
        // .ar-row vertically (flex-direction: column).
        expect(adminRedesignCss).toMatch(
            /@media \(max-width: \d+px\)[\s\S]*\.ar-sidebar\s*\{[\s\S]*display:\s*none/
        );
        expect(adminRedesignCss).toMatch(
            /@media \(max-width: \d+px\)[\s\S]*\.ar-row\s*\{[\s\S]*flex-direction:\s*column/
        );
    });
});
