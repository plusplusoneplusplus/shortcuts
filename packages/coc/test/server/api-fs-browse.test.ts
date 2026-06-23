/**
 * Tests for browseDirectory() — directory listing with symlink support.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { browseDirectory } from '../../src/server/routes/api-fs-routes';

let tmpDir: string;

beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-browse-'));
});

afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('browseDirectory', () => {
    it('returns null for a non-existent path', async () => {
        expect(await browseDirectory(path.join(tmpDir, 'nope'))).toBeNull();
    });

    it('returns null for a file path', async () => {
        const f = path.join(tmpDir, 'file.txt');
        fs.writeFileSync(f, 'hi');
        expect(await browseDirectory(f)).toBeNull();
    });

    it('lists plain subdirectories', async () => {
        fs.mkdirSync(path.join(tmpDir, 'alpha'));
        fs.mkdirSync(path.join(tmpDir, 'beta'));
        fs.writeFileSync(path.join(tmpDir, 'readme.md'), '');

        const result = await browseDirectory(tmpDir);
        expect(result).not.toBeNull();
        expect(result!.entries.map(e => e.name)).toEqual(['alpha', 'beta']);
    });

    it('detects git repos via .git directory', async () => {
        const repo = path.join(tmpDir, 'my-repo');
        fs.mkdirSync(path.join(repo, '.git'), { recursive: true });

        const result = (await browseDirectory(tmpDir))!;
        const entry = result.entries.find(e => e.name === 'my-repo');
        expect(entry).toBeDefined();
        expect(entry!.isGitRepo).toBe(true);
    });

    it('hides dot-prefixed directories by default', async () => {
        fs.mkdirSync(path.join(tmpDir, '.hidden'));
        fs.mkdirSync(path.join(tmpDir, 'visible'));

        const result = (await browseDirectory(tmpDir))!;
        expect(result.entries.map(e => e.name)).toEqual(['visible']);
    });

    it('shows dot-prefixed directories when showHidden=true', async () => {
        fs.mkdirSync(path.join(tmpDir, '.hidden'));
        fs.mkdirSync(path.join(tmpDir, 'visible'));

        const result = (await browseDirectory(tmpDir, true))!;
        expect(result.entries.map(e => e.name)).toEqual(['.hidden', 'visible']);
    });

    it('returns entries sorted alphabetically', async () => {
        fs.mkdirSync(path.join(tmpDir, 'zebra'));
        fs.mkdirSync(path.join(tmpDir, 'alpha'));
        fs.mkdirSync(path.join(tmpDir, 'mango'));

        const result = (await browseDirectory(tmpDir))!;
        expect(result.entries.map(e => e.name)).toEqual(['alpha', 'mango', 'zebra']);
    });

    it('returns parent path for non-root directories', async () => {
        const child = path.join(tmpDir, 'child');
        fs.mkdirSync(child);

        const result = (await browseDirectory(child))!;
        expect(result.parent).toBe(tmpDir);
    });

    // ── Symlink tests ───────────────────────────────────────────────────

    it.skipIf(process.platform === 'win32')('includes symlinked directories', async () => {
        const realDir = path.join(tmpDir, 'real-dir');
        fs.mkdirSync(realDir);

        const link = path.join(tmpDir, 'linked-dir');
        fs.symlinkSync(realDir, link);

        const result = (await browseDirectory(tmpDir))!;
        const names = result.entries.map(e => e.name);
        expect(names).toContain('real-dir');
        expect(names).toContain('linked-dir');
    });

    it('excludes symlinks that point to files', async () => {
        const realFile = path.join(tmpDir, 'real-file.txt');
        fs.writeFileSync(realFile, 'data');

        const link = path.join(tmpDir, 'link-to-file');
        fs.symlinkSync(realFile, link);

        const result = (await browseDirectory(tmpDir))!;
        expect(result.entries.map(e => e.name)).toEqual([]);
    });

    it('gracefully skips broken symlinks', async () => {
        fs.mkdirSync(path.join(tmpDir, 'good'));

        const broken = path.join(tmpDir, 'broken-link');
        fs.symlinkSync(path.join(tmpDir, 'does-not-exist'), broken);

        const result = (await browseDirectory(tmpDir))!;
        expect(result.entries.map(e => e.name)).toEqual(['good']);
    });

    it.skipIf(process.platform === 'win32')('detects git repo through a symlinked directory', async () => {
        const realRepo = path.join(tmpDir, '_real_repo');
        fs.mkdirSync(path.join(realRepo, '.git'), { recursive: true });

        const link = path.join(tmpDir, 'linked-repo');
        fs.symlinkSync(realRepo, link);

        const result = (await browseDirectory(tmpDir))!;
        const linked = result.entries.find(e => e.name === 'linked-repo');
        expect(linked).toBeDefined();
        expect(linked!.isGitRepo).toBe(true);
    });

    it.skipIf(process.platform === 'win32')('handles a mix of dirs, symlinks, files, and broken symlinks', async () => {
        // Normal directory
        fs.mkdirSync(path.join(tmpDir, 'normal'));
        // Symlink to directory
        const target = path.join(tmpDir, '_target');
        fs.mkdirSync(target);
        fs.symlinkSync(target, path.join(tmpDir, 'sym-dir'));
        // Symlink to file
        const f = path.join(tmpDir, '_file.txt');
        fs.writeFileSync(f, '');
        fs.symlinkSync(f, path.join(tmpDir, 'sym-file'));
        // Broken symlink
        fs.symlinkSync('/no/such/path', path.join(tmpDir, 'sym-broken'));
        // Regular file
        fs.writeFileSync(path.join(tmpDir, 'readme.md'), '');

        const result = (await browseDirectory(tmpDir))!;
        const names = result.entries.map(e => e.name);
        // Only directories (real + symlinked) should appear; files and broken links excluded
        // _target is also a real dir so it shows up
        expect(names).toEqual(['_target', 'normal', 'sym-dir']);
    });
});
