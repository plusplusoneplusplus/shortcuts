import { describe, expect, it } from 'vitest';
import { parseFullDiffAsync } from '../../src/diff/diff-utils';

const quoted = 'diff --git "a/caf\\303\\251" "b/caf\\303\\251"\n@@ -1 +1 @@\n---old\n+++new\n';
const empty = 'diff --git a/empty b/empty\nnew file mode 100644\n';

describe('native async diff conversion', () => {
    it('maps corrected paths, empty-file metadata and hunk statistics to public shapes', async () => {
        const { files, contentByPath } = await parseFullDiffAsync(empty + quoted);
        expect(files).toEqual([
            { path: 'café', status: 'modified', additions: 1, deletions: 1, isBinary: false },
            { path: 'empty', status: 'added', additions: 0, deletions: 0, isBinary: false },
        ]);
        expect(contentByPath.get('café')).toEqual({
            raw: quoted, truncated: false, totalLines: quoted.split('\n').length,
        });
        expect([...contentByPath.keys()]).toEqual(['empty', 'café']);
    });

    it('retains localeCompare file ordering and optional rename paths', async () => {
        const paths = ['z', '_first', 'a', 'Ä', 'A'];
        const raw = paths.map(path => `diff --git a/${path} b/${path}\nold mode 100644\nnew mode 100755\n`).join('');
        const result = await parseFullDiffAsync(raw +
            'diff --git a/old b/new\nrename from old\nrename to new\n');
        expect(result.files.map(file => file.path)).toEqual([...paths, 'new'].sort((a, b) => a.localeCompare(b)));
        expect(result.files.find(file => file.path === 'new')).toMatchObject({ originalPath: 'old', status: 'renamed' });
        expect(result.contentByPath.get('new')?.raw).toContain('rename from old');
    });

    it('returns independent maps for concurrent sources and handles empty input', async () => {
        const results = await Promise.all([parseFullDiffAsync(empty), parseFullDiffAsync(quoted), parseFullDiffAsync('')]);
        expect([...results[0].contentByPath.keys()]).toEqual(['empty']);
        expect([...results[1].contentByPath.keys()]).toEqual(['café']);
        expect(results[2]).toEqual({ files: [], contentByPath: new Map() });
    });
});
