/**
 * monacoDiffHunks — hunk list and navigation cursor for the Monaco diff editor.
 *
 * Monaco computes the diff asynchronously: `getLineChanges()` is null until
 * the first `onDidUpdateDiff`. The navigator therefore has an explicit
 * not-ready state, and a navigation request that arrives before the diff is
 * computed is held and applied once it is — otherwise the first ▼ after a
 * cross-file jump would see zero hunks and skip the whole file.
 */

import type { DiffLineChange } from './diffCoords';

export interface DiffHunk extends DiffLineChange {
    /** 1-based line in the modified editor to reveal for this hunk. */
    revealLine: number;
}

/**
 * One hunk per Monaco line change. A pure deletion has
 * `modifiedEndLineNumber === 0` and `modifiedStartLineNumber` = the line
 * above the removed block (0 at the top of the file); it is revealed there.
 */
export function hunksFromLineChanges(changes: readonly DiffLineChange[] | null | undefined): DiffHunk[] {
    if (!changes) return [];
    return changes.map(change => ({
        originalStartLineNumber: change.originalStartLineNumber,
        originalEndLineNumber: change.originalEndLineNumber,
        modifiedStartLineNumber: change.modifiedStartLineNumber,
        modifiedEndLineNumber: change.modifiedEndLineNumber,
        revealLine: Math.max(1, change.modifiedStartLineNumber),
    }));
}

/** A navigation request, kept until the diff is ready. */
export type HunkIntent =
    | { kind: 'next' }
    | { kind: 'prev' }
    | { kind: 'first' }
    | { kind: 'last' }
    | { kind: 'index'; index: number };

export interface HunkNavigator {
    /** `null` means the diff is (re)computing; hunks are unknown. */
    setLineChanges(changes: readonly DiffLineChange[] | null): void;
    /** Back to not-ready with no cursor and no held request (file change). */
    reset(): void;
    isReady(): boolean;
    count(): number;
    currentIndex(): number;
    hunks(): readonly DiffHunk[];
    request(intent: HunkIntent): void;
}

/**
 * Cursor semantics match the classic viewers: next/prev wrap within the file,
 * prev from "no cursor" lands on the last hunk, out-of-range indices are
 * ignored. `reveal` is called for every cursor move.
 */
export function createHunkNavigator(reveal: (hunk: DiffHunk, index: number) => void): HunkNavigator {
    let ready = false;
    let hunks: DiffHunk[] = [];
    let current = -1;
    let pending: HunkIntent | null = null;

    const move = (index: number) => {
        current = index;
        reveal(hunks[index], index);
    };

    const apply = (intent: HunkIntent) => {
        const n = hunks.length;
        if (n === 0) return;
        switch (intent.kind) {
            case 'next': move((current + 1) % n); break;
            case 'prev': move(((current === -1 ? n : current) - 1 + n) % n); break;
            case 'first': move(0); break;
            case 'last': move(n - 1); break;
            case 'index':
                if (intent.index >= 0 && intent.index < n) move(intent.index);
                break;
        }
    };

    return {
        setLineChanges(changes) {
            if (changes === null) {
                ready = false;
                return;
            }
            hunks = hunksFromLineChanges(changes);
            ready = true;
            // A recompute of the same file keeps the cursor when it still fits.
            if (current >= hunks.length) current = hunks.length - 1;
            if (pending) {
                const intent = pending;
                pending = null;
                apply(intent);
            }
        },
        reset() {
            ready = false;
            hunks = [];
            current = -1;
            pending = null;
        },
        isReady: () => ready,
        count: () => hunks.length,
        currentIndex: () => current,
        hunks: () => hunks,
        request(intent) {
            if (!ready) {
                pending = intent;
                return;
            }
            apply(intent);
        },
    };
}
