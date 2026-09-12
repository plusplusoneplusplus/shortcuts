/**
 * Real packaged-Pyright coverage. This suite intentionally fails when the
 * production dependency or its JavaScript language-server entry point is
 * missing.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { prepareDefinitionForRoot } from '../../../src/server/language-servers/adapters';
import { resolvePythonRuntime } from '../../../src/server/language-servers/python-adapter';
import { PYTHON_PRESET } from '../../../src/server/language-servers/presets';
import { LanguageServerSession } from '../../../src/server/language-servers/session';
import type { LanguageServerDefinition } from '../../../src/server/language-servers/types';
import { safeRm } from '../../helpers/safe-rm';

let root: string;
let session: LanguageServerSession;
const diagnostics = new Map<string, Diagnostic[]>();
let mainVersion = 1;

interface HostPython {
    command: string;
    args: string[];
}

interface Position {
    line: number;
    character: number;
}

interface Diagnostic {
    message: string;
}

const SOURCE_TEXT = `class Greeter:
    def greet(self, name: str) -> str:
        return f"Hello, {name}"

def shared_value() -> str:
    return "shared"
`;

const API_STUB_TEXT = `def format_message(name: str, repeat: int = ...) -> str: ...
`;

const API_TEXT = `def format_message(name: str, repeat: int = 1) -> str:
    return name * repeat
`;

const MAIN_TEXT = `from source import Greeter, shared_value
from typed_api import format_message

greeter = Greeter()
message = greeter.greet("CoC")
formatted = format_message("CoC", 2)
shared = shared_value()
`;

const WINDOW_TEXT = `from typed_api import format_message

title = format_message("Window", 1)
`;

function findHostPython(): HostPython | undefined {
    const candidates: HostPython[] = process.platform === 'win32'
        ? [{ command: 'python', args: [] }, { command: 'py', args: ['-3'] }]
        : [{ command: 'python3', args: [] }, { command: 'python', args: [] }];
    for (const candidate of candidates) {
        const probeRoot = fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), 'coc-python-venv-probe-'));
        try {
            const result = spawnSync(candidate.command, [
                ...candidate.args,
                '-m',
                'venv',
                '--without-pip',
                path.join(probeRoot, 'venv'),
            ], {
                encoding: 'utf8',
                stdio: 'pipe',
                timeout: 60_000,
                windowsHide: true,
            });
            if (result.status === 0) {
                return candidate;
            }
        } finally {
            fs.rmSync(probeRoot, { recursive: true, force: true });
        }
    }
    return undefined;
}

function runPython(python: HostPython | string, args: string[], cwd: string): string {
    const command = typeof python === 'string' ? python : python.command;
    const prefix = typeof python === 'string' ? [] : python.args;
    const result = spawnSync(command, [...prefix, ...args], {
        cwd,
        encoding: 'utf8',
        stdio: 'pipe',
        timeout: 120_000,
        windowsHide: true,
    });
    if (result.status !== 0) {
        throw new Error(`Python fixture command failed: ${result.stderr || result.stdout || `exit ${result.status}`}`);
    }
    return result.stdout.trim();
}

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

function definitionPaths(result: unknown): string[] {
    const entries = Array.isArray(result) ? result : result ? [result] : [];
    return entries
        .map((entry) => {
            const location = entry as { uri?: unknown; targetUri?: unknown };
            const uri = typeof location.targetUri === 'string' ? location.targetUri : location.uri;
            return typeof uri === 'string' && uri.startsWith('file:') ? fileURLToPath(uri) : undefined;
        })
        .filter((candidate): candidate is string => candidate !== undefined);
}

function targetUris(result: unknown): string[] {
    const entries = Array.isArray(result) ? result : result ? [result] : [];
    return entries.flatMap((entry) => {
        const location = entry as { uri?: unknown; targetUri?: unknown };
        const uri = typeof location.targetUri === 'string' ? location.targetUri : location.uri;
        return typeof uri === 'string' ? [uri] : [];
    });
}

function completionLabels(result: unknown): string[] {
    const items = Array.isArray(result) ? result : ((result as { items?: unknown[] } | null)?.items ?? []);
    return items.flatMap((item) => {
        const label = (item as { label?: unknown }).label;
        return typeof label === 'string' ? [label] : [];
    });
}

function uriFor(relative: string): string {
    return pathToFileURL(path.join(root, ...relative.split('/'))).href;
}

function filePathKey(candidate: string): string {
    let resolved: string;
    try {
        resolved = fs.realpathSync.native(candidate);
    } catch {
        resolved = path.resolve(candidate);
    }
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function fileUriKey(uri: string): string {
    return uri.startsWith('file:') ? filePathKey(fileURLToPath(uri)) : uri;
}

function openDocument(relative: string, text: string): void {
    session.sendNotification('textDocument/didOpen', {
        textDocument: { uri: uriFor(relative), languageId: 'python', version: 1, text },
    });
}

function changeMain(text: string): void {
    mainVersion += 1;
    session.sendNotification('textDocument/didChange', {
        textDocument: { uri: uriFor('main.py'), version: mainVersion },
        contentChanges: [{ text }],
    });
}

async function waitFor<T>(
    produce: () => T | undefined | Promise<T | undefined>,
    description: string,
    timeoutMs = 30_000,
): Promise<T> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
        const value = await produce();
        if (value !== undefined) {
            return value;
        }
        if (Date.now() > deadline) {
            throw new Error(`Timed out waiting for ${description}`);
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
    }
}

async function waitForRequest<T>(
    method: string,
    params: unknown,
    check: (result: T) => boolean,
    description: string,
): Promise<T> {
    return waitFor(async () => {
        const result = await session.sendRequest<T>(method, params);
        return check(result) ? result : undefined;
    }, description);
}

async function waitForDiagnostics(
    relative: string,
    check: (found: Diagnostic[]) => boolean,
): Promise<Diagnostic[]> {
    const key = fileUriKey(uriFor(relative));
    try {
        return await waitFor(() => {
            const found = diagnostics.get(key);
            return found && check(found) ? found : undefined;
        }, `Python diagnostics for ${relative}`);
    } catch (error) {
        throw new Error(`${String(error)}; received ${JSON.stringify([...diagnostics])}`);
    }
}

beforeAll(async () => {
    root = fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), 'coc-lsp-python-'));
    fs.writeFileSync(path.join(root, 'pyproject.toml'), '[project]\nname = "coc-pyright-fixture"\nversion = "1.0.0"\n');
    fs.writeFileSync(path.join(root, 'source.py'), SOURCE_TEXT);
    fs.writeFileSync(path.join(root, 'typed_api.py'), API_TEXT);
    fs.writeFileSync(path.join(root, 'typed_api.pyi'), API_STUB_TEXT);
    fs.writeFileSync(path.join(root, 'main.py'), MAIN_TEXT);
    fs.writeFileSync(path.join(root, 'window.pyw'), WINDOW_TEXT);
    fs.writeFileSync(path.join(root, 'unopened.py'), 'broken: int = "not an int"\n');

    const enabled: LanguageServerDefinition = { ...PYTHON_PRESET, enabled: true };
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
        const payload = params as { uri?: unknown; diagnostics?: Diagnostic[] };
        if (typeof payload.uri === 'string') {
            diagnostics.set(fileUriKey(payload.uri), payload.diagnostics ?? []);
        }
    });
    await session.start();
    openDocument('main.py', MAIN_TEXT);
    openDocument('window.pyw', WINDOW_TEXT);
    await waitForRequest(
        'textDocument/hover',
        {
            textDocument: { uri: uriFor('main.py') },
            position: positionAt(MAIN_TEXT, 'format_message("CoC"', 2),
        },
        (result) => hoverText(result).includes('format_message'),
        'initial Pyright analysis',
    );
}, 90_000);

afterAll(async () => {
    await session?.dispose();
    if (root) {
        await safeRm(root);
    }
});

describe('packaged Python runtime', () => {
    it('resolves the Pyright entry point packaged with CoC', () => {
        const runtime = resolvePythonRuntime(PYTHON_PRESET, root);

        expect(runtime.origin).toBe('bundled');
        expect(runtime.command).toBe(process.execPath);
        expect(runtime.args[0]).toMatch(/[\\/]pyright[\\/]langserver\.index\.js$/);
        expect(fs.existsSync(runtime.args[0])).toBe(true);
        expect(runtime.args[1]).toBe('--stdio');
    });

    it('reaches ready without a separate Python language-server install', () => {
        const state = session.getState();

        expect(state.status).toBe('ready');
        expect(state.displayName).toBe('Python');
        expect(state.runtime).toBe('Server: packaged with CoC');
        expect(JSON.stringify(state)).not.toContain(root);
        expect(JSON.stringify(state)).not.toContain(process.execPath);
    });

    it('negotiates every shipped Python language capability', () => {
        const capabilities = session.getState().capabilities as Record<string, unknown>;
        expect(capabilities.hoverProvider).toBeTruthy();
        expect(capabilities.definitionProvider).toBeTruthy();
        expect(capabilities.referencesProvider).toBeTruthy();
        expect(capabilities.completionProvider).toBeTruthy();
        expect(capabilities.signatureHelpProvider).toBeTruthy();
        expect(capabilities.textDocumentSync).toBeDefined();
    });

    it('ships basic type checking for open files by default', () => {
        expect(PYTHON_PRESET.settings).toEqual({
            python: {
                analysis: {
                    typeCheckingMode: 'basic',
                    diagnosticMode: 'openFilesOnly',
                },
            },
        });
    });
});

describe('Python language features over packaged Pyright', () => {
    afterAll(async () => {
        changeMain(MAIN_TEXT);
        await waitForDiagnostics('main.py', (found) => found.length === 0);
    });

    it('hovers a symbol imported from another Python file', async () => {
        const result = await session.sendRequest('textDocument/hover', {
            textDocument: { uri: uriFor('main.py') },
            position: positionAt(MAIN_TEXT, 'greeter.greet', 'greeter.'.length + 2),
        });
        expect(hoverText(result)).toContain('def greet(name: str) -> str');
    });

    it('navigates across files to a stub definition', async () => {
        const result = await session.sendRequest('textDocument/definition', {
            textDocument: { uri: uriFor('main.py') },
            position: positionAt(MAIN_TEXT, 'format_message("CoC"', 2),
        });
        expect(definitionPaths(result).map(filePathKey)).toContain(fileUriKey(uriFor('typed_api.pyi')));
    });

    it('finds references across Python files', async () => {
        const result = await session.sendRequest('textDocument/references', {
            textDocument: { uri: uriFor('source.py') },
            position: positionAt(SOURCE_TEXT, 'shared_value', 2),
            context: { includeDeclaration: true },
        });
        const targets = targetUris(result).map(fileUriKey);
        expect(targets).toContain(fileUriKey(uriFor('source.py')));
        expect(targets).toContain(fileUriKey(uriFor('main.py')));
    });

    it('completes members from an unsaved buffer', async () => {
        const unsaved = MAIN_TEXT.replace('greeter.greet("CoC")', 'greeter.');
        changeMain(unsaved);
        const result = await waitForRequest(
            'textDocument/completion',
            {
                textDocument: { uri: uriFor('main.py') },
                position: positionAt(unsaved, 'greeter.', 'greeter.'.length),
                context: { triggerKind: 1 },
            },
            (candidate) => completionLabels(candidate).includes('greet'),
            'Python member completion',
        );
        expect(completionLabels(result)).toContain('greet');
        changeMain(MAIN_TEXT);
    });

    it('answers signature help for a function declared in a stub', async () => {
        const result = await waitForRequest<{
            signatures?: { label?: string }[];
            activeParameter?: number;
        } | null>(
            'textDocument/signatureHelp',
            {
                textDocument: { uri: uriFor('main.py') },
                position: positionAt(MAIN_TEXT, '2)', 1),
                context: { triggerKind: 1, isRetrigger: false },
            },
            (candidate) => candidate?.signatures?.[0]?.label?.includes('repeat: int') === true,
            'Python signature help',
        );
        expect(result?.signatures?.[0]?.label).toMatch(/\(name: str, repeat: int = (?:1|\.\.\.)\) -> str/);
        expect(result?.activeParameter).toBe(1);
    });

    it('publishes diagnostics for an unsaved type error without changing the file', async () => {
        const unsaved = MAIN_TEXT.replace('formatted =', 'formatted: int =');
        changeMain(unsaved);
        const found = await waitForDiagnostics(
            'main.py',
            (entries) => entries.some((entry) => /not assignable to declared type "int"/i.test(entry.message)),
        );
        expect(found.length).toBeGreaterThan(0);
        expect(diagnostics.has(fileUriKey(uriFor('unopened.py')))).toBe(false);
        expect(fs.readFileSync(path.join(root, 'main.py'), 'utf8')).toBe(MAIN_TEXT);
        changeMain(MAIN_TEXT);
        await waitForDiagnostics('main.py', (entries) => entries.length === 0);
    });

    it('analyzes .pyw documents and symbols that exist only in memory', async () => {
        const windowHover = await session.sendRequest('textDocument/hover', {
            textDocument: { uri: uriFor('window.pyw') },
            position: positionAt(WINDOW_TEXT, 'format_message("Window"', 2),
        });
        expect(hoverText(windowHover)).toContain('format_message');

        const unsaved = `${MAIN_TEXT}\nunsaved_only: int = 42\nprint(unsaved_only)\n`;
        changeMain(unsaved);
        const unsavedHover = await session.sendRequest('textDocument/hover', {
            textDocument: { uri: uriFor('main.py') },
            position: positionAt(unsaved, 'unsaved_only)', 2),
        });
        expect(hoverText(unsavedHover)).toContain('(variable) unsaved_only:');
        expect(fs.readFileSync(path.join(root, 'main.py'), 'utf8')).not.toContain('unsaved_only');
        changeMain(MAIN_TEXT);
    });
});

describe('Python workspace settings', () => {
    it('override preset defaults without losing unrelated settings', async () => {
        const strictRoot = fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), 'coc-lsp-python-strict-'));
        const strictText = 'def identity(value):\n    return value\n';
        fs.writeFileSync(path.join(strictRoot, 'pyproject.toml'), '[project]\nname = "strict-fixture"\nversion = "1.0.0"\n');
        fs.writeFileSync(path.join(strictRoot, 'strict.py'), strictText);
        const definition: LanguageServerDefinition = {
            ...PYTHON_PRESET,
            enabled: true,
            settings: {
                python: {
                    analysis: {
                        typeCheckingMode: 'strict',
                        diagnosticMode: 'openFilesOnly',
                        autoSearchPaths: false,
                    },
                },
                unrelated: { preserved: true },
            },
        };
        const prepared = prepareDefinitionForRoot(definition, strictRoot);
        expect(prepared.definition.settings).toEqual(definition.settings);
        const strictDiagnostics: Diagnostic[] = [];
        const strictSession = new LanguageServerSession({
            definition: prepared.definition,
            rootPath: strictRoot,
            runtimeLabel: prepared.runtimeLabel,
            commandLabel: prepared.commandLabel,
            startTimeoutMs: 45_000,
            requestTimeoutMs: 30_000,
        });
        strictSession.onNotification('textDocument/publishDiagnostics', (params) => {
            const payload = params as { diagnostics?: Diagnostic[] };
            strictDiagnostics.splice(0, strictDiagnostics.length, ...(payload.diagnostics ?? []));
        });
        try {
            await strictSession.start();
            strictSession.sendNotification('textDocument/didOpen', {
                textDocument: {
                    uri: pathToFileURL(path.join(strictRoot, 'strict.py')).href,
                    languageId: 'python',
                    version: 1,
                    text: strictText,
                },
            });
            await waitFor(
                () => strictDiagnostics.some((entry) => /type of parameter "value" is unknown/i.test(entry.message))
                    ? true
                    : undefined,
                'strict Pyright diagnostics',
            );
        } finally {
            await strictSession.dispose();
            await safeRm(strictRoot);
        }
    });
});

const hostPython = findHostPython();
const unsupportedHostReason = 'unsupported host: no Python interpreter capable of creating a virtual environment is available';

describe.skipIf(!hostPython)(`project virtual environment${hostPython ? '' : ` (${unsupportedHostReason})`}`, () => {
    const appText = 'from coc_env_only_fixture import greet\n\nmessage = greet("CoC")\n';
    let envRoot: string;
    let envPython: string;
    let packageStub: string;
    let envSession: LanguageServerSession;

    beforeAll(async () => {
        if (!hostPython) {
            return;
        }
        envRoot = fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), 'coc-lsp-python-venv-'));
        fs.writeFileSync(path.join(envRoot, 'pyproject.toml'), '[project]\nname = "coc-pyright-venv-fixture"\nversion = "1.0.0"\n');
        fs.writeFileSync(path.join(envRoot, 'main.py'), appText);

        runPython(hostPython, ['-m', 'venv', '--without-pip', '.venv'], envRoot);
        envPython = path.join(envRoot, '.venv', ...(process.platform === 'win32' ? ['Scripts', 'python.exe'] : ['bin', 'python']));
        const sitePackages = runPython(envPython, ['-c', 'import site; print(site.getsitepackages()[0])'], envRoot);
        const packageRoot = path.join(sitePackages, 'coc_env_only_fixture');
        fs.mkdirSync(packageRoot, { recursive: true });
        fs.writeFileSync(path.join(packageRoot, '__init__.py'), 'def greet(name):\n    return f"Hello, {name}"\n');
        packageStub = path.join(packageRoot, '__init__.pyi');
        fs.writeFileSync(packageStub, 'def greet(name: str) -> str: ...\n');
        fs.writeFileSync(path.join(packageRoot, 'py.typed'), '');

        const enabled: LanguageServerDefinition = { ...PYTHON_PRESET, enabled: true };
        const prepared = prepareDefinitionForRoot(enabled, envRoot);
        expect((prepared.definition.settings as { python?: { pythonPath?: string } }).python?.pythonPath).toBe(envPython);

        envSession = new LanguageServerSession({
            definition: prepared.definition,
            rootPath: envRoot,
            runtimeLabel: prepared.runtimeLabel,
            commandLabel: prepared.commandLabel,
            startTimeoutMs: 45_000,
            requestTimeoutMs: 30_000,
            idleTimeoutMs: 10 * 60_000,
        });
        await envSession.start();
        envSession.sendNotification('textDocument/didOpen', {
            textDocument: {
                uri: pathToFileURL(path.join(envRoot, 'main.py')).href,
                languageId: 'python',
                version: 1,
                text: appText,
            },
        });
    }, 180_000);

    afterAll(async () => {
        await envSession?.dispose();
        if (envRoot) {
            await safeRm(envRoot);
        }
    });

    it('uses the typed package available only in the selected environment for hover', async () => {
        expect(fs.existsSync(path.join(envRoot, 'coc_env_only_fixture'))).toBe(false);

        const result = await envSession.sendRequest('textDocument/hover', {
            textDocument: { uri: pathToFileURL(path.join(envRoot, 'main.py')).href },
            position: positionAt(appText, 'greet("CoC")', 2),
        });

        expect(hoverText(result)).toContain('(function) def greet(name: str) -> str');
    });

    it('navigates to the environment-only package stub', async () => {
        const result = await envSession.sendRequest('textDocument/definition', {
            textDocument: { uri: pathToFileURL(path.join(envRoot, 'main.py')).href },
            position: positionAt(appText, 'greet("CoC")', 2),
        });

        expect(definitionPaths(result).map((candidate) => fs.realpathSync.native(candidate)))
            .toContain(fs.realpathSync.native(packageStub));
    });
});
