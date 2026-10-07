import type { GitCommitItem } from './commitListTypes';
import { CommitDetailIcon } from './CommitDetailIcon';

/** Shared commit description and metadata for inline and pop-out reviews. */
export function CommitInfoHeader({ commit, fileCount, headerCollapsed, headerId, hashCopied, onToggle, onCopy }: {
    commit: GitCommitItem;
    fileCount: number;
    headerCollapsed: boolean;
    headerId: string;
    hashCopied: boolean;
    onToggle: () => void;
    onCopy: () => void;
}) {
    const formattedDate = commit.date ? new Date(commit.date).toLocaleString() : '';
    return (
        <div className="shrink-0 min-w-0" style={{ maxHeight: '40vh', overflow: 'auto' }}>
            {headerCollapsed && (
                <div className="flex items-center gap-2 px-4 py-2 border-b border-[#e0e0e0] dark:border-[#3c3c3c] bg-white dark:bg-[#252526]">
                    <button
                        type="button"
                        data-testid="commit-info-summary"
                        className="flex flex-1 min-w-0 items-center gap-2 text-left text-xs text-[#1e1e1e] dark:text-[#ccc] rounded focus-visible:ring-2 focus-visible:ring-[#0078d4]"
                        onClick={onToggle}
                        aria-expanded={false}
                        aria-controls={headerId}
                        title="Show commit details"
                    >
                        <CommitDetailIcon name="down" />
                        <span className="truncate">{commit.subject}</span>
                        <span className="sr-only">{commit.hash.slice(0, 8)}</span>
                    </button>
                    <button
                        type="button"
                        onClick={onCopy}
                        className="inline-flex shrink-0 items-center gap-2 rounded border border-[#e0e0e0] dark:border-[#3c3c3c] px-2 py-1 font-mono text-[11px] text-[#0078d4] dark:text-[#3794ff] hover:bg-black/[0.04] dark:hover:bg-white/[0.06] focus-visible:ring-2 focus-visible:ring-[#0078d4]"
                        title={hashCopied ? 'Copied!' : 'Copy commit hash'}
                        aria-label={hashCopied ? 'Copied!' : 'Copy commit hash'}
                        data-testid="commit-summary-copy-hash"
                    >
                        {commit.hash.slice(0, 8)}
                        <CommitDetailIcon name={hashCopied ? 'check' : 'copy'} />
                    </button>
                </div>
            )}
            <div
                id={headerId}
                hidden={headerCollapsed}
            >
                <div className="px-4 py-3 bg-white dark:bg-[#252526]" data-testid="commit-info-header">
                    <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2" data-testid="commit-info-title-row">
                        <div className="min-w-0 flex-1 text-base font-semibold leading-snug text-[#1e1e1e] dark:text-[#ddd] break-words" data-testid="commit-info-subject">
                            {commit.subject}
                        </div>
                        <div className="flex shrink-0 items-center gap-1">
                            <button
                                type="button"
                                onClick={onCopy}
                                className="inline-flex items-center gap-2 rounded border border-[#e0e0e0] dark:border-[#3c3c3c] bg-[#f7f8fa] dark:bg-[#2d2d30] px-2 py-1 font-mono text-[11px] text-[#0078d4] dark:text-[#3794ff] hover:bg-black/[0.04] dark:hover:bg-white/[0.06] focus-visible:ring-2 focus-visible:ring-[#0078d4]"
                                title={hashCopied ? 'Copied!' : 'Copy commit hash'}
                                aria-label={hashCopied ? 'Copied!' : 'Copy commit hash'}
                                data-testid="commit-info-copy-hash"
                            >
                                <span data-testid="commit-info-hash">{commit.hash.slice(0, 8)}</span>
                                <CommitDetailIcon name={hashCopied ? 'check' : 'copy'} />
                                {hashCopied && <span role="status" className="sr-only">Copied!</span>}
                            </button>
                            <button
                                type="button"
                                data-testid="commit-info-collapse-btn"
                                onClick={onToggle}
                                className="inline-flex h-7 w-7 items-center justify-center rounded text-[#616161] dark:text-[#999] hover:bg-black/[0.06] dark:hover:bg-white/[0.08] focus-visible:ring-2 focus-visible:ring-[#0078d4]"
                                title="Hide commit details"
                                aria-label="Hide commit details"
                                aria-expanded={true}
                                aria-controls={headerId}
                            >
                                <CommitDetailIcon name="up" />
                            </button>
                        </div>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-[#616161] dark:text-[#aaa]" data-testid="commit-info-meta-row">
                        <span className="font-medium text-[#1e1e1e] dark:text-[#ccc]" data-testid="commit-info-author">{commit.author}</span>
                        <span data-testid="commit-info-date">{formattedDate}</span>
                        {fileCount > 0 && <span data-testid="commit-info-file-count">{fileCount} {fileCount === 1 ? 'file' : 'files'} changed</span>}
                    </div>
                    {(commit.authorEmail || commit.parentHashes.length > 0 || commit.body) && (
                        <div className="mt-3 border-t border-[#ececec] dark:border-[#3c3c3c] pt-2" data-testid="commit-info-details">
                            <div className="flex flex-wrap gap-x-5 gap-y-1 text-[11px] text-[#616161] dark:text-[#999]">
                                {commit.authorEmail && <span className="break-all" data-testid="commit-info-email">Author &lt;{commit.authorEmail}&gt;</span>}
                                {commit.parentHashes.length > 0 && (
                                    <span data-testid="commit-info-parents">{commit.parentHashes.length === 1 ? 'Parent' : 'Parents'}: <span className="font-mono">{commit.parentHashes.map(p => p.slice(0, 7)).join(', ')}</span></span>
                                )}
                            </div>
                            {commit.body && (
                                <div className="mt-2" data-testid="commit-info-body">
                                    <pre className="text-[11px] text-[#1e1e1e] dark:text-[#ccc] whitespace-pre-wrap break-words font-sans leading-relaxed m-0">{commit.body}</pre>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
