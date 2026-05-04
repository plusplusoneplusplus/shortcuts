/**
 * AddServerDialog — modal for adding a remote CoC server with a debounced
 * inline connection test.
 *
 * The dialog never persists state itself; it just collects URL + label and
 * invokes `onAdd` so the parent (ServersView) can call addRemoteServer().
 * The connection test is purely informational — it does NOT block submission.
 */

import { useEffect, useRef, useState } from 'react';
import { Dialog, Button } from '../../ui';

export interface AddServerDialogProps {
    open: boolean;
    onClose: () => void;
    onAdd: (fields: { label: string; url: string }) => void;
}

const DEBOUNCE_MS = 600;
const FETCH_TIMEOUT_MS = 5_000;

type TestState = 'idle' | 'testing' | 'ok' | 'fail';

function stripTrailingSlash(url: string): string {
    return url.replace(/\/+$/, '');
}

export function AddServerDialog({ open, onClose, onAdd }: AddServerDialogProps) {
    const [label, setLabel] = useState('');
    const [url, setUrl] = useState('');
    const [testState, setTestState] = useState<TestState>('idle');
    const [testLabel, setTestLabel] = useState('');
    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        if (!open) {
            setLabel('');
            setUrl('');
            setTestState('idle');
            setTestLabel('');
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
        const trimmed = stripTrailingSlash(url.trim());
        if (!trimmed) {
            setTestState('idle');
            setTestLabel('');
            return;
        }

        setTestState('testing');
        setTestLabel('');

        debounceRef.current = setTimeout(async () => {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
            try {
                const [healthRes, versionRes] = await Promise.all([
                    fetch(`${trimmed}/api/health`, { signal: controller.signal }),
                    fetch(`${trimmed}/api/admin/version`, { signal: controller.signal }),
                ]);
                clearTimeout(timer);
                if (!healthRes.ok || !versionRes.ok) {
                    setTestState('fail');
                    setTestLabel('');
                    return;
                }
                const ver = await versionRes.json().catch(() => ({}));

                let hostname = '';
                try {
                    const cfgRes = await fetch(`${trimmed}/api/admin/config`);
                    if (cfgRes.ok) {
                        const cfg = await cfgRes.json().catch(() => ({}));
                        const candidate = cfg?.hostname ?? cfg?.resolved?.hostname;
                        if (typeof candidate === 'string') { hostname = candidate; }
                    }
                } catch {
                    // ignore — best effort
                }

                const desc = [
                    hostname ? `CoC @ ${hostname}` : null,
                    typeof ver?.version === 'string' && ver.version ? `v${ver.version}` : null,
                ].filter(Boolean).join(' · ');

                setTestState('ok');
                setTestLabel(desc || 'Connected');
            } catch {
                clearTimeout(timer);
                setTestState('fail');
                setTestLabel('');
            }
        }, DEBOUNCE_MS);

        return () => {
            if (debounceRef.current) {
                clearTimeout(debounceRef.current);
                debounceRef.current = null;
            }
        };
    }, [url]);

    const trimmedUrl = url.trim();
    const submitDisabled = trimmedUrl.length === 0;

    const handleSubmit = () => {
        const cleanedUrl = stripTrailingSlash(trimmedUrl);
        if (!cleanedUrl) { return; }
        const cleanedLabel = label.trim() || cleanedUrl;
        onAdd({ label: cleanedLabel, url: cleanedUrl });
        onClose();
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
                        onClick={handleSubmit}
                    >
                        Add Server
                    </Button>
                </>
            }
        >
            <div className="flex flex-col gap-4">
                <div className="flex flex-col gap-1">
                    <label className="text-xs font-medium text-[#1e1e1e] dark:text-[#cccccc]">
                        URL <span className="text-[#f14c4c]">*</span>
                    </label>
                    <input
                        type="url"
                        data-testid="add-server-url-input"
                        value={url}
                        onChange={e => setUrl(e.target.value)}
                        placeholder="https://machine-coc-4000.devtunnels.ms"
                        className="px-3 py-1.5 text-sm rounded border border-[#e0e0e0] dark:border-[#3c3c3c] bg-white dark:bg-[#3c3c3c] text-[#1e1e1e] dark:text-[#cccccc] focus:outline-none focus:ring-1 focus:ring-[#0078d4] placeholder:text-[#848484] dark:placeholder:text-[#666]"
                        autoFocus
                    />
                    {trimmedUrl !== '' && (
                        <div className="text-xs mt-1" data-testid="add-server-test-indicator">
                            {testState === 'testing' && (
                                <span className="text-[#848484] dark:text-[#999]">○ Testing…</span>
                            )}
                            {testState === 'ok' && (
                                <span className="text-[#16c060]">🟢 {testLabel}</span>
                            )}
                            {testState === 'fail' && (
                                <span className="text-[#f14c4c]">🔴 Cannot reach server</span>
                            )}
                        </div>
                    )}
                </div>
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
                        If blank, the URL is used as the display name.
                    </p>
                </div>
            </div>
        </Dialog>
    );
}
