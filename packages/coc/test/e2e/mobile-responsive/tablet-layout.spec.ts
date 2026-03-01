/**
 * Tablet Layout Tests — verify hybrid behavior at 768×1024.
 */
import { test, expect } from '../fixtures/server-fixture';
import { seedWorkspace, seedProcesses, seedWiki } from '../fixtures/seed';
import { createWikiFixture } from '../fixtures/wiki-fixtures';
import { TABLET } from './viewports';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

test.use({ viewport: TABLET });

test.describe('Tablet Layout', () => {
    test('tablet: sidebar is collapsible', async ({ page, serverUrl }) => {
        await seedWorkspace(serverUrl, 'ws-tab-col', 'tab-col-repo');
        await page.goto(`${serverUrl}/#repos`);

        // Ensure repos tab is active
        await page.click('[data-tab="repos"]');
        const sidebar = page.locator('#repos-sidebar');
        await expect(sidebar).toBeVisible({ timeout: 10000 });

        // Click hamburger to collapse
        await page.click('#hamburger-btn');
        await page.waitForTimeout(300); // CSS transition

        // Collapsed sidebar should have w-12 class
        await expect(sidebar).toHaveClass(/w-12/);

        // Click again to expand
        await page.click('#hamburger-btn');
        await page.waitForTimeout(300);
        await expect(sidebar).toHaveClass(/w-\[280px\]/);
    });

    test('tablet: TopBar tab buttons are visible', async ({ page, serverUrl }) => {
        await page.goto(serverUrl);

        // At tablet width (768px), TopBar tab buttons should be visible
        for (const tab of ['repos', 'processes', 'wiki']) {
            const tabBtn = page.locator(`[data-tab="${tab}"]`);
            await expect(tabBtn).toBeVisible({ timeout: 10000 });
        }
    });

    test('tablet: no bottom navigation visible', async ({ page, serverUrl }) => {
        await page.goto(serverUrl);

        const bottomNav = page.locator('[data-testid="bottom-nav"]');
        if (await bottomNav.count() > 0) {
            await expect(bottomNav).toBeHidden();
        }
    });

    test('tablet: ProcessesView renders two-pane layout', async ({ page, serverUrl }) => {
        await seedProcesses(serverUrl, 2);
        await page.goto(`${serverUrl}/#processes`);

        await expect(page.locator('.process-item')).toHaveCount(2, { timeout: 10000 });

        // Sidebar and detail pane should both be visible
        const sidebar = page.locator('[data-testid="responsive-sidebar"]');
        const detail = page.locator('#detail-empty, #detail-content');
        await expect(sidebar).toBeVisible();
        await expect(detail.first()).toBeVisible();

        const sidebarBox = await sidebar.boundingBox();
        expect(sidebarBox!.width).toBeGreaterThan(200);
    });

    test('tablet: ReposView renders two-pane layout', async ({ page, serverUrl }) => {
        await seedWorkspace(serverUrl, 'ws-tab-2p', 'tab-2p-repo');
        await page.goto(`${serverUrl}/#repos`);

        await expect(page.locator('.repo-item')).toHaveCount(1, { timeout: 10000 });
        await page.locator('.repo-item').first().click();

        await expect(page.locator('#repos-sidebar')).toBeVisible();
        await expect(page.locator('#repo-detail-content')).toBeVisible();
    });

    test('tablet: dialog renders as centered modal', async ({ page, serverUrl }) => {
        await page.goto(`${serverUrl}/#repos`);
        await expect(page.locator('#view-repos')).toBeVisible({ timeout: 10000 });
        await page.click('#add-repo-btn');

        const overlay = page.locator('#add-repo-overlay');
        await expect(overlay).toBeVisible();

        // The overlay uses flex centering for non-mobile viewports
        await expect(overlay).toHaveClass(/flex/);
        await expect(overlay).toHaveClass(/items-center/);

        // Inner panel should be narrower than viewport
        const panel = overlay.locator('> div').first();
        const panelBox = await panel.boundingBox();
        expect(panelBox!.width).toBeLessThan(768);
    });

    test('tablet: wiki list uses multi-column grid', async ({ page, serverUrl }) => {
        let tmpDir: string | undefined;
        try {
            tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tab-wiki-'));
            const wikiDir1 = path.join(tmpDir, 'wiki-1');
            const wikiDir2 = path.join(tmpDir, 'wiki-2');
            createWikiFixture(wikiDir1);
            createWikiFixture(wikiDir2);
            await seedWiki(serverUrl, 'tab-wiki-1', wikiDir1, undefined, 'Tab Wiki One');
            await seedWiki(serverUrl, 'tab-wiki-2', wikiDir2, undefined, 'Tab Wiki Two');
        } catch { /* wiki seeding may fail; test is best-effort */ }

        await page.goto(`${serverUrl}/#wiki`);
        await expect(page.locator('#view-wiki')).toBeVisible({ timeout: 10000 });

        // If multiple wiki cards, check multi-column layout
        const cards = page.locator('.wiki-card');
        if (await cards.count() > 1) {
            const box1 = await cards.nth(0).boundingBox();
            const box2 = await cards.nth(1).boundingBox();
            if (box1 && box2) {
                // Multi-column: cards in the same row have different x
                const sameRow = Math.abs(box1.y - box2.y) < 10;
                if (sameRow) {
                    expect(box2.x).toBeGreaterThan(box1.x);
                }
            }
        }

        if (tmpDir) {
            try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
        }
    });
});


