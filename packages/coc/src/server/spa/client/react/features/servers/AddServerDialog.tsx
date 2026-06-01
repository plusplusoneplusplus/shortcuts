import { useEffect, useRef, useState } from 'react';
import { Dialog, Button } from '../../ui';
import { testRemoteServer, type RemoteServer, type RemoteServerInput } from '../../utils/serverRegistry';

export interface AddServerDialogProps {
    open: boolean;
    onClose: () => void;
    onAdd: (fields: RemoteServerInput) => void | Promise<void>;
}

export interface EditServerDialogProps {
    open: boolean;
    server?: RemoteServer;
    onClose: () => void;
    onSave: (fields: RemoteServerInput) => void | Promise<void>;
}

const DEBOUNCE_MS = 600;

type TestState = 'idle' | 'testing' | 'ok' | 'fail';
type ConnectionKind = RemoteServerInput['kind'];
type DialogMode = 'add' | 'edit';

function stripTrailingSlash(url: string): string {
    return url.replace(/\/+$/, '');
}

function buildInput(kind: ConnectionKind, label: string, url: string, tunnelId: string, sshHost: string, sshPort: string): RemoteServerInput | undefined {
    if (kind === 'url') {
        const cleanedUrl = stripTrailingSlash(url.trim());
        if (!cleanedUrl) {
            return undefined;
        }
        return { kind, label: label.trim() || cleanedUrl, url: cleanedUrl };
    }
    if (kind === 'devtunnel') {
        const cleanedTunnelId = tunnelId.trim();
        if (!cleanedTunnelId) {
            return undefined;
        }
        return { kind, label: label.trim() || cleanedTunnelId, tunnelId: cleanedTunnelId };
    }
    // ssh
    const cleanedHost = sshHost.trim();
    if (!cleanedHost) {
        return undefined;
    }
    const port = parseInt(sshPort.trim(), 10);
    if (!sshPort.trim() || isNaN(port) || port < 1 || port > 65535) {
        return undefined;
    }
    return { kind, label: label.trim() || cleanedHost, host: cleanedHost, localPort: port };
}

function inputFromServer(server?: RemoteServer): RemoteServerInput | undefined {
    if (!server) {
        return undefined;
    }
    if (server.kind === 'url') {
        return { kind: 'url', label: server.label, url: server.url };
    }
    if (server.kind === 'devtunnel') {
        return { kind: 'devtunnel', label: server.label, tunnelId: server.tunnelId };
    }
    return { kind: 'ssh', label: server.label, host: server.host, localPort: server.localPort };
}

interface ServerFormDialogProps {
    open: boolean;
    mode: DialogMode;
    initialInput?: RemoteServerInput;
    onClose: () => void;
    onSubmit: (fields: RemoteServerInput) => void | Promise<void>;
}

function ServerFormDialog({ open, mode, initialInput, onClose, onSubmit }: ServerFormDialogProps) {
    const initialKind = initialInput?.kind ?? 'url';
    const initialLabel = initialInput?.label ?? '';
    const initialUrl = initialInput?.kind === 'url' ? initialInput.url : '';
    const initialTunnelId = initialInput?.kind === 'devtunnel' ? initialInput.tunnelId : '';
    const initialSshHost = initialInput?.kind === 'ssh' ? initialInput.host : '';
    const initialSshPort = initialInput?.kind === 'ssh' ? String(initialInput.localPort) : '';
    const [kind, setKind] = useState<ConnectionKind>(initialKind);
    const [label, setLabel] = useState(initialLabel);
    const [url, setUrl] = useState(initialUrl);
    const [tunnelId, setTunnelId] = useState(initialTunnelId);
    const [sshHost, setSshHost] = useState(initialSshHost);
    const [sshPort, setSshPort] = useState(initialSshPort);
    const [testState, setTestState] = useState<TestState>('idle');
    const [testLabel, setTestLabel] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [submitError, setSubmitError] = useState('');
    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const testIdPrefix = mode === 'add' ? 'add' : 'edit';
    const title = mode === 'add' ? 'Add Server' : 'Edit Server';
    const submitLabel = mode === 'add' ? 'Add Server' : 'Save Changes';
    const submittingLabel = mode === 'add' ? 'Adding...' : 'Saving...';

    useEffect(() => {
        if (debounceRef.current) {
            clearTimeout(debounceRef.current);
            debounceRef.current = null;
        }

        setKind(open ? initialKind : 'url');
        setLabel(open ? initialLabel : '');
        setUrl(open ? initialUrl : '');
        setTunnelId(open ? initialTunnelId : '');
        setSshHost(open ? initialSshHost : '');
        setSshPort(open ? initialSshPort : '');
        setTestState('idle');
        setTestLabel('');
        setSubmitting(false);
        setSubmitError('');
    }, [open, initialKind, initialLabel, initialUrl, initialTunnelId, initialSshHost, initialSshPort]);

    useEffect(() => {
        if (!open) {
            return;
        }

        if (debounceRef.current) {
            clearTimeout(debounceRef.current);
            debounceRef.current = null;
        }

        const input = buildInput(kind, label, url, tunnelId, sshHost, sshPort);
        if (!input) {
            setTestState('idle');
            setTestLabel('');
            return;
        }

        setTestState('testing');
        setTestLabel('');

        debounceRef.current = setTimeout(async () => {
            try {
                const health = await testRemoteServer(input);
                if (health.status !== 'online') {
                    setTestState('fail');
                    setTestLabel(health.error ?? 'Cannot reach server');
                    return;
                }
                const desc = [
                    health.serverName ? `CoC @ ${health.serverName}` : null,
                    typeof health.version === 'string' && health.version ? `v${health.version}` : null,
                    (input.kind === 'devtunnel' || input.kind === 'ssh') && health.localPort ? `localhost:${health.localPort}` : null,
                ].filter(Boolean).join(' · ');

                setTestState('ok');
                setTestLabel(desc || 'Connected');
            } catch (error) {
                setTestState('fail');
                setTestLabel(error instanceof Error ? error.message : 'Cannot reach server');
            }
        }, DEBOUNCE_MS);

        return () => {
            if (debounceRef.current) {
                clearTimeout(debounceRef.current);
                debounceRef.current = null;
            }
        };
    }, [open, kind, label, url, tunnelId, sshHost, sshPort]);

    const input = buildInput(kind, label, url, tunnelId, sshHost, sshPort);
    const submitDisabled = !input || submitting;

    const handleSubmit = async () => {
        if (!input) { return; }
        setSubmitting(true);
        setSubmitError('');
        try {
            await onSubmit(input);
            onClose();
        } catch (error) {
            setSubmitError(error instanceof Error ? error.message : 'Unable to save server');
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <Dialog
            id={`${testIdPrefix}-server-dialog`}
            open={open}
            onClose={onClose}
            title={title}
            footer={
                <>
                    <Button
                        variant="secondary"
                        size="sm"
                        data-testid={`${testIdPrefix}-server-cancel-btn`}
                        onClick={onClose}
                        disabled={submitting}
                    >
                        Cancel
                    </Button>
                    <Button
                        variant="primary"
                        size="sm"
                        data-testid={`${testIdPrefix}-server-submit-btn`}
                        disabled={submitDisabled}
                        onClick={() => { void handleSubmit(); }}
                    >
                        {submitting ? submittingLabel : submitLabel}
                    </Button>
                </>
            }
        >
            <div className="flex flex-col gap-4">
                {submitError && (
                    <div className="px-3 py-2 rounded border border-[#f14c4c]/40 bg-[#f14c4c]/10 text-xs text-[#f14c4c]" data-testid={`${testIdPrefix}-server-submit-error`}>
                        {submitError}
                    </div>
                )}

                <fieldset className="flex flex-col gap-2">
                    <legend className="text-xs font-medium text-[#1e1e1e] dark:text-[#cccccc]">Connection type</legend>
                    <div className="flex gap-3 text-sm text-[#1e1e1e] dark:text-[#cccccc]">
                        <label className="inline-flex items-center gap-1.5">
                            <input
                                type="radio"
                                name={`${testIdPrefix}-server-kind`}
                                value="url"
                                checked={kind === 'url'}
                                onChange={() => setKind('url')}
                                data-testid={`${testIdPrefix}-server-kind-url`}
                            />
                            Direct URL
                        </label>
                        <label className="inline-flex items-center gap-1.5">
                            <input
                                type="radio"
                                name={`${testIdPrefix}-server-kind`}
                                value="devtunnel"
                                checked={kind === 'devtunnel'}
                                onChange={() => setKind('devtunnel')}
                                data-testid={`${testIdPrefix}-server-kind-devtunnel`}
                            />
                            DevTunnel ID
                        </label>
                        <label className="inline-flex items-center gap-1.5">
                            <input
                                type="radio"
                                name={`${testIdPrefix}-server-kind`}
                                value="ssh"
                                checked={kind === 'ssh'}
                                onChange={() => setKind('ssh')}
                                data-testid={`${testIdPrefix}-server-kind-ssh`}
                            />
                            SSH Tunnel
                        </label>
                    </div>
                </fieldset>

                {kind === 'url' ? (
                    <div className="flex flex-col gap-1">
                        <label className="text-xs font-medium text-[#1e1e1e] dark:text-[#cccccc]">
                            URL <span className="text-[#f14c4c]">*</span>
                        </label>
                        <input
                            type="url"
                            data-testid={`${testIdPrefix}-server-url-input`}
                            value={url}
                            onChange={e => setUrl(e.target.value)}
                            placeholder="http://remote-host:4000"
                            className="px-3 py-1.5 text-sm rounded border border-[#e0e0e0] dark:border-[#3c3c3c] bg-white dark:bg-[#3c3c3c] text-[#1e1e1e] dark:text-[#cccccc] focus:outline-none focus:ring-1 focus:ring-[#0078d4] placeholder:text-[#848484] dark:placeholder:text-[#666]"
                            autoFocus
                        />
                    </div>
                ) : kind === 'devtunnel' ? (
                    <div className="flex flex-col gap-1">
                        <label className="text-xs font-medium text-[#1e1e1e] dark:text-[#cccccc]">
                            Tunnel ID <span className="text-[#f14c4c]">*</span>
                        </label>
                        <input
                            type="text"
                            data-testid={`${testIdPrefix}-server-tunnel-id-input`}
                            value={tunnelId}
                            onChange={e => setTunnelId(e.target.value)}
                            placeholder="my-remote-coc"
                            className="px-3 py-1.5 text-sm rounded border border-[#e0e0e0] dark:border-[#3c3c3c] bg-white dark:bg-[#3c3c3c] text-[#1e1e1e] dark:text-[#cccccc] focus:outline-none focus:ring-1 focus:ring-[#0078d4] placeholder:text-[#848484] dark:placeholder:text-[#666]"
                            autoFocus
                        />
                    </div>
                ) : (
                    <>
                        <div className="flex flex-col gap-1">
                            <label className="text-xs font-medium text-[#1e1e1e] dark:text-[#cccccc]">
                                Host alias <span className="text-[#f14c4c]">*</span>
                            </label>
                            <input
                                type="text"
                                data-testid={`${testIdPrefix}-server-ssh-host-input`}
                                value={sshHost}
                                onChange={e => setSshHost(e.target.value)}
                                placeholder="ubuntu-arm"
                                className="px-3 py-1.5 text-sm rounded border border-[#e0e0e0] dark:border-[#3c3c3c] bg-white dark:bg-[#3c3c3c] text-[#1e1e1e] dark:text-[#cccccc] focus:outline-none focus:ring-1 focus:ring-[#0078d4] placeholder:text-[#848484] dark:placeholder:text-[#666]"
                                autoFocus
                            />
                            <p className="text-xs text-[#848484] dark:text-[#999]">
                                Alias defined in <code>~/.ssh/config</code> with a <code>LocalForward</code> entry.
                            </p>
                        </div>
                        <div className="flex flex-col gap-1">
                            <label className="text-xs font-medium text-[#1e1e1e] dark:text-[#cccccc]">
                                Local port <span className="text-[#f14c4c]">*</span>
                            </label>
                            <input
                                type="number"
                                data-testid={`${testIdPrefix}-server-ssh-port-input`}
                                value={sshPort}
                                onChange={e => setSshPort(e.target.value)}
                                placeholder="4000"
                                min={1}
                                max={65535}
                                className="px-3 py-1.5 text-sm rounded border border-[#e0e0e0] dark:border-[#3c3c3c] bg-white dark:bg-[#3c3c3c] text-[#1e1e1e] dark:text-[#cccccc] focus:outline-none focus:ring-1 focus:ring-[#0078d4] placeholder:text-[#848484] dark:placeholder:text-[#666]"
                            />
                        </div>
                    </>
                )}

                {input && (
                    <div className="text-xs" data-testid={`${testIdPrefix}-server-test-indicator`}>
                        {testState === 'testing' && (
                            <span className="text-[#848484] dark:text-[#999]">○ {kind === 'devtunnel' ? 'Connecting tunnel...' : kind === 'ssh' ? 'Connecting SSH...' : 'Testing...'}</span>
                        )}
                        {testState === 'ok' && (
                            <span className="text-[#16c060]">🟢 {testLabel}</span>
                        )}
                        {testState === 'fail' && (
                            <span className="text-[#f14c4c]">🔴 {testLabel || 'Cannot reach server'}</span>
                        )}
                    </div>
                )}

                <div className="flex flex-col gap-1">
                    <label className="text-xs font-medium text-[#1e1e1e] dark:text-[#cccccc]">
                        Label <span className="text-[#848484] dark:text-[#666] font-normal">(optional)</span>
                    </label>
                    <input
                        type="text"
                        data-testid={`${testIdPrefix}-server-label-input`}
                        value={label}
                        onChange={e => setLabel(e.target.value)}
                        placeholder="dev-vm"
                        className="px-3 py-1.5 text-sm rounded border border-[#e0e0e0] dark:border-[#3c3c3c] bg-white dark:bg-[#3c3c3c] text-[#1e1e1e] dark:text-[#cccccc] focus:outline-none focus:ring-1 focus:ring-[#0078d4] placeholder:text-[#848484] dark:placeholder:text-[#666]"
                    />
                    <p className="text-xs text-[#848484] dark:text-[#999]">
                        If blank, the endpoint is used as the display name.
                    </p>
                </div>
            </div>
        </Dialog>
    );
}

export function AddServerDialog({ open, onClose, onAdd }: AddServerDialogProps) {
    return (
        <ServerFormDialog
            open={open}
            mode="add"
            onClose={onClose}
            onSubmit={onAdd}
        />
    );
}

export function EditServerDialog({ open, server, onClose, onSave }: EditServerDialogProps) {
    return (
        <ServerFormDialog
            open={open && !!server}
            mode="edit"
            initialInput={inputFromServer(server)}
            onClose={onClose}
            onSubmit={onSave}
        />
    );
}
