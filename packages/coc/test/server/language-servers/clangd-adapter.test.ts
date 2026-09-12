import * as path from 'path';
import { describe, expect, it } from 'vitest';
import { prepareDefinitionForRoot, resolveDefinitionRoot } from '../../../src/server/language-servers/adapters';
import { resolveClangdRuntime } from '../../../src/server/language-servers/clangd-adapter';
import { CLANGD_PRESET } from '../../../src/server/language-servers/presets';
import type { LanguageServerDefinition } from '../../../src/server/language-servers/types';

function preset(overrides: Partial<LanguageServerDefinition> = {}): LanguageServerDefinition {
    return { ...CLANGD_PRESET, enabled: true, ...overrides };
}

describe('resolveClangdRuntime', () => {
    it('prefers a PATHEXT-aware PATH resolution over well-known locations', () => {
        const executable = 'C:\\tools\\clangd.exe';
        const runtime = resolveClangdRuntime(preset(), {
            platform: 'win32',
            env: { ProgramFiles: 'C:\\Program Files' },
            resolveOnPath: () => executable,
            isExecutable: () => true,
        });

        expect(runtime).toEqual({
            command: executable,
            args: ['--background-index=false'],
            origin: 'path',
            label: 'Server: system PATH',
        });
        expect(runtime.label).not.toContain(executable);
    });

    it.each([
        {
            platform: 'darwin' as const,
            env: {},
            expected: '/opt/homebrew/opt/llvm/bin/clangd',
            readDir: () => [],
        },
        {
            platform: 'linux' as const,
            env: {},
            expected: '/usr/lib/llvm-19/bin/clangd',
            readDir: () => ['llvm-17', 'llvm-19', 'unrelated'],
        },
        {
            platform: 'win32' as const,
            env: { ProgramFiles: 'C:\\Program Files' },
            expected: 'C:\\Program Files\\LLVM\\bin\\clangd.exe',
            readDir: () => [],
        },
    ])('finds a $platform well-known installation', ({ platform, env, expected, readDir }) => {
        const runtime = resolveClangdRuntime(preset(), {
            platform,
            env,
            readDir,
            resolveOnPath: () => undefined,
            isExecutable: candidate => candidate === expected,
        });

        expect(runtime.command).toBe(expected);
        expect(runtime.origin).toBe('well-known');
        expect(runtime.label).toBe('Server: system installation');
        expect(runtime.label).not.toContain(expected);
    });

    it('keeps the executable label when clangd is unavailable', () => {
        expect(resolveClangdRuntime(preset(), {
            platform: 'linux',
            readDir: () => { throw new Error('EACCES'); },
            resolveOnPath: () => undefined,
            isExecutable: () => false,
        })).toEqual({
            command: 'clangd',
            args: ['--background-index=false'],
            origin: 'unavailable',
            label: 'Server: unavailable',
        });
    });
});

describe('clangd adapter wiring', () => {
    it('selects the nearest clangd root marker', () => {
        const workspace = path.resolve(path.sep, 'repo');
        const component = path.join(workspace, 'components', 'renderer');
        const marker = path.join(component, 'compile_commands.json');

        expect(resolveDefinitionRoot(
            preset(),
            workspace,
            'components/renderer/src/main.cpp',
            { exists: candidate => candidate === marker },
        )).toBe(component);
    });

    it('prepares clangd while keeping host paths out of browser-safe labels', () => {
        const executable = path.resolve(path.sep, 'tools', 'clangd');
        const prepared = prepareDefinitionForRoot(preset(), path.resolve(path.sep, 'repo'), {
            resolveOnPath: () => executable,
        });

        expect(prepared.definition.command).toBe(executable);
        expect(prepared.runtimeLabel).toBe('Server: system PATH');
        expect(prepared.commandLabel).toBe('clangd');
        expect(JSON.stringify({
            runtimeLabel: prepared.runtimeLabel,
            commandLabel: prepared.commandLabel,
        })).not.toContain(executable);
    });

    it('preserves user-supplied fallback flags and compile database arguments', () => {
        const initializationOptions = {
            fallbackFlags: ['--driver-mode=cl', '/std:c++20', '/I<MSVC include>', '/DUNICODE'],
        };
        const prepared = prepareDefinitionForRoot(preset({
            args: ['--background-index=false', '--compile-commands-dir=/repo-data/build'],
            initializationOptions,
        }), path.resolve(path.sep, 'repo'), {
            resolveOnPath: () => path.resolve(path.sep, 'tools', 'clangd'),
        });

        expect(prepared.definition.args).toEqual([
            '--background-index=false',
            '--compile-commands-dir=/repo-data/build',
        ]);
        expect(prepared.definition.initializationOptions).toBe(initializationOptions);
    });

    it('leaves a workspace-repointed clangd definition untouched', () => {
        const repointed = preset({ command: path.resolve(path.sep, 'custom', 'clangd') });
        const prepared = prepareDefinitionForRoot(repointed, path.resolve(path.sep, 'repo'), {
            resolveOnPath: () => path.resolve(path.sep, 'other', 'clangd'),
        });

        expect(prepared).toEqual({ definition: repointed });
        expect(prepared.definition).toBe(repointed);
    });
});
