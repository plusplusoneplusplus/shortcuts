/**
 * CommitList — accordion list of git commits.
 *
 * Each row shows short hash, subject, relative time, and author.
 * Clicking a row expands it to show CommitDetail.
 */

import { useState } from 'react';
import { CommitDetail } from './CommitDetail';
import { formatRelativeTime } from '../utils/format';

export interface GitCommitItem {
    hash: string;
    shortHash: string;
    subject: string;
    author: string;
    date: string;
    parentHashes: string[];
}

interface CommitListProps {
    title: string;
    commits: GitCommitItem[];
    workspaceId: string;
    loading?: boolean;
}

export function CommitList({ title, commits, workspaceId, loading }: CommitListProps) {
    const [expandedHash, setExpandedHash] = useState<string | null>(null);

    const toggleExpand = (hash: string) => {
        setExpandedHash(prev => (prev === hash ? null : hash));
    };

    return (
        <div className="commit-list" data-testid={`commit-list-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`}>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-[#616161] dark:text-[#999] px-4 py-2 bg-[#f5f5f5] dark:bg-[#252526] border-b border-[#e0e0e0] dark:border-[#3c3c3c]">
                {title} {!loading && `(${commits.length})`}
            </h3>
            {loading ? (
                <div className="px-4 py-3 text-xs text-[#848484]" data-testid="commit-list-loading">Loading commits...</div>
            ) : commits.length === 0 ? (
                <div className="px-4 py-3 text-xs text-[#848484]" data-testid="commit-list-empty">No commits</div>
            ) : (
                <div>
                    {commits.map(commit => (
                        <div key={commit.hash}>
                            <button
                                className="commit-row w-full flex items-center gap-2 px-4 py-2 text-left hover:bg-[#f0f0f0] dark:hover:bg-[#2a2d2e] transition-colors border-b border-[#e0e0e0] dark:border-[#3c3c3c]"
                                onClick={() => toggleExpand(commit.hash)}
                                data-testid={`commit-row-${commit.shortHash}`}
                            >
                                <span className="text-[10px] text-[#848484]">{expandedHash === commit.hash ? '▼' : '▶'}</span>
                                <span className="font-mono text-xs text-[#0078d4] dark:text-[#3794ff] flex-shrink-0">{commit.shortHash}</span>
                                <span className="text-xs text-[#1e1e1e] dark:text-[#ccc] flex-1 truncate">{commit.subject}</span>
                                <span className="text-[11px] text-[#848484] flex-shrink-0">{formatRelativeTime(commit.date)}</span>
                                <span className="text-[11px] text-[#848484] flex-shrink-0 max-w-[100px] truncate">{commit.author}</span>
                            </button>
                            {expandedHash === commit.hash && (
                                <CommitDetail
                                    workspaceId={workspaceId}
                                    hash={commit.hash}
                                    author={commit.author}
                                    date={commit.date}
                                    parentHashes={commit.parentHashes}
                                />
                            )}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
