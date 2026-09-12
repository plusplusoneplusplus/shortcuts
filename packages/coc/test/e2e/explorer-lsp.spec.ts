/**
 * Language support in the Explorer, with every layer real: a browser running
 * the production SPA bundle, the Monaco that ships in it, the CoC server, and a
 * `typescript-language-server` child process reading a project off disk.
 *
 * Every other suite in this feature stops short of one of those. The jsdom
 * tests drive the real store and the real providers against a fake socket; the
 * server integration suite drives a real language server with no browser at
 * all. Only here do a keystroke, a hover and a Ctrl-click travel the whole way and
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
import { request, seedWorkspace } from './fixtures/seed';
import {
    editorTab,
    enableExplorerEditorTabs,
    expectEditorTabs,
} from './fixtures/explorer-tabs-seed';
import {
    createDecoyRepoFixture,
    createRustRepoFixture,
    createTypeScriptRepoFixture,
    enableLanguageServers,
} from './fixtures/language-server-seed';
import {
    enableRemoteShell,
    registerRemoteServer,
    startSecondaryServer,
} from './fixtures/secondary-server';
import { execFileSync } from 'child_process';
import type { Locator, Page } from '@playwright/test';

const WORKSPACE_ID = 'ws-lsp';
const PANEL_WORKSPACE_ID = 'ws-lsp-panel';
const APP_TAB = 'file:src/app.ts';
const FORMAT_TAB = 'file:src/format.ts';
const APP_PANEL = `[data-testid="explorer-tab-panel-${APP_TAB}"]`;
const RUST_APP_TAB = 'file:src/app.rs';
const RUST_CORE_TAB = 'file:core-fixture/src/lib.rs';
const RUST_APP_PANEL = `[data-testid="explorer-tab-panel-${RUST_APP_TAB}"]`;

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
    fromEnd = false,
): Promise<{ x: number; y: number } | null> {
    return page.evaluate(
        ({ selector, lineText: line, word: needle, fromEnd: useLast }) => {
            const plain = (value: string | null): string => (value ?? '').replace(/\u00a0/g, ' ');
            const root = document.querySelector(selector);
            if (!root) {
                return null;
            }
            const targets = Array.from(root.querySelectorAll('.view-line')).filter(node =>
                plain(node.textContent).includes(line),
            );
            const target = useLast ? targets.at(-1) : targets[0];
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
        { selector: `${panel} [data-testid="monaco-container"]`, lineText, word, fromEnd },
    );
}

/** Wait until a word is on screen, then return where to point at it. */
async function findWord(
    page: Page,
    lineText: string,
    word: string,
    panel = APP_PANEL,
    fromEnd = false,
): Promise<{ x: number; y: number }> {
    let spot: { x: number; y: number } | null = null;
    await expect
        .poll(async () => {
            spot = await wordCenter(page, lineText, word, panel, fromEnd);
            return spot !== null;
        }, { timeout: 15_000 })
        .toBe(true);
    return spot!;
}

/** Whether Monaco's inline definition decoration currently wraps a word. */
async function wordHasDefinitionLink(
    page: Page,
    lineText: string,
    word: string,
    panel = APP_PANEL,
): Promise<boolean> {
    return page.evaluate(({ selector, line, needle }) => {
        const plain = (value: string | null): string => (value ?? '').replace(/\u00a0/g, ' ');
        const root = document.querySelector(selector);
        const target = Array.from(root?.querySelectorAll('.view-line') ?? [])
            .find(node => plain(node.textContent).includes(line));
        if (!target) return false;
        const walker = document.createTreeWalker(target, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
            if (plain(node.textContent).includes(needle)) {
                const owner = node.parentElement;
                return owner !== null && owner.closest('.goto-definition-link') !== null;
            }
        }
        return false;
    }, {
        selector: `${panel} [data-testid="monaco-container"]`,
        line: lineText,
        needle: word,
    });
}

/** Invoke Monaco's mouse-driven go-to-definition gesture on one rendered word. */
async function ctrlClickWord(
    page: Page,
    lineText: string,
    word: string,
    panel = APP_PANEL,
    fromEnd = false,
): Promise<void> {
    const spot = await findWord(page, lineText, word, panel, fromEnd);
    const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
    await page.mouse.click(spot.x, spot.y);
    await page.mouse.move(4, 4);
    await page.keyboard.down(modifier);
    try {
        await page.mouse.move(spot.x, spot.y);
        await page.mouse.click(spot.x, spot.y);
    } finally {
        await page.keyboard.up(modifier);
    }
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
async function waitForProjectLoaded(page: Page, panel = APP_PANEL): Promise<void> {
    await expect
        .poll(() => hoverTextFor(page, 'export const label', 'label', panel), { timeout: 60_000 })
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
 * The model position and text of the logical line carrying the caret, or null
 * while there is no visible caret yet.
 *
 * Monaco keeps position out of the DOM, so this matches the caret to rendered
 * lines and gutter numbers. Wrapped visual lines are joined and counted toward
 * the model column, which keeps narrow editors exact too.
 */
interface CaretPosition {
    line: number;
    column: number;
    lineText: string;
}

async function caretPosition(page: Page, panel: string): Promise<CaretPosition | null> {
    return page.evaluate((selector: string) => {
        const root = document.querySelector(selector);
        const editor = root?.querySelector('.monaco-editor');
        const cursor = Array.from(editor?.querySelectorAll('.cursors-layer .cursor') ?? [])
            .find(node => node.closest('.monaco-editor') === editor) as HTMLElement | undefined;
        if (!cursor) {
            return null;
        }
        const { top, height } = cursor.getBoundingClientRect();
        if (height === 0) {
            return null;
        }
        const viewLines = Array.from(editor!.querySelectorAll('.view-lines'))
            .find(node => node.closest('.monaco-editor') === editor);
        const lines = Array.from(
            viewLines?.querySelectorAll(':scope > .view-line') ?? [],
        ) as HTMLElement[];
        const line = lines.find(node => Math.abs(node.getBoundingClientRect().top - top) < 2);
        if (!line) {
            return null;
        }

        const lineNumbers = Array.from(
            editor!.querySelectorAll('.margin-view-overlays .line-numbers'),
        )
            .filter(node => node.closest('.monaco-editor') === editor)
            .map(node => ({
                line: Number.parseInt(node.textContent ?? '', 10),
                top: (node as HTMLElement).getBoundingClientRect().top,
            }))
            .filter(entry => Number.isFinite(entry.line))
            .sort((a, b) => a.top - b.top);
        const lineNumberEntry = lineNumbers.filter(entry => entry.top <= top + 2).at(-1);
        const lineNumber = lineNumberEntry?.line ?? lines.indexOf(line) + 1;
        if (lineNumber < 1) {
            return null;
        }
        const logicalLineTop = lineNumberEntry?.top ?? line.getBoundingClientRect().top;
        const nextLogicalLineTop = lineNumbers.find(entry => entry.top > logicalLineTop + 2)?.top
            ?? Number.POSITIVE_INFINITY;
        const logicalLines = lines.filter(node => {
            const lineTop = node.getBoundingClientRect().top;
            return lineTop >= logicalLineTop - 2 && lineTop < nextLogicalLineTop - 2;
        });

        const cursorLeft = cursor.getBoundingClientRect().left;
        const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
        let visualColumn = 1;
        let closest = { column: visualColumn, distance: Number.POSITIVE_INFINITY };
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
            const text = node.textContent ?? '';
            for (let offset = 0; offset <= text.length; offset += 1) {
                const range = document.createRange();
                range.setStart(node, offset);
                range.collapse(true);
                const distance = Math.abs(range.getBoundingClientRect().left - cursorLeft);
                if (distance < closest.distance) {
                    closest = { column: visualColumn + offset, distance };
                }
            }
            visualColumn += text.length;
        }
        const wrappedPrefixLength = logicalLines
            .slice(0, logicalLines.indexOf(line))
            .reduce((length, node) => length + (node.textContent ?? '').length, 0);

        return {
            line: lineNumber,
            column: wrappedPrefixLength + closest.column,
            lineText: logicalLines
                .map(node => node.textContent ?? '')
                .join('')
                .replace(/\u00a0/g, ' '),
        };
    }, `${panel} [data-testid="monaco-container"]`);
}

async function caretLineText(page: Page, panel: string): Promise<string | null> {
    return (await caretPosition(page, panel))?.lineText ?? null;
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

            const badgeBox = await statusBadge(page).boundingBox();
            const firstLineBox = await page.locator(
                `${APP_PANEL} [data-testid="monaco-container"] .view-lines .view-line`,
            ).first().boundingBox();
            expect(badgeBox).not.toBeNull();
            expect(firstLineBox).not.toBeNull();
            expect(badgeBox!.y).toBeGreaterThanOrEqual(firstLineBox!.y + firstLineBox!.height);
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

            const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
            const linkSpot = await findWord(page, 'export const label', 'formatWidget');
            await page.mouse.move(4, 4);
            await page.keyboard.down(modifier);
            try {
                await page.mouse.move(linkSpot.x, linkSpot.y);
                await expect
                    .poll(
                        () => wordHasDefinitionLink(page, 'export const label', 'formatWidget'),
                        { timeout: 10_000 },
                    )
                    .toBe(true);
            } finally {
                await page.keyboard.up(modifier);
            }

            // Releasing the modifier has to retire the cue even though the
            // editor never held focus and so never saw the key release. The
            // click below depends on it: Monaco resolves a click against the
            // span the browser named as its target, and a decoration torn down
            // while the click is in flight detaches that span, which loses the
            // caret the assertions after it are about.
            await expect
                .poll(
                    () => wordHasDefinitionLink(page, 'export const label', 'formatWidget'),
                    { timeout: 10_000 },
                )
                .toBe(false);

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

// ---------------------------------------------------------------------------
// 4. Rust language support
// ---------------------------------------------------------------------------

test.describe('Explorer language support – Rust', () => {
    test.describe.configure({ mode: 'serial' });

    test('LSP.R1 rust-analyzer powers hover, definition, and dirty-buffer restart in Explorer', async ({
        page,
        serverUrl,
    }) => {
        const tmpDir = makeTmpDir();
        try {
            const repoDir = createRustRepoFixture(tmpDir);
            await seedWorkspace(serverUrl, WORKSPACE_ID, 'rust-lsp-repo', repoDir);
            await enableExplorerEditorTabs(serverUrl);
            await enableLanguageServers(serverUrl, WORKSPACE_ID, 'rust');

            await gotoExplorer(page, serverUrl);
            await openSourceFile(page, 'app.rs');
            await waitForLanguageServer(page, RUST_APP_PANEL);
            await expect(page.locator(`${RUST_APP_PANEL} [data-testid="language-status-label"]`))
                .toHaveText('rust-analyzer');

            await expect
                .poll(
                    () => hoverTextFor(
                        page,
                        'let label = make_widget',
                        'make_widget',
                        RUST_APP_PANEL,
                    ),
                    { timeout: 90_000 },
                )
                .toContain('fn make_widget');

            const unsaved = 'pub const unsaved_marker: &str = "dirty";';
            await focusMonacoBuffer(page, RUST_APP_PANEL);
            await page.keyboard.press('Control+End');
            await page.keyboard.type(unsaved);
            await expect(page.locator(`${RUST_APP_PANEL} [data-testid="dirty-indicator"]`))
                .toBeVisible({ timeout: 10_000 });

            await ctrlClickWord(
                page,
                'let label = make_widget',
                'make_widget',
                RUST_APP_PANEL,
            );
            await expectEditorTabs(page, [RUST_APP_TAB, RUST_CORE_TAB]);
            const corePanel = `[data-testid="explorer-tab-panel-${RUST_CORE_TAB}"]`;
            await expect
                .poll(() => caretLineText(page, corePanel), { timeout: 15_000 })
                .toContain('pub fn make_widget');

            await editorTab(page, RUST_APP_TAB).click();
            await expect
                .poll(() => paneText(page, RUST_APP_PANEL), { timeout: 10_000 })
                .toContain(unsaved);
            await page.locator(`${RUST_APP_PANEL} [data-testid="language-restart-btn"]`).click();
            await waitForLanguageServer(page, RUST_APP_PANEL);
            await expect
                .poll(
                    () => hoverTextFor(
                        page,
                        'pub const unsaved_marker',
                        'unsaved_marker',
                        RUST_APP_PANEL,
                    ),
                    { timeout: 90_000 },
                )
                .toContain('const unsaved_marker');
            await expect(page.locator(`${RUST_APP_PANEL} [data-testid="dirty-indicator"]`))
                .toBeVisible();
        } finally {
            safeRmSync(tmpDir);
        }
    });

    test('LSP.R2 rust-analyzer definition navigation stays in unified right-panel tabs', async ({
        page,
        serverUrl,
    }) => {
        const tmpDir = makeTmpDir();
        try {
            const repoDir = createRustRepoFixture(tmpDir, 'rust-panel-repo');
            await seedWorkspace(serverUrl, PANEL_WORKSPACE_ID, 'Rust Panel Repo', repoDir);
            await enableSplitWorkspacePanel(serverUrl);
            await enableLanguageServers(serverUrl, PANEL_WORKSPACE_ID, 'rust');

            await page.goto(serverUrl);
            await expect(page.locator('[data-testid="repo-tab"]')).toHaveCount(1, {
                timeout: 10_000,
            });
            await page.locator('[data-testid="repo-tab"]').first().click();
            await expect(page.locator('#repo-detail-content')).toBeVisible({ timeout: 8_000 });
            await openUnifiedSourceFile(page, 'app.rs');

            await waitForLanguageServer(page, UNIFIED_ACTIVE_FILE);
            await expect(page.locator(`${UNIFIED_ACTIVE_FILE} [data-testid="language-status-label"]`))
                .toHaveText('rust-analyzer');

            const tabLabels = page.locator(
                `${UNIFIED_PANEL} [data-testid^="unified-panel-tab-label-"]`,
            );
            await ctrlClickWord(
                page,
                'make_widget',
                'make_widget',
                UNIFIED_ACTIVE_FILE,
                true,
            );
            await expect(tabLabels.filter({ hasText: 'app.rs' })).toHaveCount(1);
            await expect(tabLabels.filter({ hasText: 'lib.rs' })).toHaveCount(1, {
                timeout: 15_000,
            });
            await expect
                .poll(() => caretLineText(page, UNIFIED_ACTIVE_FILE), { timeout: 15_000 })
                .toContain('pub fn make_widget');
        } finally {
            safeRmSync(tmpDir);
        }
    });
});

// ---------------------------------------------------------------------------
// 5. A clone that lives on another CoC server
// ---------------------------------------------------------------------------

/**
 * Everything above runs against one server, where routing a language request to
 * "the workspace" and routing it to "this machine" are the same thing. A direct
 * remote clone splits them: the page is served by the dashboard host, and the
 * files, the config and the language server all belong to a different host the
 * browser reaches at its own origin.
 *
 * The trap the cases below are built to catch is that a mis-routed call still
 * looks valid. Both hosts here register the SAME workspace id over the SAME
 * relative paths, so a request that forgets which clone it belongs to reaches
 * the dashboard host and is answered — with the wrong file, or with "language
 * support off" — instead of failing outright. The dashboard host is given a
 * decoy checkout with no `formatWidget` and no language support at all, so
 * there is no way for it to satisfy a case by accident.
 */

/** Make `dir` a git checkout with a fixed `origin` (never fetched — it only feeds grouping). */
function initGitCheckout(dir: string, originUrl: string): void {
    const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, stdio: 'ignore' });
    git('init');
    git('config', 'user.email', 'e2e@example.com');
    git('config', 'user.name', 'E2E');
    git('add', '.');
    git('commit', '-m', 'init');
    git('remote', 'add', 'origin', originUrl);
}

/** Pick a repo out of the remote picker by name, and wait for its detail body. */
async function selectRepoNamed(page: Page, name: string): Promise<void> {
    await expect(page.locator('[data-testid="remote-chip"]').first()).toBeVisible({ timeout: 30_000 });
    await page.locator('[data-testid="remote-chip"]').first().click();
    await expect(page.locator('[data-testid="remote-dropdown"]')).toBeVisible({ timeout: 10_000 });
    await page.locator('[data-testid="remote-search-input"]').fill(name);
    const row = page.locator('[data-testid="remote-dropdown-item"]');
    await expect(row).toHaveCount(1, { timeout: 30_000 });
    await row.click();
    await expect(page.locator('#repo-detail-content')).toBeVisible({ timeout: 15_000 });
}

/**
 * Click one sub-tab of the selected clone.
 *
 * In the remote-first shell the sub-tabs live in the top bar, and a narrow
 * viewport moves the later ones into an overflow menu, so both places have to
 * be tried.
 */
async function openSubTab(page: Page, key: string): Promise<void> {
    const inline = page.locator(`button[data-subtab="${key}"]`).first();
    if (await inline.isVisible().catch(() => false)) {
        await inline.click();
    } else {
        await page.locator('[data-testid="subbar-overflow-toggle"]').click();
        await page.locator(`[data-testid="subbar-overflow-menu"] [data-subtab="${key}"]`).click();
    }
    await expect(page.locator('[data-testid="explorer-panel"]')).toBeVisible({ timeout: 15_000 });
}

/**
 * The text of every line currently rendered in one editor pane.
 *
 * Read off `.view-line` rather than the container's `innerText`, which carries
 * only the line-number gutter — the same reason the caret and squiggle helpers
 * above walk the view lines themselves.
 */
async function paneText(page: Page, panel: string): Promise<string> {
    return page.evaluate((selector: string) => {
        const root = document.querySelector(selector);
        return Array.from(root?.querySelectorAll('.view-line') ?? [])
            .map(node => (node.textContent ?? '').replace(/\u00a0/g, ' '))
            .join('\n');
    }, `${panel} [data-testid="monaco-container"]`);
}

const UNIFIED_PANEL = '[data-testid="unified-right-panel"]';
const UNIFIED_ACTIVE_FILE = `${UNIFIED_PANEL} [data-testid^="unified-panel-view-"]:not([style*="display: none"])`;

async function enableSplitWorkspacePanel(serverUrl: string): Promise<void> {
    const response = await request(`${serverUrl}/api/admin/config`, {
        method: 'PUT',
        body: JSON.stringify({ 'features.splitWorkspacePanel': true }),
    });
    if (response.status !== 200) {
        throw new Error(`Failed to enable splitWorkspacePanel: ${response.status} ${response.body}`);
    }
}

async function openUnifiedSourceFile(page: Page, name: string): Promise<void> {
    const explorerControl = page.locator('[data-testid="workspace-dock-explorer-toggle"]').first();
    await expect(explorerControl).toBeVisible({ timeout: 15_000 });
    if ((await explorerControl.getAttribute('aria-pressed')) !== 'true') {
        await explorerControl.click();
    }
    await expect(page.locator(UNIFIED_PANEL)).toHaveAttribute('data-open', 'true', { timeout: 10_000 });
    await page.keyboard.press('Control+p');
    const dialog = page.locator('[data-testid="quick-open-dialog"]');
    await expect(dialog).toBeVisible({ timeout: 10_000 });
    await dialog.locator('[data-testid="quick-open-input"]').fill(name);
    await expect(dialog.locator('[data-testid="quick-open-item-0"]')).toBeVisible({ timeout: 10_000 });
    await page.keyboard.press('Enter');
    await expect(dialog).toHaveCount(0, { timeout: 10_000 });
    await expect(page.locator(`${UNIFIED_ACTIVE_FILE} [data-testid="monaco-container"]`))
        .toBeVisible({ timeout: 15_000 });
}

test.describe('Explorer language support – direct remote clone', () => {
    test.describe.configure({ mode: 'serial' });

    test('LSP.7 a remote clone gets its own host\'s language server and definition', async ({
        page,
        serverUrl,
    }) => {
        const tmpDir = makeTmpDir();
        const secondary = await startSecondaryServer();
        let remoteServerId: string | null = null;
        try {
            // The real project, on the other host.
            const remoteDir = createTypeScriptRepoFixture(tmpDir, {
                dirName: 'remote-repo',
                marker: 'formatting for the remote checkout',
            });
            initGitCheckout(remoteDir, 'https://github.com/acme/remote-lsp.git');
            await seedWorkspace(secondary.url, WORKSPACE_ID, 'Remote LSP Repo', remoteDir);

            // The decoy, on the dashboard host, under the SAME workspace id and
            // the same relative paths.
            const decoyDir = createDecoyRepoFixture(tmpDir);
            initGitCheckout(decoyDir, 'https://github.com/acme/decoy-lsp.git');
            await seedWorkspace(serverUrl, WORKSPACE_ID, 'Decoy Local Repo', decoyDir);

            await enableExplorerEditorTabs(serverUrl);
            // Language support is turned on for the REMOTE workspace only. The
            // dashboard host keeps its shipped-off config, so a document that
            // read its configuration locally would report "Language support off"
            // and never start anything.
            await enableLanguageServers(secondary.url, WORKSPACE_ID);
            remoteServerId = (await registerRemoteServer(serverUrl, 'Remote Host', secondary.url)).id;

            await enableRemoteShell(page);
            await page.goto(serverUrl);
            await selectRepoNamed(page, 'Remote LSP Repo');
            await openSubTab(page, 'explorer');
            await openSourceFile(page, 'app.ts');

            // AC-01: the badge can only reach `ready` through the remote host's
            // config and a server process started on that host.
            await waitForLanguageServer(page);
            await expect(page.locator(`${APP_PANEL} [data-testid="language-status-label"]`))
                .toHaveText('TypeScript');

            // The buffer on screen is the remote checkout's, not the decoy that
            // shares its path on the page origin.
            expect(await paneText(page, APP_PANEL)).toContain('formatWidget');
            await waitForProjectLoaded(page);

            await expectEditorTabs(page, [APP_TAB]);

            const unsavedMarker = 'export const unsavedRemoteBuffer = label;';
            await focusMonacoBuffer(page);
            await page.keyboard.press('Control+End');
            await page.keyboard.type(unsavedMarker);
            await expect(page.locator(`${APP_PANEL} [data-testid="dirty-indicator"]`))
                .toBeVisible({ timeout: 10_000 });

            // AC-02: go to definition across files. The answer comes from the
            // remote server, and the file it names has to be read back from the
            // remote host too.
            await ctrlClickWord(page, 'export const label', 'formatWidget');

            await expectEditorTabs(page, [APP_TAB, FORMAT_TAB]);
            const formatPanel = `[data-testid="explorer-tab-panel-${FORMAT_TAB}"]`;
            await expect(page.locator(`${formatPanel} [data-testid="monaco-container"]`))
                .toBeVisible({ timeout: 15_000 });

            // The marker is written into the remote checkout only, so this is
            // the assertion that separates "the right path" from "the right
            // host's copy of that path".
            await expect
                .poll(() => paneText(page, formatPanel), { timeout: 15_000 })
                .toContain('formatting for the remote checkout');
            expect(await paneText(page, formatPanel)).not.toContain('decoy checkout');

            await expect
                .poll(() => caretPosition(page, formatPanel), { timeout: 15_000 })
                .toEqual({
                    line: 7,
                    column: 17,
                    lineText: 'export function formatWidget(widget: Widget): string {',
                });

            await expect(page.locator('[data-testid="clone-switch"]'))
                .toHaveAttribute('title', 'Remote LSP Repo');
            await expect(page.locator(`${APP_PANEL} [data-testid="dirty-indicator"]`))
                .toHaveCount(1);

            // Monaco handles same-file definitions itself. The gesture must move
            // to the parameter without creating a third tab or leaving this clone.
            await ctrlClickWord(page, 'return widget.name', 'widget', formatPanel);
            await expectEditorTabs(page, [APP_TAB, FORMAT_TAB]);
            await expect
                .poll(() => caretPosition(page, formatPanel), { timeout: 15_000 })
                .toEqual({
                    line: 7,
                    column: 30,
                    lineText: 'export function formatWidget(widget: Widget): string {',
                });
            await expect(page.locator('[data-testid="clone-switch"]'))
                .toHaveAttribute('title', 'Remote LSP Repo');

            await editorTab(page, APP_TAB).click();
            await expect(page.locator(`${APP_PANEL} [data-testid="monaco-container"]`))
                .toBeVisible({ timeout: 10_000 });
            await expect
                .poll(() => paneText(page, APP_PANEL), { timeout: 10_000 })
                .toContain(unsavedMarker);
            await expect(page.locator(`${APP_PANEL} [data-testid="dirty-indicator"]`))
                .toBeVisible();
            await expect(page.locator('[data-testid="clone-switch"]'))
                .toHaveAttribute('title', 'Remote LSP Repo');
        } finally {
            if (remoteServerId) {
                await request(`${serverUrl}/api/servers/${encodeURIComponent(remoteServerId)}`, {
                    method: 'DELETE',
                });
            }
            await secondary.cleanup();
            safeRmSync(tmpDir);
        }
    });

    test('LSP.8 a direct remote definition stays in unified right-panel file tabs', async ({
        page,
        serverUrl,
    }) => {
        const tmpDir = makeTmpDir();
        const secondary = await startSecondaryServer();
        let remoteServerId: string | null = null;
        try {
            const remoteDir = createTypeScriptRepoFixture(tmpDir, {
                dirName: 'remote-panel-repo',
                marker: 'formatting for the remote panel checkout',
            });
            initGitCheckout(remoteDir, 'https://github.com/acme/remote-panel-lsp.git');
            await seedWorkspace(secondary.url, PANEL_WORKSPACE_ID, 'Remote Panel LSP Repo', remoteDir);

            const decoyDir = createDecoyRepoFixture(tmpDir);
            initGitCheckout(decoyDir, 'https://github.com/acme/decoy-panel-lsp.git');
            await seedWorkspace(serverUrl, PANEL_WORKSPACE_ID, 'Decoy Panel Repo', decoyDir);

            await enableSplitWorkspacePanel(serverUrl);
            await enableLanguageServers(secondary.url, PANEL_WORKSPACE_ID);
            remoteServerId = (
                await registerRemoteServer(serverUrl, 'Remote Panel Host', secondary.url)
            ).id;

            await enableRemoteShell(page);
            await page.goto(serverUrl);
            await selectRepoNamed(page, 'Remote Panel LSP Repo');
            await openUnifiedSourceFile(page, 'app.ts');

            await waitForLanguageServer(page, UNIFIED_ACTIVE_FILE);
            await expect(page.locator(`${UNIFIED_ACTIVE_FILE} [data-testid="language-status-label"]`))
                .toHaveText('TypeScript');
            expect(await paneText(page, UNIFIED_ACTIVE_FILE)).toContain('formatWidget');
            await waitForProjectLoaded(page, UNIFIED_ACTIVE_FILE);

            const tabLabels = page.locator(
                `${UNIFIED_PANEL} [data-testid^="unified-panel-tab-label-"]`,
            );
            const formatTab = tabLabels.filter({ hasText: 'format.ts' });
            await ctrlClickWord(
                page,
                'formatWidget',
                'formatWidget',
                UNIFIED_ACTIVE_FILE,
                true,
            );

            await expect(tabLabels.filter({ hasText: 'app.ts' })).toHaveCount(1);
            await expect(formatTab).toHaveCount(1, { timeout: 15_000 });
            await expect
                .poll(
                    async () => (await paneText(page, UNIFIED_ACTIVE_FILE)).replace(/\s+/g, ' '),
                    { timeout: 15_000 },
                )
                .toContain('formatting for the remote panel checkout');
            expect(await paneText(page, UNIFIED_ACTIVE_FILE)).not.toContain('decoy checkout');
            await expect
                .poll(() => caretPosition(page, UNIFIED_ACTIVE_FILE), { timeout: 15_000 })
                .toEqual({
                    line: 7,
                    column: 17,
                    lineText: 'export function formatWidget(widget: Widget): string {',
                });
        } finally {
            if (remoteServerId) {
                await request(`${serverUrl}/api/servers/${encodeURIComponent(remoteServerId)}`, {
                    method: 'DELETE',
                });
            }
            await secondary.cleanup();
            safeRmSync(tmpDir);
        }
    });
});
