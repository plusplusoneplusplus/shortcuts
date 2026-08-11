/**
 * Tests for resolveRequestedFilePath — how the file-preview API turns a
 * requested path into a host path, including the WSL case where a Windows host
 * serves a `\\wsl$\<distro>\...` workspace but agents emit Linux paths.
 *
 * `isWindows` is injected, so these run identically on Linux/macOS/Windows.
 */

import { describe, it, expect } from 'vitest';
import { resolveRequestedFilePath } from '../../src/server/tasks/tasks-handler-utils';

const WSL_ROOT = '\\\\wsl$\\Ubuntu-24.04\\home\\yihengtao\\projects\\mini-sglang';

describe('resolveRequestedFilePath', () => {
    it('anchors a relative path at the workspace root', () => {
        expect(resolveRequestedFilePath('src/foo.ts', '/tmp/proj', false)).toBe('/tmp/proj/src/foo.ts');
    });

    it('anchors a relative path at a WSL workspace root on Windows', () => {
        expect(resolveRequestedFilePath('python/main.py', WSL_ROOT, true))
            .toBe('\\\\wsl$\\Ubuntu-24.04\\home\\yihengtao\\projects\\mini-sglang\\python\\main.py');
    });

    it('resolves an absolute path as-is for a non-WSL workspace', () => {
        expect(resolveRequestedFilePath('/tmp/proj/src/foo.ts', '/tmp/proj', false))
            .toBe('/tmp/proj/src/foo.ts');
    });

    it('re-roots a Linux absolute path onto the WSL share on Windows', () => {
        expect(resolveRequestedFilePath('/home/yihengtao/projects/mini-sglang/a.py', WSL_ROOT, true))
            .toBe('\\\\wsl$\\Ubuntu-24.04\\home\\yihengtao\\projects\\mini-sglang\\a.py');
    });

    it('keeps a forward-slash UNC path pointing at the share on Windows', () => {
        expect(resolveRequestedFilePath(
            '//wsl$/Ubuntu-24.04/home/yihengtao/projects/mini-sglang/a.py',
            WSL_ROOT,
            true,
        )).toBe('\\\\wsl$\\Ubuntu-24.04\\home\\yihengtao\\projects\\mini-sglang\\a.py');
    });

    it('does not re-root Linux paths when the workspace is not a WSL share', () => {
        expect(resolveRequestedFilePath('/etc/passwd', '/tmp/proj', false)).toBe('/etc/passwd');
    });

    it('does not re-root Linux paths on a non-Windows host', () => {
        expect(resolveRequestedFilePath('/home/yihengtao/projects/mini-sglang/a.py', WSL_ROOT, false))
            .toBe('/home/yihengtao/projects/mini-sglang/a.py');
    });

    it('still resolves traversal attempts so the caller can reject them', () => {
        expect(resolveRequestedFilePath('/home/../etc/passwd', WSL_ROOT, true))
            .toBe('\\\\wsl$\\Ubuntu-24.04\\etc\\passwd');
    });
});
