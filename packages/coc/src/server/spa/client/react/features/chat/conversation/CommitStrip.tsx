/**
 * CommitStrip — compact inline display of detected git commits inside a tool group.
 *
 * Renders one row per commit with short hash, subject, and optional diff stats.
 * Clicking a row opens the commit detail (the chat's right-panel Git tab when
 * one hosts this chat, else the workspace Git route); the trailing ↗️ button
 * opens the commit in a dedicated pop-out window.
 */
import React from 'react';
import type { DetectedCommit } from './commitDetection';
import { buildGitReviewPopOutUrl } from '../../../layout/Router';
import { useGitReviewPopOut, gitReviewPopOutKey } from '../../../contexts/GitReviewPopOutContext';
import { lookupCloneBaseUrl } from '../../../repos/cloneRegistry';
import { popOutOpened } from '../../../utils/popOutWindow';
import { activateChatCommit, useChatCommitOpener } from './chatCommitOpener';

export interface CommitStripProps {
    commits: DetectedCommit[];
    workspaceId?: string;
    sourceSelectionId?: string;
    sourceBaseUrl?: string;
}

export function CommitStrip({ commits, workspaceId, sourceSelectionId, sourceBaseUrl }: CommitStripProps) {
    const { markPoppedOut } = useGitReviewPopOut();
    const openCommit = useChatCommitOpener();

    if (commits.length === 0) return null;

    const handleClick = (e: React.MouseEvent, commit: DetectedCommit) => {
        e.stopPropagation();
        if (workspaceId) activateChatCommit(openCommit, workspaceId, commit);
    };

    const handlePopOut = (e: React.MouseEvent, commit: DetectedCommit) => {
        e.stopPropagation();
        if (!workspaceId) return;
        const hash = commit.fullHash || commit.shortHash;
        const cloneBaseUrl = sourceBaseUrl ?? (sourceSelectionId === workspaceId
            ? undefined : lookupCloneBaseUrl(sourceSelectionId ?? workspaceId));
        const url = buildGitReviewPopOutUrl(workspaceId, hash, cloneBaseUrl, sourceSelectionId);
        const win = window.open(url, `coc-git-review-${hash}`, 'width=1200,height=800');
        if (popOutOpened(win)) {
            markPoppedOut(gitReviewPopOutKey(workspaceId, hash));
        }
    };

    return (
        <div
            className="commit-strip border-t border-[#e0e0e0] dark:border-[#3c3c3c]"
            data-testid="commit-strip"
        >
            {commits.map(commit => (
                <div
                    key={commit.shortHash}
                    className={
                        'flex items-center gap-2 px-2.5 py-1 text-xs ' +
                        'bg-[#f0f7ff] dark:bg-[#1a2332] ' +
                        (commit.isFixup || commit.isAmend ? 'opacity-70 ' : '') +
                        (workspaceId
                            ? 'cursor-pointer hover:bg-[#e1effe] dark:hover:bg-[#1f2d42]'
                            : '')
                    }
                    data-testid={`commit-strip-row-${commit.shortHash}`}
                    onClick={workspaceId ? (e) => handleClick(e, commit) : undefined}
                    role={workspaceId ? 'link' : undefined}
                >
                    <span className="shrink-0">{commit.isAmend ? '✏️' : commit.isFixup ? '🔧' : '🔀'}</span>

                    <span className="font-mono shrink-0 text-[#f57c00] dark:text-[#ffb74d]">
                        {commit.shortHash}
                    </span>

                    <span className="text-[#1e1e1e] dark:text-[#ccc] truncate min-w-0 flex-1">
                        {commit.subject}
                    </span>

                    {(commit.insertions != null || commit.deletions != null || commit.filesChanged != null) && (
                        <span className="shrink-0 text-[#848484]">
                            {commit.insertions != null && (
                                <span className="text-[#16825d]">+{commit.insertions}</span>
                            )}
                            {commit.insertions != null && commit.deletions != null && ' '}
                            {commit.deletions != null && (
                                <span className="text-[#d32f2f]">−{commit.deletions}</span>
                            )}
                            {commit.filesChanged != null && (
                                <>, {commit.filesChanged} file{commit.filesChanged !== 1 ? 's' : ''}</>
                            )}
                        </span>
                    )}

                    {workspaceId && (
                        <button
                            type="button"
                            onClick={(e) => handlePopOut(e, commit)}
                            title="Open in new window"
                            className="shrink-0 text-xs px-1 py-0.5 rounded hover:bg-black/[0.06] dark:hover:bg-white/[0.08]"
                            data-testid={`commit-strip-popout-${commit.shortHash}`}
                            aria-label="Open commit in new window"
                        >
                            ↗️
                        </button>
                    )}
                </div>
            ))}
        </div>
    );
}
