/**
 * Real `git diff` fixtures for engine-parity tests: the classic viewer's rows
 * come from `git diff -U3`, Monaco-shaped line changes from `git diff -U0`
 * (the same encoding as Monaco's ILineChange).
 */

import { execFileSync } from 'child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { DiffLineChange } from '../../../../../../src/server/spa/client/react/features/git/diff/diffCoords';

export interface GitDiffFixture {
    gitDiff(original: string, modified: string, context: number): string[];
    lineChangesFromGit(original: string, modified: string): DiffLineChange[];
    dispose(): void;
}

export function createGitDiffFixture(prefix = 'monaco-diff-'): GitDiffFixture {
    const dir = mkdtempSync(join(tmpdir(), prefix));

    function gitDiff(original: string, modified: string, context: number): string[] {
        const a = join(dir, 'a.txt');
        const b = join(dir, 'b.txt');
        writeFileSync(a, original);
        writeFileSync(b, modified);
        let out = '';
        try {
            out = execFileSync('git', ['-c', 'core.autocrlf=false', 'diff', '--no-index', '--no-color', `-U${context}`, a, b], { encoding: 'utf8' });
        } catch (error) {
            out = (error as { stdout: string }).stdout; // exit 1 = files differ
        }
        const lines = out.split('\n');
        if (lines[lines.length - 1] === '') lines.pop();
        return lines.slice(lines.findIndex(line => line.startsWith('@@')));
    }

    /** `-U0` hunks are exactly Monaco's line changes (end 0 = empty side). */
    function lineChangesFromGit(original: string, modified: string): DiffLineChange[] {
        return gitDiff(original, modified, 0)
            .filter(line => line.startsWith('@@'))
            .map(line => {
                const [, o, oLen = '1', m, mLen = '1'] = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line)!;
                const range = (start: string, len: string) => (Number(len) === 0 ? [Number(start), 0] : [Number(start), Number(start) + Number(len) - 1]);
                const [os, oe] = range(o, oLen);
                const [ms, me] = range(m, mLen);
                return { originalStartLineNumber: os, originalEndLineNumber: oe, modifiedStartLineNumber: ms, modifiedEndLineNumber: me };
            });
    }

    return { gitDiff, lineChangesFromGit, dispose: () => rmSync(dir, { recursive: true, force: true }) };
}
