/**
 * WorktreeChip — compact run-visibility chip for a CoC-created Git worktree
 * (AC-05). Shown on process/Ralph session detail and Work Item execution
 * history wherever execution metadata is already displayed.
 *
 * Surfaces the worktree branch, its base (requested ref or resolved SHA),
 * lifecycle status, and the checkout path with a copy affordance. Kept purely
 * presentational so it renders identically from a Ralph session record, a Work
 * Item execution entry, or a launch response.
 */
import { useState } from 'react';
import type { WorktreeMetadata } from '@plusplusoneplusplus/coc-client';

export interface WorktreeChipProps {
    worktree: WorktreeMetadata;
    testId?: string;
}

function shortSha(sha: string): string {
    return sha.length > 7 ? sha.slice(0, 7) : sha;
}

export function WorktreeChip({ worktree, testId = 'worktree-chip' }: WorktreeChipProps) {
    const [copied, setCopied] = useState(false);
    const cleaned = worktree.status === 'cleaned';
    const base = worktree.baseRef || shortSha(worktree.baseSha);

    async function copyPath() {
        try {
            await navigator.clipboard?.writeText(worktree.path);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
        } catch {
            // Clipboard unavailable — no-op; the path is shown inline anyway.
        }
    }

    return (
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
        </div>
    );
}
