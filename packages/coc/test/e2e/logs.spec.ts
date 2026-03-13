/**
 * Logs E2E Tests
 *
 * Tests the Logs tab: navigation, rendering, level filtering, search, and
 * the history endpoint. Log entries are injected directly via captureEntry()
 * which shares the same module singleton as the test server.
 */

import { test, expect } from './fixtures/server-fixture';
import { request } from './fixtures/seed';

// Import captureEntry from the compiled coc-server package.
// This is the same singleton used by the running test server.
const { captureEntry, clearLogBuffer } = require('@plusplusoneplusplus/coc-server');

type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';

function fakeEntry(overrides: {
    level?: LogLevel;
    msg?: string;
    component?: string;
    ts?: string;
} = {}) {
    return {
        ts: overrides.ts ?? new Date().toISOString(),
        level: overrides.level ?? 'info',
        msg: overrides.msg ?? 'test log entry',
        component: overrides.component,
    };
}

test.afterEach(() => {
    clearLogBuffer();
});

// ── Navigation ─────────────────────────────────────────────────────────────

test.describe('Logs tab — navigation', () => {
    test('clicking the Logs tab shows the Logs view', async ({ page, serverUrl }) => {
        await page.goto(serverUrl + '/#repos');

        // Click Logs tab
        await page.locator('[data-tab="logs"]').click();

        await expect(page.locator('[data-testid="logs-view"]')).toBeVisible({ timeout: 8000 });
    });

    test('navigating to #logs directly shows the Logs view', async ({ page, serverUrl }) => {
        await page.goto(serverUrl + '/#logs');

        await expect(page.locator('[data-testid="logs-view"]')).toBeVisible({ timeout: 8000 });
    });

    test('Logs tab is highlighted when active', async ({ page, serverUrl }) => {
        await page.goto(serverUrl + '/#logs');

        const logsTab = page.locator('[data-tab="logs"]');
        await expect(logsTab).toBeVisible({ timeout: 8000 });
        await expect(logsTab).toHaveClass(/active/);
    });
});

// ── Empty state ────────────────────────────────────────────────────────────

test.describe('Logs view — empty state', () => {
    test('shows empty state when buffer has no entries', async ({ page, serverUrl }) => {
        clearLogBuffer();
        await page.goto(serverUrl + '/#logs');

        await expect(page.locator('[data-testid="logs-view"]')).toBeVisible({ timeout: 8000 });
        // Wait a bit for any SSE history to arrive
        await page.waitForTimeout(500);
        await expect(page.locator('[data-testid="log-empty-state"]')).toBeVisible({ timeout: 5000 });
    });
});

// ── Log rendering ──────────────────────────────────────────────────────────

test.describe('Logs view — rendering fake log data', () => {
    test('history entries are rendered in the log list', async ({ page, serverUrl }) => {
        // Inject log entries before navigating
        captureEntry(fakeEntry({ level: 'info', msg: 'Server started successfully', component: 'http' }));
        captureEntry(fakeEntry({ level: 'warn', msg: 'Queue depth is high', component: 'queue' }));
        captureEntry(fakeEntry({ level: 'error', msg: 'Token limit exceeded', component: 'ai-service' }));

        await page.goto(serverUrl + '/#logs');
        await expect(page.locator('[data-testid="logs-view"]')).toBeVisible({ timeout: 8000 });

        // Wait for SSE history event to populate
        await expect(page.locator('[data-testid="log-row"]').first()).toBeVisible({ timeout: 8000 });

        const rows = page.locator('[data-testid="log-row"]');
        await expect(rows).toHaveCount(3, { timeout: 5000 });
    });

    test('log entries show level badge', async ({ page, serverUrl }) => {
        captureEntry(fakeEntry({ level: 'error', msg: 'Critical failure' }));

        await page.goto(serverUrl + '/#logs');

        // Wait for log rows
        await expect(page.locator('[data-testid="log-row"][data-level="error"]')).toBeVisible({ timeout: 8000 });
        await expect(page.locator('[data-testid="log-row"][data-level="error"]')).toContainText('error');
        await expect(page.locator('[data-testid="log-row"][data-level="error"]')).toContainText('Critical failure');
    });

    test('each level badge has correct data-level attribute', async ({ page, serverUrl }) => {
        captureEntry(fakeEntry({ level: 'debug', msg: 'Debug entry' }));
        captureEntry(fakeEntry({ level: 'info', msg: 'Info entry' }));
        captureEntry(fakeEntry({ level: 'warn', msg: 'Warn entry' }));

        await page.goto(serverUrl + '/#logs');

        await expect(page.locator('[data-level="debug"]')).toBeVisible({ timeout: 8000 });
        await expect(page.locator('[data-level="info"]')).toBeVisible({ timeout: 5000 });
        await expect(page.locator('[data-level="warn"]')).toBeVisible({ timeout: 5000 });
    });
});

// ── Level filter ───────────────────────────────────────────────────────────

test.describe('Logs view — level filter', () => {
    test('filter button "Warn+" hides debug and info entries', async ({ page, serverUrl }) => {
        captureEntry(fakeEntry({ level: 'debug', msg: 'Debug message' }));
        captureEntry(fakeEntry({ level: 'info', msg: 'Info message' }));
        captureEntry(fakeEntry({ level: 'warn', msg: 'Warn message' }));
        captureEntry(fakeEntry({ level: 'error', msg: 'Error message' }));

        await page.goto(serverUrl + '/#logs');

        // Wait for rows
        await expect(page.locator('[data-testid="log-row"]').first()).toBeVisible({ timeout: 8000 });
        await expect(page.locator('[data-testid="log-row"]')).toHaveCount(4, { timeout: 5000 });

        // Click Warn+ filter
        await page.locator('[data-testid="level-filter-warn"]').click();

        // Only warn and error should be visible
        await expect(page.locator('[data-testid="log-row"]')).toHaveCount(2, { timeout: 5000 });
        await expect(page.locator('[data-testid="log-row"][data-level="warn"]')).toBeVisible();
        await expect(page.locator('[data-testid="log-row"][data-level="error"]')).toBeVisible();
        await expect(page.locator('[data-testid="log-row"][data-level="debug"]')).not.toBeVisible();
        await expect(page.locator('[data-testid="log-row"][data-level="info"]')).not.toBeVisible();
    });

    test('filter button "Error+" shows only error entries', async ({ page, serverUrl }) => {
        captureEntry(fakeEntry({ level: 'info', msg: 'Normal info' }));
        captureEntry(fakeEntry({ level: 'error', msg: 'Something broke' }));

        await page.goto(serverUrl + '/#logs');
        await expect(page.locator('[data-testid="log-row"]').first()).toBeVisible({ timeout: 8000 });

        await page.locator('[data-testid="level-filter-error"]').click();

        await expect(page.locator('[data-testid="log-row"]')).toHaveCount(1, { timeout: 5000 });
        await expect(page.locator('[data-testid="log-row"]').first()).toContainText('Something broke');
    });

    test('"All" filter resets to show all entries', async ({ page, serverUrl }) => {
        captureEntry(fakeEntry({ level: 'debug', msg: 'Debug log' }));
        captureEntry(fakeEntry({ level: 'error', msg: 'Error log' }));

        await page.goto(serverUrl + '/#logs');
        await expect(page.locator('[data-testid="log-row"]').first()).toBeVisible({ timeout: 8000 });

        // Apply error filter first
        await page.locator('[data-testid="level-filter-error"]').click();
        await expect(page.locator('[data-testid="log-row"]')).toHaveCount(1, { timeout: 5000 });

        // Reset with All
        await page.locator('[data-testid="level-filter-all"]').click();
        await expect(page.locator('[data-testid="log-row"]')).toHaveCount(2, { timeout: 5000 });
    });
});

// ── Search ─────────────────────────────────────────────────────────────────

test.describe('Logs view — free-text search', () => {
    test('typing in search box filters log entries', async ({ page, serverUrl }) => {
        captureEntry(fakeEntry({ msg: 'Token limit exceeded for model GPT-4' }));
        captureEntry(fakeEntry({ msg: 'Handling incoming HTTP request' }));
        captureEntry(fakeEntry({ msg: 'Token refresh completed' }));

        await page.goto(serverUrl + '/#logs');
        await expect(page.locator('[data-testid="log-row"]').first()).toBeVisible({ timeout: 8000 });
        await expect(page.locator('[data-testid="log-row"]')).toHaveCount(3, { timeout: 5000 });

        // Search for "token"
        await page.locator('[data-testid="log-search"]').fill('token');

        // Only the two "token" entries should remain
        await expect(page.locator('[data-testid="log-row"]')).toHaveCount(2, { timeout: 5000 });
    });

    test('clearing search shows all entries again', async ({ page, serverUrl }) => {
        captureEntry(fakeEntry({ msg: 'Alpha entry' }));
        captureEntry(fakeEntry({ msg: 'Beta entry' }));

        await page.goto(serverUrl + '/#logs');
        await expect(page.locator('[data-testid="log-row"]').first()).toBeVisible({ timeout: 8000 });

        await page.locator('[data-testid="log-search"]').fill('alpha');
        await expect(page.locator('[data-testid="log-row"]')).toHaveCount(1, { timeout: 5000 });

        await page.locator('[data-testid="log-search"]').clear();
        await expect(page.locator('[data-testid="log-row"]')).toHaveCount(2, { timeout: 5000 });
    });
});

// ── Pause / Resume ─────────────────────────────────────────────────────────

test.describe('Logs view — pause / resume', () => {
    test('pause button changes label to Resume', async ({ page, serverUrl }) => {
        await page.goto(serverUrl + '/#logs');
        await expect(page.locator('[data-testid="logs-view"]')).toBeVisible({ timeout: 8000 });

        const pauseBtn = page.locator('[data-testid="pause-btn"]');
        await expect(pauseBtn).toContainText('Pause');
        await pauseBtn.click();
        await expect(pauseBtn).toContainText('Resume');
    });

    test('clicking Resume restores live label', async ({ page, serverUrl }) => {
        await page.goto(serverUrl + '/#logs');

        const pauseBtn = page.locator('[data-testid="pause-btn"]');
        await pauseBtn.click();
        await expect(pauseBtn).toContainText('Resume');
        await pauseBtn.click();
        await expect(pauseBtn).toContainText('Pause');
    });
});

// ── Clear ──────────────────────────────────────────────────────────────────

test.describe('Logs view — clear button', () => {
    test('clicking Clear removes all displayed log entries', async ({ page, serverUrl }) => {
        captureEntry(fakeEntry({ msg: 'Entry to clear A' }));
        captureEntry(fakeEntry({ msg: 'Entry to clear B' }));

        await page.goto(serverUrl + '/#logs');
        await expect(page.locator('[data-testid="log-row"]').first()).toBeVisible({ timeout: 8000 });
        await expect(page.locator('[data-testid="log-row"]')).toHaveCount(2, { timeout: 5000 });

        await page.locator('[data-testid="clear-btn"]').click();

        await expect(page.locator('[data-testid="log-empty-state"]')).toBeVisible({ timeout: 5000 });
        await expect(page.locator('[data-testid="log-row"]')).toHaveCount(0);
    });
});

// ── REST API ───────────────────────────────────────────────────────────────

test.describe('/api/logs/history REST endpoint', () => {
    test('returns buffered log entries', async ({ serverUrl }) => {
        clearLogBuffer();
        captureEntry(fakeEntry({ level: 'info', msg: 'API test entry' }));

        const res = await request(`${serverUrl}/api/logs/history`);
        const body = JSON.parse(res.body);

        expect(res.status).toBe(200);
        expect(Array.isArray(body.entries)).toBe(true);
        expect(body.entries.some((e: any) => e.msg === 'API test entry')).toBe(true);
    });

    test('level filter is applied by the API', async ({ serverUrl }) => {
        clearLogBuffer();
        captureEntry(fakeEntry({ level: 'debug', msg: 'Debug only' }));
        captureEntry(fakeEntry({ level: 'error', msg: 'Error only' }));

        const res = await request(`${serverUrl}/api/logs/history?level=error`);
        const body = JSON.parse(res.body);

        expect(body.entries.every((e: any) => e.level === 'error' || e.level === 'fatal')).toBe(true);
        expect(body.entries.some((e: any) => e.msg === 'Error only')).toBe(true);
        expect(body.entries.some((e: any) => e.msg === 'Debug only')).toBe(false);
    });
});

test.describe('/api/logs/sources REST endpoint', () => {
    test('returns sources list with in-process source', async ({ serverUrl }) => {
        const res = await request(`${serverUrl}/api/logs/sources`);
        const body = JSON.parse(res.body);

        expect(res.status).toBe(200);
        expect(body.sources).toBeInstanceOf(Array);
        const inProc = body.sources.find((s: any) => s.id === 'in-process');
        expect(inProc).toBeDefined();
    });
});
