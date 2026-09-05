/**
 * E2E regression: the composer PR chips must appear in a pop-out chat opened
 * WITHOUT `?workspace=`.
 *
 * Mode: mock-e2e (Playwright + real server, PR provider calls mocked)
 * Source: packages/coc/src/server/spa/client/react/utils/resolveChatWorkspaceId.ts
 *
 * `buildChatPopOutUrl` omits `?workspace=` when the caller has no id, so
 * `PopOutChatShell` mounts `ChatDetail` with `workspaceId={undefined}`. The chat
 * then had no canonical origin and the chips silently rendered nothing — no
 * request, no error, which is exactly why a unit test cannot catch it.
 * `ChatDetail` now recovers the id from the process's own `metadata.workspaceId`.
 */
import { test, expect } from './fixtures/server-fixture';
import { request } from './fixtures/seed';
import { resolveCanonicalOriginId } from '@plusplusoneplusplus/forge';
import type { Page } from '@playwright/test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const REMOTE_URL = 'https://github.com/plusplusoneplusplus/shortcuts.git';
const PR_NUMBER = 705;
const PR_URL = `https://github.com/plusplusoneplusplus/shortcuts/pull/${PR_NUMBER}`;
const PR_TITLE = 'Recover the chat workspace id from process metadata';

/** Register a workspace that carries an explicit GitHub remote. */
async function seedRemoteWorkspace(serverUrl: string, id: string): Promise<string> {
    const rootPath = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-prchip-'));
    const res = await request(`${serverUrl}/api/workspaces`, {
        method: 'POST',
        body: JSON.stringify({ id, name: id, rootPath, remoteUrl: REMOTE_URL }),
    });
    if (res.status >= 400) throw new Error(`seed workspace failed: ${res.status} ${res.body}`);
    return rootPath;
}

/**
 * Seed a completed chat process. The workspace id lives only in `metadata` —
 * the same place a real process records it, and the only copy a pop-out opened
 * without `?workspace=` can read.
 */
async function seedChatProcess(serverUrl: string, processId: string, workspaceId: string): Promise<void> {
    const createRes = await request(`${serverUrl}/api/processes`, {
        method: 'POST',
        body: JSON.stringify({
            id: processId,
            promptPreview: 'Open a PR for this branch',
            fullPrompt: 'Open a PR for this branch',
            status: 'completed',
            startTime: new Date().toISOString(),
            type: 'chat',
            // A resumable session, so the chat renders its composer — the chips dock inside it.
            sdkSessionId: 'sess-prchip-1',
            metadata: { workspaceId },
        }),
    });
    if (createRes.status >= 400) throw new Error(`seed process failed: ${createRes.status} ${createRes.body}`);
}

/**
 * Give the seeded process a transcript showing it created `PR_URL`. Turn
 * timestamps are `Date`s in the store's own model, so a JSON PATCH cannot write
 * a tool call; the turns are injected into the real process response instead,
 * leaving everything the test actually asserts on (workspace metadata, origin
 * resolution, bindings) served by the server.
 */
async function injectPrCreateTurns(page: Page, processId: string): Promise<void> {
    // Match only the process-detail GET — never the SSE stream endpoints under
    // the same prefix, which cannot be replayed through `route.fetch()`.
    const detailUrl = new RegExp(`/api/processes/${processId}(\\?[^/]*)?$`);
    await page.route(detailUrl, async (route) => {
        const response = await route.fetch();
        const body = await response.text();
        let parsed: { process?: { id?: string; conversationTurns?: unknown } };
        try {
            parsed = JSON.parse(body);
        } catch {
            return route.fulfill({ response });
        }
        if (parsed?.process?.id !== processId) {
            return route.fulfill({ response, body });
        }
        parsed.process.conversationTurns = [
            { role: 'user', content: 'Open a PR for this branch', timestamp: new Date().toISOString(), turnIndex: 0, timeline: [] },
            {
                role: 'assistant',
                content: `Opened ${PR_URL}`,
                timestamp: new Date().toISOString(),
                turnIndex: 1,
                timeline: [
                    {
                        type: 'tool-complete',
                        timestamp: new Date().toISOString(),
                        toolCall: {
                            id: 'tc-pr-create',
                            toolName: 'bash',
                            args: { command: 'gh pr create --fill' },
                            result: `Creating pull request for pr/branch into main\n${PR_URL}\n`,
                            status: 'completed',
                        },
                    },
                ],
            },
        ];
        return route.fulfill({ response, body: JSON.stringify(parsed) });
    });
}

/** Stand in for the GitHub-backed PR endpoints (bindings stay on the real server). */
async function mockPrProvider(page: Page): Promise<void> {
    await page.route('**/api/origins/*/pull-requests/**', (route) => {
        const url = route.request().url();
        if (url.includes('/reviewers')) {
            return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ reviewers: [] }) });
        }
        if (url.includes('/checks')) {
            return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ checks: [] }) });
        }
        return route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
                number: PR_NUMBER,
                title: PR_TITLE,
                status: 'active',
                sourceBranch: 'pr/workspace-id-fallback',
                targetBranch: 'main',
                createdAt: '2026-09-01T00:00:00Z',
                url: PR_URL,
            }),
        });
    });
}

test.describe('composer PR chips in a pop-out chat', () => {
    test('render when the pop-out URL carries no ?workspace=', async ({ page, serverUrl }) => {
        const workspaceId = `ws-prchip-${Date.now().toString(36)}`;
        const processId = `queue_prchip-${Date.now().toString(36)}`;
        await seedRemoteWorkspace(serverUrl, workspaceId);
        await seedChatProcess(serverUrl, processId, workspaceId);
        await injectPrCreateTurns(page, processId);
        await mockPrProvider(page);

        // No `?workspace=` — the exact URL `buildChatPopOutUrl` produces when the
        // caller has no id to pass on.
        await page.goto(`${serverUrl}/#popout/activity/${encodeURIComponent(processId)}`);
        await expect(page.getByTestId('popout-shell')).toBeVisible({ timeout: 10_000 });

        await expect(page.getByTestId('composer-pr-chips')).toBeVisible({ timeout: 15_000 });
        await expect(page.getByTestId('composer-pr-chip-title')).toHaveText(PR_TITLE, { timeout: 15_000 });

        // The chip is scoped to the repo's canonical GitHub origin, not `local_<ws>`.
        const originId = resolveCanonicalOriginId({ workspaceId, remoteUrl: REMOTE_URL });
        await expect(page.getByTestId(`composer-pr-chip-view-${originId}:${PR_NUMBER}`)).toBeVisible();
    });

    test('still render when the pop-out URL does carry ?workspace=', async ({ page, serverUrl }) => {
        const workspaceId = `ws-prchip-ws-${Date.now().toString(36)}`;
        const processId = `queue_prchipws-${Date.now().toString(36)}`;
        await seedRemoteWorkspace(serverUrl, workspaceId);
        await seedChatProcess(serverUrl, processId, workspaceId);
        await injectPrCreateTurns(page, processId);
        await mockPrProvider(page);

        await page.goto(
            `${serverUrl}/?workspace=${encodeURIComponent(workspaceId)}#popout/activity/${encodeURIComponent(processId)}`,
        );
        await expect(page.getByTestId('composer-pr-chips')).toBeVisible({ timeout: 15_000 });
    });
});
