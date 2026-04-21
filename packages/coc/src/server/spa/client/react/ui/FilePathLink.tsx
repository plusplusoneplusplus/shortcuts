/**
 * FilePathLink — renders a `<span class="file-path-link">` that the global
 * delegation in `file-path-preview.ts` automatically wires up with
 * hover-to-preview and click-to-open-in-dialog behavior.
 */

import React from 'react';
import { toForwardSlashes } from '@plusplusoneplusplus/forge/utils/path-utils';
import { shortenFilePath } from '../shared/file-path-utils';
import { cn } from './cn';

export interface FilePathLinkProps {
    path: string;
    className?: string;
    /** When true (default), display the shortened path via `shortenFilePath()`. */
    shorten?: boolean;
    /** When true, disable truncation and allow the path to wrap with `break-all`. */
    noTruncate?: boolean;
}

export function FilePathLink({ path, className, shorten = true, noTruncate = false }: FilePathLinkProps) {
    if (!path) return null;
    const normalized = toForwardSlashes(path);
    return (
        <span
            className={cn(
                'file-path-link',
                noTruncate ? 'break-all' : 'truncate max-w-[260px]',
                className
            )}
            data-full-path={normalized}
            title={normalized}
        >
            {shorten ? shortenFilePath(normalized) : path}
        </span>
    );
}
