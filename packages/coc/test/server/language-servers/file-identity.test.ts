import { afterEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { resolveFileIdentity } from '../../../src/server/language-servers/file-identity';

vi.mock('fs', async importOriginal => ({ ...await importOriginal<typeof import('fs')>() }));

const roots: string[] = [];
afterEach(() => { vi.restoreAllMocks(); for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
function directory() { const root = fs.mkdtempSync(path.join(os.tmpdir(), 'file-identity-')); roots.push(root); return root; }

describe('owning filesystem file identity', () => {
    it('preserves spelling, encoded characters and distinct case-sensitive names', () => {
        const root = directory();
        fs.writeFileSync(path.join(root, 'Mixed #%.ts'), 'one');
        expect(resolveFileIdentity(root, 'Mixed #%.ts')).toBe('Mixed #%.ts');
        // The actual filesystem may be case-insensitive on Windows/macOS.
        if (!fs.existsSync(path.join(root, 'mixed #%.ts'))) {
            fs.writeFileSync(path.join(root, 'mixed #%.ts'), 'two');
            expect(resolveFileIdentity(root, 'mixed #%.ts')).toBe('mixed #%.ts');
        }
    });

    it.each(['../secret', 'sub/../../secret', '/secret', '\\secret', 'C:\\secret', '\\\\server\\share\\secret', 'a/../b', ''])('rejects unsafe path %s', relative => {
        const read = vi.spyOn(fs, 'readdirSync');
        expect(() => resolveFileIdentity(directory(), relative)).toThrow();
        expect(read).not.toHaveBeenCalled();
    });

    it('rejects unavailable files and directories', () => {
        const root = directory();
        fs.mkdirSync(path.join(root, 'folder'));
        expect(() => resolveFileIdentity(root, 'missing')).toThrow();
        expect(() => resolveFileIdentity(root, 'folder')).toThrow('regular file');
    });

    it.each([false, true])('uses filesystem proof, including simulated Windows case-sensitive directories (%s)', sensitive => {
        const root = directory();
        const files = sensitive ? ['Name.ts', 'name.ts'] : ['Name.ts'];
        vi.spyOn(fs, 'readdirSync').mockImplementation(() => files as any);
        vi.spyOn(fs, 'lstatSync').mockImplementation((value: any) => {
            const name = path.basename(String(value));
            const index = files.findIndex(file => sensitive ? file === name : file.toLowerCase() === name.toLowerCase());
            if (index < 0) throw new Error('ENOENT');
            return { ino: BigInt(index + 1), dev: 1n } as any;
        });
        vi.spyOn(fs.realpathSync, 'native').mockImplementation((value: any) => String(value));
        vi.spyOn(fs, 'statSync').mockReturnValue({ isFile: () => true } as any);
        expect(resolveFileIdentity(root, 'Name.ts')).toBe('Name.ts');
        expect(resolveFileIdentity(root, 'name.ts')).toBe(sensitive ? 'name.ts' : 'Name.ts');
    });

    it('does not merge hard link names or symlink spellings', () => {
        const root = directory();
        fs.writeFileSync(path.join(root, 'one'), 'text');
        fs.linkSync(path.join(root, 'one'), path.join(root, 'two'));
        expect(resolveFileIdentity(root, 'one')).toBe('one');
        expect(resolveFileIdentity(root, 'two')).toBe('two');
        if (process.platform !== 'win32') {
            fs.symlinkSync('one', path.join(root, 'link'));
            expect(resolveFileIdentity(root, 'link')).toBe('link');
            fs.symlinkSync(directory(), path.join(root, 'outside'));
            expect(() => resolveFileIdentity(root, 'outside/file')).toThrow();
        }
    });
});


describe('Windows roots without a Windows host', () => {
    it.each(['C:\\Owner\\Repo', '\\\\server\\share\\Repo'])('resolves aliases under %s', async root => {
        vi.resetModules();
        vi.doMock('path', () => path.win32);
        const realpath = Object.assign((value: string) => value, { native: (value: string) => path.win32.resolve(value) });
        vi.doMock('fs', () => ({
            realpathSync: realpath,
            readdirSync: () => ['Mixed #%.ts'],
            lstatSync: () => ({ ino: 1n, dev: 1n }),
            statSync: () => ({ isFile: () => true }),
        }));
        try {
            const { resolveFileIdentity: resolveWindowsIdentity } = await import('../../../src/server/language-servers/file-identity');
            expect(resolveWindowsIdentity(root, 'mixed #%.ts')).toBe('Mixed #%.ts');
            expect(() => resolveWindowsIdentity(root, '..\\outside')).toThrow();
        } finally {
            vi.doUnmock('path');
            vi.doUnmock('fs');
            vi.resetModules();
        }
    });
});
