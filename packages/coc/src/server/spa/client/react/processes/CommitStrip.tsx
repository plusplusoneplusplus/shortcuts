/**
 * CommitStrip — compact inline display of detected git commits inside a tool group.
 *
 * Renders one row per commit with short hash, subject, and optional diff stats.
 * Clicking a row navigates to the commit detail view.
 */
import React from 'react';
import type { DetectedCommit } from './commitDetection';

export interface CommitStripProps {
    commits: DetectedCommit[];
    workspaceId?: string;
}

export function CommitStrip({ commits, workspaceId }: CommitStripProps) {
    if (commits.length === 0) return null;

    const handleClick = (commit: DetectedCommit) => {
        const hash = commit.fullHash || commit.shortHash;
        if (workspaceId) {
            location.hash = `#repos/${workspaceId}/commits/${hash}`;
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
                        (workspaceId
                            ? 'cursor-pointer hover:bg-[#e1effe] dark:hover:bg-[#1f2d42]'
                            : '')
                    }
                    data-testid={`commit-strip-row-${commit.shortHash}`}
                    onClick={workspaceId ? () => handleClick(commit) : undefined}
                    role={workspaceId ? 'link' : undefined}
                >
                    <span className="shrink-0">🔀</span>

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
                </div>
            ))}
        </div>
    );
}
