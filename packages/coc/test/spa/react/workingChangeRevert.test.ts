import { describe, expect, it } from 'vitest';
import { planWorkingChangeRevert } from '../../../src/server/spa/client/react/features/git/working-tree/workingChangeRevert';
import type { WorkingTreeChange } from '../../../src/server/spa/client/react/features/git/working-tree/WorkingTree';

const ROOT = '/repo';
function change(rel: string, stage: WorkingTreeChange['stage'], status: string, original?: string): WorkingTreeChange {
    return {
        filePath: `${ROOT}/${rel}`, stage, status, repositoryRoot: ROOT, repositoryName: 'repo',
        ...(original ? { originalPath: `${ROOT}/${original}`, oldPath: `${ROOT}/${original}` } : {}),
    };
}
const UNRELATED = change('other.ts', 'unstaged', 'M');
function plan(target: WorkingTreeChange, ...others: WorkingTreeChange[]) {
    const result = planWorkingChangeRevert(target, [target, ...others, UNRELATED]);
    if (!('plan' in result)) throw new Error(`unavailable: ${result.unavailable}`);
    return result.plan;
}
const text = (p: { lines: string[] }) => p.lines.join(' ');

describe('planWorkingChangeRevert', () => {
    it('deletes an untracked file and says it cannot be restored', () => {
        const p = plan(change('new.txt', 'untracked', '?'));
        expect(p).toMatchObject({ label: 'Delete untracked file…', confirmLabel: 'Delete file' });
        expect(text(p)).toContain('new.txt will be deleted from disk');
        expect(text(p)).toContain('cannot be restored');
        expect(p.expected).toEqual([{ filePath: '/repo/new.txt', stage: 'untracked', status: '?' }]);
    });

    it('discards unstaged edits back to HEAD when nothing is staged', () => {
        const p = plan(change('a.ts', 'unstaged', 'M'));
        expect(p.label).toBe('Discard unstaged changes…');
        expect(text(p)).toContain('last committed version');
        expect(text(p)).not.toContain('Staged changes');
    });

    it('discards only unstaged edits and keeps staged edits in a mixed file', () => {
        const staged = change('a.ts', 'staged', 'M');
        const p = plan(change('a.ts', 'unstaged', 'M'), staged);
        expect(text(p)).toContain('its staged version');
        expect(text(p)).toContain('Staged changes to this file are kept.');
        expect(p.expected).toHaveLength(2);
        expect(p.expected).not.toContainEqual(expect.objectContaining({ filePath: '/repo/other.ts' }));
    });

    it('restores an unstaged deletion without warning about loss', () => {
        const p = plan(change('a.ts', 'unstaged', 'D'));
        expect(p.label).toBe('Restore deleted file…');
        expect(text(p)).not.toContain('cannot be undone');
    });

    it('reverts a staged edit and warns that unstaged edits to it are also lost', () => {
        expect(text(plan(change('a.ts', 'staged', 'M')))).not.toContain('Unstaged');
        const p = plan(change('a.ts', 'staged', 'M'), change('a.ts', 'unstaged', 'M'));
        expect(p.label).toBe('Revert to last commit…');
        expect(text(p)).toContain('staged changes will be lost');
        expect(text(p)).toContain('Unstaged changes to this file will also be lost.');
    });

    it.each([
        ['staged added', change('n.ts', 'staged', 'A')],
        ['staged copied', change('n.ts', 'staged', 'C', 'a.ts')],
        ['intent-to-add', change('n.ts', 'unstaged', 'A')],
    ])('deletes a %s file and says all content is lost', (_label, target) => {
        const p = plan(target);
        expect(p.label).toBe('Delete new file…');
        expect(text(p)).toContain('all of its content will be lost');
    });

    it('restores a staged deletion', () => {
        const p = plan(change('a.ts', 'staged', 'D'));
        expect(p.label).toBe('Restore deleted file…');
        expect(text(p)).toContain('undoes the staged deletion');
    });

    it('undoes a staged rename at both paths and names both', () => {
        const p = plan(change('b2.ts', 'staged', 'R', 'b.ts'), change('b2.ts', 'unstaged', 'M'));
        expect(p.label).toBe('Undo rename…');
        expect(text(p)).toContain('b2.ts will be deleted and b.ts restored');
        expect(text(p)).toContain('Unstaged changes to this file will also be lost.');
        expect(p.expected).toEqual(expect.arrayContaining([
            { filePath: '/repo/b2.ts', stage: 'staged', status: 'R', originalPath: '/repo/b.ts' },
            { filePath: '/repo/b2.ts', stage: 'unstaged', status: 'M' },
        ]));
    });

    it('refuses a restore that would overwrite an untracked file at the same path', () => {
        const result = planWorkingChangeRevert(change('a.ts', 'staged', 'D'), [change('a.ts', 'staged', 'D'), change('a.ts', 'untracked', '?')]);
        expect(result).toMatchObject({ unavailable: expect.stringContaining('would be overwritten') });
        const rename = change('b2.ts', 'staged', 'R', 'b.ts');
        expect(planWorkingChangeRevert(rename, [rename, change('b.ts', 'untracked', '?')]))
            .toMatchObject({ unavailable: expect.stringContaining('would be overwritten') });
    });

    it('refuses conflicted files', () => {
        const conflict = change('a.ts', 'unstaged', 'U');
        expect(planWorkingChangeRevert(conflict, [conflict])).toMatchObject({ unavailable: 'Resolve the merge conflict first.' });
    });

    it('uses the path relative to its own repository', () => {
        const nested = { ...change('x/new.txt', 'untracked', '?'), filePath: '/wt/feature/x/new.txt', repositoryRoot: '/wt/feature' };
        expect(text(plan(nested))).toContain('x/new.txt will be deleted');
    });
});
