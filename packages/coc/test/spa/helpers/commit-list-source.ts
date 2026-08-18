/**
 * Source-mirror helper for the CommitList test family.
 *
 * Several CommitList tests assert on the component's source text (props,
 * class names, test ids, handler wiring). The implementation is split across
 * an interaction kernel, three hooks, and five presentation components, so
 * those assertions read the concatenated family rather than a single file —
 * an assertion stays true wherever inside the kernel the line lives, and
 * `not.toContain` assertions get stronger, not weaker.
 */

import * as fs from 'fs';
import * as path from 'path';

const COMMITS_DIR = path.join(
    __dirname, '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'features', 'git', 'commits',
);

/** Files that together make up the CommitList implementation. */
export const COMMIT_LIST_MODULES = [
    'CommitList.tsx',
    'commitListTypes.ts',
    'commitListSelection.ts',
    'commitRowViewModel.ts',
    'useCommitListExpansion.ts',
    'useCommitListGestures.ts',
    'useCommitListDragController.ts',
    'CommitRow.tsx',
    'CommitRowBadges.tsx',
    'CommitGroupSeparator.tsx',
    'CommitExpandedFiles.tsx',
    'CommitMobileSelectionBar.tsx',
] as const;

export function commitListModulePath(fileName: string): string {
    return path.join(COMMITS_DIR, fileName);
}

/** Concatenated source of every module in the CommitList family. */
export function readCommitListSource(): string {
    return COMMIT_LIST_MODULES
        .map(name => fs.readFileSync(path.join(COMMITS_DIR, name), 'utf-8'))
        .join('\n');
}
