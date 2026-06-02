/**
 * AddAgentDialog — modal for adding a new CoC agent in container mode.
 * Supports three connection types:
 * - Direct URL: plain HTTP/HTTPS address to a CoC agent
 * - DevTunnel: Microsoft Dev Tunnel URL with optional tunnel ID for server-side auth
 * - SSH Tunnel: SSH host with local port forwarding to a remote CoC agent
 */

import { useState, useEffect } from 'react';
import { Dialog, Button } from '../ui';

export type AgentConnectionKind = 'url' | 'devtunnel' | 'ssh';

interface AddAgentDialogProps {
    open: boolean;
    onClose: () => void;
    onAdd: (address: string, name?: string, tunnelId?: string) => Promise<any>;
}

export interface EditAgentDialogProps {
    open: boolean;
    onClose: () => void;
    onSave: (fields: { name?: string; address?: string; tunnelId?: string | null }) => Promise<any>;
    initial?: { name: string; address: string; tunnelId?: string };
}

const inputClass = 'mt-1 w-full h-8 px-2 text-xs rounded border border-[#e0e0e0] dark:border-[#3c3c3c] bg-white dark:bg-[#1e1e1e] text-[#1e1e1e] dark:text-[#cccccc] outline-none focus:border-[#0078d4]';
const monoInputClass = inputClass + ' font-mono';
const hintClass = 'text-[10px] text-[#6e6e6e] dark:text-[#888888] block mt-0.5';

function detectKind(address: string): AgentConnectionKind {
    try {
        if (new URL(address).hostname.endsWith('.devtunnels.ms')) return 'devtunnel';
    } catch { /* not a valid URL */ }
    return 'url';
}

function buildSshAddress(host: string, port: string): string {
    return `ssh://${host.trim()}:${port.trim()}`;
}

function parseSshAddress(address: string): { host: string; port: string } | undefined {
    if (!address.startsWith('ssh://')) return undefined;
    const rest = address.slice(6);
    const colonIdx = rest.lastIndexOf(':');
    if (colonIdx < 0) return undefined;
    return { host: rest.slice(0, colonIdx), port: rest.slice(colonIdx + 1) };
}

function AgentConnectionForm({
    kind, setKind,
    address, setAddress,
    tunnelId, setTunnelId,
    sshHost, setSshHost,
    sshPort, setSshPort,
    name, setName,
    testIdPrefix,
}: {
    kind: AgentConnectionKind;
    setKind: (k: AgentConnectionKind) => void;
    address: string; setAddress: (v: string) => void;
    tunnelId: string; setTunnelId: (v: string) => void;
    sshHost: string; setSshHost: (v: string) => void;
    sshPort: string; setSshPort: (v: string) => void;
    name: string; setName: (v: string) => void;
    testIdPrefix: string;
}) {
    return (
        <>
            <fieldset className="flex flex-col gap-2">
                <legend className="text-xs font-medium text-[#1e1e1e] dark:text-[#cccccc]">Connection type</legend>
                <div className="flex gap-3 text-xs text-[#1e1e1e] dark:text-[#cccccc]">
                    <label className="inline-flex items-center gap-1.5">
                        <input
                            type="radio"
                            name={`${testIdPrefix}-agent-kind`}
                            value="url"
                            checked={kind === 'url'}
                            onChange={() => setKind('url')}
                            data-testid={`${testIdPrefix}-agent-kind-url`}
                        />
                        Direct URL
                    </label>
                    <label className="inline-flex items-center gap-1.5">
                        <input
                            type="radio"
                            name={`${testIdPrefix}-agent-kind`}
                            value="devtunnel"
                            checked={kind === 'devtunnel'}
                            onChange={() => setKind('devtunnel')}
                            data-testid={`${testIdPrefix}-agent-kind-devtunnel`}
                        />
                        DevTunnel
                    </label>
                    <label className="inline-flex items-center gap-1.5">
                        <input
                            type="radio"
                            name={`${testIdPrefix}-agent-kind`}
                            value="ssh"
                            checked={kind === 'ssh'}
                            onChange={() => setKind('ssh')}
                            data-testid={`${testIdPrefix}-agent-kind-ssh`}
                        />
                        SSH Tunnel
                    </label>
                </div>
            </fieldset>

            {kind === 'url' && (
                <label className="text-xs font-medium text-[#1e1e1e] dark:text-[#cccccc]">
                    Agent Address <span className="text-[#f14c4c]">*</span>
                    <input
                        type="text"
                        className={inputClass}
                        placeholder="http://remote-host:4000"
                        value={address}
                        onChange={e => setAddress(e.target.value)}
                        data-testid={`${testIdPrefix}-agent-url-input`}
                        autoFocus
                        required
                    />
                    <span className={hintClass}>
                        Direct HTTP/HTTPS URL to a running CoC agent.
                    </span>
                </label>
            )}

            {kind === 'devtunnel' && (
                <>
                    <label className="text-xs font-medium text-[#1e1e1e] dark:text-[#cccccc]">
                        DevTunnel URL <span className="text-[#f14c4c]">*</span>
                        <input
                            type="text"
                            className={monoInputClass}
                            placeholder="https://my-tunnel-abc.usw2.devtunnels.ms"
                            value={address}
                            onChange={e => setAddress(e.target.value)}
                            data-testid={`${testIdPrefix}-agent-devtunnel-url-input`}
                            autoFocus
                            required
                        />
                        <span className={hintClass}>
                            Public DevTunnel URL. Host-side: run <code>devtunnel host &lt;id&gt;</code> and <code>coc serve</code> on the configured port.
                        </span>
                    </label>
                    <label className="text-xs font-medium text-[#1e1e1e] dark:text-[#cccccc]">
                        Tunnel ID <span className="text-[#848484] font-normal">(recommended)</span>
                        <input
                            type="text"
                            className={monoInputClass}
                            placeholder="e.g. amusing-book-s4hcgw2.usw2"
                            value={tunnelId}
                            onChange={e => setTunnelId(e.target.value)}
                            data-testid={`${testIdPrefix}-agent-tunnel-id-input`}
                        />
                        <span className={hintClass}>
                            Enables server-side token auth (no browser popup). Run <code>devtunnel list</code> to find it.
                        </span>
                    </label>
                </>
            )}

            {kind === 'ssh' && (
                <>
                    <label className="text-xs font-medium text-[#1e1e1e] dark:text-[#cccccc]">
                        SSH Host <span className="text-[#f14c4c]">*</span>
                        <input
                            type="text"
                            className={monoInputClass}
                            placeholder="user@remote-host or ~/.ssh/config alias"
                            value={sshHost}
                            onChange={e => setSshHost(e.target.value)}
                            data-testid={`${testIdPrefix}-agent-ssh-host-input`}
                            autoFocus
                            required
                        />
                        <span className={hintClass}>
                            SSH host or <code>~/.ssh/config</code> alias. Ensure the host has <code>coc serve</code> running.
                        </span>
                    </label>
                    <label className="text-xs font-medium text-[#1e1e1e] dark:text-[#cccccc]">
                        Remote CoC Port <span className="text-[#f14c4c]">*</span>
                        <input
                            type="number"
                            className={inputClass}
                            placeholder="4000"
                            value={sshPort}
                            min={1}
                            max={65535}
                            onChange={e => setSshPort(e.target.value)}
                            data-testid={`${testIdPrefix}-agent-ssh-port-input`}
                            required
                        />
                        <span className={hintClass}>
                            Port where CoC is running on the remote host. The container will SSH-tunnel this port locally.
                        </span>
                    </label>
                </>
            )}

            <label className="text-xs font-medium text-[#1e1e1e] dark:text-[#cccccc]">
                Display Name <span className="text-[#848484] font-normal">(optional)</span>
                <input
                    type="text"
                    className={inputClass}
                    placeholder={kind === 'ssh' ? sshHost || 'My Agent' : 'My Agent'}
                    value={name}
                    onChange={e => setName(e.target.value)}
                    data-testid={`${testIdPrefix}-agent-name-input`}
                />
            </label>
        </>
    );
}

function resolveAddress(kind: AgentConnectionKind, address: string, sshHost: string, sshPort: string): string {
    if (kind === 'ssh') return buildSshAddress(sshHost, sshPort);
    return address.trim();
}

function isFormValid(kind: AgentConnectionKind, address: string, sshHost: string, sshPort: string): boolean {
    if (kind === 'ssh') {
        const port = parseInt(sshPort.trim(), 10);
        return !!sshHost.trim() && !!sshPort.trim() && !isNaN(port) && port >= 1 && port <= 65535;
    }
    return !!address.trim();
}

export function AddAgentDialog({ open, onClose, onAdd }: AddAgentDialogProps) {
    const [kind, setKind] = useState<AgentConnectionKind>('url');
    const [address, setAddress] = useState('');
    const [name, setName] = useState('');
    const [tunnelId, setTunnelId] = useState('');
    const [sshHost, setSshHost] = useState('');
    const [sshPort, setSshPort] = useState('');
    const [adding, setAdding] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!open) {
            setKind('url');
            setAddress('');
            setName('');
            setTunnelId('');
            setSshHost('');
            setSshPort('');
            setError(null);
        }
    }, [open]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        const resolved = resolveAddress(kind, address, sshHost, sshPort);
        if (!resolved) return;
        setAdding(true);
        setError(null);
        try {
            await onAdd(resolved, name.trim() || undefined, tunnelId.trim() || undefined);
            onClose();
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        }
        setAdding(false);
    };

    if (!open) return null;

    const valid = isFormValid(kind, address, sshHost, sshPort);

    return (
        <Dialog open={open} onClose={onClose} title="Add Agent">
            <form onSubmit={handleSubmit} className="flex flex-col gap-3">
                <AgentConnectionForm
                    kind={kind} setKind={setKind}
                    address={address} setAddress={setAddress}
                    tunnelId={tunnelId} setTunnelId={setTunnelId}
                    sshHost={sshHost} setSshHost={setSshHost}
                    sshPort={sshPort} setSshPort={setSshPort}
                    name={name} setName={setName}
                    testIdPrefix="add"
                />
                {error && (
                    <div className="text-xs text-[#f14c4c] bg-[#f14c4c]/10 rounded px-2 py-1" data-testid="add-agent-error">{error}</div>
                )}
                <div className="flex justify-end gap-2 mt-1">
                    <Button variant="secondary" size="sm" onClick={onClose} type="button">Cancel</Button>
                    <Button variant="primary" size="sm" type="submit" disabled={adding || !valid} data-testid="add-agent-submit">
                        {adding ? 'Adding…' : 'Add Agent'}
                    </Button>
                </div>
            </form>
        </Dialog>
    );
}

export function EditAgentDialog({ open, onClose, onSave, initial }: EditAgentDialogProps) {
    const initKind = initial ? (parseSshAddress(initial.address) ? 'ssh' : detectKind(initial.address)) : 'url';
    const initSsh = initial ? parseSshAddress(initial.address) : undefined;

    const [kind, setKind] = useState<AgentConnectionKind>(initKind);
    const [address, setAddress] = useState(initial?.address ?? '');
    const [name, setName] = useState(initial?.name ?? '');
    const [tunnelId, setTunnelId] = useState(initial?.tunnelId ?? '');
    const [sshHost, setSshHost] = useState(initSsh?.host ?? '');
    const [sshPort, setSshPort] = useState(initSsh?.port ?? '');
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (open && initial) {
            const k = parseSshAddress(initial.address) ? 'ssh' : detectKind(initial.address);
            const ssh = parseSshAddress(initial.address);
            setKind(k as AgentConnectionKind);
            setAddress(initial.address);
            setName(initial.name);
            setTunnelId(initial.tunnelId ?? '');
            setSshHost(ssh?.host ?? '');
            setSshPort(ssh?.port ?? '');
            setError(null);
        }
    }, [open, initial?.address, initial?.name, initial?.tunnelId]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        const resolved = resolveAddress(kind, address, sshHost, sshPort);
        if (!resolved) return;
        setSaving(true);
        setError(null);
        try {
            await onSave({
                name: name.trim() || undefined,
                address: resolved,
                tunnelId: tunnelId.trim() || null,
            });
            onClose();
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        }
        setSaving(false);
    };

    if (!open) return null;

    const valid = isFormValid(kind, address, sshHost, sshPort);

    return (
        <Dialog open={open} onClose={onClose} title="Edit Agent">
            <form onSubmit={handleSubmit} className="flex flex-col gap-3">
                <AgentConnectionForm
                    kind={kind} setKind={setKind}
                    address={address} setAddress={setAddress}
                    tunnelId={tunnelId} setTunnelId={setTunnelId}
                    sshHost={sshHost} setSshHost={setSshHost}
                    sshPort={sshPort} setSshPort={setSshPort}
                    name={name} setName={setName}
                    testIdPrefix="edit"
                />
                {error && (
                    <div className="text-xs text-[#f14c4c] bg-[#f14c4c]/10 rounded px-2 py-1" data-testid="edit-agent-error">{error}</div>
                )}
                <div className="flex justify-end gap-2 mt-1">
                    <Button variant="secondary" size="sm" onClick={onClose} type="button">Cancel</Button>
                    <Button variant="primary" size="sm" type="submit" disabled={saving || !valid} data-testid="edit-agent-submit">
                        {saving ? 'Saving…' : 'Save Changes'}
                    </Button>
                </div>
            </form>
        </Dialog>
    );
}
