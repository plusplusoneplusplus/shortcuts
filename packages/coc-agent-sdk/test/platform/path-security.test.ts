import { afterEach, describe, it, expect } from 'vitest';
import * as path from 'path';
import { isWithinDirectory } from '../../src/platform/path-security';
import { clearWorkspaceExecutionCaches } from '../../src/platform/workspace-execution';

describe('isWithinDirectory', () => {
    it('returns true for a direct child path', () => {
        const base = path.resolve('/a/b');
        const child = path.join(base, 'c');
        expect(isWithinDirectory(child, base)).toBe(true);
    });

    it('returns true for exact match', () => {
        const base = path.resolve('/a/b');
        expect(isWithinDirectory(base, base)).toBe(true);
    });

    it('returns false for a prefix-only sibling (same name start, different dir)', () => {
        const base = path.resolve('/a/b');
        const sibling = path.resolve('/a/b-evil');
        expect(isWithinDirectory(sibling, base)).toBe(false);
    });

    it('returns false for a sibling directory', () => {
        const base = path.resolve('/a/b');
        const sibling = path.resolve('/a/x');
        expect(isWithinDirectory(sibling, base)).toBe(false);
    });

    it('returns false when path traversal escapes base via ..', () => {
        // /a/b/../c resolves to /a/c which is NOT within /a/b
        const base = path.resolve('/a/b');
        const escaped = path.resolve('/a/b/../c');
        expect(isWithinDirectory(escaped, base)).toBe(false);
    });

    it('correctly normalises redundant .. segments that stay within base', () => {
        // /a/b/sub/../other resolves to /a/b/other which IS within /a/b
        const base = path.resolve('/a/b');
        const normalised = path.resolve('/a/b/sub/../other');
        expect(isWithinDirectory(normalised, base)).toBe(true);
    });

    it('returns true for deeply nested child after normalisation', () => {
        // /a/b/../../a/b/c resolves to /a/b/c which IS within /a/b
        const base = path.resolve('/a/b');
        const deep = path.resolve('/a/b/../../a/b/c');
        expect(isWithinDirectory(deep, base)).toBe(true);
    });

    it('returns false for parent directory', () => {
        const base = path.resolve('/a/b');
        const parent = path.resolve('/a');
        expect(isWithinDirectory(parent, base)).toBe(false);
    });

    it('supports WSL UNC paths in the same distro', () => {
        const base = String.raw`\\wsl$\Ubuntu\home\user\repo`;
        const child = String.raw`\\wsl$\Ubuntu\home\user\repo\src\index.ts`;
        expect(isWithinDirectory(child, base)).toBe(true);
    });

    it('rejects WSL paths from a different distro', () => {
        const base = String.raw`\\wsl$\Ubuntu\home\user\repo`;
        const other = String.raw`\\wsl$\Debian\home\user\repo\src\index.ts`;
        expect(isWithinDirectory(other, base)).toBe(false);
    });

    // The distro lookup is asynchronous, so this synchronous predicate can be
    // asked about a bare Linux path before the cache is warm. It has to keep
    // denying then: an unresolved distro must never read as "same distro" as a
    // named one.
    describe('with an unresolved default distro on win32', () => {
        const originalPlatform = process.platform;

        afterEach(() => {
            Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
            clearWorkspaceExecutionCaches();
        });

        function forceWin32ColdCache(): void {
            Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
            clearWorkspaceExecutionCaches();
        }

        it('denies a bare Linux path against a named-distro UNC base', () => {
            forceWin32ColdCache();
            const base = String.raw`\\wsl$\Ubuntu\home\user\repo`;
            expect(isWithinDirectory('/home/user/repo/src/index.ts', base)).toBe(false);
        });

        it('denies a named-distro UNC path against a bare Linux base', () => {
            forceWin32ColdCache();
            const target = String.raw`\\wsl$\Ubuntu\home\user\repo\src\index.ts`;
            expect(isWithinDirectory(target, '/home/user/repo')).toBe(false);
        });

        it('still allows containment when both sides are bare Linux paths', () => {
            forceWin32ColdCache();
            expect(isWithinDirectory('/home/user/repo/src/index.ts', '/home/user/repo')).toBe(true);
            expect(isWithinDirectory('/home/user/repo-evil', '/home/user/repo')).toBe(false);
        });
    });
});
