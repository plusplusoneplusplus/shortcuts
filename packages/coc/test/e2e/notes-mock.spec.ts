/**
 * Notes page — mocked notes-API data (E2E).
 *
 * First browser coverage of the CoC Notes feature driven by mocked notes-API
 * data. Prior to this spec the notes read/write endpoints and the Notes page UI
 * had zero e2e coverage: the only e2e reference to the notes content API was a
 * NEGATIVE assertion (task-preview-note-editor.spec.ts:96, "notes content API
 * is NOT called"). This spec inverts that — it asserts the notes content API IS
 * called and that mocked note content renders in the browser editor.
 *
 * The workspace is still seeded server-side (so the page can route to it), but
 * the notes API itself is served entirely from an in-memory mock — no real note
 * files on disk. See fixtures/notes-fixtures.ts.
 *
 * Shell note: the Notes page renders under the pinned classic shell (the E2E
 * config pins features.remoteShell off) with no /api/config/runtime override —
 * NotesView has no remoteShell gate and the notes sub-tab is registered plainly.
 * Hash routing (#repos/{id}/notes) selects the repo and the notes sub-tab
 * regardless of shell.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { test, expect, safeRmSync } from './fixtures/server-fixture';
import { seedWorkspace } from './fixtures/seed';
import { createRepoFixture } from './fixtures/repo-fixtures';
import { createNotesStore, mockNotesApi, type NoteTreeNode } from './fixtures/notes-fixtures';

const WS_ID = 'ws-notes-mock';

/** A notebook with two pages — the minimum tree AC-02 exercises. */
function seedTree(): NoteTreeNode[] {
    return [
        {
            name: 'Journal',
            path: 'Journal',
            type: 'notebook',
            children: [
                { name: 'getting-started.md', path: 'Journal/getting-started.md', type: 'page' },
                { name: 'second-page.md', path: 'Journal/second-page.md', type: 'page' },
            ],
        },
    ];
}

/**
 * Navigate to the workspace Notes sub-tab by hash and wait for the sidebar.
 * Waits for the workspace list to hydrate (repo-tab present) before setting the
 * hash so routing resolves the selected repo. Mirrors notes-status-dock.spec.ts.
 */
async function openNotesPage(
    page: import('@playwright/test').Page,
    serverUrl: string,
    wsId: string,
): Promise<void> {
    await page.goto(serverUrl);
    // Repos is the default view; wait for the seeded workspace to load.
    await expect(page.locator('[data-testid="repo-tab"]')).toHaveCount(1, { timeout: 15_000 });
    await page.evaluate((id) => {
        location.hash = `#repos/${id}/notes`;
    }, wsId);
    await expect(page.locator('[data-testid="notes-sidebar"]')).toBeVisible({ timeout: 15_000 });
}

test.describe('Notes page — mocked notes API', () => {
    test('renders the mocked tree and a mocked note body in the editor', async ({
        page,
        serverUrl,
    }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-notes-mock-'));
        try {
            const repoDir = createRepoFixture(tmpDir);
            await seedWorkspace(serverUrl, WS_ID, `${WS_ID}-repo`, repoDir);

            const store = createNotesStore({
                tree: seedTree(),
                content: {
                    'Journal/getting-started.md':
                        '# Getting Started\n\nWelcome to the mocked notebook.',
                    'Journal/second-page.md': '# Second Page\n\nAnother mocked note body.',
                },
            });
            await mockNotesApi(page, store);

            await openNotesPage(page, serverUrl, WS_ID);

            // The tree area and the mocked notebook render from GET notes/tree.
            await expect(page.locator('[data-testid="notes-tree-area"]')).toBeVisible({
                timeout: 10_000,
            });
            const notebookRow = page.locator('[data-testid="notes-tree-item-Journal"]');
            await expect(notebookRow).toBeVisible({ timeout: 10_000 });

            // Expand the notebook, then open the first page.
            await notebookRow.click();
            const pageRow = page.locator('[data-testid="notes-tree-item-getting-started.md"]');
            await expect(pageRow).toBeVisible({ timeout: 5_000 });
            await pageRow.click();

            // The mocked markdown body renders inside the ProseMirror editor.
            // This is the assertion on mocked content that has never existed.
            const editor = page.locator('.ProseMirror');
            await expect(editor).toBeVisible({ timeout: 10_000 });
            await expect(editor).toContainText('Welcome to the mocked notebook', { timeout: 10_000 });

            // GET /api/workspaces/*/notes/content* DID fire for the clicked page —
            // the exact inverse of task-preview-note-editor.spec.ts:96.
            const contentGets = store.requestsFor('content-get');
            expect(contentGets.length).toBeGreaterThanOrEqual(1);
            expect(contentGets.some((r) => r.query.path === 'Journal/getting-started.md')).toBe(true);
        } finally {
            safeRmSync(tmpDir);
        }
    });

    test('autosaves an edit via PUT notes/content and reaches the saved state', async ({
        page,
        serverUrl,
    }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-notes-mock-'));
        try {
            const repoDir = createRepoFixture(tmpDir);
            await seedWorkspace(serverUrl, WS_ID, `${WS_ID}-repo`, repoDir);

            const store = createNotesStore({
                tree: seedTree(),
                content: {
                    'Journal/getting-started.md':
                        '# Getting Started\n\nWelcome to the mocked notebook.',
                    'Journal/second-page.md': '# Second Page\n\nAnother mocked note body.',
                },
            });
            await mockNotesApi(page, store);

            await openNotesPage(page, serverUrl, WS_ID);

            // Open the first page in the editor.
            await page.locator('[data-testid="notes-tree-item-Journal"]').click();
            const pageRow = page.locator('[data-testid="notes-tree-item-getting-started.md"]');
            await expect(pageRow).toBeVisible({ timeout: 5_000 });
            await pageRow.click();

            const editor = page.locator('.ProseMirror');
            await expect(editor).toBeVisible({ timeout: 10_000 });
            await expect(editor).toContainText('Welcome to the mocked notebook', { timeout: 10_000 });

            // Register the autosave-PUT wait BEFORE typing so the debounced request
            // (useMarkdownDocumentSession, 1500ms) is not missed. The predicate
            // requires our marker in the body, so any spurious pre-edit save (e.g. a
            // markdown round-trip normalization) is ignored — we only match the PUT
            // that actually carries the edit. A distinctive alphanumeric marker
            // survives markdown serialization unescaped.
            const MARKER = 'AutosaveMarker42';
            const putRequest = page.waitForRequest(
                (req) =>
                    req.method() === 'PUT' &&
                    /\/notes\/content(\?|$)/.test(req.url()) &&
                    (req.postData() ?? '').includes(MARKER),
                { timeout: 20_000 },
            );

            // Place the cursor at the end of the mocked paragraph and append the
            // marker. Clicking the paragraph (not the heading) keeps the edit inside
            // the body text; End moves to the paragraph end so the marker appends.
            const paragraph = editor.locator('p:has-text("Welcome to the mocked notebook")');
            await paragraph.click();
            await page.keyboard.press('End');
            await page.keyboard.type(` ${MARKER}`);

            // AC-03 core: the intercepted PUT carries the edited markdown — assert on
            // the request payload, not just that a request happened.
            const put = await putRequest;
            const body = put.postDataJSON() as { path?: string; content?: string };
            expect(body.path).toBe('Journal/getting-started.md');
            expect(body.content).toContain(MARKER);
            // Original body content is preserved alongside the edit.
            expect(body.content).toContain('Getting Started');

            // The save-indicator reaches its saved state ("Saved ✓"). Waiting on
            // this also guarantees the mock's route handler has run to completion
            // (it records the request before fulfilling the 200 that flips the
            // indicator), so the store assertion below is not racing the dispatch.
            await expect(page.locator('[data-testid="save-indicator"]')).toContainText('Saved', {
                timeout: 10_000,
            });

            // The mock recorded the same documented PUT with the edited body.
            const puts = store.requestsFor('content-put');
            expect(puts.length).toBeGreaterThanOrEqual(1);
            expect(puts.some((r) => (r.body as { content?: string })?.content?.includes(MARKER))).toBe(
                true,
            );
        } finally {
            safeRmSync(tmpDir);
        }
    });
});
