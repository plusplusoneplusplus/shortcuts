import { describe, it, expect } from 'vitest';
import { loadNativeGit } from '@plusplusoneplusplus/coc-native';

const api = loadNativeGit();
const build = (before: string, after: string, extra = {}) => api.buildRemoteGitPatch([{
    path: '/src/file.ts', before, after, beforeExists: true, afterExists: true, ...extra,
}]);

describe('Rust remote patch construction', () => {
    it('renders edited text and preserves CRLF and missing-newline markers', async () => {
        const patch = await build('old\r\nlast', 'new\r\nlast');
        expect(patch).toContain('-old\r\n+new\r\n');
        expect(patch).toContain('\\ No newline at end of file');
        expect(await api.parseGitPatch(patch)).toMatchObject([{ path: 'src/file.ts', additions: 1, deletions: 1 }]);
    });

    it('distinguishes an empty existing file from additions and deletions', async () => {
        expect(await build('', 'text\n')).not.toContain('/dev/null');
        expect(await build('text\n', '')).not.toContain('/dev/null');
        for (const extra of [{ beforeExists: false }, { afterExists: false }]) {
            const patch = await build('', '', extra);
            expect(await api.parseGitPatch(patch)).toMatchObject([{
                status: extra.beforeExists === false ? 'added' : 'deleted', isBinary: false,
            }]);
        }
        expect(await build('', '')).toBe('');
    });

    it('keeps metadata-only rename and mode changes', async () => {
        const patch = await build('same\n', 'same\n', {
            originalPath: '/src/old.ts', beforeMode: '100644', afterMode: '100755',
        });
        expect(patch).toContain('old mode 100644\nnew mode 100755');
        expect(await api.parseGitPatch(patch)).toMatchObject([{
            path: 'src/file.ts', originalPath: 'src/old.ts', status: 'renamed', isBinary: false,
        }]);
    });

    it('quotes unusual paths and retains header-like hunk content', async () => {
        const patch = await build('--old\n', '++new\n', { path: '/café\t"name.txt' });
        expect(await api.parseGitPatch(patch)).toMatchObject([{
            path: 'café\t"name.txt', additions: 1, deletions: 1,
        }]);
    });

    it('classifies explicit and NUL-detected binary files using real labels', async () => {
        for (const extra of [{}, { isBinary: true }]) {
            const patch = await build('a\0b', 'b\0c', extra);
            expect(patch).toContain('Binary files a/src/file.ts and b/src/file.ts differ');
            expect(patch).not.toContain('codex-file-diff-');
            expect(await api.parseGitPatch(patch)).toMatchObject([{ isBinary: true }]);
        }
    });

    it('isolates concurrent batches with identical paths', async () => {
        const results = await Promise.all([build('old\n', 'workspace-one\n'), build('old\n', 'workspace-two\n')]);
        expect(results[0]).toContain('+workspace-one');
        expect(results[0]).not.toContain('workspace-two');
        expect(results[1]).toContain('+workspace-two');
    });
});
