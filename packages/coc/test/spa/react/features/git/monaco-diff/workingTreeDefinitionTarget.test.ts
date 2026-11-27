import { describe, it, expect } from 'vitest';
import { locateWorkingTreeDefinition } from '../../../../../../src/server/spa/client/react/features/git/working-tree/workingTreeDefinitionTarget';

const CURRENT = 'a\nb\ndef\nc';
const sides = (base: string | null, head: string) => ({
    path: 'x.ts', fileName: 'x.ts', binary: false, tooLarge: false,
    base: { content: base ?? '', ref: 'B', exists: base !== null }, head: { content: head, ref: 'H', exists: true },
});
type Entry = { stage: 'staged' | 'unstaged' | 'untracked'; base: string | null; head: string };
const run = (entries: Entry[], side: 'original' | 'modified', current: string | null = CURRENT) =>
    locateWorkingTreeDefinition(entries, async entry => sides(entry.base, entry.head), async () => current, { side, line: 3, column: 2 });

describe('locateWorkingTreeDefinition', () => {
    it('prefers a snapshot equal to current code over a stage closer to it', async () => {
        const staged: Entry = { stage: 'staged', base: CURRENT, head: '' };
        const unstaged: Entry = { stage: 'unstaged', base: 'z\na\nb\ndef', head: CURRENT };
        expect(await run([unstaged, staged], 'original')).toEqual({ change: staged, location: { line: 3, column: 2 } });
    });
    it('otherwise takes the located stage closest to current code', async () => {
        const staged: Entry = { stage: 'staged', base: 'q\ndef', head: '' };
        const unstaged: Entry = { stage: 'unstaged', base: 'z\nz\nz\ndef', head: CURRENT };
        expect(await run([staged, unstaged], 'original')).toEqual({ change: unstaged, location: { line: 4, column: 2 } });
    });
    it('returns null without readable current code, a readable side, or a unique line', async () => {
        expect(await run([{ stage: 'unstaged', base: CURRENT, head: CURRENT }], 'original', null)).toBeNull();
        expect(await run([{ stage: 'untracked', base: null, head: CURRENT }], 'original')).toBeNull();
        expect(await run([{ stage: 'staged', base: 'def\ndef', head: '' }], 'original')).toBeNull();
        expect(await run([], 'modified')).toBeNull();
        const failing = await locateWorkingTreeDefinition([{ stage: 'unstaged' as const }], async () => { throw new Error('gone'); },
            async () => CURRENT, { side: 'modified', line: 3, column: 1 });
        expect(failing).toBeNull();
    });
});
