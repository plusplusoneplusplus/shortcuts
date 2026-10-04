/** Desktop workspace navigation through hash routes, the picker, and the dock. */
import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';

/** Build the `#repos/{wsId}[/{subtab}]` hash for a workspace. */
export function repoHashUrl(serverUrl: string, workspaceId: string, subtab?: string): string {
    const base = `${serverUrl}/#repos/${encodeURIComponent(workspaceId)}`;
    return subtab ? `${base}/${subtab}` : base;
}

/** Navigate to a known workspace and wait for its detail body. */
export async function gotoWorkspace(
    page: Page,
    serverUrl: string,
    workspaceId: string,
    subtab?: string,
): Promise<void> {
    await page.goto(repoHashUrl(serverUrl, workspaceId, subtab));
    await expect(page.locator('#repo-detail-content')).toBeVisible({ timeout: 15_000 });
}

/** Open the picker, optionally filtering rows; leave it open for the caller. */
export async function openRemotePicker(page: Page, query?: string): Promise<void> {
    await expect(page.locator('[data-testid="remote-chip"]').first()).toBeVisible({ timeout: 20_000 });
    await page.locator('[data-testid="remote-chip"]').first().click();
    await expect(page.locator('[data-testid="remote-dropdown"]')).toBeVisible({ timeout: 10_000 });
    if (query !== undefined) {
        await page.locator('[data-testid="remote-search-input"]').fill(query);
    }
}

/** Select a uniquely named workspace through the picker. */
export async function selectRepoNamed(page: Page, name: string): Promise<void> {
    await openRemotePicker(page, name);
    const row = page.locator('[data-testid="remote-dropdown-item"]');
    await expect(row).toHaveCount(1, { timeout: 30_000 });
    await row.click();
    await expect(page.locator('#repo-detail-content')).toBeVisible({ timeout: 15_000 });
}

/** Open a workspace tab, using overflow when it is not inline. */
export async function openSubTab(page: Page, key: string): Promise<void> {
    const inline = page.locator(`button[data-subtab="${key}"]`).first();
    if (await inline.isVisible().catch(() => false)) {
        await inline.click();
    } else {
        await page.locator('[data-testid="subbar-overflow-toggle"]').click();
        await page.locator(`[data-testid="subbar-overflow-menu"] [data-subtab="${key}"]`).click();
    }
}

export type AddRepoOption =
    | 'remote-add-folder-option'
    | 'remote-add-repo-option'
    | 'remote-clone-repo-option'
    | 'remote-new-repo-group-option';

/** Open an add/clone/group dialog through the picker's footer. */
export async function openAddRepoOption(page: Page, option: AddRepoOption): Promise<void> {
    await openRemotePicker(page);
    await page.locator(`[data-testid="${option}"]`).click();
}

/** Remove a single-clone workspace through its picker row menu. */
export async function removeWorkspaceViaRowMenu(page: Page, name: string): Promise<void> {
    await openRemotePicker(page, name);
    const row = page.locator('[data-testid="remote-dropdown-item"]');
    await expect(row).toHaveCount(1, { timeout: 10_000 });

    const rowMenu = page.locator('[data-testid="remote-dropdown-row-menu"]');
    await expect(rowMenu).toHaveCount(1);
    await rowMenu.click();

    const menu = page.locator('[data-testid="context-menu"]');
    await expect(menu).toBeVisible({ timeout: 5_000 });
    await menu.getByRole('menuitem', { name: /Remove from CoC/ }).click();

    const dialog = page.locator('#clone-remove-dialog');
    await expect(dialog).toBeVisible({ timeout: 5_000 });
    await page.locator('[data-testid="clone-remove-confirm-btn"]').click();
    await expect(dialog).toBeHidden({ timeout: 10_000 });
}

/** Reveal the dock and its Explorer tree without toggling an open dock closed. */
export async function openExplorerPanel(page: Page): Promise<void> {
    const panel = page.locator('[data-testid="unified-right-panel"]');
    if ((await panel.getAttribute('data-open')) !== 'true') {
        await page.locator('[data-testid="workspace-dock-toggle"]').first().click();
        await expect(panel).toHaveAttribute('data-open', 'true', { timeout: 10_000 });
    }
    const explorerMode = panel.locator('[data-testid="unified-panel-explorer-mode"]');
    if (!(await explorerMode.isVisible().catch(() => false))) {
        await page.locator('[data-testid="unified-panel-tree-toggle"]').first().click();
    }
    await expect(explorerMode).toBeVisible({ timeout: 10_000 });
}
