import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '../ui';
import { Dialog } from '../ui/Dialog';
import { getRawApiBase } from '../utils/config';
import { SettingsCard } from './SettingsCard';
import { WhatsAppPairingContent, WhatsAppStatusIndicator, type WhatsAppConnectionState } from './WhatsAppConnectionUI';

interface WhatsAppStatus {
    enabled: boolean;
    status: WhatsAppConnectionState;
    qr: string | null;
    error: string | null;
    groupJid?: string | null;
    groupName?: string | null;
    deviceName?: string | null;
    selfJid?: string | null;
}

interface WhatsAppGroup {
    jid: string;
    name: string;
}

async function request<T>(path: string, body?: object): Promise<T> {
    const response = await fetch(`${getRawApiBase()}/messaging/whatsapp${path}`, body === undefined
        ? undefined
        : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!response.ok) {
        const payload = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(payload?.error ?? `HTTP ${response.status}`);
    }
    return response.json() as Promise<T>;
}

export function WhatsAppConnectionCard() {
    const [status, setStatus] = useState<WhatsAppStatus | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [pairing, setPairing] = useState(false);
    const [groups, setGroups] = useState<WhatsAppGroup[]>([]);
    const [groupsError, setGroupsError] = useState<string | null>(null);
    const [deviceName, setDeviceName] = useState('');
    const [groupJid, setGroupJid] = useState('');
    const [newGroupName, setNewGroupName] = useState('CoC');
    const mounted = useRef(false);
    const pairingRef = useRef(false);
    const requestId = useRef(0);
    const statusRef = useRef<WhatsAppStatus | null>(null);
    const deviceDirty = deviceName !== (status?.deviceName ?? '');
    const groupDirty = groupJid !== (status?.groupJid ?? '');

    const load = useCallback(async (syncForm = false) => {
        const id = ++requestId.current;
        try {
            const next = await request<WhatsAppStatus>('/status');
            if (!mounted.current || id !== requestId.current) return;
            if (syncForm || statusRef.current === null) {
                setDeviceName(next.deviceName ?? '');
                setGroupJid(next.groupJid ?? '');
            }
            statusRef.current = next;
            setStatus(next);
            if (next.status === 'connected' && pairingRef.current) {
                pairingRef.current = false;
                setPairing(false);
            }
            setError(null);
        } catch (err) {
            if (mounted.current && id === requestId.current)
                setError(err instanceof Error ? err.message : String(err));
        }
    }, []);

    const loadGroups = useCallback(async () => {
        try {
            const result = await request<{ groups: WhatsAppGroup[] }>('/groups');
            if (mounted.current) {
                setGroups(result.groups);
                setGroupsError(null);
            }
        } catch (err) {
            if (mounted.current) setGroupsError(err instanceof Error ? err.message : String(err));
        }
    }, []);

    useEffect(() => {
        mounted.current = true;
        void load();
        const timer = setInterval(() => void load(), pairing ? 2000 : 5000);
        return () => {
            mounted.current = false;
            requestId.current++;
            clearInterval(timer);
        };
    }, [load, pairing]);

    useEffect(() => {
        if (status?.status === 'connected' && status.enabled) void loadGroups();
    }, [status?.status, status?.enabled, loadGroups]);

    const openPairing = () => {
        pairingRef.current = true;
        setPairing(true);
        void load();
    };

    const run = async (action: () => Promise<void>) => {
        setBusy(true);
        setError(null);
        try {
            await action();
            await load(true);
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            setBusy(false);
        }
    };

    return <SettingsCard title="WhatsApp" description="Receive commands and chat messages in a selected WhatsApp group." data-testid="whatsapp-connection-card">
        <div className="space-y-3">
            {error && <p role="alert" className="text-xs text-red-600">{error}</p>}
            {!status ? <div>
                <p role="status">{error ? 'Could not load WhatsApp status.' : 'Loading WhatsApp status…'}</p>
                <Button size="sm" onClick={() => void load()}>Refresh status</Button>
            </div> : <>
                <div className="flex items-center justify-between gap-2">
                    <WhatsAppStatusIndicator status={status.error ? 'error' : status.status} />
                    <Button size="sm" onClick={() => void load()} disabled={busy}>Refresh status</Button>
                </div>
                {status.error && <p role="alert" className="text-xs text-red-600">{status.error}</p>}
                <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={status.enabled} disabled={busy}
                        onChange={event => {
                            const enabled = event.currentTarget.checked;
                            void run(async () => {
                                await request('/config', { enabled });
                                if (enabled) {
                                    openPairing();
                                } else {
                                    pairingRef.current = false;
                                    setPairing(false);
                                }
                            });
                        }} />
                    Enable WhatsApp
                </label>
                {status.enabled && <>
                    <div className="flex flex-wrap gap-2">
                        {status.status !== 'connected'
                            ? <Button size="sm" onClick={() => void run(async () => {
                                await request('/reconnect', {});
                                openPairing();
                            })} disabled={busy}>Setup / Pair</Button>
                            : <Button size="sm" variant="danger" disabled={busy}
                                onClick={() => void run(async () => {
                                    await request('/reconnect', { repair: true });
                                    openPairing();
                                })}>Re-pair</Button>}
                    </div>
                    <label className="block text-sm" htmlFor="whatsapp-device-name">Device name</label>
                    <div className="flex gap-2">
                        <input id="whatsapp-device-name" type="text" value={deviceName} disabled={busy}
                            onChange={event => setDeviceName(event.target.value)}
                            className="flex-1 min-w-0 rounded border px-2 py-1 bg-transparent" />
                        <Button size="sm" disabled={busy || !deviceDirty || !deviceName.trim()}
                            onClick={() => void run(async () => {
                                await request('/config', { deviceName: deviceName.trim() });
                                await request('/reconnect', { repair: true });
                                openPairing();
                            })}>Save &amp; Re-pair</Button>
                    </div>
                    {deviceDirty && <p className="text-xs text-amber-600">Changing the device name requires re-pairing.</p>}
                    {status.selfJid && <p className="text-xs text-[#616161]">Linked account: {status.selfJid}</p>}
                    {status.status === 'connected' && <>
                        <label className="block text-sm" htmlFor="whatsapp-group">Group</label>
                        <div className="flex gap-2">
                            <select id="whatsapp-group" value={groupJid} disabled={busy}
                                onChange={event => setGroupJid(event.target.value)}
                                className="flex-1 min-w-0 rounded border px-2 py-1 bg-transparent">
                                <option value="">Select a group</option>
                                {groupJid && !groups.some(group => group.jid === groupJid) &&
                                    <option value={groupJid}>{status.groupName ?? groupJid}</option>}
                                {groups.map(group => <option key={group.jid} value={group.jid}>{group.name}</option>)}
                            </select>
                            <Button size="sm" disabled={busy || !groupDirty || !groupJid}
                                onClick={() => void run(() => request('/config', {
                                    groupJid, groupName: groups.find(group => group.jid === groupJid)?.name ?? status.groupName ?? null,
                                }))}>Save group</Button>
                        </div>
                        {groupsError && <p role="alert" className="text-xs text-red-600">Could not load groups: {groupsError}</p>}
                        <div className="flex gap-2">
                            <input aria-label="New group name" type="text" value={newGroupName} disabled={busy}
                                onChange={event => setNewGroupName(event.target.value)}
                                placeholder="New group name" className="flex-1 min-w-0 rounded border px-2 py-1 bg-transparent" />
                            <Button size="sm" disabled={busy || !newGroupName.trim()}
                                onClick={() => void run(async () => {
                                    const group = await request<WhatsAppGroup>('/groups', { name: newGroupName.trim() });
                                    if (!group.jid) throw new Error('Group creation did not return a JID');
                                    await request('/config', { groupJid: group.jid, groupName: group.name });
                                    setNewGroupName('CoC');
                                    await loadGroups();
                                })}>Create group</Button>
                        </div>
                    </>}
                </>}
            </>}
        </div>
        <Dialog open={pairing} onClose={() => { pairingRef.current = false; setPairing(false); }} title="Pair WhatsApp">
            <WhatsAppPairingContent status={status?.status} qr={status?.qr} error={status?.error}
                groupJid={status?.groupJid} waitingHint="Check your connection and try re-pairing." />
        </Dialog>
    </SettingsCard>;
}
