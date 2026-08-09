/**
 * Remove-from-CoC E2E — the remotes-picker row menu (AC-01) and the
 * active-work warning in the shared confirm dialog (AC-03).
 *
 * These cover the "manual demo" Definitions of Done for the remove-repo-from-CoC
 * feature by driving the real SPA in a browser against a real server:
 *   - AC-01 #1: a single-clone dropdown row exposes a row menu whose
 *     "Remove from CoC" unregisters the workspace (row gone, toast, server
 *     no longer lists it).
 *   - AC-01 #2: a multi-clone group row exposes no row menu at all, so a whole
 *     group can never be removed in one action.
 *   - AC-03 #1/#2: the confirm dialog carries the running/queued warning line
 *     when the repo has active work, and omits it when it doesn't — and the
 *     warning never blocks the removal.
 *
 * Removal is unregister-only: the checkout on disk is left in place, which the
 * first test asserts explicitly.
 *
 * The default E2E config pins `features.remoteShell` off (the classic shell has
 * no remotes picker at all), so these specs force the remote-first shell on by
 * overriding GET /api/config/runtime — same approach as notes-status-dock.spec.ts.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { test, expect, safeRmSync, type Page } from './fixtures/server-fixture';
import { seedWorkspace, seedQueueTask, request } from './fixtures/seed';

/**
 * Force the remote-first shell on regardless of the E2E server's pinned-off
 * config by merging `remoteShellEnabled: true` into GET /api/config/runtime.
 * The App renders only after `loadRuntimeConfig()` resolves, so the flag is in
 * effect on the very first render.
 */
async function enableRemoteShell(page: Page): Promise<void> {
    await page.route('**/api/config/runtime', async (route) => {
        try {
            const resp = await route.fetch();
            const json = await resp.json();
            const features = { ...(json.features ?? {}), remoteShellEnabled: true };
            await route.fulfill({
                status: resp.status(),
                headers: { ...resp.headers(), 'content-type': 'application/json' },
                body: JSON.stringify({ ...json, features }),
            });
        } catch {
            await route.continue().catch(() => {});
        }
    });
}

/**
 * Create a git checkout with a fixed `origin` URL. The URL is never fetched —
 * it only feeds the SPA's remote grouping, so two checkouts sharing a URL form
 * one multi-clone group and distinct URLs form separate single-clone groups.
 */
function createCheckout(parentDir: string, dirName: string, remoteUrl: string): string {
    const repoDir = path.join(parentDir, dirName);
    fs.mkdirSync(repoDir, { recursive: true });
    fs.writeFileSync(path.join(repoDir, 'README.md'), `# ${dirName}\n`);
    const git = (...args: string[]) =>
        execFileSync('git', args, { cwd: repoDir, stdio: 'ignore' });
    git('init');
    git('config', 'user.email', 'e2e@example.com');
    git('config', 'user.name', 'E2E');
    git('add', '.');
    git('commit', '-m', 'init');
    git('remote', 'add', 'origin', remoteUrl);
    return repoDir;
}

/** All workspace ids currently registered on the server. */
async function listWorkspaceIds(serverUrl: string): Promise<string[]> {
    const res = await request(`${serverUrl}/api/workspaces`);
    const json = JSON.parse(res.body);
    const list = Array.isArray(json) ? json : (json.workspaces ?? []);
    return list.map((w: { id: string }) => String(w.id));
}

/** Current status of a queue task, or `''` when it can't be read. */
async function taskStatus(serverUrl: string, taskId: string): Promise<string> {
    const res = await request(`${serverUrl}/api/queue/${taskId}`);
    if (res.status !== 200) return '';
    const json = JSON.parse(res.body);
    return String((json.task ?? json).status ?? '');
}

/** Open the remotes picker dropdown and filter it down to `query`. */
async function openDropdownFiltered(page: Page, query: string): Promise<void> {
    await expect(page.locator('[data-testid="remote-chip"]').first()).toBeVisible({
        timeout: 20_000,
    });
    await page.locator('[data-testid="remote-chip"]').first().click();
    const dropdown = page.locator('[data-testid="remote-dropdown"]');
    await expect(dropdown).toBeVisible({ timeout: 5_000 });
    await page.locator('[data-testid="remote-search-input"]').fill(query);
}

test.describe('Remove from CoC — remotes picker row menu', () => {
    test('single-clone row removes the repo; disk checkout survives', async ({
        page,
        serverUrl,
    }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-rm-solo-'));
        try {
            const keepDir = createCheckout(tmpDir, 'keeper', 'https://github.com/acme/keeper.git');
            const soloDir = createCheckout(tmpDir, 'solo', 'https://github.com/acme/solo.git');
            await seedWorkspace(serverUrl, 'e2e-rm-keeper', 'Keeper Repo', keepDir);
            await seedWorkspace(serverUrl, 'e2e-rm-solo', 'Solo Repo', soloDir);

            await enableRemoteShell(page);
            await page.goto(serverUrl);

            await openDropdownFiltered(page, 'Solo Repo');
            const rows = page.locator('[data-testid="remote-dropdown-item"]');
            await expect(rows).toHaveCount(1, { timeout: 10_000 });

            // AC-01: a single-clone group row carries the row menu.
            const rowMenu = page.locator('[data-testid="remote-dropdown-row-menu"]');
            await expect(rowMenu).toHaveCount(1);
            await rowMenu.click();

            const menu = page.locator('[data-testid="context-menu"]');
            await expect(menu).toBeVisible({ timeout: 5_000 });
            // The item label is prefixed by its icon glyph, so match loosely.
            await menu.getByRole('menuitem', { name: /Remove from CoC/ }).click();

            // The shared confirm dialog opens and names the repo.
            const dialog = page.locator('#clone-remove-dialog');
            await expect(dialog).toBeVisible({ timeout: 5_000 });
            await expect(dialog).toContainText('Solo Repo');
            // AC-03 #2 — an idle repo gets no active-work warning line.
            await expect(page.locator('[data-testid="clone-remove-active-work"]')).toHaveCount(0);

            await page.locator('[data-testid="clone-remove-confirm-btn"]').click();

            // Success toast, and the workspace is gone server-side.
            await expect(page.getByText('Removed Solo Repo')).toBeVisible({ timeout: 10_000 });
            await expect
                .poll(() => listWorkspaceIds(serverUrl), { timeout: 10_000 })
                .not.toContain('e2e-rm-solo');
            expect(await listWorkspaceIds(serverUrl)).toContain('e2e-rm-keeper');

            // Unregister only — the checkout on disk is untouched.
            expect(fs.existsSync(path.join(soloDir, 'README.md'))).toBe(true);

            // Reopening the dropdown no longer lists it.
            await openDropdownFiltered(page, 'Solo Repo');
            await expect(page.locator('[data-testid="remote-dropdown-item"]')).toHaveCount(0, {
                timeout: 10_000,
            });
        } finally {
            safeRmSync(tmpDir);
        }
    });

    test('multi-clone group row offers no removal', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-rm-multi-'));
        try {
            const sharedUrl = 'https://github.com/acme/shared.git';
            const cloneA = createCheckout(tmpDir, 'shared-a', sharedUrl);
            const cloneB = createCheckout(tmpDir, 'shared-b', sharedUrl);
            await seedWorkspace(serverUrl, 'e2e-rm-shared-a', 'Shared Clone A', cloneA);
            await seedWorkspace(serverUrl, 'e2e-rm-shared-b', 'Shared Clone B', cloneB);

            await enableRemoteShell(page);
            await page.goto(serverUrl);

            await openDropdownFiltered(page, 'Shared Clone');
            // Both checkouts collapse into ONE group row (they share a remote).
            const rows = page.locator('[data-testid="remote-dropdown-item"]');
            await expect(rows).toHaveCount(1, { timeout: 10_000 });
            await expect(rows.first()).toContainText('2');

            // AC-01 #2 — no row menu on a multi-clone group, so "Remove from CoC"
            // is unreachable there; removal is offered per clone instead.
            await expect(page.locator('[data-testid="remote-dropdown-row-menu"]')).toHaveCount(0);
        } finally {
            safeRmSync(tmpDir);
        }
    });
});

test.describe('Remove from CoC — active-work warning (AC-03)', () => {
    test('confirm dialog warns about running/queued chats and still removes', async ({
        page,
        serverUrl,
        mockAI,
    }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-rm-busy-'));
        try {
            const busyDir = createCheckout(tmpDir, 'busy', 'https://github.com/acme/busy.git');
            const wsId = 'e2e-rm-busy';
            await seedWorkspace(serverUrl, wsId, 'Busy Repo', busyDir);

            // Hold the first chat open forever so it stays `running`; the second
            // then sits `queued` behind the repo's exclusive slot.
            const gated = mockAI.createGatedStreamingResponse(['chunk one', 'chunk two']);
            mockAI.mockSendMessage.mockImplementation(gated.implementation);

            const first = await seedQueueTask(serverUrl, {
                repoId: wsId,
                payload: { workspaceId: wsId, prompt: 'long running chat' },
            });
            const second = await seedQueueTask(serverUrl, {
                repoId: wsId,
                payload: { workspaceId: wsId, prompt: 'waiting chat' },
            });
            // The dialog only warns about work the SPA can see, so make sure the
            // server really has one chat in flight and one waiting first.
            await expect
                .poll(() => taskStatus(serverUrl, String(first.id)), { timeout: 20_000 })
                .toBe('running');
            await expect
                .poll(() => taskStatus(serverUrl, String(second.id)), { timeout: 20_000 })
                .toBe('queued');

            await enableRemoteShell(page);
            // The repo's queue lands in the SPA's repoQueueMap when its detail
            // page loads (or over the websocket), so open the repo first — this
            // is also the real flow: you remove a repo you were just working in.
            await page.goto(`${serverUrl}#repos/${wsId}`);
            await expect(page.locator('[data-testid="remote-chip"]').first()).toBeVisible({
                timeout: 20_000,
            });

            await openDropdownFiltered(page, 'Busy Repo');
            await expect(page.locator('[data-testid="remote-dropdown-item"]')).toHaveCount(1, {
                timeout: 10_000,
            });
            await page.locator('[data-testid="remote-dropdown-row-menu"]').click();
            await page
                .locator('[data-testid="context-menu"]')
                .getByRole('menuitem', { name: /Remove from CoC/ })
                .click();

            const dialog = page.locator('#clone-remove-dialog');
            await expect(dialog).toBeVisible({ timeout: 5_000 });

            // AC-03 #1 — the warning line appears...
            await expect(page.locator('[data-testid="clone-remove-active-work"]')).toContainText(
                'will keep running',
                { timeout: 15_000 },
            );

            // ...and it warns without blocking: Remove still works.
            await expect(page.locator('[data-testid="clone-remove-confirm-btn"]')).toBeEnabled();
            await page.locator('[data-testid="clone-remove-confirm-btn"]').click();

            await expect(page.getByText('Removed Busy Repo')).toBeVisible({ timeout: 10_000 });
            await expect
                .poll(() => listWorkspaceIds(serverUrl), { timeout: 10_000 })
                .not.toContain(wsId);
        } finally {
            // The gated stream needs no explicit release — the server fixture
            // tears the run down and `mockAI.resetAll()` runs in teardown.
            safeRmSync(tmpDir);
        }
    });
});
