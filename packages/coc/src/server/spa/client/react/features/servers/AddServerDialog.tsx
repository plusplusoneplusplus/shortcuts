import { useEffect, useRef, useState } from 'react';
import { Dialog, Button } from '../../ui';
import { testRemoteServer, type RemoteServerInput } from '../../utils/serverRegistry';

export interface AddServerDialogProps {
    open: boolean;
    onClose: () => void;
    onAdd: (fields: RemoteServerInput) => void | Promise<void>;
}

const DEBOUNCE_MS = 600;

type TestState = 'idle' | 'testing' | 'ok' | 'fail';
type ConnectionKind = RemoteServerInput['kind'];

function stripTrailingSlash(url: string): string {
    return url.replace(/\/+$/, '');
}

function buildInput(kind: ConnectionKind, label: string, url: string, tunnelId: string): RemoteServerInput | undefined {
    if (kind === 'url') {
        const cleanedUrl = stripTrailingSlash(url.trim());
        if (!cleanedUrl) {
            return undefined;
        }
        return { kind, label: label.trim() || cleanedUrl, url: cleanedUrl };
    }
    const cleanedTunnelId = tunnelId.trim();
    if (!cleanedTunnelId) {
        return undefined;
    }
    return { kind, label: label.trim() || cleanedTunnelId, tunnelId: cleanedTunnelId };
}

export function AddServerDialog({ open, onClose, onAdd }: AddServerDialogProps) {
    const [kind, setKind] = useState<ConnectionKind>('url');
    const [label, setLabel] = useState('');
    const [url, setUrl] = useState('');
    const [tunnelId, setTunnelId] = useState('');
    const [testState, setTestState] = useState<TestState>('idle');
    const [testLabel, setTestLabel] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        if (!open) {
            setKind('url');
            setLabel('');
            setUrl('');
            setTunnelId('');
            setTestState('idle');
            setTestLabel('');
            setSubmitting(false);
            if (debounceRef.current) {
                clearTimeout(debounceRef.current);
                debounceRef.current = null;
            }
        }
    }, [open]);

    useEffect(() => {
        if (debounceRef.current) {
            clearTimeout(debounceRef.current);
            debounceRef.current = null;
        }

        const input = buildInput(kind, label, url, tunnelId);
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
                    input.kind === 'devtunnel' && health.localPort ? `localhost:${health.localPort}` : null,
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
    }, [kind, label, url, tunnelId]);

    const input = buildInput(kind, label, url, tunnelId);
    const submitDisabled = !input || submitting;

    const handleSubmit = async () => {
        if (!input) { return; }
        setSubmitting(true);
        try {
            await onAdd(input);
            onClose();
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <Dialog
            id="add-server-dialog"
            open={open}
            onClose={onClose}
            title="Add Server"
            footer={
                <>
                    <Button
                        variant="secondary"
                        size="sm"
                        data-testid="add-server-cancel-btn"
                        onClick={onClose}
                    >
                        Cancel
                    </Button>
                    <Button
                        variant="primary"
                        size="sm"
                        data-testid="add-server-submit-btn"
                        disabled={submitDisabled}
                        onClick={() => { void handleSubmit(); }}
                    >
                        Add Server
                    </Button>
                </>
            }
        >
            <div className="flex flex-col gap-4">
                <fieldset className="flex flex-col gap-2">
                    <legend className="text-xs font-medium text-[#1e1e1e] dark:text-[#cccccc]">Connection type</legend>
                    <div className="flex gap-3 text-sm text-[#1e1e1e] dark:text-[#cccccc]">
                        <label className="inline-flex items-center gap-1.5">
                            <input
                                type="radio"
                                name="server-kind"
                                value="url"
                                checked={kind === 'url'}
                                onChange={() => setKind('url')}
                                data-testid="add-server-kind-url"
                            />
                            Direct URL
                        </label>
                        <label className="inline-flex items-center gap-1.5">
                            <input
                                type="radio"
                                name="server-kind"
                                value="devtunnel"
                                checked={kind === 'devtunnel'}
                                onChange={() => setKind('devtunnel')}
                                data-testid="add-server-kind-devtunnel"
                            />
                            DevTunnel ID
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
                            data-testid="add-server-url-input"
                            value={url}
                            onChange={e => setUrl(e.target.value)}
                            placeholder="http://remote-host:4000"
                            className="px-3 py-1.5 text-sm rounded border border-[#e0e0e0] dark:border-[#3c3c3c] bg-white dark:bg-[#3c3c3c] text-[#1e1e1e] dark:text-[#cccccc] focus:outline-none focus:ring-1 focus:ring-[#0078d4] placeholder:text-[#848484] dark:placeholder:text-[#666]"
                            autoFocus
                        />
                    </div>
                ) : (
                    <div className="flex flex-col gap-1">
                        <label className="text-xs font-medium text-[#1e1e1e] dark:text-[#cccccc]">
                            Tunnel ID <span className="text-[#f14c4c]">*</span>
                        </label>
                        <input
                            type="text"
                            data-testid="add-server-tunnel-id-input"
                            value={tunnelId}
                            onChange={e => setTunnelId(e.target.value)}
                            placeholder="my-remote-coc"
                            className="px-3 py-1.5 text-sm rounded border border-[#e0e0e0] dark:border-[#3c3c3c] bg-white dark:bg-[#3c3c3c] text-[#1e1e1e] dark:text-[#cccccc] focus:outline-none focus:ring-1 focus:ring-[#0078d4] placeholder:text-[#848484] dark:placeholder:text-[#666]"
                            autoFocus
                        />
                    </div>
                )}

                {input && (
                    <div className="text-xs" data-testid="add-server-test-indicator">
                        {testState === 'testing' && (
                            <span className="text-[#848484] dark:text-[#999]">○ {kind === 'devtunnel' ? 'Connecting tunnel...' : 'Testing...'}</span>
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
                        data-testid="add-server-label-input"
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
