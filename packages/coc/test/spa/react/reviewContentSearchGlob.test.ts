import { describe, expect, it, vi } from 'vitest';
import { compileReviewContentInclude } from '../../../src/server/spa/client/react/features/git/diff/reviewContentSearchGlob';
import { ReviewContentSearchController } from '../../../src/server/spa/client/react/features/git/diff/reviewContentSearchController';
import { DEFAULT_CONTENT_SEARCH_MODES } from '../../../src/server/spa/client/react/features/repo-detail/explorer/types';

function includes(glob: string, path: string): boolean {
    const compiled = compileReviewContentInclude(glob);
    expect(compiled.error).toBeNull();
    return compiled.includes!(path);
}

describe('review content include globs', () => {
    it('shares Explorer comma-list trimming, ignores empty entries and includes all for a blank list', () => {
        expect(includes(' , , ', '.hidden/file')).toBe(true);
        expect(includes(' *.ts, , *.tsx, ', 'src/a.tsx')).toBe(true);
        expect(includes(' *.ts, , *.tsx, ', 'src/a.js')).toBe(false);
    });

    it.each([
        ['*.ts', 'a.ts', true], ['*.ts', 'src/a.ts', true],
        ['*.ts', 'src/a.ts/map.js', false], ['*.ts', 'src/a.TS', false],
        ['src/*.ts', 'src/a.ts', true], ['src/*.ts', 'src/nested/a.ts', false],
        ['src/*.ts', 'other/src/a.ts', false], ['/a.ts', 'a.ts', true],
        ['/a.ts', 'src/a.ts', false], ['./a.ts', 'src/a.ts', false],
        ['./a.ts', 'a.ts', true], ['**/*.ts', 'a.ts', true],
        ['**/*.ts', 'src/nested/a.ts', true], ['src/**/a.ts', 'src/a.ts', true],
        ['src/**/a.ts', 'src/nested/deep/a.ts', true], ['src/**', 'src/a\nb.ts', true],
        ['a**b.ts', 'a/nested/b.ts', false], ['?.ts', '😀.ts', true],
        ['?.ts', 'ab.ts', false], ['?.ts', 'src/a.ts', true],
        ['*.ts', '.hidden/.file.ts', true], ['src/**', 'src\\nested\\a.ts', true],
        ['**/.env', 'nested/.env', true], ['**', 'any/depth/file', true],
    ])('matches %s against %s as %s', (glob, path, expected) => {
        expect(includes(glob, path)).toBe(expected);
    });

    it('supports character classes and ranges without matching separators', () => {
        expect(includes('file[0-9].ts', 'src/file2.ts')).toBe(true);
        expect(includes('file[!0-9].ts', 'filea.ts')).toBe(true);
        expect(includes('file[^0-9].ts', 'file2.ts')).toBe(false);
        expect(includes('src/[!x]a.ts', 'src//a.ts')).toBe(false);
        expect(includes('file[a-c].ts', 'filed.ts')).toBe(false);
        expect(includes('file[\\a].ts', 'filea.ts')).toBe(true);
    });

    it('treats regex punctuation and escaped wildcards as literal filename characters', () => {
        expect(includes('a+(b).ts', 'a+(b).ts')).toBe(true);
        expect(includes('a+(b).ts', 'aaab.ts')).toBe(false);
        expect(includes('file\\?.ts', 'file?.ts')).toBe(true);
        expect(includes('file\\*.ts', 'filex.ts')).toBe(false);
        expect(includes('file\\[x\\].ts', 'file[x].ts')).toBe(true);
    });

    it.each(['[', '[]', '[!]', '[z-a]', 'file\\', '[a\\'])('reports an invalid glob %s without throwing', glob => {
        expect(compileReviewContentInclude(glob)).toEqual({ error: expect.stringContaining('Invalid include glob:'), includes: null });
    });

    it('reuses a compiled predicate and filters before loading without losing cached contents', async () => {
        const files = [
            { id: 'staged:a', path: 'src/a.ts' }, { id: 'unstaged:a', path: 'src/a.ts' },
            { id: 'b', path: 'test/b.js' },
        ];
        const load = vi.fn(async () => ({
            path: 'a', fileName: 'a', language: 'text', binary: false, tooLarge: false,
            base: { content: 'target', exists: true, ref: 'base' },
            head: { content: 'target', exists: true, ref: 'head' },
        }));
        const controller = new ReviewContentSearchController(files, load);
        const filter = compileReviewContentInclude('src/**/*.ts').includes!;
        controller.start('target', DEFAULT_CONTENT_SEARCH_MODES, 'both', file => filter(file.path));
        await vi.waitFor(() => expect(controller.getSnapshot().running).toBe(false));
        expect(load.mock.calls).toHaveLength(2);
        expect(controller.getSnapshot()).toMatchObject({ searched: 2, total: 2 });
        expect(controller.getSnapshot().files.map(entry => entry.file.id)).toEqual(['staged:a', 'unstaged:a']);
        const all = compileReviewContentInclude('').includes!;
        controller.start('target', DEFAULT_CONTENT_SEARCH_MODES, 'old', file => all(file.path));
        await vi.waitFor(() => expect(controller.getSnapshot().running).toBe(false));
        expect(load.mock.calls).toHaveLength(3);
        expect(controller.getSnapshot().files.every(entry => entry.matches.length === 1)).toBe(true);
        controller.dispose();
    });
});
