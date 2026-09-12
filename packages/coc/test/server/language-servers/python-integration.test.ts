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

interface HostPython {
    command: string;
    args: string[];
}

interface Position {
    line: number;
    character: number;
}

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

beforeAll(async () => {
    root = fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), 'coc-lsp-python-'));
    fs.writeFileSync(path.join(root, 'pyproject.toml'), '[project]\nname = "coc-pyright-fixture"\nversion = "1.0.0"\n');
    fs.writeFileSync(path.join(root, 'main.py'), 'message: str = "ready"\n');

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
    await session.start();
}, 60_000);

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
