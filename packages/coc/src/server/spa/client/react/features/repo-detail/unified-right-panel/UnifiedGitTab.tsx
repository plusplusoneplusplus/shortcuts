/**
 * UnifiedGitTab — the body of a workspace's Git tab.
 *
 * An empty host: `RepoGitTab` owns the git selection and portals its
 * `RepoGitDetailPane` in here (see `unifiedGitTabHost.ts`), so the diff views,
 * toolbars, comments, and navigation are exactly the ones the middle pane used
 * to show. The node is published by panel scope while this tab is mounted.
 */

import { useCallback, useRef } from 'react';
import { clearUnifiedGitTabHost, setUnifiedGitTabHost } from './unifiedGitTabHost';

export interface UnifiedGitTabProps {
    /** The panel scope whose `RepoGitTab` portals into this body. */
    scopeWorkspaceId: string;
}

export function UnifiedGitTab({ scopeWorkspaceId }: UnifiedGitTabProps) {
    const nodeRef = useRef<HTMLDivElement | null>(null);
    const ref = useCallback((node: HTMLDivElement | null) => {
        if (nodeRef.current) clearUnifiedGitTabHost(scopeWorkspaceId, nodeRef.current);
        nodeRef.current = node;
        if (node) setUnifiedGitTabHost(scopeWorkspaceId, node);
    }, [scopeWorkspaceId]);
    return (
        <div
            ref={ref}
            className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden"
            data-testid="unified-git-tab"
        />
    );
}
