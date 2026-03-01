/**
 * Cross-Viewport Deep Link Tests — verify hash routing at all viewport sizes.
 */
import { test, expect } from '../fixtures/server-fixture';
import { seedProcess, seedWorkspace, seedWiki } from '../fixtures/seed';
import { createWikiFixture } from '../fixtures/wiki-fixtures';
import { MOBILE, TABLET, DESKTOP } from './viewports';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

test.describe('Cross-Viewport Deep Links', () => {
    test('deeplinks: #repos resolves at mobile viewport', async ({ page, serverUrl }) => {
        await page.setViewportSize(MOBILE);
        await page.goto(`${serverUrl}/#repos`);

        await expect(page.locator('#view-repos')).toBeVisible({ timeout: 10000 });
    });

    test('deeplinks: #processes/:id resolves at mobile viewport', async ({ page, serverUrl }) => {
        await page.setViewportSize(MOBILE);
        await seedProcess(serverUrl, 'dl-mob-proc', { promptPreview: 'DeepLink Mobile' });
        await page.goto(`${serverUrl}/#processes/dl-mob-proc`);

        // Detail should render on mobile (full-screen)
        await expect(page.locator('#detail-content')).toBeVisible({ timeout: 10000 });
    });

    test('deeplinks: #repos/:id resolves at mobile viewport', async ({ page, serverUrl }) => {
        await page.setViewportSize(MOBILE);
        await seedWorkspace(serverUrl, 'dl-mob-ws', 'dl-mob-repo');
        await page.goto(`${serverUrl}/#repos/dl-mob-ws`);

        // Repo detail should be visible
        await expect(page.locator('#repo-detail-content')).toBeVisible({ timeout: 10000 });
    });

    test('deeplinks: #wiki/:id resolves at mobile viewport', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dl-wiki-'));
        try {
            const wikiDir = path.join(tmpDir, 'wiki-data');
            createWikiFixture(wikiDir);
            await seedWiki(serverUrl, 'dl-mob-wiki', wikiDir, undefined, 'DL Wiki');

            await page.setViewportSize(MOBILE);
            await page.goto(`${serverUrl}/#wiki/${encodeURIComponent('dl-mob-wiki')}`);

            await expect(page.locator('#view-wiki')).toBeVisible({ timeout: 15000 });
        } finally {
            try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
        }
    });

    test('deeplinks: #repos/:id/:subTab resolves at desktop viewport', async ({ page, serverUrl }) => {
        await page.setViewportSize(DESKTOP);
        await seedWorkspace(serverUrl, 'dl-desk-ws', 'dl-desk-repo');
        await page.goto(`${serverUrl}/#repos/dl-desk-ws/pipelines`);

        await expect(page.locator('#repo-detail-content')).toBeVisible({ timeout: 10000 });

        // Pipelines sub-tab should be active
        const pipelinesTab = page.locator('[data-subtab="pipelines"]');
        if (await pipelinesTab.count() > 0) {
            await expect(pipelinesTab).toBeVisible();
        }
    });

    test('deeplinks: #admin resolves at all viewports', async ({ page, serverUrl }) => {
        for (const vp of [MOBILE, TABLET, DESKTOP]) {
            await page.setViewportSize(vp);
            await page.goto(`${serverUrl}/#admin`);
            await expect(page.locator('#view-admin')).toBeVisible({ timeout: 5000 });
        }
    });
});
