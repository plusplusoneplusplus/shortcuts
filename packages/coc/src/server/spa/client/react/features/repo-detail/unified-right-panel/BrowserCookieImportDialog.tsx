import { useEffect, useId, useRef, useState } from 'react';
import { Button, Dialog } from '../../../ui';
import type { DesktopBrowserBridge } from '../../../shared/file-path/browser-bridge';

export function BrowserCookieImportDialog({ bridge, viewId, initialDomain, onClose, onImported }: {
    bridge: DesktopBrowserBridge;
    viewId: string;
    initialDomain: string;
    onClose(): void;
    onImported(domain: string): void;
}) {
    const id = useId();
    const domainRef = useRef<HTMLInputElement>(null);
    useEffect(() => { domainRef.current?.focus(); }, []);
    const [domain, setDomain] = useState(initialDomain);
    const [cookies, setCookies] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const importing = useRef(false);
    const close = () => { if (!importing.current) onClose(); };
    const submit = async () => {
        if (importing.current || !bridge.importCookies) return;
        importing.current = true;
        setBusy(true);
        setError(null);
        try {
            const reply = await bridge.importCookies(viewId, domain.trim(), cookies);
            if (reply.ok) { setCookies(''); onImported(domain.trim()); }
            else setError(reply.message ?? `Could not import cookies: ${reply.reason}.`);
        } catch { setError('Could not import cookies. Try again.'); }
        finally { importing.current = false; setBusy(false); }
    };
    const fieldClass = 'w-full rounded border border-[#c8c8c8] bg-transparent px-2 py-1.5 text-sm dark:border-[#555]';
    return <Dialog open onClose={close} disableClose={busy} title="Import cookies" id="browser-cookie-import-dialog"
        footer={<div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={close} disabled={busy}>Cancel</Button>
            <Button size="sm" onClick={() => void submit()} disabled={busy || !domain.trim() || !cookies.trim()}>{busy ? 'Importing…' : 'Import'}</Button>
        </div>}>
        <div className="flex flex-col gap-3 text-sm" data-native-view-overlay>
            <label htmlFor={`${id}-domain`}>Domain</label>
            <input ref={domainRef} id={`${id}-domain`} value={domain} onChange={e => setDomain(e.target.value)}
                placeholder="app.example.com" autoComplete="off" spellCheck={false} disabled={busy} className={fieldClass} />
            <label htmlFor={`${id}-cookies`}>Cookies</label>
            <textarea id={`${id}-cookies`} value={cookies} onChange={e => setCookies(e.target.value)} rows={6}
                placeholder='name=value; name2=value2 or a JSON cookie array' autoComplete="off" spellCheck={false}
                disabled={busy} maxLength={65536} className={`${fieldClass} font-mono`} />
            <p className="text-xs text-[#616161] dark:text-[#9d9d9d]">Choose the original site’s domain even if this tab has redirected to a login page. Cookies are shared across workspaces using this browser engine. After import, open the original URL.</p>
            {error && <p role="alert" className="text-xs text-[#a1260d] dark:text-[#f48771]">{error}</p>}
        </div>
    </Dialog>;
}
