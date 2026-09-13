import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { pathToFileURL } from 'url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prepareDefinitionForRoot } from '../../../src/server/language-servers/adapters';
import { resolveClangdRuntime } from '../../../src/server/language-servers/clangd-adapter';
import { CLANGD_PRESET } from '../../../src/server/language-servers/presets';
import { LanguageServerSession } from '../../../src/server/language-servers/session';
import type { LanguageServerDefinition } from '../../../src/server/language-servers/types';
import { safeRm } from '../../helpers/safe-rm';

interface Diagnostic {
    message: string;
}

const SOURCE = `#include <vector>

int answer() {
    return std::vector<int>{42}.front();
}

int main() {
    return answer();
}
`;
const BROKEN_SOURCE = SOURCE.replace('return answer();', 'return ; broken');
const discoveredRuntime = resolveClangdRuntime(CLANGD_PRESET);
const describeWithClangd = discoveredRuntime.origin === 'unavailable' ? describe.skip : describe;
let root: string;
let session: LanguageServerSession;
let diagnostics: Diagnostic[] = [];
let receivedDiagnostics = false;

function fallbackFlags(): string[] {
    const configured = process.env.COC_CLANGD_TEST_FALLBACK_FLAGS;
    if (!configured) {
        return ['-std=c++17'];
    }
    const parsed: unknown = JSON.parse(configured);
    if (!Array.isArray(parsed) || !parsed.every(flag => typeof flag === 'string')) {
        throw new Error('COC_CLANGD_TEST_FALLBACK_FLAGS must be a JSON string array');
    }
    return parsed;
}

function positionAt(text: string, marker: string): { line: number; character: number } {
    const target = text.indexOf(marker);
    const before = text.slice(0, target);
    return {
        line: before.split('\n').length - 1,
        character: target - (before.lastIndexOf('\n') + 1),
    };
}

async function waitFor(
    check: () => boolean,
    description: string,
    timeoutMs = 30_000,
): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (!check()) {
        if (Date.now() > deadline) {
            throw new Error(`Timed out waiting for ${description}`);
        }
        await new Promise(resolve => setTimeout(resolve, 100));
    }
}

describeWithClangd('real clangd runtime', () => {
    beforeAll(async () => {
        root = fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), 'coc-lsp-clangd-'));
        fs.writeFileSync(path.join(root, '.clangd'), '{}\n');
        fs.writeFileSync(path.join(root, 'main.cpp'), SOURCE);
        const enabled: LanguageServerDefinition = {
            ...CLANGD_PRESET,
            enabled: true,
            initializationOptions: { fallbackFlags: fallbackFlags() },
        };
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
        session.onNotification('textDocument/publishDiagnostics', params => {
            receivedDiagnostics = true;
            diagnostics = (params as { diagnostics?: Diagnostic[] }).diagnostics ?? [];
        });
        await session.start();
        session.sendNotification('textDocument/didOpen', {
            textDocument: {
                uri: pathToFileURL(path.join(root, 'main.cpp')).href,
                languageId: 'cpp',
                version: 1,
                text: SOURCE,
            },
        });
    }, 60_000);

    afterAll(async () => {
        await session?.dispose();
        if (root) {
            await safeRm(root);
        }
    });

    it('provides hover and same-file definition without background indexing', async () => {
        const uri = pathToFileURL(path.join(root, 'main.cpp')).href;
        await waitFor(() => receivedDiagnostics, 'initial clangd diagnostics');
        expect(diagnostics).toEqual([]);
        const hover = await session.sendRequest('textDocument/hover', {
            textDocument: { uri },
            position: positionAt(SOURCE, 'answer();'),
        });
        const definition = await session.sendRequest('textDocument/definition', {
            textDocument: { uri },
            position: positionAt(SOURCE, 'answer();'),
        });

        expect(JSON.stringify(hover)).toContain('answer');
        expect(JSON.stringify(definition)).toContain('main.cpp');
        expect(session.getState().status).toBe('ready');
    });

    it('publishes diagnostics for an invalid open buffer', async () => {
        diagnostics = [];
        session.sendNotification('textDocument/didChange', {
            textDocument: {
                uri: pathToFileURL(path.join(root, 'main.cpp')).href,
                version: 2,
            },
            contentChanges: [{ text: BROKEN_SOURCE }],
        });
        await waitFor(() => diagnostics.length > 0, 'clangd diagnostics');
        expect(diagnostics.some(diagnostic => diagnostic.message.length > 0)).toBe(true);
    });

    it('uses an in-tree compilation database instead of fallback flags', async () => {
        const databaseRoot = fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), 'coc-lsp-clangd-db-'));
        const source = `#ifndef FROM_DATABASE
#error compilation database was ignored
#endif
#ifdef FROM_FALLBACK
#error fallback flags overrode the compilation database
#endif
int main() { return 0; }
`;
        const file = path.join(databaseRoot, 'main.cpp');
        fs.writeFileSync(file, source);
        fs.writeFileSync(path.join(databaseRoot, 'compile_commands.json'), JSON.stringify([{
            directory: databaseRoot,
            file,
            arguments: ['clang++', '-DFROM_DATABASE', '-std=c++17', '-c', file],
        }]));
        const enabled: LanguageServerDefinition = {
            ...CLANGD_PRESET,
            enabled: true,
            initializationOptions: { fallbackFlags: ['-DFROM_FALLBACK'] },
        };
        const prepared = prepareDefinitionForRoot(enabled, databaseRoot);
        const databaseSession = new LanguageServerSession({
            definition: prepared.definition,
            rootPath: databaseRoot,
            runtimeLabel: prepared.runtimeLabel,
            commandLabel: prepared.commandLabel,
            startTimeoutMs: 45_000,
            requestTimeoutMs: 30_000,
        });
        let receivedDiagnostics = false;
        let databaseDiagnostics: Diagnostic[] = [];
        databaseSession.onNotification('textDocument/publishDiagnostics', params => {
            receivedDiagnostics = true;
            databaseDiagnostics = (params as { diagnostics?: Diagnostic[] }).diagnostics ?? [];
        });

        try {
            await databaseSession.start();
            databaseSession.sendNotification('textDocument/didOpen', {
                textDocument: {
                    uri: pathToFileURL(file).href,
                    languageId: 'cpp',
                    version: 1,
                    text: source,
                },
            });
            await waitFor(() => receivedDiagnostics, 'clangd compilation database diagnostics');
            expect(databaseDiagnostics).toEqual([]);
        } finally {
            await databaseSession.dispose();
            await safeRm(databaseRoot);
        }
    });
});
