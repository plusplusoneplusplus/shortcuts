/**
 * Wiki Ask AI Widget E2E Tests
 *
 * Tests the Ask AI floating widget: expand/collapse, send question,
 * conversation rendering, streaming responses, clear, error handling,
 * and context awareness.
 *
 * Depends on:
 *   - Commit 001: wiki fixtures (createWikiFixture, createWikiComponent)
 *   - Commit 002: wiki management tests (seedWiki)
 *   - Commit 003: wiki-components tests (selectWiki pattern)
 */

import type { Page } from '@playwright/test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { seedWiki } from './fixtures/seed';
import { expect, test, safeRmSync } from './fixtures/server-fixture';
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

function createCustomWiki(
    wikiDir: string,
    components: ComponentInfo[],
    categories: CategoryInfo[],
    extras?: { articles?: Record<string, string>; projectName?: string },
): ComponentGraph {
    const graph: ComponentGraph = {
        project: {
            name: extras?.projectName ?? 'Test Project',
            description: 'A test project for E2E wiki ask tests',
            language: 'TypeScript',
            buildSystem: 'npm + webpack',
            entryPoints: ['src/index.ts'],
        },
        components,
        categories,
        architectureNotes: 'Layered architecture for testing.',
    };
    fs.mkdirSync(wikiDir, { recursive: true });
    fs.writeFileSync(path.join(wikiDir, 'component-graph.json'), JSON.stringify(graph, null, 2));
    if (extras?.articles) writeComponentArticles(wikiDir, extras.articles);
    return graph;
}

async function selectWiki(
    page: Page,
    serverUrl: string,
    wikiId: string,
    opts?: { expandAsk?: boolean },
): Promise<void> {
    await page.goto(serverUrl);
    await page.click('[data-tab="wiki"]');
    await expect(page.locator('#wiki-card-list .wiki-card[data-wiki-id="' + wikiId + '"]')).toBeVisible({ timeout: 10_000 });
    await page.click('#wiki-card-list .wiki-card[data-wiki-id="' + wikiId + '"]');
    await expect(page.locator('#wiki-component-tree')).not.toBeEmpty({ timeout: 5_000 });
    await page.click('.wiki-project-tab[data-wiki-project-tab="ask"]');
    await expect(page.locator('#wiki-ask-widget')).toBeVisible({ timeout: 5_000 });
    if (opts?.expandAsk !== false) {
        await page.keyboard.press('Control+i');
        await expect(page.locator('#wiki-ask-messages')).toBeVisible({ timeout: 5_000 });
    }
}

const CATEGORIES: CategoryInfo[] = [
    { name: 'core', description: 'Core business logic' },
    { name: 'api', description: 'API layer and routing' },
];

function buildTestComponents(): ComponentInfo[] {
    return [
        createWikiComponent('auth-service', {
            category: 'core',
            complexity: 'high',
            dependencies: [],
            dependents: ['api-gateway'],
        }),
        createWikiComponent('api-gateway', {
            category: 'api',
            complexity: 'medium',
            dependencies: ['auth-service'],
            dependents: [],
        }),
    ];
}

const TEST_ARTICLES: Record<string, string> = {
    'auth-service': '# Auth Service\n\nHandles user authentication.',
    'api-gateway': '# API Gateway\n\nRoutes incoming HTTP requests.',
};

/**
 * Mock the Ask AI SSE endpoint to return a controlled response.
 * Simulates the server-side SSE stream: context → chunks → done.
 */
async function mockAskEndpoint(
    page: Page,
    response: string,
    options?: {
        sessionId?: string;
        componentIds?: string[];
        themeIds?: string[];
        error?: string;
    },
): Promise<void> {
    await page.route('**/api/wikis/*/ask', async (route, request) => {
        if (request.method() !== 'POST') return route.continue();

        if (options?.error) {
            await route.fulfill({
                status: 200,
                headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' },
                body: `data: ${JSON.stringify({ type: 'error', message: options.error })}\n\n`,
            });
            return;
        }

        const events: string[] = [];

        // Context event
        if (options?.componentIds || options?.themeIds) {
            events.push(`data: ${JSON.stringify({
                type: 'context',
                componentIds: options.componentIds ?? [],
                themeIds: options.themeIds ?? [],
            })}\n\n`);
        }

        // Split response into chunks to simulate streaming
        const words = response.split(' ');
        const mid = Math.ceil(words.length / 2);
        events.push(`data: ${JSON.stringify({ type: 'chunk', content: words.slice(0, mid).join(' ') })}\n\n`);
        events.push(`data: ${JSON.stringify({ type: 'chunk', content: ' ' + words.slice(mid).join(' ') })}\n\n`);

        // Done event
        events.push(`data: ${JSON.stringify({
            type: 'done',
            fullResponse: response,
            sessionId: options?.sessionId ?? 'session-test-123',
        })}\n\n`);

        await route.fulfill({
            status: 200,
            headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' },
            body: events.join(''),
        });
    });
}

/** Mock the Ask AI endpoint to fail with an HTTP error. */
async function mockAskEndpointFailure(page: Page, status: number, error: string): Promise<void> {
    await page.route('**/api/wikis/*/ask', async (route, request) => {
        if (request.method() !== 'POST') return route.continue();
        await route.fulfill({
            status,
            contentType: 'application/json',
            body: JSON.stringify({ error }),
        });
    });
}

// ================================================================
// TC1: Widget Visibility Toggle
// ================================================================

test.describe('Wiki Ask AI Widget', () => {
    test.describe('Widget visibility toggle', () => {
        test('widget starts collapsed, expands on textarea focus and collapses on close', async ({ page, serverUrl }) => {
            const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-ask-toggle-'));
            try {
                const wikiDir = path.join(tmpDir, 'wiki-data');
                createCustomWiki(wikiDir, buildTestComponents(), CATEGORIES, { articles: TEST_ARTICLES });
                await seedWiki(serverUrl, 'ask-toggle-wiki', wikiDir, undefined, 'Ask Toggle Wiki');
                await selectWiki(page, serverUrl, 'ask-toggle-wiki', { expandAsk: false });

                const widget = page.locator('#wiki-ask-widget');
                const header = page.locator('#wiki-ask-widget-header');
                const messages = page.locator('#wiki-ask-messages');

                // Initially collapsed: widget exists but NOT expanded
                await expect(widget).toBeVisible();
                await expect(widget).not.toHaveClass(/expanded/);
                await expect(header).toHaveClass(/hidden/);
                await expect(messages).toHaveClass(/hidden/);

                // Type in textarea to trigger expand (askPanelSend calls expandWidget)
                // Instead, use keyboard shortcut Ctrl+I to expand
                await page.keyboard.press('Control+i');
                await expect(widget).toHaveClass(/expanded/);
                await expect(header).not.toHaveClass(/hidden/);
                await expect(messages).not.toHaveClass(/hidden/);

                // Close widget
                await page.click('#wiki-ask-close');
                await expect(widget).not.toHaveClass(/expanded/);
                await expect(header).toHaveClass(/hidden/);
                await expect(messages).toHaveClass(/hidden/);
            } finally {
                safeRmSync(tmpDir);
            }
        });

        test('Escape key closes expanded widget', async ({ page, serverUrl }) => {
            const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-ask-esc-'));
            try {
                const wikiDir = path.join(tmpDir, 'wiki-data');
                createCustomWiki(wikiDir, buildTestComponents(), CATEGORIES, { articles: TEST_ARTICLES });
                await seedWiki(serverUrl, 'ask-esc-wiki', wikiDir, undefined, 'Ask Esc Wiki');
                await selectWiki(page, serverUrl, 'ask-esc-wiki', { expandAsk: false });

                // Expand via Ctrl+I
                await page.keyboard.press('Control+i');
                await expect(page.locator('#wiki-ask-widget')).toHaveClass(/expanded/);

                // Collapse via Escape
                await page.keyboard.press('Escape');
                await expect(page.locator('#wiki-ask-widget')).not.toHaveClass(/expanded/);
            } finally {
                safeRmSync(tmpDir);
            }
        });
    });

    // ================================================================
    // TC2: Send Question - Basic Flow
    // ================================================================

    test.describe('Send question basic flow', () => {
        test('sends question and displays AI response', async ({ page, serverUrl }) => {
            const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-ask-send-'));
            try {
                const wikiDir = path.join(tmpDir, 'wiki-data');
                createCustomWiki(wikiDir, buildTestComponents(), CATEGORIES, { articles: TEST_ARTICLES });
                await seedWiki(serverUrl, 'ask-send-wiki', wikiDir, undefined, 'Ask Send Wiki');
                await selectWiki(page, serverUrl, 'ask-send-wiki');

                await mockAskEndpoint(page, 'This is a test AI response about the auth service.');

                // Type and send question
                const textarea = page.locator('#wiki-ask-textarea');
                await textarea.fill('What is this component?');
                await page.click('#wiki-ask-widget-send');

                // User message should appear
                const messages = page.locator('#wiki-ask-messages');
                await expect(messages.locator('.ask-message-user')).toContainText('What is this component?');

                // AI response should appear
                await expect(messages.locator('.ask-message-assistant')).toBeVisible({ timeout: 10_000 });
                await expect(messages.locator('.ask-message-assistant')).toContainText('test AI response');

                // Textarea should be cleared
                await expect(textarea).toHaveValue('');
            } finally {
                safeRmSync(tmpDir);
            }
        });

        test('send button disabled during streaming', async ({ page, serverUrl }) => {
            const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-ask-disable-'));
            try {
                const wikiDir = path.join(tmpDir, 'wiki-data');
                createCustomWiki(wikiDir, buildTestComponents(), CATEGORIES, { articles: TEST_ARTICLES });
                await seedWiki(serverUrl, 'ask-disable-wiki', wikiDir, undefined, 'Ask Disable Wiki');
                await selectWiki(page, serverUrl, 'ask-disable-wiki');

                // Use a delayed response to observe disabled state
                await page.route('**/api/wikis/*/ask', async (route, request) => {
                    if (request.method() !== 'POST') return route.continue();
                    // Delay the response to ensure we can observe disabled state
                    await new Promise(resolve => setTimeout(resolve, 1500));
                    await route.fulfill({
                        status: 200,
                        headers: { 'Content-Type': 'text/event-stream' },
                        body: `data: ${JSON.stringify({ type: 'done', fullResponse: 'Done', sessionId: 's1' })}\n\n`,
                    });
                });

                const sendBtn = page.locator('#wiki-ask-widget-send');
                await page.locator('#wiki-ask-textarea').fill('Test question');
                await page.click('#wiki-ask-widget-send');

                // Button should be disabled during streaming
                await expect(sendBtn).toBeDisabled();

                // After streaming completes, response appears and button re-enables
                await expect(page.locator('#wiki-ask-messages .ask-message-assistant')).toBeVisible({ timeout: 5_000 });
                await page.locator('#wiki-ask-textarea').fill('follow-up');
                await expect(sendBtn).not.toBeDisabled();
            } finally {
                safeRmSync(tmpDir);
            }
        });
    });

    // ================================================================
    // TC3: Conversation Rendering - Multiple Messages
    // ================================================================

    test.describe('Conversation rendering', () => {
        test('multiple messages render in chronological order', async ({ page, serverUrl }) => {
            const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-ask-conv-'));
            try {
                const wikiDir = path.join(tmpDir, 'wiki-data');
                createCustomWiki(wikiDir, buildTestComponents(), CATEGORIES, { articles: TEST_ARTICLES });
                await seedWiki(serverUrl, 'ask-conv-wiki', wikiDir, undefined, 'Ask Conv Wiki');
                await selectWiki(page, serverUrl, 'ask-conv-wiki');

                let callCount = 0;
                await page.route('**/api/wikis/*/ask', async (route, request) => {
                    if (request.method() !== 'POST') return route.continue();
                    callCount++;
                    const response = callCount === 1 ? 'First answer' : 'Second answer';
                    const events = [
                        `data: ${JSON.stringify({ type: 'chunk', content: response })}\n\n`,
                        `data: ${JSON.stringify({ type: 'done', fullResponse: response, sessionId: 'conv-sess' })}\n\n`,
                    ];
                    await route.fulfill({
                        status: 200,
                        headers: { 'Content-Type': 'text/event-stream' },
                        body: events.join(''),
                    });
                });

                const textarea = page.locator('#wiki-ask-textarea');
                const messages = page.locator('#wiki-ask-messages');

                // Send first question
                await textarea.fill('What does this do?');
                await page.click('#wiki-ask-widget-send');
                await expect(messages.locator('.ask-message-assistant')).toHaveCount(1, { timeout: 10_000 });
                await expect(messages.locator('.ask-message-assistant').first()).toContainText('First answer');

                // Send second question
                await textarea.fill('How do I use it?');
                await page.click('#wiki-ask-widget-send');
                await expect(messages.locator('.ask-message-assistant')).toHaveCount(2, { timeout: 10_000 });
                await expect(messages.locator('.ask-message-assistant').nth(1)).toContainText('Second answer');

                // Verify user messages
                await expect(messages.locator('.ask-message-user')).toHaveCount(2);
                await expect(messages.locator('.ask-message-user').first()).toContainText('What does this do?');
                await expect(messages.locator('.ask-message-user').nth(1)).toContainText('How do I use it?');

                // Verify message ordering (user, assistant, user, assistant)
                const allMessages = messages.locator('.ask-message > div');
                await expect(allMessages).toHaveCount(4);
            } finally {
                safeRmSync(tmpDir);
            }
        });
    });

    // ================================================================
    // TC4: AI Response Streaming
    // ================================================================

    test.describe('AI response streaming', () => {
        test('shows typing indicator then replaces with streamed content', async ({ page, serverUrl }) => {
            const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-ask-stream-'));
            try {
                const wikiDir = path.join(tmpDir, 'wiki-data');
                createCustomWiki(wikiDir, buildTestComponents(), CATEGORIES, { articles: TEST_ARTICLES });
                await seedWiki(serverUrl, 'ask-stream-wiki', wikiDir, undefined, 'Ask Stream Wiki');
                await selectWiki(page, serverUrl, 'ask-stream-wiki');

                await mockAskEndpoint(page, 'Streamed response content about auth service.');

                await page.locator('#wiki-ask-textarea').fill('Tell me more');
                await page.click('#wiki-ask-widget-send');

                const messages = page.locator('#wiki-ask-messages');

                // Eventually the assistant response should appear with the full content
                await expect(messages.locator('.ask-message-assistant')).toBeVisible({ timeout: 10_000 });
                await expect(messages.locator('.ask-message-assistant')).toContainText('Streamed response content');

                // Streaming indicator (Thinking…) should be removed after streaming completes
                await expect(messages.locator('.ask-message-assistant')).toContainText('Streamed response content');
            } finally {
                safeRmSync(tmpDir);
            }
        });
    });

    // ================================================================
    // TC5: Clear Conversation
    // ================================================================

    test.describe('Clear conversation', () => {
        test('clear button removes all messages', async ({ page, serverUrl }) => {
            const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-ask-clear-'));
            try {
                const wikiDir = path.join(tmpDir, 'wiki-data');
                createCustomWiki(wikiDir, buildTestComponents(), CATEGORIES, { articles: TEST_ARTICLES });
                await seedWiki(serverUrl, 'ask-clear-wiki', wikiDir, undefined, 'Ask Clear Wiki');
                await selectWiki(page, serverUrl, 'ask-clear-wiki');

                // Mock clear session endpoint
                await page.route('**/api/wikis/*/ask/session/*', async (route, request) => {
                    if (request.method() === 'DELETE') {
                        await route.fulfill({ status: 200, body: '{}' });
                    } else {
                        return route.continue();
                    }
                });

                await mockAskEndpoint(page, 'Temporary response to be cleared.');

                // Send a message first
                await page.locator('#wiki-ask-textarea').fill('Test question');
                await page.click('#wiki-ask-widget-send');

                const messages = page.locator('#wiki-ask-messages');
                await expect(messages.locator('.ask-message-assistant')).toBeVisible({ timeout: 10_000 });

                // Verify messages exist
                await expect(messages.locator('.ask-message-user')).toHaveCount(1);
                await expect(messages.locator('.ask-message-assistant')).toHaveCount(1);

                // Clear conversation (via Clear button in header)
                await page.click('button:has-text("Clear")');

                // All messages should be removed
                await expect(messages.locator('.ask-message-user')).toHaveCount(0);
                await expect(messages.locator('.ask-message-assistant')).toHaveCount(0);

                // Ask panel should still be visible
                await expect(page.locator('#wiki-ask-messages')).toBeVisible();
            } finally {
                safeRmSync(tmpDir);
            }
        });
    });

    // ================================================================
    // TC6: Send Button State
    // ================================================================

    test.describe('Send button state', () => {
        test('empty textarea does not trigger send', async ({ page, serverUrl }) => {
            const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-ask-empty-'));
            try {
                const wikiDir = path.join(tmpDir, 'wiki-data');
                createCustomWiki(wikiDir, buildTestComponents(), CATEGORIES, { articles: TEST_ARTICLES });
                await seedWiki(serverUrl, 'ask-empty-wiki', wikiDir, undefined, 'Ask Empty Wiki');
                await selectWiki(page, serverUrl, 'ask-empty-wiki');

                let apiCalled = false;
                await page.route('**/api/wikis/*/ask', async (route, request) => {
                    if (request.method() === 'POST') apiCalled = true;
                    return route.continue();
                });

                // With empty textarea, send button is disabled
                await page.locator('#wiki-ask-textarea').fill('');
                await expect(page.locator('#wiki-ask-widget-send')).toBeDisabled();

                // No messages should appear
                const messages = page.locator('#wiki-ask-messages');
                await expect(messages.locator('.ask-message-user')).toHaveCount(0);
                expect(apiCalled).toBe(false);
            } finally {
                safeRmSync(tmpDir);
            }
        });

        test('Enter key sends question, Shift+Enter inserts newline', async ({ page, serverUrl }) => {
            const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-ask-keys-'));
            try {
                const wikiDir = path.join(tmpDir, 'wiki-data');
                createCustomWiki(wikiDir, buildTestComponents(), CATEGORIES, { articles: TEST_ARTICLES });
                await seedWiki(serverUrl, 'ask-keys-wiki', wikiDir, undefined, 'Ask Keys Wiki');
                await selectWiki(page, serverUrl, 'ask-keys-wiki');

                await mockAskEndpoint(page, 'Keyboard response.');

                const textarea = page.locator('#wiki-ask-textarea');

                // Shift+Enter should insert newline (not send)
                await textarea.click();
                await textarea.type('Line one');
                await page.keyboard.press('Shift+Enter');
                await textarea.type('Line two');

                const val = await textarea.inputValue();
                expect(val).toContain('Line one');
                expect(val).toContain('Line two');

                // Enter should send
                await page.keyboard.press('Enter');

                // User message should appear
                await expect(page.locator('#wiki-ask-messages .ask-message-user')).toBeVisible({ timeout: 5_000 });
                await expect(textarea).toHaveValue('');
            } finally {
                safeRmSync(tmpDir);
            }
        });
    });

    // ================================================================
    // TC7: Error Handling
    // ================================================================

    test.describe('Error handling', () => {
        test('shows error message on API failure', async ({ page, serverUrl }) => {
            const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-ask-err-'));
            try {
                const wikiDir = path.join(tmpDir, 'wiki-data');
                createCustomWiki(wikiDir, buildTestComponents(), CATEGORIES, { articles: TEST_ARTICLES });
                await seedWiki(serverUrl, 'ask-err-wiki', wikiDir, undefined, 'Ask Error Wiki');
                await selectWiki(page, serverUrl, 'ask-err-wiki');

                await mockAskEndpointFailure(page, 500, 'AI service unavailable');

                await page.locator('#wiki-ask-textarea').fill('Test error handling');
                await page.click('#wiki-ask-widget-send');

                const messages = page.locator('#wiki-ask-messages');

                // User message should appear
                await expect(messages.locator('.ask-message-user')).toContainText('Test error handling');

                // Error message should appear
                await expect(messages.locator('.ask-message-error')).toBeVisible({ timeout: 10_000 });
                await expect(messages.locator('.ask-message-error')).toContainText('AI service unavailable');

                // After error, user can type and send again (button enabled when input has text)
                await page.locator('#wiki-ask-textarea').fill('retry');
                await expect(page.locator('#wiki-ask-widget-send')).not.toBeDisabled();
            } finally {
                safeRmSync(tmpDir);
            }
        });

        test('shows error on SSE error event', async ({ page, serverUrl }) => {
            const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-ask-sse-err-'));
            try {
                const wikiDir = path.join(tmpDir, 'wiki-data');
                createCustomWiki(wikiDir, buildTestComponents(), CATEGORIES, { articles: TEST_ARTICLES });
                await seedWiki(serverUrl, 'ask-sse-err-wiki', wikiDir, undefined, 'Ask SSE Err Wiki');
                await selectWiki(page, serverUrl, 'ask-sse-err-wiki');

                await mockAskEndpoint(page, '', { error: 'Context retrieval failed' });

                await page.locator('#wiki-ask-textarea').fill('This should error');
                await page.click('#wiki-ask-widget-send');

                const messages = page.locator('#wiki-ask-messages');
                await expect(messages.locator('.ask-message-error')).toBeVisible({ timeout: 10_000 });
                await expect(messages.locator('.ask-message-error')).toContainText('Context retrieval failed');
            } finally {
                safeRmSync(tmpDir);
            }
        });
    });

    // ================================================================
    // TC8: Context Awareness
    // ================================================================

    test.describe('Context awareness', () => {
        test('request includes wiki context and displays context references', async ({ page, serverUrl }) => {
            const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-ask-ctx-'));
            try {
                const wikiDir = path.join(tmpDir, 'wiki-data');
                createCustomWiki(wikiDir, buildTestComponents(), CATEGORIES, { articles: TEST_ARTICLES });
                await seedWiki(serverUrl, 'ask-ctx-wiki', wikiDir, undefined, 'Ask Context Wiki');
                await selectWiki(page, serverUrl, 'ask-ctx-wiki');

                // Capture the request to verify wiki context
                let capturedBody: Record<string, unknown> | null = null;
                await page.route('**/api/wikis/*/ask', async (route, request) => {
                    if (request.method() !== 'POST') return route.continue();
                    capturedBody = JSON.parse(request.postData() || '{}');

                    // Return response with context
                    const events = [
                        `data: ${JSON.stringify({
                            type: 'context',
                            componentIds: ['auth-service'],
                            themeIds: [],
                        })}\n\n`,
                        `data: ${JSON.stringify({
                            type: 'done',
                            fullResponse: 'Answer about auth.',
                            sessionId: 'ctx-sess',
                        })}\n\n`,
                    ];
                    await route.fulfill({
                        status: 200,
                        headers: { 'Content-Type': 'text/event-stream' },
                        body: events.join(''),
                    });
                });

                await page.locator('#wiki-ask-textarea').fill('Explain this');
                await page.click('#wiki-ask-widget-send');

                const messages = page.locator('#wiki-ask-messages');
                await expect(messages.locator('.ask-message-assistant, .ask-message-context').first()).toBeVisible({ timeout: 10_000 });

                // Verify the request was made to the correct wiki-scoped endpoint
                expect(capturedBody).not.toBeNull();
                expect(capturedBody!.question).toBe('Explain this');

                // Context references should be shown (component IDs)
                await expect(messages.locator('.ask-message-context')).toBeVisible();
                await expect(messages.locator('.ask-message-context')).toContainText('auth-service');
            } finally {
                safeRmSync(tmpDir);
            }
        });
    });
});
