import { useState } from 'react';
import { cn } from './cn';

export interface PastePreviewProps {
    /** Character count of the pasted content */
    charCount: number;
    /** First N lines of pasted content */
    previewLines: string[];
    /** Called to dismiss the preview and clear paste state */
    onDismiss: () => void;
    /** Optional additional className */
    className?: string;
    /** data-testid for testing */
    'data-testid'?: string;
}

function formatCharCount(count: number): string {
    if (count >= 1_000_000) return `~${(count / 1_000_000).toFixed(1)}M`;
    if (count >= 1_000) return `~${(count / 1_000).toFixed(1)}K`;
    return `${count}`;
}

export function PastePreview({ charCount, previewLines, onDismiss, className, ...props }: PastePreviewProps) {
    const [expanded, setExpanded] = useState(false);

    if (charCount === 0) return null;

    return (
        <div
            className={cn(
                'flex flex-col gap-1 px-2.5 py-1.5 rounded border',
                'border-[#d0d0d0] dark:border-[#3c3c3c]',
                'bg-[#f5f5f5] dark:bg-[#2d2d2d]',
                'text-xs text-[#1e1e1e] dark:text-[#cccccc]',
                className,
            )}
            data-testid={props['data-testid'] ?? 'paste-preview'}
        >
            <div className="flex items-center gap-1.5">
                <span className="shrink-0">📎</span>
                <button
                    type="button"
                    className="flex-1 text-left cursor-pointer bg-transparent border-none p-0 text-xs text-[#1e1e1e] dark:text-[#cccccc] hover:underline"
                    onClick={() => setExpanded(v => !v)}
                    data-testid="paste-preview-toggle"
                >
                    Large content pasted ({formatCharCount(charCount)} chars)
                    <span className="ml-1 text-[10px] text-[#848484]">{expanded ? '▾' : '▸'}</span>
                </button>
                <button
                    type="button"
                    onClick={onDismiss}
                    title="Remove paste preview"
                    className="shrink-0 w-5 h-5 flex items-center justify-center rounded bg-transparent border-none text-[#848484] hover:text-[#f14c4c] cursor-pointer text-sm"
                    data-testid="paste-preview-dismiss"
                >
                    ×
                </button>
            </div>
            {expanded && previewLines.length > 0 && (
                <div
                    className="mt-1 pl-5 font-mono text-[11px] text-[#848484] dark:text-[#666] whitespace-pre overflow-x-auto max-h-24"
                    data-testid="paste-preview-content"
                >
                    {previewLines.map((line, i) => (
                        <div key={i} className="truncate">{line || '\u00A0'}</div>
                    ))}
                </div>
            )}
        </div>
    );
}
