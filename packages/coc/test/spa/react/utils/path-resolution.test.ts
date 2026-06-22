import { describe, it, expect } from 'vitest';
import {
    deriveHomeDir,
    deriveHomeDirFromWorkspaces,
    expandTildePath,
    isAbsolutePath,
    resolveRelativePath,
} from '../../../../src/server/spa/client/react/utils/path-resolution';

describe('isAbsolutePath', () => {
    it('returns true for Unix absolute path', () => {
        expect(isAbsolutePath('/home/user/file.md')).toBe(true);
    });

    it('returns true for Windows absolute path with backslash', () => {
        expect(isAbsolutePath('C:\\Users\\file.md')).toBe(true);
    });

    it('returns true for Windows absolute path with forward slash', () => {
        expect(isAbsolutePath('C:/Users/file.md')).toBe(true);
    });

    it('returns false for relative path', () => {
        expect(isAbsolutePath('./relative/path.md')).toBe(false);
    });

    it('returns false for parent-relative path', () => {
        expect(isAbsolutePath('../sibling.md')).toBe(false);
    });

    it('returns false for plain filename', () => {
        expect(isAbsolutePath('file.md')).toBe(false);
    });

    it('returns false for empty string', () => {
        expect(isAbsolutePath('')).toBe(false);
    });
});

describe('resolveRelativePath', () => {
    it('resolves ./relative path against dir', () => {
        expect(resolveRelativePath('home/user/docs', './other.md')).toBe('home/user/docs/other.md');
    });

    it('resolves ../sibling path against dir', () => {
        expect(resolveRelativePath('home/user/docs', '../sibling.md')).toBe('home/user/sibling.md');
    });

    it('resolves multiple ../ levels', () => {
        expect(resolveRelativePath('a/b/c', '../../x.md')).toBe('a/x.md');
    });

    it('preserves leading slash for Unix absolute base', () => {
        expect(resolveRelativePath('/home/user/docs', './file.md')).toBe('/home/user/docs/file.md');
    });

    it('resolves relative path from absolute Unix dir', () => {
        expect(resolveRelativePath('/home/user/docs', '../sibling.md')).toBe('/home/user/sibling.md');
    });

    it('resolves simple filename without dot-slash', () => {
        expect(resolveRelativePath('base/dir', 'file.md')).toBe('base/dir/file.md');
    });

    it('handles empty rel segment gracefully', () => {
        const result = resolveRelativePath('base/dir', './sub/../file.md');
        expect(result).toBe('base/dir/file.md');
    });
});

describe('deriveHomeDir', () => {
    it('derives a macOS home prefix from a path under it', () => {
        expect(deriveHomeDir('/Users/yihengtao/.coc/repos/ws-1')).toBe('/Users/yihengtao');
    });

    it('derives a Linux home prefix', () => {
        expect(deriveHomeDir('/home/remote/.coc/repos/ws-2')).toBe('/home/remote');
    });

    it('derives a Windows home prefix (backslashes normalized)', () => {
        expect(deriveHomeDir('C:\\Users\\dev\\.coc\\repos\\ws-3')).toBe('C:/Users/dev');
    });

    it('returns null for a non-home-rooted path', () => {
        expect(deriveHomeDir('/opt/repos/ws')).toBeNull();
    });

    it('returns null for null/undefined/empty input', () => {
        expect(deriveHomeDir(null)).toBeNull();
        expect(deriveHomeDir(undefined)).toBeNull();
        expect(deriveHomeDir('')).toBeNull();
    });
});

describe('deriveHomeDirFromWorkspaces', () => {
    const WS = [
        { id: 'ws-local', rootPath: '/Users/local/.coc/repos/ws-local' },
        { id: 'ws-remote', rootPath: '/home/remote/.coc/repos/ws-remote' },
    ];

    it('prefers the hinted workspace home (multi-repo: remote-clone home)', () => {
        expect(deriveHomeDirFromWorkspaces('ws-remote', WS)).toBe('/home/remote');
    });

    it('falls back to any home-rooted workspace when the hint is unknown', () => {
        expect(deriveHomeDirFromWorkspaces('nope', WS)).toBe('/Users/local');
    });

    it('falls back to any home-rooted workspace when no hint is given', () => {
        expect(deriveHomeDirFromWorkspaces(undefined, WS)).toBe('/Users/local');
    });

    it('skips the hinted workspace when it is not home-rooted', () => {
        const mixed = [
            { id: 'ws-opt', rootPath: '/opt/repos/ws-opt' },
            { id: 'ws-home', rootPath: '/Users/dev/.coc/repos/ws-home' },
        ];
        expect(deriveHomeDirFromWorkspaces('ws-opt', mixed)).toBe('/Users/dev');
    });

    it('returns null when no workspace is home-rooted', () => {
        expect(deriveHomeDirFromWorkspaces('x', [{ id: 'x', rootPath: '/opt/x' }])).toBeNull();
    });
});

describe('expandTildePath', () => {
    it('expands `~/...` against the home dir', () => {
        expect(expandTildePath('~/.coc/repos/ws/notes/x.md', '/Users/u')).toBe(
            '/Users/u/.coc/repos/ws/notes/x.md',
        );
    });

    it('expands a bare `~` to the home dir', () => {
        expect(expandTildePath('~', '/Users/u')).toBe('/Users/u');
    });

    it('expands `~\\...` (Windows separator)', () => {
        expect(expandTildePath('~\\notes\\x.md', 'C:/Users/u')).toBe('C:/Users/u/notes\\x.md');
    });

    it('trims a trailing slash on the home dir before joining', () => {
        expect(expandTildePath('~/x.md', '/Users/u/')).toBe('/Users/u/x.md');
    });

    it('leaves non-tilde paths unchanged', () => {
        expect(expandTildePath('/abs/x.md', '/Users/u')).toBe('/abs/x.md');
        expect(expandTildePath('rel/x.md', '/Users/u')).toBe('rel/x.md');
        expect(expandTildePath('~tilde-name/x.md', '/Users/u')).toBe('~tilde-name/x.md');
    });

    it('is a no-op when the home dir is unknown', () => {
        expect(expandTildePath('~/x.md', null)).toBe('~/x.md');
        expect(expandTildePath('~/x.md', '')).toBe('~/x.md');
    });
});
