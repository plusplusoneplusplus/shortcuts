import { describe, it, expect } from 'vitest';
import { buildUnifiedDiff } from '../../src/ado/diff-builder';

describe('buildUnifiedDiff', () => {
    it('returns a unified diff for a simple edit', () => {
        const base = 'line1\nline2\nline3\n';
        const head = 'line1\nchanged\nline3\n';

        const result = buildUnifiedDiff('src/foo.ts', undefined, base, head);

        expect(result).toContain('--- a/src/foo.ts');
        expect(result).toContain('+++ b/src/foo.ts');
        expect(result).toMatch(/^@@.+@@/m);
        expect(result).toContain('-line2');
        expect(result).toContain('+changed');
    });

    it('strips a leading slash from the ADO file path', () => {
        const base = 'hello\n';
        const head = 'world\n';

        const result = buildUnifiedDiff('/src/foo.ts', undefined, base, head);

        expect(result).toContain('--- a/src/foo.ts');
        expect(result).toContain('+++ b/src/foo.ts');
    });

    it('uses /dev/null as oldFileName for an added file', () => {
        const result = buildUnifiedDiff('src/new.ts', undefined, '', 'export const x = 1;\n');

        expect(result).toContain('--- /dev/null');
        expect(result).toContain('+++ b/src/new.ts');
        expect(result).toContain('+export const x = 1;');
    });

    it('uses /dev/null as newFileName for a deleted file', () => {
        const result = buildUnifiedDiff('src/old.ts', undefined, 'export const x = 1;\n', '');

        expect(result).toContain('--- a/src/old.ts');
        expect(result).toContain('+++ /dev/null');
        expect(result).toContain('-export const x = 1;');
    });

    it('uses originalPath for the a/ header when the file was renamed', () => {
        const base = 'content\n';
        const head = 'content\nmore\n';

        const result = buildUnifiedDiff(
            'src/newName.ts',
            'src/oldName.ts',
            base,
            head,
        );

        expect(result).toContain('--- a/src/oldName.ts');
        expect(result).toContain('+++ b/src/newName.ts');
    });

    it('returns a string with no hunks when content is identical', () => {
        const content = 'unchanged\n';

        const result = buildUnifiedDiff('src/same.ts', undefined, content, content);

        // createTwoFilesPatch returns only the header lines with no @@ hunks
        expect(result).not.toMatch(/^@@/m);
        expect(result).not.toContain('+unchanged');
        expect(result).not.toContain('-unchanged');
    });
});
