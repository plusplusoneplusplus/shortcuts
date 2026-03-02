/**
 * UnifiedDiffViewer — renders a unified diff string with syntax highlighting.
 *
 * Classifies each line by its prefix and applies appropriate background/text
 * colors for added, removed, hunk-header, and metadata lines.
 */

import { useMemo } from 'react';

export interface UnifiedDiffViewerProps {
    diff: string;
    'data-testid'?: string;
}

type LineType = 'added' | 'removed' | 'hunk-header' | 'meta' | 'context';

const LINE_CLASSES: Record<LineType, string> = {
    added: 'bg-[#e6ffed] dark:bg-[#1a3d2b] text-[#22863a] dark:text-[#3fb950]',
    removed: 'bg-[#ffeef0] dark:bg-[#3d1a1a] text-[#b31d28] dark:text-[#f85149]',
    'hunk-header': 'bg-[#dbedff] dark:bg-[#1d3251] text-[#0550ae] dark:text-[#79c0ff]',
    meta: 'text-[#6e7681] dark:text-[#8b949e]',
    context: '',
};

function classifyLine(line: string): LineType {
    if (line.startsWith('@@')) return 'hunk-header';
    if (line.startsWith('diff ') || line.startsWith('index ') || line.startsWith('--- ') || line.startsWith('+++ ') || line.startsWith('new file') || line.startsWith('deleted file') || line.startsWith('rename')) return 'meta';
    if (line.startsWith('+')) return 'added';
    if (line.startsWith('-')) return 'removed';
    return 'context';
}

export function UnifiedDiffViewer({ diff, 'data-testid': testId }: UnifiedDiffViewerProps) {
    const lines = useMemo(() => diff.split('\n'), [diff]);

    return (
        <div
            className="overflow-x-auto font-mono text-xs bg-[#f5f5f5] dark:bg-[#2d2d2d] border border-[#e0e0e0] dark:border-[#3c3c3c] rounded"
            data-testid={testId}
        >
            {lines.map((line, i) => {
                const type = classifyLine(line);
                return (
                    <div key={i} className={`whitespace-pre px-3 ${LINE_CLASSES[type]}`}>
                        {line || '\u00a0'}
                    </div>
                );
            })}
        </div>
    );
}
