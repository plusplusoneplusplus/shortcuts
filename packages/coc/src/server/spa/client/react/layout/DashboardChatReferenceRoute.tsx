import { useEffect, useState } from 'react';
import { parseDashboardChatReference, resolveDashboardChatReference } from '../shared/dashboard-discovery/chat-reference';
import { getDashboardTopology, subscribeDashboardTopology } from '../shared/dashboard-discovery/topology';
import { openUnifiedPanelTab } from '../features/repo-detail/unified-right-panel/unifiedPanelOpen';
import { WORKSPACE_PREVIEW_PREFIX } from '../shared/file-viewer/workspacePreview';

/** Hold direct links outside workspace rendering until their exact destination is verified. */
export function DashboardChatReferenceRoute({ hash }: { hash: string }) {
    const [attempt, setAttempt] = useState(0);
    const [checking, setChecking] = useState(true);

    useEffect(() => {
        const reference = parseDashboardChatReference(hash);
        setChecking(true);
        let stopped = false;
        let controller: AbortController | undefined;
        const stop = () => {
            stopped = true;
            controller?.abort();
            clearTimeout(deadline);
        };
        const fail = () => {
            stop();
            setChecking(false);
        };
        const deadline = setTimeout(fail, 10_000);
        const refresh = () => {
            if (stopped || location.hash !== hash) return;
            controller?.abort();
            controller = undefined;
            if (!reference) { fail(); return; }
            const matches = getDashboardTopology().routes.filter(({ row }) =>
                row.serverIdentity === reference.serverIdentity && row.workspaceId === reference.workspaceId);
            if (!matches.some(({ row }) => row.online)) {
                // Initial topology/identity observations may still be loading.
                if (matches.length) fail();
                return;
            }
            const current = new AbortController();
            controller = current;
            void resolveDashboardChatReference(reference, current.signal).then(result => {
                if (stopped || current.signal.aborted || location.hash !== hash) return;
                stop();
                if (result.artifactPath !== undefined) {
                    openUnifiedPanelTab(result.workspaceId, {
                        kind: 'file', ownerWorkspaceId: result.workspaceId,
                        ownerRoutingRef: result.selectionId === result.workspaceId ? null : result.selectionId,
                        chatId: result.processId, resourceId: WORKSPACE_PREVIEW_PREFIX + result.artifactPath,
                        label: result.artifactPath.replace(/\\/g, '/').split('/').pop() || 'Artifact',
                    });
                }
                window.history.replaceState(null, '', result.href);
                window.dispatchEvent(new HashChangeEvent('hashchange'));
            }, () => {
                if (!stopped && !current.signal.aborted && location.hash === hash) fail();
            });
        };
        const unsubscribe = subscribeDashboardTopology(refresh);
        window.addEventListener('pagehide', fail);
        // Cancel synchronously, including before React processes a route change.
        const onHashChange = () => { if (location.hash !== hash) stop(); };
        window.addEventListener('hashchange', onHashChange);
        refresh();
        return () => {
            stop();
            unsubscribe();
            window.removeEventListener('pagehide', fail);
            window.removeEventListener('hashchange', onHashChange);
        };
    }, [hash, attempt]);

    return <div role="status" aria-live="polite">
        {checking ? 'Checking referenced chat or artifact…' : <>
            <p>Referenced chat or artifact unavailable. Reconnect its server and try again.</p>
            <button type="button" onClick={() => setAttempt(value => value + 1)}>Retry</button>
        </>}
    </div>;
}
