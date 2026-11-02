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
import { execFileSync } from 'child_process';
import { randomUUID } from 'crypto';
import { test, expect, safeRmSync } from './fixtures/server-fixture';
import { createMultiCommitRepo } from './fixtures/git-fixtures';
import { seedWorkspace, request } from './fixtures/seed';
import { repoHashUrl } from './fixtures/remote-shell';
import type { Page } from '@playwright/test';

const GROUP_NAME = 'E2E Git Nav Group';
const MEMBER_B_SUBJECT = 'test: member B change';

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
 * bundled into one group. Workspace IDs must be unique across server fixtures:
 * the process-wide Git cache outlives each test's server and temporary repos.
 */
async function seedGroupWithTwoRepos(serverUrl: string, tmpDir: string) {
    const suffix = randomUUID();
    const memberA = `group-git-nav-a-${suffix}`;
    const memberB = `group-git-nav-b-${suffix}`;
    const repoA = createMultiCommitRepo(path.join(tmpDir, 'a'));
    const repoB = createMultiCommitRepo(path.join(tmpDir, 'b'));
    fs.appendFileSync(path.join(repoB, 'src', 'index.ts'), '\nexport const groupMember = "b";\n');
    execFileSync('git', ['add', 'src/index.ts'], { cwd: repoB, stdio: 'ignore' });
    execFileSync('git', ['commit', '-m', MEMBER_B_SUBJECT], { cwd: repoB, stdio: 'ignore' });
    const memberBHash = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoB, encoding: 'utf8' }).trim();
    await seedWorkspace(serverUrl, memberA, 'group-git-nav-repo-a', repoA);
    await seedWorkspace(serverUrl, memberB, 'group-git-nav-repo-b', repoB);
    await dismissOnboarding(serverUrl);

    const res = await request(`${serverUrl}/api/repo-groups`, {
        method: 'POST',
        body: JSON.stringify({ name: GROUP_NAME, members: [memberA, memberB] }),
    });
    if (res.status !== 201) {
        throw new Error(`Failed to create repo group: ${res.status} ${res.body}`);
    }
    return { groupId: JSON.parse(res.body).workspace.id as string, memberA, memberB, memberBHash };
}

/** Open the group's Git tab and wait for a member's commit list to render. */
async function openGroupGit(page: Page, serverUrl: string, groupId: string, suffix = ''): Promise<void> {
    await page.goto(repoHashUrl(serverUrl, groupId, `git${suffix}`));
    await expect(page.getByTestId('repo-group-git-tab')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('git-tab-loading')).toBeHidden({ timeout: 20_000 });
    await expect(page.locator('[data-testid^="commit-row-"]').first()).toBeVisible({ timeout: 20_000 });
}

/** The member the hosted panel is currently showing. */
function hostedMember(page: Page) {
    return page.getByTestId('repo-group-git-tab');
}

async function pickMember(page: Page, memberId: string): Promise<void> {
    await page.getByTestId('repo-group-git-member-trigger').click();
    await page.getByTestId(`repo-group-git-member-${memberId}`).click();
    await expect(page.getByTestId('repo-group-git-member-list')).toBeHidden();
    await expect(hostedMember(page)).toHaveAttribute('data-member', memberId, { timeout: 20_000 });
    await expect(page.getByTestId('git-tab-loading')).toBeHidden({ timeout: 20_000 });
    await expect(page.locator('[data-testid^="commit-row-"]').first()).toBeVisible({ timeout: 20_000 });
}

/** Click the newest commit row and return its short hash. */
async function openNewestCommit(page: Page): Promise<string> {
    const firstRow = page.locator('[data-testid^="commit-row-"]').first();
    await expect(firstRow).toBeVisible({ timeout: 20_000 });
    const shortHash = (await firstRow.getAttribute('data-testid'))!.replace('commit-row-', '');
    await firstRow.click();
    await expect(page.getByTestId('commit-detail')).toBeVisible({ timeout: 20_000 });
    // Review automatically selects a file, adding a route after the commit overview.
    await expect(page).toHaveURL(new RegExp(`/${shortHash}[^/]*/[^/]+$`));
    await expect(page.getByTestId('file-diff-header')).toBeVisible({ timeout: 20_000 });
    return shortHash;
}

test.describe('Repo group Git navigation', () => {
    test.describe.configure({ timeout: 60_000 });
    test('opening a member commit keeps the group selected and names the member in the URL', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-group-git-'));
        try {
            const { groupId, memberA, memberB } = await seedGroupWithTwoRepos(serverUrl, tmpDir);
            await openGroupGit(page, serverUrl, groupId);

            // A bare group entry canonicalizes to an explicit member route.
            await expect(page).toHaveURL(new RegExp(`#repos/${groupId}/git/member/(${memberA}|${memberB})$`));

            await pickMember(page, memberB);
            await expect(page).toHaveURL(`${serverUrl}/#repos/${groupId}/git/member/${memberB}`);

            const shortHash = await openNewestCommit(page);

            // THE REGRESSION: the group is still the page…
            await expect(page.getByTestId('repo-group-view')).toBeVisible();
            await expect(page.getByTestId('repo-group-view')).toHaveAttribute('data-workspace', groupId);
            await expect(hostedMember(page)).toHaveAttribute('data-member', memberB);
            // …and the URL carries the group, the member AND the commit.
            await expect(page).toHaveURL(new RegExp(`#repos/${groupId}/git/member/${memberB}/${shortHash}`));
        } finally {
            safeRmSync(tmpDir);
        }
    });

    test('a commit file keeps the group, the member and the file in the URL', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-group-git-file-'));
        try {
            const { groupId, memberB } = await seedGroupWithTwoRepos(serverUrl, tmpDir);
            await openGroupGit(page, serverUrl, groupId);
            await pickMember(page, memberB);
            const shortHash = await openNewestCommit(page);

            await expect(page.getByTestId(`commit-files-${shortHash}`)).toBeVisible({ timeout: 20_000 });
            await expect(page.getByTestId('commit-files-loading')).toBeHidden({ timeout: 20_000 });
            await page.locator('[data-testid^="commit-file-"]').first().click();

            await expect(page.getByTestId('file-diff-header')).toBeVisible({ timeout: 20_000 });
            await expect(page.getByTestId('repo-group-view')).toHaveAttribute('data-workspace', groupId);
            await expect(page).toHaveURL(
                new RegExp(`#repos/${groupId}/git/member/${memberB}/${shortHash}[^/]*/[^/]+$`),
            );
        } finally {
            safeRmSync(tmpDir);
        }
    });

    test('Back and Forward move between members without leaving the group', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-group-git-history-'));
        try {
            const { groupId, memberA, memberB } = await seedGroupWithTwoRepos(serverUrl, tmpDir);
            await openGroupGit(page, serverUrl, groupId);

            await pickMember(page, memberA);
            const hashA = await openNewestCommit(page);
            const fileUrlA = page.url();

            await pickMember(page, memberB);
            const hashB = await openNewestCommit(page);

            // Back through B's file, commit overview and history, then A's file.
            await page.goBack();
            await expect(page).toHaveURL(new RegExp(`#repos/${groupId}/git/member/${memberB}/${hashB}[0-9a-f]*$`));
            await page.goBack();
            await expect(page).toHaveURL(`${serverUrl}/#repos/${groupId}/git/member/${memberB}`);
            await page.goBack();
            await expect(page).toHaveURL(fileUrlA);
            expect(fileUrlA).toContain(`/git/member/${memberA}/${hashA}`);
            await expect(hostedMember(page)).toHaveAttribute('data-member', memberA, { timeout: 20_000 });
            await expect(page.getByTestId('commit-detail')).toBeVisible({ timeout: 20_000 });
            await expect(page.getByTestId('file-diff-header')).toBeVisible({ timeout: 20_000 });
            await expect(page.getByTestId('repo-group-view')).toHaveAttribute('data-workspace', groupId);

            await page.goForward();
            await expect(page).toHaveURL(`${serverUrl}/#repos/${groupId}/git/member/${memberB}`);
            await expect(hostedMember(page)).toHaveAttribute('data-member', memberB, { timeout: 20_000 });
        } finally {
            safeRmSync(tmpDir);
        }
    });

    test('a fresh context restores the member and commit straight from the URL', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-group-git-fresh-'));
        try {
            const { groupId, memberB, memberBHash } = await seedGroupWithTwoRepos(serverUrl, tmpDir);

            // Start with the real fixture SHA, without opening the commit first:
            // a deep link must resolve from a cold page with no cached client state.
            await openGroupGit(page, serverUrl, groupId, `/member/${memberB}/${memberBHash}`);

            await expect(page.getByTestId('repo-group-view')).toHaveAttribute('data-workspace', groupId);
            await expect(hostedMember(page)).toHaveAttribute('data-member', memberB, { timeout: 20_000 });
            await expect(page.getByTestId('commit-detail')).toBeVisible({ timeout: 20_000 });
            await expect(page.getByTestId('commit-info-subject')).toHaveText(MEMBER_B_SUBJECT);
            await expect(page.getByTestId('unified-right-panel')).toHaveAttribute('data-open', 'true');
            await expect(page).toHaveURL(new RegExp(`#repos/${groupId}/git/member/${memberB}/${memberBHash}`));
            await page.reload();
            await expect(page.getByTestId('commit-detail')).toBeVisible({ timeout: 20_000 });
            await expect(page.getByTestId('commit-info-subject')).toHaveText(MEMBER_B_SUBJECT);
            await expect(hostedMember(page)).toHaveAttribute('data-member', memberB);
        } finally {
            safeRmSync(tmpDir);
        }
    });
});
