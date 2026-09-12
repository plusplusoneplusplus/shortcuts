import { describe, expect, it } from 'vitest';
import * as path from 'path';
import { prepareDefinitionForRoot } from '../../../src/server/language-servers/adapters';
import {
    applyPythonRuntime,
    resolvePythonInterpreter,
    resolvePythonRuntime,
    resolvePythonServerRoot,
} from '../../../src/server/language-servers/python-adapter';
import { PYTHON_PRESET } from '../../../src/server/language-servers/presets';
import type { LanguageServerDefinition } from '../../../src/server/language-servers/types';

function preset(overrides: Partial<LanguageServerDefinition> = {}): LanguageServerDefinition {
    return { ...PYTHON_PRESET, enabled: true, ...overrides };
}

describe('resolvePythonRuntime', () => {
    it('resolves the real Pyright entry point packaged with CoC', () => {
        const runtime = resolvePythonRuntime(preset(), path.resolve('/project-without-pyright'), {
            exists: () => false,
            resolveOnPath: () => undefined,
        });

        expect(runtime.origin).toBe('bundled');
        expect(runtime.command).toBe(process.execPath);
        expect(runtime.args[0]).toMatch(/[\\/]pyright[\\/]langserver\.index\.js$/);
        expect(runtime.args[1]).toBe('--stdio');
    });

    it.each([
        {
            name: 'POSIX',
            pathApi: path.posix,
            root: '/repos/app/packages/api',
            server: '/repos/app/node_modules/pyright/langserver.index.js',
            node: '/usr/bin/node',
        },
        {
            name: 'Windows',
            pathApi: path.win32,
            root: 'C:\\repos\\app\\packages\\api',
            server: 'C:\\repos\\app\\node_modules\\pyright\\langserver.index.js',
            node: 'C:\\Program Files\\nodejs\\node.exe',
        },
    ])('prefers a $name project installation and bypasses npm shell shims', ({ pathApi, root, server, node }) => {
        const runtime = resolvePythonRuntime(preset(), root, {
            pathApi,
            nodePath: node,
            exists: candidate => candidate === server,
            resolveBundled: () => undefined,
            resolveOnPath: () => undefined,
        });

        expect(runtime).toEqual({
            command: node,
            args: [server, '--stdio'],
            origin: 'project',
            label: 'Server: project',
        });
    });

    it('falls back to the Pyright entry point packaged with CoC', () => {
        const bundled = '/opt/coc/node_modules/pyright/langserver.index.js';
        const runtime = resolvePythonRuntime(preset(), '/repos/app', {
            nodePath: '/usr/bin/node',
            exists: () => false,
            resolveBundled: specifier => specifier === 'pyright/langserver.index.js' ? bundled : undefined,
            resolveOnPath: () => undefined,
        });

        expect(runtime.command).toBe('/usr/bin/node');
        expect(runtime.args).toEqual([bundled, '--stdio']);
        expect(runtime.origin).toBe('bundled');
        expect(runtime.label).toBe('Server: packaged with CoC');
    });

    it.each([
        '/usr/local/bin/pyright-langserver',
        '/Applications/Pyright/bin/pyright-langserver',
        'C:\\Python\\Scripts\\pyright-langserver.exe',
    ])('uses a PATH executable without exposing its path in the label: %s', executable => {
        const runtime = resolvePythonRuntime(preset(), path.parse(executable).root || '/', {
            exists: () => false,
            resolveBundled: () => undefined,
            resolveOnPath: () => executable,
        });

        expect(runtime.command).toBe(executable);
        expect(runtime.args).toEqual(['--stdio']);
        expect(runtime.origin).toBe('path');
        expect(runtime.label).toBe('Server: system PATH');
        expect(runtime.label).not.toContain(executable);
    });

    it('keeps the configured command for the session to report as unavailable', () => {
        const runtime = resolvePythonRuntime(preset(), '/repos/app', {
            exists: () => false,
            resolveBundled: () => undefined,
            resolveOnPath: () => undefined,
        });

        expect(runtime).toMatchObject({
            command: 'pyright-langserver',
            args: ['--stdio'],
            origin: 'unavailable',
            label: 'Server: unavailable',
        });
    });
});

describe('applyPythonRuntime', () => {
    it('replaces only the process command and arguments', () => {
        const definition = preset({ settings: { python: { analysis: { typeCheckingMode: 'strict' } } } });
        const applied = applyPythonRuntime(definition, {
            command: '/usr/bin/node',
            args: ['/opt/coc/pyright/langserver.index.js', '--stdio'],
            origin: 'bundled',
            label: 'Server: packaged with CoC',
        });

        expect(applied.command).toBe('/usr/bin/node');
        expect(applied.args[0]).toContain('langserver.index.js');
        expect(applied.settings).toEqual({ python: { analysis: { typeCheckingMode: 'strict' } } });
    });

    it('preserves explicit interpreter and unrelated settings', () => {
        const definition = preset({
            settings: {
                python: {
                    pythonPath: '/explicit/python',
                    analysis: { typeCheckingMode: 'strict' },
                },
                unrelated: { enabled: true },
            },
        });
        const applied = applyPythonRuntime(definition, {
            command: '/usr/bin/node',
            args: ['/opt/coc/pyright/langserver.index.js', '--stdio'],
            origin: 'bundled',
            label: 'Server: packaged with CoC',
        }, '/repo', {
            isExecutable: () => true,
        });

        expect(applied.settings).toEqual(definition.settings);
    });

    it('fills only a missing pythonPath from the project environment', () => {
        const root = path.resolve('/repo');
        const interpreter = path.join(root, '.venv', 'bin', 'python');
        const definition = preset({
            settings: {
                python: { analysis: { typeCheckingMode: 'basic' } },
                unrelated: { enabled: true },
            },
        });
        const applied = applyPythonRuntime(definition, {
            command: '/usr/bin/node',
            args: ['/opt/coc/pyright/langserver.index.js', '--stdio'],
            origin: 'bundled',
            label: 'Server: packaged with CoC',
        }, root, {
            isExecutable: candidate => candidate === interpreter,
        });

        expect(applied.settings).toEqual({
            python: {
                analysis: { typeCheckingMode: 'basic' },
                pythonPath: interpreter,
            },
            unrelated: { enabled: true },
        });
    });
});

describe('resolvePythonServerRoot', () => {
    it.each(PYTHON_PRESET.rootMarkers)('uses the nearest %s marker', marker => {
        const root = path.resolve('/repo with spaces/\u9879\u76ee');
        const project = path.join(root, 'packages', 'api');
        const resolved = resolvePythonServerRoot(
            PYTHON_PRESET,
            root,
            path.join('packages', 'api', 'src', 'main.py'),
            {
                exists: candidate => candidate === path.join(project, marker)
                    || candidate === path.join(root, 'pyproject.toml'),
                realpath: candidate => candidate,
            },
        );

        expect(resolved).toBe(project);
    });

    it('falls back to the workspace and refuses traversal outside it', () => {
        const root = path.resolve('/repo');
        expect(resolvePythonServerRoot(PYTHON_PRESET, root, 'src/main.py', {
            exists: () => false,
            realpath: candidate => candidate,
        })).toBe(root);
        expect(resolvePythonServerRoot(PYTHON_PRESET, root, '../outside/main.py', {
            exists: () => true,
            realpath: candidate => candidate,
        })).toBe(root);
    });

    it('handles Windows separators and case-insensitive containment', () => {
        const root = 'C:\\Repos\\App';
        const project = 'C:\\Repos\\App\\packages\\api';
        const resolved = resolvePythonServerRoot(
            PYTHON_PRESET,
            root,
            'packages\\api\\src\\main.py',
            {
                pathApi: path.win32,
                exists: candidate => candidate.toLowerCase() === `${project}\\pyproject.toml`.toLowerCase(),
                realpath: candidate => candidate.replace('C:\\Repos\\App', 'c:\\repos\\app'),
            },
        );

        expect(resolved.toLowerCase()).toBe(project.toLowerCase());
    });

    it('supports symlink and real-path workspace spellings without escaping either root', () => {
        const realRoot = path.resolve('/private/repo');
        const linkedRoot = path.resolve('/repo-link');
        const linkedProject = path.join(linkedRoot, 'packages', 'api');
        const realProject = path.join(realRoot, 'packages', 'api');
        const realpath = (candidate: string): string => candidate.replace(linkedRoot, realRoot);

        const linked = resolvePythonServerRoot(
            PYTHON_PRESET,
            linkedRoot,
            'packages/api/src/main.py',
            {
                exists: candidate => candidate === path.join(linkedProject, 'pyproject.toml'),
                realpath,
            },
        );
        const direct = resolvePythonServerRoot(
            PYTHON_PRESET,
            realRoot,
            'packages/api/src/main.py',
            {
                exists: candidate => candidate === path.join(realProject, 'pyproject.toml'),
                realpath,
            },
        );

        expect(linked).toBe(linkedProject);
        expect(direct).toBe(realProject);
    });

    it('rejects a project directory whose symlink resolves outside the workspace', () => {
        const root = path.resolve('/repo');
        const linkedProject = path.join(root, 'linked-project');
        const resolved = resolvePythonServerRoot(
            PYTHON_PRESET,
            root,
            'linked-project/src/main.py',
            {
                exists: () => true,
                realpath: candidate => candidate.startsWith(linkedProject)
                    ? candidate.replace(linkedProject, path.resolve('/outside/project'))
                    : candidate,
            },
        );

        expect(resolved).toBe(root);
    });
});

describe('resolvePythonInterpreter', () => {
    it('prefers .venv over venv on POSIX', () => {
        const root = '/repo';
        const candidates = [
            '/repo/.venv/bin/python',
            '/repo/venv/bin/python',
        ];
        expect(resolvePythonInterpreter(root, {
            pathApi: path.posix,
            platform: 'linux',
            isExecutable: candidate => candidates.includes(candidate),
        })).toBe(candidates[0]);
    });

    it('uses the Windows interpreter layout', () => {
        const interpreter = 'C:\\repo\\.venv\\Scripts\\python.exe';
        expect(resolvePythonInterpreter('C:\\repo', {
            pathApi: path.win32,
            platform: 'win32',
            isExecutable: candidate => candidate === interpreter,
        })).toBe(interpreter);
    });

    it('falls through invalid candidates to venv and then the host default', () => {
        expect(resolvePythonInterpreter('/repo', {
            pathApi: path.posix,
            platform: 'darwin',
            isExecutable: candidate => candidate === '/repo/venv/bin/python',
        })).toBe('/repo/venv/bin/python');
        expect(resolvePythonInterpreter('/repo', {
            pathApi: path.posix,
            platform: 'linux',
            isExecutable: () => false,
        })).toBeUndefined();
    });
});

describe('prepareDefinitionForRoot', () => {
    it('claims the built-in preset and exposes only safe runtime labels', () => {
        const bundled = '/private/host/node_modules/pyright/langserver.index.js';
        const prepared = prepareDefinitionForRoot(preset(), '/repos/app', {
            exists: () => false,
            nodePath: '/private/host/node',
            resolveBundled: () => bundled,
            resolveOnPath: () => undefined,
        });

        expect(prepared.definition.command).toBe('/private/host/node');
        expect(prepared.runtimeLabel).toBe('Server: packaged with CoC');
        expect(prepared.commandLabel).toBe('pyright-langserver');
        expect(JSON.stringify({
            runtimeLabel: prepared.runtimeLabel,
            commandLabel: prepared.commandLabel,
        })).not.toContain('/private/host');
    });

    it('leaves a repointed built-in preset unchanged', () => {
        const definition = preset({ command: '/custom/python-lsp', args: ['serve'] });
        const prepared = prepareDefinitionForRoot(definition, '/repos/app', {
            resolveBundled: () => '/should/not/be/used',
        });

        expect(prepared.definition).toBe(definition);
        expect(prepared.runtimeLabel).toBeUndefined();
    });

    it('does not claim a custom definition that uses the Pyright command', () => {
        const definition = preset({ id: 'custom-python', builtIn: false });
        const prepared = prepareDefinitionForRoot(definition, '/repos/app', {
            resolveBundled: () => '/should/not/be/used',
        });

        expect(prepared.definition).toBe(definition);
    });
});
