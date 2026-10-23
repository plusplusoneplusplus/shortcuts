import { describe, expect, it } from 'vitest';
import { resolveDiffDefinitionRoute } from '../../../../../../src/server/spa/client/react/features/git/diff/diffDefinitionRoute';

const base = {
    workspaceId: 'ws-a',
    filePath: 'src/a.ts',
    reviewFiles: ['src/a.ts', 'src/b.ts'],
};
const target = (path: string, extra: Record<string, unknown> = {}) =>
    ({ workspaceId: 'ws-a', path, line: 12, column: 4, ...extra });

describe('resolveDiffDefinitionRoute', () => {
    it('stays in the same diff side for a target in the shown file', () => {
        expect(resolveDiffDefinitionRoute({ ...base, target: target('src/a.ts'), side: 'original' }))
            .toEqual({ kind: 'same-file', side: 'original', line: 12, column: 4 });
    });

    it('switches to another changed file of the review on the same side', () => {
        expect(resolveDiffDefinitionRoute({ ...base, target: target('src/b.ts'), side: 'original' }))
            .toEqual({ kind: 'review-file', path: 'src/b.ts', side: 'original', line: 12, column: 4 });
    });

    it('opens any other file in the Explorer, keeping symbol-index provenance', () => {
        expect(resolveDiffDefinitionRoute({ ...base, target: target('lib/c.ts', { symbolCandidate: true }), side: 'modified' }))
            .toEqual({ kind: 'explorer', path: 'lib/c.ts', line: 12, column: 4, symbolCandidate: true });
        expect(resolveDiffDefinitionRoute({ ...base, target: target('lib/c.ts') }))
            .toEqual({ kind: 'explorer', path: 'lib/c.ts', line: 12, column: 4 });
    });

    it('treats a full-language jump without a side as the modified side', () => {
        expect(resolveDiffDefinitionRoute({ ...base, target: target('src/b.ts') }))
            .toMatchObject({ kind: 'review-file', side: 'modified' });
    });

    it('matches review paths regardless of separators and leading ./', () => {
        expect(resolveDiffDefinitionRoute({ ...base, reviewFiles: ['src\\b.ts'], target: target('./src/b.ts') }))
            .toMatchObject({ kind: 'review-file', path: 'src\\b.ts' });
        expect(resolveDiffDefinitionRoute({ ...base, filePath: './src/a.ts', target: target('src/a.ts') }))
            .toMatchObject({ kind: 'same-file' });
    });

    it('declines targets in another workspace or without a path', () => {
        expect(resolveDiffDefinitionRoute({ ...base, target: { ...target('src/b.ts'), workspaceId: 'ws-b' } })).toBeNull();
        expect(resolveDiffDefinitionRoute({ ...base, target: target('') })).toBeNull();
    });
});
