/**
 * Source-mirror helper for the RepoGitTab test family.
 *
 * Many RepoGitTab tests assert on the tab's source text (props, class names,
 * test ids, handler wiring, API calls). The implementation is split across a
 * composition shell, five hooks, three pure models, and three presentation
 * components, so those assertions read the concatenated family rather than a
 * single file — an assertion stays true wherever inside the family the line
 * lives, and `not.toContain` assertions get stronger, not weaker.
 */

import * as fs from 'fs';
import * as path from 'path';

const GIT_DIR = path.join(
    __dirname, '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'features', 'git',
);

/** The composition shell. Assertions about layout branches read this alone. */
export const REPO_GIT_TAB_SHELL = 'RepoGitTab.tsx';

/** Files under `git/repoGitTab/` that together make up the tab's behaviour. */
export const REPO_GIT_TAB_MODULES = [
    'types.ts',
    'selectionModel.ts',
    'commitIdentity.ts',
    'gitPrompts.ts',
    'gitContextMenuModel.ts',
    'useTransientToast.ts',
    'useRepoGitData.ts',
    'useRepoGitSelection.ts',
    'useGitOperationActions.ts',
    'useGitAutoPullController.ts',
    'useGitSkillActions.ts',
    'RepoGitListPane.tsx',
    'RepoGitDetailPane.tsx',
    'RepoGitOverlays.tsx',
] as const;

/** Absolute path of a module in the family (`RepoGitTab.tsx` or a `repoGitTab/` file). */
export function repoGitTabModulePath(fileName: string): string {
    return fileName === REPO_GIT_TAB_SHELL
        ? path.join(GIT_DIR, fileName)
        : path.join(GIT_DIR, 'repoGitTab', fileName);
}

/** Source of the composition shell only. */
export function readRepoGitTabShellSource(): string {
    return fs.readFileSync(repoGitTabModulePath(REPO_GIT_TAB_SHELL), 'utf-8');
}

/** Concatenated source of every module in the RepoGitTab family. */
export function readRepoGitTabSource(): string {
    return [REPO_GIT_TAB_SHELL, ...REPO_GIT_TAB_MODULES]
        .map(name => fs.readFileSync(repoGitTabModulePath(name), 'utf-8'))
        .join('\n');
}
