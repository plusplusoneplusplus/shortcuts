import { useEffect, useState } from 'react';
import { WorkItemsTab } from '../../work-items/WorkItemsTab';
import { PullRequestsTab } from '../../pull-requests/PullRequestsTab';
import { WorkspaceSettingsApiProvider } from '../../repo-settings/workspaceSettingsClient';
import { useCocClient } from '../../../repos/cloneRouting';
import { resolveCanonicalOriginId } from '../../../repos/originScope';
import { usePullRequestsEnabled } from '../../../hooks/feature-flags/usePullRequestsEnabled';
import { WorkResourceNavigationContext } from './workResourceNavigation';
import type { UnifiedPanelTab } from './unifiedPanelTabsModel';

export function UnifiedWorkResourceTab({ tab, scopeId }: { tab: UnifiedPanelTab; scopeId: string }) {
    const enabled = usePullRequestsEnabled();
    const ownerId = tab.ownerRoutingRef ?? tab.ownerWorkspaceId;
    if (tab.kind === 'pull-requests' && !enabled) return <div role="status" className="p-3">Pull Requests are disabled.</div>;
    return <WorkspaceSettingsApiProvider workspaceId={tab.ownerWorkspaceId} selectionId={ownerId}>
        <WorkResourceNavigationContext.Provider value={{ tab, scopeId }}>
            <WorkResourceContent tab={tab} ownerId={ownerId} />
        </WorkResourceNavigationContext.Provider>
    </WorkspaceSettingsApiProvider>;
}
function WorkResourceContent({ tab, ownerId }: { tab: UnifiedPanelTab; ownerId: string }) {
    const client = useCocClient(tab.ownerWorkspaceId);
    const [info, setInfo] = useState<{ isGitRepo?: boolean; remoteUrl?: string | null } | null>(null);
    const [error, setError] = useState('');
    const [attempt, setAttempt] = useState(0);
    useEffect(() => {
        let current = true;
        setError('');
        client.workspaces.gitInfo(tab.ownerWorkspaceId).then(value => {
            if (current) setInfo(value);
        }).catch(error => { if (current) setError(String(error)); });
        return () => { current = false; };
    }, [client, tab.ownerWorkspaceId, attempt]);
    if (error) return <div role="alert" className="p-3 break-words">{error} <button onClick={() => setAttempt(n => n + 1)}>Retry</button></div>;
    if (!info) return <div role="status" className="p-3">Loading repository…</div>;
    return <div className="h-full min-h-0 min-w-0 overflow-hidden">
        {tab.kind === 'work-items'
            ? <WorkItemsTab workspaceId={tab.ownerWorkspaceId} attachmentDestinationId={ownerId}
                originId={resolveCanonicalOriginId({ workspaceId: tab.ownerWorkspaceId, remoteUrl: info.remoteUrl })} />
            : <PullRequestsTab repoId={tab.ownerWorkspaceId} workspaceId={tab.ownerWorkspaceId}
                attachmentDestinationId={ownerId} remoteUrl={info.remoteUrl ?? undefined} />}
    </div>;
}
