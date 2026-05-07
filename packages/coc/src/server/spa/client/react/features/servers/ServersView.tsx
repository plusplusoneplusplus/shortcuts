import { useEffect, useState } from 'react';
import { Button } from '../../ui';
import {
    addRemoteServer,
    listRemoteServers,
    reconnectServer,
    removeRemoteServer,
    updateRemoteServer,
    type RemoteServer,
    type RemoteServerInput,
    type RemoteServerPatch,
} from '../../utils/serverRegistry';
import { useRemoteServerHealth } from '../../hooks/useRemoteServerHealth';
import { getApiBase, getHostname } from '../../utils/config';
import { ServerCard, type ServerCardHealth } from './ServerCard';
import { AddServerDialog, EditServerDialog } from './AddServerDialog';

const LOCAL_POLL_INTERVAL_MS = 30_000;
const FETCH_TIMEOUT_MS = 5_000;

interface LocalHealthState {
    server: { id: 'local'; label: string; url: string };
    status: 'checking' | 'online' | 'offline';
    version?: string;
    serverName?: string;
    uptime?: number;
    processCount?: number;
    lastChecked?: number;
    error?: string;
}

function inputToPatch(input: RemoteServerInput): RemoteServerPatch {
    return input.kind === 'url'
        ? { kind: 'url', label: input.label, url: input.url }
        : { kind: 'devtunnel', label: input.label, tunnelId: input.tunnelId };
}

export function ServersView() {
    const [servers, setServers] = useState<RemoteServer[]>([]);
    const [addOpen, setAddOpen] = useState(false);
    const [editServerId, setEditServerId] = useState<string | undefined>();
    const [reconnectingId, setReconnectingId] = useState<string | undefined>();
    const [loadError, setLoadError] = useState<string | undefined>();

    useEffect(() => {
        let cancelled = false;
        listRemoteServers()
            .then(result => {
                if (!cancelled) {
                    setServers(result);
                    setLoadError(undefined);
                }
            })
            .catch(error => {
                if (!cancelled) {
                    setLoadError(error instanceof Error ? error.message : String(error));
                }
            });
        return () => { cancelled = true; };
    }, []);

    const remoteHealthStates = useRemoteServerHealth(servers);
    const editServer = editServerId ? servers.find(server => server.id === editServerId) : undefined;

    const [localHealth, setLocalHealth] = useState<LocalHealthState>(() => ({
        server: { id: 'local', label: 'This Server', url: '' },
        status: 'checking',
        serverName: getHostname(),
    }));

    useEffect(() => {
        let cancelled = false;
        const apiBase = getApiBase();

        const poll = async () => {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
            try {
                const [healthRes, versionRes] = await Promise.all([
                    fetch(`${apiBase}/health`, { signal: controller.signal }),
                    fetch(`${apiBase}/admin/version`, { signal: controller.signal }),
                ]);
                clearTimeout(timer);
                if (cancelled) { return; }
                if (!healthRes.ok || !versionRes.ok) {
                    const status = !healthRes.ok ? healthRes.status : versionRes.status;
                    setLocalHealth(prev => ({
                        ...prev,
                        status: 'offline',
                        lastChecked: Date.now(),
                        error: `HTTP ${status}`,
                    }));
                    return;
                }
                const health = await healthRes.json().catch(() => ({}));
                const ver = await versionRes.json().catch(() => ({}));
                if (cancelled) { return; }
                setLocalHealth(prev => ({
                    ...prev,
                    status: 'online',
                    uptime: typeof health?.uptime === 'number' ? health.uptime : undefined,
                    processCount: typeof health?.processCount === 'number' ? health.processCount : undefined,
                    version: typeof ver?.version === 'string' ? ver.version : undefined,
                    lastChecked: Date.now(),
                    error: undefined,
                }));
            } catch (e) {
                clearTimeout(timer);
                if (cancelled) { return; }
                setLocalHealth(prev => ({
                    ...prev,
                    status: 'offline',
                    lastChecked: Date.now(),
                    error: e instanceof Error ? e.message : 'Unknown error',
                }));
            }
        };

        void poll();
        const id = setInterval(() => { void poll(); }, LOCAL_POLL_INTERVAL_MS);
        return () => {
            cancelled = true;
            clearInterval(id);
        };
    }, []);

    const handleAdd = async (fields: RemoteServerInput) => {
        await addRemoteServer(fields);
        setServers(await listRemoteServers());
    };

    const handleRemove = async (id: string) => {
        await removeRemoteServer(id);
        setServers(await listRemoteServers());
    };

    const handleReconnect = async (id: string) => {
        setReconnectingId(id);
        try {
            await reconnectServer(id);
            setServers(await listRemoteServers());
        } finally {
            setReconnectingId(undefined);
        }
    };

    const handleEdit = async (fields: RemoteServerInput) => {
        if (!editServer) {
            throw new Error('Remote server is no longer available');
        }
        await updateRemoteServer(editServer.id, inputToPatch(fields));
        setServers(await listRemoteServers());
    };

    const localHealthForCard: ServerCardHealth = localHealth;

    return (
        <div className="flex flex-col h-full bg-white dark:bg-[#1e1e1e] overflow-y-auto" data-testid="servers-view">
            <div className="flex items-center justify-between px-6 py-4 border-b border-[#e0e0e0] dark:border-[#3c3c3c]">
                <h2 className="text-base font-semibold text-[#1e1e1e] dark:text-[#cccccc]">Servers</h2>
                <Button
                    variant="secondary"
                    size="sm"
                    data-testid="servers-view-add-btn"
                    onClick={() => setAddOpen(true)}
                >
                    + Add Server
                </Button>
            </div>

            {loadError && (
                <div className="mx-6 mt-4 px-3 py-2 rounded border border-[#f14c4c]/40 bg-[#f14c4c]/10 text-xs text-[#f14c4c]" data-testid="servers-view-load-error">
                    {loadError}
                </div>
            )}

            <div className="p-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                <ServerCard health={localHealthForCard} isLocal={true} />
                {remoteHealthStates.map(hs => (
                    <ServerCard
                        key={hs.server.id}
                        health={hs}
                        isLocal={false}
                        onRemove={handleRemove}
                        onEdit={setEditServerId}
                        onReconnect={handleReconnect}
                        reconnecting={reconnectingId === hs.server.id}
                    />
                ))}
            </div>

            <AddServerDialog
                open={addOpen}
                onClose={() => setAddOpen(false)}
                onAdd={handleAdd}
            />
            <EditServerDialog
                open={!!editServer}
                server={editServer}
                onClose={() => setEditServerId(undefined)}
                onSave={handleEdit}
            />
        </div>
    );
}
