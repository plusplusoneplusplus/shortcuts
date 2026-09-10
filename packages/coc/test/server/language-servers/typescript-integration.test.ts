/**
 * AC-03 Definition of Done item 5: a real `typescript-language-server` process,
 * driven over the real transport, answering about a real project.
 *
 * Everything else in this directory either uses the non-TypeScript fixture
 * server or injects a fake filesystem, which proves the plumbing but says
 * nothing about whether TypeScript actually understands the project. Here a
 * temporary project with a `tsconfig.json`, a path alias, a cross-file import
 * and an installed dependency type is built on disk, the packaged server is
 * started against it through `prepareDefinitionForRoot`, and each shipped
 * language feature is asked a question whose answer only a working TypeScript
 * service can give.
 *
 * The suite also pins the dependency: if `typescript-language-server` is
 * dropped from `packages/coc`, the packaged branch of the adapter resolves to
 * nothing and the first case here fails.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { LanguageServerSession } from '../../../src/server/language-servers/session';
import { prepareDefinitionForRoot } from '../../../src/server/language-servers/adapters';
import { resolveTypeScriptRuntime } from '../../../src/server/language-servers/typescript-adapter';
import { TYPESCRIPT_PRESET } from '../../../src/server/language-servers/presets';
import type { LanguageServerDefinition } from '../../../src/server/language-servers/types';

interface Position {
    line: number;
    character: number;
}

interface Diagnostic {
    message: string;
    range: { start: Position; end: Position };
    severity?: number;
}

const WIDGETS_TS = `export interface Widget {
    id: string;
    label: string;
}

/** Builds a widget from its parts. */
export function makeWidget(id: string, label: string): Widget {
    return { id, label };
}
`;

const FORMAT_TS = `import type { Widget } from '../widgets';

export function formatWidget(widget: Widget): string {
    return widget.id + ': ' + widget.label;
}
`;

const APP_TS = `import { makeWidget } from './widgets';
import { formatWidget } from '@lib/format';
import { greet } from 'tiny-dep';

const widget = makeWidget('one', 'One');
export const rendered = formatWidget(widget);
export const greeting = greet(widget.label);
`;

const APP_WITH_ERROR_TS = `${APP_TS}export const readinessProbe: number = 'not a number';
`;

/**
 * The same project in Windows line endings. Built by joining with an explicit
 * `\r\n` so no editor setting, checkout filter or formatter can quietly turn
 * it back into `\n` and leave the cases below proving nothing.
 */
const CRLF_TS = [
    "import { makeWidget } from './widgets';",
    '',
    "const crlfWidget = makeWidget('two', 'Two');",
    'export const crlfLabel = crlfWidget.label;',
    '',
].join('\r\n');

const TSCONFIG = {
    compilerOptions: {
        target: 'ES2020',
        module: 'commonjs',
        moduleResolution: 'node',
        strict: true,
        noEmit: true,
        baseUrl: '.',
        paths: { '@lib/*': ['src/lib/*'] },
    },
    include: ['src'],
};

let root: string;
let session: LanguageServerSession;
const diagnostics = new Map<string, Diagnostic[]>();
/** Document versions, so every `didChange` carries a higher one. */
const versions = new Map<string, number>();

/**
 * Writes the project. `node_modules/tiny-dep` is a hand-built package rather
 * than a real install: the point is that a declaration file the project did
 * not author contributes to the answers.
 */
function createProject(): string {
    // Canonicalize through the operating system before creating the project.
    // This resolves macOS's `/tmp` symlink and expands Windows runner 8.3 paths
    // such as `RUNNER~1`. tsserver reports the native spelling, and
    // typescript-language-server matches diagnostics to open documents by
    // filepath, so opening the short spelling would drop every diagnostic.
    const dir = fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), 'coc-lsp-ts-'));
    fs.mkdirSync(path.join(dir, 'src', 'lib'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'node_modules', 'tiny-dep'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'coc-lsp-fixture', version: '1.0.0' }, null, 2));
    fs.writeFileSync(path.join(dir, 'tsconfig.json'), JSON.stringify(TSCONFIG, null, 2));
    fs.writeFileSync(path.join(dir, 'src', 'widgets.ts'), WIDGETS_TS);
    fs.writeFileSync(path.join(dir, 'src', 'lib', 'format.ts'), FORMAT_TS);
    fs.writeFileSync(path.join(dir, 'src', 'app.ts'), APP_TS);
    fs.writeFileSync(path.join(dir, 'src', 'crlf.ts'), CRLF_TS);
    fs.writeFileSync(
        path.join(dir, 'node_modules', 'tiny-dep', 'package.json'),
        JSON.stringify({ name: 'tiny-dep', version: '1.0.0', main: 'index.js', types: 'index.d.ts' }, null, 2),
    );
    fs.writeFileSync(path.join(dir, 'node_modules', 'tiny-dep', 'index.d.ts'), 'export declare function greet(name: string): string;\n');
    fs.writeFileSync(path.join(dir, 'node_modules', 'tiny-dep', 'index.js'), 'exports.greet = (name) => name;\n');
    return dir;
}

function uriFor(relative: string): string {
    return pathToFileURL(path.join(root, ...relative.split('/'))).href;
}

/**
 * File-URI identity for assertions and notification lookup.
 *
 * Windows runners expose the temp directory through an 8.3 path such as
 * `RUNNER~1`, while tsserver can answer with the equivalent long path. URI
 * spelling alone cannot identify the document there, even after normalizing
 * drive-letter casing. Resolve both spellings through the filesystem first.
 */
function fileUriKey(uri: string): string {
    if (!uri.startsWith('file:')) {
        return uri;
    }
    const filePath = fileURLToPath(uri);
    let resolved: string;
    try {
        resolved = fs.realpathSync.native(filePath);
    } catch {
        resolved = path.resolve(filePath);
    }
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

/** Position of a marker inside a document, so no test hard-codes a column. */
function positionAt(text: string, marker: string, offsetInMarker = 0): Position {
    const index = text.indexOf(marker);
    if (index < 0) {
        throw new Error(`Marker not found: ${marker}`);
    }
    const target = index + offsetInMarker;
    const before = text.slice(0, target);
    const line = before.split('\n').length - 1;
    return { line, character: target - (before.lastIndexOf('\n') + 1) };
}

function openDocument(relative: string, text: string): void {
    const uri = uriFor(relative);
    versions.set(uri, 1);
    session.sendNotification('textDocument/didOpen', {
        textDocument: { uri, languageId: 'typescript', version: 1, text },
    });
}

/** Replaces a document's buffer without touching disk. */
function changeDocument(relative: string, text: string): void {
    const uri = uriFor(relative);
    const version = (versions.get(uri) ?? 1) + 1;
    versions.set(uri, version);
    session.sendNotification('textDocument/didChange', {
        textDocument: { uri, version },
        contentChanges: [{ text }],
    });
}

/** Replaces one span of a document, the way the store does under incremental sync. */
function changeDocumentRange(relative: string, range: { start: Position; end: Position }, text: string): void {
    const uri = uriFor(relative);
    const version = (versions.get(uri) ?? 1) + 1;
    versions.set(uri, version);
    session.sendNotification('textDocument/didChange', {
        textDocument: { uri, version },
        contentChanges: [{ range, text }],
    });
}

async function waitFor<T>(produce: () => T | undefined, description: string, timeoutMs = 30_000): Promise<T> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
        const value = produce();
        if (value !== undefined) {
            return value;
        }
        if (Date.now() > deadline) {
            throw new Error(`Timed out waiting for ${description}`);
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
    }
}

/** Waits until the diagnostics published for a document satisfy `check`. */
async function waitForDiagnostics(relative: string, check: (found: Diagnostic[]) => boolean): Promise<Diagnostic[]> {
    const key = fileUriKey(uriFor(relative));
    return waitFor(() => {
        const found = diagnostics.get(key);
        return found && check(found) ? found : undefined;
    }, `diagnostics for ${relative}`);
}

/** A definition answer is `Location`, `Location[]`, or `LocationLink[]`. */
function targetFileKeys(result: unknown): string[] {
    const entries = Array.isArray(result) ? result : result ? [result] : [];
    return entries
        .map((entry) => {
            const record = entry as { uri?: unknown; targetUri?: unknown };
            const uri = typeof record.targetUri === 'string' ? record.targetUri : record.uri;
            return typeof uri === 'string' ? fileUriKey(uri) : undefined;
        })
        .filter((key): key is string => key !== undefined);
}

function hoverText(result: unknown): string {
    const contents = (result as { contents?: unknown } | null)?.contents;
    if (typeof contents === 'string') {
        return contents;
    }
    if (Array.isArray(contents)) {
        return contents.map((entry) => hoverText({ contents: entry })).join('\n');
    }
    const record = contents as { value?: unknown } | undefined;
    return typeof record?.value === 'string' ? record.value : '';
}

function completionLabels(result: unknown): string[] {
    const items = Array.isArray(result) ? result : ((result as { items?: unknown[] } | null)?.items ?? []);
    return items
        .map((item) => (item as { label?: unknown }).label)
        .filter((label): label is string => typeof label === 'string');
}

beforeAll(async () => {
    root = createProject();
    const enabled: LanguageServerDefinition = { ...TYPESCRIPT_PRESET, enabled: true };
    const prepared = prepareDefinitionForRoot(enabled, root);
    session = new LanguageServerSession({
        definition: prepared.definition,
        rootPath: root,
        runtimeLabel: prepared.runtimeLabel,
        commandLabel: prepared.commandLabel,
        startTimeoutMs: 45_000,
        requestTimeoutMs: 30_000,
        idleTimeoutMs: 10 * 60_000,
    });
    session.onNotification('textDocument/publishDiagnostics', (params) => {
        const payload = params as { uri?: string; diagnostics?: Diagnostic[] };
        if (typeof payload?.uri === 'string') {
            diagnostics.set(fileUriKey(payload.uri), payload.diagnostics ?? []);
        }
    });
    await session.start();
    openDocument('src/widgets.ts', WIDGETS_TS);
    openDocument('src/lib/format.ts', FORMAT_TS);
    openDocument('src/app.ts', APP_WITH_ERROR_TS);
    openDocument('src/crlf.ts', CRLF_TS);
    // A clean file is allowed to produce no diagnostics notification at all.
    // Use a real diagnostic as the readiness signal, then verify its clear.
    await waitForDiagnostics('src/app.ts', (found) => found.some((entry) => entry.message.includes('not assignable')));
    changeDocument('src/app.ts', APP_TS);
    await waitForDiagnostics('src/app.ts', (found) => found.length === 0);
}, 120_000);

afterAll(async () => {
    await session?.dispose();
    if (root) {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

describe('packaged TypeScript runtime', () => {
    it('opens the project with the native path spelling tsserver reports', () => {
        expect(root).toBe(fs.realpathSync.native(root));
    });

    it('resolves the language server packaged with CoC for a project that has none', () => {
        const runtime = resolveTypeScriptRuntime(TYPESCRIPT_PRESET, root);
        expect(runtime.server).toBe('bundled');
        expect(runtime.command).toBe(process.execPath);
        expect(runtime.args[0].replace(/\\/g, '/')).toContain('typescript-language-server/lib/cli.mjs');
        expect(fs.existsSync(runtime.args[0])).toBe(true);
        expect(runtime.args).toContain('--stdio');
    });

    it('drives it with the TypeScript packaged with CoC and reports both in the label', () => {
        const runtime = resolveTypeScriptRuntime(TYPESCRIPT_PRESET, root);
        expect(runtime.typescript).toBe('bundled');
        expect(runtime.typescriptVersion).toMatch(/^\d+\.\d+/);
        expect(fs.existsSync(runtime.tsserverPath!)).toBe(true);
        expect(runtime.label).toContain('packaged with CoC');
        expect(runtime.notes).toEqual([]);
    });

    it('hands the resolved tsserver to the server without leaking a host path into the state', () => {
        const state = session.getState();
        expect(state.status).toBe('ready');
        expect(state.displayName).toBe('TypeScript');
        expect(state.runtime).toContain('packaged with CoC');
        expect(state.runtime).not.toContain(root);
        // Compare against the escaped spelling: a Windows path is full of
        // backslashes, and `JSON.stringify` doubles every one of them.
        expect(JSON.stringify(state)).not.toContain(JSON.stringify(process.execPath).slice(1, -1));
        // This server sends no `serverInfo`, so the state cannot name it. What
        // the user is shown is `displayName` and `runtime`, never `serverName`.
        expect(state.serverName).toBeUndefined();
    });

    it('negotiates every capability the shipped features need', () => {
        const capabilities = session.getState().capabilities as Record<string, unknown>;
        expect(capabilities.hoverProvider).toBeTruthy();
        expect(capabilities.definitionProvider).toBeTruthy();
        expect(capabilities.referencesProvider).toBeTruthy();
        expect(capabilities.completionProvider).toBeTruthy();
        expect(capabilities.signatureHelpProvider).toBeTruthy();
        expect(capabilities.textDocumentSync).toBeDefined();
        // No negotiated encoding means the spec default, `utf-16`, which is the
        // one assumption `monacoBridge.ts` makes when it converts positions.
        expect(capabilities.positionEncoding ?? 'utf-16').toBe('utf-16');
    });
});

describe('TypeScript language features over a real project', () => {
    it('hovers a cross-file function with its resolved signature', async () => {
        const result = await session.sendRequest('textDocument/hover', {
            textDocument: { uri: uriFor('src/app.ts') },
            position: positionAt(APP_TS, "makeWidget('one'", 2),
        });
        const text = hoverText(result);
        expect(text).toContain('makeWidget');
        expect(text).toContain('Widget');
        expect(text).toContain('Builds a widget from its parts.');
    });

    it('goes to a definition in another file', async () => {
        const result = await session.sendRequest('textDocument/definition', {
            textDocument: { uri: uriFor('src/app.ts') },
            position: positionAt(APP_TS, "makeWidget('one'", 2),
        });
        expect(targetFileKeys(result)).toContain(fileUriKey(uriFor('src/widgets.ts')));
    });

    it('follows a tsconfig path alias to its target', async () => {
        const result = await session.sendRequest('textDocument/definition', {
            textDocument: { uri: uriFor('src/app.ts') },
            position: positionAt(APP_TS, 'formatWidget(widget)', 2),
        });
        expect(targetFileKeys(result)).toContain(fileUriKey(uriFor('src/lib/format.ts')));
    });

    it('follows an installed dependency type into node_modules', async () => {
        const result = await session.sendRequest('textDocument/definition', {
            textDocument: { uri: uriFor('src/app.ts') },
            position: positionAt(APP_TS, 'greet(widget.label)', 2),
        });
        expect(targetFileKeys(result)).toContain(fileUriKey(uriFor('node_modules/tiny-dep/index.d.ts')));
    });

    it('finds references to an exported type across the project', async () => {
        const result = await session.sendRequest('textDocument/references', {
            textDocument: { uri: uriFor('src/widgets.ts') },
            position: positionAt(WIDGETS_TS, 'interface Widget', 10),
            context: { includeDeclaration: true },
        });
        const keys = targetFileKeys(result);
        expect(keys).toContain(fileUriKey(uriFor('src/widgets.ts')));
        expect(keys).toContain(fileUriKey(uriFor('src/lib/format.ts')));
    });

    it('completes the members of an inferred type', async () => {
        const result = await session.sendRequest('textDocument/completion', {
            textDocument: { uri: uriFor('src/app.ts') },
            position: positionAt(APP_TS, 'widget.label)', 7),
            context: { triggerKind: 1 },
        });
        const labels = completionLabels(result);
        expect(labels).toContain('id');
        expect(labels).toContain('label');
    });

    it('answers signature help inside a call, with the active parameter', async () => {
        const result = (await session.sendRequest('textDocument/signatureHelp', {
            textDocument: { uri: uriFor('src/app.ts') },
            position: positionAt(APP_TS, "makeWidget('one'", 11),
            context: { triggerKind: 1, isRetrigger: false },
        })) as { signatures?: { label?: string }[]; activeParameter?: number } | null;
        expect(result?.signatures?.[0]?.label).toContain('id: string');
        expect(result?.signatures?.[0]?.label).toContain('label: string');
        expect(result?.activeParameter ?? 0).toBe(0);
    });
});

/**
 * AC-02's CRLF requirement, answered by the server itself rather than by a
 * conversion test. Every position below is measured against the `\r\n` text
 * the buffer actually holds, so a `\r` counted into a line — in the fixture,
 * in the helpers, or in what the store sends — moves the answer off the symbol
 * and the case fails.
 */
describe('a document with CRLF line endings', () => {
    afterAll(async () => {
        changeDocument('src/crlf.ts', CRLF_TS);
        await waitForDiagnostics('src/crlf.ts', (list) => list.length === 0);
    });

    it('writes the fixture with Windows terminators', () => {
        const onDisk = fs.readFileSync(path.join(root, 'src', 'crlf.ts'), 'utf8');
        expect(onDisk).toBe(CRLF_TS);
        expect(onDisk.match(/\r\n/g)).toHaveLength(4);
        expect(onDisk).not.toMatch(/[^\r]\n/);
    });

    it('hovers a symbol on a later line at the position we measured', async () => {
        const position = positionAt(CRLF_TS, 'crlfWidget.label', 2);
        expect(position.line).toBe(3);
        const result = (await session.sendRequest('textDocument/hover', {
            textDocument: { uri: uriFor('src/crlf.ts') },
            position,
        })) as { range?: { start: Position; end: Position } } | null;

        expect(hoverText(result)).toContain('Widget');
        // The server answers with the span it resolved. It has to be the
        // identifier we aimed at, on the line we counted.
        const start = positionAt(CRLF_TS, 'crlfWidget.label');
        expect(result?.range).toEqual({
            start,
            end: { line: start.line, character: start.character + 'crlfWidget'.length },
        });
    });

    it('resolves a cross-file type through the CRLF buffer', async () => {
        const result = await session.sendRequest('textDocument/definition', {
            textDocument: { uri: uriFor('src/crlf.ts') },
            position: positionAt(CRLF_TS, "makeWidget('two'", 2),
        });
        expect(targetFileKeys(result)).toContain(fileUriKey(uriFor('src/widgets.ts')));
    });

    it('reports a diagnostic on the CRLF line the edit was made on', async () => {
        const broken = `${CRLF_TS}export const crlfBroken: number = crlfLabel;\r\n`;
        changeDocument('src/crlf.ts', broken);
        const found = await waitForDiagnostics('src/crlf.ts', (list) => list.length > 0);

        const expected = positionAt(broken, 'crlfBroken:');
        expect(expected.line).toBe(4);
        expect(found[0].range.start).toEqual(expected);
        expect(found[0].message).toContain('not assignable');
    });

    it('applies a ranged edit measured over CRLF text to the span we named', async () => {
        changeDocument('src/crlf.ts', CRLF_TS);
        await waitForDiagnostics('src/crlf.ts', (list) => list.length === 0);

        // Incremental sync, which is what tsserver negotiates: replace the
        // second argument in place. If the range were computed with the
        // terminators counted into the line, this would splice somewhere else
        // and the argument type error would land on another position.
        const start = positionAt(CRLF_TS, "'Two'");
        expect(start.line).toBe(2);
        changeDocumentRange('src/crlf.ts', { start, end: { line: start.line, character: start.character + 5 } }, '2');

        const found = await waitForDiagnostics('src/crlf.ts', (list) => list.length > 0);
        expect(found[0].message).toContain('not assignable');
        expect(found[0].range.start).toEqual(start);
        expect(found[0].range.end).toEqual({ line: start.line, character: start.character + 1 });
    });
});

describe('unsaved buffers', () => {
    afterAll(() => {
        // Leave the project as it was on disk for anything running after this.
        changeDocument('src/widgets.ts', WIDGETS_TS);
        changeDocument('src/app.ts', APP_TS);
    });

    it('reports a diagnostic for an edit that was never written to disk', async () => {
        changeDocument('src/app.ts', `${APP_TS}export const broken: number = 'not a number';\n`);
        const found = await waitForDiagnostics('src/app.ts', (list) => list.length > 0);
        expect(found.some((entry) => entry.message.includes('not assignable'))).toBe(true);
        expect(fs.readFileSync(path.join(root, 'src', 'app.ts'), 'utf8')).toBe(APP_TS);
    });

    it('clears the diagnostic when the edit is taken back', async () => {
        changeDocument('src/app.ts', APP_TS);
        const found = await waitForDiagnostics('src/app.ts', (list) => list.length === 0);
        expect(found).toEqual([]);
    });

    it('lets an importing file see an exported type edited but not saved', async () => {
        changeDocument('src/widgets.ts', WIDGETS_TS.replace(/label/g, 'caption'));
        const appDiagnostics = await waitForDiagnostics('src/app.ts', (list) => list.length > 0);
        expect(appDiagnostics.some((entry) => entry.message.includes('label'))).toBe(true);
        const formatDiagnostics = await waitForDiagnostics('src/lib/format.ts', (list) => list.length > 0);
        expect(formatDiagnostics.some((entry) => entry.message.includes('label'))).toBe(true);
    });

    it('completes the renamed member from the unsaved buffer', async () => {
        const result = await session.sendRequest('textDocument/completion', {
            textDocument: { uri: uriFor('src/app.ts') },
            position: positionAt(APP_TS, 'widget.label)', 7),
            context: { triggerKind: 1 },
        });
        const labels = completionLabels(result);
        expect(labels).toContain('caption');
        expect(labels).not.toContain('label');
    });
});
