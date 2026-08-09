/**
 * Remove-from-CoC E2E — remote (agent-hosted) repos (AC-02).
 *
 * These cover the two "manual demo" Definitions of Done that need a SECOND CoC
 * server, by starting a real one in-process and registering it on the primary
 * server as a `url` remote:
 *   - AC-02 #1: a remote repo's "Remove from CoC" is enabled, and confirming it
 *     unregisters the workspace ON THE OWNING SERVER (the DELETE is routed to
 *     that server's baseUrl, not the page origin) while the primary server's own
 *     workspaces are untouched.
 *   - AC-02 #2: with the owning server stopped, the item is disabled and its
 *     tooltip names the offline server, so removal fails up front instead of
 *     after the confirm.
 *
 * Both surfaces (the remotes-picker row menu and the clone-popover context menu)
 * share `describeRemoveBlock` + `useWorkspaceRemoval`; the row menu is the one
 * reachable without first selecting the clone, so it is what these drive. The
 * per-surface wiring is unit-tested in
 * test/spa/react/remote-shell/{WorkspaceIdentityChip,WorkspaceTabsCluster}.test.tsx.
 *
 * Removal stays unregister-only: the remote checkout on disk is left in place.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { test, expect, safeRmSync, type Page } from './fixtures/server-fixture';
import { createE2EMockSDKService } from './fixtures/mock-ai';
import { E2E_SERVER_CONFIG_YAML } from './fixtures/e2e-server-config';
import { seedWorkspace, request } from './fixtures/seed';

// Same dist import style as the server fixture — Playwright doesn't transpile src TS.
const { createExecutionServer } = require('../../dist/server/index');
const { FileProcessStore } = require('@plusplusoneplusplus/forge');

/** A second, independent CoC server standing in for the agent host. */
interface SecondaryServer {
    url: string;
    dataDir: string;
    /** Stop the HTTP server (the temp dir stays until `cleanup`). */
    stop(): Promise<void>;
    /** Stop if still running, then remove the temp dir. */
    cleanup(): Promise<void>;
}

/**
 * Boot a second CoC server on its own port + data dir. Mirrors the primary
 * fixture's setup (mock AI, isolated config, pre-dismissed onboarding) so the
 * remote behaves like a real peer rather than a stub.
 */
async function startSecondaryServer(): Promise<SecondaryServer> {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-e2e-remote-'));
    fs.writeFileSync(
        path.join(dataDir, 'preferences.json'),
        JSON.stringify({ global: { hasSeenWelcome: true } }),
    );
    const configPath = path.join(dataDir, 'config.yaml');
    fs.writeFileSync(configPath, E2E_SERVER_CONFIG_YAML);

    const server = await createExecutionServer({
        store: new FileProcessStore({ dataDir }),
        port: 0,
        host: '127.0.0.1',
        dataDir,
        aiService: createE2EMockSDKService().service,
        configPath,
    });

    let stopped = false;
    const stop = async () => {
        if (stopped) return;
        stopped = true;
        await server.close();
    };
    return {
        url: server.url,
        dataDir,
        stop,
        cleanup: async () => {
            await stop();
            await new Promise(r => setTimeout(r, process.platform === 'win32' ? 500 : 0));
            safeRmSync(dataDir);
        },
    };
}

/** Force the remote-first shell on (the shared E2E config pins it off). */
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

/** Create a git checkout with a fixed `origin` URL (never fetched — it only feeds grouping). */
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

/** All workspace ids currently registered on a server. */
async function listWorkspaceIds(serverUrl: string): Promise<string[]> {
    const res = await request(`${serverUrl}/api/workspaces`);
    const json = JSON.parse(res.body);
    const list = Array.isArray(json) ? json : (json.workspaces ?? []);
    return list.map((w: { id: string }) => String(w.id));
}

/** Register `remoteUrl` on `serverUrl` as a `url`-kind remote server. */
async function registerRemoteServer(serverUrl: string, label: string, remoteUrl: string) {
    const res = await request(`${serverUrl}/api/servers`, {
        method: 'POST',
        body: JSON.stringify({ kind: 'url', label, url: remoteUrl }),
    });
    expect(res.status, `POST /api/servers -> ${res.body}`).toBe(201);
    return JSON.parse(res.body) as { id: string; status?: string };
}

/** Runtime status the primary server currently reports for a registered remote. */
async function remoteServerStatus(serverUrl: string, id: string): Promise<string> {
    const res = await request(`${serverUrl}/api/servers`);
    if (res.status !== 200) return '';
    const list = JSON.parse(res.body) as Array<{ id: string; status?: string }>;
    return String(list.find(s => s.id === id)?.status ?? '');
}

/** Open the remotes picker dropdown and filter it down to `query`. */
async function openDropdownFiltered(page: Page, query: string): Promise<void> {
    await expect(page.locator('[data-testid="remote-chip"]').first()).toBeVisible({
        timeout: 20_000,
    });
    await page.locator('[data-testid="remote-chip"]').first().click();
    await expect(page.locator('[data-testid="remote-dropdown"]')).toBeVisible({ timeout: 5_000 });
    await page.locator('[data-testid="remote-search-input"]').fill(query);
}

test.describe('Remove from CoC — remote repos (AC-02)', () => {
    test('removal is routed to the owning server and unregisters it there', async ({
        page,
        serverUrl,
    }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-rm-remote-'));
        const secondary = await startSecondaryServer();
        try {
            // A local repo on the primary server, so we can prove only the remote
            // one is affected.
            const localDir = createCheckout(tmpDir, 'local', 'https://github.com/acme/local.git');
            await seedWorkspace(serverUrl, 'e2e-rm-local', 'Local Repo', localDir);

            // The repo that lives on the OTHER server.
            const remoteDir = createCheckout(tmpDir, 'agent', 'https://github.com/acme/agent.git');
            const remoteId = 'e2e-rm-agent';
            await seedWorkspace(secondary.url, remoteId, 'Agent Repo', remoteDir);

            await registerRemoteServer(serverUrl, 'Agent Host', secondary.url);

            await enableRemoteShell(page);
            await page.goto(serverUrl);

            await openDropdownFiltered(page, 'Agent Repo');
            await expect(page.locator('[data-testid="remote-dropdown-item"]')).toHaveCount(1, {
                timeout: 20_000,
            });

            const rowMenu = page.locator('[data-testid="remote-dropdown-row-menu"]');
            await expect(rowMenu).toHaveCount(1);
            await rowMenu.click();

            const menu = page.locator('[data-testid="context-menu"]');
            await expect(menu).toBeVisible({ timeout: 5_000 });
            // AC-02: enabled for a remote repo whose owning server is online.
            const item = menu.getByRole('menuitem', { name: /Remove from CoC/ });
            await expect(item).toBeEnabled();
            await item.click();

            const dialog = page.locator('#clone-remove-dialog');
            await expect(dialog).toBeVisible({ timeout: 5_000 });
            await expect(dialog).toContainText('Agent Repo');
            await page.locator('[data-testid="clone-remove-confirm-btn"]').click();

            await expect(page.getByText('Removed Agent Repo')).toBeVisible({ timeout: 15_000 });

            // The DELETE landed on the OWNING server: the workspace is gone from
            // the secondary server's own registry...
            await expect
                .poll(() => listWorkspaceIds(secondary.url), { timeout: 15_000 })
                .not.toContain(remoteId);
            // ...and the primary server never had it and still has its own repo.
            const primaryIds = await listWorkspaceIds(serverUrl);
            expect(primaryIds).not.toContain(remoteId);
            expect(primaryIds).toContain('e2e-rm-local');

            // Unregister only — the remote checkout on disk survives.
            expect(fs.existsSync(path.join(remoteDir, 'README.md'))).toBe(true);
        } finally {
            await secondary.cleanup();
            safeRmSync(tmpDir);
        }
    });

    test('offline owning server disables removal with a tooltip naming it', async ({
        page,
        serverUrl,
    }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-rm-remote-off-'));
        const secondary = await startSecondaryServer();
        try {
            const remoteDir = createCheckout(tmpDir, 'agent', 'https://github.com/acme/agent-off.git');
            await seedWorkspace(secondary.url, 'e2e-rm-agent-off', 'Agent Offline Repo', remoteDir);
            const registered = await registerRemoteServer(serverUrl, 'Agent Host', secondary.url);

            await enableRemoteShell(page);
            // First load while the server is up, so the SPA caches its workspace
            // list — that cache is what keeps the row visible once it goes away.
            await page.goto(serverUrl);
            await openDropdownFiltered(page, 'Agent Offline Repo');
            await expect(page.locator('[data-testid="remote-dropdown-item"]')).toHaveCount(1, {
                timeout: 20_000,
            });

            // Now the owning server disappears.
            await secondary.stop();
            await expect
                .poll(() => remoteServerStatus(serverUrl, registered.id), { timeout: 20_000 })
                .toBe('offline');

            await page.reload();
            await openDropdownFiltered(page, 'Agent Offline Repo');
            await expect(page.locator('[data-testid="remote-dropdown-item"]')).toHaveCount(1, {
                timeout: 20_000,
            });
            await page.locator('[data-testid="remote-dropdown-row-menu"]').click();

            const menu = page.locator('[data-testid="context-menu"]');
            await expect(menu).toBeVisible({ timeout: 5_000 });
            const item = menu.getByRole('menuitem', { name: /Remove from CoC/ });
            // AC-02 #2 — disabled up front, with a tooltip naming the server. The
            // tooltip lives on a wrapper span because a disabled button swallows hover.
            await expect(item).toBeDisabled();
            await expect(menu.locator('span[title*="Agent Host"]')).toHaveCount(1);
            await expect(menu.locator('span[title*="Agent Host"]')).toHaveAttribute(
                'title',
                /offline/i,
            );

            // Nothing was removed: the row is still there after closing the menu.
            await page.keyboard.press('Escape');
            expect(await listWorkspaceIds(serverUrl)).not.toContain('e2e-rm-agent-off');
        } finally {
            await secondary.cleanup();
            safeRmSync(tmpDir);
        }
    });
});
