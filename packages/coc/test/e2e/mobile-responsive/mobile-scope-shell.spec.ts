/**
 * Mobile scope shell at 390×844 — the browser redesign's end-to-end path.
 *
 * Before this, a repo group was unreachable on a phone except by deep link:
 * `ReposContext` filters virtual workspaces out of `repos`, and the mobile grid
 * only read `repos`. And a user who did deep-link into one was stuck, because
 * the group's in-body header had no back affordance.
 *
 * This walks the whole loop: land on `#repos`, see the scope list, open a repo
 * group from it, land on the group's mobile tab bar, and come back.
 */

import { test, expect } from '../fixtures/server-fixture';
import { request, seedWorkspace } from '../fixtures/seed';

/** iPhone 14/15-class viewport — the narrowest shape the redesign targets. */
const PHONE = { width: 390, height: 844 };

const MEMBER_ID = 'ws-scope-shell-member';
const MEMBER_NAME = 'scope-shell-repo';
const GROUP_NAME = 'Mobile Group';

test.use({ viewport: PHONE, hasTouch: true });

/** Seed one member repo plus a group holding it; returns the `group-` id. */
async function seedGroup(serverUrl: string): Promise<string> {
    await seedWorkspace(serverUrl, MEMBER_ID, MEMBER_NAME);
    await request(`${serverUrl}/api/preferences`, {
        method: 'PATCH',
        body: JSON.stringify({
            hasSeenWelcome: true,
            onboardingProgress: { dismissed: true, hasCompletedTour: true },
        }),
    });
    const res = await request(`${serverUrl}/api/repo-groups`, {
        method: 'POST',
        body: JSON.stringify({ name: GROUP_NAME, members: [MEMBER_ID] }),
    });
    if (res.status !== 201) {
        throw new Error(`Failed to create repo group: ${res.status} ${res.body}`);
    }
    return JSON.parse(res.body).workspace.id as string;
}

test.describe('Mobile scope shell (390×844)', () => {
    test('lands on the scope list with the scope bar, not the repo grid', async ({ page, serverUrl }) => {
        await seedGroup(serverUrl);
        await page.goto(`${serverUrl}/#repos`);

        await expect(page.locator('[data-testid="mobile-scope-list"]')).toBeVisible({ timeout: 15_000 });
        await expect(page.locator('[data-testid="mobile-scope-bar"]')).toBeVisible();
        await expect(page.locator('[data-testid="scope-list-footer"]')).toBeVisible();
    });

    test('shows the repo group in the list and opens it', async ({ page, serverUrl }) => {
        const groupId = await seedGroup(serverUrl);
        await page.goto(`${serverUrl}/#repos`);

        const groupRow = page.locator(`[data-testid="repo-group-item"][data-remote-key="${groupId}"]`);
        await expect(groupRow).toBeVisible({ timeout: 15_000 });
        await expect(groupRow).toContainText(GROUP_NAME);

        await groupRow.tap();

        await expect(page.locator('[data-testid="repo-group-view"]')).toBeVisible({ timeout: 15_000 });
        await expect(page.locator('[data-testid="repo-group-mobile-header"]')).toBeVisible();
        expect(page.url()).toContain(encodeURIComponent(groupId));
    });

    test('the group tab bar pins Workspace / Git / Notes and keeps Settings in the more sheet', async ({ page, serverUrl }) => {
        const groupId = await seedGroup(serverUrl);
        await page.goto(`${serverUrl}/#repos/${encodeURIComponent(groupId)}`);

        const bar = page.locator('[data-testid="mobile-tab-bar"]');
        await expect(bar).toBeVisible({ timeout: 15_000 });
        await expect(bar.locator('button[data-tab="chats"]')).toBeVisible();
        await expect(bar.locator('button[data-tab="git"]')).toBeVisible();
        await expect(bar.locator('button[data-tab="notes"]')).toBeVisible();

        await bar.locator('button[data-tab="more"]').tap();
        await expect(page.locator('[data-testid="mobile-tab-more-item-settings"]')).toBeVisible({ timeout: 5000 });
    });

    test('goes back from a group to the scope list', async ({ page, serverUrl }) => {
        const groupId = await seedGroup(serverUrl);
        await page.goto(`${serverUrl}/#repos/${encodeURIComponent(groupId)}`);

        const back = page.locator('[data-testid="repo-group-name-back"]');
        await expect(back).toBeVisible({ timeout: 15_000 });
        await back.tap();

        await expect(page.locator('[data-testid="mobile-scope-list"]')).toBeVisible({ timeout: 15_000 });
        await expect(page.locator('[data-testid="repo-group-view"]')).toHaveCount(0);
    });

    test('opens a repo from the list and comes back', async ({ page, serverUrl }) => {
        await seedGroup(serverUrl);
        await page.goto(`${serverUrl}/#repos`);

        await expect(page.locator('.repo-item').first()).toBeVisible({ timeout: 15_000 });
        await page.locator('.repo-item').first().tap();
        await expect(page.locator('#repo-detail-content')).toBeVisible({ timeout: 15_000 });

        await page.locator('[data-testid="repo-name-back"]').tap();
        await expect(page.locator('[data-testid="mobile-scope-list"]')).toBeVisible({ timeout: 15_000 });
    });

    test('switches scope from the scope bar picker sheet', async ({ page, serverUrl }) => {
        const groupId = await seedGroup(serverUrl);
        await page.goto(`${serverUrl}/#repos`);
        await expect(page.locator('[data-testid="mobile-scope-bar"]')).toBeVisible({ timeout: 15_000 });

        await page.locator('[data-testid="mobile-scope-chip"]').tap();
        const sheet = page.locator('[data-testid="scope-picker-sheet"]');
        await expect(sheet).toBeVisible({ timeout: 5000 });

        await sheet.locator(`[data-testid="repo-group-item"][data-remote-key="${groupId}"]`).tap();
        await expect(page.locator('[data-testid="repo-group-view"]')).toBeVisible({ timeout: 15_000 });
    });
});
