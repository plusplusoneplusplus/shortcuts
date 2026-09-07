import * as fs from 'fs';
import * as path from 'path';
import { test, expect } from './fixtures/server-fixture';
import { request, seedQueueTask, seedWorkspace } from './fixtures/seed';

const PNG_BASE64 =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

test.use({ processStoreBackend: 'sqlite' });

test('assistant image links render a decoded image instead of base64 source text', async ({
    page, serverUrl, dataDir, mockAI,
}, testInfo) => {
    const workspaceId = 'ws-source-canvas-image';
    const rootPath = path.join(dataDir, 'workspace');
    fs.mkdirSync(rootPath);
    const imagePath = path.join(rootPath, 'dashboard.png');
    fs.writeFileSync(imagePath, Buffer.from(PNG_BASE64, 'base64'));
    await seedWorkspace(serverUrl, workspaceId, 'Image preview', rootPath);

    mockAI.mockSendMessage.mockResolvedValueOnce({
        success: true,
        response: `Screenshot: [dashboard.png](<${imagePath.replace(/\\/g, '/')}>).`,
        sessionId: 'source-canvas-image-session',
    });
    const task = await seedQueueTask(serverUrl, {
        repoId: workspaceId,
        payload: { workspaceId, prompt: 'Show the screenshot.' },
    });
    await expect.poll(async () => {
        const response = await request(`${serverUrl}/api/queue/${task.id}`);
        const body = JSON.parse(response.body);
        return (body.task ?? body).status;
    }).toBe('completed');

    const pageErrors: string[] = [];
    const consoleErrors: string[] = [];
    page.on('pageerror', error => pageErrors.push(error.stack || error.message));
    page.on('console', message => {
        if (message.type() === 'error') consoleErrors.push(message.text());
    });
    await page.goto(`${serverUrl}/#repos/${workspaceId}/activity/queue_${task.id}`);
    const assistant = page.locator('.chat-message.assistant');
    await assistant.getByRole('link', { name: 'dashboard.png', exact: true }).click();

    const panel = page.getByTestId('source-canvas-panel');
    await expect(panel).toBeVisible();
    const image = panel.getByRole('img', { name: 'dashboard.png', exact: true });
    await expect(image).toBeVisible();
    await expect.poll(() => image.evaluate((element: HTMLImageElement) => (
        element.complete && element.naturalWidth > 0 && element.naturalHeight > 0
    ))).toBe(true);
    await expect(panel.getByTestId('source-canvas-source')).toHaveCount(0);
    await expect(panel).not.toContainText(PNG_BASE64);
    await testInfo.attach('source-canvas-image', {
        body: await panel.screenshot(),
        contentType: 'image/png',
    });

    expect(pageErrors).toEqual([]);
    expect(consoleErrors).toEqual([]);
});
