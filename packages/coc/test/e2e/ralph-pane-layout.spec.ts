/**
 * Ralph pane layout — E2E (visual layer)
 *
 * The Ralph session viewer lives in the middle column of the workspace shell,
 * not at viewport width. It used to split into timeline + file browser on the
 * `xl:` viewport breakpoint, so on a wide monitor a ~570px pane still committed
 * to two columns and rendered one word per line. The layout is now driven by
 * the pane's own inline size via container queries; this spec pins the three
 * tiers by forcing the pane's width and reading the real geometry back.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { test, expect, safeRmSync } from './fixtures/server-fixture';
import { seedWorkspace } from './fixtures/seed';
import type { Page } from '@playwright/test';

const SESSION_ID = 'rs-layout';

function writeSession(dataDir: string, wsId: string): void {
    const dir = path.join(dataDir, 'repos', wsId, 'ralph-sessions', SESSION_ID);
    fs.mkdirSync(dir, { recursive: true });
    const startedAt = new Date(Date.now() - 3_600_000).toISOString();
    fs.writeFileSync(
        path.join(dir, 'session.json'),
        JSON.stringify({
            sessionId: SESSION_ID,
            workspaceId: wsId,
            originalGoal: 'Make the Ralph session viewer usable in a narrow pane',
            maxIterations: 10,
            currentIteration: 2,
            phase: 'executing',
            startedAt,
            iterations: [1, 2].map((n) => ({
                iteration: n,
                taskId: `task-${n}`,
                processId: `proc-${n}`,
                startedAt,
                endedAt: new Date(Date.now() - 3_000_000 + n * 60_000).toISOString(),
                status: 'completed',
                exitSignal: 'RALPH_NEXT',
            })),
        }),
    );
    fs.writeFileSync(
        path.join(dir, 'progress.md'),
        [
            `## Iteration 1 — RALPH_NEXT — ${startedAt}`,
            'Files: packages/coc/src/server/spa/client/react/features/chat/RalphWorkflowPane.tsx',
            'Decisions: drive the split from the pane container instead of the viewport',
            'Remaining: clamp the iteration card lines',
            '',
            `## Iteration 2 — RALPH_NEXT — ${startedAt}`,
            'Files: packages/coc/src/server/spa/client/react/features/chat/RalphWorkflowNode.tsx',
            'Decisions: stack below 900px',
            'Remaining: none',
            '',
        ].join('\n'),
    );
    fs.writeFileSync(path.join(dir, 'context.md'), '# Context\n\nA reasonably long note about the loop.\n');
}

/** Force the pane to an exact inline size by pinning its host element. */
async function setPaneWidth(page: Page, width: number): Promise<void> {
    await page.evaluate((w) => {
        const pane = document.querySelector('[data-testid="ralph-workflow-pane"]');
        const host = pane?.parentElement as HTMLElement | null;
        if (!host) throw new Error('Ralph pane host not found');
        host.style.flex = '0 0 auto';
        host.style.minWidth = '0';
        host.style.maxWidth = 'none';
        host.style.width = `${w}px`;
    }, width);
    // Container queries re-evaluate on the next layout pass.
    await page.waitForTimeout(150);
    const actual = await page.evaluate(() => {
        const pane = document.querySelector('[data-testid="ralph-workflow-pane"]');
        return pane ? Math.round(pane.getBoundingClientRect().width) : -1;
    });
    // Guard the premise of every assertion below: if the host pin did not take,
    // the tiers would silently all measure the same default layout.
    expect(Math.abs(actual - width)).toBeLessThan(4);
}

async function box(page: Page, testId: string): Promise<{ x: number; y: number; width: number }> {
    const b = await page.locator(`[data-testid="${testId}"]`).boundingBox();
    if (!b) throw new Error(`No bounding box for ${testId}`);
    return { x: b.x, y: b.y, width: b.width };
}

test.describe('Ralph pane layout tiers', () => {
    let wsId = '';
    let rootPath = '';

    test.beforeEach(async ({ serverUrl, dataDir }) => {
        rootPath = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-ralph-layout-'));
        wsId = `ralph-layout-${Date.now().toString(36)}`;
        await seedWorkspace(serverUrl, wsId, 'ralph-layout', rootPath);
        writeSession(dataDir, wsId);
    });

    test.afterEach(() => {
        if (rootPath) safeRmSync(rootPath);
    });

    async function openPane(page: Page, serverUrl: string): Promise<void> {
        await page.setViewportSize({ width: 1600, height: 900 });
        await page.goto(`${serverUrl}/#repos/${encodeURIComponent(wsId)}/activity/ralph/${SESSION_ID}`);
        await expect(page.locator('[data-testid="ralph-workflow-pane"]')).toBeVisible({ timeout: 15_000 });
        await expect(page.locator('[data-testid="ralph-session-files"]')).toBeVisible({ timeout: 10_000 });
    }

    test('wide tier (1200px): files sit beside the timeline', async ({ page, serverUrl }) => {
        await openPane(page, serverUrl);
        await setPaneWidth(page, 1200);

        const timeline = await box(page, 'ralph-workflow-timeline');
        const files = await box(page, 'ralph-session-files');
        expect(files.x).toBeGreaterThan(timeline.x + timeline.width - 2);
        expect(Math.abs(files.y - timeline.y)).toBeLessThan(4);
        // ~58% of the pane, the rest to the timeline.
        expect(files.width).toBeGreaterThan(600);

        const nav = page.locator('[data-testid="ralph-session-file-list"] ul');
        await expect(nav).toHaveCSS('flex-direction', 'column');
        await page.locator('[data-testid="ralph-workflow-pane"]').screenshot({
            path: 'test-results/ralph-pane-1200.png',
        });
    });

    test('medium tier (700px): files stack below the timeline, nav stays a sidebar', async ({ page, serverUrl }) => {
        await openPane(page, serverUrl);
        await setPaneWidth(page, 700);

        const timeline = await box(page, 'ralph-workflow-timeline');
        const files = await box(page, 'ralph-session-files');
        expect(files.y).toBeGreaterThan(timeline.y);
        expect(Math.abs(files.x - timeline.x)).toBeLessThan(4);
        expect(Math.abs(files.width - timeline.width)).toBeLessThan(4);

        const nav = page.locator('[data-testid="ralph-session-file-list"] ul');
        await expect(nav).toHaveCSS('flex-direction', 'column');
        await page.locator('[data-testid="ralph-workflow-pane"]').screenshot({
            path: 'test-results/ralph-pane-700.png',
        });
    });

    test('narrow tier (420px): files stack and the file nav is a horizontal strip', async ({ page, serverUrl }) => {
        await openPane(page, serverUrl);
        await setPaneWidth(page, 420);

        const timeline = await box(page, 'ralph-workflow-timeline');
        const files = await box(page, 'ralph-session-files');
        expect(files.y).toBeGreaterThan(timeline.y);

        const nav = page.locator('[data-testid="ralph-session-file-list"] ul');
        await expect(nav).toHaveCSS('flex-direction', 'row');
        // The nav sits above the file content rather than beside it.
        const navBox = await page.locator('[data-testid="ralph-session-file-list"]').boundingBox();
        const contentBox = await page.locator('[data-testid="ralph-session-file-content"]').boundingBox();
        expect(navBox && contentBox && contentBox.y).toBeGreaterThan(navBox!.y);

        await page.locator('[data-testid="ralph-workflow-pane"]').screenshot({
            path: 'test-results/ralph-pane-420.png',
        });
    });

    test('collapsing the file browser frees the stacked timeline', async ({ page, serverUrl }) => {
        await openPane(page, serverUrl);
        await setPaneWidth(page, 420);

        const before = await box(page, 'ralph-workflow-timeline');
        await page.locator('[data-testid="ralph-session-files-toggle"]').click();
        await expect(page.locator('[data-testid="ralph-session-files-toggle"]')).toHaveAttribute('aria-expanded', 'false');
        await expect(page.locator('[data-testid="ralph-session-files-body"]')).toBeHidden();

        const after = await box(page, 'ralph-workflow-timeline');
        expect(after.width).toBeGreaterThanOrEqual(before.width - 1);
    });
});
