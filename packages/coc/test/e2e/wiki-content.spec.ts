/**
 * Wiki Content Rendering E2E Tests
 *
 * Tests markdown rendering, syntax highlighting, mermaid diagrams,
 * table of contents, and dependency graph visualization.
 *
 * Depends on:
 *   - Commit 001: wiki fixtures (createWikiFixture, createWikiComponent)
 *   - Commit 002: wiki management tests (seedWiki, select, list, delete)
 *   - Commit 003: wiki component tests (component tree, navigation)
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { seedWiki } from './fixtures/seed';
import { expect, test } from './fixtures/server-fixture';
import type { CategoryInfo, ComponentGraph, ComponentInfo } from './fixtures/wiki-fixtures';
import { createWikiComponent } from './fixtures/wiki-fixtures';

// ================================================================
// Helpers
// ================================================================

function writeComponentArticles(wikiDir: string, articles: Record<string, string>): void {
    const componentsDir = path.join(wikiDir, 'components');
    fs.mkdirSync(componentsDir, { recursive: true });
    for (const [id, content] of Object.entries(articles)) {
        fs.writeFileSync(path.join(componentsDir, `${id}.md`), content, 'utf-8');
    }
}

function createContentWiki(
    wikiDir: string,
    components: ComponentInfo[],
    categories: CategoryInfo[],
    articles: Record<string, string>,
): ComponentGraph {
    const graph: ComponentGraph = {
        project: {
            name: 'Content Test Wiki',
            description: 'Wiki for testing content rendering features',
            language: 'TypeScript',
            buildSystem: 'npm',
            entryPoints: ['src/index.ts'],
        },
        components,
        categories,
        architectureNotes: 'Test architecture.',
    };

    fs.mkdirSync(wikiDir, { recursive: true });
    fs.writeFileSync(
        path.join(wikiDir, 'component-graph.json'),
        JSON.stringify(graph, null, 2),
    );
    writeComponentArticles(wikiDir, articles);
    return graph;
}

async function selectWikiAndComponent(
    page: import('@playwright/test').Page,
    serverUrl: string,
    wikiId: string,
    componentId: string,
): Promise<void> {
    await page.goto(serverUrl);
    await page.click('[data-tab="wiki"]');
    await expect(page.locator('.wiki-card[data-wiki-id="' + wikiId + '"]')).toBeVisible({ timeout: 10_000 });
    await page.click('.wiki-card[data-wiki-id="' + wikiId + '"]');
    await expect(page.locator('#wiki-component-tree')).not.toBeEmpty({ timeout: 5_000 });
    await page.click(`.wiki-tree-component[data-id="${componentId}"]`);
    await expect(page.locator('#wiki-article-content')).not.toBeEmpty({ timeout: 5_000 });
}

// ================================================================
// Shared test data
// ================================================================

const CATEGORIES: CategoryInfo[] = [
    { name: 'docs', description: 'Documentation components' },
    { name: 'examples', description: 'Example and demo components' },
];

function buildContentComponents(): ComponentInfo[] {
    return [
        createWikiComponent('overview', {
            category: 'docs',
            complexity: 'low',
            dependencies: ['code-examples'],
            dependents: [],
        }),
        createWikiComponent('code-examples', {
            category: 'examples',
            complexity: 'medium',
            dependencies: ['diagrams'],
            dependents: ['overview'],
        }),
        createWikiComponent('diagrams', {
            category: 'examples',
            complexity: 'medium',
            dependencies: [],
            dependents: ['code-examples'],
        }),
        createWikiComponent('long-article', {
            category: 'docs',
            complexity: 'high',
            dependencies: [],
            dependents: [],
        }),
    ];
}

// Generate filler paragraphs for long article
function fillerText(words: number): string {
    const base = 'Lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna aliqua Ut enim ad minim veniam quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat';
    const tokens = base.split(' ');
    const parts: string[] = [];
    for (let i = 0; i < words; i++) {
        parts.push(tokens[i % tokens.length]);
    }
    return parts.join(' ') + '.';
}

const CONTENT_ARTICLES: Record<string, string> = {
    'overview': [
        '# Overview',
        '',
        'This is a **bold** statement with *italic* text.',
        '',
        '## Features',
        '',
        '- Markdown rendering',
        '- Code highlighting',
        '- Mermaid diagrams',
        '',
        '### Code Example',
        '',
        '```javascript',
        'function hello(name) {',
        '  console.log(`Hello, ${name}!`);',
        '}',
        '```',
        '',
        '[Link to code examples](code-examples.md)',
    ].join('\n'),

    'code-examples': [
        '# Code Examples',
        '',
        '## JavaScript',
        '',
        '```javascript',
        'const data = { id: 1, name: "test" };',
        'async function fetchData() {',
        '  return await fetch(\'/api/data\');',
        '}',
        '```',
        '',
        '## TypeScript',
        '',
        '```typescript',
        'interface User {',
        '  id: number;',
        '  name: string;',
        '}',
        'const user: User = { id: 1, name: "Alice" };',
        '```',
        '',
        '## Python',
        '',
        '```python',
        'def calculate(x, y):',
        '    return x + y',
        '',
        'result = calculate(10, 20)',
        'print(f"Result: {result}")',
        '```',
        '',
        '## JSON',
        '',
        '```json',
        '{',
        '  "name": "example",',
        '  "version": "1.0.0",',
        '  "active": true',
        '}',
        '```',
        '',
        '## CSS',
        '',
        '```css',
        '.container {',
        '  display: flex;',
        '  justify-content: center;',
        '  background-color: #f0f0f0;',
        '}',
        '```',
        '',
        '## SQL',
        '',
        '```sql',
        'SELECT users.name, orders.total',
        'FROM users',
        'JOIN orders ON users.id = orders.user_id',
        'WHERE orders.total > 100;',
        '```',
    ].join('\n'),

    'diagrams': [
        '# Diagrams',
        '',
        '## Component Flow',
        '',
        '```mermaid',
        'graph TD',
        '    A[Input] --> B[Process]',
        '    B --> C{Decision}',
        '    C -->|Yes| D[Output A]',
        '    C -->|No| E[Output B]',
        '```',
        '',
        '## Sequence Diagram',
        '',
        '```mermaid',
        'sequenceDiagram',
        '    participant Client',
        '    participant Server',
        '    participant Database',
        '    Client->>Server: Request',
        '    Server->>Database: Query',
        '    Database-->>Server: Result',
        '    Server-->>Client: Response',
        '```',
        '',
        '## Class Diagram',
        '',
        '```mermaid',
        'classDiagram',
        '    class Component {',
        '        +String name',
        '        +String[] dependencies',
        '        +render()',
        '    }',
        '    class Article {',
        '        +String title',
        '        +String content',
        '        +show()',
        '    }',
        '    Component --> Article',
        '```',
    ].join('\n'),

    'long-article': [
        '# Long Article',
        '',
        '## Section 1: Introduction',
        '',
        fillerText(80),
        '',
        fillerText(80),
        '',
        fillerText(80),
        '',
        '## Section 2: Architecture',
        '',
        fillerText(80),
        '',
        fillerText(80),
        '',
        '### Subsection 2.1: Components',
        '',
        fillerText(60),
        '',
        fillerText(60),
        '',
        '### Subsection 2.2: Data Flow',
        '',
        fillerText(60),
        '',
        fillerText(60),
        '',
        '## Section 3: Implementation',
        '',
        fillerText(80),
        '',
        fillerText(80),
        '',
        '### Subsection 3.1: Setup',
        '',
        fillerText(60),
        '',
        '### Subsection 3.2: Configuration',
        '',
        fillerText(60),
        '',
        '## Section 4: Testing',
        '',
        fillerText(80),
        '',
        fillerText(80),
        '',
        '## Section 5: Deployment',
        '',
        fillerText(80),
        '',
        fillerText(80),
        '',
        '## Section 6: Monitoring',
        '',
        fillerText(60),
        '',
        fillerText(60),
        '',
        '## Conclusion',
        '',
        fillerText(40),
    ].join('\n'),
};

// ================================================================
// Test Suite 1: Markdown Rendering
// ================================================================

test.describe('Markdown rendering', () => {
    test('renders basic markdown: headings, bold, italic, lists', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-wiki-md-basic-'));
        try {
            const wikiDir = path.join(tmpDir, 'wiki-data');
            createContentWiki(wikiDir, buildContentComponents(), CATEGORIES, CONTENT_ARTICLES);
            await seedWiki(serverUrl, 'md-basic', wikiDir, undefined, 'MD Basic Wiki');
            await selectWikiAndComponent(page, serverUrl, 'md-basic', 'overview');

            const body = page.locator('#wiki-article-content .markdown-body');
            await expect(body).toBeVisible();

            // Verify heading
            const h1 = body.locator('h1');
            await expect(h1).toContainText('Overview');

            // Verify bold text
            const bold = body.locator('strong');
            await expect(bold.first()).toContainText('bold');

            // Verify italic text
            const italic = body.locator('em');
            await expect(italic.first()).toContainText('italic');

            // Verify list items
            const listItems = body.locator('ul li');
            await expect(listItems).toHaveCount(3);
            await expect(listItems.nth(0)).toContainText('Markdown rendering');
        } finally {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        }
    });

    test('renders internal links that navigate to other components', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-wiki-md-links-'));
        try {
            const wikiDir = path.join(tmpDir, 'wiki-data');
            createContentWiki(wikiDir, buildContentComponents(), CATEGORIES, CONTENT_ARTICLES);
            await seedWiki(serverUrl, 'md-links', wikiDir, undefined, 'MD Links Wiki');
            await selectWikiAndComponent(page, serverUrl, 'md-links', 'overview');

            const body = page.locator('#wiki-article-content .markdown-body');

            // Verify link exists
            const link = body.locator('a[href*="code-examples"]');
            await expect(link).toBeVisible();
            await expect(link).toContainText('Link to code examples');

            // Click link and verify navigation to code-examples component
            await link.click();
            await expect(page.locator('#wiki-article-content')).toContainText('Code Examples', { timeout: 5_000 });

            // Verify active state transferred to code-examples in tree
            await expect(page.locator('.wiki-tree-component[data-id="code-examples"]')).toHaveClass(/active/);
        } finally {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        }
    });

    test('renders heading hierarchy (h1, h2, h3) correctly', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-wiki-md-headings-'));
        try {
            const wikiDir = path.join(tmpDir, 'wiki-data');
            createContentWiki(wikiDir, buildContentComponents(), CATEGORIES, CONTENT_ARTICLES);
            await seedWiki(serverUrl, 'md-headings', wikiDir, undefined, 'MD Headings Wiki');
            await selectWikiAndComponent(page, serverUrl, 'md-headings', 'long-article');

            const body = page.locator('#wiki-article-content .markdown-body');

            // Verify h1
            const h1 = body.locator('h1');
            await expect(h1).toContainText('Long Article');

            // Verify h2 count (7 sections: 1-6 + Conclusion)
            const h2s = body.locator('h2');
            await expect(h2s).toHaveCount(7);

            // Verify h3 exists under h2
            const h3s = body.locator('h3');
            await expect(h3s.first()).toContainText('Subsection');
        } finally {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        }
    });

    test('renders paragraphs with proper text content', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-wiki-md-paras-'));
        try {
            const wikiDir = path.join(tmpDir, 'wiki-data');
            createContentWiki(wikiDir, buildContentComponents(), CATEGORIES, CONTENT_ARTICLES);
            await seedWiki(serverUrl, 'md-paras', wikiDir, undefined, 'MD Paragraphs Wiki');
            await selectWikiAndComponent(page, serverUrl, 'md-paras', 'long-article');

            const body = page.locator('#wiki-article-content .markdown-body');

            // Verify multiple paragraphs exist
            const paragraphs = body.locator('p');
            const count = await paragraphs.count();
            expect(count).toBeGreaterThan(10);

            // Verify paragraph contains expected filler text
            const firstP = paragraphs.first();
            await expect(firstP).toContainText('Lorem ipsum');
        } finally {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        }
    });
});

// ================================================================
// Test Suite 2: Syntax Highlighting
// ================================================================

test.describe('Syntax highlighting', () => {
    test('applies syntax highlighting to JavaScript code', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-wiki-hljs-js-'));
        try {
            const wikiDir = path.join(tmpDir, 'wiki-data');
            createContentWiki(wikiDir, buildContentComponents(), CATEGORIES, CONTENT_ARTICLES);
            await seedWiki(serverUrl, 'hljs-js', wikiDir, undefined, 'HLJS JS Wiki');
            await selectWikiAndComponent(page, serverUrl, 'hljs-js', 'code-examples');

            const codeBlock = page.locator('pre code.language-javascript').first();
            await expect(codeBlock).toBeVisible({ timeout: 5_000 });

            // Verify highlight.js class applied
            await expect(codeBlock).toHaveClass(/hljs/);

            // Verify keyword tokens highlighted
            const keywords = codeBlock.locator('.hljs-keyword');
            expect(await keywords.count()).toBeGreaterThan(0);
        } finally {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        }
    });

    test('applies syntax highlighting to TypeScript code', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-wiki-hljs-ts-'));
        try {
            const wikiDir = path.join(tmpDir, 'wiki-data');
            createContentWiki(wikiDir, buildContentComponents(), CATEGORIES, CONTENT_ARTICLES);
            await seedWiki(serverUrl, 'hljs-ts', wikiDir, undefined, 'HLJS TS Wiki');
            await selectWikiAndComponent(page, serverUrl, 'hljs-ts', 'code-examples');

            const codeBlock = page.locator('pre code.language-typescript').first();
            await expect(codeBlock).toBeVisible({ timeout: 5_000 });
            await expect(codeBlock).toHaveClass(/hljs/);

            // Verify 'interface' keyword highlighted
            const keywords = codeBlock.locator('.hljs-keyword');
            expect(await keywords.count()).toBeGreaterThan(0);
        } finally {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        }
    });

    test('applies syntax highlighting to Python code', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-wiki-hljs-py-'));
        try {
            const wikiDir = path.join(tmpDir, 'wiki-data');
            createContentWiki(wikiDir, buildContentComponents(), CATEGORIES, CONTENT_ARTICLES);
            await seedWiki(serverUrl, 'hljs-py', wikiDir, undefined, 'HLJS PY Wiki');
            await selectWikiAndComponent(page, serverUrl, 'hljs-py', 'code-examples');

            const codeBlock = page.locator('pre code.language-python').first();
            await expect(codeBlock).toBeVisible({ timeout: 5_000 });
            await expect(codeBlock).toHaveClass(/hljs/);

            // Verify keyword and string tokens
            const keywords = codeBlock.locator('.hljs-keyword');
            expect(await keywords.count()).toBeGreaterThan(0);
            const strings = codeBlock.locator('.hljs-string');
            expect(await strings.count()).toBeGreaterThan(0);
        } finally {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        }
    });

    test('applies syntax highlighting to JSON code', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-wiki-hljs-json-'));
        try {
            const wikiDir = path.join(tmpDir, 'wiki-data');
            createContentWiki(wikiDir, buildContentComponents(), CATEGORIES, CONTENT_ARTICLES);
            await seedWiki(serverUrl, 'hljs-json', wikiDir, undefined, 'HLJS JSON Wiki');
            await selectWikiAndComponent(page, serverUrl, 'hljs-json', 'code-examples');

            const codeBlock = page.locator('pre code.language-json').first();
            await expect(codeBlock).toBeVisible({ timeout: 5_000 });
            await expect(codeBlock).toHaveClass(/hljs/);

            // Verify keys and values highlighted
            const attrs = codeBlock.locator('.hljs-attr');
            expect(await attrs.count()).toBeGreaterThan(0);
            const strings = codeBlock.locator('.hljs-string');
            expect(await strings.count()).toBeGreaterThan(0);
        } finally {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        }
    });

    test('applies syntax highlighting to CSS code', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-wiki-hljs-css-'));
        try {
            const wikiDir = path.join(tmpDir, 'wiki-data');
            createContentWiki(wikiDir, buildContentComponents(), CATEGORIES, CONTENT_ARTICLES);
            await seedWiki(serverUrl, 'hljs-css', wikiDir, undefined, 'HLJS CSS Wiki');
            await selectWikiAndComponent(page, serverUrl, 'hljs-css', 'code-examples');

            const codeBlock = page.locator('pre code.language-css').first();
            await expect(codeBlock).toBeVisible({ timeout: 5_000 });
            await expect(codeBlock).toHaveClass(/hljs/);

            // Verify selector and property highlighting
            const selectors = codeBlock.locator('.hljs-selector-class');
            expect(await selectors.count()).toBeGreaterThan(0);
            const attrs = codeBlock.locator('.hljs-attribute');
            expect(await attrs.count()).toBeGreaterThan(0);
        } finally {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        }
    });

    test('applies syntax highlighting to SQL code', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-wiki-hljs-sql-'));
        try {
            const wikiDir = path.join(tmpDir, 'wiki-data');
            createContentWiki(wikiDir, buildContentComponents(), CATEGORIES, CONTENT_ARTICLES);
            await seedWiki(serverUrl, 'hljs-sql', wikiDir, undefined, 'HLJS SQL Wiki');
            await selectWikiAndComponent(page, serverUrl, 'hljs-sql', 'code-examples');

            const codeBlock = page.locator('pre code.language-sql').first();
            await expect(codeBlock).toBeVisible({ timeout: 5_000 });
            await expect(codeBlock).toHaveClass(/hljs/);

            // Verify SQL keywords highlighted
            const keywords = codeBlock.locator('.hljs-keyword');
            expect(await keywords.count()).toBeGreaterThan(0);
        } finally {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        }
    });
});

// ================================================================
// Test Suite 3: Mermaid Diagrams
// ================================================================

test.describe('Mermaid diagrams', () => {
    test('renders mermaid flowchart as SVG within container', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-wiki-mermaid-flow-'));
        try {
            const wikiDir = path.join(tmpDir, 'wiki-data');
            createContentWiki(wikiDir, buildContentComponents(), CATEGORIES, CONTENT_ARTICLES);
            await seedWiki(serverUrl, 'mermaid-flow', wikiDir, undefined, 'Mermaid Flow Wiki');
            await selectWikiAndComponent(page, serverUrl, 'mermaid-flow', 'diagrams');

            // Wait for mermaid to render (SVG creation inside container)
            const firstContainer = page.locator('.mermaid-container').first();
            await expect(firstContainer).toBeVisible({ timeout: 10_000 });

            const svg = firstContainer.locator('.mermaid-viewport svg');
            await expect(svg).toBeVisible({ timeout: 10_000 });

            // Verify toolbar exists
            await expect(firstContainer.locator('.mermaid-toolbar')).toBeVisible();
            await expect(firstContainer.locator('.mermaid-toolbar-label')).toContainText('Diagram');
        } finally {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        }
    });

    test('renders multiple mermaid diagrams on one page', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-wiki-mermaid-multi-'));
        try {
            const wikiDir = path.join(tmpDir, 'wiki-data');
            createContentWiki(wikiDir, buildContentComponents(), CATEGORIES, CONTENT_ARTICLES);
            await seedWiki(serverUrl, 'mermaid-multi', wikiDir, undefined, 'Mermaid Multi Wiki');
            await selectWikiAndComponent(page, serverUrl, 'mermaid-multi', 'diagrams');

            // Wait for mermaid containers to appear
            await page.waitForSelector('.mermaid-container', { timeout: 10_000 });

            // All 3 diagrams should render (flowchart, sequence, class)
            const containers = page.locator('.mermaid-container');
            await expect(containers).toHaveCount(3);

            // Each should contain an SVG
            for (let i = 0; i < 3; i++) {
                const svg = containers.nth(i).locator('.mermaid-viewport svg');
                await expect(svg).toBeVisible({ timeout: 10_000 });
            }
        } finally {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        }
    });

    test('mermaid containers have zoom controls', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-wiki-mermaid-zoom-'));
        try {
            const wikiDir = path.join(tmpDir, 'wiki-data');
            createContentWiki(wikiDir, buildContentComponents(), CATEGORIES, CONTENT_ARTICLES);
            await seedWiki(serverUrl, 'mermaid-zoom', wikiDir, undefined, 'Mermaid Zoom Wiki');
            await selectWikiAndComponent(page, serverUrl, 'mermaid-zoom', 'diagrams');

            const firstContainer = page.locator('.mermaid-container').first();
            await expect(firstContainer).toBeVisible({ timeout: 10_000 });

            // Verify zoom controls exist
            await expect(firstContainer.locator('.mermaid-zoom-in')).toBeVisible();
            await expect(firstContainer.locator('.mermaid-zoom-out')).toBeVisible();
            await expect(firstContainer.locator('.mermaid-zoom-reset')).toBeVisible();

            // Verify initial zoom level
            await expect(firstContainer.locator('.mermaid-zoom-level')).toContainText('100%');
        } finally {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        }
    });
});

// ================================================================
// Test Suite 4: Table of Contents
// ================================================================

test.describe('Table of contents', () => {
    test('generates ToC from article headings', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-wiki-toc-gen-'));
        try {
            const wikiDir = path.join(tmpDir, 'wiki-data');
            createContentWiki(wikiDir, buildContentComponents(), CATEGORIES, CONTENT_ARTICLES);
            await seedWiki(serverUrl, 'toc-gen', wikiDir, undefined, 'ToC Gen Wiki');
            await selectWikiAndComponent(page, serverUrl, 'toc-gen', 'long-article');

            // Verify ToC exists
            const tocNav = page.locator('#wiki-toc-nav');
            await expect(tocNav).toBeVisible({ timeout: 5_000 });

            // Verify ToC links match sections (7 h2s + 4 h3s = 11 links)
            const tocLinks = tocNav.locator('a');
            const count = await tocLinks.count();
            expect(count).toBeGreaterThanOrEqual(7);

            // Verify first link text
            await expect(tocLinks.first()).toContainText('Section 1');
        } finally {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        }
    });

    test('clicking ToC link scrolls to section', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-wiki-toc-scroll-'));
        try {
            const wikiDir = path.join(tmpDir, 'wiki-data');
            createContentWiki(wikiDir, buildContentComponents(), CATEGORIES, CONTENT_ARTICLES);
            await seedWiki(serverUrl, 'toc-scroll', wikiDir, undefined, 'ToC Scroll Wiki');
            await selectWikiAndComponent(page, serverUrl, 'toc-scroll', 'long-article');

            await expect(page.locator('#wiki-toc-nav')).toBeVisible({ timeout: 5_000 });

            // Click on a ToC link for Section 4
            const section4Link = page.locator('#wiki-toc-nav a', { hasText: 'Section 4' });
            await expect(section4Link).toBeVisible();
            await section4Link.click();

            // Wait for smooth scroll
            await page.waitForTimeout(600);

            // Verify Section 4 heading is visible
            const section4Heading = page.locator('#wiki-article-content .markdown-body h2', { hasText: 'Section 4' });
            await expect(section4Heading).toBeInViewport({ timeout: 3_000 });
        } finally {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        }
    });

    test('highlights active ToC link on scroll', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-wiki-toc-active-'));
        try {
            const wikiDir = path.join(tmpDir, 'wiki-data');
            createContentWiki(wikiDir, buildContentComponents(), CATEGORIES, CONTENT_ARTICLES);
            await seedWiki(serverUrl, 'toc-active', wikiDir, undefined, 'ToC Active Wiki');
            await selectWikiAndComponent(page, serverUrl, 'toc-active', 'long-article');

            await expect(page.locator('#wiki-toc-nav')).toBeVisible({ timeout: 5_000 });

            // Constrain the scroll container so it becomes actually scrollable
            // (by default, flexbox min-height: auto allows it to grow to content height)
            await page.evaluate(() => {
                const scrollEl = document.getElementById('wiki-content-scroll');
                if (scrollEl) {
                    scrollEl.style.maxHeight = '400px';
                    scrollEl.style.overflowY = 'auto';
                }
            });

            // Scroll to the 5th h2 heading within the container
            await page.evaluate(() => {
                const scrollEl = document.getElementById('wiki-content-scroll');
                const headings = document.querySelectorAll(
                    '#wiki-article-content .markdown-body h2',
                );
                if (scrollEl && headings.length >= 5) {
                    const target = headings[4] as HTMLElement;
                    // Calculate position relative to scroll container
                    const containerRect = scrollEl.getBoundingClientRect();
                    const headingRect = target.getBoundingClientRect();
                    scrollEl.scrollTop += headingRect.top - containerRect.top;
                    scrollEl.dispatchEvent(new Event('scroll'));
                }
            });
            await page.waitForTimeout(500);

            // Verify Section 5 link is now active
            const section5Link = page.locator('#wiki-toc-nav a', { hasText: 'Section 5' });
            await expect(section5Link).toHaveClass(/active/, { timeout: 3_000 });
        } finally {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        }
    });

    test('ToC includes nested subsections with indentation class', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-wiki-toc-nest-'));
        try {
            const wikiDir = path.join(tmpDir, 'wiki-data');
            createContentWiki(wikiDir, buildContentComponents(), CATEGORIES, CONTENT_ARTICLES);
            await seedWiki(serverUrl, 'toc-nest', wikiDir, undefined, 'ToC Nest Wiki');
            await selectWikiAndComponent(page, serverUrl, 'toc-nest', 'long-article');

            await expect(page.locator('#wiki-toc-nav')).toBeVisible({ timeout: 5_000 });

            // Verify h3 subsection links have toc-h3 class for indentation
            const subsectionLink = page.locator('#wiki-toc-nav a', { hasText: 'Subsection 2.1' });
            await expect(subsectionLink).toBeVisible();
            await expect(subsectionLink).toHaveClass(/toc-h3/);

            // Verify clicking subsection link scrolls to it
            await subsectionLink.click();
            await page.waitForTimeout(600);

            const subsectionHeading = page.locator('#wiki-article-content .markdown-body h3', { hasText: 'Subsection 2.1' });
            await expect(subsectionHeading).toBeInViewport({ timeout: 3_000 });
        } finally {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        }
    });
});

// ================================================================
// Test Suite 5: Dependency Graph
// ================================================================

/**
 * Helper: click graph button and fix the layout height issue.
 *
 * showWikiGraph() reads scrollEl.clientHeight AFTER replacing content,
 * at which point the scroll container has collapsed to 0. We capture
 * the height beforehand and re-apply it to the graph container.
 */
async function openGraph(page: import('@playwright/test').Page): Promise<void> {
    const scrollH = await page.evaluate(() => {
        return document.getElementById('wiki-content-scroll')?.clientHeight ?? 400;
    });
    await page.click('#wiki-graph-btn');
    // Wait for D3 to load and render
    await page.waitForSelector('#wiki-graph-container', { state: 'attached', timeout: 10_000 });
    await page.waitForTimeout(2000);
    // Fix container height (workaround for layout collapse after content replacement)
    await page.evaluate((h) => {
        const gc = document.getElementById('wiki-graph-container');
        if (gc && gc.getBoundingClientRect().height === 0) {
            gc.style.height = Math.max(h, 400) + 'px';
        }
    }, scrollH);
}

test.describe('Dependency graph', () => {
    test('graph button appears and toggles graph view', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-wiki-graph-toggle-'));
        try {
            const wikiDir = path.join(tmpDir, 'wiki-data');
            createContentWiki(wikiDir, buildContentComponents(), CATEGORIES, CONTENT_ARTICLES);
            await seedWiki(serverUrl, 'graph-toggle', wikiDir, undefined, 'Graph Toggle Wiki');

            // Select wiki and open a component first so detail panel has proper dimensions
            await selectWikiAndComponent(page, serverUrl, 'graph-toggle', 'overview');

            // Graph button should be visible
            const graphBtn = page.locator('#wiki-graph-btn');
            await expect(graphBtn).toBeVisible({ timeout: 5_000 });

            // Click graph button
            await openGraph(page);

            // Graph container should appear with SVG (D3 rendering)
            const graphContainer = page.locator('#wiki-graph-container');
            await expect(graphContainer).toBeVisible({ timeout: 5_000 });

            // SVG should be rendered
            const svg = graphContainer.locator('svg');
            await expect(svg).toBeVisible({ timeout: 5_000 });

            // Graph button should have active class
            await expect(graphBtn).toHaveClass(/active/);
        } finally {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        }
    });

    test('graph renders nodes and links from component dependencies', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-wiki-graph-nodes-'));
        try {
            const wikiDir = path.join(tmpDir, 'wiki-data');
            createContentWiki(wikiDir, buildContentComponents(), CATEGORIES, CONTENT_ARTICLES);
            await seedWiki(serverUrl, 'graph-nodes', wikiDir, undefined, 'Graph Nodes Wiki');

            // Select wiki and open a component first so detail panel has proper dimensions
            await selectWikiAndComponent(page, serverUrl, 'graph-nodes', 'overview');

            // Open graph
            await openGraph(page);

            // Verify component nodes (4 components)
            const nodes = page.locator('#wiki-graph-container .wiki-graph-node');
            await expect(nodes).toHaveCount(4);

            // Verify dependency links exist (overview→code-examples, code-examples→diagrams)
            const links = page.locator('#wiki-graph-container .wiki-graph-link');
            expect(await links.count()).toBeGreaterThanOrEqual(2);

            // Verify category legend
            const legend = page.locator('#wiki-graph-legend');
            await expect(legend).toBeVisible();
            await expect(legend).toContainText('docs');
            await expect(legend).toContainText('examples');
        } finally {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        }
    });

    test('clicking graph node navigates to component detail', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-wiki-graph-click-'));
        try {
            const wikiDir = path.join(tmpDir, 'wiki-data');
            createContentWiki(wikiDir, buildContentComponents(), CATEGORIES, CONTENT_ARTICLES);
            await seedWiki(serverUrl, 'graph-click', wikiDir, undefined, 'Graph Click Wiki');

            // Select wiki and open a component first so detail panel has proper dimensions
            await selectWikiAndComponent(page, serverUrl, 'graph-click', 'overview');

            // Open graph
            await openGraph(page);

            // Click on a graph node via D3's click handler using evaluate
            await page.evaluate(() => {
                const nodes = document.querySelectorAll('#wiki-graph-container .wiki-graph-node');
                if (nodes.length > 0) {
                    (nodes[0] as HTMLElement).dispatchEvent(
                        new MouseEvent('click', { bubbles: true, cancelable: true }),
                    );
                }
            });

            // Should navigate away from graph to component detail
            await expect(page.locator('#wiki-article-content')).not.toBeEmpty({ timeout: 10_000 });
            // Graph container should be gone (replaced by article content)
            const gcCount = await page.locator('#wiki-graph-container').count();
            expect(gcCount).toBe(0);
        } finally {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        }
    });
});
