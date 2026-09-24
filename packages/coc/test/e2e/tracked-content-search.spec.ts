/**
 * Ctrl/Cmd+Shift+F tracked-content search from ordinary repository and
 * repository-group sub-tabs.
 *
 * These flows use real Git repositories and the real search endpoints. They
 * cover the page-level shortcut mount, group aggregation, and the owner-routed
 * handoff into the unified right panel.
 */

import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { Page } from '@playwright/test';
import { test, expect, safeRmSync } from './fixtures/server-fixture';
import { createMultiCommitRepo } from './fixtures/git-fixtures';
import { request, seedWorkspace } from './fixtures/seed';

const REPO_ID = 'ws-tracked-search-repo';
const MEMBER_A = 'ws-tracked-search-a';
const MEMBER_B = 'ws-tracked-search-b';
const MEMBER_A_LABEL = 'tracked-search-alpha';
const MEMBER_B_LABEL = 'tracked-search-beta';
const SEARCH_TOKEN = 'RalphTrackedSearchNeedle';
const TARGET_PATH = 'src/tracked-search-target.ts';
const TARGET_LINE = 4;

function addTrackedSearchFile(repoDir: string, marker: string): void {
    fs.writeFileSync(
        path.join(repoDir, TARGET_PATH),
        [
            `// ${marker}`,
            'export const before = 1;',
            '',
            `export const ${marker} = '${SEARCH_TOKEN}';`,
            'export const after = 2;',
            '',
        ].join('\n'),
    );
    execFileSync('git', ['add', TARGET_PATH], { cwd: repoDir, stdio: 'ignore' });
    execFileSync('git', ['commit', '-m', `test: add ${marker} search fixture`], {
        cwd: repoDir,
        stdio: 'ignore',
    });
}

async function enableTrackedSearchShell(serverUrl: string): Promise<void> {
    const response = await request(`${serverUrl}/api/admin/config`, {
        method: 'PUT',
        body: JSON.stringify({ 'features.splitWorkspacePanel': true }),
    });
    if (response.status !== 200) {
        throw new Error(`Failed to enable splitWorkspacePanel: ${response.status} ${response.body}`);
    }
}

async function pressContentSearchShortcut(page: Page): Promise<void> {
    await page.keyboard.press('Control+Shift+f');
    await expect(page.getByTestId('content-search-overlay')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('content-search-overlay-query')).toBeFocused();
}

test.describe('Tracked content search overlay', () => {
    test('opens from a repository Git sub-tab', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-tracked-search-repo-'));
        try {
            const repoDir = createMultiCommitRepo(tmpDir);
            await seedWorkspace(serverUrl, REPO_ID, 'tracked-search-repo', repoDir);

            await page.goto(`${serverUrl}/#repos/${REPO_ID}/git`);
            await expect(page.getByTestId('repo-git-tab')).toBeVisible({ timeout: 20_000 });

            await pressContentSearchShortcut(page);
            await expect(page.getByRole('dialog', { name: 'Search repository' })).toHaveCount(1);
        } finally {
            safeRmSync(tmpDir);
        }
    });

    test('searches both group members and navigates an already-open owner file to its matching line', async ({
        page,
        serverUrl,
    }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-tracked-search-group-'));
        try {
            const repoA = createMultiCommitRepo(path.join(tmpDir, 'a'));
            const repoB = createMultiCommitRepo(path.join(tmpDir, 'b'));
            addTrackedSearchFile(repoA, 'alphaMarker');
            addTrackedSearchFile(repoB, 'betaMarker');

            await enableTrackedSearchShell(serverUrl);
            await seedWorkspace(serverUrl, MEMBER_A, MEMBER_A_LABEL, repoA);
            await seedWorkspace(serverUrl, MEMBER_B, MEMBER_B_LABEL, repoB);
            const response = await request(`${serverUrl}/api/repo-groups`, {
                method: 'POST',
                body: JSON.stringify({
                    name: 'Tracked Search Group',
                    members: [MEMBER_A, MEMBER_B],
                }),
            });
            if (response.status !== 201) {
                throw new Error(`Failed to create repo group: ${response.status} ${response.body}`);
            }
            const groupId = JSON.parse(response.body).workspace.id as string;

            await page.goto(`${serverUrl}/#repos/${groupId}/git`);
            await expect(page.getByTestId('repo-group-git-tab')).toBeVisible({ timeout: 20_000 });

            await page.keyboard.press('Control+p');
            const quickOpen = page.getByTestId('quick-open-dialog');
            await expect(quickOpen).toBeVisible({ timeout: 10_000 });
            await page.getByTestId('quick-open-input').fill(TARGET_PATH);
            const betaFile = page.getByRole('option', {
                name: `tracked-search-target.ts, src, ${MEMBER_B_LABEL}`,
            });
            await expect(betaFile).toBeVisible({ timeout: 15_000 });
            await betaFile.click();
            await expect(quickOpen).toHaveCount(0, { timeout: 10_000 });
            const openEditor = page
                .getByTestId('unified-right-panel')
                .locator('[data-testid="monaco-container"] .monaco-editor')
                .first();
            await expect(openEditor).toBeVisible({ timeout: 20_000 });
            await expect(openEditor.locator('.line-numbers.active-line-number')).toHaveText('1');

            await pressContentSearchShortcut(page);

            const query = page.getByTestId('content-search-overlay-query');
            await query.fill(SEARCH_TOKEN);
            await query.press('Enter');

            await expect(page.getByTestId(`content-search-overlay-repo-${MEMBER_A}`)).toContainText(
                MEMBER_A_LABEL,
                { timeout: 20_000 },
            );
            await expect(page.getByTestId(`content-search-overlay-repo-${MEMBER_B}`)).toContainText(
                MEMBER_B_LABEL,
            );

            const betaMatch = page
                .locator('[data-testid^="content-search-overlay-match-"]')
                .filter({ hasText: 'betaMarker' });
            await expect(betaMatch).toHaveCount(1);
            const groupUrl = page.url();
            await betaMatch.click();

            await expect(page.getByTestId('content-search-overlay')).toHaveCount(0, { timeout: 15_000 });
            await expect(page).toHaveURL(groupUrl);
            await expect(page.getByTestId('repo-group-view')).toHaveAttribute('data-workspace', groupId);

            const panel = page.getByTestId('unified-right-panel');
            await expect(panel).toHaveAttribute('data-open', 'true', { timeout: 15_000 });
            await expect(panel.getByTestId('unified-panel-toolbar-repo')).toHaveText(MEMBER_B_LABEL);
            await expect(panel.getByTestId('unified-panel-toolbar')).toContainText('tracked-search-target.ts');

            const editor = panel.locator('[data-testid="monaco-container"] .monaco-editor').first();
            await expect(editor).toBeVisible({ timeout: 20_000 });
            await expect(editor.locator('.view-lines')).toContainText('betaMarker', { timeout: 20_000 });
            await expect(editor.locator('.line-numbers.active-line-number')).toHaveText(
                String(TARGET_LINE),
                { timeout: 20_000 },
            );
        } finally {
            safeRmSync(tmpDir);
        }
    });
});
