/**
 * TruncatedPath — renders a file path with smart JS-level middle-truncation.
 *
 * When the directory segment count exceeds `maxSegments`, the path is
 * middle-truncated: first N segments + `…` + last M segments + filename.
 * Example: `packages/coc/…/hooks/useScriptTemplates.ts`
 *
 * The full path is always available as a `title` tooltip.
 */

import React, { useMemo } from 'react';

export interface TruncatedPathProps {
    path: string;
    className?: string;
    /** Max directory segments before middle-truncation kicks in (default 5). */
    maxSegments?: number;
}

/**
 * Split a path into directory segments and filename.
 * Handles both `/` and `\` separators.
 */
function splitPath(path: string): { segments: string[]; fileName: string; sep: string } {
    const sep = path.includes('\\') ? '\\' : '/';
    const parts = path.split(/[/\\]/);
    const fileName = parts.pop() ?? '';
    return { segments: parts, fileName, sep };
}

/**
 * Middle-truncate directory segments when they exceed maxSegments.
 * Returns the display directory string (with trailing separator).
 */
function truncateDir(segments: string[], maxSegments: number, sep: string): string {
    if (segments.length === 0) return '';
    if (segments.length <= maxSegments) return segments.join(sep) + sep;

    // Keep first ceil(max/2) and last floor(max/2) segments
    const headCount = Math.ceil(maxSegments / 2);
    const tailCount = Math.floor(maxSegments / 2);
    const head = segments.slice(0, headCount);
    const tail = tailCount > 0 ? segments.slice(-tailCount) : [];
    return [...head, '…', ...tail].join(sep) + sep;
}

export function TruncatedPath({ path, className, maxSegments = 5 }: TruncatedPathProps) {
    if (!path) return null;

    const { dirDisplay, fileName } = useMemo(() => {
        const { segments, fileName, sep } = splitPath(path);
        const dirDisplay = truncateDir(segments, maxSegments, sep);
        return { dirDisplay, fileName };
    }, [path, maxSegments]);

    return (
        <span className={`flex min-w-0 overflow-hidden font-mono ${className ?? ''}`} title={path}>
            {dirDisplay && (
                <span className="flex-shrink text-inherit opacity-70 whitespace-nowrap">{dirDisplay}</span>
            )}
            <span className="flex-shrink-0 whitespace-nowrap text-inherit">{fileName}</span>
        </span>
    );
}
