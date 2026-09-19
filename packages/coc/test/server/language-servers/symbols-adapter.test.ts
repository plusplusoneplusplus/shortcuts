/**
 * Runtime preparation for the bundled symbol index server: which executable
 * runs, which index it opens, and what stays out of a browser payload.
 */

import * as path from 'path';
import { describe, expect, it } from 'vitest';
import { prepareDefinitionForRoot, resolveDefinitionRoot } from '../../../src/server/language-servers/adapters';
import { CLANGD_PRESET, COC_SYMBOLS_PRESET } from '../../../src/server/language-servers/presets';
import {
    SYMBOLS_LSP_BUILD_COMMAND,
    resolveSymbolsRuntime,
    symbolIndexDatabasePath,
} from '../../../src/server/language-servers/symbols-adapter';
import type { LanguageServerDefinition } from '../../../src/server/language-servers/types';

const BINARY = path.join('/opt', 'coc', 'coc-symbols-lsp.linux-x64-gnu');
const DATA_DIR = path.join('/var', 'coc-data');
const WORKSPACE_ID = 'repo-42';

function preset(overrides: Partial<LanguageServerDefinition> = {}): LanguageServerDefinition {
    return { ...COC_SYMBOLS_PRESET, ...overrides };
}

function deps(overrides: Record<string, unknown> = {}) {
    return {
        dataDir: DATA_DIR,
        workspaceId: WORKSPACE_ID,
        resolveSymbolsLspBinary: () => BINARY,
        ...overrides,
    };
}

describe('resolveSymbolsRuntime', () => {
    it('runs the bundled binary against this workspace\'s index', () => {
        const runtime = resolveSymbolsRuntime(preset(), deps());

        expect(runtime).toEqual({
            command: BINARY,
            args: ['--database', symbolIndexDatabasePath(DATA_DIR, WORKSPACE_ID)],
            origin: 'bundled',
            label: 'Server: bundled with CoC',
        });
    });

    it('reuses the index the HTTP lane built, under the repo data directory', () => {
        expect(symbolIndexDatabasePath(DATA_DIR, WORKSPACE_ID)).toBe(
            path.join(DATA_DIR, 'repos', WORKSPACE_ID, 'symbol-index.sqlite'),
        );
    });

    it('keeps the host path out of every user-facing label', () => {
        const runtime = resolveSymbolsRuntime(preset(), deps());

        expect(runtime.label).not.toContain(BINARY);
        expect(runtime.label).not.toContain(DATA_DIR);
    });

    it('lets a workspace argument override the database, since the last one wins', () => {
        const runtime = resolveSymbolsRuntime(
            preset({ args: ['--database', '/tmp/custom.sqlite'] }),
            deps(),
        );

        expect(runtime.args).toEqual([
            '--database',
            symbolIndexDatabasePath(DATA_DIR, WORKSPACE_ID),
            '--database',
            '/tmp/custom.sqlite',
        ]);
    });

    it('omits the database when no workspace is known, leaving the server its own default', () => {
        expect(resolveSymbolsRuntime(preset(), deps({ workspaceId: undefined })).args).toEqual([]);
        expect(resolveSymbolsRuntime(preset(), deps({ dataDir: undefined })).args).toEqual([]);
    });

    it('reports a buildable recovery instead of a searched directory when the binary is missing', () => {
        const runtime = resolveSymbolsRuntime(preset(), deps({ resolveSymbolsLspBinary: () => undefined }));

        expect(runtime.origin).toBe('unavailable');
        expect(runtime.command).toBe('coc-symbols-lsp');
        expect(runtime.recoveryCommand).toBe(SYMBOLS_LSP_BUILD_COMMAND);
        expect(runtime.notes?.join(' ')).not.toContain(path.sep + 'opt');
    });
});

describe('prepareDefinitionForRoot for the symbol index', () => {
    it('applies the bundled runtime and labels the command by name only', () => {
        const prepared = prepareDefinitionForRoot(preset(), '/work/repo', deps());

        expect(prepared.definition.command).toBe(BINARY);
        expect(prepared.definition.args).toEqual([
            '--database',
            symbolIndexDatabasePath(DATA_DIR, WORKSPACE_ID),
        ]);
        expect(prepared.commandLabel).toBe('coc-symbols-lsp');
        expect(prepared.runtimeLabel).toBe('Server: bundled with CoC');
    });

    it('leaves a preset repointed at another executable alone', () => {
        const repointed = preset({ command: '/usr/local/bin/other-lsp' });
        const prepared = prepareDefinitionForRoot(repointed, '/work/repo', deps());

        expect(prepared.definition).toBe(repointed);
        expect(prepared.commandLabel).toBeUndefined();
    });

    it('does not claim clangd, which keeps its own runtime discovery', () => {
        const prepared = prepareDefinitionForRoot(
            { ...CLANGD_PRESET, enabled: true },
            '/work/repo',
            deps({ resolveOnPath: () => '/usr/bin/clangd' }),
        );

        expect(prepared.definition.command).toBe('/usr/bin/clangd');
        expect(prepared.commandLabel).toBe('clangd');
    });
});

describe('resolveDefinitionRoot for the symbol index', () => {
    it('always resolves the workspace root, so one index serves the whole repo', () => {
        const workspaceRoot = path.resolve('/work/repo');
        const root = resolveDefinitionRoot(
            preset(),
            workspaceRoot,
            path.join('nested', 'deep', 'main.cpp'),
            { ...deps(), exists: () => true },
        );

        expect(root).toBe(workspaceRoot);
    });
});
