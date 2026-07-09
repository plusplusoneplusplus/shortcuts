import { RemoteScopeCluster } from './RemoteScopeCluster';
import { WorkspaceTabsCluster } from './WorkspaceTabsCluster';
import type { RepoData } from '../../repos/repoGrouping';

export interface RemoteShellHeaderProps {
    repo?: RepoData;
    repos: RepoData[];
}

// Remote-shell visual gate: always rendered in remote-first mode (desktop).
// When no concrete repository is selected, RemoteScopeCluster shows an
// unselected "Select repository" picker; the workspace tabs and divider are
// omitted until a real clone is active.
export function RemoteShellHeader({ repo, repos }: RemoteShellHeaderProps) {
    return (
        <div className="hidden md:flex items-center gap-1.5 min-w-0 flex-1" data-testid="remote-shell-header">
            <RemoteScopeCluster repo={repo} repos={repos} />
            {repo && (
                <>
                    <span className="w-px h-[18px] bg-[#d8dee4] dark:bg-[#3c3c3c] flex-shrink-0" aria-hidden />
                    <WorkspaceTabsCluster repo={repo} repos={repos} />
                </>
            )}
        </div>
    );
}
