/**
 * Layout invariants for the admin route: the page must fit the available
 * vertical space, never grow into a single big scrollable page, and only
 * the right pane (`.ar-main`) is allowed to scroll internally when its
 * content overflows.
 *
 * These checks are static (string-level) but lock the contract between
 * `Router.tsx` (the outer wrapper) and `admin-redesign.css` (the shell
 * sizing) so that any regression to the previous "whole page scrolls"
 * behaviour shows up here, not in production.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const css = readFileSync(
    resolve(__dirname, '../../../../src/server/spa/client/react/admin/admin-redesign.css'),
    'utf-8',
);
const routerSource = readFileSync(
    resolve(__dirname, '../../../../src/server/spa/client/react/layout/Router.tsx'),
    'utf-8',
);

function block(selector: string): string {
    const re = new RegExp(`\\.admin-redesign\\s+${selector.replace(/\./g, '\\.')}\\s*\\{([^}]*)\\}`);
    const match = css.match(re);
    if (!match) throw new Error(`Selector not found in admin-redesign.css: .admin-redesign ${selector}`);
    return match[1];
}

function rootBlock(): string {
    // The root `.admin-redesign { ... }` rule (no descendant selector after the class).
    const re = /\.admin-redesign\s*\{([^}]*)\}/;
    const match = css.match(re);
    if (!match) throw new Error('Root .admin-redesign rule not found');
    return match[1];
}

describe('AdminPanel — fit-to-viewport layout invariants', () => {
    it('Router wraps the admin route in an overflow-hidden container, not a scroller', () => {
        // Find the admin route branch.
        const adminCase = routerSource.match(/case 'admin':[\s\S]*?return\s*\([\s\S]*?\);/);
        expect(adminCase, 'admin case in Router.tsx not found').not.toBeNull();
        const branch = adminCase![0];
        expect(branch).toMatch(/data-testid="admin-scroll-container"/);
        // The outer wrapper must clip overflow (so the whole page can't scroll).
        expect(branch).toMatch(/overflow-hidden/);
        // It must NOT mark itself as a scroll container any longer.
        expect(branch).not.toMatch(/overflow-y-auto/);
    });

    it('root .admin-redesign fills its parent so children can size against it', () => {
        const root = rootBlock();
        expect(root).toMatch(/height:\s*100%/);
        // min-height: 0 is required so the root can shrink inside a flex parent
        // (e.g. the AdminDialog body) instead of forcing the whole dialog to grow.
        expect(root).toMatch(/min-height:\s*0/);
    });

    it('.ar-shell pins itself to 100% height and never overflows', () => {
        const shell = block('.ar-shell');
        expect(shell).toMatch(/height:\s*100%/);
        expect(shell).toMatch(/min-height:\s*0/);
        expect(shell).toMatch(/overflow:\s*hidden/);
        // Must NOT use `min-height: 100%` which was the source of full-page scroll.
        expect(shell).not.toMatch(/min-height:\s*100%/);
    });

    it('.ar-sidebar fills the grid row, scrolls only its own overflow, and is NOT sticky', () => {
        const sidebar = block('.ar-sidebar');
        expect(sidebar).toMatch(/height:\s*100%/);
        expect(sidebar).toMatch(/min-height:\s*0/);
        expect(sidebar).toMatch(/overflow-y:\s*auto/);
        // The previous design used sticky + 100vh to keep the sidebar in view
        // while the whole page scrolled. With fit-to-viewport, both are
        // unnecessary and would be wrong (100vh != container height in a
        // dialog or nested pane).
        expect(sidebar).not.toMatch(/position:\s*sticky/);
        expect(sidebar).not.toMatch(/height:\s*100vh/);
    });

    it('.ar-main is the single internal scroller', () => {
        const main = block('.ar-main');
        expect(main).toMatch(/height:\s*100%/);
        expect(main).toMatch(/min-height:\s*0/);
        expect(main).toMatch(/overflow-y:\s*auto/);
    });

    it('.ar-topbar stays pinned via sticky positioning inside the main scroller', () => {
        const topbar = block('.ar-topbar');
        // The topbar must remain visible while .ar-main scrolls. CSS sticky
        // works inside any overflow container, so this is still the right tool.
        expect(topbar).toMatch(/position:\s*sticky/);
        expect(topbar).toMatch(/top:\s*0/);
    });
});
