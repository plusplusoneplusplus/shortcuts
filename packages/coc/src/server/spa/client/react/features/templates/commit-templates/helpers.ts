/**
 * Shared pure helpers for commit-template surfaces (RepoTemplatesTab and TemplatesTab).
 * Kept free of React so they can be unit-tested directly.
 */

import type { TemplateChangedFile } from '@plusplusoneplusplus/coc-client';

export const enc = encodeURIComponent;

/** Tailwind text color for a changed-file status. */
export function statusColor(status: TemplateChangedFile['status']): string {
    switch (status) {
        case 'added': return 'text-green-600 dark:text-green-400';
        case 'deleted': return 'text-red-500 dark:text-red-400';
        case 'renamed': return 'text-yellow-600 dark:text-yellow-400';
        default: return 'text-[#6e6e6e] dark:text-[#888]';
    }
}

/** Validate a commit-template name. Returns an error message, or null when valid. */
export function validateTemplateName(v: string): string | null {
    if (!v) return 'Name is required';
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(v)) return 'Must be kebab-case (e.g., fix-parser)';
    if (v.length > 64) return 'Max 64 characters';
    return null;
}

/** Split a hints textarea into trimmed, non-empty lines. */
export function parseTemplateHints(text: string): string[] {
    return text.split('\n').map(l => l.trim()).filter(Boolean);
}

/** Normalize an unknown thrown value into a display string. */
export function getTemplateErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
