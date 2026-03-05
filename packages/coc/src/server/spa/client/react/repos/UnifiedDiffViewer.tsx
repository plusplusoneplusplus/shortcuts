/**
 * UnifiedDiffViewer — renders a unified diff string with syntax highlighting.
 *
 * Classifies each line by its prefix and applies appropriate background/text
 * colors for added, removed, hunk-header, and metadata lines.
 * Code content lines are syntax-highlighted using highlight.js token spans.
 */

import { useMemo, useEffect } from 'react';
import { getLanguageFromFileName, highlightLine } from './useSyntaxHighlight';

export interface UnifiedDiffViewerProps {
    diff: string;
    fileName?: string;
    'data-testid'?: string;
    enableComments?: boolean;
    showLineNumbers?: boolean;
    onLinesReady?: (lines: DiffLine[]) => void;
}

type LineType = 'added' | 'removed' | 'hunk-header' | 'meta' | 'context';

export interface DiffLine {
    index: number;
    type: LineType;
    oldLine?: number;
    newLine?: number;
    content: string;
}

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

/** Parse a `@@ -old,count +new,count @@` hunk header. */
export function parseHunkHeader(line: string): { oldStart: number; newStart: number } | null {
    const m = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    return m ? { oldStart: parseInt(m[1], 10), newStart: parseInt(m[2], 10) } : null;
}

/** Compute per-line identity (old/new line numbers) for a unified diff. */
export function computeDiffLines(lines: string[]): DiffLine[] {
    let oldLine: number | undefined;
    let newLine: number | undefined;
    return lines.map((raw, index) => {
        const type = classifyLine(raw);
        if (type === 'hunk-header') {
            const parsed = parseHunkHeader(raw);
            if (parsed) { oldLine = parsed.oldStart; newLine = parsed.newStart; }
            return { index, type, content: raw };
        }
        if (type === 'context') {
            const result: DiffLine = { index, type, oldLine, newLine, content: raw };
            if (oldLine !== undefined) oldLine++;
            if (newLine !== undefined) newLine++;
            return result;
        }
        if (type === 'removed') {
            const result: DiffLine = { index, type, oldLine, content: raw };
            if (oldLine !== undefined) oldLine++;
            return result;
        }
        if (type === 'added') {
            const result: DiffLine = { index, type, newLine, content: raw };
            if (newLine !== undefined) newLine++;
            return result;
        }
        // meta
        return { index, type, content: raw };
    });
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

export function UnifiedDiffViewer({ diff, fileName, 'data-testid': testId, enableComments, showLineNumbers, onLinesReady }: UnifiedDiffViewerProps) {
    const lines = useMemo(() => diff.split('\n'), [diff]);
    const languages = useMemo(() => getLanguagesForLines(lines, fileName), [lines, fileName]);
    const diffLines = useMemo(() => computeDiffLines(lines), [lines]);

    useEffect(() => {
        onLinesReady?.(diffLines);
    }, [diffLines, onLinesReady]);

    return (
        <div
            className="overflow-x-auto font-mono text-xs bg-[#f5f5f5] dark:bg-[#2d2d2d] border border-[#e0e0e0] dark:border-[#3c3c3c] rounded"
            data-testid={testId}
        >
            {lines.map((line, i) => {
                const { type, oldLine, newLine } = diffLines[i];
                if ((type === 'added' || type === 'removed' || type === 'context') && line.length > 0) {
                    const prefix = line[0];
                    const content = line.slice(1);
                    const html = highlightLine(content, languages[i]);
                    return (
                        <div
                            key={i}
                            className={`whitespace-pre px-3 ${LINE_CLASSES[type]}`}
                            data-diff-line-index={enableComments ? i : undefined}
                            data-old-line={enableComments ? (oldLine ?? '') : undefined}
                            data-new-line={enableComments ? (newLine ?? '') : undefined}
                            data-line-type={enableComments ? type : undefined}
                        >
                            {showLineNumbers && (
                                <>
                                    <span className="select-none text-right w-10 inline-block text-[#6e7681] pr-1">
                                        {oldLine ?? ''}
                                    </span>
                                    <span className="select-none text-right w-10 inline-block text-[#6e7681] pr-1">
                                        {newLine ?? ''}
                                    </span>
                                </>
                            )}
                            <span>{prefix}</span>
                            <span dangerouslySetInnerHTML={{ __html: html }} />
                        </div>
                    );
                }
                return (
                    <div
                        key={i}
                        className={`whitespace-pre px-3 ${LINE_CLASSES[type]}`}
                        data-diff-line-index={enableComments ? i : undefined}
                        data-old-line={enableComments ? (oldLine ?? '') : undefined}
                        data-new-line={enableComments ? (newLine ?? '') : undefined}
                        data-line-type={enableComments ? type : undefined}
                    >
                        {showLineNumbers && (
                            <>
                                <span className="select-none text-right w-10 inline-block text-[#6e7681] pr-1">
                                    {oldLine ?? ''}
                                </span>
                                <span className="select-none text-right w-10 inline-block text-[#6e7681] pr-1">
                                    {newLine ?? ''}
                                </span>
                            </>
                        )}
                        {line || '\u00a0'}
                    </div>
                );
            })}
        </div>
    );
}
