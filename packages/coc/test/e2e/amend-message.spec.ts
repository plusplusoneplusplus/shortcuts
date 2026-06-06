/**
 * AmendMessageModal E2E Tests
 *
 * Covers the full edit-and-confirm cycle for amending git commit messages
 * via the context-menu driven AmendMessageModal in the Git sub-tab.
 *
 * Scenarios:
 *  1. Modal opens with original commit subject pre-populated
 *  2. Cancel button closes the modal without an API call
 *  3. Escape key closes the modal
 *  4. Clicking the backdrop closes the modal
 *  5. Empty title blocks submit and shows validation error
 *  6. Successful amend: API call → modal closes → toast shown → list refreshes
 *  7. "Amend Title…" opens the modal in title-only mode (no body textarea)
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { Page } from '@playwright/test';
import { test, expect, safeRmSync } from './fixtures/server-fixture';
import { createMultiCommitRepo, navigateToGitTab } from './fixtures/git-fixtures';
import { request } from './fixtures/seed';

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Pre-seed hasSeenWelcome so the onboarding modal does not block pointer events. */
async function dismissOnboarding(serverUrl: string): Promise<void> {
    await request(`${serverUrl}/api/preferences`, {
        method: 'PATCH',
        body: JSON.stringify({
            hasSeenWelcome: true,
            onboardingProgress: { dismissed: true, hasCompletedTour: true },
        }),
    });
}

/**
 * Navigate to the Git sub-tab and open the "Amend Message…" modal for the
 * HEAD commit (the topmost row in the commit list).
 */
async function openAmendMessageModal(
    page: Page,
    serverUrl: string,
    wsId: string,
    repoDir: string,
): Promise<void> {
    await dismissOnboarding(serverUrl);
    await navigateToGitTab(page, serverUrl, wsId, `repo-${wsId}`, repoDir);
    await expect(page.getByTestId('commit-list-loading')).toBeHidden({ timeout: 10_000 });

    const headRow = page.locator('[data-testid^="commit-row-"]').first();
    await expect(headRow).toBeVisible({ timeout: 10_000 });
    await headRow.click({ button: 'right' });

    const menu = page.locator('[data-testid="context-menu"]');
    await expect(menu).toBeVisible({ timeout: 5_000 });
    await menu.getByRole('menuitem', { name: /Amend Message/ }).click();

    await expect(page.getByTestId('amend-message-modal')).toBeVisible({ timeout: 5_000 });
}

// ── Tests ──────────────────────────────────────────────────────────────────────

test.describe('AmendMessageModal — open / pre-population', () => {
    test('opens with commit subject pre-populated in title input', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-amend-'));
        try {
            const repoDir = createMultiCommitRepo(tmpDir);
            await openAmendMessageModal(page, serverUrl, 'ws-amd-1', repoDir);

            await expect(page.getByTestId('amend-title-input')).toHaveValue('fix: update index');
            // Body textarea is visible in full-message mode
            await expect(page.getByTestId('amend-body-textarea')).toBeVisible();
        } finally {
            safeRmSync(tmpDir);
        }
    });
});

test.describe('AmendMessageModal — cancel / dismiss', () => {
    test('Cancel button closes the modal', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-amend-'));
        try {
            const repoDir = createMultiCommitRepo(tmpDir);
            await openAmendMessageModal(page, serverUrl, 'ws-amd-2', repoDir);

            await page.getByTestId('amend-cancel-btn').click();
            await expect(page.getByTestId('amend-message-modal')).not.toBeVisible();
        } finally {
            safeRmSync(tmpDir);
        }
    });

    test('Escape key closes the modal', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-amend-'));
        try {
            const repoDir = createMultiCommitRepo(tmpDir);
            await openAmendMessageModal(page, serverUrl, 'ws-amd-3', repoDir);

            await page.keyboard.press('Escape');
            await expect(page.getByTestId('amend-message-modal')).not.toBeVisible();
        } finally {
            safeRmSync(tmpDir);
        }
    });

    test('clicking the backdrop closes the modal', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-amend-'));
        try {
            const repoDir = createMultiCommitRepo(tmpDir);
            await openAmendMessageModal(page, serverUrl, 'ws-amd-4', repoDir);

            // Click in the top-left corner of the full-screen backdrop, well away from
            // the centred card (480 px wide, viewport is 1280 px by default).
            const backdrop = page.getByTestId('amend-message-modal');
            await backdrop.click({ position: { x: 10, y: 10 } });
            await expect(backdrop).not.toBeVisible();
        } finally {
            safeRmSync(tmpDir);
        }
    });
});

test.describe('AmendMessageModal — validation', () => {
    test('blocks submit with empty title and shows validation error', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-amend-'));
        try {
            const repoDir = createMultiCommitRepo(tmpDir);
            await openAmendMessageModal(page, serverUrl, 'ws-amd-5', repoDir);

            await page.getByTestId('amend-title-input').clear();
            await page.getByTestId('amend-confirm-btn').click();

            await expect(page.getByTestId('amend-title-error')).toBeVisible();
            await expect(page.getByTestId('amend-title-error')).toContainText('Commit title is required');
            // Modal must stay open
            await expect(page.getByTestId('amend-message-modal')).toBeVisible();
        } finally {
            safeRmSync(tmpDir);
        }
    });

    test('clears validation error when user types a new title', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-amend-'));
        try {
            const repoDir = createMultiCommitRepo(tmpDir);
            await openAmendMessageModal(page, serverUrl, 'ws-amd-6', repoDir);

            // Trigger the error first
            await page.getByTestId('amend-title-input').clear();
            await page.getByTestId('amend-confirm-btn').click();
            await expect(page.getByTestId('amend-title-error')).toBeVisible();

            // Typing a character should clear the error
            await page.getByTestId('amend-title-input').type('x');
            await expect(page.getByTestId('amend-title-error')).not.toBeVisible();
        } finally {
            safeRmSync(tmpDir);
        }
    });
});

test.describe('AmendMessageModal — successful amend', () => {
    test('amends HEAD commit message and shows success toast with refreshed list', async ({
        page,
        serverUrl,
    }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-amend-'));
        try {
            const repoDir = createMultiCommitRepo(tmpDir);
            await openAmendMessageModal(page, serverUrl, 'ws-amd-7', repoDir);

            const amendedTitle = 'fix: amended by E2E test';
            const amendedBody = [
                'First amended body line from E2E.',
                'Second line keeps spaces, quotes "and" ampersand & characters.',
                'Third line includes Windows-ish C:\\temp\\repo path text.',
            ].join('\n');

            const titleInput = page.getByTestId('amend-title-input');
            await titleInput.clear();
            await titleInput.fill(amendedTitle);
            await page.getByTestId('amend-body-textarea').fill(amendedBody);

            const [response] = await Promise.all([
                page.waitForResponse(
                    (resp) => resp.url().includes('/git/amend') && resp.request().method() === 'POST',
                ),
                page.getByTestId('amend-confirm-btn').click(),
            ]);

            expect(response.status()).toBe(200);

            // Modal closes immediately after submit (before API returns)
            await expect(page.getByTestId('amend-message-modal')).not.toBeVisible({ timeout: 5_000 });

            // Toast confirms the operation
            await expect(page.getByTestId('enqueue-toast')).toContainText('Commit message amended', {
                timeout: 10_000,
            });

            // Commit list refreshes with the new subject, keeps the amended HEAD selected,
            // and shows the exact amended title/body in the detail panel.
            await expect(page.getByTestId('git-commit-list-panel')).toContainText(amendedTitle, {
                timeout: 10_000,
            });
            const amendedHeadRow = page.locator('[data-testid^="commit-row-"]').first();
            await expect(amendedHeadRow).toHaveAttribute('aria-selected', 'true');
            await expect(page.getByTestId('commit-info-subject')).toHaveText(amendedTitle);
            await expect(page.getByTestId('commit-info-body')).toHaveText(amendedBody);
        } finally {
            safeRmSync(tmpDir);
        }
    });
});

test.describe('AmendMessageModal — title-only mode', () => {
    test('opens without body textarea when triggered via "Amend Title…" on a non-HEAD commit', async ({
        page,
        serverUrl,
    }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-amend-'));
        try {
            const repoDir = createMultiCommitRepo(tmpDir);
            await dismissOnboarding(serverUrl);
            await navigateToGitTab(page, serverUrl, 'ws-amd-8', 'repo-ws-amd-8', repoDir);
            await expect(page.getByTestId('commit-list-loading')).toBeHidden({ timeout: 10_000 });

            // Right-click the second commit row (non-HEAD) to get "Amend Title…"
            const secondRow = page.locator('[data-testid^="commit-row-"]').nth(1);
            await expect(secondRow).toBeVisible({ timeout: 10_000 });
            await secondRow.click({ button: 'right' });

            const menu = page.locator('[data-testid="context-menu"]');
            await expect(menu).toBeVisible({ timeout: 5_000 });
            await menu.getByRole('menuitem', { name: /Amend Title/ }).click();

            await expect(page.getByTestId('amend-message-modal')).toBeVisible({ timeout: 5_000 });
            // Title input is present
            await expect(page.getByTestId('amend-title-input')).toBeVisible();
            // Body textarea is absent in title-only mode
            await expect(page.getByTestId('amend-body-textarea')).not.toBeVisible();
        } finally {
            safeRmSync(tmpDir);
        }
    });
});
