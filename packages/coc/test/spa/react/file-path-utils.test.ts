/**
 * Tests for shared file-path utilities: shortenFilePath, FILE_PATH_RE, linkifyFilePaths.
 */

import { describe, it, expect } from 'vitest';
import { shortenFilePath, FILE_PATH_RE, linkifyFilePaths, parseFilePathRef } from '../../../src/server/spa/client/react/shared/file-path-utils';

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

    it('matches Docker/Codespaces /workspace paths', () => {
        expect(findPaths('edit /workspace/project/src/file.ts please'))
            .toEqual(['/workspace/project/src/file.ts']);
    });

    it('matches /app paths (containerised apps)', () => {
        expect(findPaths('see /app/src/main.ts'))
            .toEqual(['/app/src/main.ts']);
    });

    it('matches /srv paths', () => {
        expect(findPaths('config at /srv/myservice/config.yaml'))
            .toEqual(['/srv/myservice/config.yaml']);
    });

    it('matches /root paths', () => {
        expect(findPaths('file at /root/project/file.ts'))
            .toEqual(['/root/project/file.ts']);
    });

    it('matches /build paths', () => {
        expect(findPaths('bundle at /build/output/bundle.js'))
            .toEqual(['/build/output/bundle.js']);
    });

    it('matches /data paths', () => {
        expect(findPaths('index at /data/repos/project/index.ts'))
            .toEqual(['/data/repos/project/index.ts']);
    });

    it('does not match URL path tails', () => {
        expect(findPaths('visit https://example.com/api/v1/users')).toEqual([]);
    });

    it('does not match single-component paths', () => {
        expect(findPaths('mount /workspace')).toEqual([]);
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

    it('linkifies /workspace paths', () => {
        const html = 'edit /workspace/project/src/file.ts please';
        const result = linkifyFilePaths(html);
        expect(result).toContain('data-full-path="/workspace/project/src/file.ts"');
    });

    it('linkifies /app, /srv, /root, /build, /data paths', () => {
        expect(linkifyFilePaths('/app/src/main.ts done')).toContain('data-full-path="/app/src/main.ts"');
        expect(linkifyFilePaths('/srv/svc/cfg.yaml')).toContain('data-full-path="/srv/svc/cfg.yaml"');
        expect(linkifyFilePaths('/root/proj/file.ts')).toContain('data-full-path="/root/proj/file.ts"');
        expect(linkifyFilePaths('/build/out/bundle.js')).toContain('data-full-path="/build/out/bundle.js"');
        expect(linkifyFilePaths('/data/repos/index.ts')).toContain('data-full-path="/data/repos/index.ts"');
    });

    it('does not linkify URL path tails', () => {
        const html = 'visit https://example.com/api/v1/users';
        expect(linkifyFilePaths(html)).not.toContain('file-path-link');
    });

    it('handles html without paths', () => {
        const html = '<p>Hello <strong>world</strong></p>';
        expect(linkifyFilePaths(html)).toBe(html);
    });

    it('handles empty input', () => {
        expect(linkifyFilePaths('')).toBe('');
    });
});

describe('parseFilePathRef', () => {
    it('returns a bare path unchanged when there is no line suffix', () => {
        expect(parseFilePathRef('/Users/alice/code/foo.ts')).toEqual({ path: '/Users/alice/code/foo.ts' });
    });

    it('parses a single :line suffix', () => {
        expect(parseFilePathRef('src/foo.ts:42')).toEqual({ path: 'src/foo.ts', line: 42 });
    });

    it('parses a :start-end range suffix', () => {
        expect(parseFilePathRef('src/foo.ts:42-58')).toEqual({ path: 'src/foo.ts', line: 42, endLine: 58 });
    });

    it('strips only the trailing numeric suffix, leaving interior colons', () => {
        expect(parseFilePathRef('/a:1/b.ts:7')).toEqual({ path: '/a:1/b.ts', line: 7 });
    });

    it('does not treat a Windows drive colon as a line suffix', () => {
        expect(parseFilePathRef('C:/Users/alice/app.ts')).toEqual({ path: 'C:/Users/alice/app.ts' });
    });

    it('ignores a dangling range dash with no end number', () => {
        expect(parseFilePathRef('/a/b.ts:42-')).toEqual({ path: '/a/b.ts:42-' });
    });
});

describe('linkifyFilePaths — line/range suffixes (AC-01)', () => {
    it('puts the bare path in data-full-path and the line in data-line', () => {
        const result = linkifyFilePaths('see /Users/alice/code/foo.ts:42 now');
        expect(result).toContain('data-full-path="/Users/alice/code/foo.ts"');
        expect(result).toContain('data-line="42"');
        expect(result).not.toContain('data-end-line');
        // bare path, no :42, inside data-full-path
        expect(result).not.toContain('data-full-path="/Users/alice/code/foo.ts:42"');
    });

    it('emits data-line and data-end-line for a :start-end range', () => {
        const result = linkifyFilePaths('see /Users/alice/code/foo.ts:42-58 now');
        expect(result).toContain('data-full-path="/Users/alice/code/foo.ts"');
        expect(result).toContain('data-line="42"');
        expect(result).toContain('data-end-line="58"');
    });

    it('keeps the :line suffix in the visible link text', () => {
        const result = linkifyFilePaths('see /Users/alice/code/foo.ts:42');
        expect(result).toContain('>~/code/foo.ts:42</span>');
    });

    it('leaves bare paths (no suffix) without line attributes', () => {
        const result = linkifyFilePaths('see /Users/alice/code/foo.ts');
        expect(result).toContain('data-full-path="/Users/alice/code/foo.ts"');
        expect(result).not.toContain('data-line');
        expect(result).not.toContain('data-end-line');
    });

    it('does not linkify a line-suffixed path inside a <code> block', () => {
        const html = '<code>/Users/alice/code/foo.ts:42</code>';
        const result = linkifyFilePaths(html);
        expect(result).not.toContain('file-path-link');
        expect(result).toBe(html);
    });
});
