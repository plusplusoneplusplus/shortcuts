import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const script = await import('../../scripts/prebuild.mjs');

const tempDirs: string[] = [];

afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

function makeTempDir(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-prebuild-'));
    tempDirs.push(dir);
    return dir;
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
                args: ['run', 'build', '-w', '@plusplusoneplusplus/coc-client'],
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
                args: ['run', 'build', '-w', '@plusplusoneplusplus/coc-client'],
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

    it('writes build metadata and falls back when git is unavailable', () => {
        const rootDir = makeTempDir();
        const cocPackageRoot = path.join(rootDir, 'packages', 'coc');
        fs.mkdirSync(cocPackageRoot, { recursive: true });
        fs.writeFileSync(
            path.join(cocPackageRoot, 'package.json'),
            JSON.stringify({ version: '9.8.7' }),
        );

        script.writeBuildInfo({
            rootDir,
            cocPackageRoot,
            run: () => {
                throw new Error('git unavailable');
            },
        });

        expect(
            fs.readFileSync(
                path.join(cocPackageRoot, 'src', 'server', 'core', 'build-info.ts'),
                'utf8',
            ),
        ).toBe(
            '// Auto-generated at build time. Do not edit manually.\n' +
                'export const BUILD_COMMIT = "unknown";\n' +
                'export const BUILD_VERSION = "9.8.7";\n',
        );
    });
});
