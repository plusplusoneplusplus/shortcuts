/**
 * Blame decorations (`features.fileBlame`): every buffer line gets an aligned
 * label, the first line of a run names its commit, edited lines turn "Not
 * committed yet" live, hovers carry subject/author/date, and clicking an
 * attributed label opens that commit.
 */
import { describe, expect, it, vi } from 'vitest';
import type { GitFileBlameResponse } from '@plusplusoneplusplus/coc-client';
import {
    FILE_BLAME_LABEL_WIDTH,
    FILE_BLAME_UNCOMMITTED_CLASS,
    attachFileBlameDecorations,
    buildBlameDecorations,
    formatBlameHover,
    formatBlameLabel,
} from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/fileBlameDecorations';

const CONTENT_TEXT = 6;
const CURSOR_STOPS_NONE = 3;

const COMMIT_A = { hash: 'a'.repeat(40), shortHash: 'aaaaaaa', subject: 'Add *core* [module]', author: 'Alice Anderson-Longname', authorEmail: 'a@x', date: '2024-03-05T10:00:00Z', path: 'src/app.ts' };
const COMMIT_B = { hash: 'b'.repeat(40), shortHash: 'bbbbbbb', subject: 'Tweak', author: 'Bob', authorEmail: 'b@x', date: '2024-04-01T10:00:00Z', path: 'src/old-app.ts' };

const BLAME: GitFileBlameResponse = {
    lines: [
        { hash: COMMIT_A.hash, text: 'one' },
        { hash: COMMIT_A.hash, text: 'two' },
        { hash: COMMIT_B.hash, text: 'three' },
    ],
    commits: { [COMMIT_A.hash]: COMMIT_A, [COMMIT_B.hash]: COMMIT_B },
};

function labels(text: string) {
    return buildBlameDecorations(BLAME, text, CURSOR_STOPS_NONE).map(d => d.options.before!);
}

describe('formatBlameLabel / formatBlameHover', () => {
    it('keeps every label the same width and truncates long authors', () => {
        const a = formatBlameLabel(COMMIT_A);
        expect(a).toHaveLength(FILE_BLAME_LABEL_WIDTH);
        expect(a).toContain('Alice Ander…');
        expect(a).toContain('2024-03-05');
        expect(formatBlameLabel(null)).toHaveLength(FILE_BLAME_LABEL_WIDTH);
        expect(formatBlameLabel(null).trim()).toBe('Not committed yet');
    });

    it('shows the full subject, author and date with markdown escaped', () => {
        const hover = formatBlameHover(COMMIT_A).value;
        expect(hover).toContain('Add \\*core\\* \\[module\\]');
        expect(hover).toContain('Alice Anderson\\-Longname');
        expect(hover).toContain('`aaaaaaa`');
        expect(formatBlameHover(null).value).toBe('Not committed yet');
    });
});

describe('buildBlameDecorations', () => {
    it('labels the first line of each run and blanks the rest, attributing renamed-file commits', () => {
        const before = labels('one\ntwo\nthree\n');
        expect(before).toHaveLength(3);
        expect(before[0].content).toContain('Alice');
        expect(before[0].attachedData).toBe(COMMIT_A.hash);
        expect(before[1].content.trim()).toBe('');
        expect(before[1].attachedData).toBe(COMMIT_A.hash);
        expect(before[2].content).toContain('Bob');
        expect(before[2].attachedData).toBe(COMMIT_B.hash);
        expect(before.every(b => b.cursorStops === CURSOR_STOPS_NONE)).toBe(true);
    });

    it('marks edited and added lines as not committed yet and never attaches a hash to them', () => {
        const before = labels('one\nTWO edited\nnew line\nthree');
        expect(before[1].content.trim()).toBe('Not committed yet');
        expect(before[1].inlineClassName).toContain(FILE_BLAME_UNCOMMITTED_CLASS);
        expect(before[1].attachedData).toBeUndefined();
        expect(before[2].content.trim()).toBe('');
        expect(before[2].attachedData).toBeUndefined();
        expect(before[3].attachedData).toBe(COMMIT_B.hash);
    });

    it('treats every line as not committed yet when HEAD has no blame (empty state)', () => {
        const before = buildBlameDecorations({ lines: [], commits: {} }, 'a\nb', CURSOR_STOPS_NONE).map(d => d.options.before!);
        expect(before.map(b => b.content.trim())).toEqual(['Not committed yet', '']);
    });
});

function fakeEditor(initial: string) {
    let value = initial;
    let changeListener: (() => void) | null = null;
    let mouseListener: ((event: unknown) => void) | null = null;
    const collection = { set: vi.fn(), clear: vi.fn() };
    const editor = {
        createDecorationsCollection: vi.fn(() => collection),
        onMouseDown: vi.fn((listener: (event: unknown) => void) => {
            mouseListener = listener;
            return { dispose: () => { mouseListener = null; } };
        }),
    };
    const model = {
        getValue: () => value,
        onDidChangeContent: vi.fn((listener: () => void) => {
            changeListener = listener;
            return { dispose: () => { changeListener = null; } };
        }),
    };
    const monaco = { editor: { MouseTargetType: { CONTENT_TEXT }, InjectedTextCursorStops: { None: CURSOR_STOPS_NONE } } };
    return {
        context: { editor, model, monaco } as never,
        collection,
        editor,
        edit(next: string) { value = next; changeListener?.(); },
        click(type: number, attachedData: unknown) {
            mouseListener?.({ target: { type, detail: { injectedText: { options: { attachedData } } } } });
        },
        get listening() { return changeListener !== null || mouseListener !== null; },
    };
}

describe('attachFileBlameDecorations', () => {
    it('recomputes on edits so a changed line stops showing its old commit', () => {
        const fake = fakeEditor('one\ntwo\nthree');
        attachFileBlameDecorations(fake.context, BLAME, vi.fn());
        const initial = fake.editor.createDecorationsCollection.mock.calls[0][0] as { options: { before: { content: string } } }[];
        expect(initial[2].options.before.content).toContain('Bob');

        fake.edit('one\ntwo\nthree changed');
        const next = fake.collection.set.mock.calls[0][0] as { options: { before: { content: string; attachedData?: string } } }[];
        expect(next[2].options.before.content.trim()).toBe('Not committed yet');
        expect(next[2].options.before.attachedData).toBeUndefined();
    });

    it('opens the clicked commit only for attributed labels', () => {
        const fake = fakeEditor('one\ntwo\nthree');
        const onOpenCommit = vi.fn();
        attachFileBlameDecorations(fake.context, BLAME, onOpenCommit);

        fake.click(CONTENT_TEXT, COMMIT_B.hash);
        expect(onOpenCommit).toHaveBeenCalledWith(COMMIT_B.hash);

        onOpenCommit.mockClear();
        fake.click(CONTENT_TEXT, undefined);
        fake.click(CONTENT_TEXT, 'c'.repeat(40));
        fake.click(2, COMMIT_A.hash);
        expect(onOpenCommit).not.toHaveBeenCalled();
    });

    it('cleans up listeners and decorations', () => {
        const fake = fakeEditor('one');
        const cleanup = attachFileBlameDecorations(fake.context, BLAME, vi.fn());
        cleanup();
        expect(fake.collection.clear).toHaveBeenCalled();
        expect(fake.listening).toBe(false);
    });
});
