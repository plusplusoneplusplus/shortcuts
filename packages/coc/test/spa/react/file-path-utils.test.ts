/**
 * Tests for shared file-path utilities: shortenFilePath, FILE_PATH_RE, linkifyFilePaths.
 */

import { describe, it, expect } from 'vitest';
import { shortenFilePath, FILE_PATH_RE, linkifyFilePaths } from '../../../src/server/spa/client/react/shared/file-path-utils';

describe('shortenFilePath', () => {
    it('returns empty string for empty input', () => {
        expect(shortenFilePath('')).toBe('');
    });

    it('returns empty string for falsy input', () => {
        expect(shortenFilePath(null as any)).toBe('');
        expect(shortenFilePath(undefined as any)).toBe('');
    });

    it('shortens macOS home paths', () => {
        expect(shortenFilePath('/Users/alice/projects/foo.ts')).toBe('~/projects/foo.ts');
    });

    it('shortens macOS Documents/Projects paths', () => {
        expect(shortenFilePath('/Users/alice/Documents/Projects/repo/src/app.ts'))
            .toBe('repo/src/app.ts');
    });

    it('shortens Linux home paths', () => {
        expect(shortenFilePath('/home/bob/code/bar.ts')).toBe('~/code/bar.ts');
    });

    it('shortens Windows drive + Users paths', () => {
        expect(shortenFilePath('C:/Users/carol/code/baz.ts')).toBe('~/code/baz.ts');
    });

    it('shortens Windows drive + Documents/Projects paths', () => {
        expect(shortenFilePath('D:/Users/carol/Documents/Projects/repo/main.ts'))
            .toBe('repo/main.ts');
    });

    it('leaves non-home paths unchanged', () => {
        expect(shortenFilePath('/var/log/syslog')).toBe('/var/log/syslog');
    });
});

describe('FILE_PATH_RE', () => {
    function findPaths(text: string): string[] {
        return [...text.matchAll(FILE_PATH_RE)].map(m => m[0]);
    }

    it('matches Unix absolute paths', () => {
        expect(findPaths('file at /Users/alice/code/foo.ts here'))
            .toEqual(['/Users/alice/code/foo.ts']);
    });

    it('matches /home paths', () => {
        expect(findPaths('see /home/bob/projects/bar.js'))
            .toEqual(['/home/bob/projects/bar.js']);
    });

    it('matches /tmp paths', () => {
        expect(findPaths('log: /tmp/output.log'))
            .toEqual(['/tmp/output.log']);
    });

    it('matches Windows drive paths', () => {
        expect(findPaths('opened C:\\Users\\alice\\file.ts'))
            .toEqual(['C:\\Users\\alice\\file.ts']);
    });

    it('matches Windows forward-slash paths', () => {
        expect(findPaths('opened D:/projects/repo/src/app.ts'))
            .toEqual(['D:/projects/repo/src/app.ts']);
    });

    it('returns empty for no paths', () => {
        expect(findPaths('just some text with no paths')).toEqual([]);
    });
});

describe('linkifyFilePaths', () => {
    it('wraps file paths in .file-path-link spans', () => {
        const html = 'open /Users/alice/code/app.ts now';
        const result = linkifyFilePaths(html);
        expect(result).toContain('class="file-path-link"');
        expect(result).toContain('data-full-path="/Users/alice/code/app.ts"');
    });

    it('uses shortened display text', () => {
        const result = linkifyFilePaths('see /Users/alice/code/foo.ts');
        expect(result).toContain('>~/code/foo.ts</span>');
    });

    it('does not linkify paths inside <code> blocks', () => {
        const html = '<code>/Users/alice/code/app.ts</code>';
        const result = linkifyFilePaths(html);
        expect(result).not.toContain('file-path-link');
        expect(result).toBe(html);
    });

    it('does not linkify paths inside <pre> blocks', () => {
        const html = '<pre>/Users/alice/code/app.ts</pre>';
        const result = linkifyFilePaths(html);
        expect(result).not.toContain('file-path-link');
    });

    it('linkifies paths outside code but not inside', () => {
        const html = '/Users/alice/a.ts and <code>/Users/alice/b.ts</code>';
        const result = linkifyFilePaths(html);
        expect(result).toContain('data-full-path="/Users/alice/a.ts"');
        expect(result).not.toContain('data-full-path="/Users/alice/b.ts"');
    });

    it('normalizes Windows backslash paths to forward slashes', () => {
        const html = 'file C:\\Users\\alice\\app.ts here';
        const result = linkifyFilePaths(html);
        expect(result).toContain('data-full-path="C:/Users/alice/app.ts"');
    });

    it('handles html without paths', () => {
        const html = '<p>Hello <strong>world</strong></p>';
        expect(linkifyFilePaths(html)).toBe(html);
    });

    it('handles empty input', () => {
        expect(linkifyFilePaths('')).toBe('');
    });
});
