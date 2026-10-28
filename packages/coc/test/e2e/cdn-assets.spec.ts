import { expect, test } from './fixtures/server-fixture';

test('highlighting assets load without access to the CDN', async ({ page }) => {
    await page.context().setOffline(true);
    await page.setContent(`
        <script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js"></script>
        <script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/languages/powershell.min.js"></script>
    `);

    const highlighted = await page.evaluate(() => {
        const hljs = (window as any).hljs;
        return {
            javascript: hljs.highlight('const answer = 42;', { language: 'javascript' }).value,
            powershell: hljs.highlight('Get-ChildItem', { language: 'powershell' }).value,
        };
    });
    expect(highlighted.javascript).toContain('<span class="hljs-keyword">const</span>');
    expect(highlighted.powershell).toContain('<span class="hljs-built_in">Get-ChildItem</span>');
});
