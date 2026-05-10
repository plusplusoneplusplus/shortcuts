import { describe, expect, it } from 'vitest';
import { buildScratchpadCandidates } from '../../../../src/server/spa/client/react/features/chat/scratchpad/scratchpadCandidates';

describe('buildScratchpadCandidates', () => {
    it('orders active, known, created, and fallback plan markdown files', () => {
        const candidates = buildScratchpadCandidates({
            linkedNotePath: 'Plans/current.plan.md',
            knownFiles: ['Plans/current.plan.md', 'Plans/known.md'],
            createdFiles: [
                { filePath: 'Plans/created.plan.md' },
                { filePath: 'Plans/debug.txt' },
            ],
            effectivePlanPath: 'Plans/fallback.plan.md',
        });

        expect(candidates).toEqual([
            'Plans/current.plan.md',
            'Plans/known.md',
            'Plans/created.plan.md',
            'Plans/fallback.plan.md',
        ]);
    });

    it('skips invalid stale paths so remaining plan files can open', () => {
        const invalidPaths = new Set(['plans/deleted.plan.md']);
        const candidates = buildScratchpadCandidates({
            linkedNotePath: 'Plans/deleted.plan.md',
            knownFiles: ['Plans/deleted.plan.md'],
            createdFiles: [
                { filePath: 'Plans/deleted.plan.md' },
                { filePath: 'Plans/001-refactor.plan.md' },
                { filePath: 'Plans/002-visible-fix.plan.md' },
            ],
            effectivePlanPath: 'Plans/deleted.plan.md',
            invalidPaths,
        });

        expect(candidates).toEqual([
            'Plans/001-refactor.plan.md',
            'Plans/002-visible-fix.plan.md',
        ]);
    });

    it('deduplicates case-insensitively', () => {
        const candidates = buildScratchpadCandidates({
            linkedNotePath: 'Plans/Doc.md',
            knownFiles: ['plans/doc.md', 'Plans/Other.md'],
        });

        expect(candidates).toEqual(['Plans/Doc.md', 'Plans/Other.md']);
    });
});
