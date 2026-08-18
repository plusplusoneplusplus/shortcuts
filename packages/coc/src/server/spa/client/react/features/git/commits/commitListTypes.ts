/**
 * Shared types and environment probes for the CommitList family.
 *
 * Lives in its own module so the row/badge components and the interaction
 * hooks can depend on them without importing CommitList.tsx (which imports
 * those components back).
 */

export interface GitCommitItem {
    hash: string;
    shortHash: string;
    subject: string;
    author: string;
    authorEmail?: string;
    date: string;
    parentHashes: string[];
    body?: string;
}

// Returns true on touch-only devices where hover events are unreliable (iOS, Android).
// Uses CSS `(hover: none)` which matches devices with no fine pointer (mouse/trackpad).
export const isTouchOnly = (): boolean =>
    typeof window !== 'undefined' && window.matchMedia('(hover: none)').matches;
