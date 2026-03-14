/**
 * Skills E2E Tests
 *
 * Tests the #skills route: SkillsView sub-tab navigation, SkillsInstalledPanel
 * (empty state, list with items), SkillsBundledPanel (bundled items render,
 * install-all button), and SkillsConfigPanel (global dir display).
 *
 * New data-testid attributes added to source:
 *   SkillsBundledPanel:
 *     - data-testid={`skills-bundled-item-${name}`} — each bundled skill <li>
 *     - data-testid="skills-install-all-btn"          — "Install All" button
 *   SkillsInstalledPanel:
 *     - data-testid="skills-installed-empty"           — empty-state div
 *     - data-testid={`skills-installed-item-${name}`} — each installed skill <li>
 *     - data-testid={`skills-delete-btn-${name}`}     — delete button per skill
 */

import { test, expect } from './fixtures/server-fixture';
import type { Page } from '@playwright/test';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Navigate to the Skills tab and wait for the view to render. */
async function gotoSkills(page: Page, serverUrl: string): Promise<void> {
    await page.goto(serverUrl);
    await page.click('[data-tab="skills"]');
    await expect(page.locator('#view-skills')).toBeVisible({ timeout: 10_000 });
}

// ---------------------------------------------------------------------------
// 1. Tab navigation
// ---------------------------------------------------------------------------

test.describe('SkillsView – Tab navigation', () => {
    test('S.1 renders all three sub-tabs', async ({ page, serverUrl }) => {
        await gotoSkills(page, serverUrl);

        await expect(page.locator('[data-subtab="installed"]')).toBeVisible();
        await expect(page.locator('[data-subtab="bundled"]')).toBeVisible();
        await expect(page.locator('[data-subtab="config"]')).toBeVisible();
    });

    test('S.2 installed sub-tab is active by default', async ({ page, serverUrl }) => {
        await gotoSkills(page, serverUrl);

        await expect(page.locator('[data-subtab="installed"]')).toHaveClass(/border-\[#0078d4\]/, { timeout: 5_000 });
    });

    test('S.3 clicking bundled tab activates it', async ({ page, serverUrl }) => {
        await gotoSkills(page, serverUrl);

        await page.click('[data-subtab="bundled"]');
        await expect(page.locator('[data-subtab="bundled"]')).toHaveClass(/border-\[#0078d4\]/, { timeout: 5_000 });
    });

    test('S.4 clicking config tab activates it', async ({ page, serverUrl }) => {
        await gotoSkills(page, serverUrl);

        await page.click('[data-subtab="config"]');
        await expect(page.locator('[data-subtab="config"]')).toHaveClass(/border-\[#0078d4\]/, { timeout: 5_000 });
    });

    test('S.5 deep-link #skills/bundled activates bundled tab', async ({ page, serverUrl }) => {
        await page.goto(`${serverUrl}/#skills/bundled`);
        await expect(page.locator('#view-skills')).toBeVisible({ timeout: 10_000 });
        await expect(page.locator('[data-subtab="bundled"]')).toBeVisible();
    });
});

// ---------------------------------------------------------------------------
// 2. SkillsInstalledPanel
// ---------------------------------------------------------------------------

test.describe('SkillsInstalledPanel', () => {
    test('S.6 shows empty state when no skills are installed', async ({ page, serverUrl }) => {
        await gotoSkills(page, serverUrl);

        // The default fresh server has no global skills installed
        await expect(page.locator('[data-testid="skills-installed-empty"]')).toBeVisible({ timeout: 10_000 });
        await expect(page.locator('[data-testid="skills-installed-empty"]')).toContainText('No global skills installed');
    });

    test('S.7 installed panel shows skill list after install', async ({ page, serverUrl }) => {
        // Install a bundled skill via REST API (pipeline-generator is in the bundled registry)
        await page.request.post(`${serverUrl}/api/skills/install`, {
            data: { source: 'bundled', skills: ['pipeline-generator'], replace: true },
        });

        await gotoSkills(page, serverUrl);

        // Should show the installed skill
        await expect(page.locator('[data-testid="skills-installed-item-pipeline-generator"]')).toBeVisible({ timeout: 10_000 });
    });

    test('S.8 delete button removes skill with confirmation', async ({ page, serverUrl }) => {
        // Install a bundled skill first
        await page.request.post(`${serverUrl}/api/skills/install`, {
            data: { source: 'bundled', skills: ['pipeline-generator'], replace: true },
        });

        await gotoSkills(page, serverUrl);
        await expect(page.locator('[data-testid="skills-installed-item-pipeline-generator"]')).toBeVisible({ timeout: 10_000 });

        // Handle the browser confirm() dialog
        page.on('dialog', dialog => dialog.accept());
        await page.locator('[data-testid="skills-delete-btn-pipeline-generator"]').click();

        // Skill should be removed
        await expect(page.locator('[data-testid="skills-installed-item-pipeline-generator"]')).toHaveCount(0, { timeout: 8_000 });
    });
});

// ---------------------------------------------------------------------------
// 3. SkillsBundledPanel
// ---------------------------------------------------------------------------

test.describe('SkillsBundledPanel', () => {
    test('S.9 bundled skills list renders items', async ({ page, serverUrl }) => {
        await gotoSkills(page, serverUrl);
        await page.click('[data-subtab="bundled"]');

        // Wait for bundled skills to load
        await expect(page.locator('li[data-testid^="skills-bundled-item-"]').first()).toBeVisible({ timeout: 10_000 });
    });

    test('S.10 bundled items show skill name and description', async ({ page, serverUrl }) => {
        await gotoSkills(page, serverUrl);
        await page.click('[data-subtab="bundled"]');

        // pipeline-generator is always in the bundled skills registry
        await expect(page.locator('[data-testid="skills-bundled-item-pipeline-generator"]')).toBeVisible({ timeout: 10_000 });
    });

    test('S.11 install-all button is visible and clickable', async ({ page, serverUrl }) => {
        await gotoSkills(page, serverUrl);
        await page.click('[data-subtab="bundled"]');

        await expect(page.locator('[data-testid="skills-install-all-btn"]')).toBeVisible({ timeout: 10_000 });
        await expect(page.locator('[data-testid="skills-install-all-btn"]')).toBeEnabled();
    });

    test('S.12 install all marks skills with installed badge', async ({ page, serverUrl }) => {
        await gotoSkills(page, serverUrl);
        await page.click('[data-subtab="bundled"]');

        await expect(page.locator('[data-testid="skills-install-all-btn"]')).toBeEnabled({ timeout: 10_000 });
        await page.locator('[data-testid="skills-install-all-btn"]').click();

        // After install, bundled items should show "installed" badge
        await expect(page.locator('[data-testid="skills-bundled-item-pipeline-generator"] .text-\\[\\#137333\\]')).toBeVisible({ timeout: 8_000 });
    });

    test('S.13 source toggle buttons switch view mode', async ({ page, serverUrl }) => {
        await gotoSkills(page, serverUrl);
        await page.click('[data-subtab="bundled"]');

        // Click "GitHub URL" source button
        await page.getByRole('button', { name: 'GitHub URL' }).click();
        await expect(page.locator('input[placeholder*="github.com"]')).toBeVisible({ timeout: 5_000 });

        // Click "Local Path" source button
        await page.getByRole('button', { name: 'Local Path' }).click();
        await expect(page.locator('input[placeholder*="/path/to/skills"]')).toBeVisible({ timeout: 5_000 });
    });
});

// ---------------------------------------------------------------------------
// 4. SkillsConfigPanel
// ---------------------------------------------------------------------------

test.describe('SkillsConfigPanel', () => {
    test('S.14 config panel renders global skills directory', async ({ page, serverUrl }) => {
        await gotoSkills(page, serverUrl);
        await page.click('[data-subtab="config"]');

        // Wait for config to load
        await expect(page.getByText('Global Skills Directory')).toBeVisible({ timeout: 8_000 });
    });

    test('S.15 config panel shows disabled skills section', async ({ page, serverUrl }) => {
        await gotoSkills(page, serverUrl);
        await page.click('[data-subtab="config"]');

        await expect(page.getByText('Globally Disabled Skills', { exact: true })).toBeVisible({ timeout: 8_000 });
    });

    test('S.16 adding a skill to disabled list updates it', async ({ page, serverUrl }) => {
        await gotoSkills(page, serverUrl);
        await page.click('[data-subtab="config"]');

        // Fill in the skill name input and click Disable
        await expect(page.locator('input[placeholder="Skill name to disable…"]')).toBeVisible({ timeout: 8_000 });
        await page.locator('input[placeholder="Skill name to disable…"]').fill('test-skill');
        await page.getByRole('button', { name: 'Disable' }).click();

        // Verify the skill appears in the disabled list
        await expect(page.locator('span').filter({ hasText: 'test-skill' })).toBeVisible({ timeout: 5_000 });

        // Verify via API
        const res = await page.request.get(`${serverUrl}/api/skills/config`);
        const cfg = await res.json();
        expect(cfg.globalDisabledSkills).toContain('test-skill');
    });
});
