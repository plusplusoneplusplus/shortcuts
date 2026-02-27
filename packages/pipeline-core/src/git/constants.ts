/**
 * Shared constants for git-related functionality.
 *
 * Extracted from `src/shortcuts/git/git-constants.ts`.
 */

import { GitChangeStatus, GitChangeStage } from './types';

/**
 * Short status indicator for display (M, A, D, R, etc.)
 */
export const STATUS_SHORT: Record<GitChangeStatus, string> = {
    'modified': 'M',
    'added': 'A',
    'deleted': 'D',
    'renamed': 'R',
    'copied': 'C',
    'untracked': 'U',
    'ignored': 'I',
    'conflict': '!'
};

/**
 * Stage prefix for description display.
 * Makes the stage visually clear with symbols.
 */
export const STAGE_PREFIX: Record<GitChangeStage, string> = {
    'staged': '\u2713',      // ✓ checkmark
    'unstaged': '\u25CF',    // ● filled circle
    'untracked': '?'         // ? question mark
};

/**
 * Stage labels for display.
 * Human-readable labels for each stage.
 */
export const STAGE_LABEL: Record<GitChangeStage, string> = {
    'staged': 'Staged',
    'unstaged': 'Modified',
    'untracked': 'Untracked'
};
