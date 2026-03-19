import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// Mock the logger so glob-utils.ts doesn't need a real logger setup
vi.mock('../../src/logger', () => ({
    getLogger: () => ({
        warn: vi.fn(),
        info: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
    }),
    LogCategory: { UTILS: 'utils' },
}));

import { glob, getFilesWithExtension } from '../../src/utils/glob-utils';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tmpDir: string;

function createFile(relPath: string, content = ''): void {
    const abs = path.join(tmpDir, relPath);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
}

beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-glob-test-'));
});

afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// glob()
// ---------------------------------------------------------------------------

describe('glob', () => {
    it('returns only files matching the extension', () => {
        createFile('a.md');
        createFile('sub/b.ts');
        createFile('c.md');

        const files = glob('**/*.md', tmpDir);

        const names = files.map((f) => path.basename(f));
        expect(names).toContain('a.md');
        expect(names).toContain('c.md');
        expect(names).not.toContain('b.ts');
    });

    it('finds files recursively in nested directories', () => {
        createFile('dir1/dir2/deep.md');

        const files = glob('**/*.md', tmpDir);

        expect(files.some((f) => f.endsWith(path.join('dir1', 'dir2', 'deep.md')))).toBe(true);
    });

    it('skips node_modules directories', () => {
        createFile('src/app.ts');
        createFile('node_modules/lib.ts');

        const files = glob('**/*.ts', tmpDir);

        expect(files.some((f) => f.includes('node_modules'))).toBe(false);
        expect(files.some((f) => f.endsWith('app.ts'))).toBe(true);
    });

    it('skips hidden directories (dot-prefixed)', () => {
        createFile('.git/config');
        createFile('src/main.ts');

        const files = glob('**/*.ts', tmpDir);

        expect(files.some((f) => f.includes('.git'))).toBe(false);
        expect(files.some((f) => f.endsWith('main.ts'))).toBe(true);
    });

    it('returns all files when pattern has no recognised extension', () => {
        createFile('a.md');
        createFile('b.ts');
        createFile('c.json');

        const files = glob('**/*', tmpDir);

        const names = files.map((f) => path.basename(f));
        expect(names).toContain('a.md');
        expect(names).toContain('b.ts');
        expect(names).toContain('c.json');
    });

    it('returns empty array when baseDir does not exist (no throw)', () => {
        const nonExistent = path.join(tmpDir, 'does-not-exist');
        expect(() => glob('**/*.md', nonExistent)).not.toThrow();
        expect(glob('**/*.md', nonExistent)).toEqual([]);
    });

    it('handles permission errors on subdirectory by skipping it (no throw)', () => {
        createFile('readable/file.md');
        const restrictedDir = path.join(tmpDir, 'restricted');
        fs.mkdirSync(restrictedDir);
        createFile('restricted/hidden.md');

        // Make the subdirectory unreadable on non-Windows platforms
        if (process.platform !== 'win32') {
            fs.chmodSync(restrictedDir, 0o000);
        }

        try {
            expect(() => glob('**/*.md', tmpDir)).not.toThrow();
            const files = glob('**/*.md', tmpDir);
            // The readable file should still be found
            expect(files.some((f) => f.endsWith('file.md'))).toBe(true);
        } finally {
            // Restore permissions so afterEach cleanup can remove the dir
            if (process.platform !== 'win32') {
                fs.chmodSync(restrictedDir, 0o755);
            }
        }
    });
});

// ---------------------------------------------------------------------------
// getFilesWithExtension()
// ---------------------------------------------------------------------------

describe('getFilesWithExtension', () => {
    it('returns only files with the given extension', () => {
        createFile('readme.md');
        createFile('script.ts');
        createFile('docs/guide.md');

        const files = getFilesWithExtension(tmpDir, '.md');

        const names = files.map((f) => path.basename(f));
        expect(names).toContain('readme.md');
        expect(names).toContain('guide.md');
        expect(names).not.toContain('script.ts');
    });

    it('produces the same results as glob with the corresponding pattern', () => {
        createFile('a.md');
        createFile('b.ts');

        const viaHelper = getFilesWithExtension(tmpDir, '.md');
        const viaGlob = glob('**/*.md', tmpDir);

        expect(viaHelper.sort()).toEqual(viaGlob.sort());
    });

    it('returns empty array for a directory with no matching files', () => {
        createFile('only.ts');
        expect(getFilesWithExtension(tmpDir, '.md')).toEqual([]);
    });
});
