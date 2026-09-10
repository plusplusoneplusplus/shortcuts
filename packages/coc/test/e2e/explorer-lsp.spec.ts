/**
 * Language support in the Explorer, with every layer real: a browser running
 * the production SPA bundle, the Monaco that ships in it, the CoC server, and a
 * `typescript-language-server` child process reading a project off disk.
 *
 * Every other suite in this feature stops short of one of those. The jsdom
 * tests drive the real store and the real providers against a fake socket; the
 * server integration suite drives a real language server with no browser at
 * all. Only here do a keystroke, a hover and an F12 travel the whole way and
 * back, which is why the pieces this file asserts on are the ones no unit test
 * can reach: Monaco's own hover widget, its squiggles, and its go-to-definition
 * command landing a file in the Explorer's tab strip.
 *
 * Uses existing testids only:
 *   explorer-panel, tree-node-{path}, explorer-tab-list, explorer-tab-panel-{id},
 *   preview-pane, monaco-container, language-status, language-status-label,
 *   language-restart-btn
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { test, expect, safeRmSync } from './fixtures/server-fixture';
import { seedWorkspace } from './fixtures/seed';
import { enableExplorerEditorTabs, expectEditorTabs } from './fixtures/explorer-tabs-seed';
import { createTypeScriptRepoFixture, enableLanguageServers } from './fixtures/language-server-seed';
import type { Locator, Page } from '@playwright/test';

const WORKSPACE_ID = 'ws-lsp';
const APP_TAB = 'file:src/app.ts';
const FORMAT_TAB = 'file:src/format.ts';
const APP_PANEL = `[data-testid="explorer-tab-panel-${APP_TAB}"]`;

/**
 * Starting a Node process, handshaking with it and letting it read a project is
 * seconds of work before the first assertion can pass, and the shared 30 s
 * budget does not cover that plus a page load on a loaded machine.
 */
test.describe.configure({ timeout: 120_000 });

/**
 * A temp directory whose real path is the one the language server will answer
 * with. On macOS `os.tmpdir()` is `/var/folders/...`, a symlink into
 * `/private/var`; the server resolves it, and a workspace root that still said
 * `/var` would leave every result pointing outside the workspace.
 */
function makeTmpDir(): string {
    return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-lsp-')));
}

/** Navigate to the repo detail and click the Explorer sub-tab. */
async function gotoExplorer(page: Page, serverUrl: string): Promise<void> {
    await page.goto(serverUrl);
    await expect(page.locator('[data-testid="repo-tab"]')).toHaveCount(1, { timeout: 10_000 });
    await page.locator('[data-testid="repo-tab"]').first().click();
    await expect(page.locator('#repo-detail-content')).toBeVisible({ timeout: 8_000 });
    await page.locator('button[data-subtab="explorer"]').click();
    await expect(page.locator('[data-testid="explorer-panel"]')).toBeVisible({ timeout: 8_000 });
}

/** Expand `src` and open a file from it in its own (pinned) editor tab. */
async function openSourceFile(page: Page, name: string): Promise<void> {
    await expect(page.locator('[data-testid="tree-node-src"]')).toBeVisible({ timeout: 8_000 });
    await page.locator('[data-testid="tree-node-src"]').click();
    await expect(page.locator(`[data-testid="tree-node-src/${name}"]`)).toBeVisible({ timeout: 5_000 });
    await page.locator(`[data-testid="tree-node-src/${name}"]`).dblclick();
    await expect(page.locator('[data-testid="preview-pane"]').first()).toBeVisible({ timeout: 8_000 });
}

/** The status badge inside one editor tab's pane. */
function statusBadge(page: Page, panel = APP_PANEL): Locator {
    return page.locator(`${panel} [data-testid="language-status"]`);
}

/**
 * Wait until the server behind this document is up and answering.
 *
 * The badge is the only surface that reports it, and it is the same signal a
 * user waits for, so the tests below queue behind it rather than behind a
 * fixed delay.
 */
async function waitForLanguageServer(page: Page, panel = APP_PANEL): Promise<void> {
    await expect(statusBadge(page, panel)).toHaveAttribute('data-tone', 'ready', { timeout: 90_000 });
}

/**
 * Where one word sits on screen, in the line that carries `lineText`.
 *
 * A CSS selector cannot address a word: Monaco merges neighbouring tokens that
 * share a colour into one span, so `formatWidget` is rendered inside a run like
 * `label = formatWidget(` and aiming at that span's centre would miss it. A DOM
 * range over the text node gives the word's own rectangle, which is what a user
 * points at. Rendered spaces are non-breaking, hence the normalization.
 */
async function wordCenter(
    page: Page,
    lineText: string,
    word: string,
    panel = APP_PANEL,
): Promise<{ x: number; y: number } | null> {
    return page.evaluate(
        ({ selector, lineText: line, word: needle }) => {
            const plain = (value: string | null): string => (value ?? '').replace(/\u00a0/g, ' ');
            const root = document.querySelector(selector);
            if (!root) {
                return null;
            }
            const target = Array.from(root.querySelectorAll('.view-line')).find(node =>
                plain(node.textContent).includes(line),
            );
            if (!target) {
                return null;
            }
            const walker = document.createTreeWalker(target, NodeFilter.SHOW_TEXT);
            for (let node = walker.nextNode(); node; node = walker.nextNode()) {
                const index = plain(node.textContent).indexOf(needle);
                if (index < 0) {
                    continue;
                }
                const range = document.createRange();
                range.setStart(node, index);
                range.setEnd(node, index + needle.length);
                const rect = range.getBoundingClientRect();
                if (rect.width === 0) {
                    return null;
                }
                return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
            }
            return null;
        },
        { selector: `${panel} [data-testid="monaco-container"]`, lineText, word },
    );
}

/** Wait until a word is on screen, then return where to point at it. */
async function findWord(
    page: Page,
    lineText: string,
    word: string,
    panel = APP_PANEL,
): Promise<{ x: number; y: number }> {
    let spot: { x: number; y: number } | null = null;
    await expect
        .poll(async () => {
            spot = await wordCenter(page, lineText, word, panel);
            return spot !== null;
        }, { timeout: 15_000 })
        .toBe(true);
    return spot!;
}

/**
 * What Monaco's hover widget says about one word, or an empty string when it
 * says nothing.
 *
 * The pointer leaves the word before arriving at it, because a hover is shown
 * on the move onto a word: asking a second time means arriving a second time.
 * That makes this safe to poll, which is what a caller wants while a freshly
 * restarted server is still catching up.
 */
async function hoverTextFor(
    page: Page,
    lineText: string,
    word: string,
    panel = APP_PANEL,
): Promise<string> {
    const spot = await wordCenter(page, lineText, word, panel);
    if (!spot) {
        return '';
    }
    await page.mouse.move(4, 4);
    await page.mouse.move(spot.x, spot.y);
    const widget = page.locator('.monaco-hover').first();
    try {
        await widget.waitFor({ state: 'visible', timeout: 5_000 });
    } catch {
        return '';
    }
    return (await widget.textContent()) ?? '';
}

/**
 * Wait until the server has read the project, not merely started.
 *
 * `ready` means the process handshook. tsserver builds its program after that,
 * and until it has, it answers about the one file it was sent: the definition
 * of an imported name is the import line, and a cross-file type is unknown. A
 * test that asks in that window gets a truthful answer to the wrong question.
 *
 * `label` is annotated nowhere. Its type is the return type of a function
 * declared in src/format.ts, so `const label: string` is the first moment the
 * whole project is in play.
 */
async function waitForProjectLoaded(page: Page): Promise<void> {
    await expect
        .poll(() => hoverTextFor(page, 'export const label', 'label'), { timeout: 60_000 })
        .toContain('const label: string');
}

/**
 * The lines that currently carry an error squiggle, by their text.
 *
 * Monaco draws a squiggle as an absolutely positioned overlay, so it is matched
 * back to its line by vertical position — by its middle, because its top sits
 * exactly on the boundary the previous line's bottom also occupies. Counting
 * squiggles alone would not say whether the error is the one the test caused.
 */
async function squigglyLines(page: Page, panel = APP_PANEL): Promise<string[]> {
    return page.evaluate((selector: string) => {
        const root = document.querySelector(selector);
        if (!root) {
            return [];
        }
        const lines = Array.from(root.querySelectorAll('.view-line')) as HTMLElement[];
        return Array.from(root.querySelectorAll('.squiggly-error')).map(node => {
            const box = (node as HTMLElement).getBoundingClientRect();
            const middle = box.top + box.height / 2;
            const line = lines.find(candidate => {
                const lineBox = candidate.getBoundingClientRect();
                return middle >= lineBox.top && middle < lineBox.bottom;
            });
            return (line?.textContent ?? '').replace(/\u00a0/g, ' ');
        });
    }, `${panel} [data-testid="monaco-container"]`);
}

/**
 * The text of the line the caret currently sits on, or null while there is no
 * visible caret yet.
 *
 * Monaco keeps no line number in the DOM, so the caret is matched to its line
 * by vertical position — the same way the eye does it. That is the only way to
 * tell "the file opened" from "the file opened at the symbol".
 */
async function caretLineText(page: Page, panel: string): Promise<string | null> {
    return page.evaluate((selector: string) => {
        const root = document.querySelector(selector);
        const cursor = root?.querySelector('.cursors-layer .cursor') as HTMLElement | null;
        if (!cursor) {
            return null;
        }
        const { top, height } = cursor.getBoundingClientRect();
        if (height === 0) {
            return null;
        }
        const lines = Array.from(root!.querySelectorAll('.view-line')) as HTMLElement[];
        const line = lines.find(node => Math.abs(node.getBoundingClientRect().top - top) < 2);
        return line ? (line.textContent ?? '').replace(/\u00a0/g, ' ') : null;
    }, `${panel} [data-testid="monaco-container"]`);
}

/**
 * Put the caret in a Monaco buffer and wait until it really has the keystrokes.
 *
 * Monaco attaches its hidden input a beat after the view paints, so under load a
 * `keyboard.type` issued right after the click can land on nothing at all.
 */
async function focusMonacoBuffer(page: Page, panel = APP_PANEL): Promise<void> {
    const editor = page.locator(`${panel} [data-testid="monaco-container"] .monaco-editor`);
    await expect(editor).toBeVisible({ timeout: 15_000 });
    await editor.locator('.view-lines').click();
    await expect
        .poll(
            () =>
                page.evaluate(
                    (selector: string) =>
                        !!document.activeElement &&
                        !!document.querySelector(selector)?.contains(document.activeElement),
                    `${panel} [data-testid="monaco-container"]`,
                ),
            { timeout: 10_000 },
        )
        .toBe(true);
}

// ---------------------------------------------------------------------------
// 1. Status
// ---------------------------------------------------------------------------

test.describe('Explorer language support – status', () => {
    test('LSP.1 a workspace with language support off says so and starts nothing', async ({ page, serverUrl }) => {
        const tmpDir = makeTmpDir();
        try {
            const repoDir = createTypeScriptRepoFixture(tmpDir);
            await seedWorkspace(serverUrl, WORKSPACE_ID, 'lsp-repo', repoDir);
            await enableExplorerEditorTabs(serverUrl);

            await gotoExplorer(page, serverUrl);
            await openSourceFile(page, 'app.ts');

            // The config ships disabled, so the host refuses the document and
            // the badge names the reason rather than a failure.
            await expect(statusBadge(page)).toHaveAttribute('data-tone', 'warning', { timeout: 20_000 });
            await expect(page.locator(`${APP_PANEL} [data-testid="language-status-label"]`))
                .toHaveText('Language support off');
        } finally {
            safeRmSync(tmpDir);
        }
    });

    test('LSP.2 enabling the TypeScript preset brings a real server up for the open file', async ({ page, serverUrl }) => {
        const tmpDir = makeTmpDir();
        try {
            const repoDir = createTypeScriptRepoFixture(tmpDir);
            await seedWorkspace(serverUrl, WORKSPACE_ID, 'lsp-repo', repoDir);
            await enableExplorerEditorTabs(serverUrl);
            await enableLanguageServers(serverUrl, WORKSPACE_ID);

            await gotoExplorer(page, serverUrl);
            await openSourceFile(page, 'app.ts');

            await waitForLanguageServer(page);
            await expect(page.locator(`${APP_PANEL} [data-testid="language-status-label"]`))
                .toHaveText('TypeScript');
        } finally {
            safeRmSync(tmpDir);
        }
    });
});

// ---------------------------------------------------------------------------
// 2. Language features over the real editor
// ---------------------------------------------------------------------------

test.describe('Explorer language support – TypeScript features', () => {
    test('LSP.3 hovering shows a type only the other file could explain', async ({ page, serverUrl }) => {
        const tmpDir = makeTmpDir();
        try {
            const repoDir = createTypeScriptRepoFixture(tmpDir);
            await seedWorkspace(serverUrl, WORKSPACE_ID, 'lsp-repo', repoDir);
            await enableExplorerEditorTabs(serverUrl);
            await enableLanguageServers(serverUrl, WORKSPACE_ID);

            await gotoExplorer(page, serverUrl);
            await openSourceFile(page, 'app.ts');
            await waitForLanguageServer(page);

            // Monaco's own TypeScript worker, had it still been answering for
            // this model, sees one file with an unresolvable import and would
            // say `any`. The type below can only have come from the server.
            await waitForProjectLoaded(page);
        } finally {
            safeRmSync(tmpDir);
        }
    });

    test('LSP.4 go to definition opens the other file in this surface at the symbol', async ({ page, serverUrl }) => {
        const tmpDir = makeTmpDir();
        try {
            const repoDir = createTypeScriptRepoFixture(tmpDir);
            await seedWorkspace(serverUrl, WORKSPACE_ID, 'lsp-repo', repoDir);
            await enableExplorerEditorTabs(serverUrl);
            await enableLanguageServers(serverUrl, WORKSPACE_ID);

            await gotoExplorer(page, serverUrl);
            await openSourceFile(page, 'app.ts');
            await waitForLanguageServer(page);
            await waitForProjectLoaded(page);

            await expectEditorTabs(page, [APP_TAB]);

            // Click the call, then Monaco's own go-to-definition keybinding —
            // the target is in another file, so it can only land through the
            // editor opener the Explorer installs.
            const spot = await findWord(page, 'export const label', 'formatWidget');
            await page.mouse.click(spot.x, spot.y);
            // The keystroke asks about wherever the caret is, and the caret
            // starts on line 1, so pressing before the click has landed asks
            // about the import instead.
            await expect
                .poll(() => caretLineText(page, APP_PANEL), { timeout: 10_000 })
                .toContain('export const label');
            await page.keyboard.press('F12');

            await expectEditorTabs(page, [APP_TAB, FORMAT_TAB]);
            const formatPanel = `[data-testid="explorer-tab-panel-${FORMAT_TAB}"]`;
            await expect(page.locator(`${formatPanel} [data-testid="monaco-container"]`)).toBeVisible({ timeout: 10_000 });

            // The reveal has to land on the declaration itself, not merely open
            // the file: the position rides all the way from the server's range
            // through the tab model into Monaco.
            await expect
                .poll(() => caretLineText(page, formatPanel), { timeout: 15_000 })
                .toContain('export function formatWidget');
        } finally {
            safeRmSync(tmpDir);
        }
    });

    test('LSP.5 an unsaved edit produces a diagnostic on that line and clears with it', async ({ page, serverUrl }) => {
        const tmpDir = makeTmpDir();
        try {
            const repoDir = createTypeScriptRepoFixture(tmpDir);
            await seedWorkspace(serverUrl, WORKSPACE_ID, 'lsp-repo', repoDir);
            await enableExplorerEditorTabs(serverUrl);
            await enableLanguageServers(serverUrl, WORKSPACE_ID);

            await gotoExplorer(page, serverUrl);
            await openSourceFile(page, 'app.ts');
            await waitForLanguageServer(page);
            await waitForProjectLoaded(page);
            await expect.poll(() => squigglyLines(page), { timeout: 10_000 }).toEqual([]);

            // The fixture ends on an empty line, so the error can be typed
            // without touching a bracket or a quote Monaco would auto-close.
            const broken = 'export const broken: number = label;';
            await focusMonacoBuffer(page);
            await page.keyboard.press('Control+End');
            await page.keyboard.type(broken);

            // `label` is a string, and the server only knows that from the
            // buffer it was sent — nothing has been written to disk.
            await expect.poll(() => squigglyLines(page), { timeout: 30_000 }).toContain(broken);

            // Select the typed line back to its start and delete it. Undo would
            // be a guess: Monaco decides for itself how many undo stops a run of
            // typing earned.
            await page.keyboard.press('Escape');
            await page.keyboard.press('Shift+Home');
            await page.keyboard.press('Delete');
            await expect.poll(() => squigglyLines(page), { timeout: 30_000 }).toEqual([]);
        } finally {
            safeRmSync(tmpDir);
        }
    });
});

// ---------------------------------------------------------------------------
// 3. Recovery
// ---------------------------------------------------------------------------

test.describe('Explorer language support – recovery', () => {
    test('LSP.6 a restarted server is handed the unsaved buffer, not the file on disk', async ({ page, serverUrl }) => {
        const tmpDir = makeTmpDir();
        try {
            const repoDir = createTypeScriptRepoFixture(tmpDir);
            await seedWorkspace(serverUrl, WORKSPACE_ID, 'lsp-repo', repoDir);
            await enableExplorerEditorTabs(serverUrl);
            await enableLanguageServers(serverUrl, WORKSPACE_ID);

            await gotoExplorer(page, serverUrl);
            await openSourceFile(page, 'app.ts');
            await waitForLanguageServer(page);
            await waitForProjectLoaded(page);

            // Declare something that exists only in the buffer. Nothing is
            // saved, so `extra` is in no file on disk.
            await focusMonacoBuffer(page);
            await page.keyboard.press('Control+End');
            await page.keyboard.type('export const extra = label;');
            await expect(page.locator(`${APP_PANEL} [data-testid="dirty-indicator"]`)).toBeVisible({ timeout: 10_000 });

            await page.locator(`${APP_PANEL} [data-testid="language-restart-btn"]`).click();
            await waitForLanguageServer(page);

            // The edit is still in the editor, and the process that answers now
            // is not the one that was told about it — the only way it can type
            // `extra` is if the whole buffer was replayed into it.
            await expect(page.locator(`${APP_PANEL} [data-testid="dirty-indicator"]`)).toBeVisible();
            // The longest wait in the suite: a second Node process has to
            // start, handshake and read the project again.
            await expect
                .poll(() => hoverTextFor(page, 'export const extra', 'extra'), { timeout: 90_000 })
                .toContain('const extra: string');
        } finally {
            safeRmSync(tmpDir);
        }
    });
});
