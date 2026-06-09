import { describe, expect, it } from 'vitest';
import type { AutoFolderContext } from '@plusplusoneplusplus/forge';
import { buildRalphGrillSuffix } from '../../../src/server/executors/chat-base-executor';

describe('buildRalphGrillSuffix', () => {
    const autoFolderContext = {
        tasksRoot: '/tmp/coc/notes/Plans',
        existingFolders: ['frontend', 'archive/old'],
    } as AutoFolderContext;

    it('keeps the Notes goal-file directive for ordinary Ralph grilling', () => {
        const suffix = buildRalphGrillSuffix(autoFolderContext);

        expect(suffix).toContain('/tmp/coc/notes/Plans/<chosen-folder>/<descriptive-name>.goal.md');
        expect(suffix).toContain('Existing folders: frontend');
    });

    it('suppresses Notes goal-file output for Work Item Goal grilling', () => {
        const suffix = buildRalphGrillSuffix(autoFolderContext, {
            workItemGoal: {
                workspaceId: 'ws-1',
                workItemId: 'goal-1',
                title: 'Ship durable goals',
            },
        });

        expect(suffix).toContain('Work Item Goal "Ship durable goals"');
        expect(suffix).toContain('Do not create or require a Notes-backed `.goal.md` file');
        expect(suffix).toContain('save it as an immutable Goal content version');
        expect(suffix).not.toContain('/tmp/coc/notes/Plans');
    });
});
