/**
 * Git Diff Comments Module
 * 
 * Provides inline commenting capability for Git diffs.
 * Features:
 * - Side-by-side diff view with commenting
 * - Persistent comments that survive staging/committing
 * - Anchor-based position tracking for comment relocation
 * - Tree view for displaying comments in the Git panel
 */

// Types
export * from './types';

// Anchor system
export {
    calculateSimilarity,
    createDiffAnchor,
    extractSelectedText,
    findAllOccurrences,
    findFuzzyMatch,
    getCharOffset,
    hashText,
    levenshteinDistance,
    needsDiffRelocation,
    normalizeText,
    offsetToLineColumn,
    relocateDiffAnchor,
    scoreMatch,
    splitIntoLines,
    updateDiffAnchor
} from './diff-anchor';

// Comments manager
export { DiffCommentsManager } from './diff-comments-manager';

// Tree data provider for comments
export {
    DiffCommentFileItem,
    DiffCommentItem,
    DiffCommentsTreeDataProvider
} from './diff-comments-tree-provider';

// Content provider
export {
    createCommittedGitContext,
    createStagedGitContext,
    createUnstagedGitContext,
    createUntrackedGitContext,
    getCommittedDiffContent,
    getDiffContent,
    getFileAtRef,
    getStagedDiffContent,
    getUnifiedDiff,
    getUnstagedDiffContent,
    getUntrackedDiffContent
} from './diff-content-provider';

// Editor provider
export { DiffReviewEditorProvider } from './diff-review-editor-provider';

