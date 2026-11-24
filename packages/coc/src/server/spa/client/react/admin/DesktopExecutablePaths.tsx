/**
 * Admin → Server: installation-wide executable search paths of the CoC
 * desktop app.
 *
 * A Finder/Dock-launched desktop app inherits a short PATH, so the local server
 * it starts cannot find tools such as Homebrew's `gh`. These folders are added
 * after the inherited PATH of that server and every process it runs. They are
 * saved by the desktop main process (never on a server or per workspace) and
 * apply the next time the app starts its own server. Attached external servers
 * and remote servers keep their own environment.
 */
import { useEffect, useRef, useState } from 'react';
import { SettingsCard } from './SettingsCard';
import { useAdminLocalBadge } from './adminTarget';
import { AdminRow } from './adminControls';

export interface ExecutablePathsState {
    paths: string[];
    custom: boolean;
    defaults: string[];
    platform: string;
    server: { ownership: 'owned' | 'external' | 'starting'; appliedPaths: string[] | null };
    restartRequired: boolean;
}

export type ExecutablePathsSaveResult =
    | { ok: true; state: ExecutablePathsState }
    | { ok: false; reason: string; message?: string; errors?: { index: number | null; message: string }[] };

export interface DesktopExecutablePathsBridge {
    get(): Promise<ExecutablePathsState>;
    set(paths: string[] | null): Promise<ExecutablePathsSaveResult>;
}

/** The desktop preload bridge, or undefined in a browser or an older desktop build. */
export function desktopExecutablePathsBridge(): DesktopExecutablePathsBridge | undefined {
    if (typeof window === 'undefined') return undefined;
    const bridge = (window as unknown as { cocDesktop?: { executablePaths?: DesktopExecutablePathsBridge } }).cocDesktop?.executablePaths;
    return bridge && typeof bridge.get === 'function' && typeof bridge.set === 'function' ? bridge : undefined;
}

const PLATFORM_NAMES: Record<string, string> = { darwin: 'macOS', win32: 'Windows', linux: 'Linux' };

const DESCRIPTION = 'Folders added to the PATH of the local server this desktop app starts, and of every tool it runs (gh, az, git, language servers, agent CLIs). They come after the PATH the app inherited, so they only fill gaps. Shell profiles are not read.';

const OWNERSHIP_TEXT: Record<ExecutablePathsState['server']['ownership'], { label: string; hint: string }> = {
    owned: { label: 'Started by this app', hint: 'Uses these paths. Saved changes apply the next time CoC Desktop starts.' },
    external: { label: 'External server', hint: 'This app attached to a server started elsewhere (for example coc serve). That server keeps its own PATH. These paths apply when this app starts its own server.' },
    starting: { label: 'Starting', hint: 'The local server has not finished starting.' },
};

function sameList(a: string[], b: string[]): boolean {
    return a.length === b.length && a.every((value, index) => value === b[index]);
}

export function DesktopExecutablePaths({ bridge = desktopExecutablePathsBridge() }: { bridge?: DesktopExecutablePathsBridge }) {
    const badge = useAdminLocalBadge('Desktop');
    const [state, setState] = useState<ExecutablePathsState | null>(null);
    const [draft, setDraft] = useState<string[]>([]);
    const [rowErrors, setRowErrors] = useState<Record<number, string>>({});
    const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
    const [saving, setSaving] = useState(false);
    const mounted = useRef(true);

    useEffect(() => {
        mounted.current = true;
        if (!bridge) return () => { mounted.current = false; };
        bridge.get().then(value => {
            if (!mounted.current) return;
            setState(value);
            setDraft(value.paths);
        }).catch((error: unknown) => {
            if (mounted.current) setMessage({ tone: 'error', text: error instanceof Error ? error.message : 'Could not load executable search paths.' });
        });
        return () => { mounted.current = false; };
    }, [bridge]);

    if (!bridge) return null;

    const save = async (paths: string[] | null) => {
        // Blank rows are dropped; errors map back to the row they came from.
        const rowIndexes: number[] = [];
        const submitted: string[] = [];
        if (paths) {
            paths.forEach((value, index) => {
                if (value.trim()) {
                    rowIndexes.push(index);
                    submitted.push(value.trim());
                }
            });
        }
        setSaving(true);
        setRowErrors({});
        setMessage(null);
        try {
            const result = await bridge.set(paths ? submitted : null);
            if (!mounted.current) return;
            if (result.ok) {
                setState(result.state);
                setDraft(result.state.paths);
                setMessage({
                    tone: 'ok',
                    text: result.state.restartRequired
                        ? 'Saved. Quit and reopen CoC Desktop to apply. The running server keeps its current PATH until then.'
                        : 'Saved.',
                });
            } else {
                const rows: Record<number, string> = {};
                let other: string | undefined;
                for (const error of result.errors ?? []) {
                    const row = error.index === null ? undefined : rowIndexes[error.index];
                    if (row === undefined) other ??= error.message;
                    else rows[row] = error.message;
                }
                setRowErrors(rows);
                setMessage({ tone: 'error', text: other ?? result.message ?? 'Could not save executable search paths.' });
            }
        } catch (error) {
            if (mounted.current) setMessage({ tone: 'error', text: error instanceof Error ? error.message : 'Could not save executable search paths.' });
        } finally {
            if (mounted.current) setSaving(false);
        }
    };

    const trimmedDraft = draft.map(value => value.trim()).filter(Boolean);
    const changed = !!state && !sameList(trimmedDraft, state.paths);
    const ownership = state ? OWNERSHIP_TEXT[state.server.ownership] : null;
    const platformName = state ? PLATFORM_NAMES[state.platform] ?? state.platform : '';

    return (
        <SettingsCard title="Executable search paths" badge={badge} description={DESCRIPTION} data-testid="desktop-executable-paths">
            {!state ? (
                <p role="status" className="ar-muted">{message?.text ?? 'Loading executable search paths...'}</p>
            ) : (
                <>
                    <AdminRow name="Local server" hint={ownership!.hint} data-testid="desktop-executable-paths-ownership">
                        <span className="ar-pill"><span className="ar-pill-dot" /> {ownership!.label}</span>
                    </AdminRow>
                    {state.restartRequired && (
                        <div className="ar-tip-banner" role="status" data-testid="desktop-executable-paths-restart">
                            Saved paths differ from the ones the running server started with. Quit and reopen CoC Desktop to apply them.
                        </div>
                    )}
                    <AdminRow
                        name="Folders"
                        hint={`${state.custom ? 'Custom list.' : `${platformName} defaults.`} One absolute folder per row, or start with ~. Saved on this desktop for all workspaces.`}
                    >
                        <span className={`ar-badge ${state.custom ? 'ar-badge-accent' : ''}`}>{state.custom ? 'Custom' : 'Default'}</span>
                    </AdminRow>
                    <div className="ar-section ar-vstack" id="desktop-executable-paths-list">
                        {draft.length === 0 && <p className="ar-muted" data-testid="desktop-executable-paths-empty">No folders. The server uses only the inherited PATH.</p>}
                        {draft.map((value, index) => (
                            <div key={index} className="ar-vstack" style={{ gap: 4 }}>
                                <div className="ar-hstack">
                                    <input
                                        type="text"
                                        className="ar-input ar-long ar-mono"
                                        style={{ flex: 1 }}
                                        value={value}
                                        placeholder={state.defaults[0] ?? '/usr/local/bin'}
                                        disabled={saving}
                                        spellCheck={false}
                                        autoComplete="off"
                                        aria-label={`Executable search path ${index + 1}`}
                                        aria-invalid={rowErrors[index] ? true : undefined}
                                        aria-errormessage={rowErrors[index] ? `desktop-executable-path-error-${index}` : undefined}
                                        onChange={event => {
                                            const next = [...draft];
                                            next[index] = event.target.value;
                                            setDraft(next);
                                        }}
                                    />
                                    <button
                                        type="button"
                                        className="ar-btn ar-btn-ghost ar-btn-sm"
                                        disabled={saving}
                                        aria-label={`Remove executable search path ${index + 1}`}
                                        onClick={() => { setDraft(draft.filter((_, i) => i !== index)); setRowErrors({}); }}
                                    >Remove</button>
                                </div>
                                {rowErrors[index] && (
                                    <span id={`desktop-executable-path-error-${index}`} style={{ color: 'var(--ar-danger)', fontSize: 12 }}>{rowErrors[index]}</span>
                                )}
                            </div>
                        ))}
                        <div className="ar-hstack">
                            <button type="button" className="ar-btn ar-btn-secondary ar-btn-sm" disabled={saving} onClick={() => setDraft([...draft, ''])}>Add folder</button>
                            <button
                                type="button"
                                className="ar-btn ar-btn-ghost ar-btn-sm"
                                disabled={saving || (!state.custom && !changed)}
                                onClick={() => { void save(null); }}
                            >Reset to {platformName} defaults</button>
                            <span style={{ flex: 1 }} />
                            <button
                                type="button"
                                className="ar-btn ar-btn-primary ar-btn-sm"
                                disabled={saving || !changed}
                                onClick={() => { void save(draft); }}
                            >{saving ? 'Saving...' : 'Save'}</button>
                        </div>
                    </div>
                </>
            )}
            <div role="status" aria-live="polite">
                {state && message && (
                    <p className="ar-muted" style={message.tone === 'error' ? { color: 'var(--ar-danger)' } : undefined} data-testid="desktop-executable-paths-message">{message.text}</p>
                )}
            </div>
        </SettingsCard>
    );
}
