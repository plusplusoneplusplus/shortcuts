import type { Page } from '@playwright/test';
import { expect, test } from './fixtures/server-fixture';

const WIKI_ID = 'mock-scroll-wiki';
const COMPONENT_ID = 'long-article-component';

function buildLongMarkdown(paragraphCount = 220): string {
    const lines: string[] = ['# Scroll Regression Fixture', ''];
    for (let i = 1; i <= paragraphCount; i++) {
        lines.push(`## Section ${i}`);
        lines.push(`Paragraph ${i}: this line exists to force a tall article for scroll testing.`);
        lines.push(`Detail ${i}: middle pane scrolling must keep working after layout updates.`);
        lines.push('');
    }
    return lines.join('\n');
}

async function mockWikiEndpoints(page: Page): Promise<void> {
    const markdown = buildLongMarkdown();

    await page.route('**/api/wikis**', async (route, request) => {
        if (request.method() !== 'GET') {
            return route.continue();
        }

        const url = new URL(request.url());
        const pathname = url.pathname;

        if (pathname.endsWith('/api/wikis')) {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    wikis: [
                        {
                            id: WIKI_ID,
                            name: 'Mock Scroll Wiki',
                            status: 'loaded',
                            loaded: true,
                            color: '#0078d4',
                            componentCount: 1,
                        },
                    ],
                }),
            });
            return;
        }

        if (pathname.endsWith(`/api/wikis/${WIKI_ID}/graph`)) {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    project: {
                        name: 'Mock Scroll Wiki',
                        description: 'Mocked graph for scroll regression e2e',
                        mainLanguage: 'TypeScript',
                    },
                    categories: [{ id: 'docs', name: 'docs' }],
                    components: [
                        {
                            id: COMPONENT_ID,
                            name: 'Long Article Component',
                            path: 'src/long-article-component',
                            purpose: 'Contains enough content to validate middle-pane scrolling.',
                            category: 'docs',
                            dependencies: [],
                            dependents: [],
                            complexity: 'medium',
                        },
                    ],
                }),
            });
            return;
        }

        if (pathname.endsWith(`/api/wikis/${WIKI_ID}/components/${COMPONENT_ID}`)) {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ markdown }),
            });
            return;
        }

        return route.continue();
    });
}

test.describe('Wiki middle pane scroll regression (mock API)', () => {
    test('article pane remains scrollable with mouse wheel input', async ({ page, serverUrl }) => {
        await mockWikiEndpoints(page);

        await page.goto(
            `${serverUrl}#wiki/${encodeURIComponent(WIKI_ID)}/component/${encodeURIComponent(COMPONENT_ID)}`,
        );

        const articlePane = page.locator('#wiki-article-content');
        await expect(articlePane).toBeVisible({ timeout: 10_000 });
        await expect(articlePane).toContainText('Scroll Regression Fixture');

        const metrics = await articlePane.evaluate((el) => ({
            clientHeight: el.clientHeight,
            scrollHeight: el.scrollHeight,
            overflowY: getComputedStyle(el).overflowY,
        }));

        expect(metrics.scrollHeight).toBeGreaterThan(metrics.clientHeight);
        expect(['auto', 'scroll']).toContain(metrics.overflowY);

        const before = await articlePane.evaluate((el) => el.scrollTop);
        const box = await articlePane.boundingBox();
        expect(box).not.toBeNull();

        await page.mouse.move(
            box!.x + box!.width / 2,
            box!.y + Math.min(200, Math.max(10, box!.height / 2)),
        );
        await page.mouse.wheel(0, 1600);
        await page.waitForTimeout(200);

        const after = await articlePane.evaluate((el) => el.scrollTop);
        expect(after).toBeGreaterThan(before);

        const windowScrollY = await page.evaluate(() => window.scrollY);
        expect(windowScrollY).toBe(0);
    });
});
