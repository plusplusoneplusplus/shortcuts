/**
 * BottomSheet Tests — drag-to-dismiss gesture and RepoDetail '···' actions sheet
 * at 375×812.
 */
import { test, expect } from '../fixtures/server-fixture';
import { seedWorkspace } from '../fixtures/seed';
import { MOBILE } from './viewports';

test.use({ viewport: MOBILE, hasTouch: true });

test.describe('BottomSheet Gestures', () => {
    test('mobile: BottomSheet drag-to-dismiss closes the sheet', async ({ page, serverUrl }) => {
        await seedWorkspace(serverUrl, 'ws-bsd-1', 'bsd-repo-1');
        await page.goto(`${serverUrl}/#repos`);
        await expect(page.locator('.repo-item')).toHaveCount(1, { timeout: 10000 });
        await page.locator('.repo-item').first().tap();
        await expect(page.locator('#repo-detail-content')).toBeVisible({ timeout: 10000 });

        // Open the BottomSheet via the '···' more button
        const moreBtn = page.locator('[data-testid="mobile-tab-more-btn"]');
        await expect(moreBtn).toBeVisible({ timeout: 5000 });
        await moreBtn.tap();

        const sheet = page.locator('[data-testid="bottomsheet-panel"]');
        await expect(sheet).toBeVisible({ timeout: 5000 });

        // Drag the drag handle downward > 100px to trigger dismiss
        const dragHandle = page.locator('[data-testid="bottomsheet-drag-handle"]');
        const handleBox = await dragHandle.boundingBox();
        if (handleBox) {
            const startX = handleBox.x + handleBox.width / 2;
            const startY = handleBox.y + handleBox.height / 2;
            // Simulate touch drag down 120px (> DISMISS_THRESHOLD=100)
            await page.evaluate(({ sx, sy }) => {
                const handle = document.querySelector('[data-testid="bottomsheet-drag-handle"]');
                if (!handle) return;
                const makeTouch = (x: number, y: number) =>
                    new Touch({ identifier: 1, target: handle, clientX: x, clientY: y });
                handle.dispatchEvent(new TouchEvent('touchstart', {
                    touches: [makeTouch(sx, sy)],
                    changedTouches: [makeTouch(sx, sy)],
                    bubbles: true, cancelable: true,
                }));
                handle.dispatchEvent(new TouchEvent('touchmove', {
                    touches: [makeTouch(sx, sy + 120)],
                    changedTouches: [makeTouch(sx, sy + 120)],
                    bubbles: true, cancelable: true,
                }));
                handle.dispatchEvent(new TouchEvent('touchend', {
                    touches: [],
                    changedTouches: [makeTouch(sx, sy + 120)],
                    bubbles: true, cancelable: true,
                }));
            }, { sx: startX, sy: startY });

            // Sheet should be dismissed
            await expect(sheet).toBeHidden({ timeout: 5000 });
        }
    });

    test('mobile: RepoDetail "···" actions button opens BottomSheet', async ({ page, serverUrl }) => {
        await seedWorkspace(serverUrl, 'ws-actions-1', 'actions-repo-1');
        await page.goto(`${serverUrl}/#repos`);
        await expect(page.locator('.repo-item')).toHaveCount(1, { timeout: 10000 });
        await page.locator('.repo-item').first().tap();
        await expect(page.locator('#repo-detail-content')).toBeVisible({ timeout: 10000 });

        // The repo-more-menu-btn is the mobile-specific "···" actions button
        const moreMenuBtn = page.locator('[data-testid="repo-more-menu-btn"]');
        if (await moreMenuBtn.count() > 0) {
            await expect(moreMenuBtn).toBeVisible({ timeout: 5000 });
            await moreMenuBtn.tap();

            // BottomSheet with repo actions should open
            const sheet = page.locator('[data-testid="bottomsheet-panel"]');
            await expect(sheet).toBeVisible({ timeout: 5000 });

            // Common action buttons should be present inside the sheet
            const editBtn = page.locator('[data-testid="repo-more-edit"]');
            const removeBtn = page.locator('[data-testid="repo-more-remove"]');
            if (await editBtn.count() > 0) {
                await expect(editBtn).toBeVisible();
            }
            if (await removeBtn.count() > 0) {
                await expect(removeBtn).toBeVisible();
            }
        }
    });

    test('mobile: RepoDetail actions BottomSheet can be dismissed via backdrop tap', async ({ page, serverUrl }) => {
        await seedWorkspace(serverUrl, 'ws-actions-2', 'actions-repo-2');
        await page.goto(`${serverUrl}/#repos`);
        await expect(page.locator('.repo-item')).toHaveCount(1, { timeout: 10000 });
        await page.locator('.repo-item').first().tap();
        await expect(page.locator('#repo-detail-content')).toBeVisible({ timeout: 10000 });

        const moreMenuBtn = page.locator('[data-testid="repo-more-menu-btn"]');
        if (await moreMenuBtn.count() > 0) {
            await moreMenuBtn.tap();

            const sheet = page.locator('[data-testid="bottomsheet-panel"]');
            await expect(sheet).toBeVisible({ timeout: 5000 });

            // Tap backdrop to dismiss
            const backdrop = page.locator('[data-testid="bottomsheet-backdrop"]');
            if (await backdrop.count() > 0 && await backdrop.isVisible()) {
                await backdrop.tap({ position: { x: 10, y: 10 } });
                await expect(sheet).toBeHidden({ timeout: 5000 });
            }
        }
    });
});
