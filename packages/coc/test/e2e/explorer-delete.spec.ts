import * as fs from 'fs';
import * as path from 'path';
import { test, expect } from './fixtures/server-fixture';
import { request, seedWorkspace } from './fixtures/seed';
import { gotoWorkspace, openExplorerPanel, selectRepoNamed } from './fixtures/remote-shell';
import { registerRemoteServer, startSecondaryServer } from './fixtures/secondary-server';

const WORKSPACE = 'ws-delete-fixture';
test.setTimeout(60_000);

async function enable(baseUrl: string) {
    const result = await request(`${baseUrl}/api/admin/config`, {
        method: 'PUT',
        body: JSON.stringify({ 'features.explorerDelete': true, 'features.explorerEditorTabs': true }),
    });
    expect(result.status).toBe(200);
}

test('confirms and permanently deletes isolated file/folder fixtures, retaining symlink targets', async ({ page, serverUrl, dataDir }, info) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    const root = path.join(dataDir, 'delete-fixture');
    fs.mkdirSync(path.join(root, 'folder'), { recursive: true });
    fs.writeFileSync(path.join(root, 'file.txt'), 'fixture');
    fs.writeFileSync(path.join(root, 'folder', 'child.txt'), 'child');
    const outside = path.join(dataDir, 'outside-fixture');
    fs.mkdirSync(outside);
    fs.writeFileSync(path.join(outside, 'keep.txt'), 'keep');
    fs.symlinkSync(outside, path.join(root, 'link'), process.platform === 'win32' ? 'junction' : 'dir');
    await seedWorkspace(serverUrl, WORKSPACE, 'Deletion fixture', root);
    await enable(serverUrl);
    await gotoWorkspace(page, serverUrl, WORKSPACE);
    await openExplorerPanel(page);
    const tree = page.locator('[data-testid="unified-panel-explorer-mode"]');
    const file = tree.getByTestId('tree-node-file.txt');
    await file.click();
    await expect(page.locator('[data-testid="unified-panel-tab-list"]')).toContainText('file.txt');
    await file.click({ button: 'right' });
    await page.getByRole('menuitem', { name: /Delete$/ }).click();
    const dialog = page.getByRole('dialog', { name: 'Permanently delete?' });
    await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused();
    await expect(dialog).toContainText('file.txt');
    await expect(dialog).toContainText('permanent and cannot be undone');
    await page.screenshot({ path: info.outputPath('delete-confirmation-desktop.png') });
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    expect(fs.readFileSync(path.join(root, 'file.txt'), 'utf8')).toBe('fixture');
    await file.click({ button: 'right' });
    await page.getByRole('menuitem', { name: /Delete$/ }).click();
    await page.getByRole('button', { name: 'Delete permanently' }).click();
    await expect(file).toHaveCount(0);
    expect(fs.existsSync(path.join(root, 'file.txt'))).toBe(false);
    await expect(page.locator('[data-testid="unified-panel-tab-list"]')).not.toContainText('file.txt');
    for (const name of ['folder', 'link']) {
        const node = tree.getByTestId(`tree-node-${name}`);
        await node.click({ button: 'right' });
        await page.getByRole('menuitem', { name: /Delete$/ }).click();
        if (name === 'folder') await expect(page.getByRole('dialog')).toContainText('removes all its contents');
        await page.getByRole('button', { name: 'Delete permanently' }).click();
        await expect(node).toHaveCount(0);
    }
    expect(fs.existsSync(path.join(root, 'folder'))).toBe(false);
    expect(fs.readFileSync(path.join(outside, 'keep.txt'), 'utf8')).toBe('keep');
    expect(errors).toEqual([]);
});

test('blocks real unsaved Monaco edits and preserves the buffer after an API failure', async ({ page, serverUrl, dataDir }) => {
    const root = path.join(dataDir, 'delete-fixture');
    fs.mkdirSync(root);
    fs.writeFileSync(path.join(root, 'file.ts'), 'const fixture = 1;\n');
    await seedWorkspace(serverUrl, WORKSPACE, 'Deletion fixture', root);
    await enable(serverUrl);
    await gotoWorkspace(page, serverUrl, WORKSPACE);
    await openExplorerPanel(page);
    const node = page.locator('[data-testid="unified-panel-explorer-mode"]').getByTestId('tree-node-file.ts');
    await node.click();
    const activePane = page.locator('[data-testid="unified-right-panel"] [data-testid^="unified-panel-view-"]:not([style*="display: none"])');
    const editor = activePane.locator('[data-testid="preview-pane"] .monaco-editor');
    await expect(editor).toBeVisible({ timeout: 15_000 });
    const input = editor.getByRole('textbox', { name: 'Editor content' });
    await input.focus();
    await expect(input).toBeFocused();
    await input.press('Control+End');
    await input.pressSequentially('unsaved');
    await expect(activePane.getByTestId('dirty-indicator')).toBeVisible();
    await node.click({ button: 'right' });
    await page.getByRole('menuitem', { name: /Delete$/ }).click();
    await expect(page.getByRole('dialog')).toContainText('file.ts');
    await expect(page.getByRole('button', { name: 'Delete permanently' })).toBeDisabled();
    await page.getByRole('button', { name: 'Cancel' }).click();
    expect(fs.readFileSync(path.join(root, 'file.ts'), 'utf8')).toBe('const fixture = 1;\n');
    await activePane.getByTestId('discard-btn').click();
    await expect(activePane.getByTestId('dirty-indicator')).toHaveCount(0);
    await page.route('**/api/repos/*/entry?*', route => route.fulfill({
        status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'Fixture permission denied' }),
    }));
    await node.click({ button: 'right' });
    await page.getByRole('menuitem', { name: /Delete$/ }).click();
    await page.getByRole('button', { name: 'Delete permanently' }).click();
    await expect(page.getByRole('dialog')).toContainText('Fixture permission denied');
    await expect(activePane.getByTestId('preview-pane')).toBeVisible();
    expect(fs.existsSync(path.join(root, 'file.ts'))).toBe(true);
});

test('keeps the destructive menu and confirmation usable in a narrow desktop panel', async ({ page, serverUrl, dataDir }, info) => {
    const root = path.join(dataDir, 'delete-fixture');
    fs.mkdirSync(root);
    const name = 'a-long-workspace-relative-filename-for-confirmation.txt';
    fs.writeFileSync(path.join(root, name), 'keep');
    await seedWorkspace(serverUrl, WORKSPACE, 'Deletion fixture', root);
    await enable(serverUrl);
    await gotoWorkspace(page, serverUrl, WORKSPACE);
    await openExplorerPanel(page);
    await page.getByRole('button', { name: 'Expand panel' }).click();
    // Keep a desktop viewport: at tablet widths the dock hides its navigator.
    await page.setViewportSize({ width: 1100, height: 844 });
    const tree = page.locator('[data-testid="unified-panel-explorer-mode"]');
    await expect(tree).toBeVisible();
    expect(await tree.evaluate(element => element.getBoundingClientRect().width)).toBeLessThan(160);
    await tree.getByTestId(`tree-node-${name}`).click({ button: 'right' });
    await expect(page.getByTestId('context-menu')).toBeVisible();
    await page.getByRole('menuitem', { name: /Delete$/ }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText(name);
    await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused();
    await expect(dialog.getByRole('button', { name: 'Delete permanently' })).toBeVisible();
    await page.screenshot({ path: info.outputPath('delete-confirmation-narrow.png') });
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    expect(fs.readFileSync(path.join(root, name), 'utf8')).toBe('keep');
});

test('deletes on the remote owning server and never falls back to a same-id local workspace when offline', async ({ page, serverUrl, dataDir }) => {
    const secondary = await startSecondaryServer();
    try {
        const local = path.join(dataDir, 'local-fixture');
        const remote = path.join(secondary.dataDir, 'remote-fixture');
        for (const root of [local, remote]) {
            fs.mkdirSync(path.join(root, 'folder'), { recursive: true });
            fs.writeFileSync(path.join(root, 'file.txt'), 'fixture');
            fs.writeFileSync(path.join(root, 'folder', 'child.txt'), 'child');
            fs.writeFileSync(path.join(root, 'offline.txt'), 'keep');
        }
        await seedWorkspace(serverUrl, WORKSPACE, 'Local deletion fixture', local);
        await seedWorkspace(secondary.url, WORKSPACE, 'Remote deletion fixture', remote);
        await enable(secondary.url);
        await registerRemoteServer(serverUrl, 'Fixture host', secondary.url);
        await page.goto(serverUrl);
        await selectRepoNamed(page, 'Remote deletion fixture');
        await openExplorerPanel(page);
        const tree = page.locator('[data-testid="unified-panel-explorer-mode"]');
        for (const name of ['file.txt', 'folder']) {
            const node = tree.getByTestId(`tree-node-${name}`);
            await node.click({ button: 'right' });
            await page.getByRole('menuitem', { name: /Delete$/ }).click();
            const deletion = page.waitForRequest(request => request.method() === 'DELETE' && request.url().includes('/entry?'));
            await page.getByRole('button', { name: 'Delete permanently' }).click();
            expect((await deletion).url().startsWith(secondary.url)).toBe(true);
            await expect(node).toHaveCount(0);
            expect(fs.existsSync(path.join(remote, name))).toBe(false);
            expect(fs.existsSync(path.join(local, name))).toBe(true);
        }
        await tree.getByTestId('tree-node-offline.txt').click({ button: 'right' });
        await page.getByRole('menuitem', { name: /Delete$/ }).click();
        await secondary.stop();
        await page.getByRole('button', { name: 'Delete permanently' }).click();
        await expect(page.getByRole('dialog').getByRole('alert')).toBeVisible();
        expect(fs.readFileSync(path.join(local, 'offline.txt'), 'utf8')).toBe('keep');
        expect(fs.readFileSync(path.join(remote, 'offline.txt'), 'utf8')).toBe('keep');
    } finally {
        await secondary.cleanup();
    }
});
