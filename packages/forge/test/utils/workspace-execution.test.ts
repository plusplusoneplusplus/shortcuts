import * as path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    buildWslCommandArgs,
    clearWorkspaceExecutionCaches,
    getDefaultWslDistro,
    getWslExecutablePath,
    isWslExecutionContext,
    isWslPath,
    normalizeExecutionPath,
    normalizeWslExecutionPath,
    resolvePathForHostFilesystem,
    resolvePathInExecutionContext,
    resolveWorkspaceExecutionContext,
    translatePathForExecution,
    translatePathForHostFilesystem,
    type WslExecutionContext,
} from '../../src/utils/workspace-execution';

describe('workspace-execution', () => {
    describe('getWslExecutablePath', () => {
        const originalSystemRoot = process.env['SystemRoot'];

        afterEach(() => {
            if (originalSystemRoot === undefined) {
                delete process.env['SystemRoot'];
            } else {
                process.env['SystemRoot'] = originalSystemRoot;
            }
        });

        it('uses SystemRoot when available', () => {
            process.env['SystemRoot'] = 'D:\\Windows';
            expect(getWslExecutablePath()).toBe('D:\\Windows\\System32\\wsl.exe');
        });

        it('throws when SystemRoot is missing', () => {
            delete process.env['SystemRoot'];
            expect(() => getWslExecutablePath()).toThrow('SystemRoot environment variable is not set');
        });
    });

    describe('resolveWorkspaceExecutionContext', () => {
        it('returns windows context for undefined input', () => {
            const ctx = resolveWorkspaceExecutionContext(undefined);
            expect(ctx).toEqual({ kind: 'windows' });
        });

        it('returns windows context for empty string', () => {
            const ctx = resolveWorkspaceExecutionContext('');
            expect(ctx).toEqual({ kind: 'windows' });
        });

        it('returns windows context for a Windows drive path', () => {
            const ctx = resolveWorkspaceExecutionContext('C:\\Users\\test\\repo');
            expect(ctx.kind).toBe('windows');
            if (ctx.kind === 'windows') {
                expect(ctx.workingDirectory).toBe('C:\\Users\\test\\repo');
            }
        });

        it('returns wsl context for a WSL UNC path (wsl$)', () => {
            const ctx = resolveWorkspaceExecutionContext('\\\\wsl$\\Ubuntu\\home\\user\\repo');
            expect(ctx.kind).toBe('wsl');
            if (ctx.kind === 'wsl') {
                expect(ctx.distro).toBe('Ubuntu');
                expect(ctx.linuxWorkingDirectory).toBe('/home/user/repo');
                expect(ctx.originalWorkingDirectory).toBe('\\\\wsl$\\Ubuntu\\home\\user\\repo');
            }
        });

        it('returns wsl context for a WSL UNC path (wsl.localhost)', () => {
            const ctx = resolveWorkspaceExecutionContext('\\\\wsl.localhost\\Debian\\tmp');
            expect(ctx.kind).toBe('wsl');
            if (ctx.kind === 'wsl') {
                expect(ctx.distro).toBe('Debian');
                expect(ctx.linuxWorkingDirectory).toBe('/tmp');
            }
        });

        it.runIf(process.platform === 'win32')('returns wsl context for bare Linux path on Windows', () => {
            clearWorkspaceExecutionCaches();
            const expectedDistro = getDefaultWslDistro();
            const ctx = resolveWorkspaceExecutionContext('/home/user/repo');
            expect(ctx.kind).toBe('wsl');
            if (ctx.kind === 'wsl') {
                expect(ctx.distro).toBe(expectedDistro);
                expect(ctx.linuxWorkingDirectory).toBe('/home/user/repo');
            }
        });

        it.runIf(process.platform !== 'win32')('returns windows context for Linux path on non-Windows', () => {
            // On Linux/Mac, a Linux absolute path is just a normal path
            const ctx = resolveWorkspaceExecutionContext('/home/user/repo');
            expect(ctx.kind).toBe('windows');
        });

        it('normalizes trailing slashes on WSL UNC paths', () => {
            const ctx = resolveWorkspaceExecutionContext('\\\\wsl$\\Ubuntu\\home\\user\\');
            expect(ctx.kind).toBe('wsl');
            if (ctx.kind === 'wsl') {
                expect(ctx.linuxWorkingDirectory).toBe('/home/user');
            }
        });

        it('handles WSL UNC path with only distro root', () => {
            const ctx = resolveWorkspaceExecutionContext('\\\\wsl$\\Ubuntu');
            expect(ctx.kind).toBe('wsl');
            if (ctx.kind === 'wsl') {
                expect(ctx.distro).toBe('Ubuntu');
                expect(ctx.linuxWorkingDirectory).toBe('/');
            }
        });
    });

    describe('translatePathForExecution', () => {
        const wslContext: WslExecutionContext = {
            kind: 'wsl',
            linuxWorkingDirectory: '/home/user/repo',
            distro: 'Ubuntu',
            originalWorkingDirectory: '\\\\wsl$\\Ubuntu\\home\\user\\repo',
        };

        const windowsContext = { kind: 'windows' as const, workingDirectory: 'C:\\repo' };

        it('returns path unchanged for windows context', () => {
            expect(translatePathForExecution('C:\\some\\path', windowsContext)).toBe('C:\\some\\path');
        });

        it('translates WSL UNC path to Linux path', () => {
            const result = translatePathForExecution('\\\\wsl$\\Ubuntu\\home\\user\\file.txt', wslContext);
            expect(result).toBe('/home/user/file.txt');
        });

        it('passes through Linux absolute paths', () => {
            const result = translatePathForExecution('/home/user/file.txt', wslContext);
            expect(result).toBe('/home/user/file.txt');
        });

        it('translates Windows drive path to WSL mount path', () => {
            const result = translatePathForExecution('C:\\Users\\test\\file.txt', wslContext);
            expect(result).toBe('/mnt/c/Users/test/file.txt');
        });

        it('throws for cross-distro WSL paths', () => {
            expect(() =>
                translatePathForExecution('\\\\wsl$\\Debian\\home\\user', wslContext),
            ).toThrow('WSL path belongs to distro "Debian", expected "Ubuntu"');
        });

        it('throws for relative paths in WSL context', () => {
            expect(() =>
                translatePathForExecution('relative/path', wslContext),
            ).toThrow('Path is not accessible from the active WSL execution context');
        });

        it('normalizes trailing slashes on translated paths', () => {
            const result = translatePathForExecution('/home/user/repo/', wslContext);
            expect(result).toBe('/home/user/repo');
        });

        it('handles root Linux path', () => {
            const result = translatePathForExecution('/', wslContext);
            expect(result).toBe('/');
        });
    });

    describe('translatePathForHostFilesystem', () => {
        const wslContext: WslExecutionContext = {
            kind: 'wsl',
            linuxWorkingDirectory: '/home/user/repo',
            distro: 'Ubuntu',
            originalWorkingDirectory: '\\\\wsl$\\Ubuntu\\home\\user\\repo',
        };

        it('returns path unchanged for windows context', () => {
            expect(translatePathForHostFilesystem('C:\\some\\path', { kind: 'windows', workingDirectory: 'C:\\repo' })).toBe('C:\\some\\path');
        });

        it.runIf(process.platform === 'win32')('translates WSL UNC paths to Windows host filesystem paths', () => {
            expect(translatePathForHostFilesystem('\\\\wsl$\\Ubuntu\\home\\user\\file.txt', wslContext))
                .toBe('\\\\wsl$\\Ubuntu\\home\\user\\file.txt');
        });

        it.runIf(process.platform === 'win32')('translates Linux paths to WSL UNC paths when distro is known', () => {
            expect(translatePathForHostFilesystem('/home/user/file.txt', wslContext))
                .toBe('\\\\wsl$\\Ubuntu\\home\\user\\file.txt');
        });
    });

    describe('resolvePathInExecutionContext', () => {
        it.runIf(process.platform === 'win32')('uses native path resolution for Windows paths', () => {
            expect(resolvePathInExecutionContext('C:\\repo', '.github', 'skills')).toBe(path.win32.resolve('C:\\repo', '.github', 'skills'));
        });

        it('builds Linux paths for WSL namespaces', () => {
            expect(resolvePathInExecutionContext('\\\\wsl$\\Ubuntu\\home\\user\\repo', '.github', 'skills'))
                .toBe('/home/user/repo/.github/skills');
        });
    });

    describe('resolvePathForHostFilesystem', () => {
        it.runIf(process.platform === 'win32')('uses native filesystem paths for Windows roots', () => {
            expect(resolvePathForHostFilesystem('C:\\repo', '.github', 'skills')).toBe(path.win32.resolve('C:\\repo', '.github', 'skills'));
        });

        it.runIf(process.platform === 'win32')('converts Linux roots to WSL UNC paths for host filesystem access', () => {
            const result = resolvePathForHostFilesystem('\\\\wsl$\\Ubuntu\\home\\user\\repo', '.github', 'skills');
            expect(result).toBe('\\\\wsl$\\Ubuntu\\home\\user\\repo\\.github\\skills');
        });
    });

    describe('buildWslCommandArgs', () => {
        it('builds args with distro', () => {
            const ctx: WslExecutionContext = {
                kind: 'wsl',
                linuxWorkingDirectory: '/home/user/repo',
                distro: 'Ubuntu',
                originalWorkingDirectory: '\\\\wsl$\\Ubuntu\\home\\user\\repo',
            };
            const result = buildWslCommandArgs(ctx, ['git', 'status']);
            expect(result).toEqual(['-d', 'Ubuntu', '--cd', '/home/user/repo', '--', 'git', 'status']);
        });

        it('builds args without distro', () => {
            const ctx: WslExecutionContext = {
                kind: 'wsl',
                linuxWorkingDirectory: '/home/user/repo',
                originalWorkingDirectory: '/home/user/repo',
            };
            const result = buildWslCommandArgs(ctx, ['git', 'status']);
            expect(result).toEqual(['--cd', '/home/user/repo', '--', 'git', 'status']);
        });

        it('handles empty argv', () => {
            const ctx: WslExecutionContext = {
                kind: 'wsl',
                linuxWorkingDirectory: '/tmp',
                distro: 'Debian',
                originalWorkingDirectory: '\\\\wsl$\\Debian\\tmp',
            };
            const result = buildWslCommandArgs(ctx, []);
            expect(result).toEqual(['-d', 'Debian', '--cd', '/tmp', '--']);
        });
    });

    describe('normalizeWslExecutionPath', () => {
        it('formats with distro name lowercased', () => {
            expect(normalizeWslExecutionPath('/home/user/repo', 'Ubuntu')).toBe('wsl://ubuntu/home/user/repo');
        });

        it('uses "default" when no distro is specified', () => {
            expect(normalizeWslExecutionPath('/home/user/repo')).toBe('wsl://default/home/user/repo');
        });

        it('handles root path', () => {
            expect(normalizeWslExecutionPath('/', 'Debian')).toBe('wsl://debian/');
        });

        it('normalizes trailing slashes', () => {
            expect(normalizeWslExecutionPath('/home/user/', 'Alpine')).toBe('wsl://alpine/home/user');
        });
    });

    describe('normalizeExecutionPath', () => {
        it('normalizes WSL UNC path to wsl:// URI', () => {
            const result = normalizeExecutionPath('\\\\wsl$\\Ubuntu\\home\\user\\repo');
            expect(result).toBe('wsl://ubuntu/home/user/repo');
        });

        it('removes trailing separator from Windows-style path', () => {
            const result = normalizeExecutionPath('C:\\Users\\test\\repo\\');
            // path.resolve removes trailing separator, but verify no trailing slash
            expect(result.endsWith('/')).toBe(false);
        });

        it.runIf(process.platform === 'win32')('lowercases on Windows', () => {
            const result = normalizeExecutionPath('C:\\Users\\TEST\\Repo');
            expect(result).toBe(result.toLowerCase());
        });

        it.runIf(process.platform === 'win32')('uses default distro for bare Linux paths on Windows', () => {
            clearWorkspaceExecutionCaches();
            const expectedDistro = (getDefaultWslDistro() ?? 'default').toLowerCase();
            const result = normalizeExecutionPath('/home/user/repo');
            expect(result).toBe(`wsl://${expectedDistro}/home/user/repo`);
        });
    });

    describe('getDefaultWslDistro', () => {
        afterEach(() => {
            clearWorkspaceExecutionCaches();
        });

        it.runIf(process.platform !== 'win32')('returns undefined on non-Windows platforms', async () => {
            const { getDefaultWslDistro } = await import('../../src/utils/workspace-execution');
            expect(getDefaultWslDistro()).toBeUndefined();
        });
    });

    describe('clearWorkspaceExecutionCaches', () => {
        it('does not throw when called', () => {
            expect(() => clearWorkspaceExecutionCaches()).not.toThrow();
        });
    });

    describe('isWslExecutionContext', () => {
        it('returns true for WSL context', () => {
            const ctx: WslExecutionContext = {
                kind: 'wsl',
                linuxWorkingDirectory: '/home/user',
                originalWorkingDirectory: '\\\\wsl$\\Ubuntu\\home\\user',
            };
            expect(isWslExecutionContext(ctx)).toBe(true);
        });

        it('returns false for Windows context', () => {
            expect(isWslExecutionContext({ kind: 'windows' })).toBe(false);
        });
    });

    describe('isWslPath', () => {
        it('returns true for WSL UNC path', () => {
            expect(isWslPath('\\\\wsl$\\Ubuntu\\home\\user')).toBe(true);
        });

        it('returns true for wsl.localhost UNC path', () => {
            expect(isWslPath('\\\\wsl.localhost\\Debian\\tmp')).toBe(true);
        });

        it.runIf(process.platform === 'win32')('returns true for bare Linux path on Windows', () => {
            expect(isWslPath('/home/user/repo')).toBe(true);
        });

        it.runIf(process.platform !== 'win32')('returns false for Linux path on non-Windows', () => {
            expect(isWslPath('/home/user/repo')).toBe(false);
        });

        it('returns false for Windows drive path', () => {
            expect(isWslPath('C:\\Users\\test')).toBe(false);
        });

        it('returns false for relative path', () => {
            expect(isWslPath('relative/path')).toBe(false);
        });
    });
});
