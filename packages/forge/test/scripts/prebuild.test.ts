import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const script = await import('../../scripts/prebuild.mjs');

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');

/** Every `@plusplusoneplusplus/*` package one of these workspaces depends on. */
function workspaceDependencies(name: string): string[] {
    const dir = name.replace('@plusplusoneplusplus/', '');
    const manifest = JSON.parse(readFileSync(path.join(repoRoot, 'packages', dir, 'package.json'), 'utf8'));
    return Object.keys({ ...manifest.dependencies, ...manifest.devDependencies }).filter(dep =>
        dep.startsWith('@plusplusoneplusplus/'),
    );
}

describe('prebuild script', () => {
    it('uses npm.cmd on Windows and npm elsewhere', () => {
        expect(script.getNpmExecutable('win32')).toBe('npm.cmd');
        expect(script.getNpmExecutable('linux')).toBe('npm');
        expect(script.getNpmExecutable('darwin')).toBe('npm');
    });

    it('builds required workspace dependencies from the repository root', () => {
        const calls: Array<{ command: string; args: string[]; cwd: string; shell?: boolean }> = [];

        script.buildRequiredWorkspacePackages({
            rootDir: '/repo/root',
            npmExecutable: 'npm-test',
            run: (command: string, args: string[], options: { cwd: string; shell?: boolean }) => {
                calls.push({ command, args, cwd: options.cwd, shell: options.shell });
            },
        });

        expect(calls).toEqual([
            {
                command: 'npm-test',
                args: ['run', 'build', '-w', '@plusplusoneplusplus/coc-native'],
                cwd: '/repo/root',
                shell: undefined,
            },
            {
                command: 'npm-test',
                args: ['run', 'build', '-w', '@plusplusoneplusplus/coc-agent-sdk'],
                cwd: '/repo/root',
                shell: undefined,
            },
            {
                command: 'npm-test',
                args: ['run', 'build', '-w', '@plusplusoneplusplus/coc-workflow'],
                cwd: '/repo/root',
                shell: undefined,
            },
            {
                command: 'npm-test',
                args: ['run', 'build', '-w', '@plusplusoneplusplus/coc-memory'],
                cwd: '/repo/root',
                shell: undefined,
            },
        ]);
    });

    it('builds every workspace after the ones it depends on', () => {
        // The list is a topological order, not a set: each package resolves its
        // workspace dependencies from their built `dist`, which on a clean
        // checkout does not exist until that package has been built. Getting
        // this wrong fails in CI as a TS2307 that names a module, not an order.
        const order: string[] = script.REQUIRED_BUILD_WORKSPACES;
        for (const [index, workspace] of order.entries()) {
            for (const dependency of workspaceDependencies(workspace)) {
                const dependencyIndex = order.indexOf(dependency);
                if (dependencyIndex === -1) continue;
                expect(
                    dependencyIndex,
                    `${workspace} imports ${dependency}, so ${dependency} has to be built first`,
                ).toBeLessThan(index);
            }
        }
    });

    it('builds coc-native before coc-agent-sdk, which imports its git capability', () => {
        const order: string[] = script.REQUIRED_BUILD_WORKSPACES;
        expect(order.indexOf('@plusplusoneplusplus/coc-native')).toBeLessThan(
            order.indexOf('@plusplusoneplusplus/coc-agent-sdk'),
        );
        expect(workspaceDependencies('@plusplusoneplusplus/coc-agent-sdk')).toContain(
            '@plusplusoneplusplus/coc-native',
        );
    });

    it('passes shell:true when using npm.cmd (Windows)', () => {
        const calls: Array<{ command: string; args: string[]; cwd: string; shell?: boolean }> = [];

        script.buildRequiredWorkspacePackages({
            rootDir: '/repo/root',
            npmExecutable: 'npm.cmd',
            run: (command: string, args: string[], options: { cwd: string; shell?: boolean }) => {
                calls.push({ command, args, cwd: options.cwd, shell: options.shell });
            },
        });

        expect(calls).toEqual([
            {
                command: 'npm.cmd',
                args: ['run', 'build', '-w', '@plusplusoneplusplus/coc-native'],
                cwd: '/repo/root',
                shell: true,
            },
            {
                command: 'npm.cmd',
                args: ['run', 'build', '-w', '@plusplusoneplusplus/coc-agent-sdk'],
                cwd: '/repo/root',
                shell: true,
            },
            {
                command: 'npm.cmd',
                args: ['run', 'build', '-w', '@plusplusoneplusplus/coc-workflow'],
                cwd: '/repo/root',
                shell: true,
            },
            {
                command: 'npm.cmd',
                args: ['run', 'build', '-w', '@plusplusoneplusplus/coc-memory'],
                cwd: '/repo/root',
                shell: true,
            },
        ]);
    });
});
