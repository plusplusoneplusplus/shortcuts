import type { Page } from '@playwright/test';

/**
 * Render file diffs with the Classic engine on this page. A saved Classic
 * choice applies only while the opt-in `features.diffEngineToggle` setting is
 * on, so the page's runtime config turns it on (page-scoped; the shared e2e
 * server config is untouched) and the cached choice is set before load.
 */
export async function useClassicDiffEngine(page: Page): Promise<void> {
    await page.route('**/api/config/runtime', async (route) => {
        const response = await route.fetch();
        const json = await response.json();
        const features = { ...(json.features ?? {}), diffEngineToggleEnabled: true };
        await route.fulfill({
            status: response.status(),
            headers: { ...response.headers(), 'content-type': 'application/json' },
            body: JSON.stringify({ ...json, features }),
        });
    });
    await page.addInitScript(() => localStorage.setItem('coc-diff-engine', 'legacy'));
}
