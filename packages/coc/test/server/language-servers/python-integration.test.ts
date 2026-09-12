/**
 * Real packaged-Pyright coverage. This suite intentionally fails when the
 * production dependency or its JavaScript language-server entry point is
 * missing.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { prepareDefinitionForRoot } from '../../../src/server/language-servers/adapters';
import { resolvePythonRuntime } from '../../../src/server/language-servers/python-adapter';
import { PYTHON_PRESET } from '../../../src/server/language-servers/presets';
import { LanguageServerSession } from '../../../src/server/language-servers/session';
import type { LanguageServerDefinition } from '../../../src/server/language-servers/types';
import { safeRm } from '../../helpers/safe-rm';

let root: string;
let session: LanguageServerSession;

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
