/**
 * The changed-files menu's revert/delete action for one working-tree row.
 *
 * `planWorkingChangeRevert` picks the action from the row's stage and status and
 * words exactly what will be lost, counting other rows for the same file (mixed
 * staged/unstaged state). The server re-reads status and refuses when it no
 * longer matches the rows the user confirmed, so a stale list never loses more.
 */
import { useState } from 'react';
import type { GitWorkingTreeRevertRow } from '@plusplusoneplusplus/coc-client';
import type { ContextMenuItem } from '../../../tasks/comments/ContextMenu';
import { Dialog } from '../../../ui/Dialog';
import { Button } from '../../../ui/Button';
import { repoRelative, type WorkingTreeChange } from './WorkingTree';

export interface WorkingChangeRevertPlan {
    /** Menu label, ending in an ellipsis because a confirmation follows. */
    label: string;
    heading: string;
    /** What happens, what is lost, and what is kept — one sentence each. */
    lines: string[];
    confirmLabel: string;
    /** The rows the confirmation describes; the server must still see exactly these. */
    expected: GitWorkingTreeRevertRow[];
}

export type WorkingChangeRevertResult = { plan: WorkingChangeRevertPlan } | { unavailable: string; label: string };

type Kind = 'discard-unstaged' | 'restore-from-head' | 'delete-untracked';

/** Mirrors forge `workingTreeRevertKind`, on the single-letter statuses the list carries. */
function revertKind(change: WorkingTreeChange): Kind | null {
    if (change.stage === 'untracked') return 'delete-untracked';
    if (change.stage === 'staged') return ['M', 'A', 'D', 'R', 'C'].includes(change.status) ? 'restore-from-head' : null;
    // Intent-to-add: restoring from the index would empty the file.
    if (change.status === 'A') return 'restore-from-head';
    return change.status === 'M' || change.status === 'D' ? 'discard-unstaged' : null;
}

const originalOf = (change: WorkingTreeChange) => change.originalPath ?? change.oldPath;

/** Plans the revert of `change`, given every row currently in the list. */
export function planWorkingChangeRevert(change: WorkingTreeChange, changes: WorkingTreeChange[]): WorkingChangeRevertResult {
    const kind = revertKind(change);
    const original = originalOf(change);
    const paths = kind === 'restore-from-head' && change.status === 'R' && original ? [change.filePath, original] : [change.filePath];
    const related = changes.filter(row => paths.includes(row.filePath) || paths.includes(originalOf(row) ?? ''));
    const others = related.filter(row => row !== change && !(row.filePath === change.filePath && row.stage === change.stage));
    const rel = (p: string) => repoRelative(p, change.repositoryRoot);
    const file = rel(change.filePath);
    const fallbackLabel = change.stage === 'untracked' ? 'Delete untracked file…' : 'Discard changes…';

    if (!kind || related.some(row => row.status === 'U')) {
        return { label: fallbackLabel, unavailable: change.status === 'U' || related.some(row => row.status === 'U')
            ? 'Resolve the merge conflict first.' : `This ${change.status} change cannot be reverted here.` };
    }
    if (kind === 'restore-from-head' && others.some(row => row.stage === 'untracked')) {
        return { label: fallbackLabel, unavailable: 'An untracked file at this path would be overwritten. Move or delete it first.' };
    }
    const expected = related.map(row => ({
        filePath: row.filePath, stage: row.stage, status: row.status,
        ...(originalOf(row) ? { originalPath: originalOf(row) } : {}),
    }));
    const hasStaged = others.some(row => row.stage === 'staged');
    const hasUnstaged = others.some(row => row.stage === 'unstaged');
    const keepsOthers = 'Other files are not changed.';
    const permanent = 'This cannot be undone.';
    const plan = (label: string, heading: string, confirmLabel: string, lines: string[]): WorkingChangeRevertResult =>
        ({ plan: { label, heading, confirmLabel, lines, expected } });

    if (kind === 'delete-untracked') {
        return plan('Delete untracked file…', 'Delete untracked file?', 'Delete file', [
            `${file} will be deleted from disk.`,
            'Git does not track this file, so it cannot be restored.',
            keepsOthers,
        ]);
    }
    if (kind === 'discard-unstaged') {
        const source = hasStaged ? 'its staged version' : 'its last committed version';
        if (change.status === 'D') {
            return plan('Restore deleted file…', 'Restore deleted file?', 'Restore file', [
                `${file} will be restored from ${source}.`,
                ...(hasStaged ? ['Staged changes to this file are kept.'] : []),
                keepsOthers,
            ]);
        }
        return plan('Discard unstaged changes…', 'Discard unstaged changes?', 'Discard changes', [
            `Unstaged changes to ${file} will be lost. The file goes back to ${source}.`,
            ...(hasStaged ? ['Staged changes to this file are kept.'] : []),
            keepsOthers, permanent,
        ]);
    }
    const alsoUnstaged = hasUnstaged ? ['Unstaged changes to this file will also be lost.'] : [];
    if (change.status === 'A' || change.status === 'C') {
        return plan('Delete new file…', 'Delete new file?', 'Delete file', [
            `${file} will be removed from Git and deleted from disk.`,
            'It is not in the last commit, so all of its content will be lost.',
            keepsOthers, permanent,
        ]);
    }
    if (change.status === 'D') {
        return plan('Restore deleted file…', 'Restore deleted file?', 'Restore file', [
            `${file} will be restored from the last commit, which undoes the staged deletion.`,
            keepsOthers,
        ]);
    }
    if (change.status === 'R' && original) {
        return plan('Undo rename…', 'Undo rename?', 'Undo rename', [
            `${file} will be deleted and ${rel(original)} restored from the last commit.`,
            `Staged changes to ${file} will be lost.`, ...alsoUnstaged,
            keepsOthers, permanent,
        ]);
    }
    return plan('Revert to last commit…', 'Revert to last commit?', 'Revert file', [
        `${file} goes back to its last committed version. Its staged changes will be lost.`, ...alsoUnstaged,
        keepsOthers, permanent,
    ]);
}

interface RevertTarget { workspaceId: string; filePath: string; stage: WorkingTreeChange['stage']; plan: WorkingChangeRevertPlan }

/** The owner client and workspace that listed the changes; reverts go to the same place. */
export interface WorkingChangeRevertOwner {
    workspaceId: string;
    client: { git: { revertWorkingTreeChange(workspaceId: string, request: { filePath: string; stage: WorkingTreeChange['stage']; expected: GitWorkingTreeRevertRow[] }): Promise<{ success: boolean; error?: string }> } };
    /** Runs after a successful revert, to reload the list. */
    onReverted: () => void;
}

/** Menu item plus confirmation dialog for reverting one changed file. */
export function useWorkingChangeRevert({ workspaceId, client, onReverted }: WorkingChangeRevertOwner) {
    const [target, setTarget] = useState<RevertTarget | null>(null);
    const [pending, setPending] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const close = () => { if (!pending) { setTarget(null); setError(null); } };

    /** `blockedReason` disables the item, e.g. while the file has unsaved edits. */
    function menuItem(change: WorkingTreeChange, changes: WorkingTreeChange[], blockedReason?: string): ContextMenuItem {
        const result = planWorkingChangeRevert(change, changes);
        const reason = 'unavailable' in result ? result.unavailable : blockedReason;
        const label = 'plan' in result ? result.plan.label : result.label;
        return {
            label, icon: change.stage === 'untracked' || label.startsWith('Delete') ? '🗑️' : '↩️', destructive: true,
            disabled: !!reason, title: reason ?? label.replace('…', ''),
            onClick: () => {
                if (reason || !('plan' in result)) return;
                setError(null);
                setTarget({ workspaceId, filePath: change.filePath, stage: change.stage, plan: result.plan });
            },
        };
    }

    async function confirm() {
        if (!target || pending) return;
        setPending(true);
        setError(null);
        try {
            const result = await client.git.revertWorkingTreeChange(target.workspaceId, {
                filePath: target.filePath, stage: target.stage, expected: target.plan.expected,
            });
            if (result.success === false) throw new Error(result.error || 'Revert failed');
            setTarget(null);
            onReverted();
        } catch (err: any) {
            setError(err?.message || 'Revert failed');
        } finally {
            setPending(false);
        }
    }

    const dialog = <Dialog id="working-change-revert-dialog" open={!!target} onClose={close} trapFocus
        title={target?.plan.heading} disableClose={pending}
        footer={<>
            <Button variant="secondary" data-testid="working-change-revert-cancel" onClick={close} disabled={pending}>Cancel</Button>
            <Button variant="danger" data-testid="working-change-revert-confirm" onClick={() => void confirm()} disabled={pending}>
                {pending ? 'Working…' : target?.plan.confirmLabel}
            </Button>
        </>}>
        {target && <div className="space-y-2" data-testid="working-change-revert-message">
            {target.plan.lines.map(line => <p key={line}>{line}</p>)}
            {error && <p role="alert" className="text-[#d32f2f]" data-testid="working-change-revert-error">{error}</p>}
        </div>}
    </Dialog>;

    return { menuItem, dialog };
}
