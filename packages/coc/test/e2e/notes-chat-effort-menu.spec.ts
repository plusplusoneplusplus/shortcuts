import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { test, expect, safeRmSync } from './fixtures/server-fixture';
import { request, seedWorkspace } from './fixtures/seed';
import { createRepoFixture } from './fixtures/repo-fixtures';
import { createNotesStore, mockNotesApi, type NoteTreeNode } from './fixtures/notes-fixtures';

const WORKSPACE_ID = 'ws-notes-chat-effort';

function seedTree(): NoteTreeNode[] {
    return [
        {
            name: 'Journal',
            path: 'Journal',
            type: 'notebook',
            children: [
                { name: 'effort-menu.md', path: 'Journal/effort-menu.md', type: 'page' },
            ],
        },
    ];
}

async function enableNotesChatLensWithEffortTiers(serverUrl: string): Promise<void> {
    const response = await request(`${serverUrl}/api/admin/config`, {
        method: 'PUT',
        body: JSON.stringify({
            'features.commitChatLens': true,
            'effortLevels.enabled': true,
        }),
    });
    expect(response.status).toBe(200);
}

test('Notes Chat shows every effort tier outside the anchored settings popover', async ({
    page,
    serverUrl,
}, testInfo) => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-notes-chat-effort-'));
    try {
        const repoDir = createRepoFixture(tmpDir);
        await seedWorkspace(serverUrl, WORKSPACE_ID, 'Notes Chat Effort', repoDir);
        await enableNotesChatLensWithEffortTiers(serverUrl);

        const store = createNotesStore({
            tree: seedTree(),
            content: {
                'Journal/effort-menu.md': '# Effort menu\n\nBrowser regression fixture.',
            },
        });
        await mockNotesApi(page, store);
        await page.route('**/api/agent-providers', route =>
            route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    providers: [
                        { id: 'copilot', label: 'Copilot', enabled: true, available: true },
                    ],
                }),
            }),
        );
        await page.route('**/api/agent-providers/*/models', route =>
            route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ provider: 'copilot', models: [] }),
            }),
        );
        await page.route('**/api/agent-providers/*/effort-tiers', route =>
            route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    provider: 'copilot',
                    effortTiers: {
                        'very-low': { model: 'gpt-5.4-mini', reasoningEffort: 'low', source: 'default' },
                        low: { model: 'gpt-5-mini', reasoningEffort: 'low', source: 'default' },
                        medium: { model: 'gpt-5.4', reasoningEffort: 'medium', source: 'default' },
                        high: { model: 'gpt-5.4', reasoningEffort: 'high', source: 'default' },
                    },
                    defaults: {},
                }),
            }),
        );

        const runtimeErrors: string[] = [];
        page.on('pageerror', error => runtimeErrors.push(error.message));
        page.on('console', message => {
            if (message.type() === 'error' && !message.text().startsWith('Failed to load resource:')) {
                runtimeErrors.push(message.text());
            }
        });

        await page.goto(serverUrl);
        await expect(page.locator('[data-testid="repo-tab"]')).toHaveCount(1, { timeout: 15_000 });
        await page.evaluate(id => {
            location.hash = `#repos/${id}/notes`;
        }, WORKSPACE_ID);
        await expect(page.getByTestId('notes-sidebar')).toBeVisible({ timeout: 15_000 });

        await page.getByTestId('notes-tree-item-Journal').click();
        await page.getByTestId('notes-tree-item-effort-menu.md').click();
        await expect(page.locator('.ProseMirror')).toContainText('Browser regression fixture', { timeout: 10_000 });

        await page.getByTestId('chat-panel-toggle').click();
        const noteChat = page.getByTestId('note-chat-panel');
        await expect(noteChat).toBeVisible();
        await noteChat.getByTestId('compact-ai-settings-chip').click();

        const settingsEditor = noteChat.getByTestId('compact-ai-settings-editor');
        await expect(settingsEditor).toBeVisible();
        await expect(settingsEditor).toHaveAttribute('data-placement', 'popover');
        await settingsEditor.getByTestId('effort-tier-trigger-btn').click();

        const menu = noteChat.getByTestId('effort-tier-menu');
        await expect(menu).toBeVisible();
        await expect(menu.getByRole('option')).toHaveText([
            'Very Low',
            'Low',
            'Medium',
            'High',
        ]);

        const veryLow = menu.getByTestId('effort-tier-option-very-low');
        await expect(veryLow).toBeVisible();
        expect(await veryLow.evaluate(element => {
            const rect = element.getBoundingClientRect();
            const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
            return hit === element || element.contains(hit);
        })).toBe(true);

        await page.screenshot({ path: testInfo.outputPath('notes-chat-effort-menu.png') });
        expect(runtimeErrors).toEqual([]);
    } finally {
        safeRmSync(tmpDir);
    }
});
