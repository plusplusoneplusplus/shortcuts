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
 *   - A `@container` block collapses the sidebar to a `<select>` and stacks
 *     `.ar-row` when the shell is narrow (`.ar-row` becomes
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
// Form controls were extracted from the AdminPanel shell into focused card
// components; the ar-input sizing primitives now live there.
const configCardsSource = readFileSync(
    resolve(__dirname, '../../../../src/server/spa/client/react/admin/configSettingsCards.tsx'),
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
        // The settings cards use ar-input (with ar-short / ar-med / ar-long /
        // ar-full size variants) instead of bespoke padding utilities.
        expect(configCardsSource).toMatch(/ar-input\b/);
        expect(adminRedesignCss).toMatch(/\.admin-redesign \.ar-input\b/);
    });

    it('collapses the sidebar and stacks rows when the shell is narrow', () => {
        // The single layout-level responsive block collapses the sidebar
        // (hides .ar-sidebar, shows .ar-mobile-tab-select) and stacks
        // .ar-row vertically (flex-direction: column).
        expect(adminRedesignCss).toMatch(
            /@container ar-shell \(max-width: \d+px\)[\s\S]*?\.ar-sidebar\s*\{[\s\S]*display:\s*none/
        );
        expect(adminRedesignCss).toMatch(
            /@container ar-shell \(max-width: \d+px\)[\s\S]*?\.ar-row\s*\{[\s\S]*flex-direction:\s*column/
        );
    });
});

/**
 * AC-04 — the shell now renders inside AdminDialog, which caps it at
 * ~1100px however wide the window is. Viewport media queries are therefore
 * the wrong axis: on a 1440px monitor the main pane is only ~830px, yet
 * `@media (max-width: 900px)` would never fire and the 4-up summary grid
 * would stay 4-up and clip. Everything responsive keys off a query
 * container instead.
 */
describe('AdminPanel responsive layout inside the admin dialog', () => {
    it('declares the two query containers the responsive blocks key off', () => {
        // `ar-shell` = the whole shell (drives the sidebar collapse).
        expect(adminRedesignCss).toMatch(
            /\.admin-redesign \{[^}]*container-type:\s*inline-size;[\s\S]*container-name:\s*ar-shell/
        );
        // `ar-main` = the shell minus the 248px sidebar (drives page content).
        expect(adminRedesignCss).toMatch(
            /\.admin-redesign \.ar-main \{[^}]*container-type:\s*inline-size;[\s\S]*container-name:\s*ar-main/
        );
    });

    it('keys the page-content responsive blocks off the main pane, not the viewport', () => {
        // The summary grid steps 4 → 2 → 1 as the pane narrows.
        expect(adminRedesignCss).toMatch(
            /@container ar-main \(max-width: 660px\)[\s\S]*?\.aip-summary-grid\s*\{[\s\S]*grid-template-columns:\s*repeat\(2/
        );
        expect(adminRedesignCss).toMatch(
            /@container ar-main \(max-width: 600px\)[\s\S]*?\.aip-summary-grid\s*\{[\s\S]*grid-template-columns:\s*1fr/
        );
    });

    it('has no viewport media queries left in the admin stylesheet', () => {
        // A stray @media would silently not fire at dialog width — the exact
        // bug this conversion fixes. Guard against one creeping back in.
        expect(adminRedesignCss).not.toMatch(/@media\b/);
    });

    it('lets the shell fill the dialog body and clips, so only .ar-main scrolls', () => {
        // No double scrollbar: the dialog body is the outer scroll region only
        // in principle — the shell fills it exactly and hides its own overflow.
        expect(adminRedesignCss).toMatch(
            /\.admin-redesign \{[^}]*height:\s*100%;[\s\S]*overflow:\s*hidden/
        );
        expect(adminRedesignCss).toMatch(
            /\.admin-redesign \.ar-shell \{[^}]*height:\s*100%;[\s\S]*overflow:\s*hidden/
        );
        expect(adminRedesignCss).toMatch(
            /\.admin-redesign \.ar-main \{[^}]*overflow-y:\s*auto/
        );
    });

    it('sizes the page content fluidly — no fixed pixel widths that could clip', () => {
        // `.ar-page` uses max-width (shrinks with the pane) rather than width.
        expect(adminRedesignCss).toMatch(/\.admin-redesign \.ar-page \{[^}]*max-width:\s*920px/);
        expect(adminRedesignCss).not.toMatch(/\.admin-redesign \.ar-page \{[^}]*\n\s*width:\s*\d+px/);
        // AC-04 DoD 3: no inline pixel widths or !important in the shell.
        expect(adminPanelSource).not.toMatch(/!important/);
        expect(adminPanelSource).not.toMatch(/style=\{\{[^}]*width:\s*\d+/);
    });

    it('gives every wide table its own horizontal scroller instead of overflowing the pane', () => {
        // Tables that need more than the pane width scroll inside their own
        // wrapper; the dialog itself never grows a horizontal scrollbar.
        for (const wrapper of ['aip-routing-table', 'aip-model-table']) {
            expect(adminRedesignCss).toMatch(
                new RegExp(`\\.admin-redesign \\.${wrapper} \\{[^}]*overflow-x:\\s*auto`)
            );
        }
    });
});
