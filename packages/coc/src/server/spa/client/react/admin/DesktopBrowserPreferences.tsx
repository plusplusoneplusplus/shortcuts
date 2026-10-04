import { useEffect, useRef, useState } from 'react';
import { desktopBrowserBridge, openUrlInSystemBrowser, WEBVIEW2_INSTALL_URL, type BrowserEngine, type BrowserPreferences } from '../shared/file-path/browser-bridge';
import { SettingsCard } from './SettingsCard';
import { AdminRow } from './adminControls';

export function DesktopBrowserPreferences() {
    const bridge = desktopBrowserBridge();
    const [preferences, setPreferences] = useState<BrowserPreferences | null>(null);
    const [busy, setBusy] = useState<BrowserEngine | 'select' | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [notice, setNotice] = useState<string | null>(null);
    const mounted = useRef(false);
    const generation = useRef(0);

    useEffect(() => {
        if (!bridge) { return; }
        mounted.current = true;
        const load = () => {
            const current = ++generation.current;
            void bridge.getPreferences().then(value => {
                if (mounted.current && current === generation.current) { setPreferences(value); }
            }).catch(error => {
                if (mounted.current && current === generation.current) { setError(error instanceof Error ? error.message : 'Could not load desktop browser preferences.'); }
            });
        };
        load();
        const off = bridge.onPreferencesChanged(load);
        return () => { mounted.current = false; generation.current++; off(); };
    }, [bridge]);

    if (!bridge) { return null; }
    const operate = async (kind: BrowserEngine | 'select', action: () => ReturnType<typeof bridge.clearData>, success: string) => {
        setBusy(kind);
        setError(null);
        setNotice(null);
        try {
            const result = await action();
            if (!mounted.current) { return; }
            if (result.ok) {
                setNotice(success);
                const value = await bridge.getPreferences();
                if (mounted.current) { setPreferences(value); }
            } else if (result.reason !== 'cancelled') { setError(result.message ?? `Browser operation failed: ${result.reason}. Retry explicitly.`); }
        } catch (error) {
            if (mounted.current) { setError(error instanceof Error ? error.message : 'Desktop browser operation failed.'); }
        } finally { if (mounted.current) { setBusy(null); } }
    };

    return (
        <SettingsCard title="Desktop Preferences" badge="Global" description="Browser engines and sign-ins belong to this desktop installation, across every workspace and window. Local HTML previews always use Electron." data-testid="desktop-browser-preferences">
            {!preferences ? <p role="status" className="ar-muted">Loading browser engines...</p> : (
                <>
                    <AdminRow name="Default browser engine" hint="Saved immediately. Applies to new tabs only; existing tabs keep their engine and history.">
                        <select
                            aria-label="Default browser engine" className="ar-select"
                            value={preferences.defaultEngine} disabled={busy !== null}
                            onChange={event => {
                                const engine = event.target.value;
                                if (engine === 'electron' || engine === 'webview2') { void operate('select', () => bridge.setDefaultEngine(engine), 'Default browser engine saved. Existing tabs are unchanged.'); }
                            }}
                        >
                            {preferences.engines.filter(engine => engine.reason !== 'unsupported-platform').map(engine => (
                                <option key={engine.engine} value={engine.engine}>{engine.engine === 'electron' ? 'Electron' : 'WebView2'}{engine.available ? '' : ' (unavailable)'}</option>
                            ))}
                        </select>
                    </AdminRow>
                    {preferences.engines.map(engine => (
                        <AdminRow key={engine.engine} name={engine.engine === 'electron' ? 'Electron browser data' : 'WebView2 browser data'}
                            hint={engine.message ?? 'Separate persistent cookies, cache and site storage. Clearing data signs you out across all workspaces.'}>
                            {engine.reason === 'missing-runtime' && (
                                <button className="ar-btn ar-btn-ghost ar-btn-sm" type="button" onClick={() => {
                                    void openUrlInSystemBrowser(WEBVIEW2_INSTALL_URL).then(ok => { if (!ok && mounted.current) { setError('Could not open the official WebView2 download page.'); } });
                                }}>Get WebView2 Runtime</button>
                            )}
                            {engine.reason !== 'unsupported-platform' && (
                                <button className="ar-btn ar-btn-danger-outline ar-btn-sm" type="button"
                                    disabled={busy !== null || preferences.clearing.includes(engine.engine)}
                                    onClick={() => { void operate(engine.engine, () => bridge.clearData(engine.engine), `${engine.engine === 'electron' ? 'Electron' : 'WebView2'} browser data cleared across all workspaces.`); }}>
                                    {busy === engine.engine || preferences.clearing.includes(engine.engine) ? 'Clearing...' : `Clear ${engine.engine === 'electron' ? 'Electron' : 'WebView2'} data...`}
                                </button>
                            )}
                        </AdminRow>
                    ))}
                </>
            )}
            {error && <p role="alert" style={{ color: 'var(--ar-danger)' }}>{error}</p>}
            {notice && <p role="status" className="ar-muted">{notice}</p>}
        </SettingsCard>
    );
}
