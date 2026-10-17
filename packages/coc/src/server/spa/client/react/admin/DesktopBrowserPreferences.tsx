import { useCallback, useEffect, useRef, useState } from 'react';
import { desktopBrowserBridge, openUrlInSystemBrowser, WEBVIEW2_INSTALL_URL, type BrowserEngine, type BrowserPreferences, type DesktopBrowserHistory, type BrowserOperationResult } from '../shared/file-path/browser-bridge';
import { SettingsCard } from './SettingsCard';
import { useAdminLocalBadge } from './adminTarget';
import { AdminRow, AdminToggle } from './adminControls';

/** Admin → Browser page sections, each the DOM id of a group the jump bar scrolls to. */
interface BrowserSection { id: string; label: string }

/**
 * Sections in page order: the desktop-installation groups (or their single
 * availability notice outside the desktop app), then the registry groups the
 * "Browser features" card renders as `browser-group-<groupId>`.
 */
export function getBrowserSections(bridge = desktopBrowserBridge()): BrowserSection[] {
    const desktop: BrowserSection[] = !bridge
        ? [{ id: 'browser-group-desktop', label: 'Desktop data' }]
        : [
            { id: 'browser-group-engine', label: 'Engine' },
            { id: 'browser-group-profiles', label: 'Profiles & sign-ins' },
            ...(bridge.history ? [{ id: 'browser-group-history', label: 'History' }] : []),
        ];
    return [
        ...desktop,
        { id: 'browser-group-browserAutomation', label: 'AI Browser Control' },
        { id: 'browser-group-browserPages', label: 'Pages & Previews' },
    ];
}

/** Compact in-page navigation for the Browser page's grouped sections. */
export function BrowserSectionNav() {
    return (
        <nav className="ar-section-jump" aria-label="Browser sections" data-testid="browser-section-nav">
            {getBrowserSections().map(section => (
                <button
                    key={section.id}
                    type="button"
                    className="ar-btn ar-btn-ghost ar-btn-sm"
                    onClick={() => document.getElementById(section.id)?.scrollIntoView({ block: 'start', behavior: 'smooth' })}
                    data-testid={`browser-jump-${section.id}`}
                >
                    {section.label}
                </button>
            ))}
        </nav>
    );
}

function BrowserGroup({ id, heading, children }: { id: string; heading: string; children: React.ReactNode }) {
    return (
        <div className="ar-feature-group" id={id} data-testid={id}>
            <div className="ar-feature-group-head">{heading}</div>
            {children}
        </div>
    );
}

const DESKTOP_CARD_DESCRIPTION = 'Browser engines, sign-ins and history belong to this desktop installation, across every workspace and window. Local HTML previews always use Electron.';

export function DesktopBrowserPreferences() {
    // Desktop installation data: stays local whichever machine Admin configures.
    const localBadge = useAdminLocalBadge('Global');
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

    if (!bridge) {
        return (
            <SettingsCard title="Desktop Preferences" badge="Desktop only" description={DESKTOP_CARD_DESCRIPTION} data-testid="desktop-browser-preferences">
                <BrowserGroup id="browser-group-desktop" heading="Desktop data">
                    <p role="status" className="ar-muted" data-testid="desktop-browser-unavailable">
                        Engine, profile and history settings are available only in the CoC desktop app. They are saved per desktop installation, never on this server or per workspace.
                    </p>
                </BrowserGroup>
            </SettingsCard>
        );
    }
    const operate = async (kind: BrowserEngine | 'select', action: () => Promise<BrowserOperationResult>, success: string) => {
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
        <SettingsCard title="Desktop Preferences" badge={localBadge} description={DESKTOP_CARD_DESCRIPTION} data-testid="desktop-browser-preferences">
            {!preferences ? <p role="status" className="ar-muted">Loading browser engines...</p> : (
                <>
                    <BrowserGroup id="browser-group-engine" heading="Engine">
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
                    </BrowserGroup>
                    <BrowserGroup id="browser-group-profiles" heading="Profiles & sign-ins">
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
                    </BrowserGroup>
                </>
            )}
            {bridge.history && (
                <BrowserGroup id="browser-group-history" heading="History">
                    <DesktopHistoryRecording history={bridge.history} />
                </BrowserGroup>
            )}
            {error && <p role="alert" style={{ color: 'var(--ar-danger)' }}>{error}</p>}
            {notice && <p role="status" className="ar-muted">{notice}</p>}
        </SettingsCard>
    );
}

function DesktopHistoryRecording({ history }: { history: DesktopBrowserHistory }) {
    const [recording, setRecording] = useState<boolean | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [storageError, setStorageError] = useState<string | null>(null);
    const mounted = useRef(false);
    const revision = useRef(0);
    const operating = useRef(false);
    const load = useCallback(async () => {
        const current = ++revision.current;
        try {
            const result = await history.query('', 0, 1);
            if (!mounted.current || current !== revision.current) { return; }
            if (result.ok) {
                setRecording(result.recording);
                setStorageError(result.storageError);
                setError(null);
            } else {
                setError(result.message ?? `Could not load history recording: ${result.reason}.`);
            }
        } catch (error) {
            if (mounted.current && current === revision.current) {
                setError(error instanceof Error ? error.message : 'Could not load history recording.');
            }
        }
    }, [history]);

    useEffect(() => {
        mounted.current = true;
        void load();
        const off = history.onChanged(() => { void load(); });
        return () => { mounted.current = false; revision.current++; off(); };
    }, [history, load]);

    const changeRecording = async (enabled: boolean) => {
        if (operating.current) { return; }
        operating.current = true;
        setBusy(true);
        setError(null);
        // Pending reads cannot overwrite the result of this mutation.
        revision.current++;
        try {
            const result = await history.setRecording(enabled);
            if (!mounted.current) { return; }
            if (result.ok) { await load(); }
            else { setError(result.message ?? `Could not save history recording: ${result.reason}.`); }
        } catch (error) {
            if (mounted.current) {
                setError(error instanceof Error ? error.message : 'Could not save history recording.');
            }
        } finally {
            operating.current = false;
            if (mounted.current) { setBusy(false); }
        }
    };

    return (
        <>
            <AdminRow name="Record browser history" hint="Saved on this desktop across all workspaces and windows. Pausing keeps existing history available for suggestions.">
                {recording === null ? <span role="status" className="ar-muted">{error ? 'History recording unavailable.' : 'Loading history recording...'}</span> : (
                    <AdminToggle aria-label="Record browser history" checked={recording} disabled={busy}
                        onChange={enabled => { void changeRecording(enabled); }} />
                )}
            </AdminRow>
            {storageError && <p role="alert" style={{ color: 'var(--ar-danger)' }}>History could not be saved: {storageError}</p>}
            {error && (
                <p role="alert" style={{ color: 'var(--ar-danger)' }}>
                    {error} <button type="button" className="ar-btn ar-btn-ghost ar-btn-sm" disabled={busy}
                        onClick={() => { void load(); }}>Retry history recording</button>
                </p>
            )}
        </>
    );
}
