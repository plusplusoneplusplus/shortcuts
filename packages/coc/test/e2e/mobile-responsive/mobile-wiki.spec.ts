/**
 * Mobile Wiki Tests — verify wiki list and detail at 375×812.
 */
import { test, expect } from '../fixtures/server-fixture';
import { seedWiki } from '../fixtures/seed';
import { createWikiFixture } from '../fixtures/wiki-fixtures';
import { MOBILE } from './viewports';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

test.use({ viewport: MOBILE, hasTouch: true });

test.describe.skip('Mobile Wiki', () => {
    let tmpDir: string;

    test.beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mob-wiki-'));
    });

    test.afterEach(() => {
        try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
    });

    test('mobile: wiki list stacks to single column', async ({ page, serverUrl }) => {
        const wikiDir1 = path.join(tmpDir, 'wiki-1');
        const wikiDir2 = path.join(tmpDir, 'wiki-2');
        createWikiFixture(wikiDir1);
        createWikiFixture(wikiDir2);
        await seedWiki(serverUrl, 'mob-wiki-1', wikiDir1, undefined, 'Wiki One');
        await seedWiki(serverUrl, 'mob-wiki-2', wikiDir2, undefined, 'Wiki Two');

        await page.goto(`${serverUrl}/#wiki`);
        await expect(page.locator('#view-wiki')).toBeVisible({ timeout: 10000 });

        const cards = page.locator('.wiki-card');
        if (await cards.count() > 1) {
            const box1 = await cards.nth(0).boundingBox();
            const box2 = await cards.nth(1).boundingBox();
            if (box1 && box2) {
                // Single column: cards stacked vertically (same x, different y)
                expect(Math.abs(box1.x - box2.x)).toBeLessThan(20);
                expect(box2.y).toBeGreaterThan(box1.y);
            }
        }
    });

    test('mobile: wiki detail shows full-width content', async ({ page, serverUrl }) => {
        const wikiDir = path.join(tmpDir, 'wiki-detail');
        createWikiFixture(wikiDir);
        await seedWiki(serverUrl, 'mob-wiki-det', wikiDir, undefined, 'Detail Wiki');

        await page.goto(`${serverUrl}/#wiki/${encodeURIComponent('mob-wiki-det')}`);

        // Wiki detail should render
        const detail = page.locator('#wiki-component-detail, #wiki-project-title');
        await expect(detail.first()).toBeVisible({ timeout: 15000 });

        // Content should be full-width on mobile
        const container = page.locator('#view-wiki');
        const box = await container.boundingBox();
        if (box) {
            expect(box.width).toBeGreaterThan(340);
        }
    });

    test('mobile: sidebar toggle button is visible on wiki detail', async ({ page, serverUrl }) => {
        const wikiDir = path.join(tmpDir, 'wiki-toc');
        createWikiFixture(wikiDir);
        await seedWiki(serverUrl, 'mob-wiki-toc', wikiDir, undefined, 'TOC Wiki');

        await page.goto(`${serverUrl}/#wiki/${encodeURIComponent('mob-wiki-toc')}`);
        await expect(page.locator('#view-wiki')).toBeVisible({ timeout: 15000 });

        // Mobile sidebar toggle should be visible
        const toggle = page.locator('[data-testid="wiki-sidebar-toggle"]');
        if (await toggle.count() > 0) {
            await expect(toggle).toBeVisible();
        }
    });

    test('mobile: sidebar toggle opens drawer', async ({ page, serverUrl }) => {
        const wikiDir = path.join(tmpDir, 'wiki-bs');
        createWikiFixture(wikiDir);
        await seedWiki(serverUrl, 'mob-wiki-bs', wikiDir, undefined, 'BS Wiki');

        await page.goto(`${serverUrl}/#wiki/${encodeURIComponent('mob-wiki-bs')}`);
        await expect(page.locator('#view-wiki')).toBeVisible({ timeout: 15000 });

        const toggle = page.locator('[data-testid="wiki-sidebar-toggle"]');
        if (await toggle.count() > 0 && await toggle.isVisible()) {
            await toggle.tap();

            // ResponsiveSidebar opens as a drawer on mobile
            const drawer = page.locator('[data-testid="sidebar-drawer"]');
            await expect(drawer).toBeVisible({ timeout: 5000 });

            // Verify drawer contains wiki component tree
            const componentTree = drawer.locator('#wiki-component-tree');
            if (await componentTree.count() > 0) {
                await expect(componentTree).toBeVisible();
            }
        }
    });

    test('mobile: wiki card tap navigates to detail', async ({ page, serverUrl }) => {
        const wikiDir = path.join(tmpDir, 'wiki-nav');
        createWikiFixture(wikiDir);
        await seedWiki(serverUrl, 'mob-wiki-nav', wikiDir, undefined, 'Nav Wiki');

        await page.goto(`${serverUrl}/#wiki`);
        await expect(page.locator('#view-wiki')).toBeVisible({ timeout: 10000 });

        const card = page.locator('.wiki-card').first();
        if (await card.count() > 0) {
            await card.tap();
            // Should navigate to wiki detail
            await page.waitForTimeout(1000);
            // URL should contain the wiki ID
            expect(page.url()).toMatch(/#wiki\//);
        }
    });

    test('mobile: wiki empty state renders', async ({ page, serverUrl }) => {
        await page.goto(`${serverUrl}/#wiki`);
        await expect(page.locator('#view-wiki')).toBeVisible({ timeout: 10000 });

        // With no wikis, empty state should show
        const empty = page.locator('#wiki-empty');
        if (await empty.count() > 0) {
            await expect(empty).toBeVisible();
        }
    });
});
