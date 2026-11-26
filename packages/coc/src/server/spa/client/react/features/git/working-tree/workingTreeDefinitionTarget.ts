/**
 * workingTreeDefinitionTarget — which working-change entry shows a definition.
 *
 * One path can have staged, unstaged and untracked entries, each a different
 * snapshot on each diff side (staged: HEAD → index; unstaged: index → disk;
 * untracked: disk only). A definition answers in current-code coordinates, so
 * an entry is a destination only when `locateDefinitionInSnapshot` places it
 * in that entry's snapshot of the jump's side. A snapshot equal to current
 * code wins; otherwise the stage closest to current code (untracked, unstaged,
 * staged). No located entry means the caller opens labeled current source.
 */

import type { GitWorkingTreeFileContentResponse } from '@plusplusoneplusplus/coc-client';
import { locateDefinitionInSnapshot, snapshotText, type SnapshotLocation } from '../diff/diffDefinitionLocate';
import type { DiffRevealPosition } from '../diff/diffDefinitionRoute';

type Stage = 'staged' | 'unstaged' | 'untracked';
const STAGE_ORDER: Record<Stage, number> = { untracked: 0, unstaged: 1, staged: 2 };

/** The entry among `candidates` (one path) whose snapshot holds the definition, or null. */
export async function locateWorkingTreeDefinition<T extends { stage: Stage }>(
    candidates: readonly T[],
    readSides: (change: T) => Promise<GitWorkingTreeFileContentResponse>,
    readCurrent: () => Promise<string | null>,
    at: DiffRevealPosition,
): Promise<{ change: T; location: SnapshotLocation } | null> {
    if (!candidates.length) return null;
    const ordered = [...candidates].sort((a, b) => STAGE_ORDER[a.stage] - STAGE_ORDER[b.stage]);
    const [current, snapshots] = await Promise.all([
        readCurrent().catch(() => null),
        Promise.all(ordered.map(change => readSides(change).then(content => snapshotText(content, at.side)).catch(() => null))),
    ]);
    if (current === null) return null;
    const located = ordered.flatMap((change, index) => {
        const snapshot = snapshots[index];
        const location = snapshot === null ? null : locateDefinitionInSnapshot(snapshot, current, at.line, at.column);
        return location ? [{ change, location, exact: snapshot === current }] : [];
    });
    const hit = located.find(entry => entry.exact) ?? located[0];
    return hit ? { change: hit.change, location: hit.location } : null;
}
