/**
 * TruncatedPath — renders a file path with smart middle-truncation.
 *
 * The filename (last segment) is always fully visible. The directory
 * prefix truncates with CSS ellipsis when the container overflows.
 * A title tooltip shows the full path on hover.
 */

import React from 'react';

export interface TruncatedPathProps {
    path: string;
    className?: string;
}

export function TruncatedPath({ path, className }: TruncatedPathProps) {
    if (!path) return null;

    const sep = path.lastIndexOf('/');
    const dirPrefix = sep > 0 ? path.slice(0, sep + 1) : '';
    const fileName = sep >= 0 ? path.slice(sep + 1) : path;

    return (
        <span className={`flex min-w-0 overflow-hidden font-mono ${className ?? ''}`} title={path}>
            {dirPrefix && (
                <span className="truncate flex-shrink text-inherit opacity-70">{dirPrefix}</span>
            )}
            <span className="flex-shrink-0 whitespace-nowrap text-inherit">{fileName}</span>
        </span>
    );
}
