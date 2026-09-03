/**
 * `features.explorerEditorTabs` (the Explorer multi-tab editor) ships default-off
 * and the shared E2E server config leaves it off, so a spec that wants the tab
 * strip has to turn it on for its own server first.
 *
 * It is a `runtime: 'live'` flag, so this must run BEFORE the page load that
 * should see tabs. The server fixture gives each test its own `configPath`, so
 * the write cannot leak into another test.
 */

import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';
import { request } from './seed';

/** Turn the Explorer editor tabs on for this test's server. Call before `page.goto`. */
export async function enableExplorerEditorTabs(baseURL: string): Promise<void> {
    const res = await request(`${baseURL}/api/admin/config`, {
        method: 'PUT',
        body: JSON.stringify({ 'features.explorerEditorTabs': true }),
    });
    if (res.status !== 200) {
        throw new Error(`Failed to enable explorer editor tabs: ${res.status} ${res.body}`);
    }
}

/** The tab row for one open editor, addressed by tab id — never by position. */
export function editorTab(page: Page, tabId: string) {
    return page.locator(`[data-testid="explorer-tab-list"] [data-tab-id="${tabId}"]`);
}

/** The ids of the open tabs, in strip order. */
export async function openEditorTabIds(page: Page): Promise<string[]> {
    return page.locator('[data-testid="explorer-tab-list"] [data-tab-id]').evaluateAll(
        nodes => nodes.map(node => node.getAttribute('data-tab-id') ?? ''),
    );
}

/** Wait until exactly these tabs are open, in this order. */
export async function expectEditorTabs(page: Page, ids: string[]): Promise<void> {
    await expect.poll(() => openEditorTabIds(page), { timeout: 8_000 }).toEqual(ids);
}
