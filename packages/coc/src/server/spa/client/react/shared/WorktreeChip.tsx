/**
 * WorktreeChip — compact run-visibility chip for a CoC-created Git worktree
 * (AC-05). Shown on process/Ralph session detail and Work Item execution
 * history wherever execution metadata is already displayed.
 *
 * Surfaces the worktree branch, its base (requested ref or resolved SHA),
 * lifecycle status, and the checkout path with a copy affordance. Kept purely
 * presentational so it renders identically from a Ralph session record, a Work
 * Item execution entry, or a launch response.
 *
 * Cleanup (AC-06) is opt-in and prop-driven: pass `onCleanup` and the chip shows
 * a "Clean up" button (only while the worktree is still `active`) that confirms
 * before firing. The parent owns the actual POST, the running/disabled decision
 * (`canCleanup`), the in-flight flag (`cleaningUp`), and any error text
 * (`cleanupError`) — the chip stays presentational.
 */
import { useState } from 'react';
import type { WorktreeMetadata } from '@plusplusoneplusplus/coc-client';

export interface WorktreeChipProps {
    worktree: WorktreeMetadata;
    testId?: string;
    /**
     * When provided (and the worktree is `active`), a "Clean up" button is shown.
     * Called only after the user confirms. The parent owns the POST + refresh.
     */
    onCleanup?: () => void;
    /**
     * Whether cleanup is currently allowed. Defaults to `true`. Set `false` while
     * the linked task/session is still running so the button is disabled; the
     * server also enforces this (409) as the safety net.
     */
    canCleanup?: boolean;
    /** Explanatory tooltip shown when the cleanup button is disabled. */
    cleanupDisabledReason?: string;
    /** True while a cleanup request for this worktree is in flight. */
    cleaningUp?: boolean;
    /** Error text from a failed/refused cleanup (e.g. a 409), shown inline. */
    cleanupError?: string;
}

function shortSha(sha: string): string {
    return sha.length > 7 ? sha.slice(0, 7) : sha;
}

export function WorktreeChip({
    worktree,
    testId = 'worktree-chip',
    onCleanup,
    canCleanup = true,
    cleanupDisabledReason,
    cleaningUp = false,
    cleanupError,
}: WorktreeChipProps) {
    const [copied, setCopied] = useState(false);
    const cleaned = worktree.status === 'cleaned';
    const base = worktree.baseRef || shortSha(worktree.baseSha);
    // Cleanup is only meaningful while the checkout still exists.
    const showCleanup = !!onCleanup && !cleaned;
    const cleanupDisabled = !canCleanup || cleaningUp;

    async function copyPath() {
        try {
            await navigator.clipboard?.writeText(worktree.path);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
        } catch {
            // Clipboard unavailable — no-op; the path is shown inline anyway.
        }
    }

    function handleCleanup() {
        if (cleanupDisabled) return;
        // Confirm before removing the checkout — the branch is preserved.
        const ok = window.confirm(
            `Remove the worktree checkout for branch "${worktree.branch}"?\n\n` +
                'This runs "git worktree remove" on the checkout only — the branch and ' +
                'its commits are kept, and nothing is force-removed or discarded.',
        );
        if (ok) onCleanup?.();
    }

    return (
        <div className="inline-flex max-w-full flex-col gap-0.5">
        <div
            data-testid={testId}
            className="inline-flex max-w-full flex-wrap items-center gap-x-2 gap-y-0.5 rounded-md border border-[#d0d7de] bg-[#f6f8fa] px-2 py-1 text-[11px] text-[#57606a] dark:border-[#3c3c3c] dark:bg-[#252526] dark:text-[#999]"
            title={`Isolated Git worktree at ${worktree.path}`}
        >
            <span className="inline-flex items-center gap-1 font-medium text-[#1f2328] dark:text-[#cccccc]">
                <span aria-hidden="true">🌳</span>
                <span>Worktree</span>
            </span>
            <span className="font-mono text-[#0078d4] dark:text-[#3794ff]" data-testid={`${testId}-branch`}>
                {worktree.branch}
            </span>
            <span data-testid={`${testId}-base`}>
                base <span className="font-mono">{base}</span>
            </span>
            <span
                data-testid={`${testId}-status`}
                className={cleaned ? 'text-[#848484]' : 'text-[#1a7f37] dark:text-[#3fb950]'}
            >
                {cleaned ? 'cleaned' : 'active'}
            </span>
            {worktree.sourceDirty && (
                <span className="text-amber-600 dark:text-amber-400" data-testid={`${testId}-dirty`}>
                    source had uncommitted changes
                </span>
            )}
            <button
                type="button"
                onClick={copyPath}
                data-testid={`${testId}-copy-path`}
                className="max-w-[16rem] truncate font-mono text-[#57606a] hover:text-[#0078d4] hover:underline dark:text-[#999] dark:hover:text-[#3794ff]"
                title="Copy worktree path"
            >
                {copied ? 'Copied!' : worktree.path}
            </button>
            {showCleanup && (
                <button
                    type="button"
                    onClick={handleCleanup}
                    disabled={cleanupDisabled}
                    data-testid={`${testId}-cleanup`}
                    title={cleanupDisabled ? (cleanupDisabledReason || 'Cleanup unavailable') : 'Remove the worktree checkout (keeps the branch)'}
                    className="rounded border border-[#d0d7de] px-1.5 py-px text-[#57606a] hover:border-[#cf222e] hover:text-[#cf222e] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-[#d0d7de] disabled:hover:text-[#57606a] dark:border-[#3c3c3c] dark:text-[#999] dark:hover:border-[#f85149] dark:hover:text-[#f85149]"
                >
                    {cleaningUp ? 'Cleaning…' : 'Clean up'}
                </button>
            )}
        </div>
        {cleanupError && (
            <span
                data-testid={`${testId}-cleanup-error`}
                className="text-[11px] text-[#cf222e] dark:text-[#f85149]"
            >
                {cleanupError}
            </span>
        )}
        </div>
    );
}
