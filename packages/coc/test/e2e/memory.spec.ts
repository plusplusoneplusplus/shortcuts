/**
 * Memory V2 E2E Tests
 *
 * Tests the #memory route after legacy memory panels were removed. The route
 * renders MemoryV2Panel only, with Facts, Review, and Episodes tabs.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createMemoryStores, WORKSPACE_MEMORY_SUBDIR, type MemoryEpisode, type MemoryFact, type MemoryFactStatus } from '@plusplusoneplusplus/coc-memory';
import { test, expect, type Page, safeRmSync } from './fixtures/server-fixture';
import { seedWorkspace } from './fixtures/seed';
import { createRepoFixture } from './fixtures/repo-fixtures';

const WS_ID = 'memory-v2-ws';

interface WorkspaceFixture {
    tmpDir: string;
    wsId: string;
}

async function setupWorkspace(serverUrl: string): Promise<WorkspaceFixture> {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'memory-v2-e2e-'));
    const repoDir = createRepoFixture(tmpDir);
    await seedWorkspace(serverUrl, WS_ID, 'memory-v2-repo', repoDir);
    return { tmpDir, wsId: WS_ID };
}

async function enableMemoryV2(
    page: Page,
    serverUrl: string,
    wsId: string,
    options: { isolated?: boolean } = {},
): Promise<void> {
    const response = await page.request.patch(`${serverUrl}/api/workspaces/${encodeURIComponent(wsId)}/preferences`, {
        data: {
            memoryV2: {
                enabled: true,
                isolated: options.isolated === true,
            },
        },
    });
    expect(response.ok()).toBe(true);
}

async function openMemoryForWorkspace(page: Page, serverUrl: string, wsId: string, tab: 'facts' | 'review' | 'episodes' | 'settings' = 'facts'): Promise<void> {
    await page.goto(`${serverUrl}/#repos/${encodeURIComponent(wsId)}`);
    await expect(page.locator('#repo-detail-content')).toBeVisible({ timeout: 10_000 });

    await page.evaluate(() => { window.location.hash = '#memory'; });
    await expect(page.locator('#view-memory')).toBeVisible({ timeout: 10_000 });

    const scopeRow = page.locator(`[data-testid="scope-row"][data-scope-id="workspace:${wsId}"]`);
    await expect(scopeRow).toBeVisible({ timeout: 10_000 });
    await scopeRow.click();

    if (tab !== 'facts') {
        await page.locator(`button[data-tab="${tab}"]`).click();
    }
}

function getWorkspaceStoreDir(dataDir: string, wsId: string): string {
    return path.join(dataDir, 'repos', wsId, WORKSPACE_MEMORY_SUBDIR);
}

async function seedFact(
    dataDir: string,
    wsId: string,
    content: string,
    overrides: Partial<Pick<MemoryFact, 'status' | 'tags' | 'source' | 'sourceProcessId' | 'importance' | 'confidence'>> = {},
): Promise<MemoryFact> {
    const handle = createMemoryStores(getWorkspaceStoreDir(dataDir, wsId));
    try {
        return await handle.facts.addFact({
            scope: 'workspace',
            workspaceId: wsId,
            content,
            importance: overrides.importance ?? 0.75,
            confidence: overrides.confidence ?? 0.95,
            status: overrides.status ?? 'active',
            tags: overrides.tags ?? ['e2e'],
            source: overrides.source ?? 'explicit',
            sourceProcessId: overrides.sourceProcessId,
        });
    } finally {
        handle.close();
    }
}

async function seedReviewFact(dataDir: string, wsId: string, content: string): Promise<MemoryFact> {
    return seedFact(dataDir, wsId, content, {
        status: 'review' as MemoryFactStatus,
        source: 'auto-extracted',
        confidence: 0.35,
        tags: ['review'],
    });
}

async function seedEpisode(dataDir: string, wsId: string, summary: string): Promise<MemoryEpisode> {
    const handle = createMemoryStores(getWorkspaceStoreDir(dataDir, wsId));
    try {
        return await handle.episodes.addEpisode({
            scope: 'workspace',
            workspaceId: wsId,
            processId: 'proc-episode-123456',
            turnIndex: 1,
            summary,
            eventType: 'chat-turn',
            provenance: { createdBy: 'ai', version: 1 },
        });
    } finally {
        handle.close();
    }
}

test.describe('Memory V2 route', () => {
    test('shows the global disabled state without legacy sub-tabs', async ({ page, serverUrl }) => {
        await page.goto(`${serverUrl}/#memory`);

        await expect(page.locator('#view-memory')).toBeVisible({ timeout: 10_000 });
        await expect(page.locator('[data-testid="scope-row"][data-scope-id="global"]')).toBeVisible({ timeout: 10_000 });
        await expect(page.locator('[data-testid="scope-disabled"]')).toContainText('Global');
        await expect(page.locator('[data-testid="enable-scope-btn"]')).toBeVisible();
        await expect(page.locator('[data-subtab="bounded"]')).toHaveCount(0);
        await expect(page.locator('[data-subtab="config"]')).toHaveCount(0);
        await expect(page.locator('[data-subtab="files"]')).toHaveCount(0);
    });

    test('shows disabled state and enables Memory V2 for the selected workspace', async ({ page, serverUrl }) => {
        const workspace = await setupWorkspace(serverUrl);
        try {
            await openMemoryForWorkspace(page, serverUrl, workspace.wsId);

            await expect(page.locator('[data-testid="scope-disabled"]')).toBeVisible({ timeout: 10_000 });
            await page.locator('[data-testid="enable-scope-btn"]').click();
            await expect(page.locator('[data-testid="memory-v2-panel"]')).toBeVisible({ timeout: 10_000 });
            await expect(page.locator('button[data-tab="facts"]')).toBeVisible({ timeout: 5_000 });

            const prefsResponse = await page.request.get(`${serverUrl}/api/workspaces/${workspace.wsId}/preferences`);
            const prefs = await prefsResponse.json();
            expect(prefs.memoryV2?.enabled).toBe(true);
        } finally {
            safeRmSync(workspace.tmpDir);
        }
    });

    test('supports facts list, search, create, edit, delete, and provenance navigation', async ({ page, serverUrl, dataDir }) => {
        const workspace = await setupWorkspace(serverUrl);
        try {
            await enableMemoryV2(page, serverUrl, workspace.wsId);
            await seedFact(dataDir, workspace.wsId, 'Searchable memory detail from a source process', {
                sourceProcessId: 'proc-facts-123456',
                tags: ['searchable'],
            });
            await seedFact(dataDir, workspace.wsId, 'Secondary memory detail for browse mode', { tags: ['secondary'] });

            await openMemoryForWorkspace(page, serverUrl, workspace.wsId);
            await expect(page.locator('[data-testid="memory-v2-panel"]')).toBeVisible({ timeout: 10_000 });
            await expect(page.getByText('Searchable memory detail from a source process')).toBeVisible();
            await expect(page.getByText('Secondary memory detail for browse mode')).toBeVisible();

            await page.locator('[data-testid="facts-search"]').fill('Searchable');
            await expect(page.getByText('Searchable memory detail from a source process')).toBeVisible({ timeout: 5_000 });
            await expect(page.getByText('Secondary memory detail for browse mode')).toHaveCount(0);

            await page.locator('[data-testid="facts-search"]').fill('');
            await page.locator('[data-testid="facts-refresh-btn"]').click();
            await expect(page.getByText('Secondary memory detail for browse mode')).toBeVisible({ timeout: 5_000 });

            await page.locator('[data-testid="add-fact-btn"]').click();
            await page.locator('[data-testid="add-fact-content"]').fill('User-created Memory V2 fact');
            await page.locator('[data-testid="add-fact-tags"]').fill('created, e2e');
            await page.locator('[data-testid="add-fact-submit"]').click();
            await expect(page.getByText('User-created Memory V2 fact')).toBeVisible({ timeout: 5_000 });

            const createdCard = page.locator('[data-testid="fact-card"]').filter({ hasText: 'User-created Memory V2 fact' });
            await createdCard.locator('[data-testid="fact-edit-btn"]').click();
            await page.locator('[data-testid="edit-content"]').fill('Edited Memory V2 fact');
            await page.locator('[data-testid="edit-tags"]').fill('edited, e2e');
            await page.locator('[data-testid="edit-save-btn"]').click();
            await expect(page.getByText('Edited Memory V2 fact')).toBeVisible({ timeout: 5_000 });

            const editedCard = page.locator('[data-testid="fact-card"]').filter({ hasText: 'Edited Memory V2 fact' });
            await editedCard.locator('[data-testid="fact-delete-btn"]').click();
            await page.locator('[data-testid="confirm-delete-btn"]').click();
            await expect(page.getByText('Edited Memory V2 fact')).toHaveCount(0);

            await page.locator('[data-testid="fact-card"]')
                .filter({ hasText: 'Searchable memory detail from a source process' })
                .locator('[data-testid="fact-process-link"]')
                .scrollIntoViewIfNeeded();
            await expect(page.locator('[data-testid="fact-card"]')
                .filter({ hasText: 'Searchable memory detail from a source process' })
                .locator('[data-testid="fact-process-link"]')).toHaveText('proc:proc-fac');
        } finally {
            safeRmSync(workspace.tmpDir);
        }
    });

    test('supports review badge, approve, reject, and edit-and-approve actions', async ({ page, serverUrl, dataDir }) => {
        const workspace = await setupWorkspace(serverUrl);
        try {
            await enableMemoryV2(page, serverUrl, workspace.wsId);
            await seedReviewFact(dataDir, workspace.wsId, 'Review fact to approve');
            await seedReviewFact(dataDir, workspace.wsId, 'Review fact to reject');
            await seedReviewFact(dataDir, workspace.wsId, 'Review fact to edit before approval');

            await openMemoryForWorkspace(page, serverUrl, workspace.wsId, 'review');
            await expect(page.locator('[data-testid="memory-v2-panel"]')).toBeVisible({ timeout: 10_000 });
            await expect(page.locator('button[data-tab="review"] span')).toHaveText('3', { timeout: 5_000 });
            await expect(page.locator('[data-testid="review-item"]')).toHaveCount(3);

            await page.locator('[data-testid="review-item"]')
                .filter({ hasText: 'Review fact to approve' })
                .locator('[data-testid="review-approve-btn"]')
                .click();
            await expect(page.getByText('Review fact to approve')).toHaveCount(0);

            await page.locator('[data-testid="review-item"]')
                .filter({ hasText: 'Review fact to reject' })
                .locator('[data-testid="review-reject-btn"]')
                .click();
            await expect(page.getByText('Review fact to reject')).toHaveCount(0);

            const editItem = page.locator('[data-testid="review-item"]').filter({ hasText: 'Review fact to edit before approval' });
            await editItem.locator('[data-testid="review-edit-btn"]').click();
            await page.locator('[data-testid="review-edit-content"]').fill('Edited review fact approved');
            await page.locator('[data-testid="review-edit-approve-btn"]').click();
            await expect(page.getByText('Review fact to edit before approval')).toHaveCount(0);
            await expect(page.locator('[data-testid="review-empty"]')).toBeVisible({ timeout: 5_000 });
        } finally {
            safeRmSync(workspace.tmpDir);
        }
    });

    test('supports episodes tab deep-link and process navigation', async ({ page, serverUrl, dataDir }) => {
        const workspace = await setupWorkspace(serverUrl);
        try {
            await enableMemoryV2(page, serverUrl, workspace.wsId);
            await seedEpisode(dataDir, workspace.wsId, 'Episode summary from a completed chat turn');

            await openMemoryForWorkspace(page, serverUrl, workspace.wsId, 'episodes');
            await expect(page.locator('[data-testid="episode-row"]')).toHaveCount(1, { timeout: 10_000 });
            await expect(page.getByText('Episode summary from a completed chat turn')).toBeVisible();
            await expect(page.locator('[data-testid="episode-process-link"]')).toHaveText('proc:proc-epi');
        } finally {
            safeRmSync(workspace.tmpDir);
        }
    });

    test('settings tab toggles workspace memory enablement', async ({ page, serverUrl }) => {
        const workspace = await setupWorkspace(serverUrl);
        try {
            await enableMemoryV2(page, serverUrl, workspace.wsId, { isolated: false });
            await openMemoryForWorkspace(page, serverUrl, workspace.wsId, 'settings');

            await expect(page.locator('[data-testid="memory-settings-tab"]')).toBeVisible({ timeout: 5_000 });
            await expect(page.locator('[data-testid="toggle-enabled-btn"]')).toHaveText('Disable');
            await page.locator('[data-testid="toggle-enabled-btn"]').click();
            await expect(page.locator('[data-testid="scope-disabled"]')).toBeVisible({ timeout: 5_000 });

            const prefsResponse = await page.request.get(`${serverUrl}/api/workspaces/${workspace.wsId}/preferences`);
            const prefs = await prefsResponse.json();
            expect(prefs.memoryV2?.enabled).toBe(false);
        } finally {
            safeRmSync(workspace.tmpDir);
        }
    });

    test('exports JSON and supports wipe cancel and confirm flows', async ({ page, serverUrl, dataDir }) => {
        const workspace = await setupWorkspace(serverUrl);
        try {
            await enableMemoryV2(page, serverUrl, workspace.wsId);
            await seedFact(dataDir, workspace.wsId, 'Fact exported and then wiped', { tags: ['export'] });

            await openMemoryForWorkspace(page, serverUrl, workspace.wsId);
            await expect(page.getByText('Fact exported and then wiped')).toBeVisible({ timeout: 10_000 });

            await page.locator('button[data-tab="settings"]').click();
            const downloadPromise = page.waitForEvent('download');
            await page.locator('[data-testid="export-btn"]').click();
            const download = await downloadPromise;
            expect(download.suggestedFilename()).toMatch(/^coc-memory-memory-v2-ws-\d{4}-\d{2}-\d{2}\.json$/);
            const exportPath = path.join(workspace.tmpDir, 'memory-export.json');
            await download.saveAs(exportPath);
            const exported = JSON.parse(fs.readFileSync(exportPath, 'utf8'));
            expect(exported.facts.some((fact: MemoryFact) => fact.content === 'Fact exported and then wiped')).toBe(true);

            await page.locator('[data-testid="wipe-btn"]').click();
            await page.locator('[data-testid="wipe-dialog-overlay"]').getByText('Cancel').click();
            await expect(page.locator('[data-testid="wipe-dialog-overlay"]')).toHaveCount(0);
            await page.locator('button[data-tab="facts"]').click();
            await expect(page.getByText('Fact exported and then wiped')).toBeVisible();

            await page.locator('button[data-tab="settings"]').click();
            await page.locator('[data-testid="wipe-btn"]').click();
            await page.locator('[data-testid="wipe-confirm-btn"]').click();
            await page.locator('button[data-tab="facts"]').click();
            await expect(page.locator('[data-testid="facts-empty"]')).toBeVisible({ timeout: 10_000 });
        } finally {
            safeRmSync(workspace.tmpDir);
        }
    });
});
