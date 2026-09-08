/**
 * A repo group's Git tab, end to end in a real browser against a real server.
 *
 * The regression this guards: clicking a commit inside a group's Git tab used
 * to write `#repos/<memberId>/git/<sha>`, which navigated the whole dashboard
 * out of the group and into the member repository. The group is the page; the
 * member is only the git data source, so the URL has to name both:
 *
 *   #repos/<groupId>/git/member/<memberId>[/<sha>[/<file>]]
 *
 * Everything here goes through the real rendered commit row, RepoGitTab,
 * AppContext and Router — nothing is stubbed — so the click, the URL it writes
 * and the view it leaves behind are all exercised together.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { test, expect, safeRmSync } from './fixtures/server-fixture';
import { createMultiCommitRepo } from './fixtures/git-fixtures';
import { seedWorkspace, request } from './fixtures/seed';
import type { Page } from '@playwright/test';

const MEMBER_A = 'group-git-nav-a';
const MEMBER_B = 'group-git-nav-b';
const GROUP_NAME = 'E2E Git Nav Group';

/** Dismiss the onboarding welcome modal so it doesn't swallow clicks. */
async function dismissOnboarding(serverUrl: string): Promise<void> {
    await request(`${serverUrl}/api/preferences`, {
        method: 'PATCH',
        body: JSON.stringify({
            hasSeenWelcome: true,
            onboardingProgress: { dismissed: true, hasCompletedTour: true },
        }),
    });
}

/**
 * Two real git repos with distinct histories, registered as workspaces and
 * bundled into one group. Returns the `group-` workspace id the server minted.
 */
async function seedGroupWithTwoRepos(serverUrl: string, tmpDir: string): Promise<string> {
    const repoA = createMultiCommitRepo(path.join(tmpDir, 'a'));
    const repoB = createMultiCommitRepo(path.join(tmpDir, 'b'));
    await seedWorkspace(serverUrl, MEMBER_A, 'group-git-nav-repo-a', repoA);
    await seedWorkspace(serverUrl, MEMBER_B, 'group-git-nav-repo-b', repoB);
    await dismissOnboarding(serverUrl);

    const res = await request(`${serverUrl}/api/repo-groups`, {
        method: 'POST',
        body: JSON.stringify({ name: GROUP_NAME, members: [MEMBER_A, MEMBER_B] }),
    });
    if (res.status !== 201) {
        throw new Error(`Failed to create repo group: ${res.status} ${res.body}`);
    }
    return JSON.parse(res.body).workspace.id as string;
}

/** Open the group's Git tab and wait for a member's commit list to render. */
async function openGroupGit(page: Page, serverUrl: string, groupId: string, suffix = ''): Promise<void> {
    await page.goto(`${serverUrl}/#repos/${encodeURIComponent(groupId)}/git${suffix}`);
    await expect(page.getByTestId('repo-group-git-tab')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('commit-list-loading')).toBeHidden({ timeout: 20_000 });
}

/** The member the hosted panel is currently showing. */
function hostedMember(page: Page) {
    return page.getByTestId('repo-group-git-tab');
}

async function pickMember(page: Page, memberId: string): Promise<void> {
    await page.getByRole('combobox', { name: 'Member repository' }).selectOption(memberId);
    await expect(hostedMember(page)).toHaveAttribute('data-member', memberId, { timeout: 20_000 });
    await expect(page.getByTestId('commit-list-loading')).toBeHidden({ timeout: 20_000 });
}

/** Click the newest commit row and return its short hash. */
async function openNewestCommit(page: Page): Promise<string> {
    const firstRow = page.locator('[data-testid^="commit-row-"]').first();
    await expect(firstRow).toBeVisible({ timeout: 20_000 });
    const shortHash = (await firstRow.getAttribute('data-testid'))!.replace('commit-row-', '');
    await firstRow.click();
    await expect(page.getByTestId('commit-detail')).toBeVisible({ timeout: 20_000 });
    return shortHash;
}

test.describe('Repo group Git navigation', () => {
    test('opening a member commit keeps the group selected and names the member in the URL', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-group-git-'));
        try {
            const groupId = await seedGroupWithTwoRepos(serverUrl, tmpDir);
            await openGroupGit(page, serverUrl, groupId);

            // A bare group entry canonicalizes to an explicit member route.
            await expect(page).toHaveURL(new RegExp(`#repos/${groupId}/git/member/(${MEMBER_A}|${MEMBER_B})$`));

            await pickMember(page, MEMBER_B);
            await expect(page).toHaveURL(`${serverUrl}/#repos/${groupId}/git/member/${MEMBER_B}`);

            const shortHash = await openNewestCommit(page);

            // THE REGRESSION: the group is still the page…
            await expect(page.getByTestId('repo-group-view')).toBeVisible();
            await expect(page.getByTestId('repo-group-view')).toHaveAttribute('data-workspace', groupId);
            await expect(hostedMember(page)).toHaveAttribute('data-member', MEMBER_B);
            // …and the URL carries the group, the member AND the commit.
            await expect(page).toHaveURL(new RegExp(`#repos/${groupId}/git/member/${MEMBER_B}/${shortHash}`));
        } finally {
            safeRmSync(tmpDir);
        }
    });

    test('a commit file keeps the group, the member and the file in the URL', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-group-git-file-'));
        try {
            const groupId = await seedGroupWithTwoRepos(serverUrl, tmpDir);
            await openGroupGit(page, serverUrl, groupId);
            await pickMember(page, MEMBER_B);
            const shortHash = await openNewestCommit(page);

            await expect(page.getByTestId(`commit-files-${shortHash}`)).toBeVisible({ timeout: 20_000 });
            await expect(page.getByTestId('commit-files-loading')).toBeHidden({ timeout: 20_000 });
            await page.locator('[data-testid^="commit-file-"]').first().click();

            await expect(page.getByTestId('file-diff-header')).toBeVisible({ timeout: 20_000 });
            await expect(page.getByTestId('repo-group-view')).toHaveAttribute('data-workspace', groupId);
            await expect(page).toHaveURL(
                new RegExp(`#repos/${groupId}/git/member/${MEMBER_B}/${shortHash}[^/]*/[^/]+$`),
            );
        } finally {
            safeRmSync(tmpDir);
        }
    });

    test('Back and Forward move between members without leaving the group', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-group-git-history-'));
        try {
            const groupId = await seedGroupWithTwoRepos(serverUrl, tmpDir);
            await openGroupGit(page, serverUrl, groupId);

            await pickMember(page, MEMBER_A);
            const hashA = await openNewestCommit(page);

            await pickMember(page, MEMBER_B);
            const hashB = await openNewestCommit(page);
            expect(hashB).not.toBe('');

            // Back through B's history, then back to A's commit.
            await page.goBack();
            await expect(page).toHaveURL(`${serverUrl}/#repos/${groupId}/git/member/${MEMBER_B}`);
            await page.goBack();
            await expect(page).toHaveURL(new RegExp(`#repos/${groupId}/git/member/${MEMBER_A}/${hashA}`));
            await expect(hostedMember(page)).toHaveAttribute('data-member', MEMBER_A, { timeout: 20_000 });
            await expect(page.getByTestId('commit-detail')).toBeVisible({ timeout: 20_000 });
            await expect(page.getByTestId('repo-group-view')).toHaveAttribute('data-workspace', groupId);

            await page.goForward();
            await expect(page).toHaveURL(`${serverUrl}/#repos/${groupId}/git/member/${MEMBER_B}`);
            await expect(hostedMember(page)).toHaveAttribute('data-member', MEMBER_B, { timeout: 20_000 });
        } finally {
            safeRmSync(tmpDir);
        }
    });

    test('a fresh context restores the member and commit straight from the URL', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-group-git-fresh-'));
        try {
            const groupId = await seedGroupWithTwoRepos(serverUrl, tmpDir);

            // Learn a real SHA from member B without ever saving a preference.
            await openGroupGit(page, serverUrl, groupId, `/member/${MEMBER_B}`);
            const shortHash = await openNewestCommit(page);

            // Wipe every remembered preference, then open the link cold.
            await page.evaluate(() => localStorage.clear());
            await openGroupGit(page, serverUrl, groupId, `/member/${MEMBER_B}/${shortHash}`);

            await expect(page.getByTestId('repo-group-view')).toHaveAttribute('data-workspace', groupId);
            await expect(hostedMember(page)).toHaveAttribute('data-member', MEMBER_B, { timeout: 20_000 });
            await expect(page.getByTestId('commit-detail')).toBeVisible({ timeout: 20_000 });
            await expect(page).toHaveURL(new RegExp(`#repos/${groupId}/git/member/${MEMBER_B}/${shortHash}`));
        } finally {
            safeRmSync(tmpDir);
        }
    });
});
