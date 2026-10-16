import type { DashboardChatRequest, DashboardVisibleWorkspace, DashboardWorkspaceRequest, ProcessWebSocketConnection } from '@plusplusoneplusplus/coc-client';
import { getDashboardTopology, subscribeDashboardTopology } from './topology';
import { searchDashboardChats } from './chat-search';

/** Read-only producer on an existing owner socket, independent of desktop capabilities. */
export function createDashboardDiscoverySocketRelay(
    connection: Pick<ProcessWebSocketConnection, 'send'>,
    baseUrl?: string,
) {
    let connected = false;
    let disposed = false;
    const pending = new Map<string, { controller: AbortController; revision: string }>();
    const cancel = (id: string) => {
        const read = pending.get(id);
        pending.delete(id);
        read?.controller.abort();
    };
    const cancelAll = () => {
        for (const id of pending.keys()) cancel(id);
    };
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
        for (const [id, read] of pending) {
            if (read.revision !== getDashboardTopology().revision) cancel(id);
        }
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
        onClose() { connected = false; cancelAll(); },
        onMessage(message: { type: string; [key: string]: unknown }): boolean {
            if (message.type === 'dashboard-discovery-cancel') {
                if (typeof message.id === 'string') cancel(message.id);
                return true;
            }
            if (message.type !== 'dashboard-workspaces-request' && message.type !== 'dashboard-chats-request') return false;
            if (!connected || disposed) return true;
            const request = message.request as DashboardWorkspaceRequest | undefined;
            if (!request || typeof request.id !== 'string') return true;
            const snapshot = getDashboardTopology();
            if (!owner() || request.workspaceId !== owner() || request.revision !== snapshot.revision) {
                connection.send({ type: message.type === 'dashboard-chats-request' ? 'dashboard-chats-result' : 'dashboard-workspaces-result',
                    reply: { id: request.id, ok: false } });
                return true;
            }
            if (message.type === 'dashboard-chats-request') {
                const { id } = request;
                if (pending.has(id)) return true;
                const read = { controller: new AbortController(), revision: snapshot.revision };
                pending.set(id, read);
                const finish = (reply: object) => {
                    if (pending.get(id) !== read) return;
                    pending.delete(id);
                    if (connected && !disposed && getDashboardTopology() === snapshot) {
                        connection.send({ type: 'dashboard-chats-result', reply });
                    }
                };
                void searchDashboardChats((request as DashboardChatRequest).query, read.controller.signal).then(
                    result => finish({ id, ok: true, result }),
                    () => finish({ id, ok: false }),
                );
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
            cancelAll();
            unsubscribe();
            window.removeEventListener('focus', advertise);
            window.removeEventListener('blur', advertise);
        },
    };
}
