/**
 * UnifiedDiffViewer — renders a unified diff string with syntax highlighting.
 *
 * Classifies each line by its prefix and applies appropriate background/text
 * colors for added, removed, hunk-header, and metadata lines.
 * Code content lines are syntax-highlighted using highlight.js token spans.
 */

import { useMemo } from 'react';
import { getLanguageFromFileName, highlightLine } from './useSyntaxHighlight';

export interface UnifiedDiffViewerProps {
    diff: string;
    fileName?: string;
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

/** Extract file path from a `diff --git a/<path> b/<path>` header line. */
export function extractFilePathFromDiffHeader(line: string): string | null {
    const match = line.match(/^diff --git a\/.+ b\/(.+)$/);
    return match ? match[1] : null;
}

/**
 * Compute per-line language for syntax highlighting.
 * When `fileName` is provided, every line uses that language.
 * Otherwise, parses `diff --git` headers to switch language per file section.
 */
export function getLanguagesForLines(lines: string[], fileName: string | undefined): (string | null)[] {
    if (fileName) {
        const lang = getLanguageFromFileName(fileName);
        return lines.map(() => lang);
    }
    const result: (string | null)[] = [];
    let currentLang: string | null = null;
    for (const line of lines) {
        if (line.startsWith('diff --git ')) {
            const filePath = extractFilePathFromDiffHeader(line);
            currentLang = getLanguageFromFileName(filePath);
        }
        result.push(currentLang);
    }
    return result;
}

export function UnifiedDiffViewer({ diff, fileName, 'data-testid': testId }: UnifiedDiffViewerProps) {
    const lines = useMemo(() => diff.split('\n'), [diff]);
    const languages = useMemo(() => getLanguagesForLines(lines, fileName), [lines, fileName]);

    return (
        <div
            className="overflow-x-auto font-mono text-xs bg-[#f5f5f5] dark:bg-[#2d2d2d] border border-[#e0e0e0] dark:border-[#3c3c3c] rounded"
            data-testid={testId}
        >
            {lines.map((line, i) => {
                const type = classifyLine(line);
                if ((type === 'added' || type === 'removed' || type === 'context') && line.length > 0) {
                    const prefix = line[0];
                    const content = line.slice(1);
                    const html = highlightLine(content, languages[i]);
                    return (
                        <div key={i} className={`whitespace-pre px-3 ${LINE_CLASSES[type]}`}>
                            <span>{prefix}</span>
                            <span dangerouslySetInnerHTML={{ __html: html }} />
                        </div>
                    );
                }
                return (
                    <div key={i} className={`whitespace-pre px-3 ${LINE_CLASSES[type]}`}>
                        {line || '\u00a0'}
                    </div>
                );
            })}
        </div>
    );
}
