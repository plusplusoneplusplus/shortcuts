/**
 * Shared file-path utilities for the SPA dashboard.
 *
 * - `shortenFilePath` — trims common home-directory prefixes for display.
 * - `FILE_PATH_RE` — regex matching absolute file paths (Unix + Windows).
 * - `linkifyFilePaths` — post-processes HTML to wrap paths in interactive
 *   `.file-path-link` spans (used by the global hover/click delegation in
 *   `file-path-preview.ts`).
 */

import { toForwardSlashes } from '@plusplusoneplusplus/pipeline-core/utils/path-utils';

/** Shorten common prefixes for display. */
export function shortenFilePath(p: string): string {
    if (!p) return '';
    return p
        .replace(/^\/Users\/[^/]+\/Documents\/Projects\//, '')
        .replace(/^\/Users\/[^/]+\//, '~/')
        .replace(/^\/home\/[^/]+\//, '~/')
        .replace(/^[A-Za-z]:\/Users\/[^/]+\/Documents\/Projects\//, '')
        .replace(/^[A-Za-z]:\/Users\/[^/]+\//, '~/');
}

/**
 * Regex matching absolute file paths — Unix (`/Users`, `/home`, …) and
 * Windows drive-letter paths (`C:\…`).
 */
export const FILE_PATH_RE = /(?:\/(?:Users|home|tmp|var|etc|opt|usr|mnt|Volumes)[^\s&"'<>()]*|(?<![/\w])[A-Za-z]:[/\\][\w./@\\-]+)/g;

/**
 * Post-process HTML to wrap file paths in interactive `.file-path-link` spans.
 * Only operates on text outside HTML tags and `<code>` blocks.
 */
export function linkifyFilePaths(html: string): string {
    let insideCode = 0;
    return html.replace(/(<\/?(code|pre)[^>]*>)|(<[^>]+>)|([^<]+)/gi, (_match, codeTag, _codeTagName, otherTag, text) => {
        if (codeTag) {
            if (codeTag[1] === '/') insideCode = Math.max(0, insideCode - 1);
            else insideCode++;
            return codeTag;
        }
        if (otherTag) return otherTag;
        if (!text || insideCode > 0) return text || '';
        return text.replace(FILE_PATH_RE, (pathMatch: string) => {
            const normalized = toForwardSlashes(pathMatch);
            const short = shortenFilePath(normalized);
            return `<span class="file-path-link" data-full-path="${normalized}" title="${normalized}">${short}</span>`;
        });
    });
}
