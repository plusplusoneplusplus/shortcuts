import { describe, expect, it } from 'vitest';

const script = await import('../../scripts/prebuild.mjs');

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
        ]);
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
        ]);
    });
});
