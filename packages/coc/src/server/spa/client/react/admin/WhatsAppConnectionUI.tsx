import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { Spinner } from '../ui';

export type WhatsAppConnectionState = 'disconnected' | 'connecting' | 'qr-pending' | 'connected' | 'creating-group' | 'error';

export function WhatsAppQRCode({ value }: { value: string }) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [renderError, setRenderError] = useState<string | null>(null);

    useEffect(() => {
        if (!canvasRef.current) return;
        let active = true;
        setRenderError(null);
        QRCode.toCanvas(canvasRef.current, value, {
            width: 280,
            margin: 2,
            color: { dark: '#000000', light: '#ffffff' },
        }).catch(() => {
            if (active) setRenderError('Could not display the pairing QR code. Close and reopen pairing to try again.');
        });
        return () => { active = false; };
    }, [value]);

    return (
        <div className="flex flex-col items-center gap-3">
            <canvas ref={canvasRef} aria-label="WhatsApp pairing QR code"
                className="rounded-lg border-4 border-white dark:border-[#3c3c3c] shadow-lg"
                style={{ imageRendering: 'pixelated' }} />
            {renderError && <p role="alert" className="text-xs text-red-600 text-center">{renderError}</p>}
            <p className="text-xs text-[#616161] dark:text-[#999] text-center max-w-[280px]">
                Open WhatsApp on your phone → Settings → Linked Devices → Link a Device → Scan this QR code
            </p>
        </div>
    );
}

export function WhatsAppStatusIndicator({ status }: { status: WhatsAppConnectionState }) {
    const colors: Record<WhatsAppConnectionState, string> = {
        connected: 'bg-green-500',
        'qr-pending': 'bg-amber-500 animate-pulse',
        'creating-group': 'bg-blue-500 animate-pulse',
        connecting: 'bg-blue-500 animate-pulse',
        disconnected: 'bg-gray-400',
        error: 'bg-red-500',
    };
    const labels: Record<WhatsAppConnectionState, string> = {
        connected: 'Connected',
        'qr-pending': 'Waiting for QR scan',
        'creating-group': 'Creating group…',
        connecting: 'Connecting…',
        disconnected: 'Not connected',
        error: 'Error',
    };
    return <span className="flex items-center gap-2" role="status">
        <span className={`inline-block w-2 h-2 rounded-full ${colors[status]}`} />
        <span className="text-sm">{labels[status]}</span>
    </span>;
}

export function WhatsAppPairingContent({ status, qr, error, groupJid, waitingHint }: {
    status?: WhatsAppConnectionState;
    qr?: string | null;
    error?: string | null;
    groupJid?: string | null;
    waitingHint: string;
}) {
    return <div className="flex flex-col items-center gap-4 py-4">
        {qr ? <WhatsAppQRCode value={qr} /> : error ? (
            <div className="flex flex-col items-center gap-2 py-8">
                <div className="w-16 h-16 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
                    <span className="text-3xl">✕</span>
                </div>
                <p className="text-sm font-medium text-red-700 dark:text-red-400">Connection failed</p>
                <p className="text-xs text-[#999] text-center max-w-[300px]">{error}</p>
                <p className="text-xs text-[#999]">{waitingHint}</p>
            </div>
        ) : status === 'creating-group' ? (
            <div className="flex flex-col items-center gap-2 py-8">
                <Spinner size="md" />
                <p className="text-sm text-[#616161] dark:text-[#999]">Creating WhatsApp group…</p>
                <p className="text-xs text-[#999]">Phone paired! Setting up the bridge group now.</p>
            </div>
        ) : status === 'connecting' ? (
            <div className="flex flex-col items-center gap-2 py-8">
                <Spinner size="md" />
                <p className="text-sm text-[#616161] dark:text-[#999]">Connecting to WhatsApp…</p>
            </div>
        ) : status === 'connected' ? (
            <div className="flex flex-col items-center gap-2 py-8">
                <div className="w-16 h-16 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
                    <span className="text-3xl">✓</span>
                </div>
                <p className="text-sm font-medium text-green-700 dark:text-green-400">WhatsApp is connected!</p>
                {groupJid && <p className="text-xs text-[#999]">Group ready — messages will be bridged.</p>}
            </div>
        ) : (
            <div className="flex flex-col items-center gap-2 py-8">
                <Spinner size="md" />
                <p className="text-sm text-[#616161] dark:text-[#999]">Waiting for QR code…</p>
                <p className="text-xs text-[#999]">{waitingHint}</p>
            </div>
        )}
    </div>;
}
