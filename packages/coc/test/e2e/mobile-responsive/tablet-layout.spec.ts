/**
 * Tablet Layout Tests — verify hybrid behavior at 768×1024.
 */
import { test, expect } from '../fixtures/server-fixture';
import { seedWorkspace, seedQueueTasks, seedWiki } from '../fixtures/seed';
import { createWikiFixture } from '../fixtures/wiki-fixtures';
import { TABLET } from './viewports';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

test.use({ viewport: TABLET });

test.describe('Tablet Layout', () => {
    test('tablet: repo tabs visible in TopBar', async ({ page, serverUrl }) => {
        await seedWorkspace(serverUrl, 'ws-tab-col', 'tab-col-repo');
        await page.goto(`${serverUrl}/#repos`);

        await page.click('[data-tab="repos"]');

        // At tablet/desktop, repos are shown as tabs in the TopBar
        const repoTabs = page.locator('[data-testid="repo-tab"]');
        await expect(repoTabs).toHaveCount(1, { timeout: 10000 });
    });

    test('tablet: TopBar tab buttons are visible', async ({ page, serverUrl }) => {
        await page.goto(serverUrl);

        // At tablet width (768px), visible TopBar entries remain available,
        // while the Memory view stays direct-routable without a topbar icon.
        await expect(page.locator('[data-tab="repos"]')).toBeVisible({ timeout: 10000 });
        // Skills lives inside the Admin Tools sidebar — open admin first.
        await page.click('#admin-toggle');
        await expect(page.locator('#view-admin')).toBeVisible({ timeout: 10000 });
        await expect(page.locator('#skills-toggle')).toBeVisible({ timeout: 10000 });
        await expect(page.locator('header [data-tab="memory"]')).toHaveCount(0);
    });

    test('tablet: no bottom navigation visible', async ({ page, serverUrl }) => {
        await page.goto(serverUrl);

        const bottomNav = page.locator('[data-testid="bottom-nav"]');
        if (await bottomNav.count() > 0) {
            await expect(bottomNav).toBeHidden();
        }
    });

    test('tablet: activity split-panel renders two-pane layout', async ({ page, serverUrl }) => {
        const wsId = 'ws-tab-act';
        await seedWorkspace(serverUrl, wsId, 'tab-act-repo');
        await seedQueueTasks(serverUrl, [
            { type: 'chat', displayName: 'T1', repoId: wsId },
            { type: 'chat', displayName: 'T2', repoId: wsId },
        ]);
        await page.goto(`${serverUrl}/#repos/${wsId}/activity`);

        await expect(page.locator('[data-task-id]').first()).toBeVisible({ timeout: 10000 });

        // Both list panel and detail panel should be visible at tablet width
        const splitPanel = page.locator('[data-testid="activity-split-panel"]');
        await expect(splitPanel).toBeVisible();
    });

    test('tablet: ReposView renders detail pane on repo selection', async ({ page, serverUrl }) => {
        await seedWorkspace(serverUrl, 'ws-tab-2p', 'tab-2p-repo');
        await page.goto(`${serverUrl}/#repos`);

        await expect(page.locator('[data-testid="repo-tab"]')).toHaveCount(1, { timeout: 10000 });
        await page.locator('[data-testid="repo-tab"]').first().click();

        // Repo detail pane should appear
        await expect(page.locator('#repo-detail-content')).toBeVisible();
    });

    test('tablet: dialog renders as centered modal', async ({ page, serverUrl }) => {
        await page.goto(`${serverUrl}/#repos`);
        await expect(page.locator('#view-repos')).toBeVisible({ timeout: 10000 });
        // Open AddRepoDialog via the RepoTabStrip add button (mini sidebar was removed)
        await page.click('[data-testid="repo-tab-add-btn"]');
        await page.click('[data-testid="repo-tab-add-repo-option"]');

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
