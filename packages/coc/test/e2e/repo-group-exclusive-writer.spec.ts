import * as path from 'path';
import * as fs from 'fs';
import { test, expect } from './fixtures/server-fixture';
import { request, seedQueueTask, seedWorkspace } from './fixtures/seed';
import { openAddRepoOption, openRemotePicker } from './fixtures/remote-shell';
import { createMultiCommitRepo } from './fixtures/git-fixtures';
import { createE2EMockSDKService } from './fixtures/mock-ai';

const { createExecutionServer } = require('../../dist/server/index');
const { FileProcessStore } = require('@plusplusoneplusplus/forge');

test('exclusive writer create/edit/settings, authoritative rejection, handoff and saved-conflict warning', async ({ page, serverUrl, dataDir }, testInfo) => {
    test.setTimeout(90_000);
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    const memberId = 'writer-fixture-member';
    const checkout = createMultiCommitRepo(path.join(dataDir, 'checkout'));
    await seedWorkspace(serverUrl, memberId, 'Shared fixture repo', checkout);
    const flag = async (enabled: boolean) => {
        const response = await request(`${serverUrl}/api/admin/config`, {
            method: 'PUT', body: JSON.stringify({ 'features.repoGroupExclusiveWriter': enabled }),
        });
        expect(response.status).toBe(200);
    };
    await flag(true);
    const create = async (name: string) => {
        const response = await request(`${serverUrl}/api/repo-groups`, {
            method: 'POST', body: JSON.stringify({ name, members: [memberId] }),
        });
        expect(response.status).toBe(201);
        return JSON.parse(response.body).workspace.id as string;
    };
    const read = async (id: string) => JSON.parse((await request(`${serverUrl}/api/repo-groups/${id}`)).body);
    const firstId = await create('First writer');
    await page.goto(`${serverUrl}/#repos/${firstId}/settings`);
    await expect(page.getByTestId(`repo-group-member-row-${memberId}`)).toContainText('Writer');
    await page.goto(`${serverUrl}/#repos/${memberId}/chats`);
    await openAddRepoOption(page, 'remote-new-repo-group-option');
    await page.getByTestId('repo-group-name-input').fill('Second group');
    await page.getByTestId(`repo-group-member-check-${memberId}`).check();
    const toggle = page.getByTestId(`repo-group-member-read-only-${memberId}`);
    await expect(toggle).toBeChecked();
    await expect(page.locator('#repo-group-dialog')).toContainText('Shared repository');
    await expect(page.locator('#repo-group-dialog')).toContainText('First writer');
    await toggle.focus();
    await page.keyboard.press('Space');
    await page.getByTestId(`repo-group-member-description-${memberId}`).fill('Preserved draft');
    await page.getByTestId('repo-group-save-btn').click();
    await expect(page.locator('#repo-group-dialog [role="alert"]')).toContainText('Writer conflict');
    await expect(page.getByTestId('repo-group-name-input')).toHaveValue('Second group');
    await expect(page.getByTestId(`repo-group-member-description-${memberId}`)).toHaveValue('Preserved draft');
    await expect(toggle).not.toBeChecked();
    await expect(page.locator('#repo-group-dialog').getByRole('link', { name: 'Open writer group' }))
        .toHaveAttribute('href', `#repos/${firstId}/settings`);
    await page.screenshot({ path: testInfo.outputPath('rejected-create.png') });
    await toggle.check();
    await page.getByTestId('repo-group-save-btn').click();
    await expect(page.locator('#repo-group-dialog')).toBeHidden();
    const workspaces = JSON.parse((await request(`${serverUrl}/api/workspaces`)).body).workspaces;
    const secondId = workspaces.find((ws: any) => ws.name === 'Second group').id;
    expect((await read(secondId)).members[0]).toMatchObject({ readOnly: true, description: 'Preserved draft' });

    await page.goto(`${serverUrl}/#repos/${secondId}/settings`);
    const row = page.getByTestId(`repo-group-member-row-${memberId}`);
    await expect(row).toContainText('Read-only');
    await page.getByTestId(`repo-group-member-read-only-${memberId}`).uncheck();
    await expect(row.getByRole('alert')).toContainText('Writer conflict');
    await expect(page.getByTestId(`repo-group-member-read-only-${memberId}`)).toBeChecked();
    expect((await read(secondId)).members[0].readOnly).toBe(true);
    await row.getByRole('link', { name: 'Open writer group' }).click();
    await expect(page).toHaveURL(`${serverUrl}/#repos/${firstId}/settings`);
    await page.getByTestId(`repo-group-member-read-only-${memberId}`).check();
    await expect.poll(async () => (await read(firstId)).members[0].readOnly).toBe(true);
    await page.goto(`${serverUrl}/#repos/${secondId}/settings`);
    await page.getByTestId(`repo-group-member-read-only-${memberId}`).uncheck();
    await expect.poll(async () => (await read(secondId)).members[0].readOnly).toBe(false);

    // Queued work remains admitted even while the saved membership is read-only.
    await request(`${serverUrl}/api/queue/pause`, { method: 'POST', body: '{}' });
    const queued = await seedQueueTask(serverUrl, {
        repoId: firstId, payload: { kind: 'chat', mode: 'ask', prompt: 'Queued fixture', workspaceId: firstId },
    });
    expect(queued.status).toBe('queued');
    const standalone = await seedQueueTask(serverUrl, {
        repoId: memberId, payload: { kind: 'chat', mode: 'autopilot', prompt: 'Standalone fixture', workspaceId: memberId },
    });
    expect(standalone.status).toBe('queued');

    // Seed conflicting saved memberships only on this fixture server, then inspect
    // the flag-on warning without forcing either writer to read-only.
    await flag(false);
    const thirdId = await create('Third saved writer');
    await flag(true);
    await page.goto(`${serverUrl}/#repos/${memberId}/chats`);
    await openRemotePicker(page, 'Third saved writer');
    await expect(page.getByTestId('repo-group-item')).toBeVisible();
    await page.keyboard.press('Escape');
    await page.goto(`${serverUrl}/#repos/${thirdId}/settings`);
    await expect(row.getByRole('alert')).toContainText('Second group');
    await expect(row.getByRole('alert')).toContainText('Third saved writer');
    await expect(row.getByRole('link', { name: 'Open writer group' })).toHaveCount(2);
    expect((await read(secondId)).members[0].readOnly).toBe(false);
    expect((await read(thirdId)).members[0].readOnly).toBe(false);

    await page.goto(`${serverUrl}/#repos/${memberId}/chats`);
    await openRemotePicker(page, 'Third saved writer');
    await page.getByTestId('repo-group-row-menu').click();
    await page.getByRole('menuitem', { name: /Edit/ }).click();
    await expect(page.locator('#repo-group-dialog')).toBeVisible();
    await expect(page.locator('#repo-group-dialog')).toContainText('Writer conflict');
    await page.getByTestId('repo-group-name-input').fill('Renamed saved writer');
    await page.getByTestId('repo-group-save-btn').click();
    await expect(page.locator('#repo-group-dialog')).toBeHidden();
    expect((await read(thirdId)).name).toBe('Renamed saved writer');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${serverUrl}/#repos/${thirdId}/settings`);
    await expect(row).toContainText('Writer conflict');
    const width = await row.evaluate(element => ({ scroll: element.scrollWidth, client: element.clientWidth }));
    expect(width.scroll).toBeLessThanOrEqual(width.client + 1);
    await page.screenshot({ path: testInfo.outputPath('narrow-saved-conflicts.png') });
    await page.getByTestId('repo-group-name-back').click();
    await page.getByRole('button', { name: 'More actions for Renamed saved writer' }).click();
    await page.getByRole('menuitem', { name: /Edit/ }).click();
    await expect(page.locator('#repo-group-dialog')).toContainText('Writer conflict');
    const dialogWidth = await page.locator('#repo-group-dialog').evaluate(element => ({
        scroll: element.scrollWidth, client: element.clientWidth,
    }));
    expect(dialogWidth.scroll).toBeLessThanOrEqual(dialogWidth.client + 1);
    await page.screenshot({ path: testInfo.outputPath('narrow-edit-conflicts.png') });
    expect(errors).toEqual([]);
});

test('remote owner capability, authoritative save and writer links stay separate from the flag-off page origin', async ({ page, serverUrl, dataDir }) => {
    test.setTimeout(90_000);
    const remoteDir = path.join(dataDir, 'remote-owner');
    fs.mkdirSync(remoteDir);
    const configPath = path.join(remoteDir, 'config.yaml');
    fs.writeFileSync(configPath, 'features:\n  repoGroupExclusiveWriter: true\n  scopeSwitcher: false\n');
    const memoryDir = path.join(remoteDir, 'memory');
    fs.mkdirSync(memoryDir);
    fs.writeFileSync(path.join(remoteDir, 'memory-config.json'), JSON.stringify({ storageDir: memoryDir }));
    const remote = await createExecutionServer({
        store: new FileProcessStore({ dataDir: remoteDir }),
        port: 0, host: '127.0.0.1', dataDir: remoteDir, configPath,
        aiService: createE2EMockSDKService().service,
    });
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    try {
        const memberId = 'remote-writer-fixture';
        await seedWorkspace(serverUrl, memberId, 'Local fixture', createMultiCommitRepo(path.join(dataDir, 'local-checkout')));
        await seedWorkspace(remote.url, memberId, 'Remote fixture', createMultiCommitRepo(path.join(remoteDir, 'checkout')));
        const create = async (baseUrl: string, name: string) => {
            const response = await request(`${baseUrl}/api/repo-groups`, {
                method: 'POST', body: JSON.stringify({ name, members: [memberId] }),
            });
            expect(response.status).toBe(201);
            return JSON.parse(response.body).workspace.id as string;
        };
        const localOwnerId = await create(serverUrl, 'Owner');
        const remoteOwnerId = await create(remote.url, 'Owner');
        expect(localOwnerId).toBe(remoteOwnerId);
        await page.route(`${serverUrl}/api/servers`, route => route.fulfill({
            contentType: 'application/json',
            body: JSON.stringify([{ id: 'fixture-owner', label: 'Fixture owner', status: 'online', effectiveUrl: remote.url }]),
        }));
        await page.goto(`${serverUrl}/#repos/${memberId}/chats`);
        await openAddRepoOption(page, 'remote-new-repo-group-option');
        await page.getByTestId('repo-group-server-select').selectOption('fixture-owner');
        await page.getByTestId('repo-group-name-input').fill('Remote second');
        await page.getByTestId(`repo-group-member-check-${memberId}`).check();
        const toggle = page.getByTestId(`repo-group-member-read-only-${memberId}`);
        await expect(toggle).toBeChecked();
        const remoteLink = `#repos/remote%3Afixture-owner%3A${remoteOwnerId}/settings`;
        await expect(page.locator('#repo-group-dialog').getByRole('link', { name: 'Open writer group' }))
            .toHaveAttribute('href', remoteLink);
        await toggle.uncheck();
        await page.getByTestId('repo-group-save-btn').click();
        await expect(page.locator('#repo-group-dialog [role="alert"]')).toContainText('Writer conflict');
        await toggle.check();
        await page.getByTestId('repo-group-save-btn').click();
        await expect(page.locator('#repo-group-dialog')).toBeHidden();
        const remoteGroup = JSON.parse((await request(`${remote.url}/api/repo-groups/group-remote-second`)).body);
        expect(remoteGroup.members[0].readOnly).toBe(true);
        expect((await request(`${serverUrl}/api/repo-groups/group-remote-second`)).status).toBe(404);
        const owner = JSON.parse((await request(`${serverUrl}/api/repo-groups/${localOwnerId}`)).body);
        expect(owner.members[0].readOnly).toBe(false);
        await page.goto(`${serverUrl}/?remoteFixture#repos/remote%3Afixture-owner%3Agroup-remote-second/settings`);
        const row = page.getByTestId(`repo-group-member-row-${memberId}`);
        await expect(row).toContainText('Shared repository');
        await page.getByTestId(`repo-group-member-read-only-${memberId}`).uncheck();
        await expect(row.getByRole('alert')).toContainText('Writer conflict');
        await expect(row.getByRole('link', { name: 'Open writer group' })).toHaveAttribute('href', remoteLink);
        await row.getByRole('link', { name: 'Open writer group' }).click();
        await expect(page).toHaveURL(new RegExp(`remote%3Afixture-owner%3A${remoteOwnerId}/settings$`));
        await expect(row).toContainText('Writer');
        expect(errors).toEqual([]);
    } finally {
        await remote.close();
    }
});
