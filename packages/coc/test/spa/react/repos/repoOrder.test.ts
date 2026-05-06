import { describe, expect, it } from 'vitest';
import {
    materializeRepoTabOrder,
    moveRepoTabOrder,
    moveRepoTabOrderToIndex,
    resolveRepoTabOrder,
    sanitizeRepoTabOrder,
} from '../../../../src/server/spa/client/react/repos/repoOrder';

const makeRepo = (id: string, name = id) => ({
    workspace: { id, name, rootPath: `C:\\repos\\${id}` },
    stats: { success: 0, failed: 0, running: 0 },
    workflows: [],
    taskCount: 0,
});

describe('repoOrder', () => {
    it('sanitizes saved repo tab order by dropping unknowns and duplicates', () => {
        expect(sanitizeRepoTabOrder(['r2', 'missing', 'r2', '', 'r1'], ['r1', 'r2']))
            .toEqual(['r2', 'r1']);
    });

    it('resolves saved repo order first and appends new repos in registration order', () => {
        const repos = [makeRepo('r1', 'Alpha'), makeRepo('r2', 'Beta'), makeRepo('r3', 'Gamma')];
        expect(resolveRepoTabOrder(repos, ['r3', 'r1']).map(repo => repo.workspace.name))
            .toEqual(['Gamma', 'Alpha', 'Beta']);
    });

    it('materializes the full current repo order for persistence', () => {
        expect(materializeRepoTabOrder([makeRepo('r1'), makeRepo('r2')])).toEqual(['r1', 'r2']);
    });

    it('moves a dragged repo before or after a target repo', () => {
        expect(moveRepoTabOrder(['r1', 'r2', 'r3', 'r4'], 'r1', 'r3', 'after'))
            .toEqual(['r2', 'r3', 'r1', 'r4']);
        expect(moveRepoTabOrder(['r1', 'r2', 'r3', 'r4'], 'r4', 'r2', 'before'))
            .toEqual(['r1', 'r4', 'r2', 'r3']);
    });

    it('moves a repo to a clamped index for list controls', () => {
        expect(moveRepoTabOrderToIndex(['r1', 'r2', 'r3'], 'r1', 2)).toEqual(['r2', 'r3', 'r1']);
        expect(moveRepoTabOrderToIndex(['r1', 'r2', 'r3'], 'r3', -1)).toEqual(['r3', 'r1', 'r2']);
    });
});
