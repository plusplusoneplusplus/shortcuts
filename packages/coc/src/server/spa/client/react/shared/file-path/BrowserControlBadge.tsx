import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { getSpaCocClient, getCocClientFor } from '../../api/cocClient';
import { useCocClient, useCloneBaseUrl } from '../../repos/cloneRouting';
import { useBrowserToolEnabled } from '../../features/chat/hooks/useBrowserMode';
import { finishBrowserControlActivity, getBrowserControlActivity, subscribeBrowserControlActivity } from './browser-control-activity';
import { getBrowserTakeover, subscribeBrowserTakeover } from './browser-takeover';
import { desktopBrowserBridge } from './browser-bridge';

export function BrowserControlBadge({ workspaceId, tabId, routingRef, viewId }: {
    workspaceId: string;
    tabId: string;
    viewId?: string;
    routingRef?: string | null;
}) {
    const routedClient = useCocClient(routingRef ?? workspaceId);
    const routedBaseUrl = useCloneBaseUrl(routingRef ?? workspaceId);
    const baseUrl = routingRef === null ? undefined : routedBaseUrl;
    const client = routingRef === null ? getSpaCocClient() : baseUrl ? getCocClientFor(baseUrl) : routedClient;
    const activity = useSyncExternalStore(
        subscribeBrowserControlActivity,
        useCallback(() => getBrowserControlActivity(workspaceId, tabId, baseUrl), [workspaceId, tabId, baseUrl]),
        () => null,
    );
    const takeover = useSyncExternalStore(subscribeBrowserTakeover,
        useCallback(() => viewId ? getBrowserTakeover(routingRef ?? workspaceId, viewId) : null, [routingRef, workspaceId, viewId]), () => null);
    const browserEnabled = useBrowserToolEnabled(workspaceId, routingRef);
    const [stopping, setStopping] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const stoppingProcess = useRef<string | null>(null);

    useEffect(() => { setError(null); }, [activity?.processId, workspaceId, tabId]);

    if (!activity || !browserEnabled || takeover && takeover.status !== 'agent') return null;

    const stop = async () => {
        if (stoppingProcess.current) return;
        const processId = activity.processId;
        stoppingProcess.current = processId;
        setStopping(true);
        setError(null);
        try {
            await client.processes.cancel(processId, { workspace: workspaceId });
            if (activity.turnId) desktopBrowserBridge()?.control?.finish?.(activity.turnId);
            finishBrowserControlActivity(workspaceId, processId, baseUrl, activity.turnId);
        } catch {
            setError('Could not stop browser control. Try again.');
        } finally {
            stoppingProcess.current = null;
            setStopping(false);
        }
    };

    return <div className="flex items-center gap-1.5 shrink-0" data-testid="browser-control-badge">
        <span className="rounded bg-[#ddf4ff] text-[#0969da] dark:bg-[#0969da]/20 dark:text-[#79c0ff] px-2 py-0.5 text-xs" role="status">AI controlling</span>
        <button type="button" className="rounded border border-[#e0e0e0] dark:border-[#3c3c3c] px-2 py-0.5 text-xs hover:bg-black/5 dark:hover:bg-white/5"
            onClick={() => { void stop(); }} disabled={stopping} aria-label="Stop AI browser control">
            {stopping ? 'Stopping…' : 'Stop'}
        </button>
        {error && <span role="alert" className="text-xs text-[#cf222e]">{error}</span>}
    </div>;
}
