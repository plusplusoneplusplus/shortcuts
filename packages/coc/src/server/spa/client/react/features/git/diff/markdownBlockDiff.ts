/**
 * Block-level markdown diff for the Rendered mode of the file diff panel.
 *
 * Markdown is split into blocks (paragraphs, headings, list items, fenced
 * code, tables) and the two block lists are diffed. A changed block shows
 * as its base version removed followed by its head version added.
 */

import { diffArrays } from 'diff';

export type MarkdownDiffBlockType = 'added' | 'removed' | 'unchanged';

export interface MarkdownDiffBlock {
    type: MarkdownDiffBlockType;
    text: string;
}

const HEADING = /^ {0,3}#{1,6}(\s|$)/;
const LIST_ITEM = /^ {0,3}([-*+]|\d+[.)])\s/;
const FENCE = /^ {0,3}(`{3,}|~{3,})/;

/** Split markdown into blocks; each block keeps its source lines. */
export function splitMarkdownBlocks(text: string): string[] {
    const blocks: string[] = [];
    let current: string[] = [];
    let fence: string | null = null;
    const flush = () => {
        if (current.length > 0) blocks.push(current.join('\n'));
        current = [];
    };
    for (const raw of text.replace(/\r\n?/g, '\n').split('\n')) {
        const line = raw.trimEnd();
        if (fence) {
            current.push(line);
            const close = FENCE.exec(line);
            if (close && close[1][0] === fence[0] && close[1].length >= fence.length && line.trim() === close[1]) {
                fence = null;
                flush();
            }
            continue;
        }
        const open = FENCE.exec(line);
        if (open) {
            flush();
            fence = open[1];
            current.push(line);
        } else if (line.trim() === '') {
            flush();
        } else if (HEADING.test(line)) {
            flush();
            blocks.push(line);
        } else {
            if (LIST_ITEM.test(line)) flush();
            current.push(line);
        }
    }
    flush();
    return blocks;
}

/** Diff two markdown documents block by block. */
export function diffMarkdownBlocks(base: string, head: string): MarkdownDiffBlock[] {
    return diffArrays(splitMarkdownBlocks(base), splitMarkdownBlocks(head)).flatMap(part => {
        const type: MarkdownDiffBlockType = part.added ? 'added' : part.removed ? 'removed' : 'unchanged';
        return part.value.map(text => ({ type, text }));
    });
}
