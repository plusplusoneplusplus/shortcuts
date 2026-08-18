import { describe, it, expect, vi, afterEach } from 'vitest';
import * as path from 'path';
import {
    getWslUncRoot,
    isWslUncPath,
    parseWslUncPath,
    toForwardSlashes,
    toNativePath,
    toWslUncPath,
    windowsPathToWslPath,
} from '../../src/utils/path-utils';
import { isWithinDirectory } from '../../src/utils/path-security';

describe('toForwardSlashes', () => {
    it('converts backslashes to forward slashes', () => {
        expect(toForwardSlashes('a\\b\\c')).toBe('a/b/c');
    });

    it('leaves forward slashes unchanged', () => {
        expect(toForwardSlashes('a/b/c')).toBe('a/b/c');
    });

    it('handles mixed separators', () => {
        expect(toForwardSlashes('a\\b/c\\d')).toBe('a/b/c/d');
    });

    it('returns empty string unchanged', () => {
        expect(toForwardSlashes('')).toBe('');
    });

    it('handles strings with no separators', () => {
        expect(toForwardSlashes('file.txt')).toBe('file.txt');
    });

    it('handles consecutive backslashes', () => {
        expect(toForwardSlashes('a\\\\b')).toBe('a//b');
    });

    it('handles Windows-style absolute paths', () => {
        expect(toForwardSlashes('C:\\Users\\name\\file.txt')).toBe('C:/Users/name/file.txt');
    });
});

describe('toNativePath', () => {
    it('converts forward slashes to backslashes for Windows drive paths', () => {
        expect(toNativePath('D:/projects/shortcuts/.vscode/tasks/file.md')).toBe('D:\\projects\\shortcuts\\.vscode\\tasks\\file.md');
    });

    it('preserves backslashes for Windows drive paths', () => {
        expect(toNativePath('C:\\Users\\name\\file.txt')).toBe('C:\\Users\\name\\file.txt');
    });

    it('normalizes mixed slashes to backslashes for Windows paths', () => {
        expect(toNativePath('D:\\projects/shortcuts\\.vscode/tasks')).toBe('D:\\projects\\shortcuts\\.vscode\\tasks');
    });

    it('converts backslashes to forward slashes for Unix paths', () => {
        expect(toNativePath('/home/user\\file.txt')).toBe('/home/user/file.txt');
    });

    it('leaves Unix forward-slash paths unchanged', () => {
        expect(toNativePath('/usr/local/bin')).toBe('/usr/local/bin');
    });

    it('leaves relative paths with forward slashes unchanged', () => {
        expect(toNativePath('.vscode/tasks/file.md')).toBe('.vscode/tasks/file.md');
    });

    it('converts relative paths with backslashes to forward slashes', () => {
        expect(toNativePath('.vscode\\tasks\\file.md')).toBe('.vscode/tasks/file.md');
    });

    it('handles empty string', () => {
        expect(toNativePath('')).toBe('');
    });

    it('handles lowercase drive letter', () => {
        expect(toNativePath('c:/users/name')).toBe('c:\\users\\name');
    });

    it('handles strings with no separators', () => {
        expect(toNativePath('file.txt')).toBe('file.txt');
    });

    it('normalizes WSL UNC paths to backslashes', () => {
        expect(toNativePath(String.raw`\\wsl$\Ubuntu\home/user/repo`)).toBe(String.raw`\\wsl$\Ubuntu\home\user\repo`);
    });
});

describe('WSL path helpers', () => {
    it('detects WSL UNC paths', () => {
        expect(isWslUncPath(String.raw`\\wsl$\Ubuntu\home\user\repo`)).toBe(true);
        expect(isWslUncPath(String.raw`\\wsl.localhost\Ubuntu\home\user\repo`)).toBe(true);
        expect(isWslUncPath('C:\\repo')).toBe(false);
    });

    it('parses WSL UNC paths into distro and Linux path', () => {
        expect(parseWslUncPath(String.raw`\\wsl$\Ubuntu\home\user\repo`)).toEqual({
            distro: 'Ubuntu',
            linuxPath: '/home/user/repo',
        });
    });

    it('returns the WSL UNC root in either slash style', () => {
        expect(getWslUncRoot(String.raw`\\wsl$\Ubuntu-24.04\home\user\repo`)).toBe('//wsl$/Ubuntu-24.04');
        expect(getWslUncRoot('//wsl$/Ubuntu-24.04/home/user/repo')).toBe('//wsl$/Ubuntu-24.04');
        expect(getWslUncRoot(String.raw`\\WSL.LOCALHOST\Debian\srv`)).toBe('//WSL.LOCALHOST/Debian');
    });

    it('returns the root for a bare WSL share with no trailing path', () => {
        expect(getWslUncRoot(String.raw`\\wsl$\Ubuntu`)).toBe('//wsl$/Ubuntu');
    });

    it('returns null for non-WSL paths', () => {
        expect(getWslUncRoot('/home/user/repo')).toBeNull();
        expect(getWslUncRoot('C:\\repo')).toBeNull();
        expect(getWslUncRoot(String.raw`\\fileserver\share\repo`)).toBeNull();
        expect(getWslUncRoot(String.raw`\\wsl$`)).toBeNull();
    });

    it('converts Windows drive paths to WSL mount paths', () => {
        expect(windowsPathToWslPath('C:\\Users\\tester\\.copilot')).toBe('/mnt/c/Users/tester/.copilot');
    });
});

describe('isWithinDirectory', () => {
    it('returns true for exact match', () => {
        const base = path.resolve('/tmp/base');
        expect(isWithinDirectory(base, base)).toBe(true);
    });

    it('returns true for a child path', () => {
        const base = path.resolve('/tmp/base');
        const child = path.join(base, 'child', 'file.txt');
        expect(isWithinDirectory(child, base)).toBe(true);
    });

    it('returns false for a traversal attempt', () => {
        const base = path.resolve('/tmp/base');
        const traversal = path.join(base, '..', 'other');
        expect(isWithinDirectory(traversal, base)).toBe(false);
    });

    it('returns false for an unrelated path', () => {
        const base = path.resolve('/tmp/base');
        const other = path.resolve('/tmp/other');
        expect(isWithinDirectory(other, base)).toBe(false);
    });

    it('returns false for prefix-overlapping sibling', () => {
        const base = path.resolve('/tmp/base');
        const sibling = path.resolve('/tmp/base-extra');
        expect(isWithinDirectory(sibling, base)).toBe(false);
    });

    it('resolves relative paths against cwd', () => {
        const cwd = process.cwd();
        expect(isWithinDirectory('child', cwd)).toBe(true);
    });
});

describe('toWslUncPath', () => {
    it('translates a Linux absolute path into the Windows UNC form', () => {
        expect(toWslUncPath('/home/yiheng/projects/shortcuts', 'Ubuntu')).toBe(
            '\\\\wsl.localhost\\Ubuntu\\home\\yiheng\\projects\\shortcuts'
        );
    });

    it('translates the filesystem root', () => {
        expect(toWslUncPath('/', 'Ubuntu')).toBe('\\\\wsl.localhost\\Ubuntu');
    });

    it('drops a trailing separator', () => {
        expect(toWslUncPath('/home/yiheng/', 'Ubuntu')).toBe(
            '\\\\wsl.localhost\\Ubuntu\\home\\yiheng'
        );
    });

    it('keeps a distro name with spaces verbatim', () => {
        expect(toWslUncPath('/opt/tools', 'Ubuntu 22.04')).toBe(
            '\\\\wsl.localhost\\Ubuntu 22.04\\opt\\tools'
        );
    });

    it('returns the path unchanged when the distro is missing', () => {
        expect(toWslUncPath('/home/yiheng', undefined)).toBe('/home/yiheng');
        expect(toWslUncPath('/home/yiheng', null)).toBe('/home/yiheng');
        expect(toWslUncPath('/home/yiheng', '   ')).toBe('/home/yiheng');
    });

    it('does not translate an already-UNC path twice', () => {
        const unc = '\\\\wsl.localhost\\Ubuntu\\home\\yiheng';
        expect(toWslUncPath(unc, 'Ubuntu')).toBe(unc);
        expect(toWslUncPath('\\\\wsl$\\Ubuntu\\home', 'Ubuntu')).toBe('\\\\wsl$\\Ubuntu\\home');
        expect(toWslUncPath('//wsl.localhost/Ubuntu/home', 'Ubuntu')).toBe('//wsl.localhost/Ubuntu/home');
    });

    it('returns non-Linux paths unchanged', () => {
        expect(toWslUncPath('C:\\repo', 'Ubuntu')).toBe('C:\\repo');
        expect(toWslUncPath('relative/dir', 'Ubuntu')).toBe('relative/dir');
        expect(toWslUncPath('', 'Ubuntu')).toBe('');
    });
});
