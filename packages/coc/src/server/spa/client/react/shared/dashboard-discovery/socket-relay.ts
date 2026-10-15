import type { DashboardVisibleWorkspace, DashboardWorkspaceRequest, ProcessWebSocketConnection } from '@plusplusoneplusplus/coc-client';
import { getDashboardTopology, subscribeDashboardTopology } from './topology';

/** Read-only producer on an existing owner socket, independent of desktop capabilities. */
export function createDashboardDiscoverySocketRelay(
    connection: Pick<ProcessWebSocketConnection, 'send'>,
    baseUrl?: string,
) {
    let connected = false;
    let disposed = false;
    const owner = () => {
        const snapshot = getDashboardTopology();
        if (baseUrl) {
            const selected = snapshot.routes.find(route => route.selectionId === snapshot.selectedRef);
            return selected?.baseUrl === baseUrl && selected.row.online ? selected.row.workspaceId : undefined;
        }
        return snapshot.selectedRef && snapshot.localWorkspaceIds.includes(snapshot.selectedRef)
            ? snapshot.selectedRef : undefined;
    };
    const advertise = () => {
        if (!connected || disposed) return;
        const workspaceId = owner();
        connection.send(workspaceId ? {
            type: 'dashboard-discovery-capability', workspaceId,
            revision: getDashboardTopology().revision, focused: document.hasFocus(),
        } : { type: 'dashboard-discovery-clear' });
    };
    const unsubscribe = subscribeDashboardTopology(advertise);
    window.addEventListener('focus', advertise);
    window.addEventListener('blur', advertise);
    return {
        onOpen() { if (!disposed) { connected = true; advertise(); } },
        onClose() { connected = false; },
        onMessage(message: { type: string; [key: string]: unknown }): boolean {
            if (message.type === 'dashboard-discovery-cancel') return true;
            if (message.type !== 'dashboard-workspaces-request') return false;
            if (!connected || disposed) return true;
            const request = message.request as DashboardWorkspaceRequest | undefined;
            if (!request || typeof request.id !== 'string') return true;
            const snapshot = getDashboardTopology();
            if (!owner() || request.workspaceId !== owner() || request.revision !== snapshot.revision) {
                connection.send({ type: 'dashboard-workspaces-result', reply: { id: request.id, ok: false } });
                return true;
            }
            // Multiple dashboard aliases for one installation project one durable destination.
            const destinations = new Map<string, DashboardVisibleWorkspace>();
            for (const { row, selectionId } of snapshot.routes) {
                const key = row.serverIdentity ? JSON.stringify(['known', row.serverIdentity, row.workspaceId]) : JSON.stringify(['selection', selectionId]);
                const previous = destinations.get(key);
                if (!previous || !previous.online && row.online) destinations.set(key, { ...row });
            }
            const workspaces = [...destinations.values()];
            connection.send({ type: 'dashboard-workspaces-result', reply: { id: request.id, ok: true, workspaces } });
            return true;
        },
        dispose() {
            if (disposed) return;
            if (connected) connection.send({ type: 'dashboard-discovery-clear' });
            disposed = true;
            connected = false;
            unsubscribe();
            window.removeEventListener('focus', advertise);
            window.removeEventListener('blur', advertise);
        },
    };
}
