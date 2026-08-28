import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const script = await import('../../scripts/prebuild.mjs');

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');

function manifestOf(name: string): { dependencies?: Record<string, string>; devDependencies?: Record<string, string>; scripts?: Record<string, string> } {
    const dir = name.replace('@plusplusoneplusplus/', '');
    return JSON.parse(fs.readFileSync(path.join(repoRoot, 'packages', dir, 'package.json'), 'utf8'));
}

/** Every `@plusplusoneplusplus/*` package one of these workspaces depends on. */
function workspaceDependencies(name: string): string[] {
    const manifest = manifestOf(name);
    return Object.keys({ ...manifest.dependencies, ...manifest.devDependencies }).filter(dep =>
        dep.startsWith('@plusplusoneplusplus/'),
    );
}

/** Whether `npm run build -w <name>` builds its own workspace dependencies first. */
function hasPrebuildHook(name: string): boolean {
    return typeof manifestOf(name).scripts?.prebuild === 'string';
}

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

    it('orders build:packages for every workspace without a prebuild hook', () => {
        // CI runs `npm run build:packages`. A workspace with its own `prebuild`
        // hook builds its dependencies itself, so the root script's order does
        // not have to be right for it — `forge` is built before `coc-memory`
        // there and always has been. A workspace *without* one, `coc-agent-sdk`
        // above all, reaches its `tsc` with only what the root script has
        // already built, so for those the order is the whole guarantee.
        const rootScript: string = JSON.parse(
            fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'),
        ).scripts['build:packages'];
        const built = [...rootScript.matchAll(/-w packages\/([\w-]+)/g)].map(match => match[1]);
        expect(built).toContain('coc-agent-sdk');

        for (const [index, dir] of built.entries()) {
            const name = `@plusplusoneplusplus/${dir}`;
            if (hasPrebuildHook(name)) continue;
            for (const dependency of workspaceDependencies(name)) {
                const dependencyIndex = built.indexOf(dependency.replace('@plusplusoneplusplus/', ''));
                if (dependencyIndex === -1) continue;
                expect(
                    dependencyIndex,
                    `${dir} has no prebuild hook and imports ${dependency}, so build:packages has to build ${dependency} first`,
                ).toBeLessThan(index);
            }
        }
    });

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
            {
                command: 'npm-test',
                args: ['run', 'build', '-w', '@plusplusoneplusplus/forge'],
                cwd: '/repo/root',
                shell: undefined,
            },
            {
                command: 'npm-test',
                args: ['run', 'build', '-w', '@plusplusoneplusplus/coc-client'],
                cwd: '/repo/root',
                shell: undefined,
            },
            {
                command: 'npm-test',
                args: ['run', 'build', '-w', '@plusplusoneplusplus/coc-connector'],
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
            {
                command: 'npm.cmd',
                args: ['run', 'build', '-w', '@plusplusoneplusplus/forge'],
                cwd: '/repo/root',
                shell: true,
            },
            {
                command: 'npm.cmd',
                args: ['run', 'build', '-w', '@plusplusoneplusplus/coc-client'],
                cwd: '/repo/root',
                shell: true,
            },
            {
                command: 'npm.cmd',
                args: ['run', 'build', '-w', '@plusplusoneplusplus/coc-connector'],
                cwd: '/repo/root',
                shell: true,
            },
        ]);
    });

    it('writes build metadata and falls back when git is unavailable', () => {
        const rootDir = makeTempDir();
        const cocPackageRoot = path.join(rootDir, 'packages', 'coc');
        fs.mkdirSync(cocPackageRoot, { recursive: true });
        fs.writeFileSync(path.join(rootDir, 'package.json'), JSON.stringify({ version: '9.8.7' }));

        script.writeBuildInfo({
            rootDir,
            cocPackageRoot,
            run: () => {
                throw new Error('git unavailable');
            },
            env: {},
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

    it('prefers COC_BUILD_COMMIT over git (no .git in the Docker build context)', () => {
        const gitCalls: string[][] = [];
        const run = (command: string, args: string[]) => {
            gitCalls.push([command, ...args]);
            return 'from-git\n';
        };

        expect(script.resolveBuildCommit({ rootDir: '/repo', run, env: { COC_BUILD_COMMIT: ' abc123def ' } })).toBe('abc123def');
        expect(gitCalls).toEqual([]);

        // Empty/blank env falls through to git.
        expect(script.resolveBuildCommit({ rootDir: '/repo', run, env: { COC_BUILD_COMMIT: '   ' } })).toBe('from-git');
        expect(script.resolveBuildCommit({ rootDir: '/repo', run, env: {} })).toBe('from-git');
        expect(gitCalls).toHaveLength(2);

        const rootDir = makeTempDir();
        const cocPackageRoot = path.join(rootDir, 'packages', 'coc');
        fs.mkdirSync(cocPackageRoot, { recursive: true });
        fs.writeFileSync(path.join(rootDir, 'package.json'), JSON.stringify({ version: '1.0.0' }));
        script.writeBuildInfo({
            rootDir,
            cocPackageRoot,
            run: () => {
                throw new Error('git unavailable');
            },
            env: { COC_BUILD_COMMIT: 'deadbeef' },
        });
        expect(
            fs.readFileSync(path.join(cocPackageRoot, 'src', 'server', 'core', 'build-info.ts'), 'utf8'),
        ).toContain('export const BUILD_COMMIT = "deadbeef";');
    });

    it('reports the workspace root version, not the coc package version', () => {
        const rootDir = makeTempDir();
        const cocPackageRoot = path.join(rootDir, 'packages', 'coc');
        fs.mkdirSync(cocPackageRoot, { recursive: true });
        fs.writeFileSync(path.join(rootDir, 'package.json'), JSON.stringify({ version: '3.4.2' }));
        fs.writeFileSync(
            path.join(cocPackageRoot, 'package.json'),
            JSON.stringify({ version: '1.2.0' }),
        );

        script.writeBuildInfo({
            rootDir,
            cocPackageRoot,
            run: () => 'abc123\n',
            env: {},
        });

        const written = fs.readFileSync(
            path.join(cocPackageRoot, 'src', 'server', 'core', 'build-info.ts'),
            'utf8',
        );
        expect(written).toContain('export const BUILD_VERSION = "3.4.2";');
        expect(written).toContain('export const BUILD_COMMIT = "abc123";');
        expect(written).not.toContain('1.2.0');
    });
});
