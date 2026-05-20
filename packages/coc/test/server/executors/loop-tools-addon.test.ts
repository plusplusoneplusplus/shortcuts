/**
 * Tests for buildLoopToolsAddon from prompt-builder.
 */

import { describe, it, expect, vi } from 'vitest';
import { buildLoopToolsAddon } from '../../../src/server/executors/prompt-builder';

function makeMockLoopToolDeps() {
    return {
        store: {
            insert: vi.fn(),
            getById: vi.fn(),
            getByProcess: vi.fn().mockReturnValue([]),
            update: vi.fn(),
            getActive: vi.fn().mockReturnValue([]),
        } as any,
        executor: {
            armTimer: vi.fn(),
            disarmTimer: vi.fn(),
        } as any,
        processId: 'proc-test',
        resolveWorkspaceId: vi.fn().mockResolvedValue('ws-test'),
    };
}

describe('buildLoopToolsAddon', () => {
    it('returns empty tools and suffix when deps are undefined', () => {
        const result = buildLoopToolsAddon(undefined);
        expect(result.tools).toEqual([]);
        expect(result.suffix).toBe('');
    });

    it('returns createLoop, cancelLoop, listLoops tools when deps provided', () => {
        const deps = makeMockLoopToolDeps();
        const result = buildLoopToolsAddon(deps);

        expect(result.tools).toHaveLength(3);
        const names = result.tools.map(t => t.name);
        expect(names).toContain('createLoop');
        expect(names).toContain('cancelLoop');
        expect(names).toContain('listLoops');
    });

    it('includes descriptive suffix about loop tools', () => {
        const deps = makeMockLoopToolDeps();
        const result = buildLoopToolsAddon(deps);

        expect(result.suffix).toContain('Loop management tools');
        expect(result.suffix).toContain('createLoop');
        expect(result.suffix).toContain('cancelLoop');
        expect(result.suffix).toContain('listLoops');
        expect(result.suffix).toContain('/loop skill');
    });

    it('instructs leading interval loop requests to prefer createLoop over scheduleWakeup', () => {
        const deps = makeMockLoopToolDeps();
        const result = buildLoopToolsAddon(deps);

        expect(result.suffix).toContain('fixed-interval');
        expect(result.suffix).toContain('call `createLoop`');
        expect(result.suffix).toContain('Do not use `scheduleWakeup` for this pattern');
    });
});
