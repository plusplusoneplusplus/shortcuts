import { RemoteScopeCluster } from './RemoteScopeCluster';
import { WorkspaceTabsCluster } from './WorkspaceTabsCluster';
import type { RepoData } from '../../repos/repoGrouping';

export interface RemoteShellHeaderProps {
    repo: RepoData;
    repos: RepoData[];
}

export function RemoteShellHeader({ repo, repos }: RemoteShellHeaderProps) {
    return (
        <div className="hidden md:flex items-center gap-1.5 min-w-0 flex-1" data-testid="remote-shell-header">
            <RemoteScopeCluster repo={repo} repos={repos} />
            <span className="w-px h-[18px] bg-[#d8dee4] dark:bg-[#3c3c3c] flex-shrink-0" aria-hidden />
            <WorkspaceTabsCluster repo={repo} repos={repos} />
        </div>
    );
}
