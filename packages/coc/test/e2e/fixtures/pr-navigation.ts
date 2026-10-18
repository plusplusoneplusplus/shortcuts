/** Pull Request resource navigation through the workspace's right panel. */
import { expect, type Page } from '@playwright/test';

export function prPanelHash(workspaceId: string, detail = ''): string {
    const owner = encodeURIComponent(workspaceId);
    return `#repos/${owner}/panel/pull-requests/${owner}${detail ? `/${detail}` : ''}`;
}

/** Open or focus the owner-specific PR tab through the resource menu. */
export async function openPrPanel(page: Page): Promise<void> {
    const panel = page.getByTestId('unified-right-panel');
    await expect(panel).toBeAttached({ timeout: 10000 });
    if (await panel.getAttribute('data-open') !== 'true') {
        await page.getByTestId('workspace-dock-toggle').first().click();
    }
    await expect(panel).toHaveAttribute('data-open', 'true', { timeout: 10000 });
    await panel.getByTestId('unified-panel-open-menu').click();
    await page.getByTestId('unified-panel-open-pull-requests').click();
    await expect(panel.locator('[role="tab"][data-kind="pull-requests"]')).toHaveAttribute(
        'aria-selected', 'true', { timeout: 10000 },
    );
}

/** Use the dock's expansion control when asserting the desktop split layout. */
export async function expandPrPanel(page: Page): Promise<void> {
    const panel = page.getByTestId('unified-right-panel');
    await expect(panel).toHaveAttribute('data-open', 'true', { timeout: 10000 });
    if (await panel.getAttribute('data-expanded') !== 'true') {
        await page.getByTestId('workspace-dock-toggle').first().click();
    }
    await expect(panel).toHaveAttribute('data-expanded', 'true', { timeout: 10000 });
}
