import type { RepoData } from '../../repos/repoGrouping';
import { getRemoteCloneKey } from '../../repos/cloneIdentity';
import { getServerName } from '../../repos/repoPickerModel';

export function getWorkspaceMachineName(repo: RepoData): string {
    return getRemoteCloneKey(repo.workspace) ? getServerName(repo) : 'Local';
}

export function getWorkspaceCloneLabel(repo: RepoData, name = repo.workspace.name): string {
    return `${name} / ${getWorkspaceMachineName(repo)}`;
}

/** The owning button uses group/identity for both hover and keyboard-focus help. */
export function WorkspaceCloneLabel({ repo, name = repo.workspace.name }: { repo: RepoData; name?: string }) {
    return (
        <>
            <span data-testid="workspace-clone-label" className="inline-flex flex-1 items-center gap-1.5 min-w-0">
                <span data-testid="workspace-repo-name" className="truncate min-w-0">{name}</span>
                <span aria-hidden className="shrink-0 font-normal text-[#656d76] dark:text-[#999]">/</span>
                <span data-testid="workspace-machine-name" className="truncate shrink-0 max-w-[60%] font-normal text-[#656d76] dark:text-[#b0b0b0]">{getWorkspaceMachineName(repo)}</span>
            </span>
            <span role="tooltip" className="absolute z-50 top-full left-0 mt-1 hidden group-hover/identity:block group-focus-visible/identity:block pointer-events-none w-max max-w-[min(24rem,80vw)] whitespace-normal break-all rounded border border-[#d0d7de] dark:border-[#3c3c3c] bg-white dark:bg-[#252526] px-2 py-1 text-xs font-normal text-[#1f2328] dark:text-[#cccccc] shadow-lg">
                {getWorkspaceCloneLabel(repo, name)}
            </span>
        </>
    );
}
