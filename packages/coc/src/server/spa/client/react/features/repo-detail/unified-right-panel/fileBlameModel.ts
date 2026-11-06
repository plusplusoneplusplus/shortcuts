/**
 * fileBlameModel — maps a file's `HEAD` blame onto the live editor buffer
 * (`features.fileBlame`).
 *
 * Blame is always read from `HEAD`. A buffer line keeps its commit only when
 * it is an unchanged `HEAD` line matched by a line diff; every changed, added,
 * or otherwise unmappable line is "not committed yet" (`null`), so an edit is
 * never attributed to an obsolete commit.
 */

import { diffArrays } from 'diff';
import type { GitFileBlameResponse } from '@plusplusoneplusplus/coc-client';

type GitFileBlameLine = GitFileBlameResponse['lines'][number];

export const NOT_COMMITTED_LABEL = 'Not committed yet';

/** One run of consecutive buffer lines with the same attribution. */
export interface FileBlameRun {
    /** 1-based first buffer line of the run. */
    startLine: number;
    /** 1-based last buffer line of the run (inclusive). */
    endLine: number;
    /** Commit hash, or `null` for lines not committed yet. */
    hash: string | null;
}

interface Token {
    head: boolean;
    index: number;
    text: string;
}

/** Splits buffer text into lines the way `git blame` counts them. */
export function splitBufferLines(text: string): string[] {
    if (text === '') return [];
    const lines = text.split(/\r?\n/);
    if (lines[lines.length - 1] === '') lines.pop();
    return lines;
}

/**
 * Returns one entry per buffer line: the `HEAD` commit hash that line came
 * from, or `null` when it is not committed yet.
 */
export function mapBlameToBuffer(headLines: readonly GitFileBlameLine[], bufferLines: readonly string[]): (string | null)[] {
    const lastHead = headLines.length - 1;
    // The server's last line may lose trailing whitespace, so compare it loosely.
    const same = (head: number, text: string) => headLines[head].text === text
        || (head === lastHead && headLines[head].text === text.trimEnd());

    if (headLines.length === bufferLines.length && bufferLines.every((text, i) => same(i, text))) {
        return headLines.map(line => line.hash);
    }

    const result: (string | null)[] = new Array(bufferLines.length).fill(null);
    const headTokens: Token[] = headLines.map((line, index) => ({ head: true, index, text: line.text }));
    const bufferTokens: Token[] = bufferLines.map((text, index) => ({ head: false, index, text }));
    const parts = diffArrays(headTokens, bufferTokens, {
        comparator: (a, b) => {
            const head = a.head ? a : b;
            const buffer = a.head ? b : a;
            return head.head && !buffer.head && same(head.index, buffer.text);
        },
    });
    let headIndex = 0;
    let bufferIndex = 0;
    for (const part of parts) {
        const count = part.value.length;
        if (part.removed) {
            headIndex += count;
        } else if (part.added) {
            bufferIndex += count;
        } else {
            for (let i = 0; i < count; i++) result[bufferIndex + i] = headLines[headIndex + i].hash;
            headIndex += count;
            bufferIndex += count;
        }
    }
    return result;
}

/** Groups per-line attribution into runs of consecutive lines. */
export function blameRuns(lineHashes: readonly (string | null)[]): FileBlameRun[] {
    const runs: FileBlameRun[] = [];
    lineHashes.forEach((hash, i) => {
        const last = runs[runs.length - 1];
        if (last && last.hash === hash) last.endLine = i + 1;
        else runs.push({ startLine: i + 1, endLine: i + 1, hash });
    });
    return runs;
}
