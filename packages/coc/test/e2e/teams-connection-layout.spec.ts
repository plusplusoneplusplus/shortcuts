import { test, expect } from './fixtures/server-fixture';

for (const width of [390, 1440]) {
    for (const theme of ['light', 'dark']) {
        test(`Teams setup layout at ${width}px in ${theme} mode`, async ({ page, serverUrl }, testInfo) => {
            await page.setViewportSize({ width, height: 1000 });
            const pageErrors: string[] = [];
            page.on('pageerror', error => pageErrors.push(error.message));
            page.on('console', message => {
                if (message.type() === 'error') pageErrors.push(message.text());
            });
            let status = {
                enabled: true, status: 'disconnected', error: null, authStatus: 'authenticated',
                oauthAvailable: true, teamsOAuthAvailable: true,
                serverUrl: `https://example.test/${'endpoint/'.repeat(20)}teams`,
                teamName: 'Engineering', channelName: 'CoC-Desktop', botName: 'CoC',
                enableTrouter: false, ic3Region: null,
                teamsBridgeObservabilityEnabled: true,
            };
            await page.route('**/api/messaging/teams/**', async route => {
                const url = new URL(route.request().url());
                if (url.pathname.endsWith('/config')) {
                    status = { ...status, ...route.request().postDataJSON() };
                }
                await route.fulfill({ json: url.pathname.endsWith('/status') ? status
                    : url.pathname.endsWith('/attempts') ? {
                        attempts: [{
                            id: 'attempt-layout', startedAt: '2026-01-01T00:00:00Z',
                            endedAt: '2026-01-01T00:01:00Z', stage: 'connected', result: 'disconnected',
                        }],
                        total: 1, nextOffset: null,
                    } : url.pathname.endsWith('/attempt-layout') ? {
                        attempt: {
                            id: 'attempt-layout', startedAt: '2026-01-01T00:00:00Z',
                            stage: 'connected', result: 'disconnected', phases: [], events: [], totals: {},
                        },
                    } : { ok: true } });
            });

            await page.goto(`${serverUrl}/#admin/messaging`);
            const card = page.getByTestId('teams-connection-card');
            await expect(card.getByLabel('Teams MCP server URL')).toHaveValue(status.serverUrl);
            await page.evaluate(value => document.documentElement.setAttribute('data-theme', value), theme);

            const advanced = card.locator('.ar-teams-advanced');
            const history = card.locator('.ar-teams-history-disclosure');
            await expect(advanced).not.toHaveAttribute('open');
            await expect(history).not.toHaveAttribute('open');
            await expect(card.getByLabel('IC3 region')).not.toBeVisible();
            await expect(card.getByRole('button', { name: 'Reconnect', exact: true })).toBeEnabled();

            const body = await card.locator('.ar-teams').boundingBox();
            const endpoint = await card.getByLabel('Teams MCP server URL').boundingBox();
            const save = await card.getByRole('button', { name: 'Save MCP endpoint' }).boundingBox();
            expect(endpoint!.x).toBeGreaterThan(body!.x);
            expect(save!.width).toBeLessThan(body!.width * 0.7);
            expect(await card.evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
            await page.screenshot({ path: testInfo.outputPath('teams-setup.png') });

            await advanced.locator('summary').focus();
            await page.keyboard.press('Enter');
            const checkbox = card.getByRole('checkbox', { name: /Experimental notification-driven inbound/ });
            await expect(checkbox).toBeVisible();
            await expect(checkbox).not.toBeChecked();
            const inputBox = await checkbox.boundingBox();
            const labelBox = await card.locator('.ar-teams-checkbox span').boundingBox();
            expect(inputBox!.width).toBeLessThanOrEqual(20);
            expect(labelBox!.x).toBeGreaterThan(inputBox!.x + inputBox!.width);
            expect(Math.abs(labelBox!.y - inputBox!.y)).toBeLessThan(6);

            await checkbox.check();
            await expect(card.getByRole('button', { name: 'Reconnect', exact: true })).toBeDisabled();
            await card.getByRole('button', { name: 'Save channel' }).click();
            await expect(card.getByRole('button', { name: 'Reconnect', exact: true })).toBeEnabled();
            await expect(checkbox).toBeChecked();

            await history.locator(':scope > summary').focus();
            await page.keyboard.press('Enter');
            const attempt = card.locator('.ar-teams-attempt-summary');
            await expect(attempt).toBeVisible();
            await attempt.focus();
            await page.keyboard.press('Enter');
            await expect(card.getByText('MCP acceptance does not confirm Teams displayed a reply.')).toBeVisible();
            expect(await card.evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
            expect(pageErrors).toEqual([]);
        });
    }
}
