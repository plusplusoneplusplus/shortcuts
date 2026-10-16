import { useEffect, useState } from 'react';
import type { RuntimeDashboardConfig } from '@plusplusoneplusplus/coc-client';
import { getCocClientForWorkspace, resolveCloneRoute, subscribeCloneBaseUrl } from '../../repos/cloneRegistry';
import { DASHBOARD_CONFIG_UPDATED_EVENT, isExplorerDeleteEnabled } from '../../utils/config';

export function useExplorerDeleteEnabled(workspaceId: string, routingRef?: string | null): {
    enabled: boolean; error: string | null;
} {
    const ref = routingRef === undefined ? workspaceId : routingRef;
    const [state, setState] = useState<{ ref: string | null; enabled: boolean; error: string | null }>({
        ref, enabled: false, error: null,
    });
    useEffect(() => {
        let generation = 0;
        let disposed = false;
        const load = async () => {
            const run = ++generation;
            try {
                const route = resolveCloneRoute(ref);
                if (route.kind === 'unresolved-remote') throw new Error('The owning server is unavailable.');
                if (route.kind === 'local') {
                    setState({ ref, enabled: isExplorerDeleteEnabled(), error: null });
                    return;
                }
                setState({ ref, enabled: false, error: null });
                const data = await getCocClientForWorkspace(ref).request<RuntimeDashboardConfig>('/config/runtime');
                if (!disposed && run === generation) {
                    setState({ ref, enabled: data.features?.explorerDeleteEnabled === true, error: null });
                }
            } catch (error) {
                if (!disposed && run === generation) {
                    setState({ ref, enabled: false, error: `Delete unavailable: ${error instanceof Error ? error.message : String(error)}` });
                }
            }
        };
        const refresh = () => { void load(); };
        refresh();
        const unsubscribe = subscribeCloneBaseUrl(ref, refresh);
        window.addEventListener(DASHBOARD_CONFIG_UPDATED_EVENT, refresh);
        return () => {
            disposed = true;
            generation++;
            unsubscribe();
            window.removeEventListener(DASHBOARD_CONFIG_UPDATED_EVENT, refresh);
        };
    }, [ref]);
    return state.ref === ref ? state : { enabled: false, error: null };
}
