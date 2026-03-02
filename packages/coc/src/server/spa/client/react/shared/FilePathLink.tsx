/**
 * FilePathLink — renders a `<span class="file-path-link">` that the global
 * delegation in `file-path-preview.ts` automatically wires up with
 * hover-to-preview and click-to-open-in-dialog behavior.
 */

import React from 'react';
import { toForwardSlashes } from '@plusplusoneplusplus/pipeline-core/utils/path-utils';
import { shortenFilePath } from './file-path-utils';

export interface FilePathLinkProps {
    path: string;
    className?: string;
    /** When true (default), display the shortened path via `shortenFilePath()`. */
    shorten?: boolean;
}

export function FilePathLink({ path, className, shorten = true }: FilePathLinkProps) {
    if (!path) return null;
    const normalized = toForwardSlashes(path);
    return (
        <span
            className={`file-path-link break-all ${className ?? ''}`}
            data-full-path={normalized}
            title={normalized}
        >
            {shorten ? shortenFilePath(normalized) : path}
        </span>
    );
}
