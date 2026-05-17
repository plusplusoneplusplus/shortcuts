/**
 * IMSettingsSection — container-mode admin panel for Instant Messaging integrations.
 * Currently supports WhatsApp via Baileys.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { Card, Button, Spinner } from '../ui';
import { Dialog } from '../ui/Dialog';
import { SettingsCard } from './SettingsCard';
import { getRawApiBase } from '../utils/config';
import QRCode from 'qrcode';

interface WhatsAppStatus {
    enabled: boolean;
    status: 'disconnected' | 'connecting' | 'qr-pending' | 'connected';
    qr: string | null;
    error: string | null;
    groupJid?: string;
    userName: string;
}

async function fetchMessagingStatus(): Promise<WhatsAppStatus> {
    const res = await fetch(getRawApiBase() + '/container/messaging/status');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
}

// ── QR Code Display ─────────────────────────────────────────

function QRCodeDisplay({ value }: { value: string }) {
    const canvasRef = useRef<HTMLCanvasElement>(null);

    useEffect(() => {
        if (!canvasRef.current) return;
        QRCode.toCanvas(canvasRef.current, value, {
            width: 280,
            margin: 2,
            color: { dark: '#000000', light: '#ffffff' },
        }).catch(() => {});
    }, [value]);

    return (
        <div className="flex flex-col items-center gap-3">
            <canvas
                ref={canvasRef}
                className="rounded-lg border-4 border-white dark:border-[#3c3c3c] shadow-lg"
                style={{ imageRendering: 'pixelated' }}
            />
            <p className="text-xs text-[#616161] dark:text-[#999] text-center max-w-[280px]">
                Open WhatsApp on your phone → Settings → Linked Devices → Link a Device → Scan this QR code
            </p>
        </div>
    );
}

// ── Status indicator components ─────────────────────────────

function StatusDot({ status }: { status: WhatsAppStatus['status'] }) {
    const colors: Record<string, string> = {
        connected: 'bg-green-500',
        'qr-pending': 'bg-amber-500 animate-pulse',
        connecting: 'bg-blue-500 animate-pulse',
        disconnected: 'bg-gray-400',
    };
    return <span className={`inline-block w-2 h-2 rounded-full ${colors[status] ?? colors.disconnected}`} />;
}

function StatusLabel({ status }: { status: WhatsAppStatus['status'] }) {
    const labels: Record<string, string> = {
        connected: 'Connected',
        'qr-pending': 'Waiting for QR scan',
        connecting: 'Connecting…',
        disconnected: 'Not connected',
    };
    return <span className="text-sm">{labels[status] ?? status}</span>;
}

// ── Main Section ────────────────────────────────────────────

export function IMSettingsSection() {
    const [status, setStatus] = useState<WhatsAppStatus | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [qrDialogOpen, setQrDialogOpen] = useState(false);
    const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

    const loadStatus = useCallback(async () => {
        try {
            const data = await fetchMessagingStatus();
            setStatus(data);
            setError(null);
        } catch (e: any) {
            setError(e.message ?? 'Failed to fetch status');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        void loadStatus();
    }, [loadStatus]);

    // Poll every 2s while QR dialog is open
    useEffect(() => {
        if (qrDialogOpen) {
            pollRef.current = setInterval(() => void loadStatus(), 2000);
            return () => { if (pollRef.current) clearInterval(pollRef.current); };
        } else {
            if (pollRef.current) clearInterval(pollRef.current);
        }
    }, [qrDialogOpen, loadStatus]);

    // Auto-close QR dialog when connected
    useEffect(() => {
        if (status?.status === 'connected' && qrDialogOpen) {
            setQrDialogOpen(false);
        }
    }, [status?.status, qrDialogOpen]);

    if (loading) {
        return (
            <Card className="p-4">
                <div className="flex items-center gap-2 text-sm text-[#848484]">
                    <Spinner size="sm" /> Loading messaging status…
                </div>
            </Card>
        );
    }

    return (
        <div className="space-y-3">
            <SettingsCard
                title="WhatsApp"
                description="Connect WhatsApp to bridge CoC conversations to a WhatsApp group."
                badge="Container"
                data-testid="im-settings-whatsapp"
            >
                {error && (
                    <div className="text-xs text-red-600 dark:text-red-400 mb-2">
                        ⚠ {error}
                    </div>
                )}

                {!status?.enabled ? (
                    <div className="space-y-2">
                        <p className="text-xs text-[#616161] dark:text-[#999]">
                            WhatsApp integration is disabled. Set <code className="text-[10px] bg-[#f0f0f0] dark:bg-[#3c3c3c] px-1 py-0.5 rounded">messaging.whatsapp.enabled: true</code> in your <code className="text-[10px] bg-[#f0f0f0] dark:bg-[#3c3c3c] px-1 py-0.5 rounded">~/.coccontainer/config.yaml</code> if it was explicitly disabled.
                        </p>
                        <pre className="text-[10px] bg-[#1e1e1e] text-[#d4d4d4] p-2 rounded overflow-x-auto">
{`messaging:
  whatsapp:
    enabled: true
    groupJid: "your-group@g.us"  # optional
    userName: "CoC"`}
                        </pre>
                        <p className="text-[10px] text-[#616161] dark:text-[#999]">
                            Restart the container after changing config.
                        </p>
                    </div>
                ) : (
                    <div className="space-y-3">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                <StatusDot status={status.status} />
                                <StatusLabel status={status.status} />
                            </div>
                            <div className="flex items-center gap-2">
                                <Button
                                    size="sm"
                                    variant={status.status === 'connected' ? 'secondary' : 'primary'}
                                    onClick={() => { setQrDialogOpen(true); void loadStatus(); }}
                                    disabled={status.status === 'connected'}
                                >
                                    {status.status === 'connected' ? '✓ Paired' : 'Setup / Pair'}
                                </Button>
                                <button
                                    onClick={() => void loadStatus()}
                                    title="Refresh status"
                                    className="text-[#616161] dark:text-[#999] hover:text-[#1e1e1e] dark:hover:text-[#cccccc] text-base leading-none px-1"
                                >↻</button>
                            </div>
                        </div>

                        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                            <span className="text-[#616161] dark:text-[#999]">Display name</span>
                            <span className="text-[#1e1e1e] dark:text-[#cccccc]">{status.userName}</span>
                            <span className="text-[#616161] dark:text-[#999]">Group JID</span>
                            <span className="text-[#1e1e1e] dark:text-[#cccccc] font-mono text-[10px]">
                                {status.groupJid || <span className="italic text-[#999]">not set</span>}
                            </span>
                        </div>
                    </div>
                )}
            </SettingsCard>

            <Dialog
                open={qrDialogOpen}
                onClose={() => setQrDialogOpen(false)}
                title="Pair WhatsApp"
            >
                <div className="flex flex-col items-center gap-4 py-4">
                    {status?.qr ? (
                        <QRCodeDisplay value={status.qr} />
                    ) : status?.error ? (
                        <div className="flex flex-col items-center gap-2 py-8">
                            <div className="w-16 h-16 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
                                <span className="text-3xl">✕</span>
                            </div>
                            <p className="text-sm font-medium text-red-700 dark:text-red-400">Connection failed</p>
                            <p className="text-xs text-[#999] text-center max-w-[300px]">{status.error}</p>
                            <p className="text-xs text-[#999]">Check network connectivity and try restarting the container.</p>
                        </div>
                    ) : status?.status === 'connecting' ? (
                        <div className="flex flex-col items-center gap-2 py-8">
                            <Spinner size="md" />
                            <p className="text-sm text-[#616161] dark:text-[#999]">Connecting to WhatsApp…</p>
                        </div>
                    ) : status?.status === 'connected' ? (
                        <div className="flex flex-col items-center gap-2 py-8">
                            <div className="w-16 h-16 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
                                <span className="text-3xl">✓</span>
                            </div>
                            <p className="text-sm font-medium text-green-700 dark:text-green-400">WhatsApp is connected!</p>
                        </div>
                    ) : (
                        <div className="flex flex-col items-center gap-2 py-8">
                            <Spinner size="md" />
                            <p className="text-sm text-[#616161] dark:text-[#999]">Waiting for QR code…</p>
                            <p className="text-xs text-[#999]">Make sure WhatsApp is enabled in config and the container was restarted.</p>
                        </div>
                    )}
                </div>
            </Dialog>
        </div>
    );
}
