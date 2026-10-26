import { useEffect, useRef, useState } from 'react';
import type { BrowserDownloadAction, BrowserDownloadsResult, BrowserEngine, DesktopBrowserDownloads } from '../../../shared/file-path/browser-bridge';
import { Dialog } from '../../../ui/Dialog';

const button = 'rounded-full px-3 py-1.5 text-xs font-medium hover:bg-black/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#007acc] disabled:opacity-40 disabled:cursor-not-allowed dark:hover:bg-white/10';
function bytes(value: number): string {
    if (value < 1024) { return `${value} B`; }
    if (value < 1024 * 1024) { return `${(value / 1024).toFixed(1)} KB`; }
    if (value < 1024 * 1024 * 1024) { return `${(value / (1024 * 1024)).toFixed(1)} MB`; }
    return `${(value / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}
const labels = { downloading: 'Downloading', paused: 'Paused', completed: 'Completed', cancelled: 'Cancelled', interrupted: 'Interrupted', failed: 'Failed' };

/** Desktop-global metadata and ID-only actions; engine limitations stay visible. */
export function BrowserDownloadsPanel({ downloads, engine, desktop, onClose }: {
    downloads?: DesktopBrowserDownloads;
    engine?: BrowserEngine;
    desktop: boolean;
    onClose(): void;
}) {
    const [result, setResult] = useState<BrowserDownloadsResult | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [pending, setPending] = useState(false);
    const [loading, setLoading] = useState(!!downloads);
    const [refresh, setRefresh] = useState(0);
    const revision = useRef(0);
    const mounted = useRef(false);
    const busy = useRef(false);
    useEffect(() => { mounted.current = true; return () => { mounted.current = false; ++revision.current; }; }, []);
    useEffect(() => {
        if (!downloads) { return; }
        const request = ++revision.current;
        void downloads.query().then(reply => {
            if (mounted.current && request === revision.current) { setResult(reply); setLoading(false); }
        }, () => {
            if (mounted.current && request === revision.current) { setResult({ ok: false, reason: 'unavailable', message: 'Could not load downloads.' }); setLoading(false); }
        });
        return () => { ++revision.current; };
    }, [downloads, refresh]);
    useEffect(() => downloads?.onChanged(() => { ++revision.current; setRefresh(value => value + 1); }), [downloads]);
    const action = async (id: string | null, operation: BrowserDownloadAction) => {
        if (!downloads || busy.current) { return; }
        busy.current = true; setPending(true); setError(null);
        try {
            const reply = await downloads.action(id, operation);
            if (!mounted.current) { return; }
            if (!reply.ok) {setError(reply.message ?? 'This download action is unavailable.'); }
            ++revision.current; setRefresh(value => value + 1);
        } catch { if (mounted.current) {setError('Download action failed. Check its state before trying again.'); } }
        finally { busy.current = false; if (mounted.current) {setPending(false); } }
    };
    const entries = result?.ok ? result.entries : [];
    return <Dialog open title="Downloads" onClose={onClose} trapFocus dense className="max-w-[640px] rounded-2xl">
        <div data-native-view-overlay className="flex min-h-0 flex-col gap-3">
            <p className="text-xs text-[#616161] dark:text-[#aaa]">Downloads on this device, shared by all workspaces and desktop windows. Clearing records keeps your files.</p>
            {!downloads ? <p role="status">{desktop ? 'This desktop version does not support download management. Downloads are managed in your system browser.' : 'Download management is available in the CoC desktop app. Web downloads are managed by your browser.'}</p> : <>
                {engine === 'webview2' && <p role="status" className="rounded-xl bg-black/5 p-3 text-xs dark:bg-white/5">{result?.ok ? result.engines.webview2.message : 'WebView2 cannot manage downloads here. Use Open in system browser to download from the source page.'} The list below contains desktop-managed Electron downloads.</p>}
                <div className="flex flex-wrap justify-end gap-1">
                    <button type="button" className={button} disabled={pending} onClick={() => { ++revision.current; setRefresh(value => value + 1); }}>Refresh</button>
                    <button type="button" className={button} disabled={pending || !entries.some(entry => !entry.active)} onClick={() => void action(null, 'clear')}>Clear finished records</button>
                </div>
                {error && <p role="alert">{error}</p>}
                {result?.ok && result.storageError && <p role="alert">{result.storageError}</p>}
                {loading && <p role="status">Loading downloads…</p>}
                {result && !result.ok && <p role="alert">{result.message ?? 'Could not load downloads.'}</p>}
                {result?.ok && entries.length === 0 && <p role="status" className="py-8 text-center text-[#616161] dark:text-[#aaa]">No downloads yet.</p>}
                {entries.length > 0 && <ul aria-label="Downloads" className="max-h-[60vh] space-y-2 overflow-y-auto">
                    {entries.map(entry => <li key={entry.id} className="min-w-0 rounded-xl border border-black/10 bg-[#fafafa] p-3 dark:border-white/10 dark:bg-[#202020]">
                        <div className="break-words text-sm font-medium" dir="auto">{entry.filename}</div>
                        <div className="mt-1 flex flex-wrap gap-x-2 text-xs text-[#616161] dark:text-[#aaa]">
                            <span className="break-all">{entry.source}</span>
                            <time dateTime={new Date(entry.started).toISOString()}>{new Date(entry.started).toLocaleString()}</time>
                        </div>
                        <div className="mt-2 flex flex-wrap justify-between gap-2 text-xs">
                            <span>{labels[entry.state]}</span>
                            <span>{bytes(entry.received)}{entry.total > 0 ? ` of ${bytes(entry.total)}` : ' · Size unknown'}</span>
                        </div>
                        {entry.active && <progress aria-label={`Download progress for ${entry.filename}`} className="mt-2 h-1.5 w-full accent-[#777]" max={entry.total || undefined} value={entry.total > 0 ? Math.min(entry.received, entry.total) : undefined} />}
                        {entry.state === 'interrupted' && <p className="mt-1 text-xs text-[#616161] dark:text-[#aaa]">Transfer stopped. Return to the source page to download again.</p>}
                        {entry.state === 'completed' && !entry.fileAvailable && <p className="mt-1 text-xs text-[#616161] dark:text-[#aaa]">File is missing or has changed.</p>}
                        <div role="group" aria-label={`Actions for ${entry.filename}`} className="mt-2 flex flex-wrap justify-end gap-1">
                            {entry.canPause && <button type="button" className={button} disabled={pending} onClick={() => void action(entry.id, 'pause')}>Pause</button>}
                            {entry.canResume && <button type="button" className={button} disabled={pending} onClick={() => void action(entry.id, 'resume')}>Resume</button>}
                            {entry.active && <button type="button" className={button} disabled={pending} onClick={() => void action(entry.id, 'cancel')}>Cancel</button>}
                            {entry.state === 'completed' && <>
                                <button type="button" className={button} disabled={pending || !entry.fileAvailable} onClick={() => void action(entry.id, 'open')}>Open</button>
                                <button type="button" className={button} disabled={pending || !entry.fileAvailable} onClick={() => void action(entry.id, 'show')}>Show in folder</button>
                            </>}
                            {!entry.active && <button type="button" className={button} disabled={pending} onClick={() => void action(entry.id, 'remove')}>Remove record</button>}
                        </div>
                    </li>)}
                </ul>}
            </>}
        </div>
    </Dialog>;
}
