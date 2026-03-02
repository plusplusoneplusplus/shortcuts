/**
 * CommitTooltip — hover tooltip for commit rows in the left panel.
 *
 * Shows full commit subject, author, date, hash, parents, body, and a
 * Copy Hash button. Positioned absolutely relative to the hovered row.
 */

import { useState, useRef, useEffect } from 'react';
import { Button } from '../shared';
import { copyToClipboard } from '../utils/format';
import type { GitCommitItem } from './CommitList';

export interface CommitTooltipProps {
    commit: GitCommitItem;
    anchorRect: DOMRect | null;
    onMouseEnter?: () => void;
    onMouseLeave?: () => void;
}

export function CommitTooltip({ commit, anchorRect, onMouseEnter, onMouseLeave }: CommitTooltipProps) {
    const [copied, setCopied] = useState(false);
    const tooltipRef = useRef<HTMLDivElement>(null);
    const [position, setPosition] = useState<{ top: number; left: number }>({ top: 0, left: 0 });

    useEffect(() => {
        if (!anchorRect || !tooltipRef.current) return;
        const tooltip = tooltipRef.current;
        const rect = tooltip.getBoundingClientRect();
        const viewportH = window.innerHeight;

        let top = anchorRect.top;
        const left = anchorRect.right + 8;

        // Flip above if overflowing bottom
        if (top + rect.height > viewportH) {
            top = anchorRect.top - rect.height - 4;
        }

        // Guard against right-side overflow
        const viewportW = window.innerWidth;
        const finalLeft = Math.min(left, viewportW - rect.width - 8);

        setPosition({ top, left: finalLeft });
    }, [anchorRect]);

    const handleCopyHash = (e: React.MouseEvent) => {
        e.stopPropagation();
        copyToClipboard(commit.hash).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        });
    };

    const formattedDate = (() => {
        try { return new Date(commit.date).toLocaleString(); } catch { return commit.date; }
    })();

    return (
        <div
            ref={tooltipRef}
            className="fixed z-50 w-[480px] max-w-[calc(100vw-32px)] max-h-[300px] overflow-y-auto bg-white dark:bg-[#2d2d2d] border border-[#e0e0e0] dark:border-[#555] rounded-lg shadow-lg p-3 select-text cursor-text"
            style={{ top: position.top, left: position.left }}
            data-testid="commit-tooltip"
            onMouseEnter={onMouseEnter}
            onMouseLeave={onMouseLeave}
        >
            {/* Full subject */}
            <div className="text-xs font-semibold text-[#1e1e1e] dark:text-[#ccc] mb-2 break-words" data-testid="tooltip-subject">
                {commit.subject}
            </div>

            {/* Metadata */}
            <div className="flex flex-col gap-1 text-[11px] text-[#616161] dark:text-[#999] mb-2" data-testid="tooltip-metadata">
                <div>Author: <strong className="text-[#1e1e1e] dark:text-[#ccc]">{commit.author}</strong></div>
                <div>Date: {formattedDate}</div>
                <div className="flex items-center gap-1">
                    Hash: <span className="font-mono text-[#0078d4] dark:text-[#3794ff]">{commit.hash.substring(0, 8)}</span>
                    <Button variant="secondary" size="sm" onClick={handleCopyHash} data-testid="tooltip-copy-hash-btn">
                        {copied ? 'Copied!' : 'Copy'}
                    </Button>
                </div>
                {commit.parentHashes.length > 0 && (
                    <div>Parents: {commit.parentHashes.map(p => p.substring(0, 7)).join(', ')}</div>
                )}
            </div>

            {/* Body / description */}
            {commit.body && (
                <div className="border-t border-[#e0e0e0] dark:border-[#3c3c3c] pt-2 mt-1" data-testid="tooltip-body">
                    <pre className="text-[11px] text-[#1e1e1e] dark:text-[#ccc] whitespace-pre-wrap font-sans leading-relaxed m-0 max-h-[120px] overflow-y-auto">{commit.body}</pre>
                </div>
            )}
        </div>
    );
}
