/**
 * Commit-Chat Binding E2E Tests
 *
 * Tests the commit-chat binding feature end-to-end:
 *   - CommitChatPanel rendering when toggling chat on a commit
 *   - Creating a binding (via UI flow through the CommitChatPanel)
 *   - Viewing an existing binding (pre-seeded via API)
 *   - Rebind endpoint (re-maps binding to new commit hash)
 *   - Cross-workspace isolation
 *   - Delete binding
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { test, expect, safeRmSync } from './fixtures/server-fixture';
import { createMultiCommitRepo, navigateToGitTab } from './fixtures/git-fixtures';
import { request, seedWorkspace } from './fixtures/seed';

/** Dismiss onboarding overlays (welcome modal + concept tour) so they don't block UI. */
async function dismissOnboarding(serverUrl: string): Promise<void> {
    await request(`${serverUrl}/api/preferences`, {
        method: 'PATCH',
        body: JSON.stringify({
            hasSeenWelcome: true,
            onboardingProgress: { dismissed: true, hasCompletedTour: true },
        }),
    });
}

// ================================================================
// CommitChatPanel — rendering
// ================================================================

test.describe('Commit-Chat Binding — CommitChatPanel rendering', () => {
    test('clicking toggle-chat-btn opens CommitChatPanel with empty state', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-ccb-render-'));
        try {
            const repoDir = createMultiCommitRepo(tmpDir);
            await dismissOnboarding(serverUrl);
            await navigateToGitTab(page, serverUrl, 'ws-ccb-r1', 'ccb-render', repoDir);

            await expect(page.getByTestId('commit-list-loading')).toBeHidden({ timeout: 10_000 });

            // Click first commit to show CommitDetail
            await page.locator('[data-testid^="commit-row-"]').first().click();
            await expect(page.getByTestId('commit-detail')).toBeVisible({ timeout: 10_000 });

            // Open the chat panel
            await page.getByTestId('toggle-chat-btn').click();
            await expect(page.getByTestId('commit-chat-panel')).toBeVisible({ timeout: 5_000 });

            // Should show empty state with send button
            await expect(page.getByTestId('commit-chat-send-btn')).toBeVisible();
        } finally {
            safeRmSync(tmpDir);
        }
    });

    test('closing CommitChatPanel hides it', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-ccb-close-'));
        try {
            const repoDir = createMultiCommitRepo(tmpDir);
            await dismissOnboarding(serverUrl);
            await navigateToGitTab(page, serverUrl, 'ws-ccb-c1', 'ccb-close', repoDir);

            await expect(page.getByTestId('commit-list-loading')).toBeHidden({ timeout: 10_000 });

            await page.locator('[data-testid^="commit-row-"]').first().click();
            await expect(page.getByTestId('commit-detail')).toBeVisible({ timeout: 10_000 });

            // Open then close
            await page.getByTestId('toggle-chat-btn').click();
            await expect(page.getByTestId('commit-chat-panel')).toBeVisible({ timeout: 5_000 });

            await page.getByTestId('toggle-chat-btn').click();
            await expect(page.getByTestId('commit-chat-panel')).toBeHidden({ timeout: 5_000 });
        } finally {
            safeRmSync(tmpDir);
        }
    });
});

// ================================================================
// Create binding — via API
// ================================================================

test.describe('Commit-Chat Binding — CRUD via API', () => {
    test('creates a chat binding for a commit', async ({ serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-ccb-create-'));
        try {
            const repoDir = createMultiCommitRepo(tmpDir);
            const wsId = 'ws-ccb-crud1';
            await seedWorkspace(serverUrl, wsId, 'ccb-crud', repoDir);

            const hash = execFileSync('git', ['rev-parse', 'HEAD'], {
                cwd: repoDir, encoding: 'utf-8',
            }).trim();

            // Create binding
            const createRes = await request(`${serverUrl}/api/workspaces/${wsId}/commit-chat-bindings`, {
                method: 'POST',
                body: JSON.stringify({ commitHash: hash, taskId: 'task-e2e-1' }),
            });
            expect(createRes.status).toBe(201);
            const created = JSON.parse(createRes.body);
            expect(created.commitHash).toBe(hash);
            expect(created.taskId).toBe('task-e2e-1');

            // Verify via GET
            const getRes = await request(`${serverUrl}/api/workspaces/${wsId}/commit-chat-bindings/${hash}`);
            expect(getRes.status).toBe(200);
            const fetched = JSON.parse(getRes.body);
            expect(fetched.taskId).toBe('task-e2e-1');
        } finally {
            safeRmSync(tmpDir);
        }
    });

    test('lists all bindings for a workspace', async ({ serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-ccb-list-'));
        try {
            const repoDir = createMultiCommitRepo(tmpDir);
            const wsId = 'ws-ccb-list1';
            await seedWorkspace(serverUrl, wsId, 'ccb-list', repoDir);

            // Get two commit hashes
            const hashes = execFileSync('git', ['log', '--format=%H', '-2'], {
                cwd: repoDir, encoding: 'utf-8',
            }).trim().split('\n');

            // Create two bindings
            await request(`${serverUrl}/api/workspaces/${wsId}/commit-chat-bindings`, {
                method: 'POST',
                body: JSON.stringify({ commitHash: hashes[0], taskId: 'task-list-1' }),
            });
            await request(`${serverUrl}/api/workspaces/${wsId}/commit-chat-bindings`, {
                method: 'POST',
                body: JSON.stringify({ commitHash: hashes[1], taskId: 'task-list-2' }),
            });

            // List all
            const listRes = await request(`${serverUrl}/api/workspaces/${wsId}/commit-chat-bindings`);
            expect(listRes.status).toBe(200);
            const data = JSON.parse(listRes.body);
            expect(data.bindings[hashes[0]].taskId).toBe('task-list-1');
            expect(data.bindings[hashes[1]].taskId).toBe('task-list-2');
        } finally {
            safeRmSync(tmpDir);
        }
    });

    test('deletes a binding and verifies removal', async ({ serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-ccb-del-'));
        try {
            const repoDir = createMultiCommitRepo(tmpDir);
            const wsId = 'ws-ccb-del1';
            await seedWorkspace(serverUrl, wsId, 'ccb-del', repoDir);

            const hash = execFileSync('git', ['rev-parse', 'HEAD'], {
                cwd: repoDir, encoding: 'utf-8',
            }).trim();

            // Create then delete
            await request(`${serverUrl}/api/workspaces/${wsId}/commit-chat-bindings`, {
                method: 'POST',
                body: JSON.stringify({ commitHash: hash, taskId: 'task-del-1' }),
            });

            const delRes = await request(`${serverUrl}/api/workspaces/${wsId}/commit-chat-bindings/${hash}`, {
                method: 'DELETE',
            });
            expect(delRes.status).toBe(204);

            // Verify removal
            const getRes = await request(`${serverUrl}/api/workspaces/${wsId}/commit-chat-bindings/${hash}`);
            expect(getRes.status).toBe(404);
        } finally {
            safeRmSync(tmpDir);
        }
    });

    test('overwriting a binding replaces the taskId', async ({ serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-ccb-ow-'));
        try {
            const repoDir = createMultiCommitRepo(tmpDir);
            const wsId = 'ws-ccb-ow1';
            await seedWorkspace(serverUrl, wsId, 'ccb-ow', repoDir);

            const hash = execFileSync('git', ['rev-parse', 'HEAD'], {
                cwd: repoDir, encoding: 'utf-8',
            }).trim();

            // Create initial binding
            await request(`${serverUrl}/api/workspaces/${wsId}/commit-chat-bindings`, {
                method: 'POST',
                body: JSON.stringify({ commitHash: hash, taskId: 'task-old' }),
            });

            // Overwrite with new taskId
            await request(`${serverUrl}/api/workspaces/${wsId}/commit-chat-bindings`, {
                method: 'POST',
                body: JSON.stringify({ commitHash: hash, taskId: 'task-new' }),
            });

            const getRes = await request(`${serverUrl}/api/workspaces/${wsId}/commit-chat-bindings/${hash}`);
            expect(getRes.status).toBe(200);
            expect(JSON.parse(getRes.body).taskId).toBe('task-new');
        } finally {
            safeRmSync(tmpDir);
        }
    });
});

// ================================================================
// Rebind — re-map binding after rebase
// ================================================================

test.describe('Commit-Chat Binding — Rebind', () => {
    test('rebind updates SHA and preserves taskId', async ({ serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-ccb-rebind-'));
        try {
            const repoDir = createMultiCommitRepo(tmpDir);
            const wsId = 'ws-ccb-rb1';
            await seedWorkspace(serverUrl, wsId, 'ccb-rebind', repoDir);

            // Get two different commit hashes (simulate old→new after rebase)
            const hashes = execFileSync('git', ['log', '--format=%H', '-2'], {
                cwd: repoDir, encoding: 'utf-8',
            }).trim().split('\n');
            const oldHash = hashes[0];
            const newHash = hashes[1];

            // Create binding on old hash
            await request(`${serverUrl}/api/workspaces/${wsId}/commit-chat-bindings`, {
                method: 'POST',
                body: JSON.stringify({ commitHash: oldHash, taskId: 'task-rebind' }),
            });

            // Rebind to new hash
            const rebindRes = await request(
                `${serverUrl}/api/workspaces/${wsId}/commit-chat-bindings/rebind`,
                {
                    method: 'POST',
                    body: JSON.stringify({ oldHash, newHash }),
                },
            );
            expect(rebindRes.status).toBe(200);
            const rebindData = JSON.parse(rebindRes.body);
            expect(rebindData.oldHash).toBe(oldHash);
            expect(rebindData.newHash).toBe(newHash);
            expect(rebindData.taskId).toBe('task-rebind');

            // Old hash should be gone
            const oldRes = await request(`${serverUrl}/api/workspaces/${wsId}/commit-chat-bindings/${oldHash}`);
            expect(oldRes.status).toBe(404);

            // New hash should have the binding
            const newRes = await request(`${serverUrl}/api/workspaces/${wsId}/commit-chat-bindings/${newHash}`);
            expect(newRes.status).toBe(200);
            expect(JSON.parse(newRes.body).taskId).toBe('task-rebind');
        } finally {
            safeRmSync(tmpDir);
        }
    });

    test('rebind returns 404 when old hash has no binding', async ({ serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-ccb-rb404-'));
        try {
            const repoDir = createMultiCommitRepo(tmpDir);
            const wsId = 'ws-ccb-rb2';
            await seedWorkspace(serverUrl, wsId, 'ccb-rb404', repoDir);

            const res = await request(
                `${serverUrl}/api/workspaces/${wsId}/commit-chat-bindings/rebind`,
                {
                    method: 'POST',
                    body: JSON.stringify({ oldHash: 'deadbeef', newHash: 'cafebabe' }),
                },
            );
            expect(res.status).toBe(404);
        } finally {
            safeRmSync(tmpDir);
        }
    });
});

// ================================================================
// Cross-workspace isolation
// ================================================================

test.describe('Commit-Chat Binding — Cross-workspace isolation', () => {
    test('bindings for one workspace are not visible in another', async ({ serverUrl }) => {
        const tmpDirA = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-ccb-isoA-'));
        const tmpDirB = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-ccb-isoB-'));
        try {
            const repoDirA = createMultiCommitRepo(tmpDirA);
            const repoDirB = createMultiCommitRepo(tmpDirB);
            const wsA = 'ws-ccb-isoA';
            const wsB = 'ws-ccb-isoB';
            await seedWorkspace(serverUrl, wsA, 'ccb-isoA', repoDirA);
            await seedWorkspace(serverUrl, wsB, 'ccb-isoB', repoDirB);

            const hashA = execFileSync('git', ['rev-parse', 'HEAD'], {
                cwd: repoDirA, encoding: 'utf-8',
            }).trim();

            // Create binding in workspace A
            await request(`${serverUrl}/api/workspaces/${wsA}/commit-chat-bindings`, {
                method: 'POST',
                body: JSON.stringify({ commitHash: hashA, taskId: 'task-iso-A' }),
            });

            // Verify binding in workspace A
            const resA = await request(`${serverUrl}/api/workspaces/${wsA}/commit-chat-bindings/${hashA}`);
            expect(resA.status).toBe(200);
            expect(JSON.parse(resA.body).taskId).toBe('task-iso-A');

            // Same hash in workspace B should not return the binding
            const resB = await request(`${serverUrl}/api/workspaces/${wsB}/commit-chat-bindings/${hashA}`);
            expect(resB.status).toBe(404);

            // Workspace B's list should be empty
            const listB = await request(`${serverUrl}/api/workspaces/${wsB}/commit-chat-bindings`);
            expect(listB.status).toBe(200);
            expect(JSON.parse(listB.body).bindings).toEqual({});
        } finally {
            safeRmSync(tmpDirA);
            safeRmSync(tmpDirB);
        }
    });
});

// ================================================================
// UI flow — create binding via CommitChatPanel
// ================================================================

test.describe('Commit-Chat Binding — UI create flow', () => {
    test('sending a message in CommitChatPanel creates a binding', async ({ page, serverUrl, mockAI }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-ccb-uicreate-'));
        try {
            const repoDir = createMultiCommitRepo(tmpDir);
            const wsId = 'ws-ccb-ui1';
            await dismissOnboarding(serverUrl);
            await navigateToGitTab(page, serverUrl, wsId, 'ccb-uicreate', repoDir);

            const hash = execFileSync('git', ['rev-parse', 'HEAD'], {
                cwd: repoDir, encoding: 'utf-8',
            }).trim();

            await expect(page.getByTestId('commit-list-loading')).toBeHidden({ timeout: 10_000 });

            // Click first commit to show CommitDetail
            await page.locator('[data-testid^="commit-row-"]').first().click();
            await expect(page.getByTestId('commit-detail')).toBeVisible({ timeout: 10_000 });

            // Open the chat panel
            await page.getByTestId('toggle-chat-btn').click();
            await expect(page.getByTestId('commit-chat-panel')).toBeVisible({ timeout: 5_000 });

            // Type a message in the contentEditable input
            const chatInput = page.getByTestId('commit-chat-input');
            await chatInput.click();
            await page.keyboard.type('Review this commit');

            // Send the message — triggers queue task creation + binding
            const sendBtn = page.getByTestId('commit-chat-send-btn');
            await expect(sendBtn).toBeEnabled();

            // Wait for both the queue task and binding API calls to complete
            await Promise.all([
                page.waitForResponse(
                    resp => resp.url().includes('/commit-chat-bindings') && resp.status() === 201,
                ),
                sendBtn.click(),
            ]);

            // Verify binding was persisted via direct API call
            const getRes = await request(`${serverUrl}/api/workspaces/${wsId}/commit-chat-bindings/${hash}`);
            expect(getRes.status).toBe(200);
            const binding = JSON.parse(getRes.body);
            expect(binding.taskId).toBeTruthy();
        } finally {
            safeRmSync(tmpDir);
        }
    });

    test('revisiting a commit with existing binding shows chat panel with task', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-ccb-revisit-'));
        try {
            const repoDir = createMultiCommitRepo(tmpDir);
            const wsId = 'ws-ccb-rev1';
            await dismissOnboarding(serverUrl);
            await navigateToGitTab(page, serverUrl, wsId, 'ccb-revisit', repoDir);

            const hash = execFileSync('git', ['rev-parse', 'HEAD'], {
                cwd: repoDir, encoding: 'utf-8',
            }).trim();

            // Pre-seed a binding via API
            await request(`${serverUrl}/api/workspaces/${wsId}/commit-chat-bindings`, {
                method: 'POST',
                body: JSON.stringify({ commitHash: hash, taskId: 'task-preseeded' }),
            });

            await expect(page.getByTestId('commit-list-loading')).toBeHidden({ timeout: 10_000 });

            // Click first commit and open chat
            await page.locator('[data-testid^="commit-row-"]').first().click();
            await expect(page.getByTestId('commit-detail')).toBeVisible({ timeout: 10_000 });

            await page.getByTestId('toggle-chat-btn').click();
            await expect(page.getByTestId('commit-chat-panel')).toBeVisible({ timeout: 5_000 });

            // The panel should NOT show the empty-state send button — it should
            // render ChatDetail instead (because taskId is set).
            // The empty-state send button only appears when taskId is null.
            await expect(page.getByTestId('commit-chat-send-btn')).toBeHidden({ timeout: 5_000 });
        } finally {
            safeRmSync(tmpDir);
        }
    });
});

// ================================================================
// Validation — bad requests
// ================================================================

test.describe('Commit-Chat Binding — Validation', () => {
    test('returns 400 for invalid commit hash format', async ({ serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-ccb-val-'));
        try {
            const repoDir = createMultiCommitRepo(tmpDir);
            const wsId = 'ws-ccb-val1';
            await seedWorkspace(serverUrl, wsId, 'ccb-val', repoDir);

            const res = await request(`${serverUrl}/api/workspaces/${wsId}/commit-chat-bindings`, {
                method: 'POST',
                body: JSON.stringify({ commitHash: 'not-hex!', taskId: 'task-1' }),
            });
            expect(res.status).toBe(400);
        } finally {
            safeRmSync(tmpDir);
        }
    });

    test('returns 400 when taskId is missing', async ({ serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-ccb-val2-'));
        try {
            const repoDir = createMultiCommitRepo(tmpDir);
            const wsId = 'ws-ccb-val2';
            await seedWorkspace(serverUrl, wsId, 'ccb-val2', repoDir);

            const res = await request(`${serverUrl}/api/workspaces/${wsId}/commit-chat-bindings`, {
                method: 'POST',
                body: JSON.stringify({ commitHash: 'abcd1234' }),
            });
            expect(res.status).toBe(400);
        } finally {
            safeRmSync(tmpDir);
        }
    });

    test('returns 404 for unknown workspace', async ({ serverUrl }) => {
        const res = await request(`${serverUrl}/api/workspaces/nonexistent-ws/commit-chat-bindings`);
        expect(res.status).toBe(404);
    });
});
