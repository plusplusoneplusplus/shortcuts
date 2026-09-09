import { describe, expect, it } from 'vitest';
import * as path from 'path';
import {
    MIN_WORKSPACE_TYPESCRIPT_VERSION,
    applyTypeScriptRuntime,
    isAtLeast,
    resolveTypeScriptRuntime,
} from '../../../src/server/language-servers/typescript-adapter';
import { prepareDefinitionForRoot } from '../../../src/server/language-servers/adapters';
import { TYPESCRIPT_PRESET } from '../../../src/server/language-servers/presets';
import type { LanguageServerDefinition } from '../../../src/server/language-servers/types';

const NODE = path.join(path.sep, 'usr', 'bin', 'node');

/** Absolute path in the shape of the current platform. */
function abs(...segments: string[]): string {
    return path.resolve(path.sep, ...segments);
}

/** Fake filesystem: an existence check over a fixed set of files. */
function fakeFs(files: Record<string, unknown>) {
    const present = new Set(Object.keys(files));
    return {
        exists: (candidate: string) => present.has(candidate),
        readJson: (file: string) => files[file],
        nodePath: NODE,
    };
}

function preset(overrides: Partial<LanguageServerDefinition> = {}): LanguageServerDefinition {
    return { ...TYPESCRIPT_PRESET, enabled: true, ...overrides };
}

const workspaceRoot = abs('repos', 'app');
const nestedRoot = path.join(workspaceRoot, 'packages', 'web');
const workspaceCli = path.join(workspaceRoot, 'node_modules', 'typescript-language-server', 'lib', 'cli.mjs');
const workspaceTsManifest = path.join(workspaceRoot, 'node_modules', 'typescript', 'package.json');
const workspaceTsserver = path.join(workspaceRoot, 'node_modules', 'typescript', 'lib', 'tsserver.js');
const bundledTsManifest = abs('opt', 'coc', 'node_modules', 'typescript', 'package.json');
const bundledTsserver = abs('opt', 'coc', 'node_modules', 'typescript', 'lib', 'tsserver.js');
const bundledCli = abs('opt', 'coc', 'node_modules', 'typescript-language-server', 'lib', 'cli.mjs');

describe('resolveTypeScriptRuntime', () => {
    it('runs the workspace language server through node and prefers the workspace TypeScript', () => {
        const fs = fakeFs({
            [workspaceCli]: undefined,
            [workspaceTsManifest]: { version: '5.9.2' },
            [workspaceTsserver]: undefined,
        });
        const runtime = resolveTypeScriptRuntime(preset(), workspaceRoot, {
            ...fs,
            resolveBundled: () => undefined,
        });

        expect(runtime.server).toBe('workspace');
        expect(runtime.command).toBe(NODE);
        expect(runtime.args).toEqual([workspaceCli, '--stdio']);
        expect(runtime.typescript).toBe('workspace');
        expect(runtime.typescriptVersion).toBe('5.9.2');
        expect(runtime.tsserverPath).toBe(workspaceTsserver);
        expect(runtime.label).toBe('Server: workspace · TypeScript 5.9.2: workspace');
        expect(runtime.notes).toEqual([]);
    });

    it('finds an installation above the project root, so a monorepo package uses the hoisted copy', () => {
        const fs = fakeFs({
            [workspaceCli]: undefined,
            [workspaceTsManifest]: { version: '5.6.0' },
            [workspaceTsserver]: undefined,
        });
        const runtime = resolveTypeScriptRuntime(preset(), nestedRoot, {
            ...fs,
            resolveBundled: () => undefined,
        });

        expect(runtime.args[0]).toBe(workspaceCli);
        expect(runtime.tsserverPath).toBe(workspaceTsserver);
    });

    it('falls back to the packaged language server when the workspace has none', () => {
        const fs = fakeFs({
            [bundledCli]: undefined,
            [bundledTsManifest]: { version: '5.4.0' },
            [bundledTsserver]: undefined,
        });
        const runtime = resolveTypeScriptRuntime(preset(), workspaceRoot, {
            ...fs,
            resolveBundled: (specifier) =>
                specifier === 'typescript/package.json' ? bundledTsManifest : bundledCli,
        });

        expect(runtime.server).toBe('bundled');
        expect(runtime.command).toBe(NODE);
        expect(runtime.args).toEqual([bundledCli, '--stdio']);
        expect(runtime.typescript).toBe('bundled');
        expect(runtime.label).toBe('Server: packaged with CoC · TypeScript 5.4.0: packaged with CoC');
    });

    it('keeps the configured executable when nothing is installed on this host', () => {
        const runtime = resolveTypeScriptRuntime(preset(), workspaceRoot, {
            ...fakeFs({}),
            resolveBundled: () => undefined,
        });

        expect(runtime.server).toBe('path');
        expect(runtime.command).toBe('typescript-language-server');
        expect(runtime.args).toEqual(['--stdio']);
        expect(runtime.typescript).toBe('server-default');
        expect(runtime.tsserverPath).toBeUndefined();
        expect(runtime.label).toBe('Server: system PATH · TypeScript: chosen by the server');
    });

    it('rejects a workspace TypeScript older than the supported minimum and says why', () => {
        const fs = fakeFs({
            [workspaceTsManifest]: { version: '3.9.10' },
            [workspaceTsserver]: undefined,
            [bundledTsManifest]: { version: '5.9.2' },
            [bundledTsserver]: undefined,
        });
        const runtime = resolveTypeScriptRuntime(preset(), workspaceRoot, {
            ...fs,
            resolveBundled: (specifier) =>
                specifier === 'typescript/package.json' ? bundledTsManifest : undefined,
        });

        expect(runtime.typescript).toBe('bundled');
        expect(runtime.typescriptVersion).toBe('5.9.2');
        expect(runtime.notes).toEqual([
            `Workspace TypeScript 3.9.10 is older than ${MIN_WORKSPACE_TYPESCRIPT_VERSION}. ` +
                'Using the TypeScript packaged with CoC (5.9.2).',
        ]);
    });

    it('skips a workspace TypeScript whose tsserver is missing', () => {
        const fs = fakeFs({
            [workspaceTsManifest]: { version: '5.9.2' },
            [bundledTsManifest]: { version: '5.4.0' },
            [bundledTsserver]: undefined,
        });
        const runtime = resolveTypeScriptRuntime(preset(), workspaceRoot, {
            ...fs,
            resolveBundled: (specifier) =>
                specifier === 'typescript/package.json' ? bundledTsManifest : undefined,
        });

        expect(runtime.typescript).toBe('bundled');
        expect(runtime.notes[0]).toContain('has no tsserver');
    });

    it('treats an unreadable manifest as an unknown version rather than an old one', () => {
        const fs = fakeFs({
            [workspaceTsManifest]: 'not json',
            [workspaceTsserver]: undefined,
        });
        const runtime = resolveTypeScriptRuntime(preset(), workspaceRoot, {
            ...fs,
            resolveBundled: () => undefined,
        });

        expect(runtime.typescript).toBe('workspace');
        expect(runtime.typescriptVersion).toBeUndefined();
        expect(runtime.label).toBe('Server: system PATH · TypeScript: workspace');
    });

    it('accepts a prerelease of the minimum version', () => {
        expect(isAtLeast('4.8.0-beta', MIN_WORKSPACE_TYPESCRIPT_VERSION)).toBe(true);
        expect(isAtLeast('4.7.4', MIN_WORKSPACE_TYPESCRIPT_VERSION)).toBe(false);
        expect(isAtLeast('10.0.0', '9.9.9')).toBe(true);
        expect(isAtLeast('5', '4.8.0')).toBe(true);
    });
});

describe('applyTypeScriptRuntime', () => {
    const runtime = {
        command: NODE,
        args: [workspaceCli, '--stdio'],
        server: 'workspace' as const,
        typescript: 'workspace' as const,
        typescriptVersion: '5.9.2',
        tsserverPath: workspaceTsserver,
        label: 'label',
        notes: [],
    };

    it('points the server at the resolved tsserver while keeping other options', () => {
        const applied = applyTypeScriptRuntime(
            preset({ initializationOptions: { preferences: { includeCompletionsForModuleExports: true } } }),
            runtime,
        );

        expect(applied.command).toBe(NODE);
        expect(applied.args).toEqual([workspaceCli, '--stdio']);
        expect(applied.initializationOptions).toEqual({
            preferences: { includeCompletionsForModuleExports: true },
            tsserver: { path: workspaceTsserver },
        });
    });

    it('leaves a tsserver path the user configured alone', () => {
        const applied = applyTypeScriptRuntime(
            preset({ initializationOptions: { tsserver: { path: '/custom/tsserver.js', logVerbosity: 'off' } } }),
            runtime,
        );

        expect(applied.initializationOptions).toEqual({
            tsserver: { path: '/custom/tsserver.js', logVerbosity: 'off' },
        });
    });

    it('does not rewrite initialization options that are not an object', () => {
        const applied = applyTypeScriptRuntime(preset({ initializationOptions: ['raw'] }), runtime);

        expect(applied.initializationOptions).toEqual(['raw']);
    });

    it('adds nothing when no tsserver was resolved', () => {
        const applied = applyTypeScriptRuntime(preset(), { ...runtime, tsserverPath: undefined });

        expect(applied.initializationOptions).toBeUndefined();
    });
});

describe('prepareDefinitionForRoot', () => {
    const fs = fakeFs({
        [workspaceCli]: undefined,
        [workspaceTsManifest]: { version: '5.9.2' },
        [workspaceTsserver]: undefined,
    });
    const deps = { ...fs, resolveBundled: () => undefined };

    it('resolves the TypeScript preset and reports the runtime without host paths', () => {
        const prepared = prepareDefinitionForRoot(preset(), workspaceRoot, deps);

        expect(prepared.definition.command).toBe(NODE);
        expect(prepared.runtimeLabel).toBe('Server: workspace · TypeScript 5.9.2: workspace');
        expect(prepared.commandLabel).toBe('typescript-language-server');
        expect(prepared.notes).toEqual([]);
    });

    it('leaves a preset the user repointed at another executable untouched', () => {
        const repointed = preset({ command: '/opt/tools/tsls', args: ['--stdio'] });
        const prepared = prepareDefinitionForRoot(repointed, workspaceRoot, deps);

        expect(prepared.definition).toBe(repointed);
        expect(prepared.runtimeLabel).toBeUndefined();
    });

    it('claims nothing for a custom definition that borrows the preset command', () => {
        const custom: LanguageServerDefinition = {
            ...preset(),
            id: 'my-typescript',
            builtIn: false,
        };
        const prepared = prepareDefinitionForRoot(custom, workspaceRoot, deps);

        expect(prepared.definition).toBe(custom);
        expect(prepared.runtimeLabel).toBeUndefined();
    });

    it('leaves an unrelated definition alone', () => {
        const other: LanguageServerDefinition = {
            id: 'python',
            displayName: 'Python',
            languageIds: ['python'],
            filePatterns: ['**/*.py'],
            command: 'pylsp',
            args: [],
            rootMarkers: ['pyproject.toml'],
            builtIn: true,
            enabled: true,
        };
        const prepared = prepareDefinitionForRoot(other, workspaceRoot, deps);

        expect(prepared.definition).toBe(other);
    });
});
