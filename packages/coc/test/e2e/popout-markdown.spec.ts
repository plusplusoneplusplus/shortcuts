/**
 * E2E tests for PopOutMarkdownShell — the `#popout/markdown` standalone render root.
 *
 * Mode: mock-e2e (Playwright + real server, mocked file-content APIs)
 * Source: packages/coc/src/server/spa/client/react/layout/PopOutMarkdownShell.tsx
 *
 * Coverage:
 *  - Error state when required URL params are missing
 *  - Shell renders with valid workspace + filePath params
 *  - Markdown content (headings, code blocks) renders correctly
 *  - Document title is set from displayPath
 *  - fetchMode=tasks calls the tasks/content endpoint
 *  - fetchMode=auto falls back to files/preview when tasks/content returns 404
 */

import { test, expect } from './fixtures/server-fixture';
import { seedWorkspace } from './fixtures/seed';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Build a #popout/markdown URL for the given server and params. */
function popoutUrl(
    serverUrl: string,
    params: {
        workspace?: string;
        filePath?: string;
        fetchMode?: 'tasks' | 'auto';
        displayPath?: string;
    },
): string {
    const search = new URLSearchParams();
    if (params.workspace !== undefined) search.set('workspace', params.workspace);
    if (params.filePath !== undefined) search.set('filePath', params.filePath);
    if (params.fetchMode !== undefined) search.set('fetchMode', params.fetchMode);
    if (params.displayPath !== undefined) search.set('displayPath', params.displayPath);
    const qs = search.toString();
    return `${serverUrl}/${qs ? '?' + qs : ''}#popout/markdown`;
}

/** Mock the tasks/content endpoint for a workspace to return the given markdown. */
async function mockTasksContent(page: import('@playwright/test').Page, content: string): Promise<void> {
    await page.route('**/api/workspaces/*/tasks/content*', (route) =>
        route.fulfill({
            status: 200,
            body: JSON.stringify({ content }),
            contentType: 'application/json',
        }),
    );
}

/** Mock the files/preview endpoint for a workspace to return the given markdown. */
async function mockFilesPreview(page: import('@playwright/test').Page, content: string): Promise<void> {
    await page.route('**/api/workspaces/*/files/preview*', (route) =>
        route.fulfill({
            status: 200,
            body: JSON.stringify({ content }),
            contentType: 'application/json',
        }),
    );
}

// ── Error-state tests ─────────────────────────────────────────────────────────

test.describe('PopOutMarkdownShell — invalid URL', () => {
    test('shows "Invalid pop-out URL." when no query params are provided', async ({ page, serverUrl }) => {
        await page.goto(popoutUrl(serverUrl, {}));
        await expect(page.getByText('Invalid pop-out URL.')).toBeVisible({ timeout: 8_000 });
    });

    test('shows "Invalid pop-out URL." when workspace param is missing', async ({ page, serverUrl }) => {
        await page.goto(popoutUrl(serverUrl, { filePath: '/docs/plan.md' }));
        await expect(page.getByText('Invalid pop-out URL.')).toBeVisible({ timeout: 8_000 });
    });

    test('shows "Invalid pop-out URL." when filePath param is missing', async ({ page, serverUrl }) => {
        await page.goto(popoutUrl(serverUrl, { workspace: 'ws-popout-missing-fp' }));
        await expect(page.getByText('Invalid pop-out URL.')).toBeVisible({ timeout: 8_000 });
    });
});

// ── Render tests ──────────────────────────────────────────────────────────────

test.describe('PopOutMarkdownShell — content rendering', () => {
    test('renders the shell container when valid params are provided', async ({
        page,
        serverUrl,
    }) => {
        const wsId = 'ws-popout-render-1';
        await seedWorkspace(serverUrl, wsId, 'popout-render-ws');
        await mockTasksContent(page, '# Hello\n\nContent loaded.');

        await page.goto(popoutUrl(serverUrl, {
            workspace: wsId,
            filePath: '/docs/hello.md',
            fetchMode: 'tasks',
            displayPath: '/docs/hello.md',
        }));

        await expect(page.locator('[data-testid="popout-markdown-shell"]')).toBeVisible({ timeout: 10_000 });
    });

    test('renders markdown headings from fetched content', async ({ page, serverUrl }) => {
        const wsId = 'ws-popout-heading-1';
        await seedWorkspace(serverUrl, wsId, 'popout-heading-ws');
        await mockTasksContent(page, '# My Document Heading\n\nSome body text.');

        await page.goto(popoutUrl(serverUrl, {
            workspace: wsId,
            filePath: '/docs/doc.md',
            fetchMode: 'tasks',
        }));

        await expect(page.locator('[data-testid="popout-markdown-shell"]')).toBeVisible({ timeout: 10_000 });
        // Headings render as <span class="md-h1"> (custom renderer, not <h1>)
        await expect(page.locator('.md-h1')).toContainText('My Document Heading', { timeout: 8_000 });
    });

    test('renders code blocks from fetched content', async ({ page, serverUrl }) => {
        const wsId = 'ws-popout-code-1';
        await seedWorkspace(serverUrl, wsId, 'popout-code-ws');
        const md = '# Code Example\n\n```javascript\nconsole.log("hello world");\n```\n';
        await mockTasksContent(page, md);

        await page.goto(popoutUrl(serverUrl, {
            workspace: wsId,
            filePath: '/docs/code.md',
            fetchMode: 'tasks',
        }));

        await expect(page.locator('[data-testid="popout-markdown-shell"]')).toBeVisible({ timeout: 10_000 });
        // Code blocks render as <div class="code-block-container">
        await expect(page.locator('.code-block-container')).toBeVisible({ timeout: 8_000 });
    });

    test('displays the filename from displayPath in the top bar', async ({ page, serverUrl }) => {
        const wsId = 'ws-popout-title-1';
        await seedWorkspace(serverUrl, wsId, 'popout-title-ws');
        await mockTasksContent(page, '# Title Test\n\nSome content.');

        await page.goto(popoutUrl(serverUrl, {
            workspace: wsId,
            filePath: '/path/to/my-report.md',
            fetchMode: 'tasks',
            displayPath: '/path/to/my-report.md',
        }));

        await expect(page.locator('[data-testid="popout-markdown-shell"]')).toBeVisible({ timeout: 10_000 });
        // Top bar shows the last segment of displayPath
        await expect(page.locator('[data-testid="popout-markdown-shell"] span').filter({ hasText: 'my-report.md' }).first()).toBeVisible({ timeout: 5_000 });
    });

    test('sets document title from displayPath filename', async ({ page, serverUrl }) => {
        const wsId = 'ws-popout-doctitle-1';
        await seedWorkspace(serverUrl, wsId, 'popout-doctitle-ws');
        await mockTasksContent(page, '# Doc Title\n\nBody.');

        await page.goto(popoutUrl(serverUrl, {
            workspace: wsId,
            filePath: '/docs/my-spec.md',
            fetchMode: 'tasks',
            displayPath: '/docs/my-spec.md',
        }));

        await expect(page.locator('[data-testid="popout-markdown-shell"]')).toBeVisible({ timeout: 10_000 });
        // Title set to "<filename> — CoC @ <hostname>" or "<filename> — CoC"
        await expect(page).toHaveTitle(/my-spec\.md/, { timeout: 5_000 });
    });
});

// ── Fetch-mode tests ──────────────────────────────────────────────────────────

test.describe('PopOutMarkdownShell — fetchMode', () => {
    test('fetchMode=tasks calls the tasks/content endpoint', async ({ page, serverUrl }) => {
        const wsId = 'ws-popout-fetchmode-tasks';
        await seedWorkspace(serverUrl, wsId, 'popout-fetchmode-ws');

        let tasksContentCalled = false;
        await page.route('**/api/workspaces/*/tasks/content*', (route) => {
            tasksContentCalled = true;
            return route.fulfill({
                status: 200,
                body: JSON.stringify({ content: '# From Tasks Content\n\nLoaded via tasks mode.' }),
                contentType: 'application/json',
            });
        });

        await page.goto(popoutUrl(serverUrl, {
            workspace: wsId,
            filePath: '/docs/tasks-doc.md',
            fetchMode: 'tasks',
        }));

        await expect(page.locator('[data-testid="popout-markdown-shell"]')).toBeVisible({ timeout: 10_000 });
        await expect(page.locator('.md-h1')).toContainText('From Tasks Content', { timeout: 8_000 });
        expect(tasksContentCalled).toBe(true);
    });

    test('fetchMode=auto falls back to files/preview when tasks/content returns 404', async ({
        page,
        serverUrl,
    }) => {
        const wsId = 'ws-popout-fetchmode-auto';
        await seedWorkspace(serverUrl, wsId, 'popout-auto-ws');

        // tasks/content returns 404 → auto falls back to files/preview
        await page.route('**/api/workspaces/*/tasks/content*', (route) =>
            route.fulfill({ status: 404, body: JSON.stringify({ error: 'Not found' }), contentType: 'application/json' }),
        );
        await mockFilesPreview(page, '# From Files Preview\n\nLoaded via fallback.');

        await page.goto(popoutUrl(serverUrl, {
            workspace: wsId,
            filePath: '/docs/fallback.md',
            fetchMode: 'auto',
        }));

        await expect(page.locator('[data-testid="popout-markdown-shell"]')).toBeVisible({ timeout: 10_000 });
        await expect(page.locator('.md-h1')).toContainText('From Files Preview', { timeout: 8_000 });
    });
});
