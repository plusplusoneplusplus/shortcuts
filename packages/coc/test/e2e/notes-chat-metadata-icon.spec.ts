import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { test, expect, safeRmSync } from './fixtures/server-fixture';
import { request, seedProcess, seedWorkspace } from './fixtures/seed';
import { createRepoFixture } from './fixtures/repo-fixtures';
import { createNotesStore, mockNotesApi, type NoteTreeNode } from './fixtures/notes-fixtures';

const WORKSPACE_ID = 'ws-notes-chat-meta';
const NOTE_PATH = 'Journal/metadata.md';
const TASK_ID = 'notes-meta-task';

function seedTree(): NoteTreeNode[] {
    return [
        {
            name: 'Journal',
            path: 'Journal',
            type: 'notebook',
            children: [
                { name: 'metadata.md', path: NOTE_PATH, type: 'page' },
            ],
        },
    ];
}

test('Notes Chat header exposes the conversation metadata popover', async ({ page, serverUrl }, testInfo) => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-notes-chat-meta-'));
    try {
        const repoDir = createRepoFixture(tmpDir);
        await seedWorkspace(serverUrl, WORKSPACE_ID, 'Notes Chat Metadata', repoDir);

        // An existing completed conversation bound to the note, so the panel
        // opens straight into the active-chat state.
        await seedProcess(serverUrl, `queue_${TASK_ID}`, {
            workspaceId: WORKSPACE_ID,
            type: 'chat',
            status: 'completed',
            promptPreview: 'What is this note about?',
            metadata: { queueTaskId: TASK_ID, mode: 'ask', notePath: NOTE_PATH, noteTitle: 'metadata' },
        });
        const bindRes = await request(
            `${serverUrl}/api/workspaces/${encodeURIComponent(WORKSPACE_ID)}/notes/chat-bindings/by-path?path=${encodeURIComponent(NOTE_PATH)}`,
            { method: 'PUT', body: JSON.stringify({ taskId: TASK_ID }) },
        );
        expect(bindRes.status).toBe(200);

        const store = createNotesStore({
            tree: seedTree(),
            content: { [NOTE_PATH]: '# Metadata\n\nBrowser regression fixture.' },
        });
        await mockNotesApi(page, store);

        await page.goto(serverUrl);
        await expect(page.locator('[data-testid="repo-tab"]')).toHaveCount(1, { timeout: 15_000 });
        await page.evaluate(id => {
            location.hash = `#repos/${id}/notes`;
        }, WORKSPACE_ID);
        await expect(page.getByTestId('notes-sidebar')).toBeVisible({ timeout: 15_000 });

        await page.getByTestId('notes-tree-item-Journal').click();
        await page.getByTestId('notes-tree-item-metadata.md').click();
        await expect(page.locator('.ProseMirror')).toContainText('Browser regression fixture', { timeout: 10_000 });

        await page.getByTestId('chat-panel-toggle').click();
        const noteChat = page.getByTestId('note-chat-panel');
        await expect(noteChat).toBeVisible();
        await expect(noteChat.getByTestId('activity-chat-detail')).toBeVisible({ timeout: 15_000 });

        const header = noteChat.getByTestId('notes-chat-header');
        const info = header.getByRole('button', { name: /conversation metadata/i });
        await expect(info).toBeVisible({ timeout: 15_000 });

        await info.click();
        await expect(page.getByText('Conversation metadata')).toBeVisible();
        await expect(page.getByText(`queue_${TASK_ID}`)).toBeVisible();

        await page.screenshot({ path: testInfo.outputPath('notes-chat-metadata-icon.png') });
    } finally {
        safeRmSync(tmpDir);
    }
});
