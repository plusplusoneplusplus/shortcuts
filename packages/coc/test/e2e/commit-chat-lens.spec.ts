import { expect, test } from './fixtures/server-fixture';
import { createMultiCommitRepo } from './fixtures/git-fixtures';
import { request, seedWorkspace } from './fixtures/seed';
import { execFileSync } from 'child_process';

const WORKSPACE_ID = 'ws-commit-chat-lens';
const WORK_ITEM_ID = 'wi-commit-chat-lens';
const CHANGED_FILE = 'src/index.ts';

function latestCommit(repoDir: string): { hash: string; shortHash: string; subject: string } {
    const hash = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoDir, encoding: 'utf8' }).trim();
    const subject = execFileSync('git', ['log', '-1', '--pretty=%s'], { cwd: repoDir, encoding: 'utf8' }).trim();
    return { hash, shortHash: hash.slice(0, 7), subject };
}

function placementStorageKey(workspaceId: string, commitHash: string): string {
    return `coc.reviewChat.placement.commit.${encodeURIComponent(workspaceId)}.${encodeURIComponent(commitHash)}`;
}

async function seedWorkItemCommit(serverUrl: string, commit: { hash: string; subject: string }): Promise<void> {
    const createRes = await request(`${serverUrl}/api/workspaces/${encodeURIComponent(WORKSPACE_ID)}/work-items`, {
        method: 'POST',
        body: JSON.stringify({
            id: WORK_ITEM_ID,
            title: 'Verify commit chat lens',
            description: 'Browser fixture work item with a linked commit.',
            priority: 'normal',
            source: 'manual',
            plan: { content: 'Review the linked commit in the embedded work item pane.' },
        }),
    });
    expect(createRes.status).toBe(201);

    const changeRes = await request(`${serverUrl}/api/workspaces/${encodeURIComponent(WORKSPACE_ID)}/work-items/${encodeURIComponent(WORK_ITEM_ID)}/changes`, {
        method: 'POST',
        body: JSON.stringify({ planVersion: 1 }),
    });
    expect(changeRes.status).toBe(201);
    const change = JSON.parse(changeRes.body);

    const patchRes = await request(`${serverUrl}/api/workspaces/${encodeURIComponent(WORKSPACE_ID)}/work-items/${encodeURIComponent(WORK_ITEM_ID)}/changes/${encodeURIComponent(change.id)}`, {
        method: 'PATCH',
        body: JSON.stringify({
            status: 'closed',
            completedAt: new Date('2026-03-07T12:00:00Z').toISOString(),
            commits: [
                {
                    sha: commit.hash,
                    message: commit.subject,
                    author: 'Test Author',
                    date: new Date('2026-03-07T12:00:00Z').toISOString(),
                },
            ],
        }),
    });
    expect(patchRes.status).toBe(200);
}

async function enableCommitChatLensFeature(serverUrl: string): Promise<void> {
    const res = await request(`${serverUrl}/api/admin/config`, {
        method: 'PUT',
        body: JSON.stringify({ 'features.commitChatLens': true }),
    });
    if (res.status !== 200) {
        throw new Error(`Failed to enable commit chat lens feature: ${res.status} ${res.body}`);
    }
}

async function expectBottomRightLens(page: import('@playwright/test').Page): Promise<void> {
    const lens = page.getByTestId('commit-chat-lens');
    await expect(lens).toBeVisible();
    await expect(page.getByTestId('commit-chat-side-panel')).toHaveCount(0);

    const box = await lens.boundingBox();
    const viewport = page.viewportSize();
    expect(box).toBeTruthy();
    expect(viewport).toBeTruthy();
    expect(box!.x).toBeGreaterThan(viewport!.width / 2);
    expect(box!.y).toBeGreaterThan(viewport!.height / 3);
}

async function verifyPinCloseUnpinCycle(page: import('@playwright/test').Page, storageKey: string): Promise<void> {
    await page.getByTestId('commit-chat-frame-close-btn').click();
    await expect(page.getByTestId('commit-chat-lens')).toHaveCount(0);
    await expect(page.getByTestId('commit-chat-side-panel')).toHaveCount(0);
    await expect.poll(() => page.evaluate(key => localStorage.getItem(key), storageKey)).toBeNull();

    await page.getByTestId('toggle-chat-btn').click();
    await expectBottomRightLens(page);

    await page.getByTestId('commit-chat-pin-btn').click();
    await expect(page.getByTestId('commit-chat-side-panel')).toBeVisible();
    await expect(page.getByTestId('commit-chat-lens')).toHaveCount(0);
    await expect.poll(() => page.evaluate(key => localStorage.getItem(key), storageKey)).toBe('side-panel');

    await page.getByTestId('commit-chat-frame-close-btn').click();
    await expect(page.getByTestId('commit-chat-side-panel')).toHaveCount(0);
    await expect.poll(() => page.evaluate(key => localStorage.getItem(key), storageKey)).toBe('side-panel');

    await page.getByTestId('toggle-chat-btn').click();
    await expect(page.getByTestId('commit-chat-side-panel')).toBeVisible();

    await page.getByTestId('commit-chat-unpin-btn').click();
    await expectBottomRightLens(page);
    await expect.poll(() => page.evaluate(key => localStorage.getItem(key), storageKey)).toBeNull();
}

async function gotoFresh(page: import('@playwright/test').Page, url: string): Promise<void> {
    await page.goto('about:blank');
    await page.goto(url);
}

test.describe('feature-flagged commit chat lens', () => {
    test('opens as a bottom-right lens across commit review surfaces and persists pinning by workspace and commit', async ({ page, serverUrl, dataDir }) => {
        const runtimeErrors: string[] = [];
        page.on('console', message => {
            if (message.type() === 'error' && !message.text().startsWith('Failed to load resource:')) {
                runtimeErrors.push(message.text());
            }
        });
        page.on('pageerror', error => runtimeErrors.push(error.message));

        const repoDir = createMultiCommitRepo(dataDir);
        const commit = latestCommit(repoDir);
        const storageKey = placementStorageKey(WORKSPACE_ID, commit.hash);

        await seedWorkspace(serverUrl, WORKSPACE_ID, 'Commit Chat Lens', repoDir);
        await seedWorkItemCommit(serverUrl, commit);
        await enableCommitChatLensFeature(serverUrl);

        await page.goto(`${serverUrl}/?workspace=${encodeURIComponent(WORKSPACE_ID)}#repos/${encodeURIComponent(WORKSPACE_ID)}/git/${encodeURIComponent(commit.hash)}`);
        await expect(page.getByTestId(`commit-row-${commit.shortHash}`)).toBeVisible();
        await expect(page.getByTestId('diff-section')).toBeVisible();

        await page.getByTestId('toggle-chat-btn').click();
        await expectBottomRightLens(page);
        await verifyPinCloseUnpinCycle(page, storageKey);
        await page.getByTestId('commit-chat-frame-close-btn').click();

        await gotoFresh(page, `${serverUrl}/?workspace=${encodeURIComponent(WORKSPACE_ID)}&surface=file#repos/${encodeURIComponent(WORKSPACE_ID)}/git/${encodeURIComponent(commit.hash)}/${encodeURIComponent(CHANGED_FILE)}`);
        await expect(page.getByTestId('file-diff-section')).toBeVisible();
        await page.getByTestId('toggle-chat-btn').click();
        await expectBottomRightLens(page);
        await page.getByTestId('commit-chat-frame-close-btn').click();

        await gotoFresh(page, `${serverUrl}/?workspace=${encodeURIComponent(WORKSPACE_ID)}&surface=work-item#repos/${encodeURIComponent(WORKSPACE_ID)}/work-items/${encodeURIComponent(WORK_ITEM_ID)}/commit/${encodeURIComponent(commit.hash)}/${CHANGED_FILE.split('/').map(encodeURIComponent).join('/')}`);
        await expect(page.getByTestId('work-item-commit-review')).toBeVisible();
        await expect(page.getByTestId('file-diff-section')).toBeVisible();
        await page.getByTestId('toggle-chat-btn').click();
        await expectBottomRightLens(page);

        await page.getByTestId('commit-chat-pin-btn').click();
        await expect(page.getByTestId('commit-chat-side-panel')).toBeVisible();
        await expect.poll(() => page.evaluate(key => localStorage.getItem(key), storageKey)).toBe('side-panel');

        await page.getByTestId('commit-review-back-btn').click();
        await expect(page.getByTestId('diff-section')).toBeVisible();
        await expect(page.getByTestId('commit-chat-side-panel')).toBeVisible();

        await page.getByTestId('commit-chat-unpin-btn').click();
        await expectBottomRightLens(page);
        await expect.poll(() => page.evaluate(key => localStorage.getItem(key), storageKey)).toBeNull();

        await page.getByTestId('commit-chat-frame-close-btn').click();
        await expect(page.getByTestId('commit-chat-lens')).toHaveCount(0);
        await expect.poll(() => page.evaluate(key => localStorage.getItem(key), storageKey)).toBeNull();

        await page.getByTestId('toggle-chat-btn').click();
        await expectBottomRightLens(page);

        expect(runtimeErrors).toEqual([]);
    });
});
